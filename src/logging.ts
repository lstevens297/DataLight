import * as vscode from "vscode";

export class DataLightLogger implements vscode.Disposable {
  private readonly output: vscode.OutputChannel;

  public constructor(output: vscode.OutputChannel) {
    this.output = output;
  }

  public log(message: string): void {
    this.output.appendLine(`[DataLight] ${message}`);
  }

  public dispose(): void {
    this.output.dispose();
  }
}
