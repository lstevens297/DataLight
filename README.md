# DataLight

DataLight is a VS Code extension for running SQL against SQLite databases
without leaving your editor.

## Features

- Run the selected SQL statement with the play button or `Ctrl+Enter`.
- Choose the SQLite connection from the right side of the status bar.
- View results in the DataLight pane alongside Terminal and Output.
- Browse large result sets with batched loading.
- See row counts, SQLite values, BLOB sizes, and boolean values clearly.
- Double-click a cell to inspect and copy its complete value.
- Export results as CSV, JSON, XML, HTML, INSERT statements, or tab-delimited text.

## Getting started

1. Open a folder containing a SQLite database (`.db`, `.sqlite`, or `.sqlite3`).
2. Open or create a `.sql` file.
3. Select a connection in the status bar when more than one database is found.
4. Place the cursor in a query, select a query, and press `Ctrl+Enter`.
5. Review the results in the DataLight pane.

The selected database is remembered separately for each SQL file in the
workspace.

## License and attribution

DataLight is released under the MIT License. It uses the MIT-licensed
[sql.js](https://github.com/sql-js/sql.js) and
[Tabulator](https://github.com/olifolkerd/tabulator) projects.

See [LICENSE](./LICENSE) and [ARCHITECTURE.md](./ARCHITECTURE.md) for project
details.
