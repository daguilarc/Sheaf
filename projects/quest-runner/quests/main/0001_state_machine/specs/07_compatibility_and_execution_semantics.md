# Compatibility Contract And Execution Semantics

This page pins down the parts of the system that the workflow-language quest
must **not** change, and specifies runner execution semantics that the grammar
pages do not cover (manual advance, quest creation, upgrade, experiments,
harness configuration).

The guiding rule: this quest moves workflow logic from Python into the
`workflow/` configuration directory. Everything the runner **produces** — files
on disk, commit messages, snapshots, statuses, thread names — stays the same.
Only the source of the workflow definition changes.

## Compatibility contract

Unchanged, byte-format-compatible with the current runner:

- Quest root `state.md` (normalized `# State` / `## Tags` format, including the
  `active_slice` tag name and the quest identity tags).
- Slice `state.md` (legacy `# Slice State` format with persisted values
  `NotStarted` / `Implementing` / `PolishingReview` / `PolishingFix` / `Done`,
  via `persisted_as`).
- `state_history.md` files (created, not appended, exactly as today).
- Issue files and issue-response files (markdown format, all entry fields
  including `owner_role`, deterministic `*_issue_responses.md` naming).
- `thread_registry.json` (entry shape and keys, via
  `thread.registry_key_template`).
- Thread names sent to harness providers (via `thread.name_template`).
- Agent log files (`logs/step_NNNN_<profile>.jsonl`, same event schema; the
  `role` field carries the profile name as it carries the role name today).
- Quest-step commit messages: header lines (`quest-step`,
  `state-machine-path`, `node`, `state-before`, `state-after`) and the
  `recursive-snapshot-json` block, including node names (via per-state
  `node_name` overrides) and tag names (`active_slice`).
- Runner result statuses (`pre_planning`, `completed`, `human_intervention`,
  `dirty_workspace`, `experiment_complete`, `max_steps`) and their payload
  shapes.
- `meta.json`, `human_intervention_request.md`, global-step accounting, the
  single-commit-per-step model, the no-op step rule (no transition and no
  changed files means no commit), dirty-workspace validation, and post-harness
  path-rule enforcement with revert/follow-up behavior.

Replaced:

- `state_execution_config.yaml` is removed and replaced by the quest-local
  `workflow/` directory.
- Packaged `roles/*.md` prompt files move into `workflow/prompts/`.
- Hard-coded task instructions (`build_task_instruction()`) move into state
  `run.task` text.
- Issue CLI/API `--scope`/`--slice` parameters are replaced by `--file`
  (see `04_issue_cli_changes.md`).
- The per-agent message preamble (`build_runtime_context()` /
  `_issue_workflow_cli_summary()`) moves into `workflow/preamble.md`
  (see `08_agent_preamble.md`).

The agent-message preamble is a prompt, not a durable artifact, and is **not**
part of the byte-format compatibility contract. Its text changes where the
issue CLI changed (`--scope` to `--file`) and where the broken reviewer
commit-hash context was dropped; otherwise it conveys equivalent information.
The agent-log JSONL schema that records the prompt is unchanged.

## Non-goal: dashboards and web UI

Dashboard and web UI code (`dashboard_*.py`, `agui_mapper.py`, the web
frontend) must not be modified by this quest. They keep working because every
format they consume is in the unchanged list above. Any design choice in the
implementation that would force a dashboard change is wrong; prefer the
compatibility shims described below.

## Quest root `state.md`

The normalized format written by the current
`write_quest_normalized_machine_state()` is unchanged:

- `# State` body with keys `state`, `machine_name`, `machine_path`,
  `global_step`, `updated_at`.
- `## Tags` section with bullet key/value lines.
- Tags contain the runner-provided quest identity tags (`quest_type`,
  `quest_number`, `quest_slug`) plus persisted workflow variables
  (`active_slice` while the slice phase is active).
- `machine_name` is the workflow's entry machine name; the default workflow
  names it `quest`, matching current files.

`current_slice` is not stored. The shared reader (`quest_fs.read_quest_state`)
currently derives it from the `active_slice` tag when the state is
`ExecuteSlice`. The reader is generalized: it derives `current_slice` from the
`active_slice` tag whenever the tag is present and starts with a four-digit
index, with no state-name check. Dashboards gate on
`state == ExecuteSlice and current_slice is not None`, so their behavior is
unchanged.

Two conventions are deliberately pinned by this derivation: the tag name
`active_slice` and the four-digit directory-name prefix
(`slice_index_from_dirname`). This is a **service/CLI-layer** convention, not
runner machinery: it lives in the shared filesystem reader that feeds the
dashboards, web UI, and CLI — the layer that is allowed to be specific to our
actual workflow — and exists because dashboard code (which this quest must not
modify) consumes `current_slice` as an integer. The workflow interpreter never
reads or writes `current_slice`; it addresses the active child exclusively by
the full directory name in the collection's `active_var`. A workflow that
names its active variable something other than `active_slice` runs fine; its
quests simply render without a current-slice panel in the unchanged dashboard.

State-value validation moves out of the shared reader: `quest_fs` no longer
validates against a Python `QuestState` enum. The workflow interpreter
validates that the persisted state is a state of the machine (after
`persisted_as` mapping) or the reserved `ExperimentComplete` value, and fails
with a fatal invariant otherwise — the same failure mode as today's enum
parse error.

## Slice `state.md`

Unchanged legacy format:

```markdown
# Slice State

state: NotStarted
updated_at: 2026-06-09T12:00:00Z
```

The interpreter reads and writes it through the slice machine's `persisted_as`
mapping. Child machine state files for future workflows that declare no
`persisted_as` use the same file format with logical state names.

## Manual advance semantics

Manual advance executes one step of the top-level machine **without running
any `run` profile**, mirroring `advance_v2_top_level_step_without_harness()`:

1. Refuse with a conflict if `human_intervention_request.md` exists.
2. If the current state is terminal (or the reserved `ExperimentComplete`),
   return "already completed" without changes.
3. Execute the current state's `actions`.
4. Skip `run`.
5. If the state has a `child` block, recursively apply these same manual-step
   rules to the active child machine (child `actions` run, child `run` is
   skipped, child transitions are evaluated; the child's new state is
   persisted). The child result is exposed to the parent's `child_result`
   conditions as in an automated step.
6. Evaluate transitions in order. `mode: manual_only` transitions are
   eligible. `stop` transitions are skipped. The first match wins:
   - A matched `to` applies its transition `actions`, persists the new state
     and tags, and proceeds to commit.
   - A matched `stay` **blocks** the advance: the state does not change and
     the error reported to the caller carries the `stay` reason (the current
     `AdvanceValidationError` behavior, e.g. `missing_implementation_done`).
   - If nothing matches, the advance is blocked with a generic
     `no_eligible_transition` reason.
7. Commit through the same single-commit step machinery as automated runs
   (metadata render/parse/validate, stage, commit, no-op rule).

This reproduces current behavior for every state of the default workflow,
with the accepted exception that manual advance from `QuestDocumenting` now
always succeeds (the docs-changed check is dropped).

## Automated runner loop

Unchanged semantics, expressed generically:

- Before each step: stop with `human_intervention` if
  `human_intervention_request.md` exists; stop with `completed` if the current
  state is terminal; stop with `experiment_complete` if the state is the
  reserved `ExperimentComplete` and an experiment context is active.
- A matched `stop` transition ends the run with its declared status without a
  commit (this is how the default workflow expresses the current `PrePlanning`
  early return of `pre_planning`).
- `DirtyWorkspaceError`, harness errors, max-steps, and the
  human-intervention re-check after each step behave exactly as today.

## Experiments and `ExperimentComplete`

See `03_workflow_language_proposal.md`. Summary of the contract:

- Stop conditions remain snapshot-based (machine path + node name) and are
  validated against the quest's workflow configuration (state ids plus
  `node_name` overrides) instead of hard-coded Python node maps.
- Workflow-variant experiments replace the whole quest-local `workflow/`
  directory.
- On stop-condition match, the runner writes the reserved state
  `ExperimentComplete` to the quest root `state.md` and commits, exactly as
  today. The reserved name is generic runner machinery: accepted by readers
  for any workflow, never declared in workflow YAML, treated as terminal.
- Existing `experiment.json` files remain parseable; stop-node alias matching
  continues to work because the default workflow pins the same node names.

## Harness provider configuration

The `harnesses:` section of the current `state_execution_config.yaml`
(provider CLI paths) does **not** move into the workflow directory: CLI paths
are machine-local facts, not workflow data, and must not be copied into quests
or replaced by experiments. They move to a service-level configuration file
loaded by the quest-runner service (location chosen at implementation time,
e.g. a config file next to the service's existing runtime configuration).
Profiles reference harness providers by key only.

This deliberately drops the (unused) ability to override provider CLI paths
per quest.

## Child-creation CLI (`slices init`)

The `slices init` CLI command keeps its name, arguments, and behavior so that
existing prompts and habits keep working. Internally it is generalized:

- It operates on a workflow collection, selected by a new optional
  `--collection` flag that defaults to the workflow's only collection (it is
  an error to omit it when a workflow declares several).
- New child directories are created under the collection's `path` glob root
  using the current `NNNN_slug` naming convention.
- The files scaffolded into each new child come from the collection's
  `scaffold` actions (see `05_workflow_yaml_grammar.md`), not from CLI code.
  For the default workflow this produces exactly today's file set: `state.md`
  (persisted state `NotStarted`), `state_history.md`, `polishing_issues.md`,
  `notes/`.

The runner-side defensive scaffolding in the `SliceSetup` state uses the same
generic actions, so CLI-created and machine-repaired slices are identical.

## Quest creation

Quest creation copies the packaged default `workflow/` directory into the new
quest and writes the initial quest root `state.md` with the entry machine's
`initial` state (`PrePlanning` for the default workflow), the quest identity
tags, and `global_step: 0` — producing the same files as today.

The quest-root files that creation currently scaffolds in Python
(`physicalplan_issues.md`) become a top-level `scaffold:` action list in
`workflow.yaml`, applied once at quest creation with the quest root as the
action base:

```yaml
scaffold:
  - ensure_file:
      path: physicalplan_issues.md
      content: "# Issues\n"
```

## Upgrading writable quests

Upgrade applies to writable project-local quests only; legacy top-level quests
remain read-only and untouched. Because the on-disk state formats are
unchanged by design, the upgrade is configuration-only:

1. Delete `state_execution_config.yaml`.
2. Copy the packaged default `workflow/` directory into the quest. If the old
   config had local customizations (harness, model, timeouts, modify rules),
   port them into the corresponding `profiles/*.yaml`; the variable renames
   are mechanical (`$currentQuest -> $quest`, `$currentSlice -> $active_child`,
   `$currentProject -> $project`).
3. Leave `state.md` files, issue files, logs, and `thread_registry.json`
   untouched. The variable name `active_slice`, the slice persisted state
   values, and the registry keys are all preserved by the default workflow's
   declarations, so an in-flight quest resumes exactly where it was, on its
   existing provider threads.
4. If the quest root `state.md` is still in the pre-normalized
   `# Quest State` format, rewrite it to the normalized format (the same
   conversion the current runner performs on its next write).

A quest that is mid-`QuestDocumenting` at upgrade time completes on its next
step (the docs gate no longer exists); this is the accepted behavior change.

## Out-of-scope Python after this quest

For clarity, the workflow-specific Python that this contract allows to be
deleted (not preserved as fallback): `quest_v2_definitions.py`,
`quest_v2_nodes.py`, `quest_v2_predicates.py`, the hard-coded branches in
`v2_step_executor.py`, `_ROLE_MAP` / marker-file constants /
`build_task_instruction()` / `reviewer_commit_context()` /
`find_next_slice()` / `scaffold_slice_dir()` /
`apply_transition_filesystem_side_effects()` in `quest_runner.py`, the state
mappings in `legacy_quest_state_io.py` / `v2_quest_state_io.py`, role/scope
knowledge in `quest_thread.py` and `issue_service.py`, and the
`QuestState` / `SliceState` enums (with `ExperimentComplete` retained as a
runner-reserved constant).
