# Dictator Documentation

Current-state documentation for the migrated Dictator project under `projects/dictator/`.

## Reference

Exact APIs, configuration, commands, and data shapes:

- [API](reference/api.md) — HTTP endpoints for health, dictation, web UI, and operational JSON APIs
- [Configuration](reference/config.md) — `config/dictator.json`, `config/api_keys.json`, and service endpoint rules
- [Launchpad](reference/launchpad.md) — Launchpad Pro MIDI controls for dictation and keystroke injection
- [Services](reference/services.md) — Sheaf service registration, port `9003`, logs, and shutdown
- [Data](reference/data.md) — `data/dictator/` layout, interaction records, and model binary policy
- [Testing](reference/testing.md) — build, test, and migration validation commands

## Explanation

Architecture, pipeline behavior, and design rationale:

- [Architecture](explanation/architecture.md) — project layout, service composition, and migration scope
- [Dictation pipeline](explanation/dictation-pipeline.md) — STT, refinement, provider routing, and Talon Lite
- [Web UI](explanation/web-ui.md) — browser-based operational dashboard replacing the legacy AppKit UI

## Repository rules

Sheaf-wide documentation rules live under `structure/` at the repository root. Dictator follows those conventions for configuration, services, logs, and data paths.
