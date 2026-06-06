# Conductor REST and WebSocket API Reference

Conductor listens on `0.0.0.0:9001` (see `config/services.json`) and exposes JSON REST
endpoints plus a WebSocket log streaming endpoint. All paths below are relative to the
Conductor origin.

## Conductor Health

```http
GET /health
```

Returns Conductor's own health using the standard registered-service shape:

```json
{
  "healthy": true,
  "uptime": 123.45,
  "warning": "optional human-readable warning"
}
```

`uptime` is measured in seconds. `warning` is optional.

## Conductor Exit

```http
POST /exit
```

Registered-service lifecycle endpoint. Conductor acknowledges the request and then shuts
down its HTTP server and polling loop. Because the browser UI is served by Conductor,
stopping or restarting the `conductor` service interrupts the UI that initiated the
request after the JSON response is flushed.

Response:

```json
{
  "exiting": true
}
```

## List Services

```http
GET /api/services
```

Returns every service from `config/services.json` merged with Conductor's latest
in-memory heartbeat state.

Each service object includes registry fields (`name`, `host`, `port`, `command`, optional
`home_path`) plus:

- `healthy`
- `last_checked_at` (ISO-8601 timestamp or `null`)
- `last_error` (string or `null`)
- `uptime` and `warning` when the latest health response provided them
- `home_url` when `home_path` is present (`http://{host}:{port}{home_path}`)

## Get Service

```http
GET /api/services/{service_name}
```

Returns one registered service with heartbeat fields. Unknown services respond with
`404` and `{ "error": "service not found" }`.

## Get Service Health

```http
GET /api/services/{service_name}/health
```

Returns heartbeat-derived health for the named service. Conductor does not perform a
synchronous live health check for this request.

Response fields:

- `name`
- `healthy`
- `last_checked_at`
- `last_error`
- `uptime` (optional)
- `warning` (optional)

Unknown services return `404`.

## Lifecycle Controls

All lifecycle endpoints are user-initiated. Conductor does not start, stop, or restart
services from the background polling loop.

### Start

```http
POST /api/services/{service_name}/start
```

Runs the service `command` from the repository root.

Response includes `name`, `action: "start"`, `started`, optional process information,
and the current heartbeat snapshot. Unknown services return `404`. Services with a
missing or empty command return `400`.

### Stop

```http
POST /api/services/{service_name}/stop
```

Requests a clean stop, preferring the registered service `POST /exit` endpoint when
reachable.

Response includes `name`, `action: "stop"`, `stop_requested`, and heartbeat fields.
Unknown services return `404`.

### Restart

```http
POST /api/services/{service_name}/restart
```

Requests stop followed by start using the configured command.

Response includes `name`, `action: "restart"`, `restart_requested`, optional process
information, and heartbeat fields. Unknown services return `404`.

## List Service Logs

```http
GET /api/services/{service_name}/logs
```

Lists files under `logs/<service_name>/` relative to the repository root.

Response:

```json
{
  "name": "alpha",
  "log_root": "logs/alpha/",
  "files": [
    {
      "path": "server.log",
      "size": 4096,
      "modified_at": "2026-06-06T12:00:00.000Z"
    }
  ]
}
```

Path safety rules:

- Only files inside the resolved service log root are listed.
- Absolute paths, `..` segments, and other traversal attempts are rejected.
- Missing log directories return an empty `files` array.
- Non-files are ignored.

Unknown services return `404`.

## Log WebSocket Stream

```text
GET /api/services/{service_name}/logs/stream
```

Upgrade to WebSocket. The client selects a log file with messages rather than embedding
file paths in the URL.

### Client Messages

Open a file tail window:

```json
{
  "type": "open",
  "file": "server.log",
  "tail_bytes": 65536
}
```

Load an earlier byte range for scrollback:

```json
{
  "type": "read_before",
  "before": 1048576,
  "max_bytes": 65536
}
```

Toggle live follow mode:

```json
{
  "type": "follow",
  "enabled": true
}
```

### Server Messages

Initial or scrollback chunk:

```json
{
  "type": "chunk",
  "file": "server.log",
  "start": 983040,
  "end": 1048576,
  "text": "..."
}
```

Appended bytes while follow mode is enabled:

```json
{
  "type": "append",
  "file": "server.log",
  "start": 1048576,
  "end": 1049000,
  "text": "..."
}
```

Error (invalid path, malformed message, truncation/rotation, etc.):

```json
{
  "type": "error",
  "message": "human-readable error"
}
```

Behavior:

- `open` sends only the requested tail window (default tail size capped at 65536 bytes).
- `read_before` returns an earlier range using stable byte offsets.
- `follow` polls for appended file bytes while enabled.
- Truncation or rotation produces an `error` message; clients should reopen the file.
- Unknown services, unknown files, absolute paths, and traversal attempts are rejected.
- Reads are capped at 65536 bytes per request.

## Browser UI Routes

Conductor also serves HTML UI routes:

- `GET /` — main service list
- `GET /services/{service_name}/logs` — log viewer for one service
- `GET /assets/web/*` — shared CSS from `projects/web/src/`
- `GET /assets/conductor/*` — Conductor browser JavaScript from `projects/conductor/src/ui/`

The logs UI loads file names from `GET /api/services/{service_name}/logs` and reads
file contents only through the WebSocket stream.
