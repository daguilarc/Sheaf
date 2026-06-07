# Implementation complete

Slice `0005_dashboard_project_ui` is implemented.

## Summary

- Migrated dashboard UI from repository (`repo_path`) selection to project selection using `/api/dashboard/projects` and `/api/dashboard/project_snapshot`.
- Updated URL/query builders and API calls to carry `project`, `quest_type`, and `quest_number`.
- Added `resolve_dashboard_checkout()` with `checkout_kind`, `checkout_path`, `worktree_missing`, and `quest_dir_rel` in overview/run-status payloads; git endpoints continue to prefer the quest worktree when present.
- Added overview **Run quest** button (`POST /run_quest`) with visibility rules for completed, running, paused, human-intervention, and missing-worktree states.
- Removed service-orchestrator copy from the dashboard shell (no repository/service registration UI).
- Extended JS unit tests and Python dashboard tests for project identity, run-button logic, checkout resolution, legacy quest exclusion, and worktree git metadata.

## Validation

`make -C projects/quest-runner test` — 156 tests passed.
