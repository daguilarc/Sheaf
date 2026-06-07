# Data Reference

Runtime data paths follow [structure/logs-and-data.md](../../../../structure/logs-and-data.md).

## CLI SQLite database

Default path:

```text
data/realtime-agent/realtime-agent.sqlite
```

Configured by `database_path` in `config/realtime-agent.json`.

The CLI creates the database on first session startup. Migrations run when the
database opens.

### Tables

| Table | Contents |
|---|---|
| `sessions` | One row per realtime session: prompt/context text, tool metadata, model, session config JSON, end timestamps. |
| `events` | Incoming API events and outgoing non-audio events ordered by timestamp and id. |

### Persistence policy

- Incoming API events are always stored.
- Outgoing non-audio events are stored.
- Outgoing `input_audio_buffer.append` events are not stored.
- No retention or deletion policy is implemented.

See [Persistence](../explanation/persistence.md).

## VS Code extension SQLite database

Path:

```text
<extension global storage>/realtime-agent.sqlite3
```

The extension stores session data in VS Code extension global storage
(`context.globalStorageUri`), not under `data/realtime-agent/`.

Rationale:

- Session state is editor-host state scoped by extension identity.
- It survives workspace folder changes without writing into user workspaces.
- Repository `data/realtime-agent/` remains reserved for CLI and other
  non-editor-host runtimes.

When the extension runs against a Sheaf repository workspace, configuration and
structured runtime logs still use repository paths. Only the SQLite session
database is VS Code-owned.

## Generated data and git

Runtime data under `data/realtime-agent/` is generated locally and ignored by
git. Do not commit SQLite files or other session output.

Committed fixtures and sample data belong under `tests/` or `docs/` with clear
labels.
