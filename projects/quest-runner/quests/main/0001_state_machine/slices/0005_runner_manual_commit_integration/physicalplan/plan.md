# Slice 0005: Runner, Manual Advance, And Commit Integration

## Objective

Wire the workflow interpreter into automated quest runs and manual advance, replacing hard-coded `QuestV2MachineLoader`, hard-coded state checks in `quest_runner_v2.py`, and duplicated manual transition logic in `v2_step_executor.py`.

Expected outcome: `run`, `advance`, and the single-commit-per-step machinery execute the quest-local workflow interpreter generically while preserving runner statuses, dirty-workspace behavior, no-op commit behavior, recursive snapshots, and commit message format.

## Key Files And Systems

- Modify `quest_runner_v2.py` to load `quest_dir/workflow/` and construct the workflow interpreter.
- Modify `state_machine/v2_step_executor.py` to use interpreter execution results for both automated and manual steps.
- Modify or replace `state_machine/quest_v2_definitions.py`, `quest_v2_nodes.py`, and `quest_v2_predicates.py` call sites so they are no longer used by the runner.
- Keep `state_machine/commit_metadata.py` unchanged except for generic validation updates if required by arbitrary workflow state ids.
- Tests:
  - `test_state_machine_core.py`
  - `test_worktree_execution_path.py`
  - `test_advance_quest_api.py`
  - new `test_workflow_runner_integration.py`

## Automated Runner Behavior

Before each step:

- Stop with `human_intervention` if the configured `special.human_intervention_file` exists.
- Stop with `completed` if the current workflow state is terminal.
- Stop with `experiment_complete` if state is reserved `ExperimentComplete` and an experiment context is active.
- Execute a matched `stop` transition without committing; this is how default `PrePlanning` returns `pre_planning`.
- Preserve `dirty_workspace`, `max_steps`, harness error, and post-step human-intervention recheck behavior.

Step execution:

- Run exactly one top-level workflow machine step.
- Let child blocks run exactly one child-machine step.
- Use the interpreter's snapshot as the commit snapshot.
- If the interpreter reports no transition and no changed files, preserve the current no-op rule and do not commit.
- If a step produces changes, render and validate commit metadata, stage all, and create one git commit.
- Increment `global_step` exactly once per committed top-level step.
- Write normalized quest state with the new global step after metadata validation, matching current ordering and file format.

Status payloads must remain unchanged:

- `pre_planning`
- `completed`
- `human_intervention`
- `dirty_workspace`
- `experiment_complete`
- `max_steps`

Payload fields such as `steps_executed`, `last_commit`, `captured_outputs`, `quest_state`, and experiment fields stay compatible.

## Manual Advance Behavior

Replace `_evaluate_quest_advance()` and `_evaluate_slice_advance()` with generic interpreter manual mode.

Manual advance must:

1. Refuse with the existing conflict response when the human intervention file exists.
2. Return "already completed" when the top-level state is terminal or reserved `ExperimentComplete`.
3. Execute state actions.
4. Skip `run` profile execution.
5. Recursively apply manual-step rules to an active child if the state has a child block.
6. Evaluate transitions with `mode: manual_only` transitions eligible and `stop` transitions skipped.
7. Apply transition actions and persist the new state for a matched `to`.
8. Block on a matched `stay` with the configured reason and keep state unchanged.
9. Block with `no_eligible_transition` if nothing matches.
10. Commit through the same single-commit machinery as automated runs.

Default manual-advance reasons must match current API expectations:

- `incomplete_physical_plan`
- `physical_plan_review_incomplete`
- `missing_implementation_done`
- `polishing_review_incomplete`
- `no_eligible_transition`

Accepted behavior change: manual advance from `QuestDocumenting` now succeeds unconditionally because the docs-changed gate is removed.

## Commit Metadata Compatibility

Commit message format must remain:

```text
quest-step: N
state-machine-path: <quest path>
node: <node_name>
state-before: <state_before>
state-after: <state_after>

recursive-snapshot-json:
...
```

Validation must compare against workflow state ids and `node_name` overrides, not `QuestState` enums or hard-coded node classes. The default workflow must produce byte-compatible snapshots for representative current steps.

## Existing APIs To Reuse

- Reuse `commit_v2_snapshot_step()` structure, `SubprocessGitOps`, commit render/parse/validate helpers, `collect_changed_paths_since()`, and `_write_human_intervention()`.
- Reuse existing error classes and API response mapping for manual advance.
- Reuse `DirtyWorkspaceError` and harness error handling paths.

## APIs To Extend Or Modify

- Make `execute_v2_top_level_step()` accept a workflow interpreter top machine rather than `ConcreteStateMachine` with hard-coded node maps.
- Replace `build_v2_transition_plan()` and `apply_transition_filesystem_side_effects()` with generic transition data from the interpreter. Removal of acceptance markers is handled by workflow transition actions from slice 0001/0003.
- Remove documenter base ref handling from `quest_runner_v2.py`; the default workflow no longer gates docs changes.
- `StateMachineId` construction should use the workflow entry machine name rather than hard-coded `quest`, though the default remains `quest`.

## Validation Expectations

- Automated run tests cover:
  - `PrePlanning` returns `pre_planning` without commit
  - terminal `Completed` returns `completed`
  - human intervention stop
  - one committed step increments global step and writes metadata
  - no-op step with no file changes does not commit
  - child-running `ExecuteSlice` commits nested snapshot
  - `QuestDocumenting` completes without docs changes
- Manual advance tests cover every default state, including child recursion.
- Existing API tests for `/advance_quest` keep the same response body fields.
- Commit metadata tests assert default workflow node names remain legacy names.
- No dashboard or web UI code is modified.
