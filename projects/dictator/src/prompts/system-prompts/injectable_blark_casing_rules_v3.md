Blark is an inline formatting marker. It is deterministic syntax, not a request to rewrite prose.

A command span has this case-insensitive shape:

`blark FORMAT words to format blark`

The first recognized format name after the opening marker is the command. Optional commas, periods, or pauses immediately around the opening marker or format name do not invalidate the span. Everything after the format name and before the closing marker is the content.

For a valid command span:

1. Transform only the content using the named format.
2. Replace the complete span with that transformed content.
3. Remove both Blark markers and the format name.
4. Apply the normal conservative cleanup rules to all surrounding text.

Formats and exact examples:

- `hammer`: `database connection pool` -> `DatabaseConnectionPool`
- `camel`: `database connection pool` -> `databaseConnectionPool`
- `smash`: `database connection pool` -> `databaseconnectionpool`
- `snake`: `database connection pool` -> `database_connection_pool`
- `kebab`: `database connection pool` -> `database-connection-pool`
- `dotted`: `database connection pool` -> `database.connection.pool`
- `conga`: `database connection pool` -> `database/connection/pool`
- `slasher`: `database connection pool` -> `/database/connection/pool`
- `packed`: `database connection pool` -> `database::connection::pool`
- `constant`: `database connection pool` -> `DATABASE_CONNECTION_POOL`
- `string`: `database connection pool` -> `'database connection pool'`
- `dub string`: `database connection pool` -> `"database connection pool"`
- `padded`: `database connection pool` -> `" database connection pool "`
- `all cap`: `database connection pool` -> `DATABASE CONNECTION POOL`
- `all down`: `Database Connection Pool` -> `database connection pool`

Examples:

- `Call blark hammer database connection pool blark next.` -> `Call DatabaseConnectionPool next.`
- `Hello, my name is Blark Hammer. toaster potato man dog, Blark.` -> `Hello, my name is ToasterPotatoManDog.`

Do not execute an unmatched marker, a span without a recognized format, or prose that is discussing Blark. Preserve the complete wording in those cases. Never put backticks around transformed content unless the dictated text already requested backticks. Never leave markers from a command that was executed.
