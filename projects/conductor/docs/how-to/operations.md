# Conductor Operations

This guide covers day-to-day operation of the Conductor service manager.

## Service Registry

Conductor reads registered services from `config/services.json` at startup. It does not
maintain a separate service list. Each entry includes `name`, `host`, `port`, `command`,
and optional `home_path`.

Conductor itself is registered as the `conductor` service on `0.0.0.0:9001` with
`home_path` set to `/`. Start it from the repository root:

```bash
npm --prefix projects/conductor install
npm --prefix projects/conductor run build
make conductor-run
```

`make conductor-run` delegates to `start_conductor.sh`, which appends Conductor output to:

- `logs/conductor/conductor_stdout.log`
- `logs/conductor/conductor_stderr.log`

The registered command in `config/services.json` is also repository-root relative:

```json
{
  "name": "conductor",
  "host": "0.0.0.0",
  "port": 9001,
  "home_path": "/",
  "command": "make conductor-run"
}
```

When Conductor starts another registered service, it appends that service's stdout and
stderr to `logs/<service_name>/<service_name>_stdout.log` and
`logs/<service_name>/<service_name>_stderr.log`.

## Health Polling

Conductor polls every registered service's `GET /health` endpoint every 30 seconds,
including itself when registered. Results are stored in memory only; nothing is written
to disk.

Polling behavior:

- Successful responses with `healthy: true` mark the service healthy.
- Network errors, timeouts, invalid JSON, missing required fields, `healthy: false`, and
  non-2xx responses mark the service unhealthy.
- The latest `last_checked_at`, `last_error`, `uptime`, and `warning` values are kept
  per service.
- Polling never auto-starts, stops, or restarts services.

Use the main UI at `/` or `GET /api/services` to inspect current heartbeat state.

## Lifecycle Controls

Start, stop, and restart are user-initiated through the UI or REST APIs:

- **Start** runs the service `command` from the repository root.
- **Stop** prefers the registered service `POST /exit` endpoint when reachable.
- **Restart** requests stop, then start.

Conductor does not enforce desired state or supervise processes beyond these explicit
requests.

Services with a missing or empty command cannot be started or restarted and return a
structured error. Unknown service names return `404`.

### Stopping Conductor

Conductor exposes `POST /exit` like other registered services. Stopping or restarting the
`conductor` service ends the Conductor backend process after the response is sent. That
also stops the browser UI served from the same process, so the page making the request
will lose its connection once shutdown completes.

## Log Viewing

Service logs live under `logs/<service_name>/` at the repository root. Conductor lists
available files through `GET /api/services/{service_name}/logs`.

The logs UI at `/services/{service_name}/logs`:

1. Loads the file list from the REST endpoint.
2. Shows a clear empty state when no files exist.
3. Opens a selected file over `/api/services/{service_name}/logs/stream` with an
   `open` message (not via query-string file paths).
4. Tails appended output while follow mode is enabled.
5. Loads earlier ranges when you scroll to the top of the log view.

If a file is truncated or rotated, the stream sends an error message and the UI allows
reopening the file.

Log paths must stay inside the service log root. Absolute paths, `..` traversal,
directories, non-files, and symlinks that resolve outside `logs/<service_name>/` are
rejected.

## Testing

Run the Conductor test suite from the repository root:

```bash
npm --prefix projects/conductor test
```

The suite covers service registry loading, health polling, service REST APIs, lifecycle
controls with fakes, log listing, WebSocket log streaming, static assets, and UI routes.

## Shared UI Assets

The Conductor UI uses shared CSS from `projects/web/src/sheaf.css`, served at
`/assets/web/sheaf.css`. Project-specific HTML and JavaScript remain under
`projects/conductor/`.

See [reference/api.md](reference/api.md) for REST and WebSocket details.
