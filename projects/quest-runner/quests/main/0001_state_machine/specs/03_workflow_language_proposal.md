# Workflow Language Proposal

## First-class runner concepts that may remain special

The new runner should be a generic workflow interpreter. These concepts may
remain first-class in the runner:

- **Workflow**: the quest-local program copied into a quest and executed by the
  runner. It contains state machines, profiles, prompts, issue declarations,
  transition rules, and workflow-owned files.
- **Completed state**: a state named `Completed` may remain special as a generic
  terminal state. State machines may also explicitly declare terminal states, but
  the runner may recognize `Completed` as the default terminal.
- **Pre-planning stop behavior**: `PrePlanning` is a fully valid workflow state,
  but the default workflow marks its only transition as manual-only. `run_quest`
  must not start normal automated execution while the quest remains in
  `PrePlanning`.
- **Human intervention requests**: `human_intervention_request.md` remains a
  first-class runner stop condition. If present, the runner stops before further
  workflow execution.
- **Issues**: issue files remain first-class, but issue types do not. The runner
  and CLI understand issue-file operations such as list, read, create, edit,
  close, and respond. The workflow declares issue files by path relative to the
  quest root. The runner must not know `physicalplan`, `polishing`, or any other
  issue type as a built-in scope.
- **State-machine execution**: loading a machine, executing one node, evaluating
  transitions, running nested machines, and committing step metadata remain
  runner responsibilities.
- **Profiles and harness execution**: the runner may know how to execute a
  profile with a harness, model, timeout, prompt, and path permissions. It must
  not know which profile belongs to which workflow state except through the
  workflow config.
- **Path variables and workflow variables**: the runner may support generic path
  variables such as `$quest`, `$project`, `$machine`, `$active_child`, and
  workflow-defined variables such as `active_slice`.
- **Experiments**: experiments may remain first-class runner machinery, but they
  should operate by copying/replacing a whole workflow directory, not by replacing
  one YAML file. Experiment stop conditions should be declared by experiment YAML
  against generic snapshot data such as machine path, node name, state before, and
  state after.

Everything else should be workflow data, not Python workflow logic. In
particular, the runner must not hard-code current role names, current issue-file
names, slice state names, review loops, slice advancement rules, acceptance file
names, documentation requirements, or task instructions.

## Proposed workflow directory layout

```text
workflow/
  workflow.yaml
  preamble.md
  machines/
    quest.yaml
    slice.yaml
  profiles/
    physical_planner.yaml
    physical_plan_reviewer.yaml
    implementer.yaml
    polisher_reviewer.yaml
    polisher.yaml
    documenter.yaml
  prompts/
    physical_planner.md
    physical_plan_reviewer.md
    implementer.md
    polisher_reviewer.md
    polisher.md
    documenter.md
```

`workflow/` replaces `state_execution_config.yaml` for new quests. The whole
directory is copied into each new quest. Experiments also replace/copy this
whole directory.

## Proposed `workflow.yaml`

```yaml
version: 1
name: default-main-quest
entry_machine: quest

special:
  completed_state: Completed
  human_intervention_file: human_intervention_request.md

preamble: preamble.md

variables:
  quest: .
  specs: specs
  project_docs: $project/docs

scaffold:
  - ensure_file:
      path: physicalplan_issues.md
      content: "# Issues\n"

collections:
  slices:
    path: slices/*
    machine: slice
    order: lexical
    id_from: directory_name
    active_var: active_slice
    scaffold:
      - ensure_file:
          path: state.md
          content: "# Slice State\n\nstate: NotStarted\nupdated_at: {now}\n"
      - ensure_file:
          path: state_history.md
          content: "# State Transition History\n"
      - ensure_file:
          path: polishing_issues.md
          content: "# Issues\n"
      - ensure_dir: notes

issues:
  physical_plan:
    path: physicalplan_issues.md
    owner: physical_plan_reviewer
  polishing:
    path: "$active_child/polishing_issues.md"
    owner: polisher_reviewer

machines:
  quest: machines/quest.yaml
  slice: machines/slice.yaml

profiles:
  physical_planner: profiles/physical_planner.yaml
  physical_plan_reviewer: profiles/physical_plan_reviewer.yaml
  implementer: profiles/implementer.yaml
  polisher_reviewer: profiles/polisher_reviewer.yaml
  polisher: profiles/polisher.yaml
  documenter: profiles/documenter.yaml
```

Notes:

- Issue keys such as `physical_plan` and `polishing` are workflow-local aliases,
  not runner-known issue types.
- The workflow declares only issue files. It does not declare response files.
  Response storage is an issue-system/CLI concern derived from the issue file or
  handled internally by the issue CLI.
- CLI issue commands should accept quest-relative issue-file paths, for example:
  - `scripts/quest-runner issues list --file physicalplan_issues.md`
  - `scripts/quest-runner issues list --file slices/0001_foundation/polishing_issues.md`

## How `active_slice` works

`active_slice` is not a built-in Python concept. It is a workflow variable
introduced by the `slices` collection and written by the `select_child` action.

The workflow says:

```yaml
collections:
  slices:
    path: slices/*
    machine: slice
    order: lexical
    id_from: directory_name
    active_var: active_slice
```

This means:

1. The workflow has a child-machine collection named `slices`.
2. Each directory matching `slices/*` is one instance of the `slice` machine.
3. The child id is the directory name, for example `0001_foundation`.
4. The currently selected child id is stored in workflow variable `active_slice`.
5. `{active_slice}` can be interpolated if a string needs the directory name.
6. `$active_child` resolves to the active child directory for issue paths, prompt
   context, and profile path rules.

So `active_slice` is known only because the workflow declares it as the active
variable for the `slices` collection. A different workflow could call this
variable something else.

The default workflow deliberately names the variable `active_slice` — the same
tag name the current runner writes into the quest root `state.md` `## Tags`
section. Because workflow variables persist as machine tags (see
`07_compatibility_and_execution_semantics.md`), keeping the current name keeps
quest `state.md` files and snapshot `tags` byte-identical with the current
runner, and lets the dashboard reader's `current_slice` derivation continue to
work without any dashboard changes.

`active_slice` is not an integer. For the default workflow it is the full
slice directory name, including the zero-padded number and slug, such as
`0001_foundation` (this is already what the current runner stores in the
`active_slice` tag). That avoids reconstructing paths from separate fields and
avoids encoding lpad behavior in every path. The collection reader may also
expose parsed metadata for templates, such as `active_child.number = 1`,
`active_child.number_padded = "0001"`, and `active_child.slug = "foundation"`, but
paths should normally use `$active_child/...` rather than
`slices/{active_slice_number_padded}_{active_slice_slug}/...`.

## Proposed machine language

Each machine declares states. A state may run a profile, run a child machine,
perform generic file actions, and then evaluate ordered transitions.

```yaml
machine: quest
initial: PrePlanning
terminal: [Completed]

states:
  StateName:
    run:
      profile: some_profile
      task: |
        Prompt fragment for this node.
    actions:
      - ensure_file:
          path: some/path.md
          content: "# Heading\n"
    child:
      collection: slices
      active: active_slice
      run: one_step
    transitions:
      - if: some_condition
        to: NextState
      - stay:
          reason: some_reason
```

### Condition primitives needed initially

```yaml
exists: path          # path exists (file or directory)
file_exists: path     # path exists and is a regular file
dir_exists: path      # path exists and is a directory
not_exists: path
file_count_at_least:
  glob: slices/*/physicalplan/*.md
  count: 1
no_open_issues:
  file: physicalplan_issues.md
has_open_issues:
  file: "$active_child/polishing_issues.md"
all_children:
  collection: slices
  require: []
child_result:
  state_after: Completed
var_exists: next_slice
```

### Generic actions needed initially

```yaml
- ensure_dir: path
- ensure_file:
    path: path
    content: text
- remove_file: path
- clear_var: active_slice
- select_child:
    collection: slices
    where:
      state_not: Completed
    after: active_slice
    set: active_slice
    result: next_slice
```

`select_child` is the main abstraction for implicit slice advancement. It lets
the workflow say: choose the next unfinished child machine in ordered slice
directories, store it as `active_slice`, and let `ExecuteSlice` run that child.
This avoids hard-coding slice progression in Python. Its exact semantics
(strictly-after selection, no fallback to earlier children) are defined in
`05_workflow_yaml_grammar.md` and intentionally match the current
`prepare_next_slice_transition()` behavior.

## Reviewer commit context

The current runner appends reviewer commit hashes with Python logic that knows
which role reviews which other role. That must not remain hard-coded.

Note: the current implementation (`reviewer_commit_context()` matching commit
subjects against thread names with `git log --since`) is buggy in practice and
typically yields `- (none found)` in the reviewer prompt. Replacing it with
prompt guidance is therefore not a behavior regression; reviewers already work
from `git log` on their own.

For the proposed first implementation, reviewer commit context should be handled
in prompts, not as automatic git-ref tracking:

- `physical_plan_reviewer` prompt should instruct the reviewer to use `git log`
  and the physical-planner thread/log history to identify physical-planning
  commits relevant to the review.
- `polisher_reviewer` prompt should explicitly instruct the reviewer to use
  `git log` to find implementer commits for the current slice on the first
  review pass, and relevant polisher commits on later review passes if needed.
- The workflow should not specify exact git refs for polishing review.
- The runner may expose generic runtime context such as current quest path,
  current child path, profile name, thread registry location, and log directory,
  but it must not select source roles using hard-coded workflow knowledge.

If later automation is needed, it should be a generic profile option such as
`review_context.git_log_instructions`, not Python code keyed to role names.

## Initial implementation of the current quest workflow

### `machines/quest.yaml`

```yaml
machine: quest
initial: PrePlanning
terminal: [Completed]

states:
  PrePlanning:
    node_name: PrePlanningGateNode
    transitions:
      - to: PhysicalPlanning
        mode: manual_only
      - stop:
          status: pre_planning

  PhysicalPlanning:
    node_name: PhysicalPlanningNode
    run:
      profile: physical_planner
      task: |
        If open physical-plan issues exist, address them using the issue CLI with
        issue file `physicalplan_issues.md`.

        Otherwise read `specs/`, decide the full ordered slice list, initialize
        slices with the slice CLI, and write at least one plan markdown file under
        each slice's `physicalplan/` directory.
    transitions:
      - if:
          all:
            - child_dirs_exist:
                collection: slices
            - all_children:
                collection: slices
                require:
                  - dir_exists: physicalplan
                  - file_count_at_least:
                      glob: physicalplan/*.md
                      count: 1
                  - file_exists: state.md
                  - file_exists: state_history.md
                  - file_exists: polishing_issues.md
        to: ReviewPhysicalPlan
      - stay:
          reason: incomplete_physical_plan

  ReviewPhysicalPlan:
    node_name: ReviewPhysicalPlanNode
    run:
      profile: physical_plan_reviewer
      task: |
        Review all slice physical plans. Use the issue CLI with issue file
        `physicalplan_issues.md` to create, edit, or close issues. If no open
        issues remain, create `physicalplan_accepted.md` with an acceptance
        summary.
    transitions:
      - if:
          has_open_issues:
            file: physicalplan_issues.md
        to: PhysicalPlanning
        actions:
          - remove_file: physicalplan_accepted.md
      - if:
          all:
            - no_open_issues:
                file: physicalplan_issues.md
            - file_exists: physicalplan_accepted.md
        to: PrepareNextSlice
      - stay:
          reason: physical_plan_review_incomplete

  PrepareNextSlice:
    node_name: PrepareNextSliceNode
    actions:
      - select_child:
          collection: slices
          where:
            state_not: Completed
          after: active_slice
          set: active_slice
          result: next_slice
    transitions:
      - if:
          var_exists: next_slice
        to: ExecuteSlice
      - to: QuestDocumenting
        actions:
          - clear_var: active_slice

  ExecuteSlice:
    node_name: ExecuteActiveSliceNode
    child:
      collection: slices
      active: active_slice
      run: one_step
    transitions:
      - if:
          child_result:
            state_after: Completed
        to: PrepareNextSlice
      - to: ExecuteSlice

  QuestDocumenting:
    node_name: QuestDocumentingNode
    run:
      profile: documenter
      task: |
        Write documentation in the current project's docs directory describing
        what was built across the full quest. Do not modify repo-root `docs/`
        unless it is the current project's docs directory.
    transitions:
      - to: Completed

  Completed:
    node_name: CompletedGateNode
    terminal: true
```

`QuestDocumenting` is preserved from the current workflow: the documenter
profile runs at quest scope after all slices complete, before `Completed`.

One deliberate simplification: the current runner gates the
`QuestDocumenting -> Completed` transition on "project docs changed since the
documenter base ref", which requires the runner to capture and track a git ref
when entering the state. That gate and the base-ref tracking are intentionally
dropped. The documenter runs, then the quest completes unconditionally. The
workflow language therefore needs no git-diff condition primitive and no
state-entry ref capture. Manual advance from `QuestDocumenting` likewise
succeeds without a docs check.

The `node_name` fields pin the snapshot/commit node names to the current Python
class names so that commit messages and recursive snapshots produced by the new
interpreter are byte-format-identical with existing git history (see
`06_snapshot_generation_and_compatibility.md`). They are optional display
metadata; a workflow that omits them gets the state id as the node name.

### `machines/slice.yaml`

```yaml
machine: slice
initial: SliceSetup
terminal: [Completed]

states:
  SliceSetup:
    node_name: SliceSetupNode
    persisted_as: NotStarted
    actions:
      # Defensive only. CLI-created slices already have these files, so normal
      # SliceSetup commits should only change state.
      - ensure_file:
          path: state.md
          content: "# Slice State\n\nstate: NotStarted\nupdated_at: {now}\n"
      - ensure_file:
          path: state_history.md
          content: "# State Transition History\n"
      - ensure_file:
          path: polishing_issues.md
          content: "# Issues\n"
      - ensure_dir: notes
    transitions:
      - to: Implementing

  Implementing:
    node_name: SliceImplementingNode
    run:
      profile: implementer
      task: |
        Implement the plan described in this slice's `physicalplan/` directory.
        When the full plan is complete, create `implementation_done.md` in this
        slice with a brief completion summary.
    transitions:
      - if:
          file_exists: implementation_done.md
        to: PolishingReview
      - stay:
          reason: missing_implementation_done

  PolishingReview:
    node_name: SlicePolishingReviewNode
    run:
      profile: polisher_reviewer
      task: |
        Review the implementation in this slice. Use `git log` and the current
        slice path to find implementer commits for this slice on the first
        review pass, and relevant polisher commits on later passes, then review
        those changes. Use the issue CLI with this slice's `polishing_issues.md`
        file to create, edit, or close issues. If no open issues remain, create
        `implementation_accepted.md` with an acceptance summary.
    transitions:
      - if:
          has_open_issues:
            file: polishing_issues.md
        to: PolishingFix
        actions:
          - remove_file: implementation_accepted.md
      - if:
          all:
            - no_open_issues:
                file: polishing_issues.md
            - file_exists: implementation_accepted.md
        to: Completed
      - stay:
          reason: polishing_review_incomplete

  PolishingFix:
    node_name: SlicePolishingFixNode
    run:
      profile: polisher
      task: |
        Fix the open polishing issues for this slice. Use the issue CLI with
        this slice's `polishing_issues.md`. Record issue responses through the
        CLI, but do not close issues yourself.
    transitions:
      - to: PolishingReview

  Completed:
    node_name: SliceCompletedNode
    persisted_as: Done
    terminal: true
```

### Persisted state names (`persisted_as`)

The current runner stores slice state in `state.md` as `NotStarted` /
`Implementing` / `PolishingReview` / `PolishingFix` / `Done`, while the
state-machine logic and snapshots use the logical names `SliceSetup` and
`Completed` for the endpoints. That mapping currently lives in Python
(`legacy_quest_state_io.py`). The new language moves it into the machine YAML:
a state may declare `persisted_as: <name>`, the value written to and read from
that machine's `state.md`. All other parts of the system — conditions
(`state_not`, `state_is`, `child_result`), transitions, snapshots, and commit
metadata — operate exclusively on logical state names; the mapping is applied
only at the `state.md` read/write boundary.

For the default workflow this keeps slice `state.md` files byte-identical with
the current runner (`state: NotStarted`, `state: Done`) while snapshots keep
saying `SliceSetup` and `Completed`, exactly as today. The quest machine needs
no `persisted_as` entries because quest states already persist under their
logical names.

## Initial profile language

A profile binds a node to a harness, model, prompt, runtime task template, and
path permissions. The state machine references profiles by name; the runner does
not know their semantics.

Example `profiles/implementer.yaml`:

```yaml
harness: cursor
model: composer-2.5
idle_timeout_seconds: 3600
prompt: ../prompts/implementer.md
modify:
  allow:
    - "$quest/human_intervention_request.md"
    - "$active_child/implementation_done.md"
    - "$active_child/notes/**"
  block:
    - "$project/quests/**"
thread:
  scope: child
  name_template: "{repo}_quest_{quest_number:04d}_slice_{child_number:04d}_{profile}"
  registry_key_template: "slice_{child_number}_{profile}"
```

Example quest-scoped profile (`profiles/physical_planner.yaml`):

```yaml
harness: codex
model: gpt-5.5
idle_timeout_seconds: 1800
prompt: ../prompts/physical_planner.md
modify:
  allow:
    - "$quest/slices/**"
    - "$quest/human_intervention_request.md"
    - "$quest/physicalplan_issue_responses.md"
  block:
    - "**"
thread:
  scope: quest
  name_template: "{repo}_quest_{quest_number:04d}_{profile}"
  registry_key_template: "{profile}"
```

Example reviewer profile prompt guidance:

```yaml
harness: claude_code
model: claude-opus-4-8
idle_timeout_seconds: 1800
prompt: ../prompts/polisher_reviewer.md
runtime_context:
  include_thread_registry_path: true
  include_log_directory: true
  include_current_child_path: true
modify:
  allow:
    - "$active_child/polishing_issues.md"
    - "$active_child/implementation_accepted.md"
    - "$quest/human_intervention_request.md"
  block:
    - "**"
thread:
  scope: child
  name_template: "{repo}_quest_{quest_number:04d}_slice_{child_number:04d}_{profile}"
  registry_key_template: "slice_{child_number}_{profile}"
```

The default workflow ships all six profiles (`physical_planner`,
`physical_plan_reviewer`, `implementer`, `polisher_reviewer`, `polisher`,
`documenter`). Their harness/model/timeout values and `modify` allow/block
rules carry over **verbatim** from the current
`default_state_execution_config.yaml`, with only the path-variable renames
`$currentQuest -> $quest`, `$currentSlice -> $active_child`, and
`$currentProject -> $project`. In particular the CLI-written response-file
allows (`$quest/physicalplan_issue_responses.md` for the planner,
`$active_child/polishing_issue_responses.md` for the polisher) must be carried
over, or the post-harness enforcement pass would revert issue responses written
through the CLI.

`thread.name_template` and `thread.registry_key_template` reproduce the current
`build_spec_thread_name()` names and the current `thread_registry.json` keys
(`physical_planner`, `slice_1_implementer`, ...; `{child_number}` is the
unpadded slice index). This keeps `thread_registry.json` unchanged, so upgraded
quests keep their existing provider threads instead of silently creating new
ones. See `07_compatibility_and_execution_semantics.md`.

## Experiments

Experiments remain first-class runner machinery, with two changes:

1. **Workflow replacement, not file replacement.** An experiment that varies the
   workflow supplies a complete replacement `workflow/` directory instead of a
   single `state_execution_config.yaml`. There is no partial workflow patching.
   An experiment that does not vary the workflow keeps the quest's own
   `workflow/` directory unchanged.

   ```yaml
   experiment:
     workflow_dir: workflow_variants/stop_after_first_slice
   ```

2. **Stop conditions stay snapshot-based.** The stop mechanism is unchanged from
   today: an experiment declares a stop condition as generic snapshot data
   (machine path plus node name), and the runner checks each committed step's
   recursive snapshot against it. Stop-condition validation must read the
   quest's workflow configuration (state ids and `node_name` overrides) instead
   of the hard-coded Python node maps it reads today. Existing alias handling
   for old node class names keeps working because the default workflow pins the
   same node names.

When an experiment's stop condition matches, the runner writes the reserved
state `ExperimentComplete` into the quest root `state.md` and commits it,
exactly as today. `ExperimentComplete` is generic experiment machinery, not a
workflow state: it is a runner-reserved terminal state name that may be written
only by experiment finalization, is accepted by state readers/validators for
any workflow, and is treated as terminal by the runner. Dashboards and the API
already branch on this value and must continue to work unchanged. No workflow
YAML declares it, and the runner contains no other workflow-specific state-name
branching for experiments.

The runner preserves quest-step snapshots in the current shape:

```json
{
  "global_step": 5,
  "snapshot": {
    "machine_name": "quest",
    "machine_path": "projects/quest-runner/quests/main/0000_example",
    "node_name": "ExecuteActiveSliceNode",
    "state_before": "ExecuteSlice",
    "state_after": "ExecuteSlice",
    "tags": {"active_slice": "0001_foundation"},
    "child": {
      "machine_name": "slice_0001_foundation",
      "machine_path": "projects/quest-runner/quests/main/0000_example/slices/0001_foundation",
      "node_name": "SlicePolishingReviewNode",
      "state_before": "PolishingReview",
      "state_after": "Completed",
      "tags": {},
      "child": null
    }
  }
}
```

Because the default workflow pins legacy `node_name` values and keeps the
`active_slice` variable name, snapshots produced by the new interpreter are
byte-format-identical with current history. Other workflows may use their own
node ids; the shape stays the same so dashboards and experiments can continue
to reason over recursive snapshots.

## Slice setup decision

`SliceSetup` is included in the default workflow. It is not a special built-in
runner node; it is a normal workflow state with defensive generic actions, a
`persisted_as: NotStarted` mapping that keeps slice `state.md` files in the
current on-disk format, and an unconditional transition to `Implementing`.
