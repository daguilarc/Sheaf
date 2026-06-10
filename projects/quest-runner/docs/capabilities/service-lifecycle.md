# Capability: Service Lifecycle

ID prefix: `svc`

## Purpose

Service lifecycle covers the quest-runner process itself: how the long-running
Flask service starts, binds, logs, reports health, and exits; its registration
in the repository service registry `config/services.json`; and how the
`scripts/quest-runner` CLI discovers which base URL to talk to. All other
capabilities ([quest-lifecycle](quest-lifecycle.md),
[dashboard](dashboard.md), [issues](issues.md),
[experiments](experiments.md), [chat-stream](chat-stream.md)) are served by
this one process. Repository-wide service rules:
[Services](../../../../structure/services.md).

## Requirements

### Health and exit

- **[svc-1]** THE service SHALL respond to `GET /health` with `200` and
  `{"healthy": true, "uptime": <seconds since startup, rounded to 2
  decimals>}`. `healthy` is always `true` while the process is running; no
  `warning` field is emitted.
- **[svc-2]** WHEN `POST /exit` is received, THE service SHALL respond `200`
  with `{"status": "exiting"}` and terminate the process approximately 0.1
  seconds later (after the response is flushed).

### Startup and binding

- **[svc-3]** THE service SHALL start via `python -m quest_runner_service`,
  binding the HTTP server to `--host` (default `0.0.0.0`) and `--port`
  (default `9002`).
- **[svc-4]** THE service SHALL operate on the repository checkout that
  contains its own source tree (the checkout root is derived from the
  package location, not from the working directory): quests are read from
  and written to that checkout's `projects/` tree and logs to its `logs/`
  tree.
- **[svc-5]** WHEN started with `start_quest_runner.sh` (equivalently
  `make -C projects/quest-runner run` or repo-root
  `make quest-runner-run`), THE launcher SHALL create
  `projects/quest-runner/.venv` if missing, install `requirements.txt` into
  it, and exec the service on port `9002` with stdout and stderr appended to
  `logs/quest-runner/quest_runner_stdout.log` and
  `logs/quest-runner/quest_runner_stderr.log`.
- **[svc-6]** THE service SHALL write its application log to
  `logs/quest-runner/quest-runner.log` (INFO level, rotated at 10 MiB with 5
  backups) and SHALL log every HTTP request as `HTTP <METHOD> <path>`.

### Registry

- **[svc-7]** THE repository registry `config/services.json` SHALL contain a
  quest-runner entry of the form below; registry field semantics and the
  required-endpoint rules are defined in
  [Services](../../../../structure/services.md).

  ```json
  {
    "name": "quest-runner",
    "host": "0.0.0.0",
    "port": 9002,
    "home_path": "/dashboard",
    "command": "make quest-runner-run"
  }
  ```

### CLI base-URL resolution

- **[svc-8]** THE CLI SHALL resolve the service base URL from the first
  available source, in order: the `--base-url <url>` flag; the
  `QUEST_RUNNER_URL` environment variable (ignored when blank); the
  `quest-runner` entry of `config/services.json` as
  `http://<host>:<port>`; and finally the fallback
  `http://localhost:9002`. Trailing slashes are stripped.
- **[svc-9]** WHEN the `services.json` entry's host is `0.0.0.0`, THE CLI
  SHALL connect to `localhost` at the configured port.
- **[svc-10]** THE CLI SHALL locate `config/services.json` by walking up the
  parent directories of the invoked CLI script's resolved path. IF the file
  is missing, unparseable, not a JSON array, lacks a `quest-runner` entry, or
  the entry lacks `host`/`port`, THEN THE CLI SHALL use the fallback URL.
- **[svc-11]** WHEN the fallback URL is used, THE CLI SHALL print a warning
  to stderr naming the fallback, unless `--json` is active.
- **[svc-12]** IF a request cannot reach the service, THEN THE CLI SHALL
  print `transport error: <reason>` plus the attempted `base_url` and
  `endpoint` to stderr and exit `1`.

### CLI dispatcher

- **[svc-13]** THE repo-root dispatcher `scripts/quest-runner` SHALL select a
  Python ≥ 3.10 interpreter from, in order: `$QUEST_RUNNER_PYTHON`,
  `projects/quest-runner/.venv/bin/python` in the current checkout, and —
  when running inside a linked git worktree — the main checkout's
  `projects/quest-runner/.venv/bin/python`; it SHALL exec
  `projects/quest-runner/bin/quest-runner` with that interpreter. IF no
  compatible interpreter is found, THEN it SHALL print the tried paths and
  exit `1`.

## Contracts

### `GET /health`

Response `200`:

```json
{
  "healthy": true,
  "uptime": 123.45
}
```

### `POST /exit`

No request body required. Response `200`:

```json
{
  "status": "exiting"
}
```

### Service process flags

`python -m quest_runner_service [--port <int>] [--host <addr>]` — defaults
`9002` and `0.0.0.0`. These are the only process flags; there is no flag for
the repository root (svc-4).

### CLI global flags

| Flag | Effect |
| --- | --- |
| `--base-url <url>` | Highest-precedence base URL override (svc-8). |
| `--json` | Raw JSON output; also suppresses the fallback warning (svc-11). |

Environment: `QUEST_RUNNER_URL` (CLI base URL, svc-8);
`QUEST_RUNNER_PYTHON` (dispatcher interpreter override, svc-13).

Registry entry shape: see svc-7 and
[Services](../../../../structure/services.md).

## Design

The entry point is
`src/quest_runner_service/__main__.py:main`: it parses `--port`/`--host`,
derives the source repo root as the fourth parent of the package directory
(`_resolve_source_repo_root` — `src/quest_runner_service/` sits at
`projects/quest-runner/src/quest_runner_service/`), configures logging via
`src/quest_runner_service/logging_config.py:configure_service_logging`,
constructs one `QuestService` with a fresh in-process `QuestLock`, and serves
the Flask app from `src/quest_runner_service/api.py:create_app` with Flask's
built-in server. `create_app` takes a `shutdown_callback`; `__main__` passes
a 0.1-second `threading.Timer` around `os._exit(0)` so `/exit` can answer
before dying (the API has an equivalent inline fallback when no callback is
injected, used by tests).

Because the service holds run locks, run tracking, and deferred re-run
schedules purely in memory, a restart forgets active-run bookkeeping and any
scheduled deferred runs; durable quest state lives only in the git checkouts
(see [quest-lifecycle](quest-lifecycle.md)). The service does not read
`config/services.json` on boot — its port comes from the start script — so the
registry and the launcher must agree on `9002`.

`start_quest_runner.sh` (project root) owns venv bootstrap and stdout/stderr
redirection; `projects/quest-runner/Makefile` target `run` and repo-root
`Makefile` target `quest-runner-run` are thin wrappers over it.

CLI URL resolution is `src/quest_runner_service/cli.py:resolve_base_url`,
with `_find_repo_root` anchoring the `services.json` walk at
`Path(sys.argv[0]).resolve()` — anchoring at the script rather than the
working directory means the CLI finds its own repository's registry even when
invoked from elsewhere. `_normalize_host` maps `0.0.0.0` to `localhost`.
Transport is stdlib `urllib` (`default_request`); HTTP error bodies are
parsed as JSON when possible, else wrapped as `{"error": <text>}`. The
dispatcher logic, including the linked-worktree venv fallback via
`git rev-parse --git-common-dir`, is `scripts/quest-runner`.

Tests: `tests/test_service_entrypoint.py` (health, exit, entry point),
`tests/test_cli.py` (URL resolution, transport errors, output modes).

## Interactions

- [quest-lifecycle](quest-lifecycle.md) — all lifecycle endpoints and the
  CLI commands ride on this process and its URL resolution.
- [dashboard](dashboard.md) — the SPA and data API are served by the same
  process; `home_path` `/dashboard` in the registry points at it.
- [chat-stream](chat-stream.md) — the WebSocket route is registered on the
  same Flask app via flask-sock.
- [issues](issues.md), [experiments](experiments.md),
  [slices](slices.md) — their HTTP APIs are hosted here.
- Repository rules: [Services](../../../../structure/services.md)
  (registry format, required endpoints),
  [Logs And Data](../../../../structure/logs-and-data.md) (runtime log
  locations).
