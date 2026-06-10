# Slice 0008 Implementation Complete

Experiments, cleanup, and compatibility verification for the workflow-language migration are implemented.

## Experiments

- Experiment create CLI/API accept an alternate **workflow directory** via `--config-file` / `workflow_path` instead of `state_execution_config.yaml` text.
- Source experiment metadata stores `experiments/<n>/workflow/`; experiment worktrees replace quest-local `workflow/`.
- Stop conditions validate against workflow machine state ids and `node_name` overrides (with legacy aliases such as `slice_completed`).
- `snapshot_matches_stop_condition()` takes the active workflow and matches on logical state ids and node names.
- Artifact archiving walks workflow-declared issue files (including concrete child slice paths).

## Cleanup

- Removed `quest_v2_definitions.py`, `quest_v2_nodes.py`, `quest_v2_predicates.py`, `legacy_quest_state_io.py`, and `v2_quest_state_io.py`.
- Removed dead transition-plan/scaffold helpers from `quest_runner.py`.
- Deleted packaged `default_state_execution_config.yaml` and `roles/*.md` (prompts live under `default_workflow/prompts/`).
- Introduced `errors.py` with `FatalInvariantError` and `AdvanceValidationError`; added `EXPERIMENT_COMPLETE_STATE` constant in `quest_types.py`.

## Compatibility

- Added `tests/test_workflow_compatibility.py` for scaffold bytes, child `SliceSetup` snapshot shape (history-compatible fields), and public docs checks.
- Updated `docs/reference/cli.md` and `docs/reference/api.md` for workflow-based experiments and `--file` issue commands.

## Validation

- Full suite: `make -C projects/quest-runner test` (434 tests).
