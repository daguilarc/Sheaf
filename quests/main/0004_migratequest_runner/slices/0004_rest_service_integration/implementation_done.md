# Implementation Complete: REST Service Integration

## Summary

The Quest Runner is exposed as a Sheaf service on port `9002` with quest-runner-only REST APIs, project-local dashboard endpoints, and runtime logging under `logs/quest-runner/`.

## Delivered

- **`api.py`**: Flask app factory (`create_app(quest_service, source_repo_root, started_at, shutdown_callback)`) with `/health`, `/exit`, `/create_quest`, `/run_quest`, dashboard shell/assets, and project-scoped dashboard read APIs. No service-manager, MCP, or database routes.
- **`logging_config.py`**: Service logging to `logs/quest-runner/quest-runner.log` plus stderr.
- **`__main__.py`**: Wires `QuestService`, logging, and the API; binds to port `9002` by default.
- **`dashboard_data.py`**: Replaced Conductor repository tracking with project-local helpers (`parse_project`, `parse_max_steps`, `projects_payload`, `project_snapshot_payload`, `resolve_quest_dirs`, worktree-aware checkout resolution). Dashboard URLs use `project` instead of `repo_path`.
- **`config/services.json`**: Registered `quest-runner` on port `9002` with `make quest-runner-run`.
- **Tests**: Migrated REST and dashboard API/shell/git/slice tests; added forbidden-import and absent-route coverage.

## Validation

- `make -C projects/quest-runner test` — 150 tests passing.

## Configuration note

No `config/quest-runner.json` is required. Service behavior uses `config/services.json`, per-quest `state_execution_config.yaml`, and the bundled default execution config.
