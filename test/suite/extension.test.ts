import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as vscode from "vscode";
import { getConnectionLabel, getConnectionStateKey, sqliteFilePattern } from "../../src/connectionManager";
import { createResultsViewProvider } from "../../src/extension";
import { DataLightLogger } from "../../src/logging";
import { getStatementAtCursor, getStatements } from "../../src/query";
import { SqliteExecutor } from "../../src/sqliteExecutor";
import { getResultsHtml, ResultsViewProvider } from "../../src/views/resultsView";

suite("DataLight extension", () => {
  test("labels connection status for zero, one, and multiple databases", () => {
    const sqlFile = vscode.Uri.file("/workspace/query.sql");
    const firstDatabase = vscode.Uri.file("/workspace/data.sqlite");
    const secondDatabase = vscode.Uri.file("/workspace/archive.db");

    assert.equal(getConnectionLabel([]), "$(database) Select connection");
    assert.equal(getConnectionLabel([firstDatabase]), "$(database) data.sqlite");
    assert.equal(getConnectionLabel([firstDatabase, secondDatabase]), "$(database) Select connection");
    assert.equal(getConnectionLabel([firstDatabase, secondDatabase], secondDatabase), "$(database) archive.db");
    assert.equal(getConnectionLabel([], firstDatabase), "$(database) Select connection");
    assert.match(getConnectionStateKey(sqlFile), /datalight\.connection\./);
    assert.equal(sqliteFilePattern, "**/*.{db,sqlite,sqlite3}");
  });

  test("selects the highlighted statement or the statement at the cursor", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "sql",
      content: "SELECT 1;\n\nSELECT 2;\n"
    });
    const statements = getStatements(document.getText());

    assert.equal(statements.length, 2);
    assert.equal(
      getStatementAtCursor(document, new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0))),
      "SELECT 1"
    );
    assert.equal(
      getStatementAtCursor(document, new vscode.Selection(new vscode.Position(2, 0), new vscode.Position(2, 0))),
      "SELECT 2"
    );
    assert.equal(
      getStatementAtCursor(document, new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 8))),
      "SELECT 1"
    );

    const trailingCommentDocument = await vscode.workspace.openTextDocument({
      language: "sql",
      content: "SELECT 1; -- place the cursor here\n"
    });
    assert.equal(
      getStatementAtCursor(
        trailingCommentDocument,
        new vscode.Selection(new vscode.Position(0, 32), new vscode.Position(0, 32))
      ),
      "SELECT 1"
    );

    const blankLineDocument = await vscode.workspace.openTextDocument({
      language: "sql",
      content: "SELECT * FROM table_10_columns;\n\nSELECT * FROM table_20_columns;\n"
    });
    assert.equal(
      getStatementAtCursor(blankLineDocument, new vscode.Selection(new vscode.Position(1, 0), new vscode.Position(1, 0))),
      ""
    );
  });

  test("executes SQLite queries with sql.js", async () => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "datalight-"));
    const databasePath = path.join(directory, "test.sqlite");
    const executor = new SqliteExecutor(path.join(process.cwd()));

    try {
      const createResult = await executor.execute(databasePath, "CREATE TABLE items (id INTEGER, name TEXT);");
      const insertResult = await executor.execute(databasePath, "INSERT INTO items VALUES (1, 'one');");
      const result = await executor.execute(databasePath, "SELECT * FROM items;");

      assert.deepEqual(createResult, {
        type: "status",
        message: "Schema updated"
      });
      assert.deepEqual(insertResult, {
        type: "status",
        message: "INSERT executed successfully. Rows affected: 1",
        affectedRows: 1
      });
      assert.deepEqual(result, {
        type: "results",
        queryId: "query-3",
        columns: ["id", "name"],
        rows: [{ id: 1, name: "one" }],
        hasMore: false,
        totalRows: 1
      });
    } finally {
      await executor.dispose();
      await fsPromises.rm(directory, { recursive: true, force: true });
    }
  });

  test("loads query results in batches of 200 rows", async () => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "datalight-batch-"));
    const databasePath = path.join(directory, "batch.sqlite");
    const executor = new SqliteExecutor(path.join(process.cwd()));

    try {
      const firstBatch = await executor.execute(
        databasePath,
        "WITH RECURSIVE numbers(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM numbers WHERE value < 450) SELECT value FROM numbers;"
      );
      assert.equal(firstBatch.type, "results");
      if (firstBatch.type !== "results") {
        return;
      }
      assert.equal(firstBatch.rows.length, 200);
      assert.equal(firstBatch.hasMore, true);

      const secondBatch = await executor.nextBatch(firstBatch.queryId);
      assert.equal(secondBatch.type, "results");
      if (secondBatch.type !== "results") {
        return;
      }
      assert.equal(secondBatch.rows.length, 200);
      assert.equal(secondBatch.hasMore, true);

      const finalBatch = await executor.nextBatch(firstBatch.queryId);
      assert.equal(finalBatch.type, "results");
      if (finalBatch.type !== "results") {
        return;
      }
      assert.equal(finalBatch.rows.length, 50);
      assert.equal(finalBatch.hasMore, false);
    } finally {
      await executor.dispose();
      await fsPromises.rm(directory, { recursive: true, force: true });
    }
  });

  test("keeps a result set smaller than 200 rows in the first batch", async () => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "datalight-small-batch-"));
    const databasePath = path.join(directory, "small-batch.sqlite");
    const executor = new SqliteExecutor(path.join(process.cwd()));

    try {
      const result = await executor.execute(
        databasePath,
        "WITH sample(value) AS (VALUES (1), (2), (3)) SELECT value FROM sample;"
      );

      assert.deepEqual(result, {
        type: "results",
        queryId: "query-1",
        columns: ["value"],
        rows: [{ value: 1 }, { value: 2 }, { value: 3 }],
        hasMore: false,
        totalRows: 3
      });

      if (result.type === "results") {
        assert.deepEqual(await executor.nextBatch(result.queryId), {
          type: "error",
          message: "This query result is no longer available."
        });
      }
    } finally {
      await executor.dispose();
      await fsPromises.rm(directory, { recursive: true, force: true });
    }
  });

  test("contributes the results webview to the panel location", () => {
    const manifestPath = path.join(vscode.extensions.getExtension("datalight.datalight")?.extensionPath ?? "", "package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      contributes: {
        views: { datalightPanel: Array<{ id: string; type: string }> };
        viewsContainers: { panel: Array<{ id: string; title: string; icon: string }> };
        menus: { "editor/title": Array<{ command: string; group: string; when: string }> };
        keybindings: Array<{ command: string; key: string; when: string }>;
      };
    };
    const panelContainers = manifest.contributes.viewsContainers.panel;
    assert.ok(panelContainers.some((container) => container.id === "datalightPanel"));
    assert.deepEqual(manifest.contributes.views.datalightPanel, [
      { id: ResultsViewProvider.viewType, name: "DataLight Query Results", type: "webview" }
    ]);
    assert.deepEqual(manifest.contributes.menus["editor/title"], [
      { command: "datalight.executeQuery", group: "navigation@1", when: "editorLangId == sql" }
    ]);
    assert.deepEqual(manifest.contributes.keybindings, [
      { command: "datalight.executeQuery", key: "ctrl+enter", when: "editorLangId == sql" }
    ]);
  });

  test("creates an empty provider until query results arrive", async () => {
    const provider = createResultsViewProvider();
    let html = "";
    let postedMessage: unknown;
    let receiveMessage: ((message: unknown) => void) | undefined;
    const loggedMessages: string[] = [];
    const logger = {
      log: (message: string) => loggedMessages.push(message)
    } as unknown as DataLightLogger;
    const webview = {
      options: {},
      html,
      onDidReceiveMessage: (handler: (message: unknown) => void) => {
        receiveMessage = handler;
        return { dispose: () => undefined };
      },
      postMessage: async (message: unknown) => {
        postedMessage = message;
        return true;
      }
    } as unknown as vscode.Webview;

    new ResultsViewProvider(logger).resolveWebviewView({ webview } as vscode.WebviewView);

    html = webview.html;
    assert.match(html, /DataLight Query Results/);
    assert.match(html, /acquireVsCodeApi/);
    assert.match(html, /addEventListener\("message"/);
    assert.match(html, /position: sticky/);
    assert.match(html, /th \{ background: var\(--vscode-editor-background\); position: sticky/);
    assert.match(html, /th:first-child \{ background: var\(--vscode-editor-background\); z-index: 4; \}/);
    assert.match(html, /tbody tr:nth-child\(even\) td, tbody tr:nth-child\(even\) td:first-child \{ background: var\(--vscode-list-hoverBackground\); \}/);
    assert.match(html, /value instanceof Uint8Array/);
    assert.match(html, /return "NULL"/);
    assert.match(html, /padStart\(2, "0"\)/);
    assert.match(html, /cell.textContent = formatCellValue\(row\[column\], isBoolean\)/);
    assert.match(html, /value === 1 \? "true" : "false"/);
    assert.match(html, /dblclick/);
    assert.match(html, /right: 0; top: 0/);
    assert.match(html, /return "BLOB \(" \+ size \+ "\)"/);
    assert.match(html, /expanded/);
    assert.match(html, /navigator.clipboard.writeText\(valueText.value\)/);
    assert.match(html, /getExportValue\(row\[column\]\)/);
    assert.match(html, /formatCellValue\(value, false, true\)/);
    assert.match(html, /class="codicon codicon-close"/);
    assert.match(html, /class="codicon codicon-copy"/);
    assert.match(html, /background: var\(--vscode-button-background\)/);
    assert.match(html, /background: var\(--vscode-button-hoverBackground\)/);
    assert.match(html, /var\(--vscode-button-foreground\)/);
    assert.match(html, /Copied to clipboard/);
    assert.match(html, /role="status"/);
    assert.match(html, /clearTimeout\(toastTimer\)/);
    assert.match(html, /html, body \{ height: 100%; margin: 0; \}/);
    assert.match(html, /#results \{ height: calc\(100% - 24px\); overflow: auto; \}/);
    assert.match(html, /#row-count \{ color: var\(--vscode-descriptionForeground\); display: none;/);
    assert.match(html, /rowCount\.textContent = data\.totalRows/);
    assert.match(html, /<div id="toolbar">\s+<div id="row-count"><\/div>/);
    assert.match(html, /class="codicon codicon-export"/);
    assert.match(html, /class="codicon codicon-clippy"/);
    assert.match(html, /class="codicon codicon-new-file"/);
    assert.match(html, /text\.includes\("\\n"\)/);
    assert.doesNotMatch(html, /text\.includes\("\n"\)/);
    assert.match(html, /\.join\("\\n"\)/);
    assert.doesNotMatch(html, /\.join\("\n"\)/);
    assert.doesNotMatch(html, /rowHeader.textContent = "#"/);
    assert.match(html, /rowNumber.textContent = String\(rowOffset \+ rowIndex \+ 1\)/);
    assert.match(html, /if \(!loading && hasMore && activeQueryId\)/);
    assert.equal(postedMessage, undefined);

    receiveMessage?.({ type: "ready" });
    assert.equal(postedMessage, undefined);
    assert.deepEqual(loggedMessages, [
      "Query results webview resolved in the bottom panel.",
      "Query results webview is ready for query results."
    ]);
  });

  test("builds a self-contained results document", () => {
    const html = getResultsHtml();
    assert.match(html, /Waiting for a query/);
    assert.match(html, /createTHead/);
  });
});
