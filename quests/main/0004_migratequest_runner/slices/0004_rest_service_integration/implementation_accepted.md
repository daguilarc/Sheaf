# Implementation Accepted: REST Service Integration

The slice is accepted with no open polishing issues.

## Basis for acceptance

- **REST surface matches spec/plan**: `create_app(quest_service, source_repo_root, started_at, shutdown_callback)` exposes `/health` (standard `{healthy, uptime}` shape, no service counts), `/exit`, `/create_quest` (201 with project + quest identity), and `/run_quest` (202) with project identity required. Missing worktree returns 409 with `project`, `quest_type`, `quest_number`, and `expected_worktree`.
- **Quest-runner-only**: No `ServiceManager`, SQLite/`db`, or MCP routes/imports in product code — confirmed by grep and by the static AST forbidden-import test, plus a negative-route test asserting `/services`, `/register_service`, `/logs`, `/trace`, `/mcp`, etc. are absent (404).
- **Project-local dashboard**: Repository-tracked endpoints replaced with project-scoped equivalents; `canonical_quest_dashboard_url` uses `project` instead of `repo_path`. Validation helpers `parse_project`, `parse_quest_type`, `parse_quest_number`, `parse_max_steps` present.
- **Service wiring**: `quest-runner` registered on port 9002 in `config/services.json` with `make quest-runner-run`; root Makefile `PROJECTS` and forwarding targets, `projects/quest-runner/Makefile`, and `start_quest_runner.sh` all consistent. Service logging writes to `logs/quest-runner/quest-runner.log`.
- **Test coverage** is sufficient for changed behavior and likely failure modes (health/exit/create/run, project-required validation, missing-worktree 409, lock contention, malformed-state 422, invalid max_steps, project listing/snapshot, dashboard shell + assets, step-history dedupe). Implementer reported 150 tests passing.

## Notes (non-blocking, not filed as issues)

- `run_quest_route` has a redundant local try/except around `parse_max_steps` that duplicates the registered `DashboardBadRequest` errorhandler. Cosmetic.
- The dashboard shell title still reads "Conductor Quest Dashboard"; dashboard asset rendering is slice 5 scope.
