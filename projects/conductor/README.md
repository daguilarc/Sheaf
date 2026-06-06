# Conductor

Conductor is the command hub service manager. It reads registered services from
`config/services.json`, polls their health every 30 seconds, exposes lifecycle and log
APIs, and serves a browser UI for observing and controlling services.

## Quick Start

From the repository root:

```bash
npm --prefix projects/conductor install
npm --prefix projects/conductor run build
make conductor-run
```

`make conductor-run` delegates to `start_conductor.sh`, which appends process output to
`logs/conductor/conductor_stdout.log` and
`logs/conductor/conductor_stderr.log`. Services started through Conductor use the same
pattern under `logs/<service_name>/`.

Open [http://127.0.0.1:9001/](http://127.0.0.1:9001/) for the service list. Log files
are available at `/services/{service_name}/logs`.

## Features

- REST APIs for service health, details, lifecycle actions, and log file listing
- WebSocket log streaming with tail, follow, and scrollback
- Browser UI with service health, uptime, warnings, home links, and start/stop/restart
  controls
- Shared CSS from `projects/web/`

## Documentation

See [docs/README.md](docs/README.md) for package layout and links to the API reference
and operations guide.
