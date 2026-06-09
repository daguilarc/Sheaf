# Quest roles

Quest Runner executes quests through six harness-backed roles. Each role has a
prompt template under `src/quest_runner_service/roles/`, a profile in the
quest's `state_execution_config.yaml`, and a deterministic thread identity in
`thread_registry.json`.

Runtime workflow rules for harness prompts live in
`src/quest_runner_service/quest_docs/workflow.md`. This document is the
human-facing reference for role behavior, routing, and file ownership.

## Role catalog

| Role | Scope | Quest state | Slice state | Prompt template |
| --- | --- | --- | --- | --- |
| `physical_planner` | quest | `PhysicalPlanning` | — | [physical_planner.md](../../src/quest_runner_service/roles/physical_planner.md) |
| `physical_plan_reviewer` | quest | `ReviewPhysicalPlan` | — | [physical_plan_reviewer.md](../../src/quest_runner_service/roles/physical_plan_reviewer.md) |
| `implementer` | slice | `ExecuteSlice` | `Implementing` | [implementer.md](../../src/quest_runner_service/roles/implementer.md) |
| `polisher_reviewer` | slice | `ExecuteSlice` | `PolishingReview` | [polisher_reviewer.md](../../src/quest_runner_service/roles/polisher_reviewer.md) |
| `polisher` | slice | `ExecuteSlice` | `PolishingFix` | [polisher.md](../../src/quest_runner_service/roles/polisher.md) |
| `documenter` | quest | `QuestDocumenting` | — | [documenter.md](../../src/quest_runner_service/roles/documenter.md) |

New quests copy default harness and path profiles from
`src/quest_runner_service/default_state_execution_config.yaml`. Per-quest
overrides live in `<quest_dir>/state_execution_config.yaml`. See
[Configuration](config.md).

## State routing

The v2 recursive state machine selects the active role from quest and slice
state. Implementation: `state_machine/quest_v2_definitions.py` and
`state_machine/quest_v2_nodes.py`.

```text
PrePlanning          (no harness role; human/spec setup)
PhysicalPlanning     -> physical_planner
ReviewPhysicalPlan   -> physical_plan_reviewer
ExecuteSlice         -> implementer | polisher_reviewer | polisher
QuestDocumenting     -> documenter
Completed            (no harness role)
```

Within `ExecuteSlice`, the slice machine drives role selection:

```text
SliceSetup           (runner scaffolding)
Implementing         -> implementer
PolishingReview      -> polisher_reviewer
PolishingFix         -> polisher
Completed            (slice done; quest machine advances)
```

## Prompt assembly

`quest_thread.build_role_prompt` loads the role template from
`roles/<role>.md` and appends the task instruction for the current step.

The first message in a role thread includes:

1. the full role template
2. runtime context from `quest_thread.build_runtime_context`
3. the current task instruction

Later turns in the same thread include runtime context and the task instruction
only. Thread reuse is keyed by role scope; see thread naming below.

## Experiment context in prompts

When a harness runs inside an experiment worktree, `build_runtime_context`
includes the current `experiment_id` and instructs the agent to pass
`--experiment-id <id>` on every `scripts/quest-runner` call. Agents must not
omit the experiment id; the original quest worktree may no longer exist after the
parent quest was completed and landed.

## Thread naming

V2 quests use deterministic thread names from `quest_thread.build_spec_thread_name`:

| Scope | Pattern |
| --- | --- |
| Quest-scoped | `<repo>_quest_<number:04d>_<role>` |
| Slice-scoped | `<repo>_quest_<number:04d>_slice_<slice:04d>_<role>` |

Slice-scoped roles are `implementer`, `polisher_reviewer`, and `polisher`.
Quest-scoped roles are `physical_planner`, `physical_plan_reviewer`, and
`documenter`.

Records are stored in `<quest_dir>/thread_registry.json`. See
[Runtime files](runtime-files.md).

## Completion markers

Roles signal completion through marker files, not by editing quest state
directly:

| Role | Marker | Path |
| --- | --- | --- |
| `implementer` | `implementation_done.md` | `<slice_dir>/` |
| `physical_plan_reviewer` | `physicalplan_accepted.md` | `<quest_dir>/` |
| `polisher_reviewer` | `implementation_accepted.md` | `<slice_dir>/` |

The runner prompts reviewers to create acceptance markers only when their issue
list has no open entries. The runner prompts the implementer to create
`implementation_done.md` when the slice plan appears complete.

## Issue workflow (CLI)

Agents normally work with issues through the CLI, not by editing markdown issue
files directly:

```bash
scripts/quest-runner issues list/read/create/edit/respond/responses
```

- Responders record notes with `issues respond --outcome Fixed|NotFixed`.
- Reviewers close resolved issues with `issues edit --status completed`.
- Responders must not close issues.
- Direct edits to issue files are allowed only when a human instructs it or the
  CLI/API is unavailable.

Reviewer roles own issue lists. Responder roles record responses but do not mark
issues `completed`.

| Role | Issue CLI actions | Must not |
| --- | --- | --- |
| `physical_planner` | `issues respond` for physical-plan issues | create/close issues |
| `physical_plan_reviewer` | `issues create/edit` for physical-plan issues | `issues respond` |
| `implementer` | — | issue mutation |
| `polisher_reviewer` | `issues create/edit` for polishing issues | `issues respond` |
| `polisher` | `issues respond` for polishing issues | create/close issues |
| `documenter` | — | issue mutation |

Internal storage schemas remain in
`src/quest_runner_service/quest_docs/schemas/` for maintainers.

Any role may create or update `human_intervention_request.md` at the quest root
when blocked. That file stops automatic progress until a human resolves it.

## Documenter role

The documenter runs in `QuestDocumenting` after slice implementation and
polishing are complete. Its job is to integrate quest outcomes into the target
project's human-facing documentation.

### Write scope

The documenter may modify only the current project's docs directory shown in
runtime context, normally:

```text
projects/<project>/docs/
```

Path enforcement uses the `documenter` profile in
`state_execution_config.yaml`. The default template allows
`$currentProject/docs/**` and blocks all other paths.

### Documentation rules

The documenter must follow repository documentation structure in
[Docs structure](../../../../structure/docs-structure.md):

- Document current behavior only; do not use docs as a backlog.
- Use Diataxis categories: tutorials, how-to, reference, explanation.
- Keep repository-wide rules in `structure/`; keep project docs under
  `projects/<project>/docs/`.
- Prefer updating existing canonical docs over creating overlapping pages.
- Link to canonical reference docs instead of duplicating facts.
- Do not frame docs as quest history or changelogs unless explicitly requested.

Before writing, the documenter should read the project `docs/README.md`,
existing docs, relevant source, tests, and config for the surface being
documented.

### What the documenter does not do

- Modify application code, tests, quest specs, issue files, or role templates.
- Edit files under `src/quest_runner_service/quest_docs/` (harness runtime
  reference, not target-project docs).
- Modify quest directories except `human_intervention_request.md` when
  escalation is required.

Prompt template:
[src/quest_runner_service/roles/documenter.md](../../src/quest_runner_service/roles/documenter.md).

## Path enforcement

Version `2` execution configs enforce per-role `modify_allow` and `modify_block`
glob lists after each harness turn. Illegal edits are reverted and the role
receives a follow-up to continue within allowed paths.

Placeholder tokens in `modify_allow` and `modify_block`:

- `$currentQuest` — repo-relative quest directory
- `$currentSlice` — repo-relative active slice directory
- `$currentProject` — repo-relative `projects/<project>` directory

When both allow and block lists are present, an allow match permits the path; a
block match denies it; paths matching neither are permitted. See
[Runtime files](runtime-files.md) and [Configuration](config.md).

## Step logs

Each harness invocation writes structured output under:

```text
<quest_dir>/logs/step_<n>_<role>.jsonl
```

The dashboard agent log API reads these files. Service process logs remain under
`logs/quest-runner/`.

## Related docs

- [Quest lifecycle](../explanation/lifecycle.md)
- [Architecture](../explanation/architecture.md)
- [Runtime files](runtime-files.md)
- [Docs structure](../../../../structure/docs-structure.md)
