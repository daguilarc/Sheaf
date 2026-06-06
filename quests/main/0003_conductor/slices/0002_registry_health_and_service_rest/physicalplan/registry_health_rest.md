# Physical Plan: Registry, Health Polling, And Service REST

## Objective

Implement the Conductor backend service core: read registered services from `config/services.json`, expose Conductor's own registered-service lifecycle endpoints (`GET /health` and `POST /exit`), poll every registered service's `GET /health` endpoint every 30 seconds, maintain in-memory heartbeat state, and expose read-only service REST APIs.

Expected outcome:

- `npm --prefix projects/conductor start` starts a server bound to the `conductor` entry's configured host and port, currently `0.0.0.0:9001`.
- `GET /health` returns Conductor's own standard health shape.
- `POST /exit` returns a clean shutdown acknowledgement and then stops the Conductor HTTP server so Conductor satisfies the same registered-service lifecycle contract it expects from other services.
- The polling loop polls every service in `config/services.json`, including Conductor itself when registered, without starting/stopping/restarting anything.
- Latest heartbeat state is kept only in memory.
- `GET /api/services`, `GET /api/services/{service_name}`, and `GET /api/services/{service_name}/health` return the specified shapes and `404` unknown services.

## Key Files And Systems

- Extend `projects/conductor/src/main.ts` to start the HTTP server.
- Add `projects/conductor/src/server.ts` for server construction with injectable dependencies for tests.
- Add `projects/conductor/src/service_registry.ts` for loading and validating `config/services.json`.
- Add `projects/conductor/src/health_poller.ts` for heartbeat polling and in-memory state.
- Add `projects/conductor/src/shutdown.ts` or an equivalent injectable shutdown controller for `POST /exit`.
- Add `projects/conductor/src/http_json.ts` or equivalent small HTTP helpers for JSON responses and request routing.
- Add `projects/conductor/src/service_presenter.ts` or equivalent mapping from registry plus heartbeat state to API response shapes.
- Add tests under `projects/conductor/tests/registry*.ts`, `health*.ts`, and `service_rest*.ts`.

## Existing APIs To Reuse As-Is

- Reuse `ServiceDefinition` and path helpers from slice 0001.
- Reuse Node's built-in `http` server and URL parsing unless the implementation has already introduced a framework in slice 0001. Keep routing small and explicit because the required API surface is narrow.
- Reuse Node 20+ `fetch`/`AbortController` for health polling.
- Reuse Node's built-in `node:test` and `assert/strict` for automated tests.
- Reuse `config/services.json` as the only source of service definitions; do not cache a separate service registry to disk.

## APIs To Define Or Extend

Define registry loading:

- `LoadServiceRegistry(options)` reads a JSON array from `config/services.json`.
- Validate each entry has string `name`, string `host`, numeric integer `port`, string `command`, and optional string `home_path`.
- Reject duplicate service names with a structured error.
- Return normalized service definitions without adding fields not present in the registry.

Define heartbeat state:

- `HeartbeatState` includes:
  - `healthy: boolean`
  - `last_checked_at: string | null`
  - `last_error: string | null`
  - optional latest response fields `uptime` and `warning`
- Initial state for a known service before the first poll should be unhealthy or unknown in a consistent API shape; prefer `healthy: false`, `last_checked_at: null`, and `last_error: "not checked yet"` so the UI has deterministic data.

Define health polling:

- Poll every service returned by the registry, including Conductor.
- Build each health URL from `host`, `port`, and `/health`.
- Use `127.0.0.1` or `localhost` only for client-side polling when the configured host is `0.0.0.0`, because `0.0.0.0` is a bind address rather than a reliable outbound target.
- Treat only 2xx responses with valid JSON containing `healthy: true` as healthy.
- Treat `healthy: false`, missing `healthy`, invalid JSON, missing required fields, non-2xx responses, timeouts, and network errors as unhealthy.
- Preserve a timestamp for every successful or failed poll.
- Do not start, stop, or restart services from this loop.
- Expose test hooks to run one poll cycle manually and to use fake fetch/timer implementations.

Define REST APIs:

- `GET /health` returns `{ healthy: true, uptime: <seconds> }` plus optional `warning` when the service wants to report one.
- `POST /exit` returns a JSON acknowledgement such as `{ exiting: true }`, stops accepting new HTTP requests after the response is flushed, stops the health polling loop, closes the HTTP server, and exits the process in the CLI entry point. In tests, inject a shutdown controller so assertions can verify shutdown was requested without terminating the test process.
- `GET /api/services` returns every registry service merged with heartbeat state, latest `uptime`/`warning` when available, and derived `home_url` when `home_path` exists.
- `GET /api/services/{service_name}` returns one merged service object or `404`.
- `GET /api/services/{service_name}/health` returns `name`, `healthy`, `last_checked_at`, `last_error`, `uptime`, and `warning` from heartbeat data only; it must not perform a synchronous live check.
- Unknown routes return a JSON `404`.

For `home_url`, derive `http://<host>:<port><home_path>` from the registry. Use the configured host in the API response; browser UI work can later transform `0.0.0.0` links to the current hostname if necessary.

## Enabling Refactor

If the initial scaffold's config/path helpers are too narrow, extend them here rather than duplicating repo-root resolution in each module. Keep the server factory dependency-injectable so lifecycle and log tests in later slices can reuse it without binding real port `9001`. The shutdown controller must also be injectable so later lifecycle tests can exercise `POST /api/services/conductor/stop` without killing the test runner.

## Validation

- Unit tests cover service registry loading from `config/services.json`, malformed JSON, invalid entries, and duplicate names.
- Unit tests cover Conductor's own `GET /health` response shape and uptime increasing from the injected start time.
- Unit tests cover Conductor's own `POST /exit` response shape, shutdown-controller invocation, poller stop behavior, and that the response is sent before shutdown work runs.
- Health poller tests cover:
  - healthy 2xx JSON with `healthy: true`
  - explicit unhealthy health response
  - invalid JSON
  - missing required fields
  - non-2xx response
  - network failure or timeout
- REST API tests cover service list, single service detail, heartbeat-derived service health, derived `home_url`, and unknown service `404`.
- `npm run build` and `npm test` pass in `projects/conductor`.

## Sequencing Notes

This slice depends on slice 0001. Slice 0003 should reuse the registry, server factory, response helpers, and heartbeat presenter from this slice.
