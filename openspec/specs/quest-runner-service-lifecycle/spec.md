# Capability: Service Lifecycle

Project: `projects/quest-runner`
ID prefix: `svc` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Service lifecycle covers the quest-runner process itself: how the long-running
Flask service starts, binds, logs, reports health, and exits; its registration
in the repository service registry `config/services.json`; and how the
`scripts/quest-runner` CLI discovers which base URL to talk to. All other
capabilities ([quest-lifecycle](../quest-runner-quest-lifecycle/spec.md),
[dashboard](../quest-runner-dashboard/spec.md), [issues](../quest-runner-issues/spec.md),
[experiments](../quest-runner-experiments/spec.md), [chat-stream](../quest-runner-chat-stream/spec.md)) are served by
this one process. Repository-wide service rules:
[Services](../../../structure/services.md).
## Requirements
### Requirement: svc-1 — Health and exit: health endpoint
THE service SHALL respond to `GET /health` with `200` and `{"healthy": true, "uptime": <seconds since startup, rounded to 2 decimals>}`. `healthy` is always `true` while the process is running; no `warning` field is emitted.

#### Scenario: Health check
- **WHEN** `GET /health` is received
- **THEN** the service responds `200` with `{"healthy": true, "uptime": <seconds since startup, rounded to 2 decimals>}` and no `warning` field

### Requirement: svc-2 — Health and exit: exit endpoint
WHEN `POST /exit` is received, THE service SHALL respond `200` with `{"status": "exiting"}` and terminate the process approximately 0.1 seconds later (after the response is flushed).

#### Scenario: Exit requested
- **WHEN** `POST /exit` is received
- **THEN** the service responds `200` with `{"status": "exiting"}` and terminates the process approximately 0.1 seconds later after the response is flushed

### Requirement: svc-3 — Startup and binding: start command
THE service SHALL start via `python -m quest_runner_service`, binding the HTTP server to `--host` (default `0.0.0.0`) and `--port` (default `9002`).

#### Scenario: Service started
- **WHEN** `python -m quest_runner_service` is invoked
- **THEN** the HTTP server binds to `--host` (default `0.0.0.0`) and `--port` (default `9002`)

### Requirement: svc-4 — Startup and binding: repository root
THE service SHALL operate on the repository checkout that contains its own source tree (the checkout root is derived from the package location, not from the working directory): quests are read from and written to that checkout's `projects/` tree and logs to its `logs/` tree.

#### Scenario: Repository root derived from package location
- **WHEN** the service is running
- **THEN** it reads and writes quests from the checkout's `projects/` tree and logs to its `logs/` tree, with the root derived from the package location not the working directory

### Requirement: svc-5 — Startup and binding: launcher
WHEN started with `start_quest_runner.sh` (equivalently `make -C projects/quest-runner run` or repo-root `make quest-runner-run`), THE launcher SHALL create `projects/quest-runner/.venv` if missing, install `requirements.txt` into it, and exec the service on port `9002` with stdout and stderr appended to `logs/quest-runner/quest_runner_stdout.log` and `logs/quest-runner/quest_runner_stderr.log`.

#### Scenario: Launcher invoked
- **WHEN** the service is started with `start_quest_runner.sh` (or equivalent `make` targets)
- **THEN** the launcher creates `projects/quest-runner/.venv` if missing, installs `requirements.txt` into it, and execs the service on port `9002` with stdout and stderr appended to `logs/quest-runner/quest_runner_stdout.log` and `logs/quest-runner/quest_runner_stderr.log`

### Requirement: svc-6 — Startup and binding: application log
THE service SHALL write its application log to `logs/quest-runner/quest-runner.log` (INFO level, rotated at 10 MiB with 5 backups) and SHALL log every HTTP request as `HTTP <METHOD> <path>`.

#### Scenario: Application logging
- **WHEN** the service is running
- **THEN** it writes its application log to `logs/quest-runner/quest-runner.log` at INFO level, rotated at 10 MiB with 5 backups, and logs every HTTP request as `HTTP <METHOD> <path>`

### Requirement: svc-7 — Registry: services.json entry
THE repository registry `config/services.json` SHALL contain a quest-runner entry of the form below; registry field semantics and the required-endpoint rules are defined in [Services](../../../structure/services.md).

  ```json
  {
    "name": "quest-runner",
    "host": "0.0.0.0",
    "port": 9002,
    "home_path": "/dashboard",
    "command": "make quest-runner-run"
  }
  ```

#### Scenario: Registry entry present
- **WHEN** `config/services.json` is inspected
- **THEN** it contains a `quest-runner` entry with `name`, `host`, `port`, `home_path`, and `command` fields matching the specified shape

### Requirement: svc-8 — CLI base-URL resolution: source priority
THE CLI SHALL resolve the service base URL from the first available source, in order: the `--base-url <url>` flag; the `QUEST_RUNNER_URL` environment variable (ignored when blank); the `quest-runner` entry of `config/services.json` as `http://<host>:<port>`; and finally the fallback `http://localhost:9002`. Trailing slashes are stripped.

#### Scenario: --base-url flag provided
- **WHEN** the `--base-url <url>` flag is given
- **THEN** the CLI uses that URL as the base URL (with trailing slashes stripped)

#### Scenario: QUEST_RUNNER_URL set
- **WHEN** `--base-url` is absent and `QUEST_RUNNER_URL` is set and non-blank
- **THEN** the CLI uses `QUEST_RUNNER_URL` as the base URL (with trailing slashes stripped)

#### Scenario: services.json entry used
- **WHEN** `--base-url` is absent and `QUEST_RUNNER_URL` is blank, and a `quest-runner` entry exists in `config/services.json`
- **THEN** the CLI constructs the base URL as `http://<host>:<port>` from that entry (with trailing slashes stripped)

#### Scenario: Fallback URL used
- **WHEN** none of the higher-priority sources are available
- **THEN** the CLI uses `http://localhost:9002` as the base URL

### Requirement: svc-9 — CLI base-URL resolution: 0.0.0.0 mapping
WHEN the `services.json` entry's host is `0.0.0.0`, THE CLI SHALL connect to `localhost` at the configured port.

#### Scenario: Host is 0.0.0.0
- **WHEN** the `services.json` entry's host is `0.0.0.0`
- **THEN** the CLI connects to `localhost` at the configured port

### Requirement: svc-10 — CLI base-URL resolution: services.json location and fallback
THE CLI SHALL locate `config/services.json` by walking up the parent directories of the invoked CLI script's resolved path. IF the file is missing, unparseable, not a JSON array, lacks a `quest-runner` entry, or the entry lacks `host`/`port`, THEN THE CLI SHALL use the fallback URL.

#### Scenario: services.json located successfully
- **WHEN** the CLI walks up from the invoked script's resolved path and finds `config/services.json` with a valid `quest-runner` entry containing `host` and `port`
- **THEN** the CLI uses that entry to construct the base URL

#### Scenario: services.json missing or invalid
- **WHEN** the file is missing, unparseable, not a JSON array, lacks a `quest-runner` entry, or the entry lacks `host`/`port`
- **THEN** the CLI uses the fallback URL

### Requirement: svc-11 — CLI base-URL resolution: fallback warning
WHEN the fallback URL is used, THE CLI SHALL print a warning to stderr naming the fallback, unless `--json` is active.

#### Scenario: Fallback used without --json
- **WHEN** the fallback URL is used and `--json` is not active
- **THEN** the CLI prints a warning to stderr naming the fallback

#### Scenario: Fallback used with --json
- **WHEN** the fallback URL is used and `--json` is active
- **THEN** no fallback warning is printed

### Requirement: svc-12 — CLI base-URL resolution: transport error
IF a request cannot reach the service, THEN THE CLI SHALL print `transport error: <reason>` plus the attempted `base_url` and `endpoint` to stderr and exit `1`.

#### Scenario: Request fails to reach service
- **WHEN** a request cannot reach the service
- **THEN** the CLI prints `transport error: <reason>` plus the attempted `base_url` and `endpoint` to stderr and exits `1`

### Requirement: svc-13 — CLI dispatcher: interpreter selection
THE repo-root dispatcher `scripts/quest-runner` SHALL select a Python ≥ 3.10 interpreter from, in order: `$QUEST_RUNNER_PYTHON`, `projects/quest-runner/.venv/bin/python` in the current checkout, and — when running inside a linked git worktree — the main checkout's `projects/quest-runner/.venv/bin/python`; it SHALL exec `projects/quest-runner/bin/quest-runner` with that interpreter. IF no compatible interpreter is found, THEN it SHALL print the tried paths and exit `1`.

#### Scenario: QUEST_RUNNER_PYTHON set
- **WHEN** `$QUEST_RUNNER_PYTHON` is set to a Python ≥ 3.10 interpreter
- **THEN** the dispatcher uses it to exec `projects/quest-runner/bin/quest-runner`

#### Scenario: Local venv python available
- **WHEN** `$QUEST_RUNNER_PYTHON` is unset and `projects/quest-runner/.venv/bin/python` exists in the current checkout
- **THEN** the dispatcher uses it to exec `projects/quest-runner/bin/quest-runner`

#### Scenario: Linked worktree fallback
- **WHEN** running inside a linked git worktree and neither `$QUEST_RUNNER_PYTHON` nor the local venv python is available
- **THEN** the dispatcher uses the main checkout's `projects/quest-runner/.venv/bin/python`

#### Scenario: No compatible interpreter found
- **WHEN** no compatible Python ≥ 3.10 interpreter is found from any source
- **THEN** the dispatcher prints the tried paths and exits `1`

### Requirement: svc-14 — Startup: smoke-test asset resolution

WHILE smoke-test mode is active (`SHEAF_SMOKE_TEST_MODE`), THE quest-runner service SHALL resolve any git-ignored assets it reads — such as `config/api_keys.json` and `.secrets.json` — from the smoke asset root given by `SHEAF_SMOKE_ASSET_ROOT`, while continuing to resolve tracked files (including `config/services.json` and `config/quest-runner.json`) from its own repository root; IF `SHEAF_SMOKE_ASSET_ROOT` is unset, empty, or not an existing directory, THEN the service SHALL log a warning and fall back to normal repository-root asset resolution.

#### Scenario: Assets read from the smoke asset root

- **WHEN** quest-runner starts with `SHEAF_SMOKE_TEST_MODE=1` and `SHEAF_SMOKE_ASSET_ROOT` pointing at an existing main-repo checkout
- **THEN** it resolves its git-ignored assets from that smoke asset root
- **AND** it loads `config/services.json` and `config/quest-runner.json` from its own repository root

#### Scenario: Smoke mode off

- **WHEN** quest-runner starts without `SHEAF_SMOKE_TEST_MODE` active
- **THEN** it resolves all assets from its own repository root exactly as before

#### Scenario: Asset root missing

- **WHEN** quest-runner starts with smoke-test mode active but `SHEAF_SMOKE_ASSET_ROOT` unset, empty, or not an existing directory
- **THEN** it logs a warning and resolves assets from its own repository root

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
[Services](../../../structure/services.md).

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
(see [quest-lifecycle](../quest-runner-quest-lifecycle/spec.md)). The service does not read
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

- [quest-lifecycle](../quest-runner-quest-lifecycle/spec.md) — all lifecycle endpoints and the
  CLI commands ride on this process and its URL resolution.
- [dashboard](../quest-runner-dashboard/spec.md) — the SPA and data API are served by the same
  process; `home_path` `/dashboard` in the registry points at it.
- [chat-stream](../quest-runner-chat-stream/spec.md) — the WebSocket route is registered on the
  same Flask app via flask-sock.
- [issues](../quest-runner-issues/spec.md), [experiments](../quest-runner-experiments/spec.md),
  [slices](../quest-runner-slices/spec.md) — their HTTP APIs are hosted here.
- Repository rules: [Services](../../../structure/services.md)
  (registry format, required endpoints),
  [Logs And Data](../../../structure/logs-and-data.md) (runtime log
  locations).
