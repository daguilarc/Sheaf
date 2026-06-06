# Web UI

Generic utilities used to build a coherent web UI should live in the `web`
project under `projects/web/`.

This includes shared CSS files, static assets, and later reusable browser UI
components such as richer chat interfaces. Project-specific business logic
should stay in the project that owns the behavior; shared presentation utilities
belong in `web`.

Different projects can optionally expose a web UI. If a project service has a
human-facing UI, its service entry in [`config/services.json`](../config/services.json)
should set `home_path` to the UI path for that service.

See [Services](services.md#registry-file) for the `home_path` field.
