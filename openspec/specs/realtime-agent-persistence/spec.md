# Capability: Persistence

Project: `projects/realtime-agent`
ID prefix: `db` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Every session stores its metadata and event stream in SQLite via
`better-sqlite3`. One database serves a consumer process: the CLI opens the
repository database under `data/realtime-agent/`, the VS Code extension
opens one in extension global storage. This capability owns the schema, the
write policy, and the repository APIs — the canonical definition any
compatible reader or writer must follow.

## Requirements

### Requirement: db-1 — Open database at configured path
WHEN `RealtimeAgentDb.open(config?)` is called, THE library SHALL open (creating if absent) the SQLite file at `config.path`, defaulting to `DEFAULT_DATABASE_PATH` = `<repo root>/data/realtime-agent/realtime-agent.sqlite`; WHERE `config.ensureDirectory` is not `false`, it SHALL create the parent directory recursively first.

#### Scenario: Open with default path
- **WHEN** `RealtimeAgentDb.open()` is called without a config path
- **THEN** the library opens (creating if absent) the SQLite file at `DEFAULT_DATABASE_PATH` = `<repo root>/data/realtime-agent/realtime-agent.sqlite`

#### Scenario: Open with custom path
- **WHEN** `RealtimeAgentDb.open(config)` is called with a `config.path`
- **THEN** the library opens (creating if absent) the SQLite file at `config.path`

#### Scenario: ensureDirectory enabled
- **WHEN** `config.ensureDirectory` is not `false`
- **THEN** the library creates the parent directory recursively before opening the database

### Requirement: db-2 — Run migrations on open
WHEN a database opens, THE library SHALL run migrations: the idempotent (`CREATE … IF NOT EXISTS`) DDL in Contracts — `sessions`, `events`, and the two `events` indexes. `runMigrations(connection)` is exported for external connections.

#### Scenario: Database opens
- **WHEN** a database opens
- **THEN** the library runs the idempotent DDL creating the `sessions` table, `events` table, and the two `events` indexes

### Requirement: db-3 — Insert sessions row on session creation
WHEN a session is created, THE library SHALL insert a `sessions` row with a random UUID `id`, ISO-8601 `created_at`, the system prompt, initial context, tool call set name (nullable), `tool_names_json` (JSON array of registered tool names), `model`, and `session_config_json` (the JSON-serialized `session` object from `session.update`); `ended_at` and `ended_reason` start NULL.

#### Scenario: Session created
- **WHEN** a session is created
- **THEN** a `sessions` row is inserted with a random UUID `id`, ISO-8601 `created_at`, the system prompt, initial context, tool call set name (nullable), `tool_names_json`, `model`, and `session_config_json`; `ended_at` and `ended_reason` start NULL

### Requirement: db-4 — Update sessions row on session end
WHEN a session ends, THE library SHALL set `ended_at` (ISO-8601) and `ended_reason` on the row; IF the id does not exist, THEN `endSession` SHALL throw `Error("Session not found: <id>")`.

#### Scenario: Session ends with known id
- **WHEN** a session ends and the session id exists
- **THEN** the library sets `ended_at` (ISO-8601) and `ended_reason` on the sessions row

#### Scenario: Session ends with unknown id
- **WHEN** `endSession` is called with an id that does not exist
- **THEN** `endSession` throws `Error("Session not found: <id>")`

### Requirement: db-5 — Persist incoming and filtered outgoing events
THE library SHALL persist every incoming event; THE library SHALL persist every outgoing event except `input_audio_buffer.append` (`shouldPersistOutgoingEvent` returns false only for that type), in which case `persistEvent` returns `null` and nothing is written.

#### Scenario: Incoming event received
- **WHEN** an incoming event is received
- **THEN** the library persists the event

#### Scenario: Outgoing event that is not input_audio_buffer.append
- **WHEN** an outgoing event with a type other than `input_audio_buffer.append` is transmitted
- **THEN** the library persists the event

#### Scenario: Outgoing input_audio_buffer.append event
- **WHEN** an outgoing `input_audio_buffer.append` event is transmitted
- **THEN** `persistEvent` returns `null` and nothing is written

### Requirement: db-6 — Events row columns
THE `events` row SHALL store the session id, ISO-8601 `created_at`, `direction` (`incoming`/`outgoing`), `event_type` (`event.type`), `event_json` (full `JSON.stringify(event)`), and `is_audio_buffer_append` (1 only when `event.type` is `input_audio_buffer.append` — reachable for incoming events only, given db-5).

#### Scenario: Event row persisted
- **WHEN** an event is persisted
- **THEN** the `events` row stores the session id, ISO-8601 `created_at`, `direction`, `event_type`, `event_json`, and `is_audio_buffer_append` (1 only when `event.type` is `input_audio_buffer.append`)

### Requirement: db-7 — List events ordered by created_at then id
WHEN events are listed for a session (`listEvents`), THE library SHALL return them ordered by `created_at` ascending, then `id` ascending.

#### Scenario: Events listed
- **WHEN** `listEvents(sessionId)` is called
- **THEN** the library returns the events ordered by `created_at` ascending, then `id` ascending

### Requirement: db-8 — No retention or deletion policy
THE library SHALL implement no retention or deletion policy: databases grow until removed manually. Runtime databases are git-ignored ([Logs And Data](../../../structure/logs-and-data.md)).

#### Scenario: Database accumulates events
- **WHEN** events and sessions are persisted over time
- **THEN** the library does not remove or expire any rows; databases grow until removed manually

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
| CLI | `database_path` from `config/realtime-agent.json` (default `data/realtime-agent/realtime-agent.sqlite`) — see [config](../realtime-agent-config/spec.md) |
| VS Code extension | `<extension global storage>/realtime-agent.sqlite3` — see [vscode-extension](../realtime-agent-vscode-extension/spec.md) vsx-8 |

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

- [session-lifecycle](../realtime-agent-session-lifecycle/spec.md) — creates/ends rows; routes
  every event through `EventsRepo`.
- [cli](../realtime-agent-cli/spec.md) — opens the repo database from config.
- [vscode-extension](../realtime-agent-vscode-extension/spec.md) — opens the global-storage
  database (storage exception rationale lives there).
