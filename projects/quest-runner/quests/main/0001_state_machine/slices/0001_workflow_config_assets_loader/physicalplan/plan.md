# Slice 0001: Workflow Config Assets And Loader

## Objective

Introduce the quest-local `workflow/` configuration format as validated data, and package a complete default workflow directory that represents the current main quest state machine. This slice does not switch execution to the new interpreter yet; it creates the reusable loader, data model, validation errors, and default assets required by later slices.

Expected outcome: code can load `workflow/workflow.yaml`, machine YAML, profile YAML, prompt files, and `preamble.md` from a quest or from the packaged default directory, validate all cross-references, and expose a typed workflow object without consulting hard-coded quest/slice graphs.

## Key Files And Systems

- Add `projects/quest-runner/src/quest_runner_service/workflow_config.py` for dataclasses, path resolution, YAML loading, and validation.
- Add packaged default assets under `projects/quest-runner/src/quest_runner_service/default_workflow/`:
  - `workflow.yaml`
  - `preamble.md`
  - `machines/quest.yaml`
  - `machines/slice.yaml`
  - `profiles/*.yaml`
  - `prompts/*.md`
- Reuse existing prompt text from `src/quest_runner_service/roles/*.md` by copying it into `default_workflow/prompts/` in this slice, with issue-command wording updated to `--file` where the prompt itself names issue commands.
- Add fixture-oriented tests in a new `projects/quest-runner/tests/test_workflow_config.py`.

## Data Shapes To Implement

`workflow.yaml`:

- `version: 1`
- `name: default-main-quest`
- `entry_machine: quest`
- `special.completed_state: Completed`
- `special.human_intervention_file: human_intervention_request.md`
- `preamble: preamble.md`
- `variables` containing at least `quest: .`, `specs: specs`, and `project_docs: $project/docs`
- `scaffold` with one `ensure_file` for `physicalplan_issues.md` containing `"# Issues\n"`
- `collections.slices`:
  - `path: slices/*`
  - `machine: slice`
  - `order: lexical`
  - `id_from: directory_name`
  - `active_var: active_slice`
  - `scaffold` actions, in this exact order and with this exact byte content:
    - `ensure_dir: physicalplan`
    - `ensure_file.path: state.md`
    - `ensure_file.content: "# Slice State\n\nstate: NotStarted\nupdated_at: {now}\n"`
    - `ensure_file.path: state_history.md`
    - `ensure_file.content: "# State Transition History\n\n"`
    - `ensure_file.path: polishing_issues.md`
    - `ensure_file.content: "# Issues\n"`
    - `ensure_dir: notes`
- `issues.physical_plan` maps to `physicalplan_issues.md` with owner `physical_plan_reviewer`
- `issues.polishing` maps to `$active_child/polishing_issues.md` with owner `polisher_reviewer`
- Add `id_prefix` to each default issue declaration because issue ids are part of the unchanged issue file format but the new file-based CLI no longer has scope names from which to derive prefixes:
  - `physical_plan.id_prefix: QP`
  - `polishing.id_prefix: PL`
- `machines.quest: machines/quest.yaml`, `machines.slice: machines/slice.yaml`
- `profiles` entries for `physical_planner`, `physical_plan_reviewer`, `implementer`, `polisher_reviewer`, `polisher`, and `documenter`

`machines/quest.yaml` must declare logical states:

- `PrePlanning`, `PhysicalPlanning`, `ReviewPhysicalPlan`, `PrepareNextSlice`, `ExecuteSlice`, `QuestDocumenting`, `Completed`
- `initial: PrePlanning`
- `terminal: [Completed]`
- legacy `node_name` overrides:
  - `PrePlanningGateNode`
  - `PhysicalPlanningNode`
  - `ReviewPhysicalPlanNode`
  - `PrepareNextSliceNode`
  - `ExecuteActiveSliceNode`
  - `QuestDocumentingNode`
  - `CompletedGateNode`

Quest machine behavior encoded in YAML:

- `PrePlanning` has a `stop` transition returning `pre_planning` for automated runs and a `mode: manual_only` transition to `PhysicalPlanning`.
- `PhysicalPlanning` runs profile `physical_planner`, then transitions to `ReviewPhysicalPlan` only when child directories exist and every child has `physicalplan/`, at least one `physicalplan/*.md`, `state.md`, `state_history.md`, and `polishing_issues.md`; otherwise it stays with reason `incomplete_physical_plan`.
- `ReviewPhysicalPlan` runs profile `physical_plan_reviewer`, transitions to `PhysicalPlanning` with transition action `remove_file: physicalplan_accepted.md` when `physicalplan_issues.md` has open issues, transitions to `PrepareNextSlice` when `physicalplan_accepted.md` exists and there are no open issues, otherwise stays with reason `physical_plan_review_incomplete`.
- `PrepareNextSlice` runs a `select_child` action over `slices` where child logical state is not `Completed`, after `active_slice`, setting persisted `active_slice` and step-scoped `next_slice`; it transitions to `ExecuteSlice` when `next_slice` exists, otherwise clears `active_slice` and transitions to `QuestDocumenting`.
- `ExecuteSlice` has a child block for one step of the active `slices` child and transitions to `PrepareNextSlice` when `child_result.state_after == Completed`; otherwise it stays in `ExecuteSlice`.
- `QuestDocumenting` runs `documenter` and transitions unconditionally to `Completed`; the old docs-changed gate is intentionally omitted.
- `Completed` is terminal.

`machines/slice.yaml` must declare logical states:

- `SliceSetup`, `Implementing`, `PolishingReview`, `PolishingFix`, `Completed`
- `initial: SliceSetup`
- `terminal: [Completed]`
- `persisted_as` mapping:
  - `SliceSetup -> NotStarted`
  - `Completed -> Done`
- legacy `node_name` overrides:
  - `SliceSetupNode`
  - `SliceImplementingNode`
  - `SlicePolishingReviewNode`
  - `SlicePolishingFixNode`
  - `SliceCompletedNode`

Slice machine behavior encoded in YAML:

- `SliceSetup` runs defensive scaffold actions matching the collection scaffold and transitions to `Implementing`. This intentionally means the repair path now creates `physicalplan/` if it is missing, while `slices init` now creates an empty `notes/` directory. The unified list is the source of truth for both paths.
- `Implementing` runs `implementer`, then transitions to `PolishingReview` only when `implementation_done.md` exists; otherwise stays with reason `missing_implementation_done`.
- `PolishingReview` runs `polisher_reviewer`, transitions to `PolishingFix` with action `remove_file: implementation_accepted.md` when `polishing_issues.md` has open issues, transitions to `Completed` when `implementation_accepted.md` exists and no polishing issues are open, otherwise stays with reason `polishing_review_incomplete`.
- `PolishingFix` runs `polisher` and transitions unconditionally to `PolishingReview`.
- `Completed` is terminal.

Profile YAML files must contain:

- `harness`, `model`, `reasoning_effort`, `idle_timeout_seconds`
- `prompt` path relative to the profile file
- `runtime_context` toggles required by the preamble
- `runtime_context.include_reference_docs_path: true` for every default profile, because the shared default preamble references `$reference_docs`
- `modify.allow` and `modify.block` converted from current `$currentQuest`, `$currentSlice`, `$currentProject` placeholders to `$quest`, `$active_child`, `$project`
- `thread.scope`, `thread.name_template`, and `thread.registry_key_template`

Default profile values should match the current `default_state_execution_config.yaml` except for placeholder names and the removal of per-quest `harnesses`. Use these thread templates:

- quest-scoped profiles: `{repo}_quest_{quest_number:04d}_{profile}` and registry key `{profile}`
- child-scoped profiles: `{repo}_quest_{quest_number:04d}_slice_{child_number:04d}_{profile}` and registry key `slice_{child_number}_{profile}`

## Existing APIs To Reuse

- Reuse `yaml.safe_load` and the existing validation style in `quest_fs.validate_state_execution_config_text()`.
- Reuse `quest_types.utc_now_iso()` only for later action execution; this slice should validate `{now}` placeholders but does not execute actions.
- Reuse current role prompt markdown as source content, then treat the copied files under `default_workflow/prompts/` as authoritative workflow data.

## APIs To Extend Or Modify

- Add a `WorkflowValidationError` exception with messages that identify the file and field path.
- Add `load_workflow(workflow_dir: Path) -> WorkflowDefinition`.
- Add `load_packaged_default_workflow() -> WorkflowDefinition`.
- Add helper methods on the loaded workflow for:
  - resolving machine definitions by key
  - resolving profiles and prompt paths
  - enumerating declared issue paths
  - finding a collection by active variable or by path pattern
- Keep this API independent from `QuestState`, `SliceState`, role enums, and node classes.

## Validation Expectations

- Unit tests load the packaged default workflow and assert all states, profiles, issue declarations, collection scaffold actions, `persisted_as`, and `node_name` overrides match the spec.
- Unit tests assert default collection scaffold action content byte-for-byte, especially `state_history.md` content `"# State Transition History\n\n"`.
- Validation rejects:
  - missing `entry_machine`
  - machine file whose `machine` field does not match its key
  - transition target not declared in the same machine
  - unknown `run.profile`
  - unknown child collection or collection machine
  - `child_result` outside a child-running state
  - duplicate or colliding `persisted_as`
  - missing prompt file
  - absolute paths in workflow-owned paths where quest-relative paths are required
- `make -C projects/quest-runner test` should still pass; no execution behavior should change in this slice.
