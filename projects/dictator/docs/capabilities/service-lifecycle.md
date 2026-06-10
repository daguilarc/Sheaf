# Capability: Service Lifecycle

ID prefix: `svc`

## Purpose

DictatorService is a long-running Sheaf service. This capability specifies
startup (repo-root discovery, registry resolution, config and secret loading,
health warnings), the standard service endpoints (`/health`, `/exit`),
endpoint overrides, shutdown, route fallbacks, and trace logging.

## Requirements

### Startup

- **[svc-1]** WHEN started, THE service SHALL locate the Sheaf repo root by
  walking up from the working directory (at most 12 levels) until it finds a
  directory containing both `config/services.json` and `projects/dictator/`;
  IF none is found, THEN it SHALL print `DictatorService failed to locate
  Sheaf repo root: <error>` to stderr and exit 1.
- **[svc-2]** THE service SHALL load its registry entry from
  `config/services.json` (array entries `{name, host, port, home_path,
  command}`) for service name `dictator`; IF the file is missing, the JSON is
  invalid, or no entry named `dictator` exists, THEN it SHALL log the error
  and exit 1. Registry rules: [Services](../../../../structure/services.md).
- **[svc-3]** THE service SHALL bind to the registry `host`/`port` unless CLI
  overrides are given: `--host <h>`, `--port <n>`, `--host=<h>`, `--port=<n>`
  override per-field (a non-integer `--port` value is ignored); the chosen
  endpoint and whether an override was used are trace-logged. The registered
  entry is host `0.0.0.0`, port `9003`, command `make dictator-run`.
- **[svc-4]** WHEN starting, THE service SHALL load
  [`config/dictator.json`](../contracts/config.md) (creating it from
  `config/dictator.safe` or bootstrap defaults when absent) and
  `config/api_keys.json`; IF `dictator_server_enabled` is `false`, THEN it
  SHALL log a warning and start anyway on the registered endpoint.
- **[svc-5]** THE service SHALL compute a health warning at startup: missing
  OpenAI key contributes `OpenAI API key is not configured`, a missing STT
  model file contributes `STT model not found`; multiple warnings join with
  `"; "`; with none the warning is absent.
- **[svc-6]** IF binding the listener fails, THEN THE service SHALL log
  `server failed: <error>` and exit 1; on success it logs
  `listening on <host>:<port>`.

### Standard endpoints and routing

- **[svc-7]** WHEN it receives `GET /health`, THE service SHALL respond 200
  with `{"healthy": true, "uptime": <seconds since start>, "warning":
  <string, omitted when nil>}`.
- **[svc-8]** WHEN it receives `POST /exit`, THE service SHALL respond 200
  with `{"exiting": true}` (Connection: close), then stop the listener,
  shut down the event loop, stop the Launchpad controller, and let the
  process exit normally. Shutdown runs at most once; repeated triggers are
  no-ops after the first.
- **[svc-9]** WHEN it receives SIGINT, THE service SHALL perform the same
  orderly shutdown as `/exit`.
- **[svc-10]** IF a request uses a known path (`/health`, `/exit`,
  `/v1/dictate-audio`) with the wrong method, THEN THE service SHALL respond
  405 with `{"error": "Method not allowed."}`; IF no route matches, THEN it
  SHALL respond 404 with `{"error": "Not found."}`. (Web routes match on
  exact method+path pairs; a wrong method on an `/api/*` path therefore falls
  through to 404, not 405.)
- **[svc-11]** THE service SHALL honor HTTP keep-alive: responses set
  `Connection: keep-alive` unless the request was not keep-alive or the
  response forces close (413, `/exit`).

### Trace log

- **[svc-12]** THE service SHALL append timestamped trace lines
  (`[<ISO-8601 fractional>] <message>`) to `logs/dictator/trace.log` under
  the repo root, creating the directory/file as needed, and mirror every line
  to stderr. The file is append-only and never rotated or truncated by the
  service. Path rules: [Logs And Data](../../../../structure/logs-and-data.md).

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
[operations](../operations.md).

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

- [dictation-pipeline](dictation-pipeline.md) — served on the same listener.
- [web-ui](web-ui.md) — `/api/status` re-exposes uptime/warning plus pipeline
  state; web routes are matched before the routes specified here.
- [launchpad](launchpad.md) — started after the web service and stopped
  during shutdown; a layout failure does not abort service startup.
- [Config contract](../contracts/config.md) — files read at startup.
