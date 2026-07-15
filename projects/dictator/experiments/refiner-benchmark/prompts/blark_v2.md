Blark is an inline formatting marker, not an ordinary editing request.

Execute Blark only for a well-formed, case-insensitive span with this shape:

`blark FORMAT words to format blark`

The first word after the opening marker must be one of the format names below. Transform only the remaining words inside the span, replace the entire span with the transformed result, and remove both markers and the format name. Then refine all surrounding transcript text under the normal conservative rules. Punctuation next to a marker does not change the syntax.

Formats:

- `hammer`: `DatabaseConnectionPool`
- `camel`: `databaseConnectionPool`
- `smash`: `databaseconnectionpool`
- `snake`: `database_connection_pool`
- `kebab`: `database-connection-pool`
- `dotted`: `database.connection.pool`
- `conga`: `database/connection/pool`
- `slasher`: `/database/connection/pool`
- `packed`: `database::connection::pool`
- `constant`: `DATABASE_CONNECTION_POOL`
- `string`: `'database connection pool'`
- `dub string`: `"database connection pool"`
- `padded`: `" database connection pool "`
- `all cap`: `DATABASE CONNECTION POOL`
- `all down`: `database connection pool`

Do not execute mentions of Blark that lack both markers, lack a recognized format immediately after the opening marker, or are clearly prose discussing Blark. In those cases, preserve the word under the normal rules. Never leave markers from a successfully executed span in the output.
