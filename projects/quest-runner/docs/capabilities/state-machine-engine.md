# Capability: State Machine Engine

ID prefix: `sm`

## Purpose

The state machine engine is the interpreter for the workflow YAML language. A
workflow package (see [workflow-config](workflow-config.md)) supplies machine
definitions, collections, and profiles; the engine executes them one *step* at
a time against a quest directory: it runs state actions, invokes harness
profiles, recurses into child machines, evaluates transitions, persists state
to `state.md` files, and records each effective top-level step as a single git
commit. This file is the language specification: it defines every construct a
workflow author can use and exactly how the interpreter executes it.

"Externally observable" in this file means observable to a workflow author:
the YAML grammar, the execution order, filesystem effects, persistence, and
error behavior of each construct.

## Requirements

### Machine definition

- **[sm-1]** THE engine SHALL load each machine from a YAML mapping with
  fields `machine` (string, must equal the machine's key in the workflow
  `machines` map), `initial` (string, a declared state name), `terminal`
  (list of declared state names, default `[]`), and `states` (mapping of
  state name to state definition).
- **[sm-2]** IF a machine file is missing, is not a mapping, has a `machine`
  value that does not match its key, names an undeclared `initial` or
  `terminal` state, or contains a mistyped field, THEN THE loader SHALL
  reject the workflow with a `WorkflowValidationError` naming the file and
  field path.
- **[sm-3]** THE engine SHALL accept these state fields, all optional except
  the state name itself: `node_name` (string), `persisted_as` (string),
  `actions` (list, default `[]`), `run` (mapping), `child` (mapping),
  `transitions` (list, default `[]`), `terminal` (boolean, default `false`).
- **[sm-4]** IF two states in one machine declare the same `persisted_as`
  value, or a `persisted_as` value equals a *different* state's logical name,
  THEN THE loader SHALL reject the workflow.
- **[sm-5]** IF `run.profile` does not name a profile declared in
  `workflow.yaml`, THEN THE loader SHALL reject the workflow; at runtime, IF
  `run.profile` or `run.task` is present but not a string, THEN THE engine
  SHALL fail the step with a fatal invariant error.
- **[sm-6]** IF `child.collection` does not name a declared collection, or
  `child.run` is present with any value other than `one_step`, THEN THE
  loader SHALL reject the workflow.
- **[sm-7]** IF a transition condition uses `child_result` on a state that
  has no `child` block, THEN THE loader SHALL reject the workflow.
- **[sm-8]** IF any workflow-owned path string (action paths, condition
  paths, `file_count_at_least.glob`, issue file paths) is absolute, THEN THE
  loader SHALL reject the workflow; absolute paths produced by interpolation
  are rejected at runtime with a fatal invariant error.

### Step execution order

- **[sm-9]** WHEN executing one step of a machine, THE engine SHALL perform,
  in order: (1) the current state's `actions`; (2) the `run` profile, in
  automated mode only; (3) one child-machine step, when the state has a
  `child` block; (4) transition evaluation in document order, first match
  wins; (5) the matched transition's `actions`, for `to` transitions only;
  (6) state persistence when the state or variables changed.
- **[sm-10]** WHILE a machine remains in a state across multiple steps, THE
  engine SHALL re-execute that state's `actions` (and `run` profile, in
  automated mode) at the start of every step.
- **[sm-11]** IF the machine's current logical state is not declared in its
  machine definition, THEN THE engine SHALL fail the step with a fatal
  invariant error.

### Run blocks

- **[sm-12]** WHEN executing an automated step for a state with a `run`
  block, THE engine SHALL invoke the named profile through the agent harness
  with the state's `run.task` text (default `""`); see
  [agent-harness](agent-harness.md) for message assembly and thread
  identity.
- **[sm-13]** WHILE executing in manual mode (operator `advance`), THE
  engine SHALL NOT invoke any `run` profile.
- **[sm-14]** WHEN the machine executing a `run` block is a child machine,
  THE harness invocation SHALL receive the child directory as the active
  child path; WHEN it is the top-level machine and an active child exists,
  the active child's directory is used.

### Transitions

- **[sm-15]** THE engine SHALL evaluate `transitions` in document order and
  apply the first eligible entry whose `if` condition (when present) is
  true; entries without an `if` always match.
- **[sm-16]** WHEN a transition carries `mode: manual_only`, THE engine
  SHALL skip it during automated execution and consider it only during
  manual advance. (Any `mode` value other than `manual_only` has no effect.)
- **[sm-17]** WHEN a `stop` transition matches during automated execution,
  THE engine SHALL end the run with `stop.status` as the run status, leave
  the state unchanged, and persist nothing for that step.
- **[sm-18]** WHILE in manual mode, THE engine SHALL skip `stop` transitions
  entirely (this is how `manual_only` gates such as `PrePlanning` are passed
  by a human).
- **[sm-19]** WHEN a `stay` transition matches during automated execution,
  THE machine SHALL remain in its current state and the run loop SHALL
  continue with the next step; WHEN a `stay` transition matches during
  manual advance, THE engine SHALL reject the advance with
  `stay.reason` as the validation reason.
- **[sm-20]** WHEN a `to` transition matches, THE engine SHALL execute its
  `actions` list (default `[]`) and then move the machine to the target
  state; IF the target is not a declared state of the same machine, THEN THE
  loader SHALL reject the workflow.
- **[sm-21]** IF no transition matches during an automated step, THEN THE
  machine SHALL remain in its current state and the step completes (as a
  no-op unless actions changed variables or files); IF no transition matches
  during manual advance, THEN THE engine SHALL reject the advance with
  reason `no_eligible_transition`.
- **[sm-22]** THE engine SHALL skip a transition entry that contains none of
  `stop`, `stay`, or `to`; IF a transition entry is not a mapping, or
  `stop.status` / `stay.reason` / `to` is not a string, THEN THE engine
  SHALL fail with a fatal invariant error.
- **[sm-23]** IF a child machine step matches a `stop` transition, THEN THE
  engine SHALL fail with a fatal invariant error (`stop` is valid only on
  the top-level machine).

### Conditions

- **[sm-24]** THE engine SHALL require every condition to be a mapping whose
  single recognized key selects the condition type; IF the condition is not
  a mapping or its type is not one of the types below, THEN THE engine SHALL
  fail with a fatal invariant error naming the condition.
- **[sm-25]** THE engine SHALL support boolean combinators `all` (list, true
  when every item is true; true for an empty list), `any` (list, true when
  at least one item is true; false for an empty list), and `not` (single
  condition, negation), nesting to any depth.
- **[sm-26]** THE engine SHALL support path conditions `exists` (path
  exists), `file_exists` (path is a regular file), `dir_exists` (path is a
  directory), and `not_exists` (path does not exist), each taking one path
  string resolved per sm-44.
- **[sm-27]** THE engine SHALL support `file_count_at_least` with `glob`
  (string) and `count` (integer; booleans rejected): true when at least
  `count` entries match the glob evaluated relative to the executing
  machine's directory. The glob is NOT interpolated and does not accept
  `$`-path variables.
- **[sm-28]** THE engine SHALL support `has_open_issues` and
  `no_open_issues`, each with `file` (path string resolved per sm-44): an
  issue file has open issues when any parsed issue entry's `status` field,
  trimmed and lowercased, equals `open`; a missing or entry-less file has no
  open issues. Issue file format: [issues](issues.md).
- **[sm-29]** THE engine SHALL support `var_exists` (string variable name;
  true when the variable is defined as a step variable or persisted
  variable) and `var_equals` with `name` and `value` strings (true when the
  variable's current value equals `value` exactly; an undefined variable
  never equals anything).
- **[sm-30]** THE engine SHALL support `child_dirs_exist` with `collection`
  (declared collection name): true when the collection has at least one
  child directory.
- **[sm-31]** THE engine SHALL support `all_children` with `collection` and
  `require` (list of conditions): false when the collection has no children;
  otherwise true when every child satisfies every `require` item, with path
  conditions and `file_count_at_least` evaluated relative to each child's
  directory (and `$machine` resolving to the child directory).
- **[sm-32]** THE engine SHALL support `child_result` with `state_after`
  (string): true when the child machine step executed by the *same* state in
  the *same* step ended in that logical state; IF evaluated when no child
  step ran, THEN THE engine SHALL fail with a fatal invariant error.

### Actions

- **[sm-33]** THE engine SHALL require every action to be a mapping whose
  single recognized key selects the action type; IF an action is a bare
  string, not a mapping, or an unknown type, THEN THE engine SHALL fail the
  step with a fatal invariant error.
- **[sm-34]** THE engine SHALL support `ensure_dir: <path>`: create the
  directory and any missing parents; succeed silently when it already
  exists.
- **[sm-35]** THE engine SHALL support `ensure_file` with `path` (string)
  and `content` (string, default `""`): when the file does not exist, create
  parent directories and write the *interpolated* content (UTF-8); WHEN the
  file already exists, THE engine SHALL leave it untouched (never
  overwrite).
- **[sm-36]** THE engine SHALL support `remove_file: <path>`: delete the
  file when it exists; succeed silently when it does not.
- **[sm-37]** THE engine SHALL support `set_var` with `name` and `value`
  strings: set the persisted variable `name` to the interpolated `value`.
- **[sm-38]** THE engine SHALL support `clear_var: <name>`: remove the
  persisted variable; succeed silently when it is not set.
- **[sm-39]** THE engine SHALL support `select_child` with `collection`
  (declared collection name), `where` (mapping), optional `after` (variable
  name), `set` (persisted variable name), and `result` (step variable
  name). Execution: enumerate the collection's children in collection order;
  keep children whose current *logical* state matches `where`; when `after`
  names a variable whose value is one of the collection's child ids, select
  the first matching child strictly after that id in collection order
  (falling back to the first match when the id is unknown); otherwise select
  the first match. On selection, set the persisted variable `set` and the
  step variable `result` to the selected child id.
- **[sm-40]** WHEN `select_child` finds no matching child (or no match after
  the `after` id), THE engine SHALL leave both `set` and `result` variables
  unchanged (in the default workflow, a subsequent `var_exists` on the
  `result` variable detects this).
- **[sm-41]** THE `select_child.where` mapping SHALL contain exactly one of
  `state_is: <logical state>` or `state_not: <logical state>` (when both are
  present `state_is` wins); IF neither is present, THEN THE engine SHALL
  fail with a fatal invariant error.

### Variables and interpolation

- **[sm-42]** THE engine SHALL maintain two variable scopes: *persisted
  variables*, stored as tags in the machine's `state.md` and surviving
  across steps, and *step variables* (written only by
  `select_child.result`), which exist only for the remainder of the current
  step. Variable lookup checks step variables first, then persisted
  variables.
- **[sm-43]** THE engine SHALL interpolate `{name}` placeholders
  (`name` matching `[a-zA-Z_][a-zA-Z0-9_]*`) in `ensure_file.content`,
  `set_var.value`, and every path string before resolution; `{now}`
  interpolates to the current UTC time in ISO-8601 format; any other name
  resolves via variable lookup; IF the name is not defined, THEN THE engine
  SHALL fail the step with a fatal invariant error
  (`Unknown workflow variable '<name>' in interpolation`).
- **[sm-44]** THE engine SHALL resolve path strings as follows: interpolate
  per sm-43; reject absolute results; when the path is exactly
  `$quest`, `$project`, `$machine`, or `$active_child`, or begins with one
  of those followed by `/`, resolve against the quest directory, the current
  project directory (`<repo>/projects/<meta.project>`), the executing
  machine's directory, or the active child directory respectively; any
  other `$name` is a fatal invariant error; paths with no `$` prefix resolve
  relative to the *executing machine's directory* (the quest root for the
  entry machine, the child directory for a child machine).
- **[sm-45]** THE engine SHALL resolve `$active_child` by scanning
  collections in declaration order for one whose `active_var` persisted
  variable names an existing child directory; IF none qualifies, THEN THE
  engine SHALL fail with a fatal invariant error.
- **[sm-46]** THE `variables` mapping in `workflow.yaml` is validated
  (string keys and values) but is NOT consumed by the engine: it does not
  feed `{name}` interpolation or `$`-path resolution. (Profile path/prompt
  rendering is specified in [agent-harness](agent-harness.md).)
- **[sm-47]** WHEN writing the top-level machine's state, THE engine SHALL
  always write the identity tags `quest_type`, `quest_number`, and
  `quest_slug` from quest metadata, overriding any workflow-set variables of
  the same names.

### Collections and child machines

- **[sm-48]** THE engine SHALL enumerate a collection's children as the
  directories under the quest directory matching the collection's `path`
  pattern (segment-wise match where `*` matches any single segment), with
  child id equal to the directory name (`id_from: directory_name`) and
  ordering per `order: lexical` (ascending directory-name sort). These are
  the only supported `id_from` and `order` values; others are rejected at
  load.
- **[sm-49]** WHEN executing a state with a `child` block, THE engine SHALL
  read the child id from the persisted variable named by `child.active`,
  load the collection's machine for that child's directory, and execute
  exactly one workflow step of it (`run: one_step`) in the same execution
  mode, before evaluating the parent state's transitions.
- **[sm-50]** IF the `child.active` variable is unset or empty, or the named
  child directory does not exist, THEN THE engine SHALL fail the step with a
  fatal invariant error.
- **[sm-51]** THE engine SHALL persist each child machine's state in that
  child's own `state.md` (persisted-state form, no `global_step`); child
  machines do not maintain their own step counters or git commits — the
  enclosing top-level step commits all changes. Collection `scaffold`
  actions are executed by quest/slice creation, not by the step engine; see
  [workflow-config](workflow-config.md) and [slices](slices.md).

### State persistence and `persisted_as`

- **[sm-52]** WHEN persisting state, THE engine SHALL write the state's
  `persisted_as` value when declared, and the logical state name otherwise;
  WHEN reading, THE engine SHALL map the persisted value back to the logical
  name; IF a persisted value matches neither a `persisted_as` declaration
  nor a logical state name of the machine, THEN THE engine SHALL fail with a
  fatal invariant error.
- **[sm-53]** THE engine SHALL pass the reserved top-level persisted state
  `ExperimentComplete` through unmapped in both directions and treat it as
  complete; see [experiments](experiments.md).
- **[sm-54]** THE engine SHALL persist the top-level machine to
  `<quest>/state.md` in the normalized `# State` / `## Tags` format
  (persisted variables are the tags) and child machines to
  `<child>/state.md` in the persisted-state form; exact file grammars:
  [Runtime files](../contracts/runtime-files.md).
- **[sm-55]** THE `special.completed_state` field of `workflow.yaml` is
  parsed (default `Completed`) but completion is determined solely by
  `terminal` declarations (sm-57); the field currently has no runtime
  effect.

### Top-level step loop, global step, and commits

- **[sm-56]** WHILE running a quest automatically, THE engine SHALL loop up
  to `max_steps` (default 500) top-level steps; before each step it SHALL
  end the run with status `human_intervention` when the human-intervention
  file exists, and with status `completed` when the top-level machine is
  complete; a matched `stop` transition ends the run with its status;
  exhausting the loop ends with status `max_steps`.
- **[sm-57]** THE engine SHALL consider the top-level machine complete when
  its logical state is in the machine's `terminal` list, the state declares
  `terminal: true`, or the persisted state is `ExperimentComplete`.
- **[sm-58]** WHEN executing a top-level step, THE engine SHALL defer all
  `state.md` writes (top-level and child) until commit time, then apply them
  and create exactly one git commit containing every file changed during the
  step, with the step-commit message format (headers `quest-step`,
  `state-machine-path`, `node`, `state-before`, `state-after` plus a JSON
  recursive snapshot) specified in
  [Runtime files](../contracts/runtime-files.md#step-commit-metadata).
- **[sm-59]** THE engine SHALL increment `global_step` by exactly 1 per
  committed top-level step, reading the previous value from the top-level
  `state.md`; IF `state.md` carries no `global_step`, THEN THE engine SHALL
  recover it from the most recent valid step commit for this quest in
  `git log`, falling back to the number of entries in
  `state_history.md`.
- **[sm-60]** WHEN a top-level step changes neither machine state (including
  variables) nor any repository file, THE engine SHALL treat it as a no-op:
  no commit, no `global_step` increment, and the run loop continues.
- **[sm-61]** IF the rendered step-commit metadata fails round-trip
  validation, THEN THE engine SHALL write
  `logs/commit_metadata_validation_<timestamp>.md`, write the
  human-intervention file, and end the run without committing.
- **[sm-62]** IF git staging finds no changes or staging/commit fails, THEN
  THE engine SHALL restore all deferred `state.md` files to their pre-step
  contents, unstage everything, write the human-intervention file, and end
  the run.
- **[sm-63]** THE snapshot recorded for each step SHALL use the state's
  `node_name` when declared and the logical state name otherwise, and SHALL
  nest the child machine's snapshot when a child step ran.
- **[sm-64]** THE engine SHALL NOT append to `state_history.md`; the file is
  created by workflow scaffold actions and read only as the last-resort
  `global_step` fallback (sm-59).

### Human intervention

- **[sm-65]** WHILE the file named by `special.human_intervention_file`
  (default `human_intervention_request.md`) exists at the quest root, THE
  engine SHALL NOT execute automated steps and SHALL reject manual advance.
- **[sm-66]** WHEN a harness profile run within a step leaves the
  human-intervention file present, THE engine SHALL stop before evaluating
  transitions, so the workflow state does not advance past the request.

### Manual advance

- **[sm-67]** WHEN an operator advances a quest, THE engine SHALL execute
  one top-level step in manual mode — actions and child recursion run,
  `run` profiles do not — and commit it through the same metadata machinery
  as an automated step; WHEN the quest is already complete, THE engine SHALL
  report completion without executing a step.

## Contracts

This section is the workflow YAML grammar as consumed by the engine. The
surrounding package format (`workflow.yaml` top level, profiles, prompts,
issues, scaffold timing) is owned by [workflow-config](workflow-config.md);
the fields below are reproduced only where the engine itself interprets them.
Canonical examples: `src/quest_runner_service/default_workflow/machines/quest.yaml`
and `slice.yaml`.

### Machine file

```yaml
machine: slice            # must equal the key in workflow.yaml `machines`
initial: SliceSetup       # declared state name
terminal: [Completed]     # list of declared state names (default [])
states:
  <StateName>: <state>    # mapping of logical state name -> state definition
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `machine` | string | yes | Machine name; must match its `machines` key. |
| `initial` | string | yes | Starting logical state (used at quest/child creation). |
| `terminal` | list of strings | no (`[]`) | States that complete the machine. |
| `states` | mapping | yes | Logical state name → state definition. |

### State definition

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `node_name` | string | state name | Name recorded in step snapshots/commit headers (pins durable metadata for dashboards and experiment stop conditions). |
| `persisted_as` | string | none | On-disk state value written to/read from `state.md` instead of the logical name. Unique per machine; must not equal another state's logical name. |
| `actions` | list of actions | `[]` | Executed at the start of every step spent in this state. |
| `run` | mapping | none | Harness profile invocation (automated steps only). |
| `child` | mapping | none | Delegate one step to a child machine. |
| `transitions` | list | `[]` | Ordered transition entries; first match wins. |
| `terminal` | bool | `false` | Marks the state as completing the machine. |

`run` block:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `run.profile` | string | yes | Declared profile key (validated at load). |
| `run.task` | string | no (`""`) | Task text appended to the harness message. |

`child` block:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `child.collection` | string | yes | Declared collection name. |
| `child.active` | string | yes | Persisted-variable name holding the active child id. |
| `child.run` | string | no | Only `one_step` is valid. |

### Transition entries

```yaml
transitions:
  - to: ReviewPhysicalPlan        # unconditional move
  - if: <condition>               # conditional move with actions
    to: PhysicalPlanning
    actions:
      - remove_file: physicalplan_accepted.md
  - to: PhysicalPlanning          # eligible only via manual advance
    mode: manual_only
  - stay:                         # remain; blocks manual advance
      reason: incomplete_physical_plan
  - stop:                         # end automated run, no state change
      status: pre_planning
```

| Key | Type | Meaning |
| --- | --- | --- |
| `to` | string | Target logical state (must be declared in the same machine). |
| `if` | condition | Optional guard for `to`, `stay`, and `stop`. Absent = always true. |
| `actions` | list | Optional; `to` transitions only; executed on match, before persisting. |
| `stay` | `{reason: <string>}` | Remain in state. Manual advance fails with `reason`. |
| `stop` | `{status: <string>}` | Automated run ends with `status`; skipped in manual mode; top-level machine only. |
| `mode` | `manual_only` | Skip during automated execution. |

Precedence within one entry: `mode` gate, then `stop`, then `stay`, then `to`.
An entry with none of `stop`/`stay`/`to` is skipped.

### Conditions

```yaml
# Boolean combinators (nest freely)
all: [<condition>, ...]      # true when all are true (empty list: true)
any: [<condition>, ...]      # true when any is true (empty list: false)
not: <condition>

# Path checks — path resolved per the path-resolution rules below
exists: <path>               # path exists (file or dir)
file_exists: <path>          # regular file
dir_exists: <path>           # directory
not_exists: <path>           # nothing at path

# Glob count — glob evaluated relative to the executing machine's directory,
# NOT interpolated, no $-variables
file_count_at_least:
  glob: physicalplan/*.md
  count: 1                   # integer (booleans rejected)

# Issue files — open = any issue entry whose status, trimmed and lowercased,
# is "open"; a missing file has no open issues
has_open_issues:
  file: physicalplan_issues.md
no_open_issues:
  file: "$active_child/polishing_issues.md"

# Variables — step variables shadow persisted variables
var_exists: next_slice
var_equals:
  name: active_slice
  value: 0001_foundation

# Collections
child_dirs_exist:
  collection: slices         # at least one child directory exists
all_children:                # false when collection is empty
  collection: slices
  require:                   # every child must satisfy every item;
    - dir_exists: physicalplan      # paths/globs relative to each child dir
    - file_count_at_least:
        glob: physicalplan/*.md
        count: 1

# Child step result — only on a state with a `child` block, compares the
# child's LOGICAL state after the child step run in this same step
child_result:
  state_after: Completed
```

Conditions are pure: they never modify files or variables. Any condition
mapping whose key is not listed above is a fatal invariant error.

### Actions

```yaml
- ensure_dir: notes                      # mkdir -p; idempotent
- ensure_file:                           # create only if absent; never overwrites
    path: state.md
    content: "# Slice State\n\nstate: NotStarted\nupdated_at: {now}\n"
- remove_file: implementation_accepted.md  # delete if present; silent if absent
- set_var:                               # persisted variable; value interpolated
    name: active_slice
    value: "0001_foundation"
- clear_var: active_slice                # silent if unset
- select_child:
    collection: slices                   # declared collection
    where:                               # exactly one of:
      state_not: Completed               #   state_is | state_not (logical states)
    after: active_slice                  # optional variable NAME; start strictly
                                         # after that child id in collection order
    set: active_slice                    # persisted variable receiving child id
    result: next_slice                   # step variable receiving child id
```

Bare string actions and unknown action keys are fatal invariant errors.
`ensure_file.content` is interpolated only when the file is created.

### Variables, interpolation, and paths

Interpolation grammar (applied to `ensure_file.content`, `set_var.value`, and
all path strings):

| Placeholder | Resolves to |
| --- | --- |
| `{now}` | Current UTC time, ISO-8601. |
| `{<name>}` | Step variable if set, else persisted variable; otherwise fatal error. |

Path expression grammar (after interpolation; absolute paths rejected):

| Form | Base |
| --- | --- |
| `$quest` or `$quest/<rel>` | Quest directory. |
| `$project` or `$project/<rel>` | `<repo>/projects/<meta.project>`. |
| `$machine` or `$machine/<rel>` | Executing machine's directory (child dir inside `all_children` / child machines). |
| `$active_child` or `$active_child/<rel>` | First collection (declaration order) whose `active_var` variable names an existing child dir; fatal error if none. |
| `<rel>` (no `$`) | Executing machine's directory. |
| `$<anything else>` | Fatal invariant error. |

The `workflow.yaml` `variables:` mapping is not readable through `{name}` or
`$name` in the engine (sm-46).

### Collections (engine-consumed fields)

```yaml
collections:
  slices:
    path: slices/*           # quest-relative segment pattern; * = one segment (child id)
    machine: slice           # declared machine executed for each child
    order: lexical           # only supported order
    id_from: directory_name  # only supported source
    active_var: active_slice # persisted variable naming the active child
    scaffold: [...]          # actions run at child creation (see workflow-config)
```

### Special fields (engine-consumed)

| Field | Default | Engine behavior |
| --- | --- | --- |
| `special.human_intervention_file` | `human_intervention_request.md` | Quest-relative file; presence blocks automated steps and manual advance (sm-65, sm-66). |
| `special.completed_state` | `Completed` | Parsed but unused; completion comes from `terminal` (sm-55, sm-57). |

### Persistence and commits

Persisted-state files (`state.md` normalized top-level form with `## Tags`
holding persisted variables and identity tags; child persisted-state form;
`state_history.md`) and the step-commit message format (`quest-step`,
`state-machine-path`, `node`, `state-before`, `state-after` headers + JSON
recursive snapshot) are specified in
[Runtime files](../contracts/runtime-files.md).

## Design

The interpreter is data-driven: Python never hard-codes the default role
graph, issue file names, or slice rules — it executes whatever the loaded
`WorkflowDefinition` declares.

- `src/quest_runner_service/workflow_config.py` — `load_workflow`,
  `_parse_machine`, `_parse_state`, `_validate_cross_references`. All
  load-time grammar and cross-reference validation (sm-1..sm-8) lives here
  and raises `WorkflowValidationError` with file + field path.
- `src/quest_runner_service/state_machine/workflow_interpreter.py` —
  `WorkflowStateMachine.RunWorkflowStep` implements the per-step order
  (sm-9), `_match_transition` the first-match rules (sm-15..sm-22), and
  `_run_child_step` child recursion (sm-49, sm-50). `ExecutionMode`
  distinguishes automated vs. manual; `persist_state=False` returns
  `PendingStateWrite`s instead of writing `state.md`.
- `src/quest_runner_service/state_machine/workflow_conditions.py` —
  `evaluate_condition` enumerates every condition type;
  `_child_path_context` rebases `all_children` requirements onto each child
  directory.
- `src/quest_runner_service/state_machine/workflow_actions.py` —
  `execute_action` enumerates every action type; `_execute_select_child`
  implements the `where`/`after` scan.
- `src/quest_runner_service/state_machine/workflow_paths.py` —
  `WorkflowPathContext` (persisted tags + step vars), `interpolate_string`
  (`{name}`/`{now}`), `resolve_path` (`$`-variables, machine-dir-relative
  default, absolute-path rejection), `list_collection_children` (pattern
  match + lexical sort).
- `src/quest_runner_service/state_machine/workflow_state_io.py` —
  `WorkflowStateIo` maps logical ↔ persisted state (`persisted_as`,
  reserved `ExperimentComplete`), writes identity tags on the top-level
  machine, and routes top-level vs. child `state.md` formats via
  `quest_fs`. `build_workflow_step_snapshot` applies the `node_name`
  default.
- `src/quest_runner_service/state_machine/v2_step_executor.py` —
  `execute_v2_top_level_step` and `commit_v2_snapshot_step`: deferred state
  writes, no-op detection, `global_step` resolution and increment,
  metadata round-trip validation, state-file restore on git failure, and
  `advance_v2_top_level_step_without_harness` for manual advance.
- `src/quest_runner_service/quest_runner_v2.py` — `run_quest_v2`: the
  `max_steps` loop, human-intervention and completion checks, run statuses
  (`human_intervention`, `completed`, `<stop status>`, `max_steps`,
  `dirty_workspace`).
- `src/quest_runner_service/state_machine/workflow_harness_callback.py` —
  bridges `run` blocks to the harness and raises
  `HumanInterventionRequested` when a profile run leaves the intervention
  file behind (sm-66).
- `src/quest_runner_service/state_machine/adapters.py` —
  `SubprocessGitOps.ReadGlobalStep` (git-log recovery, history-length
  fallback), `WorkflowProfileResolver` (quest-root discovery via
  `meta.json` + `workflow/workflow.yaml`).
- `src/quest_runner_service/state_machine/commit_metadata.py` —
  `render_step_commit_message` / `parse_step_commit_message` round-trip.

Non-obvious choices:

- **Deferred persistence** (sm-58): a top-level step is atomic at the git
  level. State files are written only once commit metadata validates, so a
  failed step leaves `state.md` untouched and the repo clean.
- **`persisted_as`** exists to keep legacy on-disk formats stable (slice
  `NotStarted`/`Done`) while the YAML uses meaningful logical names.
- **`node_name`** pins snapshot metadata so dashboards, commit-history
  readers, and experiment stop conditions keep consuming legacy node names
  (e.g. `ExecuteActiveSliceNode`) regardless of logical state renames.
- Runtime grammar violations raise `FatalInvariantError` (fail-stop) rather
  than degrading, because a malformed workflow mid-run indicates a corrupted
  quest or package.

## Interactions

- [workflow-config](workflow-config.md) — owns the workflow package format
  (`workflow.yaml`, profiles, prompts, scaffold execution at quest/child
  creation) that this engine loads and executes.
- [agent-harness](agent-harness.md) — executes `run.profile` invocations:
  message assembly, thread scopes, modify allow/block enforcement.
- [quest-lifecycle](quest-lifecycle.md) — creates quests (initial state,
  scaffold) and triggers automated runs and manual advance through the
  service API/CLI.
- [issues](issues.md) — issue file format read by `has_open_issues` /
  `no_open_issues` and the workflow `issues` declarations.
- [slices](slices.md) — the default `slices` collection: child creation via
  `slices init` using collection scaffold.
- [experiments](experiments.md) — replaces the quest-local `workflow/`,
  evaluates stop conditions against step snapshots, and uses the reserved
  `ExperimentComplete` state.
- [dashboard](dashboard.md) — renders `state.md` and step-commit metadata
  written by this engine.
- [chat-stream](chat-stream.md) — streams harness events emitted during
  `run` profile execution.
- [service-lifecycle](service-lifecycle.md) — hosts the runner process that
  drives the step loop.
- [Runtime files](../contracts/runtime-files.md) — shared contract for
  `state.md`, `state_history.md`, and step-commit metadata formats.
