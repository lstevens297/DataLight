import * as path from "node:path";
import * as vscode from "vscode";

const connectionStatePrefix = "datalight.connection.";
export const sqliteFilePattern = "**/*.{db,sqlite,sqlite3}";

export function getConnectionStateKey(sqlFile: vscode.Uri): string {
  return `${connectionStatePrefix}${sqlFile.toString()}`;
}

export function getConnectionLabel(sqliteFiles: readonly vscode.Uri[], selectedConnection?: vscode.Uri): string {
  if (sqliteFiles.length === 0) {
    return "$(database) Select connection";
  }
  if (selectedConnection) {
    return `$(database) ${path.basename(selectedConnection.fsPath)}`;
  }
  if (sqliteFiles.length === 1) {
    return `$(database) ${path.basename(sqliteFiles[0].fsPath)}`;
  }
  return "$(database) Select connection";
}

export class ConnectionManager implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private sqliteFiles: vscode.Uri[] = [];
  private activeSqlFile?: vscode.Uri;

  public constructor(private readonly state: vscode.Memento) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = "datalight.selectConnection";
    this.statusBarItem.tooltip = "Select the SQLite connection for this SQL file";
  }

  public async refresh(): Promise<void> {
    this.sqliteFiles = await vscode.workspace.findFiles(sqliteFilePattern, "**/node_modules/**");
    await this.updateStatusBar();
  }

  public async updateForSqlFile(sqlFile: vscode.Uri | undefined): Promise<void> {
    this.activeSqlFile = sqlFile;
    await this.updateStatusBar();
  }

  public async selectConnection(): Promise<void> {
    if (!this.activeSqlFile) {
      return;
    }

    await this.refresh();
    const choices = this.sqliteFiles.map((uri) => ({
      label: path.basename(uri.fsPath),
      description: vscode.workspace.asRelativePath(uri),
      uri
    }));
    const selected = await vscode.window.showQuickPick(choices, {
      placeHolder: "Select a SQLite database"
    });
    if (!selected) {
      return;
    }

    await this.state.update(getConnectionStateKey(this.activeSqlFile), selected.uri.toString());
    await this.updateStatusBar();
  }

  public getSelectedConnection(sqlFile: vscode.Uri): vscode.Uri | undefined {
    const storedUri = this.state.get<string>(getConnectionStateKey(sqlFile));
    return storedUri ? vscode.Uri.parse(storedUri) : undefined;
  }

  public getActiveConnection(sqlFile: vscode.Uri): vscode.Uri | undefined {
    return this.getSelectedConnection(sqlFile) ?? (this.sqliteFiles.length === 1 ? this.sqliteFiles[0] : undefined);
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }

  private async updateStatusBar(): Promise<void> {
    const storedConnection = this.activeSqlFile ? this.getSelectedConnection(this.activeSqlFile) : undefined;
    let selectedConnection = storedConnection && this.sqliteFiles.some((uri) => uri.toString() === storedConnection.toString())
      ? storedConnection
      : undefined;
    if (!selectedConnection && this.activeSqlFile && this.sqliteFiles.length === 1) {
      selectedConnection = this.sqliteFiles[0];
      await this.state.update(getConnectionStateKey(this.activeSqlFile), selectedConnection.toString());
    }
    this.statusBarItem.text = getConnectionLabel(this.sqliteFiles, selectedConnection);
    this.statusBarItem.show();
  }
}
