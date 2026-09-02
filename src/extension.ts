import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import { ConnectionManager } from "./connectionManager";
import { DataLightLogger } from "./logging";
import { getStatementAtCursor } from "./query";
import { ResultsViewProvider } from "./views/resultsView";
import { SqliteExecutor } from "./sqliteExecutor";

export function activate(context: vscode.ExtensionContext): void {
  const logger = new DataLightLogger(vscode.window.createOutputChannel("DataLight"));
  const connections = new ConnectionManager(context.workspaceState);
  const executor = new SqliteExecutor(context.extensionPath);
  let provider: ResultsViewProvider;
  provider = new ResultsViewProvider(logger, async (queryId) => {
    provider.showMessage(await executor.nextBatch(queryId));
  }, context.extensionUri, async (extension, content) => {
    const uri = await vscode.window.showSaveDialog({ saveLabel: "Export", filters: { [extension.toUpperCase()]: [extension] } });
    if (uri) {
      await fs.writeFile(uri.fsPath, content, "utf8");
    }
  });
  logger.log("Extension activated; query results are registered in the bottom panel.");
  void connections.refresh();
  void connections.updateForSqlFile(getSqlFile(vscode.window.activeTextEditor));

  context.subscriptions.push(
    logger,
    connections,
    { dispose: () => void executor.dispose() },
    vscode.window.registerWebviewViewProvider(ResultsViewProvider.viewType, provider),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void connections.updateForSqlFile(getSqlFile(editor));
    }),
    vscode.commands.registerCommand("datalight.selectConnection", () => connections.selectConnection()),
    vscode.commands.registerCommand("datalight.executeQuery", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "sql") {
        await vscode.window.showWarningMessage("Open a SQL file before executing a query.");
        return;
      }
      const connection = connections.getActiveConnection(editor.document.uri);
      if (!connection) {
        await vscode.window.showWarningMessage("Select a SQLite connection before executing a query.");
        return;
      }
      const statement = getStatementAtCursor(editor.document, editor.selection);
      if (!statement) {
        await vscode.window.showWarningMessage("No SQL statement found at the cursor.");
        return;
      }
      try {
        provider.showMessage(await executor.execute(connection.fsPath, statement));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.log(`Query execution failed: ${message}`);
        provider.showMessage({ type: "error", message });
      }
    })
  );
}

export function createResultsViewProvider(): ResultsViewProvider {
  return new ResultsViewProvider();
}

function getSqlFile(editor: vscode.TextEditor | undefined): vscode.Uri | undefined {
  return editor?.document.languageId === "sql" ? editor.document.uri : undefined;
}

export function deactivate(): void {}
