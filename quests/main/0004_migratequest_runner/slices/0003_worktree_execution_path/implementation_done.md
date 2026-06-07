# Implementation complete

Slice `0003_worktree_execution_path` is implemented.

## Summary

- `QuestService._prepare_run` resolves the source checkout for metadata, derives the deterministic quest worktree, refuses with `MissingQuestWorktree` when the worktree is missing or invalid, and returns the worktree path plus project-local quest directory for execution.
- Run lock keys now combine worktree path and project/quest identity (`_build_run_lock_key`).
- `run_quest_v2` uses bundled `runtime_quest_docs_dir()` from the package; agent prompts show repo-relative project-local quest/slice paths via `build_runtime_context(repo_path=...)`.
- Added `test_worktree_execution_path.py` covering worktree resolution, missing-worktree refusal, source-dirty/worktree-clean execution, legacy quest exclusion, project-local path rules, thread naming, commit metadata, and worktree dirty-workspace checks.

## Validation

All 105 tests in `projects/quest-runner` pass (`make test`).
