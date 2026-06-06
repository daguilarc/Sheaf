# Conductor And Web Projects

## Quest Overview

Create the first two `projects/` entries for the command hub vision described in
`structure/`:

- `projects/conductor/`: the service manager and web service for observing and
  controlling registered services.
- `projects/web/`: shared web UI assets used by command hub browser interfaces.

The Conductor backend owns service-management logic and the Conductor web UI.
The `web` project owns shared CSS and related static assets only. Project-specific
Conductor behavior must stay in `projects/conductor/`.

The structure docs are part of the pre-quest specification context. Do not make
unrelated changes to `structure/` while this quest runs.

## Goals

- Create `projects/conductor/` following the required project layout.
- Create `projects/web/` following the required project layout.
- Implement a Conductor backend service on `0.0.0.0:9001` (registered in config/services.json)
- Read service definitions from `config/services.json`.
- Poll every registered service's `GET /health` endpoint every 30 seconds.
- Maintain in-memory heartbeat state for service health.
- Provide REST APIs for Conductor health, service health, service details, start,
  stop, restart, and log file listing.
- Provide a WebSocket API for browser log viewing that supports tailing new
  output and loading earlier file ranges on demand.
- Provide a Conductor web UI that lists services, shows health state, links to
  logs, links to service home pages when `home_path` is present, and exposes
  start, stop, and restart controls.
- Put generic CSS and shared browser assets in `projects/web/`.
- Add project-local docs for both new projects.
- Add focused automated tests for the backend service registry, health polling,
  lifecycle APIs, and log APIs.

## Non-Goals

- Do not build a persistent service database.
- Do not auto-start services just because they are listed in `config/services.json`.
- Do not decide desired service state or implement a supervisor policy in this
  quest.
- Do not move existing top-level code into `projects/`.
- Do not add project quests under `projects/web/`; create the required `quests/`
  directory, but leave it empty except for placeholder files if needed.
- Do not implement advanced reusable chat UI components yet.

## Project Layout

Create both projects according to `structure/repo-layout.md` and
`structure/project-rules.md`.

Required Conductor layout:

```text
projects/conductor/
  README.md
  quests/
  src/
  tests/
  docs/
```

Required Web layout:

```text
projects/web/
  README.md
  quests/
  src/
  tests/
  docs/
```

The `web` project may start small. It should include shared CSS and any static
asset organization needed by the Conductor UI. Its docs can start with a simple
`docs/README.md` that describes the current shared asset surface.

## Service Registry

Conductor must read `config/services.json` as the source of registered services.
It must not maintain a separate service list.

Each service entry uses the structure-level service schema:

- `name`
- `host`
- `port`
- `command`
- optional `home_path`

The Conductor service itself should be registered in `config/services.json` with:

- `name`: `conductor`
- `host`: `0.0.0.0`
- `port`: `9001`
- `home_path`: the Conductor web UI root
- `command`: a repo-root-relative command that starts the backend

## Health Polling

Conductor must poll each registered service every 30 seconds by calling the
service's `GET /health` endpoint at its configured host and port.

Polling behavior:

- Poll all services from `config/services.json`, including Conductor itself when
  registered.
- Store the latest heartbeat result in memory.
- Treat a successful health response with `healthy: true` as healthy.
- Treat network errors, timeouts, invalid JSON, missing required fields, and
  non-2xx responses as unhealthy.
- Preserve the last successful or failed heartbeat timestamp for each service.
- Do not persist heartbeat state to disk.
- Do not start, stop, or restart services from the polling loop.

Expected registered-service `GET /health` response:

```json
{
  "healthy": true,
  "uptime": 123.45,
  "warning": "optional human-readable warning"
}
```

`uptime` is measured in seconds. `warning` is optional.

## REST API

The Conductor backend must listen on `0.0.0.0:9001` and expose JSON REST APIs.

### Conductor Health

```text
GET /health
```

Returns Conductor's own health using the standard service health shape:

```json
{
  "healthy": true,
  "uptime": 123.45,
  "warning": "optional human-readable warning"
}
```

### List Services

```text
GET /api/services
```

Returns all services from `config/services.json` with their latest in-memory
heartbeat state.

Each service object should include:

- service registry fields from `config/services.json`
- `healthy`
- `last_checked_at`
- `last_error`
- latest health response fields when available, including `uptime` and `warning`
- derived `home_url` when `home_path` is present

### Get Service Information

```text
GET /api/services/{service_name}
```

Returns the registered service details from `config/services.json` plus latest
heartbeat state. Unknown services return `404`.

### Get Service Health

```text
GET /api/services/{service_name}/health
```

Returns whether the service is healthy based on Conductor's heartbeat data, not by
performing a synchronous live health check for the request.

The response should include:

- `name`
- `healthy`
- `last_checked_at`
- `last_error`
- `uptime`
- `warning`

Unknown services return `404`.

### Start Service

```text
POST /api/services/{service_name}/start
```

Starts the service by running its configured `command` from the repository root.
This API is user-initiated service control, not an automatic desired-state policy.

The response should include:

- `name`
- `action`
- `started`
- process information when available
- the current or most recent heartbeat state

Unknown services return `404`. Services without a valid command return a
structured error.

### Stop Service

```text
POST /api/services/{service_name}/stop
```

Requests a clean stop for the service. Prefer the registered service lifecycle
endpoint `POST /exit` when reachable.

The response should include:

- `name`
- `action`
- `stop_requested`
- the current or most recent heartbeat state

Unknown services return `404`.

### Restart Service

```text
POST /api/services/{service_name}/restart
```

Requests a clean stop and then starts the service using its configured `command`.

The response should include:

- `name`
- `action`
- `restart_requested`
- process information when available
- the current or most recent heartbeat state

Unknown services return `404`.

### List Service Logs

```text
GET /api/services/{service_name}/logs
```

Lists log files for a service. The initial log directory convention is
`logs/<service_name>/`, matching the structure-level runtime output rules for
projects whose service name matches their project name.

The response should include:

- `name`
- `log_root`
- `files`

Each file entry should include:

- path relative to `log_root`
- size in bytes
- last modified timestamp

The implementation must reject path traversal and must not expose files outside
the resolved service log root.

## Log WebSocket API

Provide a WebSocket API for reading service log files in the browser.

```text
GET /api/services/{service_name}/logs/stream
```

The client selects a log file using an initial message rather than embedding an
unsafe path directly in the URL.

Client messages:

```json
{
  "type": "open",
  "file": "server.log",
  "tail_bytes": 65536
}
```

```json
{
  "type": "read_before",
  "before": 1048576,
  "max_bytes": 65536
}
```

```json
{
  "type": "follow",
  "enabled": true
}
```

Server messages:

```json
{
  "type": "chunk",
  "file": "server.log",
  "start": 983040,
  "end": 1048576,
  "text": "..."
}
```

```json
{
  "type": "append",
  "file": "server.log",
  "start": 1048576,
  "end": 1049000,
  "text": "..."
}
```

```json
{
  "type": "error",
  "message": "human-readable error"
}
```

Required behavior:

- On `open`, send only the requested tail window, not the entire file.
- While follow mode is enabled, send appended data as new log bytes are written.
- On `read_before`, send an earlier byte range so the browser can load scrollback
  as the user scrolls upward.
- Keep byte offsets stable so the UI can request additional earlier chunks.
- Handle file truncation or rotation gracefully by sending a clear event and
  allowing the client to reopen.
- Reject unknown services, unknown files, absolute paths, and path traversal.

## Web UI

Conductor must provide a browser UI served by the Conductor backend.

The main page should:

- List every service from `config/services.json`.
- Show current health state from Conductor's heartbeat data.
- Display `uptime` and `warning` when available.
- Provide a link to each service's logs page.
- Provide a link to each service's `home_path` when present.
- Provide start, stop, and restart controls.

The logs page should:

- Show available log files for the selected service.
- Open a selected log file without downloading the entire file.
- Tail new log entries while follow mode is enabled.
- Allow the user to scroll upward and load earlier chunks on demand.
- Make it clear when the service has no logs yet.
- Use shared CSS from `projects/web/`.

The UI can be simple and server-rendered or static with browser JavaScript. It
should avoid introducing frontend framework complexity unless the implementation
already needs it.

## Documentation

Add project-local docs for current behavior created by this quest.

Conductor docs should include:

- `projects/conductor/docs/README.md`
- a reference document for REST and WebSocket APIs
- a short operations document explaining service registry use, health polling,
  lifecycle controls, and log viewing

Web docs should include:

- `projects/web/docs/README.md`
- a brief description of shared CSS and asset usage

The root structure docs should be treated as existing input for this quest.

## Testing

Add automated tests appropriate to the implementation language and framework.

Tests should cover:

- service registry loading from `config/services.json`
- Conductor's own `GET /health` response shape
- health polling success, unhealthy response, invalid response, and network
  failure cases
- service info and service health REST APIs
- start, stop, and restart API behavior using controllable test doubles rather
  than launching arbitrary long-running processes
- log file listing, including path traversal rejection
- WebSocket log opening, tail chunk delivery, read-before chunk delivery, and
  appended data delivery

## Acceptance Criteria

- `projects/conductor/` exists and follows the required project layout.
- `projects/web/` exists and follows the required project layout.
- `projects/web/` contains the shared CSS and related assets used by the
  Conductor UI.
- `projects/web/quests/` exists but contains no active quest records.
- `config/services.json` includes a Conductor service entry for `0.0.0.0:9001`.
- The Conductor backend binds to `0.0.0.0:9001`.
- Conductor exposes its own `GET /health` endpoint with `healthy`, `uptime`, and
  optional `warning`.
- Conductor polls registered services every 30 seconds and stores latest
  heartbeat state in memory.
- Conductor does not auto-start services from the polling loop.
- REST APIs list services, get service info, get heartbeat-derived health, start,
  stop, restart, and list logs.
- The log WebSocket supports initial tail reads, live appended data, and loading
  earlier ranges without sending the whole file upfront.
- The main UI lists services, state, uptime, warnings, logs links, home links when
  `home_path` exists, and start/stop/restart controls.
- The logs UI tails logs and supports scrollback loading.
- Project-local docs describe the created Conductor and Web behavior.
- Tests cover the backend contracts, health polling, lifecycle controls, and log
  streaming behavior.
