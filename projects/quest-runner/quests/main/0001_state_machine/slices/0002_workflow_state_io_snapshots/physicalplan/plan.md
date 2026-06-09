# Slice 0002: Workflow State I/O And Snapshots

## Objective

Replace enum-bound quest/slice state-machine I/O with workflow-aware I/O that validates persisted states against the loaded workflow machine definitions and preserves every durable state-file and snapshot compatibility rule.

Expected outcome: a workflow machine instance can read and write quest-root `state.md` and child `state.md` files generically, using `persisted_as` mappings from YAML, while producing recursive snapshots with the same required fields and default-workflow byte shape as today.

## Key Files And Systems

- Add `projects/quest-runner/src/quest_runner_service/state_machine/workflow_state_io.py`.
- Extend `projects/quest-runner/src/quest_runner_service/quest_fs.py` readers/writers where validation currently depends on `QuestState`.
- Extend `projects/quest-runner/src/quest_runner_service/quest_types.py` only where generic data structures are needed; do not add new workflow-specific enums.
- Add or extend tests:
  - `test_normalized_state_md.py`
  - `test_quest_fs_core.py`
  - new `test_workflow_state_io.py`
  - `test_commit_metadata.py` for snapshot rendering/parse round trips

## Behavior To Implement

Workflow state I/O must:

- Read the top-level quest machine from the quest root directory.
- Read child machines from collection child directories matched by workflow `collections`.
- Map persisted state values to logical workflow state ids using each machine's `persisted_as` declarations.
- Map logical state ids back to persisted values when writing.
- Fail with `FatalInvariantError` when a persisted state cannot be mapped to a declared workflow state, except for reserved top-level `ExperimentComplete`.
- Preserve quest root normalized `# State` / `## Tags` format exactly.
- Preserve legacy slice `# Slice State` format exactly for the default workflow.
- Preserve `global_step` on the top-level machine and keep child `global_step` as `None`.
- Preserve runner-provided top-level tags `quest_type`, `quest_number`, and `quest_slug` as part of normalized quest writes.
- Persist workflow variables as state tags. The default workflow persists `active_slice` while it is set.
- Remove a tag when a workflow action clears a variable.

`quest_fs.read_quest_state()` must be generalized so dashboard/API readers still work without dashboard changes:

- It continues returning a `QuestStateInfo`-compatible object for existing callers during the migration.
- It no longer validates normalized top-level state values against `QuestState`.
- It accepts the reserved `ExperimentComplete` value.
- It derives `current_slice` from the `active_slice` tag whenever the tag exists and starts with a four-digit prefix, independent of state name.
- Dashboard code remains untouched.

Snapshot generation support must:

- Use execution-local data, not git history, to produce `RecursiveSnapshot`.
- Keep fields:
  - `machine_name`
  - `machine_path`
  - `node_name`
  - `state_before`
  - `state_after`
  - `tags`
  - `child`
- Use `node_name` override from workflow state when present, otherwise the logical state id.
- Use top-level machine name `quest` and child names `<machine>_<child_id>` for default workflow, e.g. `slice_0001_foundation`.
- Use repo-relative `machine_path`.
- Include nested child snapshot whenever a child machine step ran.
- Set `child: null` otherwise.
- For the default workflow, produce the same snapshot field values as the current hard-coded runner for all current transitions.

## Existing APIs To Reuse

- Reuse `quest_fs.parse_normalized_state_md_text()` and `write_quest_normalized_machine_state()` for quest-root normalized state formatting.
- Reuse `quest_fs.read_slice_state()` and `write_slice_state()` for default child persisted files.
- Reuse `quest_types.RecursiveSnapshot` and `StepCommitMetadata`.
- Reuse `state_machine.commit_metadata.render_step_commit_message()`, `parse_step_commit_message()`, and `validate_parsed_step_commit()`.
- Reuse `slice_index_from_dirname()` for dashboard-facing `current_slice` derivation.

## APIs To Extend Or Modify

- Replace `LegacyQuestStateIo` and `V2QuestStateIo` responsibilities with workflow-aware I/O. The old classes may remain temporarily during this slice only if tests still need them, but later cleanup must remove them.
- Add a generic `WorkflowStateIo(repo_path, quest_dir, meta, workflow)` implementing `StateIo`.
- Add helper methods:
  - `logical_state_for_persisted(machine_key, persisted_state)`
  - `persisted_state_for_logical(machine_key, logical_state)`
  - `machine_name_for_instance(machine_key, machine_dir)`
  - `machine_path_for_instance(machine_dir)`
- Keep compatibility conversion for pre-normalized quest `# Quest State` files so writable old quests can be upgraded and then resumed.

## Validation Expectations

- Unit tests cover:
  - reading normalized quest root state with arbitrary workflow state ids
  - reading `ExperimentComplete`
  - deriving `current_slice` from `active_slice` outside `ExecuteSlice`
  - reading and writing slice persisted states `NotStarted`, `Implementing`, `PolishingReview`, `PolishingFix`, `Done`
  - rejecting unknown persisted states
  - rejecting duplicate `persisted_as` mappings from slice 0001 validation
  - preserving quest identity tags on writes
  - clearing `active_slice` tag
  - snapshot shape for top-level-only and child-running steps
  - commit metadata render/parse round trip using workflow snapshots
- No dashboard or web frontend files are modified.
