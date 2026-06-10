# Conductor Architecture

Scope: cross-capability design of the conductor service manager
(`projects/conductor`). Behavior that must survive a rebuild is specified in
the [capability files](README.md#capability-map), not here.

## Process model

Conductor is one Node.js (>= 20) process with a single runtime dependency
(`ws`). TypeScript sources in `src/` compile to `dist/` (`tsc`, NodeNext
modules); the service entry point is `src/main.ts` → `dist/src/main.js`. The
package is also consumable as a library (`src/index.ts` re-exports every
module) — the test suite and any embedder build servers from the same parts
the binary uses, injecting fakes (fetch, spawn, timers) through options
objects.

Startup is linear: discover the repository root (walk upward until a directory
contains both `config/services.json` and `structure/`, `src/paths.ts`), load
and validate the registry (`src/service_registry.ts`), find the `conductor`
entry, construct the health poller and the HTTP server, bind, start polling.
All state — heartbeat map, the map of processes conductor itself spawned, open
log-stream sessions — is in memory. Conductor writes nothing to disk except
the stdout/stderr log files of services it starts; a restart forgets
everything and rebuilds state from the registry plus fresh polls.

## Components

- `src/main.ts` — entry point wiring; exits non-zero on startup failure.
- `src/service_registry.ts`, `src/service_definition.ts` — registry load and
  shape validation.
- `src/health_poller.ts` — `HealthPoller`, the in-memory heartbeat map and the
  poll loop. Purely observational; nothing else reads or writes heartbeats.
- `src/server.ts` — the single HTTP route table plus the WebSocket upgrade
  hook; owns the `acceptingConnections` flag used during shutdown.
- `src/service_presenter.ts` — merges registry entries with heartbeats into
  the JSON shapes the REST API returns.
- `src/lifecycle.ts` — `LifecycleManager` (start/stop/restart),
  `createExitRequester` (POST `/exit` to a target service), command
  validation.
- `src/process_runner.ts` — command tokenizing, shell-vs-direct spawn
  decision, detached spawn with stdout/stderr appended to the service's log
  files.
- `src/logs.ts` — recursive log listing and the path-safety validation used
  by both the REST listing and the stream.
- `src/log_stream.ts`, `src/websocket.ts` — `LogStreamSession` (byte-range
  reads, follow polling, truncation detection) and its `ws` wiring.
- `src/static.ts`, `src/ui.ts`, `src/ui_helpers.ts`, `src/ui/*.js` — static
  asset allow-listing, server-rendered HTML shells, and the two browser
  scripts.
- `src/http_json.ts` — JSON response helpers; `sendJsonAfterFlush` is what
  lets `POST /exit` answer before shutting down.
- `src/shutdown.ts` — idempotent shutdown controller: stop poller, close
  server, exit process.

## Key decisions

- **The registry is the only configuration.** No conductor-specific config
  file, flags, or environment variables; host and port come from conductor's
  own entry in `config/services.json` (see
  [structure/services.md](../../../structure/services.md)). Poll and timeout
  intervals are constructor options with fixed defaults, reachable only by
  embedding the library.
- **Observation and control are separate.** The poller never acts on what it
  sees; lifecycle actions happen only on explicit API/UI requests. There is no
  desired-state reconciliation or supervision.
- **Stop is cooperative first.** Stopping a service prefers the
  registry-mandated `POST /exit`; killing a PID is a fallback used only for
  processes this conductor instance spawned itself.
- **Log file paths never travel in URLs.** The REST surface only lists files;
  contents are read over a WebSocket where the client names files in messages,
  and every path is validated against the service's log root (including
  symlink resolution) before any read.
- **The UI is served by the thing it controls.** Stopping or restarting the
  `conductor` service tears down the page that requested it; the response is
  flushed before shutdown so the action still reports success.
