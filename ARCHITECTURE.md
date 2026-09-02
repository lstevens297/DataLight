# DataLight SQL Executor Extension Architecture

## Purpose

DataLight will be a Visual Studio Code extension for executing SQL from `.sql`
files against a SQLite database. The extension will use plain TypeScript and
will keep the database connection visible in the VS Code status bar.

## Development

Install dependencies with `npm install`, compile with `npm run compile`, and run
the extension-host test suite with `npm test`. Launch the extension host with
the `Run Extension` configuration in `.vscode/launch.json`.

## High-level design

```text
.sql editor
    |
    v
Command / query controller
    |
    +--> SQLite connection service --> sql.js
    |
    +--> Result model
              |
              v
      Query results webview
      (Tabulator spreadsheet view)
```

### Extension host

- **Activation and commands** - Register the extension, SQL execution commands,
  connection commands, and the `.sql` activation events.
- **Query controller** - Reads the active SQL editor or selected SQL, validates
  the execution request, invokes the connection service, and sends results to
  the result view.
- **SQLite connection service** - Owns the `sql.js` database instance, loads or
  creates the configured SQLite database, executes statements, and returns
  columns, rows, affected-row counts, and errors in a stable result model.
- **Connection state** - Tracks the active database and connection status. A
  status bar item displays the current database or a disconnected state and
  opens connection actions when selected.
- **Connection discovery** - Searches the workspace for `.db`, `.sqlite`, and
  `.sqlite3` files. With no database files, or multiple database files without
  a stored choice for the active `.sql` file, the status bar displays
  `Select connection`. A single discovered database is selected
  automatically.

Selections are stored in `ExtensionContext.workspaceState` using a key derived
from each SQL file's URI, so different SQL files in the same workspace can use
different SQLite databases. Clicking the status bar connection control
refreshes workspace discovery before displaying the database picker.

### Query results panel

Query results will appear in the bottom panel alongside Terminal, Output, and
other built-in tabs:

1. Register a `WebviewViewProvider` for the results view.
2. Contribute the view to the `panel` location in `package.json`.
3. Let the provider create and manage the webview HTML.
4. Send query result messages from the extension host to the webview.
5. Render tabular data with Tabulator and send errors or empty-result states
   through the same message contract.

The webview is responsible only for presentation. SQL execution and database
state remain in the extension host.

## Proposed project layout

```text
.
├── src/
│   ├── extension.ts              # Activation and command registration
│   ├── commands/                 # User-invoked command handlers
│   ├── connection/               # SQLite connection and lifecycle
│   ├── query/                    # SQL extraction, execution, and result types
│   ├── statusBar/                # Connection status bar item
│   └── views/
│       └── results/               # Webview provider and webview assets
├── media/                        # Webview JavaScript, CSS, and icons
├── package.json                  # Extension manifest and VS Code contributions
├── tsconfig.json                 # TypeScript compiler configuration
├── ARCHITECTURE.md
├── LICENSE
└── README.md
```

The exact module boundaries may be adjusted as implementation begins, but
database access, query orchestration, status-bar state, and webview rendering
should remain separate responsibilities.

## Core data flow

1. The user opens a `.sql` file and runs the execute command.
2. The query controller obtains the highlighted text, the active statement at
   the cursor, or a query on the cursor's line when neither of those exists.
   `Ctrl+Enter` and the editor-title play button invoke the same command.
3. The connection service executes that statement through `sql.js`.
4. The controller maps the result or error to the result message contract.
5. The results webview renders the message in the bottom panel with Tabulator.
6. The connection state updates the status bar when the active database
   changes or becomes unavailable.

## Message contract

Messages crossing the extension-host/webview boundary should be explicit and
versionable. The initial shape is:

```ts
type ResultsMessage =
  | {
      type: "results";
      columns: string[];
      rows: Record<string, unknown>[];
      totalRows: number;
      hasMore: boolean;
      affectedRows?: number;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "status";
      message: string;
    };
```

The webview must not receive the `sql.js` database object or extension-host
secrets. Values sent to the webview should be serializable.

Non-query statements use a status result instead of an empty table. DML
reports the statement type and affected row count; schema statements report
`Schema updated`.

Row-returning queries are loaded in batches of 200 rows. The extension host
keeps the prepared `sql.js` statement and sends the next batch only after the
webview reports that its results container has reached the bottom. Each result
stream has a query ID so an older stream cannot append to a newer query.
After the final batch, the stream is closed but the webview keeps the rendered
rows and stops requesting additional pages.

## Dependencies and attribution

- **sql.js** is used for SQLite execution in the extension host. It is
  distributed under the MIT License.
- **Tabulator** is used for the spreadsheet-style query result view. It is
  distributed under the MIT License.
- This project is distributed under the MIT License. The repository
  [`LICENSE`](./LICENSE) file contains the project license text. Dependency
  notices and copyright statements must be retained when their source
  distributions are bundled or redistributed.

## Non-goals for the initial architecture

- Supporting non-SQLite database servers.
- Running arbitrary shell commands for database access.
- Persisting query results outside the VS Code extension session.
- Allowing the webview to execute SQL directly.
