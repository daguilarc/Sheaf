# Slice 0006 Implementation Complete

## Summary

Quest creation, upgrade, and slice initialization now use the packaged `workflow/` directory instead of `state_execution_config.yaml`.

## Changes

- **Quest creation** copies `default_workflow/` into `<quest_dir>/workflow/`, writes normalized root `state.md` (`PrePlanning`, `global_step: 0`), applies top-level workflow `scaffold` actions, and no longer creates `state_execution_config.yaml`.
- **Workflow upgrade** (`workflow_upgrade.py`) converts writable project-local quests: copies default workflow, ports profile overrides with placeholder renames, merges harness provider config into `config/quest-runner.json`, deletes legacy config, and rewrites pre-normalized root `state.md` when needed. Exposed via `upgrade_quest` service/API/CLI and auto-run before quest execution.
- **Slice init** uses workflow collection `scaffold` actions (default collection `slices`), supports optional `--collection`, and reports `notes/` in `created_files`.
- **Supporting updates**: `quest_fs` prefers workflow for config reads; `adapters` finds quest roots with workflow or legacy config; `harness_config.merge_service_harness_configs` added.

## Tests

- New `tests/test_workflow_upgrade.py` covers creation, upgrade, profile porting, harness merge/skip, state rewrite, legacy top-level rejection, and startup upgrade.
- Updated `test_quest_creation.py`, `test_quest_service_api.py`, `test_experiments.py`, and `test_experiment_lifecycle.py`.
- Full suite passes (`make test`, 438 tests).
