# Physical Plan: REST Service Integration

## Objective

Expose the migrated Quest Runner as a Sheaf service on port `9002`, with only quest-runner REST APIs, standard health/exit endpoints, dashboard shell/assets, project-local dashboard read APIs, and runtime logging under `logs/quest-runner/`.

Expected outcome:

- `projects/quest-runner` has a service entry point that binds to the configured host/port, defaulting to port `9002`.
- `GET /health` returns the standard Sheaf health shape: `{"healthy": true, "uptime": <seconds>, "warning": ...?}`.
- `POST /exit` exits cleanly when registered in `config/services.json`.
- `POST /create_quest` requires/accepts `project`, `quest_type`, `name`, optional `slug`, and optional `requested_by`.
- `POST /run_quest` requires/accepts `project`, `quest_type`, `quest_number`, and optional positive `max_steps`.
- Dashboard APIs list/inspect only project-local quests and include project identity.
- No service registration, service lifecycle, service log streaming, SQLite database, or MCP route is exposed.
- Runtime logs are written under `logs/quest-runner/`; quest step logs remain inside each quest directory.

## Key Files And Systems

Likely affected files:

- `projects/quest-runner/src/quest_runner_service/api.py`
- `projects/quest-runner/src/quest_runner_service/server.py` or `__main__.py`
- `projects/quest-runner/src/quest_runner_service/logging_config.py` or equivalent
- `projects/quest-runner/src/quest_runner_service/dashboard_data.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_slice.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_git.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/**`
- `projects/quest-runner/start_quest_runner.sh`
- `projects/quest-runner/Makefile`
- Root `Makefile`
- `config/services.json`
- REST/dashboard tests migrated from `test_dashboard_api.py`, `test_dashboard_shell.py`, `test_dashboard_git.py`, `test_dashboard_slice.py`, and `test_quest_service.py`

## Existing APIs To Reuse As-Is

- Reuse Flask route/test-client patterns from external `conductor/api.py` for quest routes and dashboard static serving.
- Reuse `ActiveRunTracker` and background scheduling behavior for async run requests.
- Reuse dashboard payload builders after project-aware path changes.
- Reuse `send_from_directory`/no-cache behavior for dashboard shell and assets.

## APIs To Extend Or Modify

- Replace `create_app(manager, quest_service)` with a quest-runner-only app factory, for example `create_app(quest_service, source_repo_root, started_at, shutdown_callback=None)`.
- Remove all `ServiceManager`, `DB`, and MCP imports from product code.
- Add project-aware request validation helpers:
  - `parse_project`
  - `parse_quest_type`
  - `parse_quest_number`
  - `parse_max_steps`
- Replace repository-tracked dashboard endpoints with project-local equivalents:
  - `GET /api/dashboard/projects`
  - `GET /api/dashboard/project_snapshot?project=<project>`
  - `GET /api/dashboard/quest_overview?project=<project>&quest_type=<type>&quest_number=<n>`
  - Existing issue, human intervention, run status, slice page, agent log, git commits, and git diff endpoints updated to require `project`.
- Update `canonical_quest_dashboard_url` to use `project` instead of `repo_path`.

## Implementation Notes

Service configuration:

- Add `quest-runner` to `config/services.json`:
  - `name`: `quest-runner`
  - `host`: `0.0.0.0` or the existing repo convention used by services
  - `port`: `9002`
  - `home_path`: `/dashboard`
  - `command`: `make quest-runner-run`
- Add `quest-runner` to root `Makefile` `PROJECTS` and forwarding targets.
- Keep the project command delegated into `projects/quest-runner/Makefile`.

REST behavior:

- `GET /health` should not report service counts; that was Conductor-specific.
- `POST /create_quest` should return `201` with project, quest identity, quest dir, worktree name/path, state, and created files.
- `POST /run_quest` should schedule or run via the migrated `QuestService` and return `202` for accepted async runs.
- Missing worktree should return a clear non-2xx response, preferably `409 Conflict`, with fields including `project`, `quest_type`, `quest_number`, `expected_worktree`.
- Route errors should be JSON and should not mention Conductor service-manager concepts.

Logging:

- Configure Python logging at service startup to write to `logs/quest-runner/quest-runner.log`.
- Log startup, requests, quest creation, worktree creation, run scheduling/start/finish, runner transitions, harness calls, retries, path enforcement events, early exits, and errors.
- Do not introduce SQLite or any persistent database. In-process run tracking and scheduler state can remain memory-only.

Configuration:

- Verify whether any persistent configuration is needed beyond `state_execution_config.yaml` and `config/services.json`. If needed, add `config/quest-runner.json`; otherwise document that there is no project config file.
- Do not use environment variables as persistent configuration.

## Validation

- REST tests for `/health`, `/exit`, `/create_quest`, `/run_quest`, dashboard shell, and dashboard assets.
- REST tests that `create_quest` and `run_quest` require/include project identity.
- REST tests that missing worktree returns a clear error.
- Dashboard API tests for project listing and project-local quest snapshots.
- Negative route tests asserting service-manager/MCP endpoints such as `/services`, `/logs`, `/trace`, `/mcp`, and `/register_service` are absent.
- Test or static assertion that product code does not import `sqlite3`, `db`, `ServiceManager`, or `mcp_server`.
- Run `make -C projects/quest-runner test`.
- Optionally start the service locally and verify `GET http://localhost:9002/health`.
