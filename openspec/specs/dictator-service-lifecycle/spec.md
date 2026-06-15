# Capability: Service Lifecycle

Project: `projects/dictator`
ID prefix: `svc` — requirement IDs are append-only; never renumber or reuse.

## Purpose

DictatorService is a long-running Sheaf service. This capability specifies
startup (repo-root discovery, registry resolution, config and secret loading,
health warnings), the standard service endpoints (`/health`, `/exit`),
endpoint overrides, shutdown, route fallbacks, and trace logging.
## Requirements
### Requirement: svc-1 — Startup: repo root discovery
WHEN started, THE service SHALL locate the Sheaf repo root by walking up from the working directory (at most 12 levels) until it finds a directory containing both `config/services.json` and `projects/dictator/`; IF none is found, THEN it SHALL print `DictatorService failed to locate Sheaf repo root: <error>` to stderr and exit 1.

#### Scenario: Repo root found
- **WHEN** the service starts and finds a directory containing both `config/services.json` and `projects/dictator/` within 12 levels up
- **THEN** startup continues normally using that directory as the repo root

#### Scenario: Repo root not found
- **WHEN** the service starts and no directory within 12 levels up contains both `config/services.json` and `projects/dictator/`
- **THEN** it prints `DictatorService failed to locate Sheaf repo root: <error>` to stderr and exits 1

### Requirement: svc-2 — Startup: registry loading
THE service SHALL load its registry entry from `config/services.json` (array entries `{name, host, port, home_path, command}`) for service name `dictator`; IF the file is missing, the JSON is invalid, or no entry named `dictator` exists, THEN it SHALL log the error and exit 1. Registry rules: [Services](../../../structure/services.md).

#### Scenario: Registry entry found
- **WHEN** `config/services.json` exists, is valid JSON, and contains an entry named `dictator`
- **THEN** the service loads that entry and continues startup

#### Scenario: Registry load failure
- **WHEN** `config/services.json` is missing, the JSON is invalid, or no entry named `dictator` exists
- **THEN** the service logs the error and exits 1

### Requirement: svc-3 — Startup: bind endpoint resolution
THE service SHALL bind to the registry `host`/`port` unless CLI overrides are given: `--host <h>`, `--port <n>`, `--host=<h>`, `--port=<n>` override per-field (a non-integer `--port` value is ignored); the chosen endpoint and whether an override was used are trace-logged. The registered entry is host `0.0.0.0`, port `9003`, command `make dictator-run`.

#### Scenario: No CLI overrides
- **WHEN** no `--host` or `--port` CLI arguments are given
- **THEN** the service binds to the registry host `0.0.0.0` and port `9003`, and trace-logs the chosen endpoint

#### Scenario: CLI host or port override
- **WHEN** `--host <h>`, `--port <n>`, `--host=<h>`, or `--port=<n>` is given
- **THEN** the service overrides the corresponding per-field value, ignores a non-integer `--port` value, and trace-logs the chosen endpoint and that an override was used

### Requirement: svc-4 — Startup: config and secrets loading
WHEN starting, THE service SHALL load [`config/dictator.json`](../../../projects/dictator/docs/contracts/config.md) (creating it from `config/dictator.safe` or bootstrap defaults when absent) and `config/api_keys.json`; IF `dictator_server_enabled` is `false`, THEN it SHALL log a warning and start anyway on the registered endpoint.

#### Scenario: Config loaded normally
- **WHEN** `config/dictator.json` exists (or is created from `config/dictator.safe` or bootstrap defaults) and `dictator_server_enabled` is not `false`
- **THEN** the service loads the config and secrets and continues startup

#### Scenario: Server disabled in config
- **WHEN** `dictator_server_enabled` is `false`
- **THEN** the service logs a warning and starts anyway on the registered endpoint

### Requirement: svc-5 — Startup: health warning computation
THE service SHALL compute a health warning at startup: missing OpenAI key contributes `OpenAI API key is not configured`, a missing STT model file contributes `STT model not found`; multiple warnings join with `"; "`; with none the warning is absent.

#### Scenario: No health issues
- **WHEN** the OpenAI key is present and the STT model file exists
- **THEN** the health warning is absent

#### Scenario: One health issue
- **WHEN** either the OpenAI key is missing or the STT model file is missing (but not both)
- **THEN** the health warning is the corresponding single message

#### Scenario: Multiple health issues
- **WHEN** both the OpenAI key is missing and the STT model file is missing
- **THEN** the health warning is `OpenAI API key is not configured; STT model not found`

### Requirement: svc-6 — Startup: listener bind outcome
IF binding the listener fails, THEN THE service SHALL log `server failed: <error>` and exit 1; on success it logs `listening on <host>:<port>`.

#### Scenario: Listener bind failure
- **WHEN** binding the listener fails
- **THEN** the service logs `server failed: <error>` and exits 1

#### Scenario: Listener bind success
- **WHEN** binding the listener succeeds
- **THEN** the service logs `listening on <host>:<port>`

### Requirement: svc-7 — Standard endpoints and routing: GET /health response
WHEN it receives `GET /health`, THE service SHALL respond 200 with `{"healthy": true, "uptime": <seconds since start>, "warning": <string, omitted when nil>}`.

#### Scenario: GET /health received
- **WHEN** the service receives `GET /health`
- **THEN** it responds 200 with `{"healthy": true, "uptime": <seconds since start>, "warning": <string, omitted when nil>}`

### Requirement: svc-8 — Standard endpoints and routing: POST /exit shutdown
WHEN it receives `POST /exit`, THE service SHALL respond 200 with `{"exiting": true}` (Connection: close), then stop the listener, shut down the event loop, stop the Launchpad controller, and let the process exit normally. Shutdown runs at most once; repeated triggers are no-ops after the first.

#### Scenario: POST /exit received
- **WHEN** the service receives `POST /exit`
- **THEN** it responds 200 with `{"exiting": true}` (Connection: close), stops the listener, shuts down the event loop, stops the Launchpad controller, and lets the process exit normally

#### Scenario: Repeated /exit trigger
- **WHEN** `POST /exit` or SIGINT triggers shutdown a second time while shutdown is already running
- **THEN** the repeated trigger is a no-op

### Requirement: svc-9 — Standard endpoints and routing: SIGINT shutdown
WHEN it receives SIGINT, THE service SHALL perform the same orderly shutdown as `/exit`.

#### Scenario: SIGINT received
- **WHEN** the service receives SIGINT
- **THEN** it performs the same orderly shutdown as `POST /exit`

### Requirement: svc-10 — Standard endpoints and routing: method and route errors
IF a request uses a known path (`/health`, `/exit`, `/v1/dictate-audio`) with the wrong method, THEN THE service SHALL respond 405 with `{"error": "Method not allowed."}`; IF no route matches, THEN it SHALL respond 404 with `{"error": "Not found."}`. (Web routes match on exact method+path pairs; a wrong method on an `/api/*` path therefore falls through to 404, not 405.)

#### Scenario: Known path with wrong method
- **WHEN** a request uses a known path (`/health`, `/exit`, `/v1/dictate-audio`) with the wrong HTTP method
- **THEN** the service responds 405 with `{"error": "Method not allowed."}`

#### Scenario: Unknown route
- **WHEN** no route matches the request
- **THEN** the service responds 404 with `{"error": "Not found."}`

### Requirement: svc-11 — Standard endpoints and routing: HTTP keep-alive
THE service SHALL honor HTTP keep-alive: responses set `Connection: keep-alive` unless the request was not keep-alive or the response forces close (413, `/exit`).

#### Scenario: Keep-alive request
- **WHEN** a keep-alive request arrives and the response does not force close
- **THEN** the response sets `Connection: keep-alive`

#### Scenario: Non-keep-alive or forced-close response
- **WHEN** the request was not keep-alive, or the response forces close (413, `/exit`)
- **THEN** the response does not set `Connection: keep-alive`

### Requirement: svc-12 — Trace log: append-only trace logging
THE service SHALL append timestamped trace lines (`[<ISO-8601 fractional>] <message>`) to `logs/dictator/trace.log` under the repo root, creating the directory/file as needed, and mirror every line to stderr. The file is append-only and never rotated or truncated by the service. Path rules: [Logs And Data](../../../structure/logs-and-data.md).

#### Scenario: Trace line appended
- **WHEN** the service emits a trace line
- **THEN** it appends `[<ISO-8601 fractional>] <message>` to `logs/dictator/trace.log` (creating the directory/file as needed) and mirrors the line to stderr

### Requirement: svc-13 — Startup: smoke-test asset resolution

WHILE smoke-test mode is active (`SHEAF_SMOKE_TEST_MODE`), THE Dictator service SHALL resolve its git-ignored assets — `config/api_keys.json` and the configured STT (whisper) model path — from the smoke asset root given by `SHEAF_SMOKE_ASSET_ROOT`, while continuing to resolve tracked files (including `config/services.json` and `config/dictator.json`) from its own repository root; IF `SHEAF_SMOKE_ASSET_ROOT` is unset, empty, or not an existing directory, THEN the service SHALL log a warning and fall back to normal repository-root asset resolution.

#### Scenario: Assets read from the smoke asset root

- **WHEN** Dictator starts with `SHEAF_SMOKE_TEST_MODE=1` and `SHEAF_SMOKE_ASSET_ROOT` pointing at an existing main-repo checkout
- **THEN** it loads `config/api_keys.json` and the STT model from that smoke asset root
- **AND** it loads `config/services.json` and `config/dictator.json` from its own repository root

#### Scenario: Smoke mode off

- **WHEN** Dictator starts without `SHEAF_SMOKE_TEST_MODE` active
- **THEN** it resolves all assets from its own repository root exactly as before

#### Scenario: Asset root missing

- **WHEN** Dictator starts with smoke-test mode active but `SHEAF_SMOKE_ASSET_ROOT` unset, empty, or not an existing directory
- **THEN** it logs a warning and resolves assets from its own repository root

## Contracts

### `GET /health` — 200

```json
{ "healthy": true, "uptime": 123.45, "warning": "OpenAI API key is not configured; STT model not found" }
```

`warning` is omitted when there is nothing to report.

### `POST /exit` — 200

```json
{ "exiting": true }
```

### Error catalogue

| Condition | Status / exit | Message |
|---|---|---|
| Repo root not found | exit 1 | stderr `DictatorService failed to locate Sheaf repo root: ...` |
| services.json missing / invalid / no `dictator` entry | exit 1 | trace `service registry error: ...` |
| Listener bind failure | exit 1 | trace `server failed: ...` |
| Known path, wrong method | 405 | `{"error": "Method not allowed."}` |
| Unknown route | 404 | `{"error": "Not found."}` |

### CLI

```text
DictatorService [--host <h>] [--port <n>]    # also --host=<h> / --port=<n>
```

Invoked via `swift run DictatorService` (`make run` /
`make dictator-run` from the repo root). See
[operations](../../../projects/dictator/docs/operations.md).

## Design

- `src/Sources/DictatorService/DictatorServiceMain.swift` — `@main` wiring in
  startup order: root discovery → trace logger → CLI parse → registry →
  runtime config provider (`config/dictator.json` + `config/dictator.safe`)
  → secrets → STT/refinement engines → interaction store (async initial
  load) → web API service → Launchpad controller → HTTP server → SIGINT
  source + checked continuation. `ShutdownCoordinator` (NSLock +
  `didShutdown` flag) makes shutdown idempotent across `/exit` and SIGINT.
- `src/Sources/DictatorService/ServiceRegistry.swift`,
  `ServiceEndpointResolver.swift` — registry decode and per-field CLI
  override precedence (`ServiceRegistryTests`, `ServiceEndpointResolverTests`).
- `src/Sources/DictatorService/ServiceLifecycle.swift` — start time, health
  warning, shutdown callback used by the `/health` and `/exit` handlers.
- `src/Sources/DictatorService/TraceLogger.swift` — locked append to
  `logs/dictator/trace.log` + stderr mirror (`TraceLoggerTests`).
- The HTTP server is SwiftNIO with one event-loop thread
  (`MultiThreadedEventLoopGroup(numberOfThreads: 1)`), backlog 256,
  SO_REUSEADDR; in-flight dictation tasks are cancelled when their channel
  goes inactive.
- Tests: `tests/DictatorServiceTests/DictationHTTPServerTests.swift`
  (health shape, exit callback, 404/405), `ServiceRegistryTests.swift`,
  `ServiceEndpointResolverTests.swift`,
  `tests/DictatorCoreTests/SheafRootDiscoveryTests.swift`,
  `SheafRuntimePathsTests.swift`.

## Interactions

- [dictation-pipeline](../dictator-dictation-pipeline/spec.md) — served on the same listener.
- [web-ui](../dictator-web-ui/spec.md) — `/api/status` re-exposes uptime/warning plus pipeline
  state; web routes are matched before the routes specified here.
- [launchpad](../dictator-launchpad/spec.md) — started after the web service and stopped
  during shutdown; a layout failure does not abort service startup.
- [Config contract](../../../projects/dictator/docs/contracts/config.md) — files read at startup.
