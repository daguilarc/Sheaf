# Capability: Service Management

ID prefix: `svc`

## Purpose

The core of conductor: load the service registry, keep an in-memory heartbeat
for every registered service by polling `GET /health`, expose conductor's own
required service endpoints (`/health`, `/exit`), and provide the
`/api/services` REST surface for inspecting services and starting, stopping,
or restarting them on explicit request.

## Requirements

### Startup

- **[svc-1]** WHEN started, THE service SHALL locate the repository root by
  walking parent directories from its own installed location until it finds a
  directory containing both `config/services.json` and `structure/`; IF no
  such directory exists, THEN startup SHALL fail with the error
  `repository root not found`.
- **[svc-2]** WHEN started, THE service SHALL load
  `<repo>/config/services.json` (format:
  [structure/services.md](../../../../structure/services.md)) as its only
  service registry and bind its HTTP server to the `host` and `port` of the
  registry entry named `conductor`; IF no `conductor` entry exists, THEN
  startup SHALL fail with the error
  `conductor service is not registered in config/services.json`.
- **[svc-3]** IF the registry file is malformed JSON, is not a JSON array,
  contains a non-object entry, contains an entry with an invalid `name`,
  `host`, `port`, `command`, or `home_path`, or contains two entries with the
  same `name`, THEN startup SHALL fail with the corresponding message in the
  error catalogue (see Contracts). Validation rules: `name` and `host` are
  non-empty strings, `port` is an integer, `command` is a string (empty
  allowed at load time), `home_path` when present is a string.
- **[svc-4]** WHEN listening, THE service SHALL log
  `Conductor listening on <host>:<port>` to stderr; IF startup fails, THEN
  THE process SHALL log the error and exit with a non-zero exit code.

### Own service endpoints

- **[svc-5]** THE service SHALL respond to `GET /health` with 200 and
  `{"healthy": true, "uptime": <seconds since process start, float>}`; a
  `warning` string is included only when one was supplied by an embedding
  caller (the standalone service never sets one).
- **[svc-6]** WHEN it receives `POST /exit`, THE service SHALL respond 200
  `{"exiting": true}`, and only after the response is flushed stop accepting
  connections, stop the health poller, close the HTTP and WebSocket servers,
  and exit the process with code 0. WHILE shutdown is in progress, THE
  service SHALL answer further HTTP requests with 404
  `{"error": "not found"}` and reject WebSocket upgrades with HTTP 404.
  Repeated shutdown requests are idempotent.

### Health polling

- **[svc-7]** WHEN started, THE service SHALL immediately poll every
  registered service once and then repeat a full poll cycle every 30 seconds
  (default `pollIntervalMs` 30000), requesting
  `GET http://<host>:<port>/health` with a 5-second timeout (default
  `requestTimeoutMs` 5000). A registered host of `0.0.0.0` SHALL be polled as
  `127.0.0.1`.
- **[svc-8]** THE service SHALL classify a poll as healthy only when the
  response is 2xx with a JSON object body containing `healthy: true` and a
  numeric `uptime`; it SHALL then store
  `{healthy: true, last_checked_at: <ISO-8601 poll time>, last_error: null,
  uptime}` plus `warning` when the body carries a string `warning`.
- **[svc-9]** IF a poll fails, THEN THE service SHALL store
  `healthy: false`, the poll time as `last_checked_at`, and a `last_error`
  from the heartbeat-error catalogue (see Contracts), while preserving the
  previously stored `uptime` and `warning` values.
- **[svc-10]** WHILE a service has not yet been polled, THE service SHALL
  report its heartbeat as
  `{healthy: false, last_checked_at: null, last_error: "not checked yet"}`.
- **[svc-11]** THE health poller SHALL be observational only: it never
  starts, stops, restarts, or otherwise acts on services.

### REST surface

- **[svc-12]** THE service SHALL respond to `GET /api/services` with 200 and
  a JSON array, in registry order, of presented services: the registry fields
  (`name`, `host`, `port`, `command`, `home_path` when present) merged with
  the current heartbeat (`healthy`, `last_checked_at`, `last_error`, plus
  `uptime`/`warning` when known), plus
  `home_url = "http://<host>:<port><home_path>"` when `home_path` is present
  (the raw registry host — `0.0.0.0` is not rewritten server-side).
- **[svc-13]** THE service SHALL respond to `GET /api/services/<name>` with
  200 and the single presented service (same shape as a `GET /api/services`
  element).
- **[svc-14]** THE service SHALL respond to `GET /api/services/<name>/health`
  with 200 and exactly the fields `name`, `healthy`, `last_checked_at`,
  `last_error`, and (when known) `uptime` and `warning`, taken from the
  in-memory heartbeat — no live probe is performed.
- **[svc-15]** IF a `<name>` path segment names no registered service on any
  `/api/services/...` or `/services/<name>/logs` route, THEN THE service
  SHALL respond 404 `{"error": "service not found"}`; IF a request matches no
  route (including wrong method on a known path), THEN THE service SHALL
  respond 404 `{"error": "not found"}`. Path segments are URL-decoded before
  lookup (`with%20space` → `with space`).

### Lifecycle actions

- **[svc-16]** WHEN it receives `POST /api/services/<name>/start`, THE
  service SHALL spawn the registry `command` as a detached process with the
  repository root as working directory, append the child's stdout and stderr
  to `logs/<name>/<name>_stdout.log` and `logs/<name>/<name>_stderr.log`
  (creating the directory), remember the child as owned by this conductor
  instance, and respond 200 with the start result body (see Contracts).
- **[svc-17]** THE service SHALL execute commands containing any of the shell
  metacharacters `| & ; < >` via a shell (`argv` reported as the single raw
  command string); all other commands SHALL be tokenized on whitespace,
  honoring single and double quotes, and spawned directly.
- **[svc-18]** IF the registry `command` is missing, empty, or
  whitespace-only, THEN start SHALL respond 400 with `started: false` and
  `error: "service command is missing or empty"`; IF spawning fails or the
  command tokenizes to nothing, THEN start SHALL respond 500 with
  `started: false`, the spawn error message (e.g. `spawn ENOENT`,
  `empty command`, `spawn returned no pid`), and — when the argv is known — a
  `process` object with `pid: -1`.
- **[svc-19]** WHEN it receives `POST /api/services/<name>/stop`, THE service
  SHALL request `POST http://<host>:<port>/exit` on the target (host
  `0.0.0.0` contacted as `127.0.0.1`, 5-second timeout, default
  `exitRequestTimeoutMs` 5000) and respond 200 with `stop_requested: true`
  when the exit request returns 2xx; IF the exit request fails AND this
  conductor instance previously started the service, THEN it SHALL kill that
  owned process's pid and respond 200 with `stop_requested: true`; IF the
  exit request fails and no owned process exists, THEN it SHALL respond 200
  with `stop_requested: false` and an `error` (the network error message or
  `HTTP <status>`). A successful stop forgets the owned process.
- **[svc-20]** WHEN it receives `POST /api/services/<name>/restart`, THE
  service SHALL perform the stop behavior (svc-19) followed by the start
  behavior (svc-16) and respond with the restart result body (see Contracts):
  `restart_requested` equals `started`; `error` is the start error, or the
  stop error when the start did not succeed; a failed stop with a successful
  start is still a successful restart (200, no `error`). Status mapping
  follows start: 400 when the error is the missing/empty-command message, 500
  for other start failures, 200 otherwise.
- **[svc-21]** THE lifecycle endpoints SHALL act only on explicit requests:
  conductor performs no supervision, desired-state reconciliation, or
  automatic restarts. Lifecycle results embed the heartbeat snapshot taken
  when the request began, not a post-action probe.

### Package surface

- **[svc-22]** THE npm package SHALL expose a `conductor` bin
  (`dist/src/main.js`) and an importable library entry point
  (`main`/`exports` → `dist/src/index.js`, types `dist/src/index.d.ts`)
  re-exporting the public modules (`createRepoPaths`, `loadServiceRegistry`,
  `HealthPoller`, `createConductorServer`, `LifecycleManager`, ...).

## Contracts

### `GET /health` — 200

```json
{ "healthy": true, "uptime": 123.45 }
```

### `POST /exit` — 200

```json
{ "exiting": true }
```

### `GET /api/services` — 200 (one element shown)

```json
[
  {
    "name": "quest-runner",
    "host": "0.0.0.0",
    "port": 9002,
    "command": "make quest-runner-run",
    "home_path": "/dashboard",
    "healthy": true,
    "last_checked_at": "2026-06-10T12:00:00.000Z",
    "last_error": null,
    "uptime": 42.0,
    "warning": "disk low",
    "home_url": "http://0.0.0.0:9002/dashboard"
  }
]
```

`home_path`/`home_url` are omitted when the registry entry has no
`home_path`; `uptime`/`warning` are omitted until a healthy poll has
reported them. `GET /api/services/<name>` returns one such object.

### `GET /api/services/<name>/health` — 200

```json
{
  "name": "quest-runner",
  "healthy": false,
  "last_checked_at": "2026-06-10T12:00:30.001Z",
  "last_error": "HTTP 500",
  "uptime": 42.0,
  "warning": "disk low"
}
```

### `POST /api/services/<name>/start` — 200

```json
{
  "name": "quest-runner",
  "action": "start",
  "started": true,
  "process": { "pid": 4242, "command": "make quest-runner-run", "argv": ["make", "quest-runner-run"] },
  "heartbeat": { "name": "quest-runner", "healthy": false, "last_checked_at": null, "last_error": "not checked yet" }
}
```

### `POST /api/services/<name>/stop` — 200

```json
{
  "name": "quest-runner",
  "action": "stop",
  "stop_requested": true,
  "heartbeat": { "name": "quest-runner", "healthy": true, "last_checked_at": "2026-06-10T12:00:00.000Z", "last_error": null, "uptime": 42.0 }
}
```

### `POST /api/services/<name>/restart` — 200

```json
{
  "name": "quest-runner",
  "action": "restart",
  "restart_requested": true,
  "stop_requested": true,
  "started": true,
  "process": { "pid": 4243, "command": "make quest-runner-run", "argv": ["make", "quest-runner-run"] },
  "heartbeat": { "name": "quest-runner", "healthy": true, "last_checked_at": "2026-06-10T12:00:00.000Z", "last_error": null, "uptime": 42.0 }
}
```

### Error catalogue — HTTP

| Condition | Status | Body (exact) |
|---|---|---|
| Unknown service name on any service route | 404 | `{"error": "service not found"}` |
| Unmatched route or method | 404 | `{"error": "not found"}` |
| Any request while shutdown is in progress | 404 | `{"error": "not found"}` |
| start/restart: command missing or empty | 400 | result body with `"error": "service command is missing or empty"` |
| start/restart: spawn failure | 500 | result body with the spawn error message; `process.pid` is `-1` when argv known |
| stop: exit request failed, no owned process | 200 | result body with `"stop_requested": false` and `"error"` = network message or `HTTP <status>` |

### Error catalogue — startup failures (process exits non-zero)

| Condition | Message (exact) |
|---|---|
| No repo root found | `repository root not found` |
| Registry malformed JSON | `service registry contains malformed JSON` |
| Registry not an array | `service registry must be a JSON array` |
| Entry not an object | `service registry entry at index <i> must be an object` |
| Invalid `name` | `service registry entry at index <i> has invalid name` |
| Invalid `host` / `port` / `command` / `home_path` | `service registry entry "<name>" has invalid <field>` |
| Duplicate name | `duplicate service name: <name>` |
| No `conductor` entry | `conductor service is not registered in config/services.json` |

### Error catalogue — heartbeat `last_error` values

| Poll outcome | `last_error` (exact) |
|---|---|
| Never polled | `not checked yet` |
| Non-2xx response | `HTTP <status>` |
| Body not parseable / not a JSON object | `invalid JSON` |
| Body lacks a `healthy` field | `missing healthy` |
| Body has `healthy: false` | `healthy: false` |
| `healthy: true` but `uptime` not a number | `missing uptime` |
| Network error / timeout | the error message (timeouts surface as the abort error) |

## Design

- `src/main.ts` — startup wiring; `findConductorService` raises the
  missing-entry error; failures hit the top-level catch which logs and sets
  `process.exitCode = 1`.
- `src/paths.ts` — `createRepoPaths` (root discovery from the module's own
  directory, so it works from `dist/`), `serviceLogStreamPaths` (the
  `_stdout.log`/`_stderr.log` naming shared with `start_conductor.sh`).
- `src/health_poller.ts` — `HealthPoller`; `resolvePollHost` maps `0.0.0.0`,
  `parseHealthResponseBody` implements svc-8's classification. Poll cycles
  run all services concurrently (`Promise.all`); timers and fetch are
  injectable for tests.
- `src/service_presenter.ts` — `presentService` / `presentServiceHealth` /
  `presentAllServices`; optional fields are omitted, never null.
- `src/lifecycle.ts` — `LifecycleManager.StartService/StopService/
  RestartService`, the owned-process map (`m_startedProcesses`),
  `createExitRequester`, `validateServiceCommand`. Killing an owned pid
  swallows `process.kill` errors (already-dead processes still count as
  stopped).
- `src/process_runner.ts` — `parseCommand` (quote-aware tokenizer),
  `needsShellExecution` (`/[|&;<>]/`), `spawnCommand` (detached, unref'd,
  stdio to appended log fds which are closed in the parent after spawn).
- `src/server.ts` — route table and status mapping; the
  missing-or-empty-command → 400 mapping keys on the error string containing
  `missing or empty`.
- `src/shutdown.ts` — `createShutdownController`; `wasShutdownRequested`
  makes repeat `/exit` calls no-ops.
- Tests: `tests/registry.test.ts`, `tests/health.test.ts`,
  `tests/service_rest.test.ts`, `tests/lifecycle.test.ts`,
  `tests/process_runner.test.ts`, `tests/scaffold.test.ts` (pins the real
  registry entry and package metadata).

## Interactions

- [log-access](log-access.md) — reads the `logs/<name>/` directories that
  start (svc-16) writes into; shares the 404 service-lookup rule (svc-15).
- [web-ui](web-ui.md) — the main page renders `GET /api/services` and drives
  the lifecycle endpoints.
- [structure/services.md](../../../../structure/services.md) — the registry
  format and the `/health` + `/exit` contract conductor both implements and
  relies on when polling and stopping services.
