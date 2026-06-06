# Conductor

Conductor is the command hub service manager. It reads registered services from
`config/services.json`, polls their health, exposes lifecycle and log APIs, and
serves a browser UI for observing and controlling services.

Current state: project scaffold only. The HTTP server and UI land in later quest
slices.

See [docs/README.md](docs/README.md) for package layout and foundational APIs.
