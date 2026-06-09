# Current Workflow Embedding Inventory

This document lists the current Quest Runner execution files that embed
workflow-specific data, then enumerates the decision points in the hard-coded
state machine. This is the replacement checklist for the new state-machine
language.

The physical planner must not preserve these workflow paths as fallback behavior.
This quest is complete only when all hard-coded workflow paths listed here are
removed from the runner and the runner executes the configured state-machine
language instead.

## Execution files with embedded workflow data

### `src/quest_runner_service/state_machine/quest_v2_definitions.py`

Hard-codes the state machine catalog itself.

- Defines the top-level quest machine named `quest`.
- Hard-codes quest states:
  - `PrePlanning`
  - `PhysicalPlanning`
  - `ReviewPhysicalPlan`
  - `PrepareNextSlice`
  - `ExecuteSlice`
  - `QuestDocumenting`
  - `Completed`
- Hard-codes `Completed` as the top-level terminal state.
- Defines the nested slice machine named `slice`.
- Hard-codes slice states:
  - `SliceSetup`
  - `Implementing`
  - `PolishingReview`
  - `PolishingFix`
  - `Completed`
- Hard-codes `Completed` as the slice terminal state.
- Selects whether a state-machine directory is the quest root machine or a slice
  child machine by comparing paths.

### `src/quest_runner_service/state_machine/quest_v2_nodes.py`

Hard-codes node behavior, role assignment, recursive execution, and some default
fallback transitions.

Embedded workflow data:

- `PhysicalPlanningNode` runs role `physical_planner`.
- `ReviewPhysicalPlanNode` runs role `physical_plan_reviewer`.
- `QuestDocumentingNode` runs role `documenter`.
- `SliceImplementingNode` runs role `implementer`.
- `SlicePolishingReviewNode` runs role `polisher_reviewer`.
- `SlicePolishingFixNode` runs role `polisher`.
- `PrePlanningGateNode` and `CompletedGateNode` are no-op gate nodes.
- `SliceSetupNode` currently calls slice scaffolding and always advances to `Implementing`. In normal quests this appears to be effectively a state-only initialization step because slices created through the CLI already contain the scaffolded files.
- `SlicePolishingFixNode` always advances back to `PolishingReview`.
- `ExecuteActiveSliceNode` assumes the quest state has an `active_slice` tag,
  loads `slices/<active_slice>` as a child state machine, runs exactly one child
  step, and maps child completion back to the parent quest transition.

### `src/quest_runner_service/state_machine/quest_v2_predicates.py`

Hard-codes the transition predicates for both the quest and slice machines.

Embedded workflow data:

- Physical planning can advance only when slice directories exist and every
  slice has required physical-plan files.
- Physical plan review loops back to physical planning when physical-plan issues
  are open.
- Physical plan review advances only when the physical plan acceptance marker
  exists and no physical-plan issues are open.
- Slice selection uses ordered slice directories and an `active_slice` tag.
- Slice implementation advances only when `implementation_done.md` exists.
- Polishing review loops to polishing fix when polishing issues are open.
- Polishing review completes the slice only when `implementation_accepted.md`
  exists and no polishing issues are open.
- Quest documenting completes only when project docs changed since the recorded
  documenter base ref.

### `src/quest_runner_service/state_machine/v2_step_executor.py`

Duplicates hard-coded state-machine logic for manual advance and single-commit
step execution.

Embedded workflow data:

- Branches on exact slice state strings in `_evaluate_slice_advance`.
- Branches on exact quest state strings in `_evaluate_quest_advance`.
- Knows the node class names to include in recursive snapshots.
- Knows that `ExecuteSlice` runs one nested slice-machine step.
- Knows that a completed child slice maps the parent from `ExecuteSlice` to
  `PrepareNextSlice`; otherwise the parent stays in `ExecuteSlice`.
- Knows that `QuestDocumenting` needs a documenter base ref.
- Knows that `Completed` is terminal.
- Applies transition side effects through the legacy `TransitionPlan` path.

### `src/quest_runner_service/quest_runner.py`

Contains most of the current workflow-specific execution details outside the
`state_machine/` package.

Embedded workflow data:

- `_ROLE_MAP` maps quest/slice state pairs to role names.
- File marker constants:
  - `implementation_done.md`
  - `physicalplan_accepted.md`
  - `implementation_accepted.md`
- `quest_has_open_physicalplan_issues()` reads `physicalplan_issues.md` and
  treats any issue with status `open` as blocking.
- `slice_has_open_polishing_issues()` reads `polishing_issues.md` and treats any
  issue with status `open` as blocking.
- `all_required_slice_plan_files_exist()` requires each slice to contain:
  - a `physicalplan/` directory
  - at least one `physicalplan/*.md` file
  - `state.md`
  - `state_history.md`
  - `polishing_issues.md`
- `implementer_done_signal()` checks for `implementation_done.md`.
- `physical_plan_review_done_signal()` checks for no open physical-plan issues
  and `physicalplan_accepted.md`.
- `implementation_review_done_signal()` checks for no open polishing issues and
  `implementation_accepted.md`.
- `docs_updated_for_quest()` checks git changes under the project docs path.
- `build_task_instruction()` branches on quest and slice state names and returns
  hard-coded task instructions for each role/state.
- `_SLICE_SCOPED_THREAD_ROLES` hard-codes which roles have per-slice threads.
- `role_thread_key()` hard-codes registry keys for slice-scoped roles.
- `reviewer_commit_context()` hard-codes reviewer source-thread selection:
  - physical-plan reviewer reviews physical-planner commits
  - first polishing review reviews implementer commits
  - later polishing reviews review polisher commits
- `build_v2_transition_plan()` hard-codes transition interpretation between
  legacy quest/slice state files and v2 recursive snapshots.
- `find_next_slice()` hard-codes ordered numeric slice selection.
- `scaffold_slice_dir()` hard-codes slice scaffolding files.
- `apply_transition_filesystem_side_effects()` hard-codes cleanup side effects:
  - remove `physicalplan_accepted.md` when review sends the quest back to
    physical planning
  - remove `implementation_accepted.md` when polishing review sends the slice to
    polishing fix

### `src/quest_runner_service/quest_runner_v2.py`

Hard-codes runner-loop handling for current quest state names.

Embedded workflow data:

- Returns `pre_planning` without running when quest state is `PrePlanning`.
- Returns `completed` when quest state is `Completed`.
- Handles `ExperimentComplete` as a special terminal experiment state.
- Records the documenter base ref when quest state first becomes
  `QuestDocumenting`.
- Constructs the hard-coded `QuestV2MachineLoader` and hard-coded quest machine
  definition directly.

### `src/quest_runner_service/state_machine/legacy_quest_state_io.py`

Hard-codes compatibility mapping between legacy quest/slice state files and the
recursive machine state model.

Embedded workflow data:

- Maps slice `NotStarted` to logical `SliceSetup`.
- Maps slice `Done` to logical `Completed`.
- Maps logical `SliceSetup` back to slice `NotStarted`.
- Maps logical `Completed` back to slice `Done`.
- Requires `ExecuteSlice` to have or recover a current slice.
- Stores `active_slice` only for `ExecuteSlice` and `PrepareNextSlice`.

### `src/quest_runner_service/state_machine/v2_quest_state_io.py`

Hard-codes normalized quest state validation against current `QuestState` enum
values.

Embedded workflow data:

- Validates top-level state names against `QuestState`.
- Requires `ExecuteSlice` to have an `active_slice` tag or existing
  `current_slice`.
- Stores `active_slice` only for `ExecuteSlice` and `PrepareNextSlice`.

### `src/quest_runner_service/quest_types.py`

Defines hard-coded state and role-supporting enums used throughout execution.

Embedded workflow data:

- `QuestState` names the current fixed quest workflow states.
- `SliceState` names the current fixed slice workflow states.
- `ExecutionProfile` and `HarnessKind` support the current role/profile config
  model, which must become generic state-machine configuration rather than a
  workflow-specific side channel.

### `src/quest_runner_service/quest_thread.py`

Hard-codes role prompt and thread naming behavior.

Embedded workflow data:

- `build_spec_thread_name()` treats `implementer`, `polisher_reviewer`, and
  `polisher` as slice-scoped roles.
- `build_spec_thread_name()` treats `physical_planner`,
  `physical_plan_reviewer`, and `documenter` as quest-scoped roles.
- `build_role_prompt()` loads prompts from `roles/<role>.md`, tying prompt
  lookup to role names rather than state-machine configuration.
- `_issue_workflow_cli_summary()` embeds workflow instructions for physical-plan
  and polishing issue scopes.
- `build_runtime_context()` embeds assumptions about specs, slices, project docs,
  issue workflow, and role names.
- `_issue_workflow_cli_summary()` and `build_runtime_context()` together form the
  per-agent message preamble.
  - **Resolution note:** the preamble assembly stays generic runner behavior,
    but its workflow-specific text (field labels, `specs/` guidance, issue-CLI
    help, do-not-edit list) moves into a workflow-owned `workflow/preamble.md`
    template interpolated with runner-exposed variables. The runner no longer
    formats a labeled fact block of its own. See `08_agent_preamble.md`.

### `src/quest_runner_service/roles/*.md`

These files are prompt bodies for the current hard-coded roles.

Embedded workflow data:

- `physical_planner.md`
- `physical_plan_reviewer.md`
- `implementer.md`
- `polisher_reviewer.md`
- `polisher.md`
- `documenter.md`

The new state-machine config directory must own these prompts or their
replacement content. The runner must not know these role names as built-in
workflow roles.

### `src/quest_runner_service/default_state_execution_config.yaml`

Defines the current default execution profile map for hard-coded role names.

Embedded workflow data:

- Harness/model/timeout/modify rules keyed by current role names.
- Path variables such as `$currentQuest`, `$currentSlice`, and
  `$currentProject` used by the current workflow.

The new default must be a state-machine configuration directory, copied into new
quests automatically.

### `src/quest_runner_service/quest_service.py`

Hard-codes quest creation and API behavior that assumes the current workflow
format.

Embedded workflow data:

- New quests start in `PrePlanning`.
- New quests get `physicalplan_issues.md`.
- New quests get `state_execution_config.yaml` copied from the package default.
- Experiment and manual-advance paths branch on `ExperimentComplete` and current
  quest states.

### `src/quest_runner_service/quest_fs.py`

Hard-codes state-file parsing and validation against current workflow enums.

Embedded workflow data:

- Parses top-level quest state values as `QuestState`.
- Parses slice state values as `SliceState`.
- Enforces that `ExecuteSlice` has `current_slice` and non-`ExecuteSlice` states
  do not.
- Reads `state_execution_config.yaml` and validates the current profile-based
  config shape.

### `src/quest_runner_service/issue_service.py`

Hard-codes issue scopes and ownership rules used by the current workflow.

Embedded workflow data:

- Physical-plan issues are quest-scoped.
- Polishing issues are slice-scoped.
- Polishing issue operations require a slice number.
- Issue owner roles are tied to current reviewer roles.

### Dashboard and web UI files (out of scope)

`dashboard_data.py` (and related dashboard/web UI code) reads quest state via
`quest_fs` and branches on values such as `ExecuteSlice`, `current_slice`, and
`ExperimentComplete`. These files are **explicitly out of scope for this
quest**: they must not be modified. Their requirements are satisfied by
keeping the on-disk state formats, the derived `current_slice` reader
behavior, the reserved `ExperimentComplete` value, and the snapshot/commit
format unchanged (see `07_compatibility_and_execution_semantics.md`).

## Hard-coded decision points to encode in the new language

The new state-machine language must support at least the following decisions and
actions.

### Top-level quest machine decisions

1. `PrePlanning`
   - Current runner behavior: do not execute a harness step; return
     `pre_planning` from `run_quest_v2`.
   - Manual advance behavior: transition to `PhysicalPlanning`.
   - Language need: gate/manual transition and start-state behavior.

2. `PhysicalPlanning`
   - Execute role: `physical_planner`.
   - Decision after execution:
     - If at least one slice directory exists and all required slice plan files
       exist for every slice, transition to `ReviewPhysicalPlan`.
     - Otherwise remain in `PhysicalPlanning` / block manual advance with reason
       `incomplete_physical_plan`.
   - Required files per slice:
     - `physicalplan/` directory
     - at least one `physicalplan/*.md`
     - `state.md`
     - `state_history.md`
     - `polishing_issues.md`

3. `ReviewPhysicalPlan`
   - Execute role: `physical_plan_reviewer`.
   - Decision after execution:
     - If any `physicalplan_issues.md` entry has status `open`, transition to
       `PhysicalPlanning`.
     - Else if `physicalplan_accepted.md` exists, transition to
       `PrepareNextSlice`.
     - Else remain in `ReviewPhysicalPlan` / block manual advance with reason
       `physical_plan_review_incomplete`.
   - Side effect when transitioning back to `PhysicalPlanning`:
     - remove stale `physicalplan_accepted.md`.

4. `PrepareNextSlice`
   - Execute: no harness.
   - Decision:
     - List slice directories in order.
     - Unfinished slices are slices whose persisted state is not `Done`.
     - If no unfinished slices remain, transition to `QuestDocumenting`.
     - If there is no current active slice, transition to `ExecuteSlice` with
       `active_slice` set to the first unfinished slice.
     - If active slice is missing from the ordered list, transition to
       `ExecuteSlice` with `active_slice` set to the first unfinished slice.
     - Otherwise choose the first unfinished slice whose order is greater than
       the current active slice; if found, transition to `ExecuteSlice` with that
       `active_slice`.
     - If no later unfinished slice exists, transition to `QuestDocumenting`.

5. `ExecuteSlice`
   - Execute: load the child machine at `slices/<active_slice>` and run one child
     step.
   - Required data:
     - `active_slice` tag or equivalent.
     - child machine directory must exist.
   - Decision after child step:
     - If child state after the step is `Completed`, transition parent to
       `PrepareNextSlice`.
     - Otherwise remain in `ExecuteSlice`.

6. `QuestDocumenting`
   - Execute role: `documenter`.
   - Decision after execution:
     - If project docs changed since the documenter base ref, transition to
       `Completed`.
     - Otherwise remain in `QuestDocumenting` / block manual advance with reason
       `docs_unchanged`.
   - Required support:
     - capture the git ref when entering documentation.
     - check committed, unstaged, staged, and untracked changes under the current
       project docs directory.
   - **Resolution note:** the documenting state itself is carried into the new
     default workflow, but the docs-changed gate, the base-ref capture, and the
     `docs_unchanged` manual-advance block are intentionally **dropped** (see
     `03_workflow_language_proposal.md`). After the documenter runs, the quest
     completes unconditionally. The workflow language therefore needs no
     git-diff condition primitive and no entry-time ref capture.

7. `Completed`
   - Terminal state.
   - Current runner returns `completed` and does not run more workflow steps.

8. `ExperimentComplete`
   - Special experiment terminal outside the normal quest graph.
   - Current runner returns `experiment_complete` when experiment stop conditions
     are met.
   - The replacement must either encode this as config or isolate it as generic
     experiment machinery without workflow-specific state-name branching.
   - **Resolution note:** it stays generic experiment machinery.
     `ExperimentComplete` becomes a runner-reserved terminal state name written
     only by experiment finalization and accepted by state readers for any
     workflow, so existing dashboard/API behavior is unchanged (see
     `03_workflow_language_proposal.md` and
     `07_compatibility_and_execution_semantics.md`).

### Slice child machine decisions

1. `SliceSetup`
   - Execute: currently calls `scaffold_slice_dir()`, but this is normally redundant for CLI-created slices.
   - Verification from git history:
     - commits whose recursive snapshots contain child `node_name: SliceSetupNode` show only the slice `state.md` and top-level quest `state.md` changing; the setup step does not create missing scaffold files in normal runs.
     - example: commit `89414b7` for `projects/quest-runner/quests/main/0000_experiments/slices/0001_experiment_foundation` changes only the slice `state.md` and quest `state.md` while moving the child from `SliceSetup` to `Implementing`.
   - Existing defensive side effects, if the slice was not CLI-created:
     - create `state.md` if missing, with persisted slice state `NotStarted`
     - create `state_history.md` if missing
     - create `polishing_issues.md` if missing
     - create `notes/` if missing
   - Decision: transition to `Implementing`.
   - Language implication: slice setup does not need to be a special built-in workflow node. It can be represented as an initial child-machine state with an unconditional transition, optionally with generic "ensure files/directories exist" actions if we still want defensive repair behavior.

2. `Implementing`
   - Execute role: `implementer`.
   - Decision after execution:
     - If `implementation_done.md` exists in the slice, transition to
       `PolishingReview`.
     - Otherwise remain in `Implementing` / block manual advance with reason
       `missing_implementation_done`.

3. `PolishingReview`
   - Execute role: `polisher_reviewer`.
   - Decision after execution:
     - If any `polishing_issues.md` entry has status `open`, transition to
       `PolishingFix`.
     - Else if `implementation_accepted.md` exists, transition to `Completed`.
     - Else remain in `PolishingReview` / block manual advance with reason
       `polishing_review_incomplete`.
   - Side effect when transitioning to `PolishingFix`:
     - remove stale `implementation_accepted.md`.

4. `PolishingFix`
   - Execute role: `polisher`.
   - Decision: always transition to `PolishingReview`.

5. `Completed`
   - Terminal slice state.
   - Persisted legacy slice state is `Done`.

### Cross-cutting decision points

- Human intervention request:
  - if `human_intervention_request.md` exists, stop execution and return
    `human_intervention`.
- Dirty workspace:
  - before harness execution, enforce profile path rules and workspace cleanliness.
- Harness path enforcement:
  - after harness execution, detect illegal modifications, revert them, write a
    human-intervention request if needed, and optionally send follow-up messages.
- Step commit creation:
  - if a step produced no transition and no changed files, it is a no-op.
  - otherwise apply transition side effects, validate recursive snapshot metadata,
    stage files, and commit.
- Review context selection:
  - review roles receive commit hashes from source roles based on workflow state
    and reviewer round count.
  - **Resolution note:** the current `reviewer_commit_context()` implementation
    is buggy and in practice yields `- (none found)` in reviewer prompts.
    It is replaced by prompt guidance (reviewers run `git log` themselves);
    this is not a behavior regression. No automatic source-role git-ref
    tracking is carried forward.
- Thread scoping:
  - some roles are quest-scoped and some are slice-scoped.
- Path variables:
  - prompts and modify rules use current quest, current slice, and current
    project path variables.

## How the graph represents successive sub-state machines

The current graph is recursive rather than a single flat graph.

- The top-level quest machine owns global quest progress.
- The `PrepareNextSlice` state chooses the next unfinished slice and records it as
  the `active_slice` tag.
- The `ExecuteSlice` state is a parent node that delegates one step to a child
  state machine rooted at `slices/<active_slice>`.
- Each slice directory is treated as its own independent slice machine with the
  same slice-state graph.
- After each child step, the child returns a recursive snapshot to the parent.
- If the child snapshot says the slice reached `Completed`, the parent advances
  from `ExecuteSlice` to `PrepareNextSlice`; `PrepareNextSlice` then chooses the
  next unfinished slice or moves to `QuestDocumenting` if all slices are done.
- If the child is not complete, the parent remains in `ExecuteSlice`, so the next
  quest runner step resumes the same child slice machine.

In effect, a main quest is a sequence of sub-state machines:

1. planning/review loop at quest scope;
2. repeated slice machines, one per ordered slice directory;
3. documentation/completion at quest scope.

The new language must represent this recursive structure explicitly: a state
must be able to select a child machine instance, run one child step, inspect the
child result, and use that result to decide the parent transition.
