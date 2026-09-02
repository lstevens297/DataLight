import * as vscode from "vscode";
import { DataLightLogger } from "../logging";

export type ResultsMessage =
  | {
      type: "results";
      queryId: string;
      columns: string[];
      rows: Record<string, unknown>[];
      hasMore: boolean;
      totalRows: number;
      booleanColumns?: string[];
      insertTable?: string;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "status";
      message: string;
      affectedRows?: number;
    }
  | {
      type: "toast";
      message: string;
    };

export class ResultsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "datalight.queryResults";
  private webview?: vscode.Webview;

  public constructor(
    private readonly logger?: DataLightLogger,
    private readonly requestNextPage?: (queryId: string) => Promise<void>,
    private readonly extensionUri?: vscode.Uri,
    private readonly exportFile?: (extension: string, content: string) => Promise<void>
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.logger?.log("Query results webview resolved in the bottom panel.");
    this.webview = webviewView.webview;
    webviewView.webview.options = {
      enableScripts: true
    };
    webviewView.webview.html = getResultsHtml(webviewView.webview, this.extensionUri);
    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      if (isReadyMessage(message)) {
        this.logger?.log("Query results webview is ready for query results.");
      } else if (isNextPageMessage(message)) {
        void this.requestNextPage?.(message.queryId);
      } else if (isExportFileMessage(message)) {
        void this.exportFile?.(message.extension, message.content).then(() => {
          void this.webview?.postMessage({ type: "toast", message: "Export complete." });
        });
      }
    });
  }

  public showMessage(message: ResultsMessage): void {
    void this.webview?.postMessage(message);
  }
}

function isReadyMessage(message: unknown): message is { type: "ready" } {
  return typeof message === "object" && message !== null && "type" in message && message.type === "ready";
}

function isNextPageMessage(message: unknown): message is { type: "nextPage"; queryId: string } {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "nextPage" &&
    "queryId" in message &&
    typeof message.queryId === "string"
  );
}

function isExportFileMessage(message: unknown): message is { type: "exportFile"; extension: string; content: string } {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "exportFile" &&
    "extension" in message &&
    typeof message.extension === "string" &&
    "content" in message &&
    typeof message.content === "string"
  );
}

export function getResultsHtml(webview?: vscode.Webview, extensionUri?: vscode.Uri): string {
  const codiconStylesheet = webview && extensionUri
    ? webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "node_modules", "@vscode", "codicons", "dist", "codicon.css")).toString()
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DataLight Query Results</title>
  ${codiconStylesheet ? `<link rel="stylesheet" href="${codiconStylesheet}">` : ""}
  <style>
    html, body { height: 100%; margin: 0; }
    body { box-sizing: border-box; font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px; }
    #toolbar { align-items: center; display: flex; justify-content: space-between; min-height: 24px; }
    #row-count { color: var(--vscode-descriptionForeground); display: none; font-size: 12px; }
    #open-export { display: none; margin: 0; }
    #results { height: calc(100% - 24px); overflow: auto; }
    #loading { display: none; padding: 8px 0; color: var(--vscode-descriptionForeground); }
    #toast { background: var(--vscode-notifications-background); border: 1px solid var(--vscode-notifications-border); bottom: 16px; color: var(--vscode-notifications-foreground); display: none; padding: 8px 12px; position: fixed; right: 16px; z-index: 6; }
    #value-modal { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); box-sizing: border-box; display: none; height: 100%; padding: 12px; position: fixed; right: 0; top: 0; width: min(40vw, 480px); z-index: 5; }
    #value-modal textarea { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); box-sizing: border-box; color: var(--vscode-input-foreground); height: calc(100% - 40px); resize: none; width: 100%; }
    #value-modal button, #export-modal button, #open-export { background: var(--vscode-button-background); border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; color: var(--vscode-button-foreground); cursor: pointer; font-size: 14px; margin-bottom: 8px; padding: 4px 8px; }
    #value-modal button:hover, #export-modal button:hover, #open-export:hover { background: var(--vscode-button-hoverBackground); }
    #value-modal button:focus-visible, #export-modal button:focus-visible, #open-export:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    #export-modal { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); box-sizing: border-box; display: none; height: 100%; padding: 12px; position: fixed; right: 0; top: 0; width: min(40vw, 480px); z-index: 5; }
    #export-modal select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); margin-top: 8px; padding: 4px; width: 100%; }
    #export-actions { bottom: 12px; display: flex; gap: 4px; justify-content: flex-end; position: absolute; right: 12px; }
    table { border-collapse: separate; border-spacing: 0; min-width: 100%; }
    th, td { border-bottom: 1px solid var(--vscode-panel-border); border-right: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; white-space: nowrap; }
    th { background: var(--vscode-editor-background); position: sticky; top: 0; z-index: 2; }
    th:first-child, td:first-child { background: var(--vscode-editor-background); border-left: 1px solid var(--vscode-panel-border); left: 0; position: sticky; width: 3em; z-index: 3; }
    th:first-child { background: var(--vscode-editor-background); z-index: 4; }
    tbody tr:nth-child(even) td, tbody tr:nth-child(even) td:first-child { background: var(--vscode-list-hoverBackground); }
  </style>
</head>
<body>
  <div id="toolbar">
    <div id="row-count"></div>
    <button id="open-export" type="button" aria-label="Export results" title="Export results"><span class="codicon codicon-export"></span></button>
  </div>
  <div id="results">Waiting for a query...</div>
  <div id="loading"></div>
  <div id="toast" role="status"></div>
  <aside id="value-modal" aria-label="Cell value">
    <button id="close-value-modal" type="button" aria-label="Close" title="Close"><span class="codicon codicon-close"></span></button>
    <button id="copy-value" type="button" aria-label="Copy value" title="Copy value"><span class="codicon codicon-copy"></span></button>
    <textarea id="value-text" readonly></textarea>
  </aside>
  <aside id="export-modal" aria-label="Export query results">
    <strong>Export results</strong>
    <select id="export-format" aria-label="Export format">
      <option value="csv">CSV</option>
      <option value="json">JSON</option>
      <option value="xml">XML</option>
      <option value="html">HTML</option>
      <option value="insert" disabled>INSERT statements</option>
      <option value="tsv">Tab-delimited text</option>
    </select>
    <div id="export-actions">
      <button id="export-clipboard" type="button" aria-label="Copy export to clipboard" title="Copy export to clipboard"><span class="codicon codicon-clippy"></span></button>
      <button id="export-file" type="button" aria-label="Export to file" title="Export to file"><span class="codicon codicon-new-file"></span></button>
    </div>
  </aside>
  <script>
    const vscode = acquireVsCodeApi();
    const results = document.getElementById("results");
    const rowCount = document.getElementById("row-count");
    const openExport = document.getElementById("open-export");
    const exportModal = document.getElementById("export-modal");
    const exportFormat = document.getElementById("export-format");
    const exportClipboard = document.getElementById("export-clipboard");
    const exportFile = document.getElementById("export-file");
    let activeColumns = [];
    let activeRows = [];
    let insertTable = "";
    let activeQueryId = "";
    let loading = false;
    let hasMore = false;
    const loadingIndicator = document.getElementById("loading");
    const toast = document.getElementById("toast");
    let toastTimer;
    const showToast = (message) => {
      toast.textContent = message;
      toast.style.display = "block";
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.style.display = "none"; }, 2500);
    };
    const getBlobBytes = (value) => {
      if (value instanceof Uint8Array) {
        return Array.from(value);
      }
      if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
        return value;
      }
      return undefined;
    };
    const formatCellValue = (value, isBoolean = false, expanded = false) => {
      if (value === null || value === undefined) {
        return "NULL";
      }
      if (isBoolean && (value === 0 || value === 1)) {
        return value === 1 ? "true" : "false";
      }
      const blobBytes = getBlobBytes(value);
      if (blobBytes) {
        const size = blobBytes.length < 1024
          ? blobBytes.length + " bytes"
          : (blobBytes.length / 1024).toFixed(blobBytes.length % 1024 === 0 ? 0 : 1) + " kb";
        if (!expanded) {
          return "BLOB (" + size + ")";
        }
        return "X'" + blobBytes.map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase() + "'";
      }
      if (typeof value === "object") {
        return JSON.stringify(value);
      }
      return String(value);
    };
    const renderMessage = (data) => {
      if (data.type !== "results") {
        if (data.type === "toast") {
          showToast(data.message);
          return;
        }
        results.textContent = data.message ?? "No results";
        return;
      }
      if (data.queryId !== activeQueryId) {
        activeQueryId = data.queryId;
        activeColumns = data.columns;
        activeRows = [];
        insertTable = data.insertTable ?? "";
        exportFormat.querySelector('option[value="insert"]').disabled = !insertTable;
        openExport.style.display = "block";
        rowCount.textContent = data.totalRows + (data.totalRows === 1 ? " row" : " rows");
        rowCount.style.display = "block";
        const table = document.createElement("table");
        const header = table.createTHead().insertRow();
        const rowHeader = document.createElement("th");
        rowHeader.scope = "col";
        header.appendChild(rowHeader);
        data.columns.forEach((column) => {
          const cell = document.createElement("th");
          cell.textContent = column;
          cell.scope = "col";
          header.appendChild(cell);
        });
        results.replaceChildren(table);
      }
      const table = results.querySelector("table");
      const body = table?.tBodies[0] ?? table?.createTBody();
      const rowOffset = body?.rows.length ?? 0;
      data.rows.forEach((row, rowIndex) => {
        activeRows.push(row);
        const tableRow = body.insertRow();
        const rowNumber = tableRow.insertCell();
        rowNumber.textContent = String(rowOffset + rowIndex + 1);
        data.columns.forEach((column) => {
          const cell = tableRow.insertCell();
          const isBoolean = data.booleanColumns?.includes(column);
          cell.textContent = formatCellValue(row[column], isBoolean);
          cell.addEventListener("dblclick", () => {
            valueText.value = formatCellValue(row[column], isBoolean, true);
            valueModal.style.display = "block";
            valueText.focus();
            valueText.select();
          });
        });
      });
      loading = false;
      hasMore = data.hasMore;
      loadingIndicator.style.display = "none";
      if (hasMore) {
        loadingIndicator.textContent = "Scroll to load more...";
      } else {
        loadingIndicator.textContent = "End of results";
      }
    };
    const requestNextPage = () => {
      if (!loading && hasMore && activeQueryId) {
        loading = true;
        loadingIndicator.textContent = "Loading...";
        loadingIndicator.style.display = "block";
        vscode.postMessage({ type: "nextPage", queryId: activeQueryId });
      }
    };
    const valueModal = document.getElementById("value-modal");
    const valueText = document.getElementById("value-text");
    document.getElementById("close-value-modal").addEventListener("click", () => {
      valueModal.style.display = "none";
    });
    document.getElementById("copy-value").addEventListener("click", async () => {
      await navigator.clipboard.writeText(valueText.value);
    });
    openExport.addEventListener("click", () => {
      exportModal.style.display = "block";
    });
    const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const quoteDelimited = (value, delimiter) => {
      const text = String(value ?? "");
      return text.includes(delimiter) || text.includes('"') || text.includes("\\n") ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    const getExportContent = () => {
      const format = exportFormat.value;
      if (format === "json") return JSON.stringify(activeRows, (key, value) => getBlobBytes(value) ? formatCellValue(value, false, true) : value, 2);
      if (format === "xml") return "<rows>" + activeRows.map((row) => "<row>" + activeColumns.map((column) => "<" + column + ">" + escapeHtml(getExportValue(row[column])) + "</" + column + ">").join("") + "</row>").join("") + "</rows>";
      if (format === "html") return "<table><thead><tr>" + activeColumns.map((column) => "<th>" + escapeHtml(column) + "</th>").join("") + "</tr></thead><tbody>" + activeRows.map((row) => "<tr>" + activeColumns.map((column) => "<td>" + escapeHtml(getExportValue(row[column])) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
      if (format === "insert") return activeRows.map((row) => "INSERT INTO " + insertTable + " (" + activeColumns.join(", ") + ") VALUES (" + activeColumns.map((column) => sqlValue(row[column])).join(", ") + ");").join("\\n");
      const delimiter = format === "tsv" ? "\t" : ",";
      return [activeColumns.map((column) => quoteDelimited(column, delimiter)).join(delimiter), ...activeRows.map((row) => activeColumns.map((column) => quoteDelimited(getExportValue(row[column]), delimiter)).join(delimiter))].join("\\n");
    };
    const getExportValue = (value) => formatCellValue(value, false, true);
    exportClipboard.addEventListener("click", async () => {
      await navigator.clipboard.writeText(getExportContent());
      exportModal.style.display = "none";
      showToast("Copied to clipboard.");
    });
    exportFile.addEventListener("click", () => {
      const format = exportFormat.value;
      vscode.postMessage({ type: "exportFile", extension: format, content: getExportContent() });
      exportModal.style.display = "none";
    });
    const sqlValue = (value) => value === null || value === undefined ? "NULL" : getBlobBytes(value) ? getExportValue(value) : typeof value === "number" ? String(value) : "'" + String(value).replace(/'/g, "''") + "'";
    window.addEventListener("message", ({ data }) => renderMessage(data));
    document.getElementById("results").addEventListener("scroll", (event) => {
      const container = event.currentTarget;
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 16) {
        requestNextPage();
      }
    });
    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
}
