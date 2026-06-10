# Capability: Persistence

ID prefix: `db`

## Purpose

Every session stores its metadata and event stream in SQLite via
`better-sqlite3`. One database serves a consumer process: the CLI opens the
repository database under `data/realtime-agent/`, the VS Code extension
opens one in extension global storage. This capability owns the schema, the
write policy, and the repository APIs — the canonical definition any
compatible reader or writer must follow.

## Requirements

- **[db-1]** WHEN `RealtimeAgentDb.open(config?)` is called, THE library
  SHALL open (creating if absent) the SQLite file at `config.path`,
  defaulting to `DEFAULT_DATABASE_PATH` =
  `<repo root>/data/realtime-agent/realtime-agent.sqlite`; WHERE
  `config.ensureDirectory` is not `false`, it SHALL create the parent
  directory recursively first.
- **[db-2]** WHEN a database opens, THE library SHALL run migrations: the
  idempotent (`CREATE … IF NOT EXISTS`) DDL in Contracts — `sessions`,
  `events`, and the two `events` indexes. `runMigrations(connection)` is
  exported for external connections.
- **[db-3]** WHEN a session is created, THE library SHALL insert a
  `sessions` row with a random UUID `id`, ISO-8601 `created_at`, the system
  prompt, initial context, tool call set name (nullable),
  `tool_names_json` (JSON array of registered tool names),
  `model`, and `session_config_json` (the JSON-serialized `session` object
  from `session.update`); `ended_at` and `ended_reason` start NULL.
- **[db-4]** WHEN a session ends, THE library SHALL set `ended_at`
  (ISO-8601) and `ended_reason` on the row; IF the id does not exist, THEN
  `endSession` SHALL throw `Error("Session not found: <id>")`.
- **[db-5]** THE library SHALL persist every incoming event; THE library
  SHALL persist every outgoing event except `input_audio_buffer.append`
  (`shouldPersistOutgoingEvent` returns false only for that type), in which
  case `persistEvent` returns `null` and nothing is written.
- **[db-6]** THE `events` row SHALL store the session id, ISO-8601
  `created_at`, `direction` (`incoming`/`outgoing`), `event_type`
  (`event.type`), `event_json` (full `JSON.stringify(event)`), and
  `is_audio_buffer_append` (1 only when `event.type` is
  `input_audio_buffer.append` — reachable for incoming events only, given
  db-5).
- **[db-7]** WHEN events are listed for a session (`listEvents`), THE
  library SHALL return them ordered by `created_at` ascending, then `id`
  ascending.
- **[db-8]** THE library SHALL implement no retention or deletion policy:
  databases grow until removed manually. Runtime databases are git-ignored
  ([Logs And Data](../../../../structure/logs-and-data.md)).

## Contracts

### Schema (exact DDL)

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  ended_at TEXT,
  ended_reason TEXT,
  system_prompt TEXT NOT NULL,
  initial_context TEXT NOT NULL,
  tool_call_set_name TEXT,
  tool_names_json TEXT NOT NULL,
  model TEXT NOT NULL,
  session_config_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  direction TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_json TEXT NOT NULL,
  is_audio_buffer_append INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_events_session_created_at ON events(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
```

### API surface

| Export | Behavior |
|---|---|
| `RealtimeAgentDb.open({path?, ensureDirectory?})` | open + migrate (db-1, db-2) |
| `RealtimeAgentDb.getConnection()` / `.close()` | raw `better-sqlite3` handle; close |
| `resolveDatabasePath(config?)` | `config.path ?? DEFAULT_DATABASE_PATH` |
| `runMigrations(connection)` | db-2 DDL |
| `SessionsRepo.createSession(input)` → `SessionRow` | db-3 |
| `SessionsRepo.endSession(id, reason)` → `SessionRow` | db-4 |
| `SessionsRepo.getSession(id)` → `SessionRow \| null` | row mapped to camelCase fields |
| `EventsRepo.persistIncomingEvent(sessionId, event)` → `EventRow` | throws if insert fails |
| `EventsRepo.persistEvent({sessionId, direction, event})` → `EventRow \| null` | db-5, db-6 |
| `EventsRepo.listEvents(sessionId)` → `EventRow[]` | db-7 |
| `shouldPersistOutgoingEvent(event)` | `event.type !== "input_audio_buffer.append"` |

`SessionRow` mirrors the `sessions` columns as
`{id, createdAt, endedAt, endedReason, systemPrompt, initialContext,
toolCallSetName, toolNamesJson, model, sessionConfigJson}`; `EventRow` is
`{id, sessionId, createdAt, direction, eventType, eventJson,
isAudioBufferAppend: boolean}`.

### Database locations

| Consumer | Path |
|---|---|
| CLI | `database_path` from `config/realtime-agent.json` (default `data/realtime-agent/realtime-agent.sqlite`) — see [config](config.md) |
| VS Code extension | `<extension global storage>/realtime-agent.sqlite3` — see [vscode-extension](vscode-extension.md) vsx-8 |

## Design

- `src/agent/src/persistence/db.ts` — lazy `createRequire` load of
  `better-sqlite3` (keeps the native module out of bundlers' static graphs);
  `DEFAULT_DATABASE_PATH` is computed at module load by walking up from the
  module directory to the repo root, so importing the module outside a Sheaf
  checkout throws.
- `src/agent/src/persistence/sessions_repo.ts`,
  `events_repo.ts` — prepared statements; rows re-read after insert.
- Timestamps are `new Date().toISOString()`; event ordering relies on the
  `(created_at, id)` sort, with `id` breaking same-millisecond ties.
- Tests: `tests/agent/persistence/db.test.ts`, `sessions.test.ts`,
  `events.test.ts`.

## Interactions

- [session-lifecycle](session-lifecycle.md) — creates/ends rows; routes
  every event through `EventsRepo`.
- [cli](cli.md) — opens the repo database from config.
- [vscode-extension](vscode-extension.md) — opens the global-storage
  database (storage exception rationale lives there).
