# Physical Plan: Web UI, Documentation, And Integration

## Objective

Serve the Conductor browser UI, wire it to the REST and WebSocket APIs, consume shared CSS from `projects/web/`, add current-state project documentation, and run end-to-end validation for the completed quest behavior.

Expected outcome:

- The Conductor backend serves a main UI at `/`.
- The main UI lists all services from `config/services.json`, shows heartbeat health, uptime, warnings, log links, home links when `home_path` exists, and start/stop/restart controls.
- The logs UI lists available log files, opens a selected file without downloading the whole file, tails appended data while follow is enabled, loads earlier ranges as the user scrolls upward, and clearly handles services with no logs.
- The UI uses shared CSS/static assets from `projects/web/`; project-specific behavior remains in `projects/conductor/`.
- Project-local docs describe the Conductor REST/WebSocket APIs, operations behavior, and Web shared CSS/assets.
- Final tests/checks cover the full backend/UI integration path required by the spec.

## Key Files And Systems

- Add `projects/conductor/src/ui.ts` or `projects/conductor/src/static.ts` for serving HTML, JavaScript, and shared CSS assets.
- Add project-specific browser code under `projects/conductor/src/ui/` if using static browser assets compiled/copied by the package build.
- Extend `projects/conductor/src/server.ts` routes for:
  - `GET /`
  - `GET /services/{service_name}/logs` or another clean human-facing logs page URL
  - shared CSS asset serving from `projects/web/src/`
  - project-specific browser JavaScript assets
- Add or extend tests under `projects/conductor/tests/ui*.ts` and integration tests that exercise server routes with fake registry/heartbeat/log dependencies.
- Update `projects/conductor/README.md`.
- Update `projects/conductor/docs/README.md`.
- Add `projects/conductor/docs/reference/api.md`.
- Add `projects/conductor/docs/how-to/operations.md` or `projects/conductor/docs/explanation/operations.md`; prefer `how-to/operations.md` if written as operator instructions.
- Update `projects/web/README.md`.
- Update `projects/web/docs/README.md`.

## Existing APIs To Reuse As-Is

- Reuse REST APIs from slices 0002 and 0003 for service data, lifecycle actions, and log file lists.
- Reuse the WebSocket contract from slice 0004 for log file viewing.
- Reuse shared CSS/static assets from `projects/web/src/`.
- Reuse the Conductor server factory and route helpers from earlier slices.
- Reuse structure docs through links rather than restating repo-wide rules in project docs.

## APIs To Define Or Extend

Define served UI routes:

- `GET /` returns the main Conductor page.
- The main page fetches `GET /api/services` and renders every registered service.
- Each service row/card includes:
  - service name
  - health state based on heartbeat data
  - `last_checked_at` and `last_error` where useful
  - `uptime` and `warning` when present
  - link to the logs page
  - link to the derived service home URL when `home_path` is present
  - start, stop, and restart controls that call the lifecycle APIs and refresh the row/list state
- For home links whose API `home_url` host is `0.0.0.0`, browser code should display/navigate using the current page hostname with the service port, because browsers cannot use `0.0.0.0` as a meaningful remote origin in all contexts.

Define logs UI behavior:

- Logs page URL includes the service name in a route or query parameter, but the selected log file path is sent only as a WebSocket `open` message.
- On load, fetch `GET /api/services/{service_name}/logs`.
- If `files` is empty, render a clear no-logs state without opening a WebSocket file.
- Selecting a file opens `/api/services/{service_name}/logs/stream`, sends `open` with the selected relative file and `tail_bytes: 65536`, and renders returned chunks.
- Follow mode uses `{ type: "follow", enabled: true|false }`.
- Upward scrollback sends `{ type: "read_before", before: <earliest_loaded_start>, max_bytes: 65536 }` and prepends returned chunks while preserving scroll position as practical.
- WebSocket `error` messages are shown to the user, including truncation/rotation notices, and the UI allows reopening the file.
- The browser must not request file contents through query-string file paths or any REST endpoint that would bypass slice 0004 validation.

Define documentation:

- `projects/conductor/docs/reference/api.md` is the canonical REST and WebSocket API reference and documents:
  - `GET /health`
  - `GET /api/services`
  - `GET /api/services/{service_name}`
  - `GET /api/services/{service_name}/health`
  - lifecycle `POST` APIs
  - `GET /api/services/{service_name}/logs`
  - WebSocket `/api/services/{service_name}/logs/stream`
  - response shapes, error behavior, and log path safety rules
- Conductor operations doc explains:
  - service registry use through `config/services.json`
  - 30-second health polling
  - heartbeat state is in memory only
  - polling does not auto-start services
  - start/stop/restart are user-initiated
  - log listing and log viewing behavior
- `projects/web/docs/README.md` describes the shared CSS/static asset surface and how Conductor consumes it.

## Enabling Refactor

If server asset handling would otherwise duplicate route code, add a small static-file helper constrained to known asset roots. It must not become a general file server that can expose arbitrary repository files.

## Validation

- UI route tests verify `/` serves HTML referencing shared CSS and project-specific JavaScript.
- UI route tests verify the logs page route serves HTML and does not embed unsafe file paths.
- Browser JavaScript tests can be lightweight string/unit tests if no DOM test framework is introduced; otherwise validate by HTTP/API integration tests and manual browser smoke notes.
- Integration tests verify:
  - main UI can fetch and render service list data through the existing API route
  - lifecycle controls call the correct `POST` endpoints
  - logs UI obtains file list from REST and file contents only from the WebSocket stream
  - no-logs state is represented when `files` is empty
- Documentation review checks confirm required Conductor and Web docs exist and describe current behavior, not future backlog.
- Final `npm run build` and `npm test` pass in `projects/conductor`.
- Final manual smoke check:
  - run `npm --prefix projects/conductor start`
  - confirm the service binds to `0.0.0.0:9001`
  - open `http://127.0.0.1:9001/`
  - confirm `GET /health`, service list, logs page, and WebSocket log tailing work against local test logs.

## Sequencing Notes

This is the final implementation slice and depends on slices 0001 through 0004. It should not add new backend contracts except small UI-serving routes; if it discovers missing backend behavior from the spec, fix that behavior in the existing backend modules rather than creating UI-only workarounds.
