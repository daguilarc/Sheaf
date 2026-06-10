# Contract: Quest Runtime Files

This document specifies the on-disk layout of a quest directory and the exact
format of every persistent file the quest runner reads or writes inside it.
It is a shared contract used by multiple capabilities (runner, dashboard,
issue CLI/API, experiments). It contains formats only; behavioral
requirements live in the capability files under `../capabilities/`.

Source of truth: `src/quest_runner_service/quest_fs.py`,
`src/quest_runner_service/quest_thread.py`,
`src/quest_runner_service/quest_runner.py`,
`src/quest_runner_service/harness.py`,
`src/quest_runner_service/experiments.py`,
`src/quest_runner_service/issue_service.py`,
`src/quest_runner_service/state_machine/`.

All timestamps in these formats are UTC ISO-8601 with second precision and a
`Z` suffix: `%Y-%m-%dT%H:%M:%SZ` (e.g. `2026-06-09T21:10:12Z`), produced by
`quest_types.utc_now_iso()`.

## Quest Directory Layout

Canonical quest directories live under:

```text
projects/<project>/quests/<main|side>/<NNNN>_<slug>/
```

`<NNNN>` is the quest number, zero-padded to 4 digits; `<slug>` is the
normalized quest slug. Discovery treats any subdirectory whose name matches
`^\d{4}_` as a quest (or slice) record; the numeric prefix is the identity,
the slug suffix is informational. The same layout and schemas apply
unchanged when the quest is checked out in its quest worktree or an
experiment worktree.

Full tree (entries marked *scaffold* are created at quest creation;
others appear during execution):

```text
<quest_dir>/
  meta.json                      # scaffold: quest identity
  state.md                       # scaffold: quest machine persisted state
  state_history.md               # scaffold: legacy transition log (header only)
  thread_registry.json           # scaffold: {} — role thread metadata
  workflow/                      # scaffold: copy of the packaged default workflow
    workflow.yaml                #   plus machines/, profiles/, prompts/, preamble.md
  specs/                         # scaffold (+ .gitkeep): quest delta specs (human/agent-authored)
  slices/                        # scaffold (+ .gitkeep): child machine collection
    <NNNN>_<slug>/               # created by `slices init` or SliceSetup repair
      physicalplan/              #   plan markdown written by physical_planner
      notes/                     #   free-form implementer notes
      state.md                   #   slice machine persisted state
      state_history.md           #   header-only legacy transition log
      polishing_issues.md        #   reviewer-owned issue list
      polishing_issue_responses.md   # appended by polisher via issue CLI
      implementation_done.md     #   sentinel: implementer finished the plan
      implementation_accepted.md #   sentinel: polisher_reviewer accepted
  physicalplan_issues.md         # scaffold ("# Issues\n"): reviewer-owned issue list
  integration_test_issues.md     # scaffold ("# Issues\n"): tester-owned issue list
  physicalplan_issue_responses.md      # appended via issue CLI
  integration_test_issue_responses.md  # appended via issue CLI
  physicalplan_accepted.md       # sentinel: physical_plan_reviewer accepted
  human_intervention_request.md  # sentinel: blocks automatic progress
  logs/                          # per-harness-round JSONL event logs
    step_NNNN_<profile>.jsonl
    commit_metadata_validation_<ts>.md  # only on metadata validation failure
  experiments/                   # child experiment records (source checkout only)
    <NNNN>/
      experiment.json
      notes.md
      workflow/                  # alternate workflow used by the experiment
      logs/                      # archived after landing
      issues/                    # archived after landing
      issue_responses/           # archived after landing
```

Quest creation (`quest_service.create_quest`) writes, in order: `workflow/`
(copied from the packaged default in
`src/quest_runner_service/default_workflow/`), `state.md` (normalized format,
state `PrePlanning`, `global_step` 0), `state_history.md` (exactly
`"# State Transition History\n\n"`), `meta.json`, `thread_registry.json`
(`{}`), the workflow `scaffold:` actions (`physicalplan_issues.md` and
`integration_test_issues.md`, each exactly `"# Issues\n"`), then `specs/` and
`slices/` each containing an empty `.gitkeep`.

Slice scaffolding (the `slices init` CLI and the slice machine's
`SliceSetup` node run the same workflow collection scaffold) creates inside
`slices/<NNNN>_<slug>/`: the `physicalplan/` directory, `state.md` with
content `"# Slice State\n\nstate: NotStarted\nupdated_at: {now}\n"`,
`state_history.md` with content `"# State Transition History\n\n"`,
`polishing_issues.md` with content `"# Issues\n"`, and the `notes/`
directory. `ensure_file`/`ensure_dir` actions are idempotent: existing files
are never overwritten.

Legacy quests may carry a quest-root `state_execution_config.yaml` instead
of `workflow/` (keys: `version` 1|2, `profiles` mapping with `harness`,
`model`, `reasoning_effort`, `idle_timeout_seconds`, and for version 2
`modify_allow`/`modify_block` glob lists, plus optional `harnesses`
provider-config mapping). The runner still reads it when no
`workflow/workflow.yaml` exists, but never writes it; new quests always get
`workflow/`.

## meta.json

Written once at quest creation by `quest_fs.write_quest_meta`
(`json.dumps(..., indent=2)` plus a trailing newline). Read by every
component that resolves quest identity (`quest_fs.read_quest_meta`).

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `project` | string | yes on write | Owning project name. On read, a missing/blank value is derived from the `projects/<project>/quests/` path segment; if neither is available for a project-local quest, reading fails. |
| `quest_type` | string | yes | `main` or `side`. |
| `quest_number` | integer | yes | Quest number, scoped per project and type. |
| `quest_slug` | string | yes | Normalized slug (directory suffix). |
| `quest_name` | string | yes | Original human-readable name. |
| `created_at` | string | yes | UTC ISO-8601 timestamp. |
| `created_by` | string | no | Creator identifier; key omitted when null. |

Example:

```json
{
  "project": "quest-runner",
  "quest_type": "main",
  "quest_number": 1,
  "quest_slug": "state_machine",
  "quest_name": "State Machine",
  "created_at": "2026-06-09T21:08:55Z"
}
```

## Quest state.md (normalized format)

`<quest_dir>/state.md` holds the persisted state of the top-level quest
machine. The runner writes the normalized format
(`quest_fs.format_normalized_state_md`); the same shape is used for any
machine-level state file. Grammar:

- The first non-empty line must be exactly `# State`.
- The body is `- key: value` bullet lines (blank lines allowed). Allowed
  keys: `global_step`, `machine_name`, `machine_path`, `state`,
  `updated_at`. Required: `machine_name`, `machine_path`, `state`,
  `updated_at`. `global_step` must parse as an integer and is required for
  the top-level quest machine. Duplicate or unknown keys are parse errors;
  any heading before `## Tags` is a parse error.
- A `## Tags` section is required, even when empty. Tags are `- key: value`
  bullet lines; lines starting with `#` inside the section are ignored.

The writer emits keys in this exact order — `global_step` (when set),
`machine_name`, `machine_path`, `state`, `updated_at` — then `## Tags` with
tags sorted by key, and a single trailing newline. `machine_path` is
normalized to a POSIX repo-relative path (no leading `./` or `/`, no `//`).

Example (real file):

```markdown
# State

- global_step: 51
- machine_name: quest
- machine_path: projects/quest-runner/quests/main/0001_state_machine
- state: Completed
- updated_at: 2026-06-10T00:37:31Z

## Tags

- quest_number: 1
- quest_slug: state_machine
- quest_type: main
```

Field meanings:

| Field | Meaning |
| --- | --- |
| `global_step` | Count of committed top-level runner steps. Starts at 0 at creation; incremented by exactly 1 per step commit. No-op steps (no state change and no tree changes) do not increment it. |
| `machine_name` | Workflow machine name; `quest` for the quest root in the default workflow. |
| `machine_path` | Repo-relative path of the directory the machine persists in (the quest directory itself for the root machine). |
| `state` | Persisted state name (see below). |
| `updated_at` | UTC timestamp of the last write. |

The quest-root writer (`WorkflowStateIo._write_quest` /
`quest_fs.write_quest_normalized_machine_state`) always writes the identity
tags `quest_type`, `quest_number`, `quest_slug`, preserves any other tags
from the machine, and writes `active_slice: <child dir name>` (e.g.
`active_slice: 0003_interpreter_actions_conditions_children`) while a slice
is selected; the tag is cleared (omitted) when no slice is active.

Persisted `state` values are defined by the quest's workflow: each machine
state persists under its own name unless it declares `persisted_as`. For the
packaged default workflow the quest machine states are `PrePlanning`,
`PhysicalPlanning`, `ReviewPhysicalPlan`, `PrepareNextSlice`,
`ExecuteSlice`, `IntegrationTesting`, `IntegrationTestPolishing`,
`QuestDocumenting`, `Completed`. In addition, `ExperimentComplete` is a
reserved top-level persisted value (written by the experiment runner when
the stop condition is reached) that round-trips even though no workflow
machine declares it.

### Legacy quest state format (read-only)

Readers (`quest_fs.read_quest_file_state`) also accept the pre-v2 format,
distinguished by its first non-empty line `# Quest State`. It is plain
`key: value` lines (no bullets):

```markdown
# Quest State

state: PrePlanning
current_slice: null
updated_at: 2026-06-09T21:08:55Z
```

Required keys: `state`, `current_slice` (integer or the literal `null`),
`updated_at`. Optional: `active_slice` (slice directory name),
`global_step` (integer). The v2 runner rewrites the file to the normalized
format on its first state write; nothing writes this format for quests
anymore.

## Slice state.md

`<slice_dir>/state.md` keeps the legacy `# Slice State` format (this *is*
the current write format for child machines —
`quest_fs.write_slice_persisted_state`):

```markdown
# Slice State

state: Done
updated_at: 2026-06-09T21:32:55Z
```

First non-empty line must be `# Slice State`; required keys `state` and
`updated_at` as plain `key: value` lines. Default-workflow slice persisted
values: `NotStarted` (logical `SliceSetup`), `Implementing`,
`PolishingReview`, `PolishingFix`, `Done` (logical `Completed`). Child
machines have no `global_step` and no tags.

## state_history.md

Created at quest creation and slice scaffold with the exact content
`"# State Transition History\n\n"`. Entry format
(`quest_fs.append_history` / `read_history`):

```markdown
## 2026-01-15T10:00:00Z

- previous_state: PhysicalPlanning
- next_state: ReviewPhysicalPlan
- commit: 0123abcd...
- thread_name: <thread name or empty>
- notes: <free text, single line>
```

The entry heading must match `^## (\d{4}-\d{2}-\d{2}T\S+)$`; all five bullet
keys are required when an entry exists. **The v2 runner does not append
entries**; step commits (below) are the authoritative execution history, and
these files normally stay header-only. Readers: the dashboard history merge
(`dashboard_data.py`, which prefers commit metadata when both describe the
same commit) and experiment start-step resolution
(`experiments.resolve_start_step`, which falls back to history rows and
extracts `global_step: <n>` and `role: <name>` substrings from `notes`).

## thread_registry.json

`<quest_dir>/thread_registry.json` is a single JSON object mapping a
**registry key** to a thread record. Written with `indent=2` plus a trailing
newline; initialized to `{}` at quest creation. Owner: the runner
(`quest_thread.py`); roles must not edit it (it is a runner-managed path,
see Logs below).

Registry keys are rendered from the profile's
`thread.registry_key_template`. Default workflow: `{profile}` for
quest-scoped roles (e.g. `physical_planner`) and
`slice_{child_number}_{profile}` for child-scoped roles with the child
number unpadded (e.g. `slice_3_polisher`).

Record fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `thread_name` | string | Rendered from `thread.name_template`, e.g. `{repo}_quest_{quest_number:04d}_{profile}` or `{repo}_quest_{quest_number:04d}_slice_{child_number:04d}_{profile}`. `{repo}` is the basename of the executing checkout — for worktree execution that is the quest worktree name, giving names like `quest-runner_main_0001_state_machine_quest_0001_slice_0003_polisher`. |
| `harness_kind` | string | `codex`, `cursor`, or `claude_code`. |
| `provider_thread_id` | string | Provider-native session/thread id. Updated in place if a later send reports a different id. |
| `pass_id` | integer | Always written `0` (reserved). |
| `round_count` | integer | Number of completed harness sends on this thread; incremented after each send. Round 0 means the thread was created but never completed a send; the first message to a thread is prefixed with the role prompt. Missing or non-integer values read as 0. |
| `created_at` | string | UTC timestamp when the record was created. |
| `last_used_at` | string | UTC timestamp; refreshed when a thread is resolved and after each send. |

Example record:

```json
{
  "physical_planner": {
    "thread_name": "quest-runner_main_0001_state_machine_quest_0001_physical_planner",
    "harness_kind": "codex",
    "provider_thread_id": "019eae38-b7f1-7b73-a00e-f3d270359870",
    "pass_id": 0,
    "round_count": 2,
    "created_at": "2026-06-09T21:10:12Z",
    "last_used_at": "2026-06-09T21:25:18Z"
  }
}
```

## Sentinel Files

Sentinels are markdown files whose **existence** drives workflow
transitions; their content is free-form (an acceptance or completion
summary) and is not parsed. The relevant transition conditions also require
the paired issue file to have no open issues.

| Path | Created by | Meaning / removal |
| --- | --- | --- |
| `<quest_dir>/physicalplan_accepted.md` | `physical_plan_reviewer` role | Physical plan accepted. The runner deletes it (transition action `remove_file`) whenever review finds open `physicalplan_issues.md` issues. |
| `<slice_dir>/implementation_done.md` | `implementer` role | Implementer believes the slice plan is complete; gates `Implementing → PolishingReview`. |
| `<slice_dir>/implementation_accepted.md` | `polisher_reviewer` role | Slice implementation accepted; with no open `polishing_issues.md` issues gates `PolishingReview → Completed`. Deleted by the runner when open polishing issues exist. |
| `<quest_dir>/human_intervention_request.md` | runner (on failures) or any role | Blocks all automatic progress: the runner refuses to start and stops after the in-flight harness round when the file exists. A human deletes it to resume. |

The human-intervention filename is configurable per workflow
(`special.human_intervention_file`, default
`human_intervention_request.md`). When the runner writes it
(`quest_runner._write_human_intervention`) the content is:

```markdown
# Human intervention requested

**Reason:** <reason>

<detail>
```

Runner-written reasons include `harness retries exhausted`,
`illegal edits reverted`, `commit metadata validation failed`,
`v2 git staging failed`, `v2 commit staging empty`, and
`v2 git commit failed`.

## logs/step_NNNN_<profile>.jsonl

One file per **harness round** (one CLI send to one role), named
`step_<NNNN>_<profile>.jsonl` with `NNNN` zero-padded to 4 digits and
`<profile>` the workflow profile (role) name. The counter is the highest
existing `step_(\d+)_*.jsonl` number plus one
(`quest_runner.next_log_step_number`); it counts harness rounds and is
**independent of `global_step`** (a top-level step can produce zero or
several log files). The file is truncated when the round starts and
appended one event per line.

Every line is one JSON object (keys sorted, UTF-8, non-ASCII preserved)
with this envelope (`HarnessJsonlLogSink`):

| Field | Type | Meaning |
| --- | --- | --- |
| `schema_version` | integer | Always `1`. |
| `timestamp` | string | UTC timestamp the event was written. |
| `sequence` | integer | 1-based line counter within the file. |
| `step` | integer | The log step number (file's `NNNN`). |
| `role` | string | Profile name. |
| `thread` | string | Thread name from the registry. |
| `harness` | string | `codex` / `cursor` / `claude_code`. |
| `provider_thread_id` | string | Provider thread id. |
| `event_kind` | string | Tagged-union discriminator. |

Control events written by the runner (`sheaf.*`), with their extra fields:

- `sheaf.run_started` — `model` (string), `reasoning_effort` (string or
  null), `stream` (always `true`), `thread_key` (registry key), `quest_rel`
  (repo-relative quest dir), `slice_rel` (repo-relative active slice dir or
  null). First event of every round.
- `sheaf.prompt` — `text`: the full message body sent to the harness
  (prompt + preamble + task on round one; body only afterwards).
- `sheaf.run_completed` — `exit_code` (integer or null),
  `elapsed_seconds` (float), `idle_timeout` (bool), `stream_events_count`
  (integer). Written when the CLI process ends, even on failure.
- `sheaf.run_failed` — `reason`: `structured_error` (with `detail`),
  `nonzero_exit` (with `detail`, `exit_code`), or `exception` (with
  `detail`, `attempt`). May appear after `sheaf.run_completed`.
- `sheaf.path_enforcement` — `snapshot` (git SHA the tree was reverted to),
  `reverted_paths` (sorted list of repo-relative paths), `followup_sent`
  (always `true`). Appended after the round by the path-rule enforcer; its
  envelope `thread`/`harness`/`provider_thread_id` are empty strings and
  `sequence` continues from the existing line count.

Provider stdout is captured line-by-line between `sheaf.prompt` and
`sheaf.run_completed`: each JSON line becomes
`{"event_kind": "provider.json", "payload": <parsed value>}` and each
non-JSON line becomes `{"event_kind": "provider.text", "text": "<line>"}`.
The provider payload shapes (per-harness tagged unions) and the UI mapping
are specified in
[Agent Harness Event Schema](../../../../structure/agent-harness-event-schema.md);
this contract intentionally does not duplicate them.

The `logs/` directory also receives
`commit_metadata_validation_<timestamp>.md` (timestamp with `:` replaced by
`-`) when step-commit metadata fails validation; content is
`# Commit metadata validation failed` plus the failure detail. The paired
human-intervention file points at it.

`<quest_rel>/thread_registry.json` and `<quest_rel>/logs/**` are
**runner-managed paths**: they are exempt from the clean-worktree check
before a harness round and from post-round path enforcement.

## Issue Files

Issue files are reviewer-/tester-owned markdown lists, mutated through the
issue CLI/REST API (`issue_service.py`), never edited free-hand by roles.
The workflow declares each file with an owner role and id prefix; default
workflow:

| Path | Owner role | Id prefix |
| --- | --- | --- |
| `<quest_dir>/physicalplan_issues.md` | `physical_plan_reviewer` | `QP` |
| `<slice_dir>/polishing_issues.md` | `polisher_reviewer` | `PL` |
| `<quest_dir>/integration_test_issues.md` | `integration_tester` | `IT` |

Format (written by `quest_fs.write_issues`, full-file rewrite via atomic
temp-file replace):

```markdown
# Issues

## Issue QP-0001

- status: completed
- owner_role: physical_plan_reviewer
- created_at: 2026-06-09T21:23:36Z
- updated_at: 2026-06-09T21:26:13Z
- title: One-line title
- details: First details line
continuation lines, blank lines, and markdown are preserved verbatim
- resolution_notes: none
```

Rules:

- The reader keys on `^## Issue (\S+)$` headings; the `# Issues` title line
  is conventional (scaffold content) but not required for parsing.
- Issue ids are `<prefix>-NNNN`, zero-padded to 4 digits, allocated as
  max existing number + 1.
- `status` is `open` or `completed`. The runner's open-issue checks compare
  `status` case-insensitively after trimming.
- Required fields per issue: `status`, `owner_role`, `created_at`,
  `updated_at`, `title`, `details`. `title` is single-line.
- `details` and `resolution_notes` are multi-line: after a
  `- details:` header, every following line (including blank lines and
  lines starting with `- `) belongs to `details` until a
  `- resolution_notes:` header; `resolution_notes` is always last and runs
  to the end of the issue block. Multi-line values are written with the
  first line on the header line and the rest as raw continuation lines.
- `- resolution_notes: none` (case-insensitive `none`) means no resolution
  note is set.

### Issue response files

For each issue file, the response file path is derived by replacing the
`_issues.md` suffix with `_issue_responses.md` (same directory):
`physicalplan_issue_responses.md`, `polishing_issue_responses.md`,
`integration_test_issue_responses.md`. Responses are recorded by the
responding role (`physical_planner`, `polisher`,
`integration_test_polisher`) through the issue CLI/API; the file is
append-only (`quest_fs.append_issue_response`) and is created with a
`# Issue responses` title on first append.

```markdown
# Issue responses

## Response PL-0001 2026-06-09T21:42:54Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: What was done, possibly
spanning multiple lines.
```

The section heading is `## Response <issue_id> <timestamp>`. `outcome` is
`Fixed` or `NotFixed`. `explanation` is multi-line with the same
continuation convention as `details`. Readers key on the heading regex
`^## Response (\S+) (.+)$` and fall back to the heading issue id if the
`issue_id` bullet is missing.

## Step Commit Metadata

Not a file in the quest directory, but the authoritative execution history
that `global_step` refers to. Each committed top-level v2 step produces one
git commit whose message is (`state_machine/commit_metadata.py`):

```text
quest-step: <global_step>
state-machine-path: <quest machine_path>
node: <node_name>
state-before: <state>
state-after: <state>

recursive-snapshot-json:
{
  "global_step": <int>,
  "snapshot": { ...recursive snapshot... }
}
```

The snapshot object has required keys `machine_path`, `machine_name`,
`node_name`, `state_before`, `state_after`, `tags` (string→string),
`child` (nested snapshot or null), and optional `role` / `thread_name` on
agent-backed nodes; the JSON is pretty-printed (`indent=2`, sorted keys).
Headers must match the JSON exactly; the runner validates the rendered
message round-trips before committing, and on failure writes the
`logs/commit_metadata_validation_*.md` log plus
`human_intervention_request.md` instead of committing. No-op steps (no
state change, no tree changes) produce no commit and do not increment
`global_step`.

## experiments/<NNNN>/

Experiments are child records of a quest, stored on the **source checkout**
(never inside the experiment worktree). The directory name is the
experiment number zero-padded to 4 digits (`0000`, `0001`, …); only
`^\d{4}$` directories are recognized.

Created together (committed as `experiment-create: ...`):

- `experiment.json` — metadata (below).
- `notes.md` — `# Experiment Notes`, the description, then
  `Start step: <n> (<role|unknown role>)` and
  `Stop condition: <node_name> (<machine_path>)` lines.
- `workflow/` — a full copy of the validated alternate workflow directory
  the experiment runs with (same layout as a quest `workflow/`).

### experiment.json

Written by `experiments.write_experiment_meta` (`indent=2` + newline).

| Field | Type | Meaning |
| --- | --- | --- |
| `experiment_id` | string | `experiment_<project>_<type>_<questNumber>_<experimentNumber>` (numbers unpadded). Also the worktree basename. |
| `experiment_number` | integer | Number within the quest (directory name, unpadded). |
| `project`, `quest_type`, `quest_number`, `quest_slug` | string/int | Parent quest identity; must match the quest the record sits under. |
| `description` | string | Operator-supplied notes (trimmed). |
| `start_step` | object | `global_step` (int), `step_commit` (SHA of that step's commit), `base_commit` (SHA, always `step_commit^`), optional `role` (string), optional `step_log` (quest-relative `logs/step_NNNN_<role>.jsonl`, present only when that file exists). Optional keys are omitted when null. |
| `stop_condition` | object | `machine_path` (normalized: `root/quest`, `root/slice`, or a repo-relative machine path) and `node_name` (resolved workflow state/node name). |
| `worktree_name` | string | Equals `experiment_id`. Worktree lives at `<repo-parent>/.quest-worktrees/<worktree_name>/`. |
| `branch_name` | string | `experiment/<project>/<type>/<questNumber:04d>/<experimentNumber:04d>`. |
| `status` | string | One of `created`, `open`, `experiment_complete`, `landed`, `failed`. Creation writes `open`; a missing `status` key reads as `created`. |
| `created_at` | string | UTC timestamp. |
| `created_by` | string | Optional; omitted when null. |
| `completed_at` | string | Optional; set when status becomes `experiment_complete`. |
| `landed_at` | string | Optional; set when landed. |
| `remote_branch` | string | Optional; set when the branch is pushed during landing. |

Status meanings: `created` — metadata exists, worktree may not;
`open` — worktree exists and is runnable; `experiment_complete` — stop
condition reached (source metadata committed as `experiment-complete: ...`);
`landed` — artifacts archived and local worktree removed (committed as
`experiment-land: ...`); `failed` — terminal failure.

Inside the experiment worktree, the quest directory keeps the normal layout
and schemas; when the stop condition is reached the worktree quest
`state.md` is rewritten with persisted state `ExperimentComplete`
(committed as `experiment-complete-state: <experiment_id>`).

### Archived artifacts (after landing)

`experiments.archive_experiment_artifacts` copies from the experiment
worktree quest dir into the source experiment dir:

- `logs/` — every `logs/*.jsonl` file, same names.
- `issues/` and `issue_responses/` — every workflow-declared issue file and
  its derived response file. Quest-root files are archived under a `quest/`
  prefix (e.g. `issues/quest/physicalplan_issues.md`); child files keep
  their quest-relative path (e.g.
  `issues/slices/0001_foo/polishing_issues.md`,
  `issue_responses/slices/0001_foo/polishing_issue_responses.md`). Missing
  issue files are skipped.

## workflow/ Directory

`<quest_dir>/workflow/` is configuration, not runtime state, but it lives in
the quest directory and the runner reads it on every step. It always
contains `workflow.yaml` (with a required integer `version`, 1 or 2) and the
files it references — `machines/*.yaml`, `profiles/*.yaml`, `prompts/*.md`,
and `preamble.md`. It is written only at quest creation (copy of the
packaged default workflow), by workflow upgrade tooling, and by experiment
creation (replaced wholesale with the experiment's alternate workflow). The
workflow YAML grammar — machines, transitions, conditions, profiles with
`modify.allow`/`modify.block` path rules and `thread` templates, issue
declarations, scaffold actions — is a separate contract; this document only
fixes where the directory sits and that `workflow/workflow.yaml` is the
marker distinguishing workflow quests from legacy
`state_execution_config.yaml` quests.
