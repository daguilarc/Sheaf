# Workflow Reference

Quest Runner executes each quest from a quest-local `workflow/` directory. The
workflow is the state-machine program for that quest: machine definitions,
profiles, prompts, issue-file declarations, scaffold actions, child collections,
thread templates, path rules, and the shared agent-message preamble.

New quests receive a copy of
`src/quest_runner_service/default_workflow/`. Writable project-local quests that
still have `state_execution_config.yaml` can be upgraded to `workflow/` with
`scripts/quest-runner upgrade`. Legacy top-level quest records are not upgraded
or executed.

Implementation:

- `src/quest_runner_service/workflow_config.py`
- `src/quest_runner_service/workflow_scaffold.py`
- `src/quest_runner_service/workflow_upgrade.py`
- `src/quest_runner_service/workflow_profile_execution.py`
- `src/quest_runner_service/state_machine/workflow_interpreter.py`
- `src/quest_runner_service/state_machine/workflow_actions.py`
- `src/quest_runner_service/state_machine/workflow_conditions.py`
- `src/quest_runner_service/state_machine/workflow_paths.py`
- `src/quest_runner_service/state_machine/workflow_state_io.py`

## File Tree

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

The default workflow implements the existing main-quest lifecycle while keeping
the runner generic. Python runner code interprets workflow data; it does not
hard-code the default role graph, review loops, issue-file names, acceptance
marker names, or slice transition rules.

## `workflow.yaml`

`workflow.yaml` is the entry point:

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
  - ensure_file:
      path: integration_test_issues.md
      content: "# Issues\n"

collections:
  slices:
    path: slices/*
    machine: slice
    order: lexical
    id_from: directory_name
    active_var: active_slice
    scaffold:
      - ensure_dir: physicalplan
      - ensure_file:
          path: state.md
          content: "# Slice State\n\nstate: NotStarted\nupdated_at: {now}\n"
      - ensure_file:
          path: state_history.md
          content: "# State Transition History\n\n"
      - ensure_file:
          path: polishing_issues.md
          content: "# Issues\n"
      - ensure_dir: notes

issues:
  physical_plan:
    path: physicalplan_issues.md
    owner: physical_plan_reviewer
    id_prefix: QP
  polishing:
    path: "$active_child/polishing_issues.md"
    owner: polisher_reviewer
    id_prefix: PL
  integration_test:
    path: integration_test_issues.md
    owner: integration_tester
    id_prefix: IT

machines:
  quest: machines/quest.yaml
  slice: machines/slice.yaml

profiles:
  physical_planner: profiles/physical_planner.yaml
```

Important fields:

| Field | Purpose |
| --- | --- |
| `entry_machine` | Top-level machine to execute. |
| `special.completed_state` | Default terminal state name, normally `Completed`. |
| `special.human_intervention_file` | Quest-relative file that blocks automation when present. |
| `preamble` | Shared agent-message preamble template. |
| `variables` | Workflow string/path variables available to interpolation. |
| `scaffold` | Quest-root actions applied at quest creation. |
| `collections` | Repeated child-machine groups, such as `slices`. |
| `issues` | Workflow-declared issue files and default owner/id metadata. |
| `machines` | Machine YAML files by key. |
| `profiles` | Harness-backed execution profiles by key. |

## Machines

Machine YAML declares logical states and their execution behavior:

```yaml
machine: quest
initial: PrePlanning
terminal: [Completed]

states:
  PhysicalPlanning:
    node_name: PhysicalPlanningNode
    run:
      profile: physical_planner
      task: |
        Read specs and write slice plans.
    transitions:
      - if:
          child_dirs_exist:
            collection: slices
        to: ReviewPhysicalPlan
      - stay:
          reason: incomplete_physical_plan
```

A state runs in this order:

1. `actions`
2. `run` profile, during automated execution only
3. `child`, when the state delegates to a child machine
4. ordered `transitions`, first match wins

Supported transition forms are:

| Form | Behavior |
| --- | --- |
| `to` | Persist a new state and optional transition actions. |
| `stay` | Remain in the current state with a reason. Manual advance treats this as a validation block. |
| `stop` | Stop the runner with a status and no state change. |
| `mode: manual_only` | Make the transition available to `advance`, but skip it during automated runs. |

`node_name` pins the durable step metadata name. The default workflow keeps the
legacy node names, such as `ExecuteActiveSliceNode`, so dashboards, experiment
stop conditions, and commit history readers continue to consume the same shape.

`persisted_as` maps a logical state to an on-disk state value. The default slice
machine uses this to persist `SliceSetup` as `NotStarted` and `Completed` as
`Done`, preserving the legacy slice `state.md` file format.

## Conditions

Conditions are pure checks. They do not mutate files or variables.

Boolean conditions:

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

File and issue conditions:

```yaml
exists: path
file_exists: path
dir_exists: path
not_exists: path
file_count_at_least:
  glob: physicalplan/*.md
  count: 1
has_open_issues:
  file: physicalplan_issues.md
no_open_issues:
  file: "$active_child/polishing_issues.md"
```

Collection and child-result conditions:

```yaml
child_dirs_exist:
  collection: slices
all_children:
  collection: slices
  require:
    - file_exists: state.md
child_result:
  state_after: Completed
```

`child_result` is valid only in a state whose `child` block ran during the
current step. State comparisons use logical state names after `persisted_as`
mapping.

## Actions

Actions modify workflow-owned files or persisted workflow variables.

```yaml
- ensure_dir: physicalplan
- ensure_file:
    path: polishing_issues.md
    content: "# Issues\n"
- remove_file: implementation_accepted.md
- clear_var: active_slice
- select_child:
    collection: slices
    where:
      state_not: Completed
    after: active_slice
    set: active_slice
    result: next_slice
```

`select_child` scans a collection in lexical order. It stores the selected child
id in the persisted variable named by `set`; the default workflow stores the
full directory name, such as `0001_foundation`, in `active_slice`. The variable
named by `result` is step-scoped and is not written to `state.md`.

Persisted workflow variables live in the machine `state.md` `## Tags` section.
The runner also writes quest identity tags (`quest_type`, `quest_number`,
`quest_slug`) on the quest-root machine.

## Collections

Collections define repeated child machines. The default workflow declares one
collection named `slices`:

```yaml
collections:
  slices:
    path: slices/*
    machine: slice
    order: lexical
    id_from: directory_name
    active_var: active_slice
```

`scripts/quest-runner slices init` uses the selected collection's `scaffold`
actions when creating new child directories. The optional `--collection` flag is
required only when a workflow declares more than one collection.

## Issues

Issue files are declared by path, not by Python issue type. CLI and API issue
operations must name a workflow-declared issue file:

```bash
scripts/quest-runner issues list \
  --project quest-runner \
  --type main \
  --number 0 \
  --file physicalplan_issues.md
```

For paths containing `$active_child`, validation accepts any child directory in
the collection. This lets operators address
`slices/0001_foundation/polishing_issues.md` even when that slice is not the
currently active child.

`owner` is the default `owner_role` written on newly created issues when
`issues create` does not pass `--owner`. `id_prefix` controls the generated
issue id prefix, such as `QP` or `PL`.

Response files are derived from the issue file name. A file ending in
`_issues.md` stores responses beside it by replacing the suffix with
`_issue_responses.md`.

## Profiles

Profile YAML binds a workflow state to a harness provider, prompt, runtime
context exposure, path rules, and thread identity.

```yaml
harness: codex
model: gpt-5.5
reasoning_effort: null
idle_timeout_seconds: 1800
prompt: ../prompts/documenter.md
runtime_context:
  include_current_child_path: true
  include_reference_docs_path: true
modify:
  allow:
    - "$project/docs/**"
    - "$quest/human_intervention_request.md"
  block:
    - "**"
thread:
  scope: quest
  name_template: "{repo}_quest_{quest_number:04d}_{profile}"
  registry_key_template: "{profile}"
```

Supported `thread.scope` values are `quest`, `child`, `machine`, and `node`.
The default workflow uses `quest` for physical planning, physical-plan review,
and documentation, and `child` for implementer and polishing profiles.

`modify.allow` and `modify.block` are interpolated path glob lists. After each
harness turn, Quest Runner reverts changes outside the profile's allowed paths
and sends the profile a follow-up message in the same thread. When a path
matches both lists, allow wins.

Harness provider CLI paths are service-level configuration in
`config/quest-runner.json`; they are not copied into `workflow/` and are not
replaced by experiments.

## Agent Prompts

The runner assembles harness messages from workflow files:

1. On the first round of a thread, include `workflow/prompts/<profile>.md`.
2. On every round, render `workflow/preamble.md`.
3. Append `Task:` and the current state's `run.task` text.

The runner exposes generic variables such as `$quest`, `$project`, `$machine`,
`$active_child`, `$reference_docs`, `{profile}`, `{active_slice}`, and
`{experiment_guidance}`. Optional path variables are exposed only when the
profile enables the matching `runtime_context` toggle.

When an experiment id is present, `{experiment_guidance}` tells the agent to
pass `--experiment-id <id>` on Quest Runner CLI calls.

## Execution Semantics

Automated runs stop before each step when `human_intervention_request.md`
exists, when the current state is terminal, when a `stop` transition matches, or
when `max_steps` is reached. `PrePlanning` in the default workflow uses a
`stop` transition with status `pre_planning`, so normal automated execution does
not proceed until a human advances the quest.

Manual advance runs one top-level step without invoking any `run` profile. It
executes actions, recurses into active children when configured, evaluates
transitions including `manual_only`, and commits through the same step metadata
machinery as an automated run.

Each committed top-level step includes a recursive snapshot in the commit
message. The default workflow keeps snapshot fields and node names compatible
with earlier v2 quests; see [Runtime files](runtime-files.md#step-commit-metadata).

Experiments replace the whole quest-local `workflow/` directory in the
experiment worktree. Stop conditions are evaluated against snapshot fields and
validated against the workflow's state ids and `node_name` overrides.
