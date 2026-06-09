# Implementation Complete

Slice `0003_experiment_scoped_operations` is implemented.

## Summary

Threaded optional `experiment_id` through quest-scoped REST/CLI operations and agent runtime prompts so experiment work runs against the experiment worktree instead of the normal quest worktree.

## Changes

- Added `QuestScope` and centralized scope resolution via `_resolve_mutable_quest_scope` / updated `_prepare_run` in `quest_service.py`, with experiment-aware lock keys and improved `MissingQuestWorktree` guidance.
- Extended `run`, `advance`, `slices init`, and all issue service wrappers/API/CLI paths to accept and pass `experiment_id`.
- Updated dashboard `_quest_context()` and payloads to resolve experiment worktrees when `experiment_id` is supplied; responses include `experiment_id` and `checkout_kind="experiment"` when scoped.
- Refactored `issue_service.resolve_issue_context` to use centralized checkout resolution.
- Threaded `experiment_id` through `run_quest` → `run_quest_v2` → `RunContext` → `perform_role_harness_sequence` → `build_runtime_context` with prompt instructions to preserve `--experiment-id`.
- CLI `land --experiment-id` returns a clear validation error directing operators to `experiments land` (slice 5).
- Added `tests/test_experiment_scoped_operations.py` covering prepare-run, API, CLI, runtime context, and deferred retry behavior.

## Validation

```text
make -C projects/quest-runner test
```

All 313 tests pass.
