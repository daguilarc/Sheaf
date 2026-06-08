# Runtime Files

Quest Runner stores quest progress as files in each project-local quest
directory. The runner, dashboard, and role prompts use these files as the source
of truth; there is no persistent quest database.

Canonical quest directories live under:

```text
projects/<project>/quests/<main|side>/<number>_<slug>/
```

The same schemas apply when a quest is executed from its deterministic worktree.

## Quest State

Path:

```text
<quest_dir>/state.md
```

New quest scaffolds can start with the legacy `# Quest State` key/value format.
After a v2 runner step commits, the runner rewrites quest-root state to the
normalized `# State` format with:

- `global_step`
- `machine_name: quest`
- `machine_path`
- `state`
- `updated_at`
- a required `## Tags` section

The runner writes `quest_type`, `quest_number`, and `quest_slug` tags. During
`ExecuteSlice`, it also writes `active_slice`.

Supported persisted quest states:

- `PrePlanning`
- `PhysicalPlanning`
- `ReviewPhysicalPlan`
- `ExecuteSlice`
- `QuestDocumenting`
- `Completed`

`PrepareNextSlice` is an internal logical state and is not persisted as a
quest-root filesystem state.

## Slice State

Path:

```text
<slice_dir>/state.md
```

Slice state remains in the legacy `# Slice State` key/value format:

```text
state: NotStarted|Implementing|PolishingReview|PolishingFix|Done
updated_at: <ISO-8601 UTC timestamp>
```

The recursive slice machine can use internal logical nodes such as `SliceSetup`
and `Completed`, but those nodes map onto the persisted slice states rather than
changing the file schema.

New slice scaffolds are initialized through `scripts/quest-runner slices init`.
The initializer creates `physicalplan/`, writes `state.md` as `NotStarted`, and
creates empty `state_history.md` and `polishing_issues.md` files. The physical
planner owns the plan markdown files under `physicalplan/`.

## Step Commit Metadata

Each successful top-level v2 runner step creates one git commit when filesystem
changes exist. The commit message includes:

- `quest-step`
- `state-machine-path`
- `node`
- `state-before`
- `state-after`
- a pretty-printed `recursive-snapshot-json` payload

The JSON payload recursively describes the root quest machine and any child
slice machine executed during the step. Agent-backed nodes include role and
thread information.

If commit metadata validation fails, the runner writes a validation log under
`<quest_dir>/logs/`, creates `human_intervention_request.md`, and does not
commit the invalid step. No-op top-level steps skip commits and do not increment
`global_step`.

Dashboard history readers combine step commit metadata with any legacy
`state_history.md` rows and prefer commit metadata when both sources describe
the same commit.

## State History

Paths:

```text
<quest_dir>/state_history.md
<slice_dir>/state_history.md
```

Quest and slice scaffolding still creates state history files for compatibility.
The canonical v2 runner does not append new top-level transition rows for step
history; step commits are the current authoritative source for v2 execution
history.

## Issue Files

Paths:

```text
<quest_dir>/physicalplan_issues.md
<slice_dir>/polishing_issues.md
```

These files are the internal storage format. Agents normally use
`scripts/quest-runner issues ...` or the issue REST APIs instead of editing the
markdown directly.

Issue entries use `open` or `completed` status. Reviewer roles own completion:

- `physical_plan_reviewer` owns physical-plan issue completion.
- `polisher_reviewer` owns polishing issue completion.

`resolution_notes: none` means no resolution note is set.

## Issue Response Files

Paths:

```text
<quest_dir>/physicalplan_issue_responses.md
<slice_dir>/polishing_issue_responses.md
```

Issue response files record how open reviewer issues were handled. They are
separate from reviewer-owned issue lists. Responders append through
`scripts/quest-runner issues respond`; reviewers read responses with
`scripts/quest-runner issues responses`.

Write authority:

- `physical_planner` records physical-plan issue responses through the CLI/API.
- `polisher` records polishing issue responses for the current slice through the
  CLI/API.

Reviewers read responses when verifying open issues, but reviewers do not
record responses themselves.

## Thread Registry

Path:

```text
<quest_dir>/thread_registry.json
```

The registry stores role thread metadata such as thread name, harness kind,
provider thread id, pass id, round count, creation time, and last-used time.

Quest-scoped v2 role threads use:

```text
<repo>_quest_<quest_number:04d>_<role>
```

Slice-scoped v2 role threads use:

```text
<repo>_quest_<quest_number:04d>_slice_<slice_number:04d>_<role>
```

Older records may still use slug-based legacy thread names; readers retain
compatibility with those records.

## Execution Config

Path:

```text
<quest_dir>/state_execution_config.yaml
```

The config selects harness profiles for roles and can enable path-rule
enforcement. Allowed harness values are:

- `codex`
- `cursor`
- `claude_code`

Version `2` configs support per-profile `modify_allow` and `modify_block` glob
lists. Both lists can use `$currentQuest`, `$currentSlice`, and
`$currentProject` placeholders. When both lists match a path, allow wins.

The runner refuses to invoke a harness when the target repository working tree
is not fully clean, including untracked files. After each harness turn, it
reverts changes outside the role's allowed paths, records the reverts in the
step log, and sends a follow-up in the same thread telling the role to continue
within its allowed paths.

Version `1` configs keep legacy behavior with no path-rule enforcement.

## Blocking And Acceptance Markers

`human_intervention_request.md` at the quest root blocks automatic progress
until a human resolves the condition.

Completion and acceptance markers:

| Path | Purpose |
| --- | --- |
| `<slice_dir>/implementation_done.md` | Implementer believes the current slice plan is complete. |
| `<quest_dir>/physicalplan_accepted.md` | Physical-plan reviewer accepts the quest plan and no physical-plan issues remain open. |
| `<slice_dir>/implementation_accepted.md` | Polisher reviewer accepts the slice implementation and no polishing issues remain open. |

The recursive state machine advances only when the relevant marker exists and
the corresponding issue file has no open entries.
