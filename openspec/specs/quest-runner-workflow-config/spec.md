# Capability: Workflow Config

Project: `projects/quest-runner`
ID prefix: `wf` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Defines the on-disk format of a quest's `workflow/` package — the declarative
bundle of `workflow.yaml`, machine definitions, agent profiles, role prompts,
and a shared preamble that tells the quest runner how to drive a quest — and
the packaged default workflow shipped inside quest-runner that every new quest
receives as a snapshot. This file specifies the package format, its loading
and validation rules, prompt/preamble templating, and the default eight-role
pipeline. How the engine *executes* a loaded workflow (states, transitions,
conditions, actions) is specified in
[state-machine-engine](../quest-runner-state-machine-engine/spec.md).

## Requirements

### Requirement: wf-1 — Loading and resolution: quest workflow load and fallback
WHEN executing, inspecting, or serving a quest, THE service SHALL load the quest's workflow from `<quest_dir>/workflow/` when `workflow/workflow.yaml` exists, and SHALL otherwise fall back to the packaged default workflow shipped at `src/quest_runner_service/default_workflow/`.

#### Scenario: Quest workflow present
- **WHEN** `workflow/workflow.yaml` exists in the quest directory
- **THEN** the service loads the quest's workflow from `<quest_dir>/workflow/`

#### Scenario: Quest workflow absent
- **WHEN** `workflow/workflow.yaml` is absent from the quest directory
- **THEN** the service falls back to the packaged default workflow at `src/quest_runner_service/default_workflow/`

### Requirement: wf-2 — Loading and resolution: copy packaged default on quest creation
WHEN a quest is created, THE service SHALL copy the entire packaged default workflow directory tree into `<quest_dir>/workflow/` as a point-in-time snapshot and report the copied quest-relative paths in the creation result's `created_files`. Changes to the packaged default affect only quests created afterwards; existing quests keep their snapshot.

#### Scenario: Quest created
- **WHEN** a quest is created
- **THEN** the service copies the entire packaged default workflow directory tree into `<quest_dir>/workflow/` as a point-in-time snapshot and reports the copied quest-relative paths in the creation result's `created_files`

### Requirement: wf-3 — Loading and resolution: validation error on structural violation
IF `workflow.yaml` is missing from a workflow directory, or any structural or cross-reference rule in Contracts below is violated, THEN THE loader SHALL reject the workflow with a validation error that names the offending file and field path.

#### Scenario: workflow.yaml missing
- **WHEN** `workflow.yaml` is missing from a workflow directory
- **THEN** the loader rejects the workflow with a validation error naming the offending file and field path

#### Scenario: Structural or cross-reference rule violated
- **WHEN** any structural or cross-reference rule in Contracts is violated
- **THEN** the loader rejects the workflow with a validation error naming the offending file and field path

### Requirement: wf-4 — Loading and resolution: reject absolute paths
THE loader SHALL reject absolute paths everywhere a quest- or workflow-relative path is expected: scaffold paths, issue file paths, machine and profile references, `special.human_intervention_file`, condition/action path operands, and profile `modify` patterns.

#### Scenario: Absolute path encountered
- **WHEN** a quest- or workflow-relative path field contains an absolute path
- **THEN** the loader rejects the workflow with a validation error

### Requirement: wf-5 — Loading and resolution: legacy upgrade
WHEN a legacy quest still configured by `state_execution_config.yaml` is upgraded, THE service SHALL copy the packaged default workflow into `<quest_dir>/workflow/`, port legacy per-profile overrides (harness, model, reasoning effort, idle timeout) onto the copied profile files, and delete `state_execution_config.yaml`; a quest that already has `workflow/workflow.yaml` reports `already_upgraded`.

#### Scenario: Legacy quest upgraded
- **WHEN** a legacy quest configured by `state_execution_config.yaml` is upgraded
- **THEN** the service copies the packaged default workflow into `<quest_dir>/workflow/`, ports legacy per-profile overrides onto the copied profile files, and deletes `state_execution_config.yaml`

#### Scenario: Quest already upgraded
- **WHEN** a quest being upgraded already has `workflow/workflow.yaml`
- **THEN** the service reports `already_upgraded`

### Requirement: wf-6 — Templating: preamble and task rendering
WHEN composing a profile run message, THE service SHALL render the workflow's preamble template (when `preamble` is declared) and the state's `run.task` text by interpolating brace placeholders and `$`-path variables, and SHALL assemble the message body as `<rendered preamble>\n\nTask:\n<rendered task>` (or `Task:\n<rendered task>` when no preamble is declared).

#### Scenario: Preamble declared
- **WHEN** composing a profile run message and `preamble` is declared
- **THEN** the service renders the preamble template and task text, and assembles the message body as `<rendered preamble>\n\nTask:\n<rendered task>`

#### Scenario: No preamble declared
- **WHEN** composing a profile run message and no `preamble` is declared
- **THEN** the service assembles the message body as `Task:\n<rendered task>`

### Requirement: wf-7 — Templating: prompt prepended to first message
WHEN starting a new harness thread for a profile, THE service SHALL prepend the profile's prompt file verbatim to the first message: `<prompt text>\n\n---\n\n<message body>`.

#### Scenario: New harness thread started
- **WHEN** starting a new harness thread for a profile
- **THEN** the service prepends the profile's prompt file verbatim as `<prompt text>\n\n---\n\n<message body>`

### Requirement: wf-8 — Templating: always-exposed and toggled path variables
THE service SHALL expose `$quest`, `$project`, and `$machine` to every preamble/task template, and SHALL expose `$active_child`, `$log_dir`, `$thread_registry`, and `$reference_docs` only when the profile's `runtime_context` enables the corresponding toggle (see Contracts).

#### Scenario: Always-exposed variables
- **WHEN** rendering any preamble or task template
- **THEN** `$quest`, `$project`, and `$machine` are exposed

#### Scenario: Toggled variables
- **WHEN** a profile's `runtime_context` enables a toggle
- **THEN** the corresponding variable (`$active_child`, `$log_dir`, `$thread_registry`, or `$reference_docs`) is exposed

### Requirement: wf-9 — Templating: unknown placeholder fails rendering
IF a preamble, task, or thread template references an unknown brace placeholder, or a `$`-path variable the profile's `runtime_context` does not expose, THEN THE service SHALL fail rendering with a template error rather than emitting the raw placeholder.

#### Scenario: Unknown brace placeholder
- **WHEN** a template references an unknown brace placeholder
- **THEN** the service fails rendering with a template error

#### Scenario: Unexposed path variable
- **WHEN** a template references a `$`-path variable the profile's `runtime_context` does not expose
- **THEN** the service fails rendering with a template error

### Requirement: wf-10 — Templating: thread name and registry key rendering
THE service SHALL render profile `thread.name_template` and `thread.registry_key_template` with the same brace placeholders as preambles plus the thread-only variables `{repo}`, `{collection}`, `{child_id}`, and `{child_number}`, supporting Python format specs (e.g. `{quest_number:04d}`).

#### Scenario: Thread templates rendered
- **WHEN** rendering `thread.name_template` or `thread.registry_key_template`
- **THEN** the service supports all preamble brace placeholders plus `{repo}`, `{collection}`, `{child_id}`, `{child_number}`, with Python format specs (e.g. `{quest_number:04d}`)

### Requirement: wf-11 — Packaged default workflow: eight profiles
THE packaged default workflow SHALL declare exactly eight profiles — `physical_planner`, `physical_plan_reviewer`, `implementer`, `polisher_reviewer`, `polisher`, `integration_tester`, `integration_test_polisher`, `documenter` — each with a prompt markdown file under `prompts/` and a profile YAML under `profiles/` (see Contracts for the per-profile harness/model/scope table).

#### Scenario: Packaged default workflow loaded
- **WHEN** the packaged default workflow is loaded
- **THEN** it declares exactly eight profiles (`physical_planner`, `physical_plan_reviewer`, `implementer`, `polisher_reviewer`, `polisher`, `integration_tester`, `integration_test_polisher`, `documenter`), each with a prompt markdown file under `prompts/` and a profile YAML under `profiles/`

### Requirement: wf-12 — Packaged default workflow: pipeline order
THE packaged default quest machine SHALL order the quest-level pipeline `PrePlanning → PhysicalPlanning ⇄ ReviewPhysicalPlan → PrepareNextSlice/ExecuteSlice (loop over slices) → IntegrationTesting ⇄ IntegrationTestPolishing → QuestDocumenting → Completed`, and the slice machine SHALL order the per-slice pipeline `SliceSetup → Implementing → PolishingReview ⇄ PolishingFix → Completed`.

#### Scenario: Quest machine pipeline
- **WHEN** the packaged default quest machine is run
- **THEN** it follows the pipeline `PrePlanning → PhysicalPlanning ⇄ ReviewPhysicalPlan → PrepareNextSlice/ExecuteSlice (loop over slices) → IntegrationTesting ⇄ IntegrationTestPolishing → QuestDocumenting → Completed`

#### Scenario: Slice machine pipeline
- **WHEN** the packaged default slice machine is run
- **THEN** it follows the pipeline `SliceSetup → Implementing → PolishingReview ⇄ PolishingFix → Completed`

### Requirement: wf-13 — Packaged default workflow: issue file declarations
THE packaged default workflow SHALL declare the issue files `physicalplan_issues.md` (owner `physical_plan_reviewer`, prefix `QP`), `$active_child/polishing_issues.md` (owner `polisher_reviewer`, prefix `PL`), and `integration_test_issues.md` (owner `integration_tester`, prefix `IT`).

#### Scenario: Issue file declarations present
- **WHEN** the packaged default workflow is loaded
- **THEN** it declares issue files `physicalplan_issues.md` (owner `physical_plan_reviewer`, prefix `QP`), `$active_child/polishing_issues.md` (owner `polisher_reviewer`, prefix `PL`), and `integration_test_issues.md` (owner `integration_tester`, prefix `IT`)

### Requirement: wf-14 — Packaged default workflow: documenter role tasking
THE packaged default documenter role SHALL be tasked with merging the quest's delta specs into the current project's living spec under `docs/` (per `structure/docs-structure.md`), running the rebuild-test self-audit, and updating `docs/coverage.md`; its profile permits writes only to `$project/docs/**` and the quest's human-intervention file.

#### Scenario: Documenter role runs
- **WHEN** the packaged default documenter role runs
- **THEN** it is tasked with merging the quest's delta specs into the project's living spec under `docs/`, running the rebuild-test self-audit, and updating `docs/coverage.md`, with writes permitted only to `$project/docs/**` and the quest's human-intervention file

## Contracts

### Package layout

A workflow package is a directory containing at minimum `workflow.yaml`.
The packaged default is laid out as:

```text
workflow/
  workflow.yaml          # top-level manifest (below)
  preamble.md            # shared runtime-context preamble template
  machines/
    quest.yaml           # entry machine
    slice.yaml           # child machine for the slices collection
  profiles/<role>.yaml   # one per profile key in workflow.yaml
  prompts/<role>.md      # role prompt referenced by each profile
```

All intra-package references (`machines.*`, `profiles.*`, `preamble`) are
relative to the workflow directory; profile `prompt` is relative to the
profile file (`../prompts/<role>.md` in the default).

### workflow.yaml

| Key | Type | Required | Meaning |
|---|---|---|---|
| `version` | int | yes | Format version. Current packaged default: `1`. |
| `name` | string | yes | Human-readable workflow name (`default-main-quest`). |
| `entry_machine` | string | yes | Key into `machines`; the machine run at quest scope. |
| `special.completed_state` | string | no (default `Completed`) | State name that marks the quest complete. |
| `special.human_intervention_file` | string | no (default `human_intervention_request.md`) | Quest-relative file whose presence requests human intervention. |
| `preamble` | string | no | Workflow-relative path to the preamble template; file must exist. |
| `variables` | map string→string | no | Declared name→value pairs. Parsed and validated but currently unused at runtime (see coverage gap). |
| `scaffold` | list | no | Scaffold actions executed at quest creation (forms below). |
| `collections` | map | no | Child collections (fields below). |
| `issues` | map | no | Issue file declarations (fields below). |
| `machines` | map string→path | no | Machine key → workflow-relative machine YAML. |
| `profiles` | map string→path | no | Profile key → workflow-relative profile YAML. |

Collection entry fields (`collections.<name>`):

| Field | Type | Required | Constraint |
|---|---|---|---|
| `path` | string | yes | Quest-relative glob with one `*` segment (`slices/*`). |
| `machine` | string | yes | Must name a declared machine. |
| `order` | string | yes | Only `lexical` is accepted. |
| `id_from` | string | yes | Only `directory_name` is accepted. |
| `active_var` | string | yes | Persisted variable holding the active child id (`active_slice`). |
| `scaffold` | list | no | Scaffold actions run when a child is initialized. |

Issue entry fields (`issues.<alias>`):

| Field | Type | Required | Constraint |
|---|---|---|---|
| `path` | string | yes | Quest-relative issue file; may use `$active_child`. |
| `owner` | string | yes | Profile name allowed to open/close issues in this file. |
| `id_prefix` | string | version 1: yes | Exactly two uppercase ASCII letters (`QP`, `PL`, `IT`). |

Scaffold action forms (used in `scaffold` and `collections.*.scaffold`):

- `ensure_dir: <path>` — create directory if missing.
- `ensure_file: {path: <path>, content: <string>}` — create file with content
  if missing; content supports `{now}` (UTC ISO timestamp) interpolation.
- `remove_file: <path>` — delete file if present.

All scaffold paths are quest-relative. Execution semantics are owned by
[state-machine-engine](../quest-runner-state-machine-engine/spec.md); the same is true of machine
YAML internals (`initial`, `terminal`, `states`, transitions, conditions,
actions) — this capability only requires each `machines.<key>` file to exist,
declare `machine: <key>` matching its map key, declare its `initial` and
`terminal` states, and pass the cross-reference checks below.

Cross-reference validation (load time, all enforced with file + field path in
the error):

- `entry_machine` and every `collections.*.machine` must name a declared
  machine; `run.profile` must name a declared profile; `child.collection`,
  `select_child.collection`, `child_dirs_exist.collection`, and
  `all_children.collection` must name declared collections.
- Transition `to` targets must be declared states of the same machine; a
  `child_result` condition is only legal on a state with a `child` block;
  `child.run` accepts only `one_step`.
- `persisted_as` values must be unique per machine and must not collide with
  a different state's logical name.

### Profile YAML

| Key | Type | Required | Meaning |
|---|---|---|---|
| `harness` | string | yes | One of `codex`, `cursor`, `claude_code`. |
| `model` | string | yes | Harness-specific model id. |
| `reasoning_effort` | string or null | no | Passed through to the harness; `null` means harness default. |
| `idle_timeout_seconds` | int | yes | Idle timeout for harness runs of this profile. |
| `prompt` | string | yes | Path to the role prompt markdown, relative to the profile file; must exist. |
| `runtime_context` | map string→bool | no | Toggles exposing extra `$`-path variables (below). |
| `modify.allow` | list of strings | no | Relative path patterns the agent may write; may use `$quest`, `$project`, `$active_child`. |
| `modify.block` | list of strings | no | Relative path patterns denied for writing (e.g. `**`, `$project/quests/**`). |
| `thread.scope` | string | yes | One of `quest`, `child`, `machine`, `node`. |
| `thread.name_template` | string | yes | Template for the harness thread name. |
| `thread.registry_key_template` | string | yes | Template for the key in `thread_registry.json`. |

`modify` patterns are consumed by [agent-harness](../quest-runner-agent-harness/spec.md) as the
write policy for the spawned agent; this capability only defines their format
(relative patterns, no absolute paths). Thread identity persistence is shared
in [runtime-files](../../../projects/quest-runner/docs/contracts/runtime-files.md).

`runtime_context` toggles and the `$`-path variable each exposes:

| Toggle | Exposes | Resolves to |
|---|---|---|
| (always) | `$quest` | Quest directory, repo-relative. |
| (always) | `$project` | Project directory (`projects/<project>`), repo-relative. |
| (always) | `$machine` | Current machine directory (quest dir, or slice dir for child machines), repo-relative. |
| `include_current_child_path` | `$active_child` | Active child (slice) directory, repo-relative; empty when none. |
| `include_log_directory` | `$log_dir` | `<quest>/logs`. |
| `include_thread_registry_path` | `$thread_registry` | `<quest>/thread_registry.json`. |
| `include_reference_docs_path` | `$reference_docs` | Absolute path of the packaged quest-runner reference docs (`src/quest_runner_service/quest_docs/`). |

### Template placeholders

Brace placeholders available in the preamble, `run.task` text, and thread
templates (Python `format` specs allowed):

| Placeholder | Value | Where |
|---|---|---|
| `{quest_type}` | `main` or `side` | everywhere |
| `{quest_number}` | quest number (int) | everywhere |
| `{quest_slug}` | normalized slug | everywhere |
| `{quest_name}` | human quest name | everywhere |
| `{profile}` | profile key being run | everywhere |
| `{active_slice}` | active child directory name, or empty | everywhere |
| `{experiment_guidance}` | experiment block (below), or empty | everywhere |
| `{repo}` | repository directory name | thread templates only |
| `{collection}` | collection name of the active child, or empty | thread templates only |
| `{child_id}` | active child directory name | thread templates only |
| `{child_number}` | numeric index parsed from the child directory name; error if no active child | thread templates only |

`{experiment_guidance}` renders to an empty string for normal runs; for
experiment runs it renders a block instructing the agent to pass
`--experiment-id <id>` to `scripts/quest-runner` (see
[experiments](../quest-runner-experiments/spec.md)). Thread templates skip `$`-path-variable
validation; preamble/task templates enforce it per [wf-9].

### Packaged default preamble

`preamble.md` renders the quest identity, quest directory, profile, active
child directory, project docs directory, and reference docs directory, then
states the spec hierarchy (project `docs/` is the living spec; quest `specs/`
are deltas) and the issue CLI workflow rules (use
`scripts/quest-runner issues ...` with an explicit `--file`; responders never
close issues; fall back to `human_intervention_request.md` when the CLI
cannot perform an operation). See [issues](../quest-runner-issues/spec.md) for the issue CLI
contract.

### Packaged default roles

| Profile | Harness | Model | Idle timeout (s) | Thread scope | Runs in state (machine) |
|---|---|---|---|---|---|
| `physical_planner` | codex | gpt-5.5 | 1800 | quest | `PhysicalPlanning` (quest) |
| `physical_plan_reviewer` | claude_code | claude-opus-4-8 | 1800 | quest | `ReviewPhysicalPlan` (quest) |
| `implementer` | cursor | composer-2.5 | 3600 | child | `Implementing` (slice) |
| `polisher_reviewer` | claude_code | claude-opus-4-8 | 1800 | child | `PolishingReview` (slice) |
| `polisher` | codex | gpt-5.5 | 3600 | child | `PolishingFix` (slice) |
| `integration_tester` | codex | gpt-5.5 | 3600 | quest | `IntegrationTesting` (quest) |
| `integration_test_polisher` | cursor | composer-2.5 | 3600 | quest | `IntegrationTestPolishing` (quest) |
| `documenter` | codex | gpt-5.5 | 1800 | quest | `QuestDocumenting` (quest) |

All eight profiles enable `include_current_child_path` and
`include_reference_docs_path`; none enable the log-directory or
thread-registry toggles. Quest-scoped profiles use thread name template
`{repo}_quest_{quest_number:04d}_{profile}` and registry key `{profile}`;
child-scoped profiles use
`{repo}_quest_{quest_number:04d}_slice_{child_number:04d}_{profile}` and
`slice_{child_number}_{profile}`.

Role responsibilities and completion signals (from the default machines and
prompts):

- `physical_planner` — converts `specs/` into ordered slices with plan files
  under each slice's `physicalplan/`; addresses open `QP` issues on re-entry.
  May write `$quest/slices/**` and `physicalplan_issue_responses.md`.
- `physical_plan_reviewer` — reviews all slice plans by reading; files/closes
  `QP` issues and writes `physicalplan_accepted.md` to accept.
- `implementer` — implements the active slice's physical plan; signals
  completion by creating `$active_child/implementation_done.md`.
- `polisher_reviewer` — reviews the slice implementation via `git log`/diffs;
  files/closes `PL` issues and writes `implementation_accepted.md` to accept.
- `polisher` — fixes open `PL` issues and records responses; never closes
  issues.
- `integration_tester` — writes and runs cross-slice integration tests; files
  `IT` issues for failures.
- `integration_test_polisher` — fixes open `IT` issues and records responses.
- `documenter` — merges the quest delta into the project's living spec
  (`docs/` capability files, `coverage.md`) per `structure/docs-structure.md`
  [wf-14].

Reviewer-owned acceptance markers (`physicalplan_accepted.md`,
`implementation_accepted.md`) are removed automatically by transition actions
whenever open issues exist, forcing re-acceptance after fixes.

### Prompt files

Each `prompts/<role>.md` is plain markdown sent verbatim as the head of the
thread's first message [wf-7]. By convention it opens with `# <Role> Role`,
states the role's job in one paragraph, then lists primary responsibilities,
execution/review rules, and completion criteria. Prompt files are not
templated — only the preamble and task text are interpolated.

## Design

- Loader and schema: `src/quest_runner_service/workflow_config.py` —
  `load_workflow()` parses `workflow.yaml` into a `WorkflowDefinition`
  (dataclasses `WorkflowSpecial`, `WorkflowCollection`,
  `WorkflowIssueDeclaration`, `WorkflowProfile`, `WorkflowMachine`,
  `WorkflowState`); `_validate_cross_references()` enforces the
  cross-reference rules; all failures raise `WorkflowValidationError`
  carrying `file` and `field_path`. The legal enums live at module top
  (`_THREAD_SCOPES`, `_CHILD_RUN_MODES`, `_COLLECTION_ORDERS`,
  `_COLLECTION_ID_FROM`); harness values come from
  `quest_types.HarnessKind`.
- Packaged default location: `workflow_config.packaged_default_workflow_dir()`
  resolves `src/quest_runner_service/default_workflow/` next to the module,
  so the default ships inside the installed package.
- Copy-on-create: `workflow_scaffold.copy_packaged_default_workflow()`
  (`shutil.copytree`, refuses an existing destination) is called from
  `quest_service.QuestService.create_quest`
  (`src/quest_runner_service/quest_service.py` around line 464) before quest
  scaffolding runs; `list_workflow_tree_paths()` produces the
  `created_files` entries. Experiments snapshot an existing quest's workflow
  with `workflow_scaffold.copy_workflow_directory()` instead
  (`experiments.py`).
- Fallback resolution: `workflow_profile_execution.resolve_quest_workflow()`
  prefers `<quest>/workflow/workflow.yaml` and falls back to
  `load_packaged_default_workflow()`; used by the runner
  (`quest_runner.py`), dashboard (`dashboard_data.py`), issue service
  (`issue_service.py`), and engine adapters
  (`state_machine/adapters.py`).
- Templating: `workflow_profile_execution.py` — `interpolate_template()`
  applies `_BRACE_FORMAT_RE` then `_PATH_VAR_RE`; `_ALWAYS_BRACE_VARS` /
  `_THREAD_BRACE_VARS` define the placeholder sets;
  `_RUNTIME_CONTEXT_TO_PATH_VAR` maps `runtime_context` toggles to path
  variables; `render_preamble()`, `build_workflow_message_body()`,
  `build_workflow_first_round_message()`, `render_thread_name()`, and
  `render_thread_registry_key()` implement [wf-6]–[wf-10]. Violations raise
  `WorkflowTemplateError`. Note the engine's own path interpolation for
  actions/conditions is separate (`state_machine/workflow_paths.py`, which
  also handles `{now}` in scaffold content) and is specified in
  [state-machine-engine](../quest-runner-state-machine-engine/spec.md).
- Legacy upgrade: `workflow_upgrade.py` implements [wf-5]
  (`copy_packaged_default_workflow` + `_port_profile_overrides` +
  `_merge_legacy_harnesses`, then deletes `state_execution_config.yaml`).
- Default workflow content: `src/quest_runner_service/default_workflow/`
  (`workflow.yaml`, `machines/quest.yaml`, `machines/slice.yaml`,
  `profiles/*.yaml`, `prompts/*.md`, `preamble.md`).
- Rationale: copy-on-create makes each quest's behavior self-contained and
  editable per quest (a quest's pipeline cannot change under it when the
  packaged default evolves), while the packaged-default fallback keeps
  read-only surfaces (dashboard, issue CLI) working for quests created
  before the `workflow/` format existed.

## Interactions

- [quest-lifecycle](../quest-runner-quest-lifecycle/spec.md) — quest creation copies the packaged
  default into `workflow/` [wf-2] and runs the manifest's quest-level
  `scaffold`; the legacy upgrade path [wf-5] also lives in the lifecycle
  surface.
- [state-machine-engine](../quest-runner-state-machine-engine/spec.md) — executes the machines,
  collections, scaffold actions, and `special` settings this package
  declares; owns machine YAML execution semantics.
- [agent-harness](../quest-runner-agent-harness/spec.md) — consumes profile `harness`, `model`,
  `reasoning_effort`, `idle_timeout_seconds`, and `modify` allow/block
  patterns when spawning agents, and the rendered first-round message
  [wf-6]–[wf-7].
- [issues](../quest-runner-issues/spec.md) — the `issues` declarations (path, owner, `id_prefix`)
  drive the issue CLI's file resolution and ownership checks.
- [slices](../quest-runner-slices/spec.md) — the `slices` collection (path pattern, lexical
  order, per-child scaffold, `active_slice`) defines slice directories.
- [experiments](../quest-runner-experiments/spec.md) — experiments run against a copied workflow
  directory and inject `{experiment_guidance}` into preamble rendering.
- [service-lifecycle](../quest-runner-service-lifecycle/spec.md) — the service hosts quest
  creation and execution that load this package.
- [dashboard](../quest-runner-dashboard/spec.md) — resolves the quest workflow [wf-1] to label
  states and roles.
- [chat-stream](../quest-runner-chat-stream/spec.md) — streams the harness threads named by the
  profile thread templates [wf-10].
- Shared runtime file formats (state files, `thread_registry.json`):
  [runtime-files](../../../projects/quest-runner/docs/contracts/runtime-files.md).
