# Agent Message Preamble

Every harness send to an agent is more than the profile's base prompt. The
current runner wraps each message with a runtime-context preamble (quest/role/
slice metadata, a "use `specs/`" instruction, and an issue-CLI help summary)
and a task block. None of the other specs cover this preamble, yet it embeds
workflow-specific text and removed issue-CLI flags. This page specifies how the
preamble is constructed in the new system.

## Current behavior (what is sent today)

The message is assembled in `perform_role_harness_sequence()`
(`quest_runner.py`) from three sources:

```
message_body = "{runtime_context}\n\nTask:\n{task_instruction}"
message      = first round  -> "{role_prompt}\n\n---\n\n{message_body}"
               later rounds -> message_body
```

- **Role prompt** — `build_role_prompt()` reads `roles/<role>.md`. Sent only on
  the first round of a thread (`round_count == 0`).
- **Runtime context** — `build_runtime_context()` emits, every round:
  - a `Quest Runtime Context` block of labeled facts: quest id, quest
    directory, role, current slice, current slice directory, current project
    docs directory, quest runner reference directory;
  - an optional experiment block (`Experiment: <id>`, "pass `--experiment-id`")
    when running under an experiment;
  - a fixed instruction to use `specs/` and the reference directory;
  - `_issue_workflow_cli_summary()` — the issue-CLI help, which currently names
    the removed `--scope physicalplan` / `--scope polishing --slice <n>` flags
    and lists the four issue/response files not to edit directly.
- **Task** — `build_task_instruction()` (moves to state `run.task`) plus
  `reviewer_commit_context()` (dropped; see `02`/`03`).

## Which parts are generic vs workflow data

- **Message assembly** (ordering, first-round-only role prompt, every-round
  runtime context + task) is generic runner behavior. It stays in the runner.
- **Runtime facts** (paths, profile name, experiment id) are facts the runner
  knows for any workflow. The runner exposes them as interpolation variables.
- **All narrative text** — the field labels, the "use `specs/`" line, the
  issue-CLI guidance, the do-not-edit list — is workflow-specific and becomes
  workflow data. The current `build_runtime_context()` formatting (with labels
  like "Current slice") must not survive as runner code.
- **Role/profile prompt** (`workflow/prompts/<profile>.md`) and **task text**
  (`run.task`) are already specified as workflow data in `03`/`05`.

## Design

### Runner-exposed preamble variables

The runner exposes a fixed, generic set of interpolation variables for use in
the preamble template, profile prompts, and `run.task` text. These extend the
interpolation set in `05_workflow_yaml_grammar.md`:

- Paths (already defined): `$quest`, `$project`, `$machine`, `$active_child`.
- Identity: `{quest_type}`, `{quest_number}`, `{quest_slug}`, `{quest_name}`,
  `{profile}` (the executing profile name — replaces the old `Role:` field),
  `{active_slice}` (active child id, empty when none).
- Optional facts, exposed only when enabled by the profile's
  `runtime_context` toggles (see below): `$log_dir` (this quest's `logs/`),
  `$thread_registry` (path to `thread_registry.json`), `$reference_docs` (the
  packaged quest-runner reference directory — today's "Quest runner reference
  directory").
- `{experiment_guidance}` — a runner-rendered block: the experiment id plus the
  "pass `--experiment-id`" instruction when running under an experiment,
  otherwise the empty string. Rendering it in the runner (rather than as a
  template conditional) keeps the workflow language free of branching; see
  "Deliberate non-additions" below.

A variable referenced by a template but not exposed (e.g. `$log_dir` without
the enabling toggle) is a workflow validation error, not a silent blank.

### Profile `runtime_context` toggles

The `runtime_context` block already shown on profiles in `03`/`05` gates which
optional variables above are exposed to that profile's preamble:

```yaml
runtime_context:
  include_thread_registry_path: true   # exposes $thread_registry
  include_log_directory: true          # exposes $log_dir
  include_current_child_path: true     # exposes $active_child in the preamble
```

Cheap identity variables and `$quest`/`$project`/`$machine` are always exposed.
The toggles exist so reviewer-style profiles can be handed the log/registry
locations without exposing them to every profile.

### Workflow preamble template

The workflow owns a single shared preamble template, `workflow/preamble.md`,
declared in `workflow.yaml`:

```yaml
preamble: preamble.md
```

It is interpolated with the variables above and assembled by the runner as:

```
[first round only]  {profile prompt: workflow/prompts/<profile>.md}
                    \n\n---\n\n
[every round]       {interpolated workflow/preamble.md}
                    \n\nTask:\n
                    {interpolated run.task}
```

This preserves the current structure exactly: profile prompt on the first round
only, preamble + task on every round. The preamble is shared across profiles
(as `_issue_workflow_cli_summary()` is today); per-profile wording lives in the
profile prompt. If `preamble` is omitted, the runner sends only the profile
prompt (first round) and the task — a valid minimal workflow.

Because `preamble.md` is workflow-owned text, it names its own issue files
directly (e.g. `--file physicalplan_issues.md`); no new nested-path
interpolation is required. The runner does not parse or special-case its
contents.

## Deliberate non-additions

To avoid pushing ad-hoc machinery into the workflow language:

- **No template conditionals or loops.** The one conditional in the current
  preamble (the experiment block) is handled by the runner pre-rendering
  `{experiment_guidance}`. If a workflow wants different text when no child is
  active, it phrases it unconditionally or relies on the variable rendering
  empty.
- **No runner-formatted fact block.** The runner exposes variables; it does not
  emit a labeled metadata block of its own. This keeps the workflow-specific
  labels ("Current slice", etc.) out of runner code.
- **No per-state preamble.** The preamble is workflow-global. State-specific
  guidance belongs in `run.task`.

## Compatibility note

The preamble is a prompt, not a durable on-disk artifact. The agent-log JSONL
schema is unchanged — the prompt continues to be recorded via the
`sheaf.prompt` control event — but the **text** of that prompt necessarily
changes in two places, both already accepted elsewhere in this quest:

- the issue-CLI guidance moves from `--scope ...` to `--file ...` (required by
  `04_issue_cli_changes.md`);
- the reviewer commit-hash context is gone (the broken `reviewer_commit_context`
  is dropped per `02`/`03`).

Apart from those, the default `workflow/preamble.md` reproduces the current
runtime-context information (same facts, same "use `specs/`" guidance, same
do-not-edit list, same harness-bug instruction) so agents receive equivalent
context. The preamble is not part of the byte-format compatibility contract in
`07`; matching the *information* is the goal, not matching the bytes.

## Default `workflow/preamble.md`

The default workflow ships this template, reproducing today's runtime context
with the issue-CLI guidance updated to `--file`:

```markdown
Quest Runtime Context
- Quest: {quest_type}/{quest_number}_{quest_slug} ({quest_name})
- Quest directory: $quest
- Profile: {profile}
- Active child directory: $active_child
- Current project docs directory: $project/docs
- Quest runner reference directory: $reference_docs

{experiment_guidance}Use the quest's `specs/` directory as the implementation
specification for this quest. Use the quest runner reference directory above for
internal storage schemas and maintainer workflow rules.

## Issue workflow (CLI)

Use `scripts/quest-runner issues ...` for issue operations. Run
`scripts/quest-runner issues --help` for command details. Pass the issue file
explicitly with `--file <quest-relative path>`.

- List/read: `issues list --file <file>`, `issues read <id> --file <file>`
- Create/edit: `issues create --file <file>`, `issues edit <id> --file <file>`
  (reviewers close with `--status completed`)
- Respond: `issues respond <id> --file <file>` with `--outcome Fixed|NotFixed`
  and `--explanation` (responders only; do not close issues)
- Response history: `issues responses <id> --file <file>`
- Quest-level issues use `--file physicalplan_issues.md`; slice issues use
  `--file $active_child/polishing_issues.md`

If you see something that looks like a bug in the quest harness, open a human
intervention request. Do not work around bugs in the quest harness.

Do not edit `physicalplan_issues.md`, `physicalplan_issue_responses.md`,
`polishing_issues.md`, or `polishing_issue_responses.md` directly unless a human
instructs you or the CLI/API is unavailable.
```

Notes on faithful-but-not-identical wording:

- `Role:` becomes `Profile:` because roles are now profiles; the value is the
  same string for the default workflow.
- `Active child directory` replaces `Current slice` / `Current slice
  directory`; for quest-scoped profiles `$active_child` renders empty. A
  workflow that wants the exact "none (quest-scoped pass)" nicety can write that
  literal in its template, but the runner provides no special empty-rendering.
- The default project docs path is written `$project/docs` to match the current
  `current_project docs directory` derivation.
