# Implementation Complete

Slice `0006_experiment_dashboard` is implemented.

## Summary

- Extended `project_snapshot_payload` with an `experiments` list of open experiment worktrees (state, start/stop metadata, `can_land`, branch/worktree paths).
- Extended `quest_overview_payload` with `experiment` context when `experiment_id` is set, and `archived_experiments` summaries on parent quest pages.
- Added `experiment_archive_detail_payload` and `GET /api/dashboard/experiments` for landed experiment artifact drilldown.
- Updated dashboard UI: open experiments pane, experiment-scoped URL/query state, experiment overview with Land button (`POST /experiments/land`), and landed experiment archive section on quest overviews.
- Added Python tests in `test_dashboard_api.py` and Node tests in `dashboard-logic.test.mjs`.

## Validation

- `make -C projects/quest-runner test` — pass (362 tests)
- `node --test projects/quest-runner/src/quest_runner_service/dashboard_assets/*.test.mjs` — pass (49 tests)
