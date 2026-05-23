# Physical Plan: SQLite Persistence

## Objective

Implement durable SQLite persistence for realtime sessions and events, including idempotent schema initialization and repository APIs used by the agent loop. This slice should be testable without a realtime network connection.

Expected outcome:

- `data/realtime-agent.sqlite` is the default database path for runtime use.
- Tests can use temporary database paths without touching runtime data.
- `sessions` and `events` tables match the spec exactly.
- All incoming events and outgoing non-audio events can be persisted.
- Outgoing `input_audio_buffer.append` events are explicitly classified as non-persisted.

## Key Files and Systems

- Add `apps/realtime-agent/src/persistence/db.ts`.
- Add `apps/realtime-agent/src/persistence/sessions_repo.ts`.
- Add `apps/realtime-agent/src/persistence/events_repo.ts`.
- Add persistence exports in `apps/realtime-agent/src/index.ts`.
- Extend `apps/realtime-agent/src/types.ts` with persistence row/input types.
- Add tests under `apps/realtime-agent/test/persistence/`.
- Add `apps/realtime-agent/data/.gitkeep` if needed, while keeping generated `.sqlite` files ignored.
- Update `.gitignore` to ignore `apps/realtime-agent/data/*.sqlite`, `*.sqlite-shm`, and `*.sqlite-wal` for this app.

## Existing APIs to Reuse As-Is

- Reuse `EventDirection` and `RealtimeEvent` types from slice 0001.
- Reuse Node `crypto.randomUUID()` for session IDs instead of introducing a UUID dependency.
- Reuse the package's configured test runner and TypeScript build pipeline.

## APIs to Define or Extend

Define `DatabaseConfig`:

- `path?: string`, defaulting to `apps/realtime-agent/data/realtime-agent.sqlite` when called by runtime wiring.
- `ensureDirectory?: boolean`, defaulting to true for runtime and false/explicit for tests if useful.

Define `RealtimeAgentDb` or equivalent:

- Opens a SQLite connection.
- Runs idempotent migrations at startup.
- Closes cleanly.

Define session repository APIs:

- `createSession(input)` inserts `id`, `created_at`, `system_prompt`, `initial_context`, nullable `tool_call_set_name`, `tool_names_json`, `model`, and `session_config_json`.
- `endSession(sessionId, endedReason)` sets `ended_at` and `ended_reason`.
- `getSession(sessionId)` returns a typed row for tests and future debugging.

Define event repository APIs:

- `persistEvent({ sessionId, direction, event })` stores event type and JSON for all allowed persisted events.
- `shouldPersistOutgoingEvent(event)` returns false only for `input_audio_buffer.append`.
- `persistIncomingEvent(event)` always persists.
- `listEvents(sessionId)` for tests.

The `events` schema must include:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE`
- `created_at TEXT NOT NULL`
- `direction TEXT NOT NULL`
- `event_type TEXT NOT NULL`
- `event_json TEXT NOT NULL`
- `is_audio_buffer_append INTEGER NOT NULL DEFAULT 0`

Indexes:

- `events(session_id, created_at)`
- `events(event_type)`

## Enabling Refactor

If the selected SQLite package has synchronous APIs, wrap them behind repository classes now so later asynchronous agent code does not depend on a concrete driver. Keep the wrapper small; do not introduce a generic ORM or migration framework.

## Validation

- Unit tests create a temp database and verify idempotent migration by opening twice.
- Unit tests verify the exact table columns and indexes.
- Unit tests verify session insert/end behavior and JSON fields.
- Unit tests verify incoming events persist regardless of type.
- Unit tests verify outgoing non-audio events persist.
- Unit tests verify outgoing `input_audio_buffer.append` is skipped by the policy.
- `npm run build` and `npm test` pass in `apps/realtime-agent`.

## Sequencing Notes

This slice depends on slice 0001. It should be completed before realtime transport and agent-loop work so those slices can persist events through stable repository APIs instead of writing direct SQL.
