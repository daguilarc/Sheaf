# Slice 0006 Implementation Accepted

## Summary

Slice 0006 (Quest Creation, Upgrade, and Slice Scaffolding) is accepted. The
implementation correctly makes `workflow/` the default quest execution
configuration, provides a writable-quest upgrade path, and generalizes
`slices init` to use workflow collection scaffold actions.

## What was verified

- **Quest creation** copies the packaged `default_workflow/`, writes a normalized
  root `state.md` (`PrePlanning`, `machine_name: quest`, `global_step: 0`) via
  `write_quest_normalized_machine_state`, applies the top-level `scaffold`
  (`physicalplan_issues.md` = `"# Issues\n"`), and no longer creates
  `state_execution_config.yaml`. `created_files` reports `workflow/` entries.
- **Slice init** resolves the collection (single-default / explicit / multi-error),
  creates children under the collection path prefix, and derives `created_files`
  from scaffold actions in the exact spec order
  (`physicalplan`, `state.md`, `state_history.md`, `polishing_issues.md`, `notes`).
  `{now}` interpolation confirmed in `resolve_path`/`interpolate_string`.
- **Upgrade** (`workflow_upgrade.py`) is gated to writable project-local quests,
  ports profile overrides with placeholder renames, merges harnesses into
  `config/quest-runner.json` (skipping existing keys), deletes legacy config, and
  normalizes pre-`# State` root state. Wired through service/API/CLI and auto-run
  before execution. Legacy top-level quests are left untouched.
- Supporting changes to `quest_fs.py`, `adapters.py`, and `harness_config.py`
  prefer `workflow/` while remaining backward compatible with legacy config.

## Issue history

- **PL-0001** (test-sufficiency: untested explicit/multiple `--collection` paths) —
  opened in cycle 1, resolved by the polisher with targeted tests in
  `test_workflow_upgrade.py` (explicit collection, unknown-collection rejection,
  multiple-collection error, empty-collections selector) and `test_cli.py`
  (`--collection` request wiring). Verified and closed as completed.

No open polishing issues remain.
