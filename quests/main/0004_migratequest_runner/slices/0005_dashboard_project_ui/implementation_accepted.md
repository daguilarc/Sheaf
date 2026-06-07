# Implementation accepted

Slice `0005_dashboard_project_ui` is accepted by the polisher reviewer.

## Summary

The dashboard UI migration to project-based selection is correct and complete
against the slice spec and physical plan:

- Repository selection replaced with project selection (`/api/dashboard/projects`,
  `/api/dashboard/project_snapshot`); URLs/API calls carry `project`,
  `quest_type`, `quest_number`.
- `resolve_dashboard_checkout` returns project identity plus `checkout_kind`,
  `checkout_path`, `worktree_missing`, and `quest_dir_rel`, preferring the quest
  worktree when present and falling back to the source checkout otherwise.
- Overview run button (`POST /run_quest`) with correct visibility across
  completed/running/paused/human-intervention/missing-worktree states.
- Service-orchestrator and MCP UI removed; index.html and app.js contain no
  service controls.
- JS and Python tests cover project identity, run-button logic, checkout
  resolution (including worktree-missing and worktree-without-quest-dir paths),
  legacy quest exclusion, and worktree git metadata.

## Issue resolution

- PR-0001 (worktree checkout `relative_to` crash) — completed; restructured so
  the relative-path computation only runs when the quest dir is found in the
  worktree, with a new regression test.
- PR-0002 (dead/unwired JS helpers) — completed; unused exports and their orphan
  test removed, confirmed by project-wide grep.

No open polishing issues remain.
