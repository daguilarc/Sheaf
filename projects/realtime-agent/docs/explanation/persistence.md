# Persistence

Realtime Agent stores durable session metadata and events in SQLite.

## CLI database

Path: `data/realtime-agent/realtime-agent.sqlite`

Configured by `database_path` in `config/realtime-agent.json`. Migrations run when
the database opens (`runMigrations` in `src/agent/src/persistence/db.ts`).

### Schema

**sessions** — one row per realtime session:

- Prompt and context text
- Tool call set name and tool name list
- Model and serialized session config JSON
- Created, ended timestamps, and end reason

**events** — ordered incoming and outgoing non-audio events:

- Session id, timestamp, direction, event type, serialized event JSON
- Flag for audio buffer append events (stored but filtered on read in some paths)

### Write policy

| Event | Persisted |
|---|---|
| Incoming API events | always |
| Outgoing non-audio events | yes |
| Outgoing `input_audio_buffer.append` | no |

`shouldPersistOutgoingEvent` in `src/agent/src/persistence/events_repo.ts`
implements the outgoing filter.

No retention or deletion policy is implemented. Databases grow with session history
until manually removed.

## Extension database exception

The VS Code extension uses the same library persistence layer but stores the
database file under extension global storage:

```text
<extension global storage>/realtime-agent.sqlite3
```

The extension does not write session SQLite data into `data/realtime-agent/`.

Rationale:

- Session state belongs to the editor host, not the repository workspace.
- Workspace folder changes should not leave session databases in arbitrary project trees.
- Repository `data/realtime-agent/` stays reserved for CLI and other non-editor runtimes.

When the extension runs in a Sheaf repository workspace, config and JSONL logs
still use repository paths under `config/` and `logs/realtime-agent/`.

## Related docs

- [Data reference](../reference/data.md)
- [Architecture](architecture.md)
