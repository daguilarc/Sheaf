# Issue responses

## Response PR-0001 2026-06-07T03:12:09Z

- issue_id: PR-0001
- outcome: Fixed
- explanation: `projects/quest-runner/src/quest_runner_service/dashboard_data.py` now only returns a worktree checkout when `quest_fs.find_quest_dir` finds the quest inside that worktree. If the worktree exists but the quest directory is missing there, `resolve_dashboard_checkout` falls through to the existing source-checkout fallback, so `checkout_root`, `quest_dir`, and `quest_dir_rel` are all computed against the source root without raising. Added `DashboardCheckoutResolutionTests.test_resolve_dashboard_checkout_source_fallback_when_worktree_quest_missing` in `projects/quest-runner/tests/test_dashboard_api.py` to exercise this path by mocking the worktree lookup to return `None`.

## Response PR-0002 2026-06-07T03:12:09Z

- issue_id: PR-0002
- outcome: Fixed
- explanation: Removed the unused exported helpers `StorageRepoKey`, `ResolveRepositorySelection`, and `CanonicalQuestDashboardUrl` from `projects/quest-runner/src/quest_runner_service/dashboard_assets/dashboard-logic.mjs`. Removed the orphan `CanonicalQuestDashboardUrl` import and unit test from `projects/quest-runner/src/quest_runner_service/dashboard_assets/dashboard-logic.test.mjs`; a repo grep confirms those helper names no longer remain under `projects/quest-runner`.
