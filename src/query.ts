import * as vscode from "vscode";

export interface SqlStatement {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export function getStatementAtCursor(document: vscode.TextDocument, selection: vscode.Selection): string {
  const selectedText = document.getText(selection).trim();
  if (selectedText) {
    return selectedText;
  }

  const offset = document.offsetAt(selection.active);
  const statements = getStatements(document.getText());
  const statement = statements.find(({ start, end }) => offset >= start && offset <= end);
  if (statement) {
    return statement.text.trim();
  }

  const line = document.lineAt(selection.active.line);
  const lineStart = document.offsetAt(new vscode.Position(selection.active.line, 0));
  const lineEnd = document.offsetAt(new vscode.Position(selection.active.line, line.text.length));
  return statements.find(({ start, end }) => start <= lineEnd && end >= lineStart)?.text.trim() ?? "";
}

export function getStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let start = 0;
  let quote: string | undefined;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const nextCharacter = sql[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === quote && sql[index + 1] === quote) {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if ((character === "'" || character === "\"" || character === "`") && !quote) {
      quote = character;
    } else if (character === "-" && nextCharacter === "-") {
      lineComment = true;
      index += 1;
    } else if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      index += 1;
    } else if (character === ";") {
      addStatement(statements, sql, start, index);
      start = index + 1;
    }
  }

  addStatement(statements, sql, start, sql.length);
  return statements;
}

function addStatement(statements: SqlStatement[], sql: string, start: number, end: number): void {
  const text = sql.slice(start, end);
  const withoutComments = text.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, "");
  const trimmedText = withoutComments.trim();
  if (trimmedText) {
    const leadingWhitespace = text.search(/\S/);
    const trailingWhitespace = text.search(/\s*$/);
    statements.push({
      text,
      start: start + leadingWhitespace,
      end: start + trailingWhitespace
    });
  }
}
