# Dictator Service

Dictator is a registered Sheaf long-running service.

## Registry entry

In `config/services.json`:

```json
{
  "name": "dictator",
  "host": "0.0.0.0",
  "port": 9003,
  "home_path": "/",
  "command": "make dictator-run"
}
```

| Field | Value |
|-------|-------|
| Name | `dictator` |
| Port | `9003` |
| Home path | `/` (web UI root) |
| Start command | `make dictator-run` |

## Starting and stopping

From the Sheaf repository root:

```bash
make dictator-run
```

Clean shutdown:

```bash
curl -X POST http://127.0.0.1:9003/exit
```

Health probe:

```bash
curl http://127.0.0.1:9003/health
```

## Logs

Runtime logs write under:

```text
logs/dictator/
```

The primary trace file is `logs/dictator/trace.log`. Log files are git-ignored runtime output.

## Data

Runtime interaction history persists under:

```text
data/dictator/
```

See [Data](data.md) for the on-disk layout.

## Shutdown behavior

`POST /exit` triggers an orderly server stop: the HTTP listener shuts down, in-flight dictation requests complete or fail according to normal handler behavior, and the process exits. Repeated `/exit` calls are idempotent after the first shutdown has started.
