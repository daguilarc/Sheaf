# Services

Services are long-running processes managed through `config/services.json`.

Not every project needs a service. CLI-only, library-only, documentation-only, or batch projects may have no service entry.

## Registry File

`config/services.json` is a JSON array. Each object represents one service:

```json
{
  "name": "example",
  "host": "127.0.0.1",
  "port": 9000,
  "command": "node projects/example/src/server.js",
  "home_path": "/dashboard"
}
```

Required fields:

- `name`: stable service name.
- `host`: host interface the service should bind to.
- `port`: port the service should bind to.
- `command`: repo-root-relative command used to start the service.

Optional fields:

- `home_path`: relative URL or URI for the service's main human-facing page, such as `/dashboard`.

`home_path` should be relative to the service origin formed from `host` and `port`. For example, a service on `127.0.0.1:9000` with `home_path` set to `/dashboard` has a home page at `http://127.0.0.1:9000/dashboard`.
If a project exposes an optional web UI, set `home_path` to that UI path so command hub tools can link to it. See [Web UI](webui.md).

## Boot Rules

Services should read `config/services.json` on boot and use the registered `host` and `port` for their service name unless explicitly started with an override.

Overrides should be deliberate and visible. They should not become a second source of persistent configuration.

## Required Endpoints

Every registered service should expose:

- `GET /health`: returns service health.
- `POST /exit`: exits the service cleanly.

`GET /health` should be cheap, deterministic, and safe to call frequently.

`GET /health` should return a JSON object with this shape:

```json
{
  "healthy": true,
  "uptime": 123.45,
  "warning": "optional human-readable warning"
}
```

Fields:

- `healthy`: whether the service considers itself healthy.
- `uptime`: service uptime in seconds.
- `warning`: optional human-readable warning when the service is degraded or needs attention.

Health pages should display both `uptime` and `warning` when they are available.

## Service Management

Services will be managed by the future `conductor` project. Once created, `conductor` should use `config/services.json` as its registry and should not maintain a separate service list.
