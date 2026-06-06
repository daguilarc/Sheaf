# Conductor Docs

## Overview

Conductor is the command hub service manager. It reads `config/services.json`, polls
registered service health every 30 seconds, exposes REST and WebSocket APIs, and serves
a browser UI for observing and controlling services.

Start Conductor from the repository root:

```bash
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

## Documentation

- [REST and WebSocket API reference](reference/api.md)
- [Operations guide](how-to/operations.md)

## Related Structure Docs

Repository-wide rules for services, logging, and project layout live under `structure/`.
This project docs directory describes Conductor behavior implemented in this quest.
