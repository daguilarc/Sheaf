# Implementation accepted

Slice `0005_dashboard_prompts_docs` is accepted with no open polishing issues.

## What was verified

- **Dashboard advance action**: `BuildAdvanceQuestPayload` and
  `ShouldShowAdvanceButton` in `dashboard-logic.mjs` match the spec (shown for
  stopped/incomplete quests with a worktree, allowed during human-intervention
  recovery, hidden when completed/running/paused/missing-worktree). `app.js` wires a
  secondary **Advance** button that posts to `/advance_quest`, refreshes
  snapshot/overview/run status/current page content on success, and shows the API
  error without losing selection on failure. Unit tests cover all visibility cases
  and payload shape.
- **Prompts and runtime context**: full `schemas.md` injection replaced with a
  compact issue-CLI summary in `build_runtime_context`; the removed
  `_load_quest_schemas_reference` has no remaining references. `build_task_instruction`
  strings and the four issue role prompts now use `scripts/quest-runner issues ...`
  with correct responder/reviewer ownership rules.
- **Documentation**: `api.md`, `dashboard.md`, `roles.md`, `layout.md`,
  `runtime-files.md`, and `run-service.md` accurately describe the implemented
  endpoints. Documented status codes (400/404/409/422) were cross-checked against
  the `api.py` error handlers and documented CLI flags against `cli.py`; both match.
- **Tests**: runtime-context, role-prompt CLI, and app.js advance-action assertions
  added; implementer reported the full suite passing (244 tests).
