# Workflow YAML Grammar

This page defines the proposed YAML grammar for quest workflows. The goal is that
all current workflow behavior is represented as data in `workflow/`, while the
Quest Runner remains a generic interpreter.

## Profile `thread.scope`

In profile YAML, `thread.scope` controls thread identity and reuse, not workflow
semantics.

- `quest`: one thread per quest for this profile.
- `child`: one thread per active child-machine instance for this profile, such
  as one implementer thread per slice.
- `machine`: one thread per state-machine instance for this profile. This is a
  more generic form of `child`; for a top-level machine it behaves like quest
  scope, and for a child machine it behaves like child scope.
- `node`: one thread per node instance if we ever need a fresh thread for each
  node/profile binding.

The runner may implement only `quest` and `child` initially if those cover the
current workflow. The important point is that scope is declared by the profile;
the runner must not know that particular role names are slice-scoped.

## File tree

```text
workflow/
  workflow.yaml
  preamble.md
  machines/
    <machine>.yaml
  profiles/
    <profile>.yaml
  prompts/
    <prompt>.md
```

## `workflow.yaml`

Top-level workflow file.

```yaml
version: 1
name: default-main-quest
entry_machine: quest
special:
  completed_state: Completed
  human_intervention_file: human_intervention_request.md
variables: {}
scaffold: []
collections: {}
issues: {}
machines: {}
profiles: {}
```

### Fields

- `version`: integer grammar version.
- `name`: workflow name for diagnostics and dashboard display.
- `entry_machine`: key from `machines`; the top-level machine to execute.
- `special.completed_state`: optional default completed-state name. Defaults to
  `Completed`.
- `special.human_intervention_file`: quest-relative path that stops execution if
  present. Defaults to `human_intervention_request.md`.
- `variables`: workflow-level path/string variables available to interpolation.
- `scaffold`: generic actions applied once at quest creation with the quest
  root as the action base (the default workflow creates
  `physicalplan_issues.md` here, replacing the hard-coded creation in
  `quest_service.py`).
- `preamble`: optional path to the shared agent-message preamble template
  (`preamble.md`). See `08_agent_preamble.md`.
- `collections`: named child-machine collections.
- `issues`: named issue-file aliases. Aliases are workflow-local and not issue
  types.
- `machines`: map from machine name to machine YAML path.
- `profiles`: map from profile name to profile YAML path.

## Collections

Collections define repeated child state-machine instances.

```yaml
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
```

### Fields

- `path`: quest-relative glob whose matches are child-machine directories.
- `machine`: machine definition used for each child.
- `order`: ordering for iteration. Initial values: `lexical`.
- `id_from`: how to identify a child. Initial value: `directory_name`.
- `active_var`: workflow variable where the selected child id is stored. With
  `id_from: directory_name`, this is the full directory name, for example
  `0001_foundation`, not integer `1`. The runner may expose parsed child metadata
  such as number `1`, padded number `0001`, and slug `foundation`, but paths
  should normally use `$active_child/...` instead of reconstructing
  `slices/{number_padded}_{slug}/...`.
- `scaffold`: ordered list of generic actions (same vocabulary as state
  `actions`) applied with the new child directory as the action base. Used by
  the child-creation CLI (`slices init` today) so that the file set scaffolded
  into a new child is workflow data instead of CLI code, and reusable by
  defensive in-machine actions. See
  `07_compatibility_and_execution_semantics.md` for the CLI contract.

## Issues

```yaml
issues:
  physical_plan:
    path: physicalplan_issues.md
    owner: physical_plan_reviewer
  polishing:
    path: "$active_child/polishing_issues.md"
    owner: polisher_reviewer
```

### Fields

- key: workflow-local alias.
- `path`: quest-relative issue file path. May use interpolation.
- `owner`: **default** value written as `owner_role` on issues created in this
  file when the creator does not pass `issues create --owner <name>`. This
  keeps the issue-file entry format byte-identical with the current system,
  where the owner role was derived from the (removed) issue scope.
  `owner_role` is per-issue attribution metadata, displayed but never
  interpreted; the `--owner` override is what lets multiple reviewer profiles
  file issues into the same file (see `04_issue_cli_changes.md`).

For CLI/API validation, a declared `path` containing `$active_child` matches the
corresponding file in **any** child directory of the collection, not only the
currently active child (i.e. `$active_child/polishing_issues.md` validates
`slices/<any-child>/polishing_issues.md`). This preserves the current CLI's
ability to operate on any slice's issues regardless of which slice is active.

Response files are not declared here.

## Machine YAML

```yaml
machine: quest
initial: PrePlanning
terminal: [Completed]
states: {}
```

### Fields

- `machine`: machine name. Must match the key that loaded it.
- `initial`: initial state for new machine instances.
- `terminal`: list of terminal states. `Completed` may be implicitly terminal if
  omitted and configured as the workflow completed state.
- `states`: map of state id to state definition.

## State definition

```yaml
states:
  StateName:
    node_name: null
    persisted_as: null
    actions: []
    run: null
    child: null
    transitions: []
    terminal: false
```

A state executes in this order:

1. `actions`.
2. `run` profile, if present.
3. `child`, if present.
4. `transitions`, first matching transition wins.

### Fields

- `node_name`: optional snapshot/commit node name for this state. Defaults to
  the state id. The default workflow sets the current Python node class names
  (for example `ExecuteActiveSliceNode` for `ExecuteSlice`) so that commit
  metadata stays byte-format-identical with existing history.
- `persisted_as`: optional state name written to and read from this machine's
  `state.md` in place of the logical state id. All conditions, transitions,
  snapshots, and commit metadata use the logical id; the mapping applies only
  at the `state.md` read/write boundary. The default slice machine uses
  `SliceSetup -> NotStarted` and `Completed -> Done` to keep slice `state.md`
  files in the current format. `persisted_as` values must be unique within a
  machine and must not collide with logical state ids of other states.
- `actions`: actions executed every time the node runs.
- `run`: profile execution block.
- `child`: child-machine execution block.
- `transitions`: ordered transition list.
- `terminal`: boolean marker that this state is terminal.

There is no `on_enter` hook. An earlier draft included one (motivated by
capturing a git ref when entering `QuestDocumenting`), but the docs-changed
gate was dropped, no state in the default workflow needs entry-time behavior,
and entry detection would require persisting extra entry-tracking data. It can
be reintroduced later if a workflow needs it.

## Run block

```yaml
run:
  profile: implementer
  task: |
    Implement the current slice.
```

### Fields

- `profile`: profile name from `workflow.yaml`.
- `task`: node-specific task text appended to the profile prompt and runtime
  context.

The runner executes the referenced profile generically. It does not infer role
behavior from the profile name.

## Child block

```yaml
child:
  collection: slices
  active: active_slice
  run: one_step
```

### Fields

- `collection`: collection name from `workflow.yaml`.
- `active`: variable containing the active child id.
- `run`: child execution mode. Initial value: `one_step`.

The child block runs one step of the active child machine and exposes
`child_result` to transitions.

## Transitions

```yaml
transitions:
  - if: <condition>
    to: NextState
    actions: []
  - stay:
      reason: incomplete
  - stop:
      status: pre_planning
```

### Forms

- `to`: transition to another state. If `if` is omitted, it always matches.
  `actions` on the transition run only when it matches, after the state's own
  execution and before the new state is persisted.
- `stay`: remain in the current state and report a reason for manual advance or
  diagnostics.
- `stop`: stop runner execution with a status without changing state.
- `mode: manual_only`: transition is available to manual advance but not normal
  automated run.

First matching transition wins. During automated runs, `manual_only`
transitions are skipped. During manual advance, they are eligible like any
other transition, and a matched `stay` blocks the advance with its reason. The
full manual-advance algorithm (which mirrors the current
`advance_v2_top_level_step_without_harness()` behavior) is defined in
`07_compatibility_and_execution_semantics.md`.

## Conditions

Conditions are pure checks. They do not modify files or variables.

### Boolean composition

```yaml
all:
  - <condition>
  - <condition>
any:
  - <condition>
  - <condition>
not:
  <condition>
```

### File conditions

```yaml
exists: path          # path exists (file or directory)
file_exists: path     # path exists and is a regular file
dir_exists: path      # path exists and is a directory
not_exists: path
file_count_at_least:
  glob: physicalplan/*.md
  count: 1
```

Paths are relative to the current machine directory unless they start with a
known variable such as `$quest` or use a collection/quest-relative condition.
The default workflow uses `dir_exists` where the current Python checks
`is_dir()` (the `physicalplan` directory) and `file_exists` where it checks
`is_file()` (`state.md`, marker files), so the checks are exactly as strict as
today.

### Issue conditions

```yaml
has_open_issues:
  file: physicalplan_issues.md
no_open_issues:
  file: "$active_child/polishing_issues.md"
```

`file` resolves like other paths: relative to the current machine directory
unless it starts with a variable such as `$quest` or `$active_child`. (In the
quest machine, machine-relative and quest-relative are the same thing; in the
slice machine, `file: polishing_issues.md` resolves inside the slice
directory.) An issue is `open` when its `status` field is `open`
(case-insensitive, trimmed), exactly as the current
`quest_has_open_physicalplan_issues()` / `slice_has_open_polishing_issues()`
helpers behave. The issue-file markdown format is unchanged.

### Variable conditions

```yaml
var_exists: next_slice
var_equals:
  name: active_slice
  value: 0001_foundation
```

### Collection conditions

```yaml
child_dirs_exist:
  collection: slices
all_children:
  collection: slices
  require:
    - file_exists: state.md
    - file_count_at_least:
        glob: physicalplan/*.md
        count: 1
```

For `all_children`, relative paths are evaluated inside each child directory.

Conditions that read a child machine's state (`state_is`, `state_not` in
`select_child.where`) compare against **logical** state names: the persisted
value is read from the child's `state.md` and mapped through the child
machine's `persisted_as` declarations first. `state_not: Completed` therefore
matches the current "persisted state is not `Done`" behavior.

### Child-result conditions

```yaml
child_result:
  state_after: Completed
```

Available only in the transitions of a state whose `child` block ran in the
current step; referencing it anywhere else is a workflow validation error.
`state_after` is the child's logical state after its step.

## Actions

Actions can modify workflow variables or workflow-owned files. They must be
generic; no action may encode current workflow role names or issue types.

### File actions

```yaml
- ensure_dir: notes
- ensure_file:
    path: polishing_issues.md
    content: "# Issues\n"
- remove_file: implementation_accepted.md
```

Relative paths are evaluated in the current machine directory unless a variable
or quest-relative marker is used.

### Variable actions

```yaml
- set_var:
    name: active_slice
    value: 0001_foundation
- clear_var: active_slice
```

`clear_var` removes a persisted workflow variable (and its tag in the machine's
`state.md`). The default workflow uses it on the
`PrepareNextSlice -> QuestDocumenting` transition to reproduce the current
runner's behavior of dropping the `active_slice` tag once the slice phase is
over.

### Child selection action

```yaml
- select_child:
    collection: slices
    where:
      state_not: Completed
    after: active_slice
    set: active_slice
    result: next_slice
```

Exact semantics (these intentionally reproduce the current
`prepare_next_slice_transition()` behavior, including its edge cases):

1. List the collection's children and sort them by the collection's `order`.
2. Compute the matching set: children whose logical state satisfies `where`.
3. If no child matches at all, leave the variable named by `set` unchanged and
   do not set the `result` variable.
4. Otherwise, if `after` is unset, or the variable it names is unset, or that
   variable's value is not a current child id, select the **first matching
   child overall**.
5. Otherwise select the **first matching child strictly after** the `after`
   child in collection order. Children before or equal to the `after` position
   are never selected, even if they match — there is no wrap-around and no
   fallback to earlier children. If no matching child follows, no child is
   selected: leave `set` unchanged and do not set `result`.
6. On selection, store the child id in the variable named by `set` (persisted)
   and in the variable named by `result` (step-scoped).

Initial `where` grammar:

```yaml
state_not: Completed
state_is: Implementing
```

`state_is` / `state_not` compare the child's logical state (after
`persisted_as` mapping).

## Workflow variables and persistence

Workflow variables are string-valued and live in the owning machine's
`state.md` `## Tags` section — the same place the current runner stores
`active_slice`. Concretely:

- Variables written by `set_var` and by `select_child`'s `set` field persist as
  tags of the machine whose state executed the action, and survive across
  steps, runner restarts, and process boundaries.
- Variables named by `select_child`'s `result` field are **step-scoped**: they
  exist only during the current node execution and transition evaluation and
  are never written to `state.md` or to snapshot tags.
- `clear_var` removes the tag.
- The runner additionally writes the quest identity tags (`quest_type`,
  `quest_number`, `quest_slug`) into the quest root machine's tags, exactly as
  the current normalized writer does. These are runner-provided and not
  workflow variables.

Snapshot `tags` for a machine are its persisted tags after the step, matching
current behavior.

## Profile YAML

```yaml
harness: cursor
model: composer-2.5
reasoning_effort: null
idle_timeout_seconds: 3600
prompt: ../prompts/implementer.md
runtime_context: {}
modify:
  allow: []
  block: []
thread:
  scope: child
  name_template: "{repo}_quest_{quest_number:04d}_slice_{child_number:04d}_{profile}"
  registry_key_template: "slice_{child_number}_{profile}"
```

### Fields

- `harness`: harness provider key. Harness provider configuration (CLI paths
  etc.) is **not** part of the workflow; see
  `07_compatibility_and_execution_semantics.md`.
- `model`: model name passed to the harness.
- `reasoning_effort`: optional model reasoning setting.
- `idle_timeout_seconds`: harness idle timeout.
- `prompt`: path to base prompt markdown relative to this profile file.
- `runtime_context`: generic toggles controlling which optional preamble
  variables (`$log_dir`, `$thread_registry`, `$active_child`) are exposed to
  this profile. See `08_agent_preamble.md`.
- `modify.allow`: allowed path globs after interpolation.
- `modify.block`: blocked path globs after interpolation.
- `thread.scope`: thread reuse scope; see top of this document.
- `thread.name_template`: deterministic thread name template.
- `thread.registry_key_template`: template for this profile's key in
  `thread_registry.json`. Defaults to `{profile}` for `scope: quest` and
  `{collection}_{child_id}_{profile}` for `scope: child`. The default workflow
  sets `slice_{child_number}_{profile}` for child-scoped profiles so registry
  keys match the current runner exactly (`slice_1_implementer`, ...), which
  preserves existing threads when a quest is upgraded.

## Interpolation

Supported variables initially:

- `$quest`: quest root path.
- `$project`: current project path.
- `$machine`: current machine directory.
- `$active_child`: active child directory for the current child collection.
- `{active_slice}` (or any workflow variable name): workflow variable
  interpolation in strings.
- `{now}`: current timestamp for action content.
- metadata placeholders in thread templates, such as `{repo}`,
  `{quest_number}`, `{profile}`, `{collection}`, `{child_id}`, and
  `{child_number}` (the parsed integer index of the active child's directory
  name).

## Workflow validation

Loading a workflow must validate, with hard errors (not silent fallbacks):

- `entry_machine` names a declared machine; every machine file's `machine` name
  matches its key.
- Every transition `to` target is a declared state of the same machine.
- Every `run.profile` names a declared profile; every `child.collection` and
  collection condition names a declared collection; every collection's
  `machine` names a declared machine.
- `child_result` conditions appear only in states with a `child` block.
- `persisted_as` values are unique per machine and do not collide with logical
  state ids.
- Prompt files referenced by profiles exist.

## Snapshot requirements

Workflow execution must continue to produce recursive snapshots with the
current shape:

```json
{
  "machine_name": "quest",
  "machine_path": "projects/example/quests/main/0000_demo",
  "node_name": "ExecuteActiveSliceNode",
  "state_before": "ExecuteSlice",
  "state_after": "ExecuteSlice",
  "tags": {"active_slice": "0001_foundation"},
  "child": {
    "machine_name": "slice_0001_foundation",
    "machine_path": "projects/example/quests/main/0000_demo/slices/0001_foundation",
    "node_name": "SlicePolishingReviewNode",
    "state_before": "PolishingReview",
    "state_after": "Completed",
    "tags": {},
    "child": null
  }
}
```

`node_name` is the state's `node_name` override when declared, otherwise the
state id. For the default workflow the overrides reproduce the current Python
class names, so snapshots and commit messages are byte-format-identical with
existing history. Extra fields are allowed, but dashboards and experiments
should still be able to reason over machine name/path, node name, before/after
state, tags, and child snapshot.
