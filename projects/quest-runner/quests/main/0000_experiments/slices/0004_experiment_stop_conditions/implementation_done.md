# Implementation Complete

Slice `0004_experiment_stop_conditions` is implemented.

## Summary

Experiment runs now stop at the configured workflow graph node, persist `ExperimentComplete` in the experiment worktree, update source `experiment.json` to `experiment_complete`, and return a distinct `experiment_complete` status for dashboard and landing flows.

## Changes

- Added `QuestState.ExperimentComplete` and read/write support in legacy and normalized `state.md` formats.
- Added `ExperimentRunContext`, `snapshot_matches_stop_condition`, worktree finalization helpers, and source metadata completion (`complete_experiment_source_metadata`) in `experiments.py`.
- Extended `V2StepResult` and `ManualAdvanceResult` with optional `snapshot` for post-step stop evaluation.
- Integrated stop detection in `run_quest_v2` after each committed step; early-returns when worktree is already `ExperimentComplete`.
- Updated `QuestService._run_quest_locked` and `advance_quest` to apply source metadata commits (or human intervention on dirty source checkout).
- Added `tests/test_experiment_stop_conditions.py` and registered it in the Makefile test target.

## Validation

```text
make -C projects/quest-runner test
```

All 338 tests pass.
