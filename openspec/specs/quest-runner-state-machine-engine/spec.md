# Capability: State Machine Engine

Project: `projects/quest-runner`
ID prefix: `sm` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The state machine engine is the interpreter for the workflow YAML language. A
workflow package (see [workflow-config](../quest-runner-workflow-config/spec.md)) supplies machine
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

### Requirement: sm-1 — Machine definition: machine file fields
THE engine SHALL load each machine from a YAML mapping with fields `machine` (string, must equal the machine's key in the workflow `machines` map), `initial` (string, a declared state name), `terminal` (list of declared state names, default `[]`), and `states` (mapping of state name to state definition).

#### Scenario: Valid machine file loaded
- **WHEN** a machine file with correct `machine`, `initial`, `terminal`, and `states` fields is loaded
- **THEN** the engine loads the machine successfully

### Requirement: sm-2 — Machine definition: validation error on bad machine file
IF a machine file is missing, is not a mapping, has a `machine` value that does not match its key, names an undeclared `initial` or `terminal` state, or contains a mistyped field, THEN THE loader SHALL reject the workflow with a `WorkflowValidationError` naming the file and field path.

#### Scenario: Machine file missing or malformed
- **WHEN** a machine file is missing, is not a mapping, has a mismatched `machine` value, names an undeclared `initial` or `terminal` state, or contains a mistyped field
- **THEN** the loader rejects the workflow with a `WorkflowValidationError` naming the file and field path

### Requirement: sm-3 — Machine definition: accepted state fields
THE engine SHALL accept these state fields, all optional except the state name itself: `node_name` (string), `persisted_as` (string), `actions` (list, default `[]`), `run` (mapping), `child` (mapping), `transitions` (list, default `[]`), `terminal` (boolean, default `false`).

#### Scenario: State with optional fields
- **WHEN** a state definition includes any subset of the optional fields
- **THEN** the engine accepts the state with those fields applied and defaults for the rest

### Requirement: sm-4 — Machine definition: duplicate persisted_as rejection
IF two states in one machine declare the same `persisted_as` value, or a `persisted_as` value equals a *different* state's logical name, THEN THE loader SHALL reject the workflow.

#### Scenario: Duplicate persisted_as
- **WHEN** two states in one machine share a `persisted_as` value, or a `persisted_as` equals another state's logical name
- **THEN** the loader rejects the workflow

### Requirement: sm-5 — Machine definition: run profile and task validation
IF `run.profile` does not name a profile declared in `workflow.yaml`, THEN THE loader SHALL reject the workflow; at runtime, IF `run.profile` or `run.task` is present but not a string, THEN THE engine SHALL fail the step with a fatal invariant error.

#### Scenario: Undeclared run profile at load
- **WHEN** `run.profile` names a profile not declared in `workflow.yaml`
- **THEN** the loader rejects the workflow

#### Scenario: Non-string run field at runtime
- **WHEN** `run.profile` or `run.task` is present but not a string at runtime
- **THEN** the engine fails the step with a fatal invariant error

### Requirement: sm-6 — Machine definition: child block validation
IF `child.collection` does not name a declared collection, or `child.run` is present with any value other than `one_step`, THEN THE loader SHALL reject the workflow.

#### Scenario: Invalid child collection or run value
- **WHEN** `child.collection` names an undeclared collection, or `child.run` is anything other than `one_step`
- **THEN** the loader rejects the workflow

### Requirement: sm-7 — Machine definition: child_result on non-child state
IF a transition condition uses `child_result` on a state that has no `child` block, THEN THE loader SHALL reject the workflow.

#### Scenario: child_result on childless state
- **WHEN** a transition condition uses `child_result` on a state with no `child` block
- **THEN** the loader rejects the workflow

### Requirement: sm-8 — Machine definition: absolute path rejection
IF any workflow-owned path string (action paths, condition paths, `file_count_at_least.glob`, issue file paths) is absolute, THEN THE loader SHALL reject the workflow; absolute paths produced by interpolation are rejected at runtime with a fatal invariant error.

#### Scenario: Absolute path at load
- **WHEN** a workflow-owned path string is absolute at load time
- **THEN** the loader rejects the workflow

#### Scenario: Absolute path produced by interpolation at runtime
- **WHEN** interpolation produces an absolute path at runtime
- **THEN** the engine fails with a fatal invariant error

### Requirement: sm-9 — Step execution order: per-step order
WHEN executing one step of a machine, THE engine SHALL perform, in order: (1) the current state's `actions`; (2) the `run` profile, in automated mode only; (3) one child-machine step, when the state has a `child` block; (4) transition evaluation in document order, first match wins; (5) the matched transition's `actions`, for `to` transitions only; (6) state persistence when the state or variables changed.

#### Scenario: Automated step
- **WHEN** one automated step is executed for a machine
- **THEN** the engine performs state actions, then run profile, then child step, then transition evaluation, then transition actions (for `to`), then state persistence, in that order

### Requirement: sm-10 — Step execution order: re-execution across steps
WHILE a machine remains in a state across multiple steps, THE engine SHALL re-execute that state's `actions` (and `run` profile, in automated mode) at the start of every step.

#### Scenario: Machine stays in state across steps
- **WHEN** a machine remains in the same state across multiple automated steps
- **THEN** the state's `actions` and `run` profile are re-executed at the start of each step

### Requirement: sm-11 — Step execution order: undeclared current state
IF the machine's current logical state is not declared in its machine definition, THEN THE engine SHALL fail the step with a fatal invariant error.

#### Scenario: Undeclared current state
- **WHEN** the machine's current logical state is not declared in its definition
- **THEN** the engine fails the step with a fatal invariant error

### Requirement: sm-12 — Run blocks: automated invocation
WHEN executing an automated step for a state with a `run` block, THE engine SHALL invoke the named profile through the agent harness with the state's `run.task` text (default `""`); see [agent-harness](../quest-runner-agent-harness/spec.md) for message assembly and thread identity.

#### Scenario: Automated step with run block
- **WHEN** an automated step executes for a state with a `run` block
- **THEN** the engine invokes the named profile through the agent harness with the state's `run.task` text

### Requirement: sm-13 — Run blocks: manual mode suppression
WHILE executing in manual mode (operator `advance`), THE engine SHALL NOT invoke any `run` profile.

#### Scenario: Manual advance
- **WHEN** an operator manually advances the quest
- **THEN** the engine does not invoke any `run` profile

### Requirement: sm-14 — Run blocks: child directory as active path
WHEN the machine executing a `run` block is a child machine, THE harness invocation SHALL receive the child directory as the active child path; WHEN it is the top-level machine and an active child exists, the active child's directory is used.

#### Scenario: Run block in child machine
- **WHEN** a `run` block is executed by a child machine
- **THEN** the harness invocation receives the child directory as the active child path

#### Scenario: Run block in top-level machine with active child
- **WHEN** a `run` block is executed by the top-level machine and an active child exists
- **THEN** the harness invocation uses the active child's directory

### Requirement: sm-15 — Transitions: document order first match
THE engine SHALL evaluate `transitions` in document order and apply the first eligible entry whose `if` condition (when present) is true; entries without an `if` always match.

#### Scenario: Transitions evaluated in order
- **WHEN** the engine evaluates transitions for a state
- **THEN** it applies the first eligible entry in document order, using entries without `if` as unconditional matches

### Requirement: sm-16 — Transitions: manual_only mode gate
WHEN a transition carries `mode: manual_only`, THE engine SHALL skip it during automated execution and consider it only during manual advance. (Any `mode` value other than `manual_only` has no effect.)

#### Scenario: manual_only transition during automated execution
- **WHEN** a transition with `mode: manual_only` is encountered during automated execution
- **THEN** the engine skips it

#### Scenario: manual_only transition during manual advance
- **WHEN** a transition with `mode: manual_only` is encountered during manual advance
- **THEN** the engine considers it

### Requirement: sm-17 — Transitions: stop in automated execution
WHEN a `stop` transition matches during automated execution, THE engine SHALL end the run with `stop.status` as the run status, leave the state unchanged, and persist nothing for that step.

#### Scenario: Stop transition matches during automated run
- **WHEN** a `stop` transition matches during automated execution
- **THEN** the engine ends the run with `stop.status`, leaves the state unchanged, and persists nothing for that step

### Requirement: sm-18 — Transitions: stop skipped in manual mode
WHILE in manual mode, THE engine SHALL skip `stop` transitions entirely (this is how `manual_only` gates such as `PrePlanning` are passed by a human).

#### Scenario: Stop transition during manual advance
- **WHEN** a `stop` transition is encountered during manual advance
- **THEN** the engine skips it entirely

### Requirement: sm-19 — Transitions: stay behavior
WHEN a `stay` transition matches during automated execution, THE machine SHALL remain in its current state and the run loop SHALL continue with the next step; WHEN a `stay` transition matches during manual advance, THE engine SHALL reject the advance with `stay.reason` as the validation reason.

#### Scenario: Stay transition during automated execution
- **WHEN** a `stay` transition matches during automated execution
- **THEN** the machine remains in its current state and the run loop continues with the next step

#### Scenario: Stay transition during manual advance
- **WHEN** a `stay` transition matches during manual advance
- **THEN** the engine rejects the advance with `stay.reason` as the validation reason

### Requirement: sm-20 — Transitions: to transition
WHEN a `to` transition matches, THE engine SHALL execute its `actions` list (default `[]`) and then move the machine to the target state; IF the target is not a declared state of the same machine, THEN THE loader SHALL reject the workflow.

#### Scenario: To transition matches
- **WHEN** a `to` transition matches
- **THEN** the engine executes its `actions` and moves the machine to the target state

#### Scenario: Undeclared to target at load
- **WHEN** a `to` transition names a state not declared in the same machine
- **THEN** the loader rejects the workflow

### Requirement: sm-21 — Transitions: no match behavior
IF no transition matches during an automated step, THEN THE machine SHALL remain in its current state and the step completes (as a no-op unless actions changed variables or files); IF no transition matches during manual advance, THEN THE engine SHALL reject the advance with reason `no_eligible_transition`.

#### Scenario: No match during automated step
- **WHEN** no transition matches during an automated step
- **THEN** the machine remains in its current state and the step completes as a no-op unless actions changed variables or files

#### Scenario: No match during manual advance
- **WHEN** no transition matches during manual advance
- **THEN** the engine rejects the advance with reason `no_eligible_transition`

### Requirement: sm-22 — Transitions: malformed entry handling
THE engine SHALL skip a transition entry that contains none of `stop`, `stay`, or `to`; IF a transition entry is not a mapping, or `stop.status` / `stay.reason` / `to` is not a string, THEN THE engine SHALL fail with a fatal invariant error.

#### Scenario: Entry with none of stop/stay/to
- **WHEN** a transition entry contains none of `stop`, `stay`, or `to`
- **THEN** the engine skips that entry

#### Scenario: Malformed transition entry
- **WHEN** a transition entry is not a mapping, or `stop.status`, `stay.reason`, or `to` is not a string
- **THEN** the engine fails with a fatal invariant error

### Requirement: sm-23 — Transitions: stop on child machine
IF a child machine step matches a `stop` transition, THEN THE engine SHALL fail with a fatal invariant error (`stop` is valid only on the top-level machine).

#### Scenario: Child machine stop transition
- **WHEN** a child machine step matches a `stop` transition
- **THEN** the engine fails with a fatal invariant error

### Requirement: sm-24 — Conditions: condition mapping requirement
THE engine SHALL require every condition to be a mapping whose single recognized key selects the condition type; IF the condition is not a mapping or its type is not one of the types below, THEN THE engine SHALL fail with a fatal invariant error naming the condition.

#### Scenario: Valid condition
- **WHEN** a condition is a mapping with a single recognized type key
- **THEN** the engine evaluates it

#### Scenario: Invalid condition
- **WHEN** a condition is not a mapping or its type key is not recognized
- **THEN** the engine fails with a fatal invariant error naming the condition

### Requirement: sm-25 — Conditions: boolean combinators
THE engine SHALL support boolean combinators `all` (list, true when every item is true; true for an empty list), `any` (list, true when at least one item is true; false for an empty list), and `not` (single condition, negation), nesting to any depth.

#### Scenario: all combinator
- **WHEN** an `all` condition is evaluated with a list of sub-conditions
- **THEN** it is true when every item is true, and true for an empty list

#### Scenario: any combinator
- **WHEN** an `any` condition is evaluated with a list of sub-conditions
- **THEN** it is true when at least one item is true, and false for an empty list

#### Scenario: not combinator
- **WHEN** a `not` condition is evaluated with a single sub-condition
- **THEN** it is the negation of that sub-condition

### Requirement: sm-26 — Conditions: path conditions
THE engine SHALL support path conditions `exists` (path exists), `file_exists` (path is a regular file), `dir_exists` (path is a directory), and `not_exists` (path does not exist), each taking one path string resolved per sm-44.

#### Scenario: Path condition evaluation
- **WHEN** a path condition (`exists`, `file_exists`, `dir_exists`, or `not_exists`) is evaluated
- **THEN** the engine resolves the path per sm-44 and returns the appropriate boolean based on whether the path exists, is a file, is a directory, or does not exist

### Requirement: sm-27 — Conditions: file_count_at_least
THE engine SHALL support `file_count_at_least` with `glob` (string) and `count` (integer; booleans rejected): true when at least `count` entries match the glob evaluated relative to the executing machine's directory. The glob is NOT interpolated and does not accept `$`-path variables.

#### Scenario: file_count_at_least evaluated
- **WHEN** a `file_count_at_least` condition is evaluated
- **THEN** the engine returns true when at least `count` entries match the non-interpolated glob relative to the executing machine's directory

#### Scenario: Boolean count rejected
- **WHEN** `file_count_at_least.count` is a boolean
- **THEN** the engine fails with a fatal invariant error

### Requirement: sm-28 — Conditions: issue file conditions
THE engine SHALL support `has_open_issues` and `no_open_issues`, each with `file` (path string resolved per sm-44): an issue file has open issues when any parsed issue entry's `status` field, trimmed and lowercased, equals `open`; a missing or entry-less file has no open issues. Issue file format: [issues](../quest-runner-issues/spec.md).

#### Scenario: has_open_issues with open entries
- **WHEN** `has_open_issues` is evaluated and the issue file has at least one entry whose status trimmed and lowercased equals `open`
- **THEN** the condition is true

#### Scenario: no_open_issues with missing or empty file
- **WHEN** `no_open_issues` is evaluated and the issue file is missing or has no entries
- **THEN** the condition is true

### Requirement: sm-29 — Conditions: variable conditions
THE engine SHALL support `var_exists` (string variable name; true when the variable is defined as a step variable or persisted variable) and `var_equals` with `name` and `value` strings (true when the variable's current value equals `value` exactly; an undefined variable never equals anything).

#### Scenario: var_exists for defined variable
- **WHEN** `var_exists` is evaluated for a variable defined as a step or persisted variable
- **THEN** the condition is true

#### Scenario: var_equals with matching value
- **WHEN** `var_equals` is evaluated and the variable's current value exactly equals `value`
- **THEN** the condition is true

#### Scenario: var_equals with undefined variable
- **WHEN** `var_equals` is evaluated for an undefined variable
- **THEN** the condition is false

### Requirement: sm-30 — Conditions: child_dirs_exist
THE engine SHALL support `child_dirs_exist` with `collection` (declared collection name): true when the collection has at least one child directory.

#### Scenario: child_dirs_exist with children present
- **WHEN** `child_dirs_exist` is evaluated and the collection has at least one child directory
- **THEN** the condition is true

#### Scenario: child_dirs_exist with no children
- **WHEN** `child_dirs_exist` is evaluated and the collection has no child directories
- **THEN** the condition is false

### Requirement: sm-31 — Conditions: all_children
THE engine SHALL support `all_children` with `collection` and `require` (list of conditions): false when the collection has no children; otherwise true when every child satisfies every `require` item, with path conditions and `file_count_at_least` evaluated relative to each child's directory (and `$machine` resolving to the child directory).

#### Scenario: all_children with no children
- **WHEN** `all_children` is evaluated and the collection has no children
- **THEN** the condition is false

#### Scenario: all_children with all children satisfying requirements
- **WHEN** `all_children` is evaluated and every child satisfies every `require` item
- **THEN** the condition is true, with path conditions evaluated relative to each child's directory

### Requirement: sm-32 — Conditions: child_result
THE engine SHALL support `child_result` with `state_after` (string): true when the child machine step executed by the *same* state in the *same* step ended in that logical state; IF evaluated when no child step ran, THEN THE engine SHALL fail with a fatal invariant error.

#### Scenario: child_result matches child state
- **WHEN** `child_result` is evaluated and the child machine step ended in the specified logical state
- **THEN** the condition is true

#### Scenario: child_result evaluated without child step
- **WHEN** `child_result` is evaluated in a step where no child step ran
- **THEN** the engine fails with a fatal invariant error

### Requirement: sm-33 — Actions: action mapping requirement
THE engine SHALL require every action to be a mapping whose single recognized key selects the action type; IF an action is a bare string, not a mapping, or an unknown type, THEN THE engine SHALL fail the step with a fatal invariant error.

#### Scenario: Valid action
- **WHEN** an action is a mapping with a single recognized type key
- **THEN** the engine executes it

#### Scenario: Invalid action
- **WHEN** an action is a bare string, not a mapping, or has an unknown type key
- **THEN** the engine fails the step with a fatal invariant error

### Requirement: sm-34 — Actions: ensure_dir
THE engine SHALL support `ensure_dir: <path>`: create the directory and any missing parents; succeed silently when it already exists.

#### Scenario: ensure_dir creates directory
- **WHEN** `ensure_dir` is executed for a path that does not exist
- **THEN** the engine creates the directory and any missing parents

#### Scenario: ensure_dir on existing directory
- **WHEN** `ensure_dir` is executed for a path that already exists
- **THEN** the engine succeeds silently

### Requirement: sm-35 — Actions: ensure_file
THE engine SHALL support `ensure_file` with `path` (string) and `content` (string, default `""`): when the file does not exist, create parent directories and write the *interpolated* content (UTF-8); WHEN the file already exists, THE engine SHALL leave it untouched (never overwrite).

#### Scenario: ensure_file creates missing file
- **WHEN** `ensure_file` is executed and the file does not exist
- **THEN** the engine creates parent directories and writes the interpolated content in UTF-8

#### Scenario: ensure_file with existing file
- **WHEN** `ensure_file` is executed and the file already exists
- **THEN** the engine leaves it untouched and does not overwrite it

### Requirement: sm-36 — Actions: remove_file
THE engine SHALL support `remove_file: <path>`: delete the file when it exists; succeed silently when it does not.

#### Scenario: remove_file deletes existing file
- **WHEN** `remove_file` is executed for a file that exists
- **THEN** the engine deletes it

#### Scenario: remove_file on missing file
- **WHEN** `remove_file` is executed for a file that does not exist
- **THEN** the engine succeeds silently

### Requirement: sm-37 — Actions: set_var
THE engine SHALL support `set_var` with `name` and `value` strings: set the persisted variable `name` to the interpolated `value`.

#### Scenario: set_var executed
- **WHEN** `set_var` is executed
- **THEN** the engine sets the persisted variable `name` to the interpolated `value`

### Requirement: sm-38 — Actions: clear_var
THE engine SHALL support `clear_var: <name>`: remove the persisted variable; succeed silently when it is not set.

#### Scenario: clear_var removes variable
- **WHEN** `clear_var` is executed for a variable that is set
- **THEN** the engine removes the persisted variable

#### Scenario: clear_var on unset variable
- **WHEN** `clear_var` is executed for a variable that is not set
- **THEN** the engine succeeds silently

### Requirement: sm-39 — Actions: select_child
THE engine SHALL support `select_child` with `collection` (declared collection name), `where` (mapping), optional `after` (variable name), `set` (persisted variable name), and `result` (step variable name). Execution: enumerate the collection's children in collection order; keep children whose current *logical* state matches `where`; when `after` names a variable whose value is one of the collection's child ids, select the first matching child strictly after that id in collection order (falling back to the first match when the id is unknown); otherwise select the first match. On selection, set the persisted variable `set` and the step variable `result` to the selected child id.

#### Scenario: select_child with after variable
- **WHEN** `select_child` is executed and `after` names a variable whose value is a known child id
- **THEN** the engine selects the first matching child strictly after that id in collection order, setting the `set` and `result` variables to the selected child id

#### Scenario: select_child without after or unknown id
- **WHEN** `select_child` is executed without `after`, or `after` names an unknown child id
- **THEN** the engine selects the first matching child, setting the `set` and `result` variables

### Requirement: sm-40 — Actions: select_child no match
WHEN `select_child` finds no matching child (or no match after the `after` id), THE engine SHALL leave both `set` and `result` variables unchanged (in the default workflow, a subsequent `var_exists` on the `result` variable detects this).

#### Scenario: select_child finds no match
- **WHEN** `select_child` finds no matching child or no match after the `after` id
- **THEN** the engine leaves both `set` and `result` variables unchanged

### Requirement: sm-41 — Actions: select_child where mapping
THE `select_child.where` mapping SHALL contain exactly one of `state_is: <logical state>` or `state_not: <logical state>` (when both are present `state_is` wins); IF neither is present, THEN THE engine SHALL fail with a fatal invariant error.

#### Scenario: where with state_is
- **WHEN** `select_child.where` contains `state_is`
- **THEN** the engine filters children whose logical state matches the given state

#### Scenario: where with both state_is and state_not
- **WHEN** `select_child.where` contains both `state_is` and `state_not`
- **THEN** `state_is` wins

#### Scenario: where with neither
- **WHEN** `select_child.where` contains neither `state_is` nor `state_not`
- **THEN** the engine fails with a fatal invariant error

### Requirement: sm-42 — Variables and interpolation: two variable scopes
THE engine SHALL maintain two variable scopes: *persisted variables*, stored as tags in the machine's `state.md` and surviving across steps, and *step variables* (written only by `select_child.result`), which exist only for the remainder of the current step. Variable lookup checks step variables first, then persisted variables.

#### Scenario: Variable lookup order
- **WHEN** a variable is looked up by name
- **THEN** the engine checks step variables first, then persisted variables

### Requirement: sm-43 — Variables and interpolation: interpolation grammar
THE engine SHALL interpolate `{name}` placeholders (`name` matching `[a-zA-Z_][a-zA-Z0-9_]*`) in `ensure_file.content`, `set_var.value`, and every path string before resolution; `{now}` interpolates to the current UTC time in ISO-8601 format; any other name resolves via variable lookup; IF the name is not defined, THEN THE engine SHALL fail the step with a fatal invariant error (`Unknown workflow variable '<name>' in interpolation`).

#### Scenario: now placeholder
- **WHEN** `{now}` appears in an interpolated string
- **THEN** it is replaced with the current UTC time in ISO-8601 format

#### Scenario: Named variable placeholder
- **WHEN** `{name}` appears in an interpolated string and the variable is defined
- **THEN** it is replaced with the variable's current value

#### Scenario: Undefined variable placeholder
- **WHEN** `{name}` appears in an interpolated string and the variable is not defined
- **THEN** the engine fails the step with a fatal invariant error

### Requirement: sm-44 — Variables and interpolation: path resolution
THE engine SHALL resolve path strings as follows: interpolate per sm-43; reject absolute results; when the path is exactly `$quest`, `$project`, `$machine`, or `$active_child`, or begins with one of those followed by `/`, resolve against the quest directory, the current project directory (`<repo>/projects/<meta.project>`), the executing machine's directory, or the active child directory respectively; any other `$name` is a fatal invariant error; paths with no `$` prefix resolve relative to the *executing machine's directory* (the quest root for the entry machine, the child directory for a child machine).

#### Scenario: $quest path
- **WHEN** a path starts with `$quest`
- **THEN** the engine resolves it against the quest directory

#### Scenario: $project path
- **WHEN** a path starts with `$project`
- **THEN** the engine resolves it against the current project directory

#### Scenario: $machine path
- **WHEN** a path starts with `$machine`
- **THEN** the engine resolves it against the executing machine's directory

#### Scenario: $active_child path
- **WHEN** a path starts with `$active_child`
- **THEN** the engine resolves it against the active child directory

#### Scenario: Unknown $name
- **WHEN** a path starts with `$` followed by an unrecognized name
- **THEN** the engine fails with a fatal invariant error

#### Scenario: Relative path
- **WHEN** a path has no `$` prefix
- **THEN** the engine resolves it relative to the executing machine's directory

### Requirement: sm-45 — Variables and interpolation: active_child resolution
THE engine SHALL resolve `$active_child` by scanning collections in declaration order for one whose `active_var` persisted variable names an existing child directory; IF none qualifies, THEN THE engine SHALL fail with a fatal invariant error.

#### Scenario: active_child resolved
- **WHEN** `$active_child` is used and a collection's `active_var` names an existing child directory
- **THEN** the engine uses that child directory

#### Scenario: No qualifying active child
- **WHEN** `$active_child` is used and no collection's `active_var` names an existing child directory
- **THEN** the engine fails with a fatal invariant error

### Requirement: sm-46 — Variables and interpolation: workflow variables not consumed
THE `variables` mapping in `workflow.yaml` SHALL be validated (string keys and values) but SHALL NOT be consumed by the engine: it does not feed `{name}` interpolation or `$`-path resolution. (Profile path/prompt rendering is specified in [agent-harness](../quest-runner-agent-harness/spec.md).)

#### Scenario: workflow.yaml variables mapping
- **WHEN** the engine evaluates `{name}` or `$name` in path resolution
- **THEN** the `variables` mapping from `workflow.yaml` is not consulted

### Requirement: sm-47 — Variables and interpolation: identity tags override
WHEN writing the top-level machine's state, THE engine SHALL always write the identity tags `quest_type`, `quest_number`, and `quest_slug` from quest metadata, overriding any workflow-set variables of the same names.

#### Scenario: Identity tags written
- **WHEN** the top-level machine's state is persisted
- **THEN** the engine writes `quest_type`, `quest_number`, and `quest_slug` from quest metadata, overriding any workflow-set variables of those names

### Requirement: sm-48 — Collections and child machines: child enumeration
THE engine SHALL enumerate a collection's children as the directories under the quest directory matching the collection's `path` pattern (segment-wise match where `*` matches any single segment), with child id equal to the directory name (`id_from: directory_name`) and ordering per `order: lexical` (ascending directory-name sort). These are the only supported `id_from` and `order` values; others are rejected at load.

#### Scenario: Child enumeration
- **WHEN** the engine enumerates a collection's children
- **THEN** it returns directories matching the path pattern with lexical ordering by directory name

#### Scenario: Unsupported id_from or order at load
- **WHEN** `id_from` or `order` has an unsupported value
- **THEN** the loader rejects the workflow

### Requirement: sm-49 — Collections and child machines: child step execution
WHEN executing a state with a `child` block, THE engine SHALL read the child id from the persisted variable named by `child.active`, load the collection's machine for that child's directory, and execute exactly one workflow step of it (`run: one_step`) in the same execution mode, before evaluating the parent state's transitions.

#### Scenario: Child step executed
- **WHEN** a state with a `child` block is executed
- **THEN** the engine reads the active child id, loads the child machine, and executes one step before evaluating parent transitions

### Requirement: sm-50 — Collections and child machines: missing active child
IF the `child.active` variable is unset or empty, or the named child directory does not exist, THEN THE engine SHALL fail the step with a fatal invariant error.

#### Scenario: child.active unset or empty
- **WHEN** the `child.active` variable is unset or empty
- **THEN** the engine fails the step with a fatal invariant error

#### Scenario: Named child directory does not exist
- **WHEN** the child directory named by `child.active` does not exist
- **THEN** the engine fails the step with a fatal invariant error

### Requirement: sm-51 — Collections and child machines: child state persistence
THE engine SHALL persist each child machine's state in that child's own `state.md` (persisted-state form, no `global_step`); child machines do not maintain their own step counters or git commits — the enclosing top-level step commits all changes. Collection `scaffold` actions are executed by quest/slice creation, not by the step engine; see [workflow-config](../quest-runner-workflow-config/spec.md) and [slices](../quest-runner-slices/spec.md).

#### Scenario: Child state persisted
- **WHEN** a child machine step completes
- **THEN** the engine persists the child state to the child's own `state.md` in persisted-state form without `global_step`

### Requirement: sm-52 — State persistence and persisted_as: read/write mapping
WHEN persisting state, THE engine SHALL write the state's `persisted_as` value when declared, and the logical state name otherwise; WHEN reading, THE engine SHALL map the persisted value back to the logical name; IF a persisted value matches neither a `persisted_as` declaration nor a logical state name of the machine, THEN THE engine SHALL fail with a fatal invariant error.

#### Scenario: Persisting state with persisted_as
- **WHEN** a state with `persisted_as` declared is persisted
- **THEN** the engine writes the `persisted_as` value to `state.md`

#### Scenario: Reading persisted state
- **WHEN** a persisted value is read from `state.md`
- **THEN** the engine maps it back to the logical state name

#### Scenario: Unrecognized persisted value
- **WHEN** a persisted value matches neither a `persisted_as` declaration nor a logical state name
- **THEN** the engine fails with a fatal invariant error

### Requirement: sm-53 — State persistence and persisted_as: ExperimentComplete passthrough
THE engine SHALL pass the reserved top-level persisted state `ExperimentComplete` through unmapped in both directions and treat it as complete; see [experiments](../quest-runner-experiments/spec.md).

#### Scenario: ExperimentComplete state
- **WHEN** the persisted state is `ExperimentComplete`
- **THEN** the engine passes it through unmapped in both directions and treats the machine as complete

### Requirement: sm-54 — State persistence and persisted_as: state.md format
THE engine SHALL persist the top-level machine to `<quest>/state.md` in the normalized `# State` / `## Tags` format (persisted variables are the tags) and child machines to `<child>/state.md` in the persisted-state form; exact file grammars: [Runtime files](../../../projects/quest-runner/docs/contracts/runtime-files.md).

#### Scenario: Top-level state persisted
- **WHEN** the top-level machine's state is written
- **THEN** the engine writes `<quest>/state.md` in the normalized `# State` / `## Tags` format with persisted variables as tags

#### Scenario: Child state persisted
- **WHEN** a child machine's state is written
- **THEN** the engine writes `<child>/state.md` in the persisted-state form

### Requirement: sm-55 — State persistence and persisted_as: completed_state field
THE `special.completed_state` field of `workflow.yaml` SHALL be parsed (default `Completed`) but completion SHALL be determined solely by `terminal` declarations (sm-57); the field currently has no runtime effect.

#### Scenario: completed_state field present
- **WHEN** `special.completed_state` is set in `workflow.yaml`
- **THEN** the engine parses it but does not use it to determine completion; completion comes from `terminal` declarations only

### Requirement: sm-56 — Top-level step loop, global step, and commits: run loop
WHILE running a quest automatically, THE engine SHALL loop up to `max_steps` (default 500) top-level steps; before each step it SHALL end the run with status `human_intervention` when the human-intervention file exists, and with status `completed` when the top-level machine is complete; a matched `stop` transition ends the run with its status; exhausting the loop ends with status `max_steps`.

#### Scenario: Human-intervention file present
- **WHEN** the human-intervention file exists before a step
- **THEN** the engine ends the run with status `human_intervention`

#### Scenario: Top-level machine complete
- **WHEN** the top-level machine is complete before a step
- **THEN** the engine ends the run with status `completed`

#### Scenario: Loop exhausted
- **WHEN** `max_steps` steps have been executed without completion
- **THEN** the engine ends the run with status `max_steps`

### Requirement: sm-57 — Top-level step loop, global step, and commits: completion conditions
THE engine SHALL consider the top-level machine complete when its logical state is in the machine's `terminal` list, the state declares `terminal: true`, or the persisted state is `ExperimentComplete`.

#### Scenario: State in terminal list
- **WHEN** the top-level machine's logical state is in the machine's `terminal` list
- **THEN** the engine considers the machine complete

#### Scenario: State with terminal: true
- **WHEN** the top-level machine is in a state that declares `terminal: true`
- **THEN** the engine considers the machine complete

#### Scenario: ExperimentComplete persisted state
- **WHEN** the persisted state is `ExperimentComplete`
- **THEN** the engine considers the machine complete

### Requirement: sm-58 — Top-level step loop, global step, and commits: deferred writes and commit
WHEN executing a top-level step, THE engine SHALL defer all `state.md` writes (top-level and child) until commit time, then apply them and create exactly one git commit containing every file changed during the step, with the step-commit message format (headers `quest-step`, `state-machine-path`, `node`, `state-before`, `state-after` plus a JSON recursive snapshot) specified in [Runtime files](../../../projects/quest-runner/docs/contracts/runtime-files.md#step-commit-metadata).

#### Scenario: Top-level step committed
- **WHEN** a top-level step completes with changes
- **THEN** the engine defers all `state.md` writes until commit time, then creates exactly one git commit with all changed files and the specified step-commit message format

### Requirement: sm-59 — Top-level step loop, global step, and commits: global_step increment
THE engine SHALL increment `global_step` by exactly 1 per committed top-level step, reading the previous value from the top-level `state.md`; IF `state.md` carries no `global_step`, THEN THE engine SHALL recover it from the most recent valid step commit for this quest in `git log`, falling back to the number of entries in `state_history.md`.

#### Scenario: global_step in state.md
- **WHEN** `state.md` carries a `global_step` value
- **THEN** the engine increments it by 1 for the committed step

#### Scenario: global_step missing from state.md
- **WHEN** `state.md` carries no `global_step`
- **THEN** the engine recovers it from the most recent valid step commit in `git log`, falling back to the number of entries in `state_history.md`

### Requirement: sm-60 — Top-level step loop, global step, and commits: no-op detection
WHEN a top-level step changes neither machine state (including variables) nor any repository file, THE engine SHALL treat it as a no-op: no commit, no `global_step` increment, and the run loop continues.

#### Scenario: No-op step
- **WHEN** a top-level step changes neither machine state nor any repository file
- **THEN** the engine creates no commit, does not increment `global_step`, and continues the run loop

### Requirement: sm-61 — Top-level step loop, global step, and commits: metadata validation failure
IF the rendered step-commit metadata fails round-trip validation, THEN THE engine SHALL write `logs/commit_metadata_validation_<timestamp>.md`, write the human-intervention file, and end the run without committing.

#### Scenario: Commit metadata round-trip validation failure
- **WHEN** the rendered step-commit metadata fails round-trip validation
- **THEN** the engine writes `logs/commit_metadata_validation_<timestamp>.md`, writes the human-intervention file, and ends the run without committing

### Requirement: sm-62 — Top-level step loop, global step, and commits: git failure recovery
IF git staging finds no changes or staging/commit fails, THEN THE engine SHALL restore all deferred `state.md` files to their pre-step contents, unstage everything, write the human-intervention file, and end the run.

#### Scenario: Git staging or commit failure
- **WHEN** git staging finds no changes or staging/commit fails
- **THEN** the engine restores all deferred `state.md` files to pre-step contents, unstages everything, writes the human-intervention file, and ends the run

### Requirement: sm-63 — Top-level step loop, global step, and commits: snapshot node name
THE snapshot recorded for each step SHALL use the state's `node_name` when declared and the logical state name otherwise, and SHALL nest the child machine's snapshot when a child step ran.

#### Scenario: Snapshot with node_name
- **WHEN** a step snapshot is recorded and the state has `node_name` declared
- **THEN** the snapshot uses `node_name`

#### Scenario: Snapshot without node_name
- **WHEN** a step snapshot is recorded and the state has no `node_name`
- **THEN** the snapshot uses the logical state name

#### Scenario: Snapshot with child step
- **WHEN** a step snapshot is recorded and a child step ran
- **THEN** the snapshot nests the child machine's snapshot

### Requirement: sm-64 — Top-level step loop, global step, and commits: state_history.md not appended
THE engine SHALL NOT append to `state_history.md`; the file is created by workflow scaffold actions and read only as the last-resort `global_step` fallback (sm-59).

#### Scenario: state_history.md not modified by engine
- **WHEN** the engine runs steps
- **THEN** it does not append to `state_history.md`

### Requirement: sm-65 — Human intervention: file blocks all execution
WHILE the file named by `special.human_intervention_file` (default `human_intervention_request.md`) exists at the quest root, THE engine SHALL NOT execute automated steps and SHALL reject manual advance.

#### Scenario: Human-intervention file present at start of step
- **WHEN** the human-intervention file exists at the quest root
- **THEN** the engine does not execute automated steps and rejects manual advance

### Requirement: sm-66 — Human intervention: harness leaves file present
WHEN a harness profile run within a step leaves the human-intervention file present, THE engine SHALL stop before evaluating transitions, so the workflow state does not advance past the request.

#### Scenario: Harness leaves intervention file
- **WHEN** a harness profile run within a step leaves the human-intervention file present
- **THEN** the engine stops before evaluating transitions

### Requirement: sm-67 — Manual advance: one step in manual mode
WHEN an operator advances a quest, THE engine SHALL execute one top-level step in manual mode — actions and child recursion run, `run` profiles do not — and commit it through the same metadata machinery as an automated step; WHEN the quest is already complete, THE engine SHALL report completion without executing a step.

#### Scenario: Operator advances quest
- **WHEN** an operator advances a quest that is not complete
- **THEN** the engine executes one top-level step in manual mode (actions and child recursion run, run profiles do not) and commits it through the same metadata machinery

#### Scenario: Operator advances complete quest
- **WHEN** an operator advances a quest that is already complete
- **THEN** the engine reports completion without executing a step

## Contracts

This section is the workflow YAML grammar as consumed by the engine. The
surrounding package format (`workflow.yaml` top level, profiles, prompts,
issues, scaffold timing) is owned by [workflow-config](../quest-runner-workflow-config/spec.md);
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
[Runtime files](../../../projects/quest-runner/docs/contracts/runtime-files.md).

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

- [workflow-config](../quest-runner-workflow-config/spec.md) — owns the workflow package format
  (`workflow.yaml`, profiles, prompts, scaffold execution at quest/child
  creation) that this engine loads and executes.
- [agent-harness](../quest-runner-agent-harness/spec.md) — executes `run.profile` invocations:
  message assembly, thread scopes, modify allow/block enforcement.
- [quest-lifecycle](../quest-runner-quest-lifecycle/spec.md) — creates quests (initial state,
  scaffold) and triggers automated runs and manual advance through the
  service API/CLI.
- [issues](../quest-runner-issues/spec.md) — issue file format read by `has_open_issues` /
  `no_open_issues` and the workflow `issues` declarations.
- [slices](../quest-runner-slices/spec.md) — the default `slices` collection: child creation via
  `slices init` using collection scaffold.
- [experiments](../quest-runner-experiments/spec.md) — replaces the quest-local `workflow/`,
  evaluates stop conditions against step snapshots, and uses the reserved
  `ExperimentComplete` state.
- [dashboard](../quest-runner-dashboard/spec.md) — renders `state.md` and step-commit metadata
  written by this engine.
- [chat-stream](../quest-runner-chat-stream/spec.md) — streams harness events emitted during
  `run` profile execution.
- [service-lifecycle](../quest-runner-service-lifecycle/spec.md) — hosts the runner process that
  drives the step loop.
- [Runtime files](../../../projects/quest-runner/docs/contracts/runtime-files.md) — shared contract for
  `state.md`, `state_history.md`, and step-commit metadata formats.
