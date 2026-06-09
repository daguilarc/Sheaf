# Slice 0003: Interpreter Actions, Conditions, And Children

## Objective

Implement the generic workflow interpreter for state actions, conditions, ordered transitions, child-machine execution, and child selection. This replaces the behavior currently embedded in `quest_v2_nodes.py` and `quest_v2_predicates.py` with data-driven execution over the loaded workflow definitions.

Expected outcome: tests can execute the default quest and slice workflow through generic interpreter steps without calling hard-coded predicate functions or node classes, including review loops, marker-file gates, issue-file gates, child selection, and nested child snapshots.

## Key Files And Systems

- Add `projects/quest-runner/src/quest_runner_service/state_machine/workflow_interpreter.py`.
- Add support modules if useful:
  - `workflow_paths.py` for interpolation and path safety
  - `workflow_conditions.py`
  - `workflow_actions.py`
- Modify `state_machine/machine.py` or add a new `WorkflowStateMachine` so execution is based on loaded state definitions rather than `node_map` factories.
- Use `WorkflowStateIo` from slice 0002.
- Tests:
  - new `test_workflow_interpreter.py`
  - migrate predicate coverage from `test_quest_v2_predicates.py` into workflow interpreter tests

## Execution Semantics

For one automated machine step:

1. Read current logical state through workflow state I/O.
2. Resolve the state definition from workflow YAML.
3. Record state before, machine name/path, `node_name`, and tags before execution.
4. Execute state `actions` in order.
5. Execute the state's `run` block if present. In this slice, inject a test double callback for run execution; the real harness integration comes in slice 0004.
6. Execute the state's `child` block if present, using the active child id from the declared variable and running exactly one child step.
7. Evaluate transitions in order. First match wins.
8. Execute transition actions for the matched transition.
9. Persist the final state and persisted tags.
10. Return a `RecursiveSnapshot` with child snapshot if one ran.

Manual-step semantics will be wired in slice 0005, but this slice should expose an execution mode that skips `run` and includes `mode: manual_only` transitions so the runner integration does not need to duplicate transition logic.

## Actions To Implement

File actions:

- `ensure_dir: path`
- `ensure_file.path` plus `ensure_file.content`
- `remove_file: path`

Variable actions:

- `set_var.name` and `set_var.value`
- `clear_var: name`

Child selection:

- `select_child.collection`
- `select_child.where.state_not`
- `select_child.where.state_is`
- `select_child.after`
- `select_child.set`
- `select_child.result`

`select_child` must exactly match the spec:

- list children from the collection glob and sort lexically
- compare child states after `persisted_as` mapping
- if no child matches, leave the persisted variable unchanged and do not set the result variable
- if `after` is unset, missing, or not a current child id, select the first matching child overall
- otherwise select the first matching child strictly after the `after` child
- no wrap-around to earlier children
- on selection, set the persisted variable and the step-scoped result variable

State-level actions run every time the node executes. Transition actions run only for the matching transition and before final state persistence.

## Conditions To Implement

Boolean:

- `all`
- `any`
- `not`

Files:

- `exists`
- `file_exists`
- `dir_exists`
- `not_exists`
- `file_count_at_least.glob`
- `file_count_at_least.count`

Issues:

- `has_open_issues.file`
- `no_open_issues.file`

Open issue detection must preserve current semantics: an issue blocks when its parsed `status` field is `open`, case-insensitive and trimmed. Issue markdown format does not change.

Variables:

- `var_exists`
- `var_equals.name`
- `var_equals.value`

Collections:

- `child_dirs_exist.collection`
- `all_children.collection`
- `all_children.require`

Child result:

- `child_result.state_after`

`child_result` is valid only for transitions of states that ran a child block, and validation in slice 0001 should already reject misuse. Runtime should still fail clearly if it is absent.

## Path Resolution And Interpolation

Implement path and string interpolation used by actions, conditions, and child blocks:

- `$quest`: quest root
- `$project`: `projects/<project>` directory
- `$machine`: current machine directory
- `$active_child`: active child directory for the current collection
- `{active_slice}` and any persisted workflow variable
- `{now}` for action content timestamps

Relative paths resolve against the current machine directory unless they begin with a known path variable. In the quest machine, relative paths are quest-relative. In the slice machine, `polishing_issues.md` resolves inside the slice directory.

Reject absolute paths for workflow-owned actions and issue declarations unless a later profile path rule explicitly allows absolute paths; the default workflow should not need them.

## Existing APIs To Reuse

- Reuse `quest_fs.list_slice_dirs()` initially only as a compatibility helper if it matches the declared collection path; do not bake `slices` into interpreter logic.
- Reuse `quest_fs.read_issues()` / issue parsing helpers for issue conditions, or extract reusable parsing from `issue_service` if needed.
- Reuse `RecursiveSnapshot` and `WorkflowStateIo`.
- Reuse `FatalInvariantError` for broken workflow invariants.

## APIs To Extend Or Modify

- Replace direct calls to:
  - `physical_planning_next_state`
  - `review_physical_plan_next_state`
  - `prepare_next_slice_transition`
  - `slice_implementing_next_state`
  - `slice_polishing_review_next_state`
  - `quest_documenting_next_state`
- Add a generic execution result object carrying:
  - snapshot
  - matched transition kind
  - stop status, if a `stop` transition matched
  - stay reason, if a `stay` transition matched
  - whether a run profile was invoked
- Keep the old hard-coded modules reachable only for tests until later slices remove them.

## Validation Expectations

- Unit tests execute each default workflow transition:
  - `PhysicalPlanning -> ReviewPhysicalPlan`
  - `PhysicalPlanning` stay when slice plan files are incomplete
  - `ReviewPhysicalPlan -> PhysicalPlanning` with open issues and `physicalplan_accepted.md` removal
  - `ReviewPhysicalPlan -> PrepareNextSlice` with acceptance marker and no open issues
  - `PrepareNextSlice -> ExecuteSlice` selecting first unfinished child
  - `PrepareNextSlice` selecting the first unfinished child after current active child
  - `PrepareNextSlice -> QuestDocumenting` with no unfinished children and `active_slice` cleared
  - `ExecuteSlice` stays while child is not complete
  - `ExecuteSlice -> PrepareNextSlice` when child result is `Completed`
  - `SliceSetup -> Implementing` with scaffold repair
  - `Implementing -> PolishingReview` only with `implementation_done.md`
  - `PolishingReview -> PolishingFix` with open issues and `implementation_accepted.md` removal
  - `PolishingReview -> Completed` with acceptance marker and no open issues
  - `PolishingFix -> PolishingReview`
  - `QuestDocumenting -> Completed` unconditionally
- Tests compare default workflow snapshots directly against expected legacy node names and tag values.
- Tests prove no Python condition branches on the default role names, issue aliases, marker names, or state graph outside the loaded workflow data.
