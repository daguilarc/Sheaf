# Conductor Docs

## Overview

Conductor is the command hub service manager. It reads `config/services.json`, polls
registered service health every 30 seconds, exposes REST and WebSocket APIs, and serves
a browser UI for observing and controlling services.

Start Conductor from the repository root:

```bash
npm --prefix projects/conductor install
npm --prefix projects/conductor run build
npm --prefix projects/conductor start
```

The service binds to `0.0.0.0:9001` and serves the main UI at `/`.

## Package Layout

```text
projects/conductor/
  src/
    main.ts               service entry point
    server.ts             HTTP, WebSocket, and UI routes
    health_poller.ts      30-second heartbeat polling
    lifecycle.ts          start/stop/restart controls
    logs.ts               log file listing and path validation
    log_stream.ts         WebSocket log byte-range reads
    websocket.ts          log stream WebSocket wiring
    static.ts             constrained static asset serving
    ui.ts                 HTML page templates
    ui_helpers.ts         UI route helpers
    ui/                   browser JavaScript (main.js, logs.js)
  tests/                  automated backend and UI route tests
  docs/
    reference/api.md      REST and WebSocket API reference
    how-to/operations.md  operator guide
```

Shared presentation assets come from `projects/web/`; see
[projects/web/docs/README.md](../../web/docs/README.md).

## Runtime Model

`config/services.json` is the service registry. Conductor reads it at startup and does
not maintain a separate service database. Each service entry includes `name`, `host`,
`port`, `command`, and optional `home_path`.

The health poller stores heartbeat state in memory. It polls every registered service's
`GET /health` endpoint every 30 seconds and treats network errors, timeouts, invalid
JSON, missing required fields, non-2xx responses, and `healthy: false` responses as
unhealthy. Polling is observational only; lifecycle actions happen only through UI or
API requests.

Service logs are read from `logs/<service_name>/` under the repository root. Log APIs
validate paths before reading and never use log file paths from URL query strings.

## Build And Test

From the repository root:

```bash
npm --prefix projects/conductor install
npm --prefix projects/conductor test
```

The test command builds TypeScript and runs Node's built-in test runner against the
compiled backend, log streaming, lifecycle, registry, REST, and UI route tests.

## Documentation

- [Runtime architecture](reference/runtime.md)
- [REST and WebSocket API reference](reference/api.md)
- [Operations guide](how-to/operations.md)

## Related Structure Docs

Repository-wide rules for services, logging, and project layout live under `structure/`.
This project docs directory describes the Conductor service manager as it exists in this
repository.
