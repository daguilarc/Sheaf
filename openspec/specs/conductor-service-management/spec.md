# Capability: Service Management

Project: `projects/conductor`
ID prefix: `svc` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The core of conductor: load the service registry, keep an in-memory heartbeat
for every registered service by polling `GET /health`, expose conductor's own
required service endpoints (`/health`, `/exit`), and provide the
`/api/services` REST surface for inspecting services and starting, stopping,
or restarting them on explicit request.

## Requirements

### Requirement: svc-1 — Startup: repository root discovery

WHEN started, THE service SHALL locate the repository root by walking parent directories from its own installed location until it finds a directory containing both `config/services.json` and `structure/`; IF no such directory exists, THEN startup SHALL fail with the error `repository root not found`.

#### Scenario: Repo root found

- **WHEN** the service is started and a parent directory containing both `config/services.json` and `structure/` exists
- **THEN** the service uses that directory as the repository root

#### Scenario: Repo root not found

- **WHEN** the service is started and no parent directory contains both `config/services.json` and `structure/`
- **THEN** startup fails with the error `repository root not found`

### Requirement: svc-2 — Startup: service registry load and bind

WHEN started, THE service SHALL load `<repo>/config/services.json` (format: [structure/services.md](../../../structure/services.md)) as its only service registry and bind its HTTP server to the `host` and `port` of the registry entry named `conductor`; IF no `conductor` entry exists, THEN startup SHALL fail with the error `conductor service is not registered in config/services.json`.

#### Scenario: Conductor entry present

- **WHEN** the service loads `config/services.json` and a `conductor` entry exists
- **THEN** the HTTP server binds to the `host` and `port` from that entry

#### Scenario: Conductor entry absent

- **WHEN** the service loads `config/services.json` and no `conductor` entry exists
- **THEN** startup fails with the error `conductor service is not registered in config/services.json`

### Requirement: svc-3 — Startup: registry validation

IF the registry file is malformed JSON, is not a JSON array, contains a non-object entry, contains an entry with an invalid `name`, `host`, `port`, `command`, or `home_path`, or contains two entries with the same `name`, THEN startup SHALL fail with the corresponding message in the error catalogue (see Contracts). Validation rules: `name` and `host` are non-empty strings, `port` is an integer, `command` is a string (empty allowed at load time), `home_path` when present is a string.

#### Scenario: Malformed registry

- **WHEN** the registry file is malformed JSON, not a JSON array, contains a non-object entry, an entry with an invalid field, or duplicate names
- **THEN** startup fails with the corresponding message from the error catalogue

### Requirement: svc-4 — Startup: listen log and failure exit

WHEN listening, THE service SHALL log `Conductor listening on <host>:<port>` to stderr; IF startup fails, THEN THE process SHALL log the error and exit with a non-zero exit code.

#### Scenario: Successful listen

- **WHEN** the service begins listening
- **THEN** it logs `Conductor listening on <host>:<port>` to stderr

#### Scenario: Startup failure

- **WHEN** startup fails for any reason
- **THEN** the process logs the error and exits with a non-zero exit code

### Requirement: svc-5 — Own service endpoints: GET /health

THE service SHALL respond to `GET /health` with 200 and `{"healthy": true, "uptime": <seconds since process start, float>}`; a `warning` string is included only when one was supplied by an embedding caller (the standalone service never sets one).

#### Scenario: Health check

- **WHEN** the service receives `GET /health`
- **THEN** it responds 200 with `{"healthy": true, "uptime": <seconds since process start, float>}`, including `warning` only when supplied by an embedding caller

### Requirement: svc-6 — Own service endpoints: POST /exit

WHEN it receives `POST /exit`, THE service SHALL respond 200 `{"exiting": true}`, and only after the response is flushed stop accepting connections, stop the health poller, close the HTTP and WebSocket servers, and exit the process with code 0. WHILE shutdown is in progress, THE service SHALL answer further HTTP requests with 404 `{"error": "not found"}` and reject WebSocket upgrades with HTTP 404. Repeated shutdown requests are idempotent.

#### Scenario: Exit request received

- **WHEN** the service receives `POST /exit`
- **THEN** it responds 200 `{"exiting": true}`, and after flushing stops accepting connections, stops the health poller, closes HTTP and WebSocket servers, and exits with code 0

#### Scenario: Request during shutdown

- **WHEN** a shutdown is in progress and an HTTP request arrives
- **THEN** the service responds 404 `{"error": "not found"}` and rejects WebSocket upgrades with HTTP 404

#### Scenario: Repeated exit request

- **WHEN** `POST /exit` is received while shutdown is already in progress
- **THEN** the request is handled idempotently

### Requirement: svc-7 — Health polling: schedule and interval

WHEN started, THE service SHALL immediately poll every registered service once and then repeat a full poll cycle every 30 seconds (default `pollIntervalMs` 30000), requesting `GET http://<host>:<port>/health` with a 5-second timeout (default `requestTimeoutMs` 5000). A registered host of `0.0.0.0` SHALL be polled as `127.0.0.1`.

#### Scenario: Initial poll on startup

- **WHEN** the service starts
- **THEN** it immediately polls every registered service once

#### Scenario: Recurring poll cycle

- **WHEN** the service is running
- **THEN** a full poll cycle repeats every 30 seconds (default `pollIntervalMs` 30000) with a 5-second timeout per request

#### Scenario: Host rewrite for polling

- **WHEN** a registered service has host `0.0.0.0`
- **THEN** it is polled as `127.0.0.1`

### Requirement: svc-8 — Health polling: healthy classification

THE service SHALL classify a poll as healthy only when the response is 2xx with a JSON object body containing `healthy: true` and a numeric `uptime`; it SHALL then store `{healthy: true, last_checked_at: <ISO-8601 poll time>, last_error: null, uptime}` plus `warning` when the body carries a string `warning`.

#### Scenario: Healthy poll response

- **WHEN** a poll returns a 2xx response with a JSON object body containing `healthy: true` and a numeric `uptime`
- **THEN** the service stores `{healthy: true, last_checked_at: <ISO-8601 poll time>, last_error: null, uptime}`, plus `warning` when the body carries a string `warning`

### Requirement: svc-9 — Health polling: failed poll storage

IF a poll fails, THEN THE service SHALL store `healthy: false`, the poll time as `last_checked_at`, and a `last_error` from the heartbeat-error catalogue (see Contracts), while preserving the previously stored `uptime` and `warning` values.

#### Scenario: Failed poll

- **WHEN** a poll fails (non-2xx, network error, or invalid body)
- **THEN** the service stores `healthy: false`, the poll time as `last_checked_at`, and a `last_error` from the heartbeat-error catalogue, preserving previously stored `uptime` and `warning`

### Requirement: svc-10 — Health polling: initial not-yet-polled state

WHILE a service has not yet been polled, THE service SHALL report its heartbeat as `{healthy: false, last_checked_at: null, last_error: "not checked yet"}`.

#### Scenario: Service not yet polled

- **WHEN** a service has not yet been polled
- **THEN** its heartbeat is reported as `{healthy: false, last_checked_at: null, last_error: "not checked yet"}`

### Requirement: svc-11 — Health polling: observational only

THE health poller SHALL be observational only: it never starts, stops, restarts, or otherwise acts on services.

#### Scenario: Poller observes only

- **WHEN** the health poller runs
- **THEN** it only reads health state and never starts, stops, restarts, or otherwise acts on services

### Requirement: svc-12 — REST surface: GET /api/services

THE service SHALL respond to `GET /api/services` with 200 and a JSON array, in registry order, of presented services: the registry fields (`name`, `host`, `port`, `command`, `home_path` when present) merged with the current heartbeat (`healthy`, `last_checked_at`, `last_error`, plus `uptime`/`warning` when known), plus `home_url = "http://<host>:<port><home_path>"` when `home_path` is present (the raw registry host — `0.0.0.0` is not rewritten server-side).

#### Scenario: List all services

- **WHEN** the service receives `GET /api/services`
- **THEN** it responds 200 with a JSON array in registry order of presented services, each merging registry fields with the current heartbeat and including `home_url` when `home_path` is present

### Requirement: svc-13 — REST surface: GET /api/services/<name>

THE service SHALL respond to `GET /api/services/<name>` with 200 and the single presented service (same shape as a `GET /api/services` element).

#### Scenario: Get single service

- **WHEN** the service receives `GET /api/services/<name>` for a known service
- **THEN** it responds 200 with the single presented service in the same shape as a list element

### Requirement: svc-14 — REST surface: GET /api/services/<name>/health

THE service SHALL respond to `GET /api/services/<name>/health` with 200 and exactly the fields `name`, `healthy`, `last_checked_at`, `last_error`, and (when known) `uptime` and `warning`, taken from the in-memory heartbeat — no live probe is performed.

#### Scenario: Get service health

- **WHEN** the service receives `GET /api/services/<name>/health` for a known service
- **THEN** it responds 200 with exactly `name`, `healthy`, `last_checked_at`, `last_error`, and (when known) `uptime` and `warning` from the in-memory heartbeat, without performing a live probe

### Requirement: svc-15 — REST surface: 404 routing rules

IF a `<name>` path segment names no registered service on any `/api/services/...` or `/services/<name>/logs` route, THEN THE service SHALL respond 404 `{"error": "service not found"}`; IF a request matches no route (including wrong method on a known path), THEN THE service SHALL respond 404 `{"error": "not found"}`. Path segments are URL-decoded before lookup (`with%20space` → `with space`).

#### Scenario: Unknown service name

- **WHEN** a request arrives with a `<name>` that names no registered service on any `/api/services/...` or `/services/<name>/logs` route
- **THEN** the service responds 404 `{"error": "service not found"}`

#### Scenario: Unmatched route or method

- **WHEN** a request matches no route (including wrong method on a known path)
- **THEN** the service responds 404 `{"error": "not found"}`

#### Scenario: URL-decoded path lookup

- **WHEN** a path segment contains percent-encoded characters (e.g. `with%20space`)
- **THEN** it is URL-decoded before service name lookup (`with%20space` → `with space`)

### Requirement: svc-16 — Lifecycle actions: POST /api/services/<name>/start

WHEN it receives `POST /api/services/<name>/start`, THE service SHALL spawn the registry `command` as a detached process with the repository root as working directory, append the child's stdout and stderr to `logs/<name>/<name>_stdout.log` and `logs/<name>/<name>_stderr.log` (creating the directory), remember the child as owned by this conductor instance, and respond 200 with the start result body (see Contracts).

#### Scenario: Start service

- **WHEN** the service receives `POST /api/services/<name>/start`
- **THEN** it spawns the registry `command` as a detached process with the repository root as working directory, appends stdout/stderr to the appropriate log files, records the child as owned, and responds 200 with the start result body

### Requirement: svc-17 — Lifecycle actions: command execution strategy

THE service SHALL execute commands containing any of the shell metacharacters `| & ; < >` via a shell (`argv` reported as the single raw command string); all other commands SHALL be tokenized on whitespace, honoring single and double quotes, and spawned directly.

#### Scenario: Shell metacharacters present

- **WHEN** a registry `command` contains any of `| & ; < >`
- **THEN** the command is executed via a shell with `argv` reported as the single raw command string

#### Scenario: No shell metacharacters

- **WHEN** a registry `command` contains no shell metacharacters
- **THEN** it is tokenized on whitespace (honoring single and double quotes) and spawned directly

### Requirement: svc-18 — Lifecycle actions: start error responses

IF the registry `command` is missing, empty, or whitespace-only, THEN start SHALL respond 400 with `started: false` and `error: "service command is missing or empty"`; IF spawning fails or the command tokenizes to nothing, THEN start SHALL respond 500 with `started: false`, the spawn error message (e.g. `spawn ENOENT`, `empty command`, `spawn returned no pid`), and — when the argv is known — a `process` object with `pid: -1`.

#### Scenario: Command missing or empty

- **WHEN** the registry `command` is missing, empty, or whitespace-only
- **THEN** start responds 400 with `started: false` and `error: "service command is missing or empty"`

#### Scenario: Spawn failure

- **WHEN** spawning fails or the command tokenizes to nothing
- **THEN** start responds 500 with `started: false`, the spawn error message, and a `process` object with `pid: -1` when the argv is known

### Requirement: svc-19 — Lifecycle actions: POST /api/services/<name>/stop

WHEN it receives `POST /api/services/<name>/stop`, THE service SHALL request `POST http://<host>:<port>/exit` on the target (host `0.0.0.0` contacted as `127.0.0.1`, 5-second timeout, default `exitRequestTimeoutMs` 5000) and respond 200 with `stop_requested: true` when the exit request returns 2xx; IF the exit request fails AND this conductor instance previously started the service, THEN it SHALL kill that owned process's pid and respond 200 with `stop_requested: true`; IF the exit request fails and no owned process exists, THEN it SHALL respond 200 with `stop_requested: false` and an `error` (the network error message or `HTTP <status>`). A successful stop forgets the owned process.

#### Scenario: Exit request succeeds

- **WHEN** the service receives `POST /api/services/<name>/stop` and the exit request to the target returns 2xx
- **THEN** it responds 200 with `stop_requested: true` and forgets any owned process

#### Scenario: Exit request fails with owned process

- **WHEN** the exit request fails and this conductor instance previously started the service
- **THEN** it kills the owned process's pid and responds 200 with `stop_requested: true`

#### Scenario: Exit request fails with no owned process

- **WHEN** the exit request fails and no owned process exists
- **THEN** it responds 200 with `stop_requested: false` and an `error` containing the network error message or `HTTP <status>`

### Requirement: svc-20 — Lifecycle actions: POST /api/services/<name>/restart

WHEN it receives `POST /api/services/<name>/restart`, THE service SHALL perform the stop behavior (svc-19) followed by the start behavior (svc-16) and respond with the restart result body (see Contracts): `restart_requested` equals `started`; `error` is the start error, or the stop error when the start did not succeed; a failed stop with a successful start is still a successful restart (200, no `error`). Status mapping follows start: 400 when the error is the missing/empty-command message, 500 for other start failures, 200 otherwise.

#### Scenario: Restart succeeds

- **WHEN** the service receives `POST /api/services/<name>/restart` and both stop and start succeed
- **THEN** it responds 200 with the restart result body, `restart_requested: true`, and no `error`

#### Scenario: Stop fails, start succeeds

- **WHEN** the stop step fails but the start step succeeds
- **THEN** it responds 200 with no `error` (successful restart despite stop failure)

#### Scenario: Start fails

- **WHEN** the start step fails
- **THEN** it responds with the appropriate status (400 for missing/empty command, 500 for other start failures) and the start error in the result body

### Requirement: svc-21 — Lifecycle actions: no supervision

THE lifecycle endpoints SHALL act only on explicit requests: conductor performs no supervision, desired-state reconciliation, or automatic restarts. Lifecycle results embed the heartbeat snapshot taken when the request began, not a post-action probe.

#### Scenario: Explicit request only

- **WHEN** a lifecycle action is triggered
- **THEN** conductor acts only on that explicit request, performs no automatic supervision or restarts, and embeds the heartbeat snapshot taken when the request began

### Requirement: svc-22 — Package surface: npm bin and library entry

THE npm package SHALL expose a `conductor` bin (`dist/src/main.js`) and an importable library entry point (`main`/`exports` → `dist/src/index.js`, types `dist/src/index.d.ts`) re-exporting the public modules (`createRepoPaths`, `loadServiceRegistry`, `HealthPoller`, `createConductorServer`, `LifecycleManager`, ...).

#### Scenario: Package exports

- **WHEN** the npm package is installed
- **THEN** it exposes a `conductor` bin at `dist/src/main.js` and an importable library entry at `dist/src/index.js` with types at `dist/src/index.d.ts`, re-exporting the public modules

### Requirement: svc-23 — Health polling: focused foreground cadence

WHILE at least one foreground heartbeat lease is active, THE health poller SHALL run a full poll cycle every 1 second (default `foregroundPollIntervalMs` 1000) instead of waiting for the normal background interval; when no foreground lease is active, it SHALL preserve the normal 30-second background cadence from svc-7.

#### Scenario: Foreground lease activates fast polling

- **WHEN** a foreground heartbeat lease becomes active
- **THEN** the health poller runs service health poll cycles every 1 second using the same health classification rules as background polling

#### Scenario: No active foreground lease

- **WHEN** no foreground heartbeat lease is active
- **THEN** the health poller uses the normal 30-second background cadence

#### Scenario: Slow poll cycle overlaps next foreground tick

- **WHEN** a foreground poll tick arrives while the previous poll cycle is still running
- **THEN** the health poller skips the overlapping tick rather than queueing another poll cycle

### Requirement: svc-24 — REST surface: foreground heartbeat lease

WHEN the service receives `POST /api/health/foreground-lease` with JSON body `{ "client_id": <non-empty string>, "active": true }`, THE service SHALL renew that client's foreground heartbeat lease for a short expiry window (default `foregroundLeaseTtlMs` 3000), ensure focused foreground polling is scheduled, and respond 200 with `{ "foreground_polling": true, "poll_interval_ms": 1000, "expires_at": <ISO-8601 timestamp> }`.

#### Scenario: Lease renewed

- **WHEN** `POST /api/health/foreground-lease` receives a non-empty `client_id` with `active: true`
- **THEN** the service renews that client's foreground heartbeat lease and responds with the active foreground polling status, poll interval, and lease expiry timestamp

#### Scenario: Lease released

- **WHEN** `POST /api/health/foreground-lease` receives a non-empty `client_id` with `active: false`
- **THEN** the service releases that client's foreground heartbeat lease and responds 200 with `{ "foreground_polling": <whether any other foreground lease remains active>, "poll_interval_ms": 1000 }`

#### Scenario: Lease request invalid

- **WHEN** `POST /api/health/foreground-lease` receives a missing or invalid JSON body, an empty `client_id`, or an `active` value that is not boolean
- **THEN** the service responds 400 `{"error": "invalid foreground heartbeat lease"}`

#### Scenario: Lease expires

- **WHEN** a foreground heartbeat lease is not renewed before its expiry window elapses
- **THEN** the service treats that lease as inactive without requiring an explicit release request

#### Scenario: Foreground lease remains observational

- **WHEN** a foreground heartbeat lease is renewed or released
- **THEN** the service adjusts only health polling cadence and does not start, stop, restart, or synchronously probe any service for that request

### Requirement: svc-25 — Startup: Registered run command bootstraps local dependencies

WHEN the registered `make conductor-run` command is invoked from the repository root, THE Conductor project SHALL run its existing project-local npm install and TypeScript build targets before launching `dist/src/main.js` through `start_conductor.sh`; it SHALL NOT require globally installed project packages or a separate bootstrap mechanism.

#### Scenario: Fresh Mac has no local dependencies

- **WHEN** Node.js and npm are available but `projects/conductor/node_modules` is absent
- **THEN** `make conductor-run` installs the locked project dependencies locally, builds Conductor, and starts the service

#### Scenario: Existing installation is reusable

- **WHEN** local dependencies and compiled output already exist
- **THEN** `make conductor-run` executes the same idempotent install/build workflow and starts the service

#### Scenario: Bootstrap step fails

- **WHEN** npm installation or the TypeScript build fails
- **THEN** the run command exits non-zero with that tool's diagnostic and does not launch Conductor

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

### `POST /api/health/foreground-lease` — 200

Renew:

```json
{
  "foreground_polling": true,
  "poll_interval_ms": 1000,
  "expires_at": "2026-06-16T12:00:03.000Z"
}
```

Release:

```json
{
  "foreground_polling": false,
  "poll_interval_ms": 1000
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
| foreground heartbeat lease: invalid body | 400 | `{"error": "invalid foreground heartbeat lease"}` |
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
  run all services concurrently (`Promise.all`); timers, fetch, and the clock
  are injectable for tests. Foreground heartbeat leases switch the scheduler
  from the 30-second background cadence to the 1-second foreground cadence
  while at least one unexpired lease remains active; overlapping scheduled
  cycles are skipped.
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
  `missing or empty`. `POST /api/health/foreground-lease` validates
  `client_id`/`active` and renews or releases foreground polling leases.
- `src/shutdown.ts` — `createShutdownController`; `wasShutdownRequested`
  makes repeat `/exit` calls no-ops.
- Tests: `tests/registry.test.ts`, `tests/health.test.ts`,
  `tests/service_rest.test.ts`, `tests/lifecycle.test.ts`,
  `tests/process_runner.test.ts`, `tests/scaffold.test.ts` (pins the real
  registry entry and package metadata).

## Interactions

- [log-access](../conductor-log-access/spec.md) — reads the `logs/<name>/` directories that
  start (svc-16) writes into; shares the 404 service-lookup rule (svc-15).
- [web-ui](../conductor-web-ui/spec.md) — the main page renders `GET /api/services` and drives
  the lifecycle endpoints.
- [structure/services.md](../../../structure/services.md) — the registry
  format and the `/health` + `/exit` contract conductor both implements and
  relies on when polling and stopping services.
