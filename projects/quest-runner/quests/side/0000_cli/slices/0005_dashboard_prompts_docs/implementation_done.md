# Implementation complete

Slice `0005_dashboard_prompts_docs` is complete.

## Dashboard

- Added `BuildAdvanceQuestPayload` and `ShouldShowAdvanceButton` in `dashboard-logic.mjs` with unit tests.
- Wired an **Advance** secondary button in `app.js` that posts to `/advance_quest`, refreshes snapshot/overview/run status/current page content on success, and shows API errors without clearing selection.
- Added minimal overview hint and action-row styles.

## Prompts and runtime context

- Updated `physical_planner`, `physical_plan_reviewer`, `polisher`, and `polisher_reviewer` role prompts to use `scripts/quest-runner issues ...` workflows.
- Updated `build_task_instruction` strings in `quest_runner.py` to reference issue CLI commands.
- Replaced full `schemas.md` injection in `build_runtime_context` with compact issue CLI guidance; schema docs remain in `quest_docs/` for maintainers.

## Documentation

- Extended `docs/reference/api.md` with `/advance_quest`, `/land`, and issue API reference.
- Updated how-to, dashboard, roles, layout, and runtime-files docs for CLI workflows and the dashboard **Advance** action.

## Validation

- `make -C projects/quest-runner test` — 244 tests passed.
