# Web

Shared web UI assets for command hub browser interfaces.

The `web` project owns generic CSS and static assets. Project-specific pages and
behavior stay in the service project that consumes them (for example,
`projects/conductor/`).

## Shared Assets

- `src/sheaf.css` — shared layout, typography, and status styling

Conductor serves this file at `/assets/web/sheaf.css` and links it from its HTML UI.

See [docs/README.md](docs/README.md) for usage details.
