import * as fs from "node:fs/promises";
import * as path from "node:path";
import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import { ResultsMessage } from "./views/resultsView";

export const resultBatchSize = 200;

interface ResultStream {
  databasePath: string;
  statement: ReturnType<Database["prepare"]>;
  columns: string[];
  booleanColumns: string[];
  totalRows: number;
  insertTable?: string;
  pendingRow?: Record<string, unknown>;
}

interface Batch {
  rows: Record<string, unknown>[];
  columns: string[];
  hasMore: boolean;
  pendingRow?: Record<string, unknown>;
}

export class SqliteExecutor {
  private sqlJs?: Promise<SqlJsStatic>;
  private readonly databases = new Map<string, Database>();
  private readonly resultStreams = new Map<string, ResultStream>();
  private querySequence = 0;

  public constructor(private readonly extensionPath: string) {}

  public async execute(databasePath: string, sql: string): Promise<ResultsMessage> {
    const database = await this.getDatabase(databasePath);
    this.clearResultStreams();
    const statement = database.prepare(sql);
    const columns = statement.getColumnNames();
    const booleanColumns = getBooleanColumns(database, columns);
    const insertTable = getSingleTableName(sql);
    const queryId = `query-${++this.querySequence}`;
    if (columns.length === 0) {
      statement.step();
      statement.free();
      const message = getStatementStatus(sql, database.getRowsModified());
      await fs.writeFile(databasePath, database.export());
      return message;
    }
    const totalRows = getTotalRows(database, sql);
    const firstRow = this.readBatch(statement, columns, resultBatchSize);
    if (firstRow.hasMore) {
      this.resultStreams.set(queryId, { databasePath, statement, columns, booleanColumns, totalRows, insertTable, pendingRow: firstRow.pendingRow });
    } else {
      statement.free();
    }
    return {
      type: "results",
      queryId,
      columns,
      rows: firstRow.rows,
      hasMore: firstRow.hasMore,
      totalRows,
      ...(insertTable ? { insertTable } : {}),
      ...(booleanColumns.length > 0 ? { booleanColumns } : {})
    };
  }

  public async nextBatch(queryId: string): Promise<ResultsMessage> {
    const stream = this.resultStreams.get(queryId);
    if (!stream) {
      return { type: "error", message: "This query result is no longer available." };
    }
    const batch = this.readBatch(stream.statement, stream.columns, resultBatchSize, stream.pendingRow);
    stream.pendingRow = batch.pendingRow;
    if (!batch.hasMore) {
      stream.statement.free();
      this.resultStreams.delete(queryId);
      const database = this.databases.get(stream.databasePath);
      if (database) {
        await fs.writeFile(stream.databasePath, database.export());
      }
    }
    return {
      type: "results",
      queryId,
      columns: stream.columns,
      rows: batch.rows,
      hasMore: batch.hasMore,
      totalRows: stream.totalRows,
      ...(stream.insertTable ? { insertTable: stream.insertTable } : {}),
      ...(stream.booleanColumns.length > 0 ? { booleanColumns: stream.booleanColumns } : {})
    };
  }

  public async dispose(): Promise<void> {
    this.clearResultStreams();
    for (const database of this.databases.values()) {
      database.close();
    }
    this.databases.clear();
  }

  private readBatch(
    statement: ReturnType<Database["prepare"]>,
    columns: string[],
    batchSize: number,
    pendingRow?: Record<string, unknown>
  ): Batch {
    const rows: Record<string, unknown>[] = pendingRow ? [pendingRow] : [];
    let exhausted = false;
    while (rows.length < batchSize && !exhausted) {
      if (statement.step()) {
        rows.push(statement.getAsObject() as Record<string, unknown>);
      } else {
        exhausted = true;
      }
    }
    if (!exhausted && statement.step()) {
      return {
        rows,
        columns,
        hasMore: true,
        pendingRow: statement.getAsObject() as Record<string, unknown>
      };
    }
    return { rows, columns, hasMore: false };
  }

  private clearResultStreams(): void {
    for (const stream of this.resultStreams.values()) {
      stream.statement.free();
    }
    this.resultStreams.clear();
  }

  private async getDatabase(databasePath: string): Promise<Database> {
    const existing = this.databases.get(databasePath);
    if (existing) {
      return existing;
    }

    const SQL = await this.getSqlJs();
    let data: Uint8Array | undefined;
    try {
      data = await fs.readFile(databasePath);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
    const database = data ? new SQL.Database(data) : new SQL.Database();
    this.databases.set(databasePath, database);
    return database;
  }

  private getSqlJs(): Promise<SqlJsStatic> {
    if (!this.sqlJs) {
      this.sqlJs = initSqlJs({
        locateFile: (file: string) => path.join(this.extensionPath, "node_modules", "sql.js", "dist", file)
      });
    }
    return this.sqlJs;
  }
}

function getStatementStatus(sql: string, affectedRows: number): ResultsMessage {
  const statementType = sql.trim().split(/\s+/, 1)[0]?.toUpperCase() ?? "SQL";
  const schemaStatement = ["ALTER", "CREATE", "DROP", "REINDEX", "VACUUM"].includes(statementType);
  return {
    type: "status",
    message: schemaStatement
      ? "Schema updated"
      : `${statementType} executed successfully. Rows affected: ${affectedRows}`,
    ...(schemaStatement ? {} : { affectedRows })
  };
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function getBooleanColumns(database: Database, resultColumns: string[]): string[] {
  const booleanColumnNames = new Set<string>();
  const tables = database.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values ?? [];
  for (const [tableName] of tables) {
    const statement = database.prepare(`PRAGMA table_info(${quoteIdentifier(String(tableName))})`);
    try {
      while (statement.step()) {
        const row = statement.getAsObject() as { name?: unknown; type?: unknown };
        if (typeof row.name === "string" && typeof row.type === "string" && /\bBOOL(?:EAN)?\b/i.test(row.type)) {
          booleanColumnNames.add(row.name.toLowerCase());
        }
      }
    } finally {
      statement.free();
    }
  }
  return resultColumns.filter((column) => booleanColumnNames.has(column.toLowerCase()));
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, `""`)}"`;
}

function getTotalRows(database: Database, sql: string): number {
  const query = sql.trim().replace(/;$/, "");
  const result = database.exec(`SELECT COUNT(*) AS count FROM (${query})`);
  const count = result[0]?.values[0]?.[0];
  return typeof count === "number" ? count : Number(count);
}

function getSingleTableName(sql: string): string | undefined {
  if (/\b(join|union|intersect|except)\b/i.test(sql)) {
    return undefined;
  }
  const match = sql.match(/\bfrom\s+(["`[\]\w.]+)(?:\s+\w+)?\s*(?:where|group|having|order|limit|offset|$)/i);
  return match?.[1]?.replace(/^[["`]|[]"]$/g, "");
}
