# Capability: Quest Lifecycle

Project: `projects/quest-runner`
ID prefix: `ql` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Quest lifecycle is the externally driven phase machinery of a quest: creating
the quest record and its dedicated git worktree, scheduling automated runs,
manually advancing a stopped quest, upgrading legacy quests to the `workflow/`
package format, and landing a finished quest branch onto a target branch. It
also owns the runner's git commit conventions (`quest-create` and `quest-step`
messages) and the human-intervention pause file that halts automation. Its
consumers are human operators and agents using the REST API or the
`scripts/quest-runner` CLI. Endpoint hosting, startup, and CLI URL discovery
are specified in [service-lifecycle](../quest-runner-service-lifecycle/spec.md); quest-directory
file formats are specified in
[runtime files](../../../projects/quest-runner/docs/contracts/runtime-files.md).

## Requirements

### Requirement: ql-1 — Quest creation: create quest endpoint
WHEN `POST /create_quest` receives valid `project`, `quest_type`, and `name`, THE service SHALL create `projects/<project>/quests/<quest_type>/<NNNN>_<slug>/` in the source checkout, commit it on the currently checked-out branch, create the quest worktree, and respond `201` with the body in Contracts.

#### Scenario: Valid create_quest request
- **WHEN** `POST /create_quest` receives valid `project`, `quest_type`, and `name`
- **THEN** the service creates `projects/<project>/quests/<quest_type>/<NNNN>_<slug>/` in the source checkout, commits it on the currently checked-out branch, creates the quest worktree, and responds `201` with the body in Contracts

### Requirement: ql-2 — Quest creation: quest number assignment
THE service SHALL assign `quest_number` as one greater than the highest existing quest number for that project and quest type, or `0` when none exist; `NNNN` is the number zero-padded to 4 digits.

#### Scenario: Quest number when quests exist
- **WHEN** existing quests are present for that project and quest type
- **THEN** `quest_number` is assigned as one greater than the highest existing quest number and `NNNN` is the number zero-padded to 4 digits

#### Scenario: Quest number when no quests exist
- **WHEN** no existing quests are present for that project and quest type
- **THEN** `quest_number` is assigned `0` and `NNNN` is `0000`

### Requirement: ql-3 — Quest creation: slug derivation
THE service SHALL derive the quest slug from `slug` (or from `name` when `slug` is absent) by lowercasing, replacing whitespace and hyphen runs with `_`, deleting characters outside `[a-z0-9_]`, collapsing `_` runs, and trimming leading/trailing `_`. IF the result is empty, THEN THE service SHALL respond `400`.

#### Scenario: Slug provided
- **WHEN** `slug` is provided in the request
- **THEN** the service derives the quest slug from `slug` by lowercasing, replacing whitespace and hyphen runs with `_`, deleting characters outside `[a-z0-9_]`, collapsing `_` runs, and trimming leading/trailing `_`

#### Scenario: Slug absent, name used
- **WHEN** `slug` is absent
- **THEN** the service derives the quest slug from `name` by the same transformation

#### Scenario: Derived slug is empty
- **WHEN** the derived slug is empty
- **THEN** the service responds `400`

### Requirement: ql-4 — Quest creation: directory contents
THE created quest directory SHALL contain: a `workflow/` directory copied from the packaged default workflow ([workflow-config](../quest-runner-workflow-config/spec.md)), `state.md` in the workflow entry state `PrePlanning` with `global_step` 0, an empty `state_history.md`, `meta.json`, an empty `thread_registry.json`, `specs/.gitkeep`, `slices/.gitkeep`, and any files declared by the workflow's scaffold actions. File formats: [runtime files](../../../projects/quest-runner/docs/contracts/runtime-files.md).

#### Scenario: Quest directory created
- **WHEN** a quest directory is created
- **THEN** it contains a `workflow/` directory copied from the packaged default workflow, `state.md` in `PrePlanning` with `global_step` 0, an empty `state_history.md`, `meta.json`, an empty `thread_registry.json`, `specs/.gitkeep`, `slices/.gitkeep`, and any files declared by the workflow's scaffold actions

### Requirement: ql-5 — Quest creation: quest-create commit
THE quest-create commit SHALL contain only the new quest directory and use the message `quest-create: <project>/<quest_type>/<NNNN>_<slug>`. WHEN no git identity is set in the environment, THE service SHALL commit as `quest-runner <quest-runner@local>`.

#### Scenario: Quest-create commit message
- **WHEN** the quest-create commit is created
- **THEN** it contains only the new quest directory and uses the message `quest-create: <project>/<quest_type>/<NNNN>_<slug>`

#### Scenario: No git identity set
- **WHEN** no git identity is set in the environment
- **THEN** the service commits as `quest-runner <quest-runner@local>`

### Requirement: ql-6 — Quest creation: worktree location
THE quest worktree SHALL be created at `<source-repo-parent>/.quest-worktrees/<project>_<quest_type>_<NNNN>_<slug>` on a new branch `quest/<project>_<quest_type>_<NNNN>_<slug>` starting at the quest-create commit.

#### Scenario: Quest worktree created
- **WHEN** a new quest is created
- **THEN** the quest worktree is at `<source-repo-parent>/.quest-worktrees/<project>_<quest_type>_<NNNN>_<slug>` on a new branch `quest/<project>_<quest_type>_<NNNN>_<slug>` starting at the quest-create commit

### Requirement: ql-7 — Quest creation: dirty or detached HEAD guard
IF the source checkout has uncommitted changes or is in detached HEAD, THEN THE service SHALL respond `400` and create nothing.

#### Scenario: Uncommitted changes or detached HEAD
- **WHEN** the source checkout has uncommitted changes or is in detached HEAD
- **THEN** the service responds `400` and creates nothing

### Requirement: ql-8 — Quest creation: invalid project guard
IF `project` does not match `^[A-Za-z0-9][A-Za-z0-9_-]*$` or `projects/<project>/` does not exist, THEN THE service SHALL respond `400`.

#### Scenario: Invalid project name or missing project directory
- **WHEN** `project` does not match `^[A-Za-z0-9][A-Za-z0-9_-]*$` or `projects/<project>/` does not exist
- **THEN** the service responds `400`

### Requirement: ql-9 — Quest creation: invalid quest_type or blank name guard
IF `quest_type` is not `main` or `side`, or `name` is blank, THEN THE service SHALL respond `400`.

#### Scenario: Invalid quest_type or blank name
- **WHEN** `quest_type` is not `main` or `side`, or `name` is blank
- **THEN** the service responds `400`

### Requirement: ql-10 — Quest creation: missing required fields guard
IF a lifecycle endpoint request body omits required fields, THEN THE service SHALL respond `400` with `{"error": "Missing required fields: [...]"}` (applies to all endpoints in this capability).

#### Scenario: Required fields omitted
- **WHEN** a lifecycle endpoint request body omits required fields
- **THEN** the service responds `400` with `{"error": "Missing required fields: [...]"}`

### Requirement: ql-11 — Quest creation: scaffold failure cleanup
IF scaffolding fails before the quest-create commit, THEN THE service SHALL remove the partially created quest directory and leave no commit. IF worktree creation fails after the commit, THEN THE service SHALL remove the partial worktree and respond `500` naming the surviving quest-create commit so an operator can clean up.

#### Scenario: Scaffold fails before commit
- **WHEN** scaffolding fails before the quest-create commit
- **THEN** the service removes the partially created quest directory and leaves no commit

#### Scenario: Worktree creation fails after commit
- **WHEN** worktree creation fails after the commit
- **THEN** the service removes the partial worktree and responds `500` naming the surviving quest-create commit

### Requirement: ql-12 — Run scheduling: async response
WHEN `POST /run_quest` is accepted, THE service SHALL start the run on a background thread and immediately respond `202` with `run_id`, `status`, `quest_url` (dashboard link), and `status_url` (run-status API link).

#### Scenario: run_quest accepted
- **WHEN** `POST /run_quest` is accepted
- **THEN** the service starts the run on a background thread and immediately responds `202` with `run_id`, `status`, `quest_url`, and `status_url`

### Requirement: ql-13 — Run scheduling: max_steps
WHERE `max_steps` is omitted, THE run SHALL execute at most 500 top-level steps. IF `max_steps` is present and not a positive integer, THEN THE service SHALL respond `400`.

#### Scenario: max_steps omitted
- **WHEN** `max_steps` is omitted
- **THEN** the run executes at most 500 top-level steps

#### Scenario: max_steps invalid
- **WHEN** `max_steps` is present and not a positive integer
- **THEN** the service responds `400`

### Requirement: ql-14 — Run scheduling: run loop termination conditions
THE run loop SHALL execute top-level workflow steps ([state-machine-engine](../quest-runner-state-machine-engine/spec.md)) until one of: the workflow reaches a terminal state (`completed`), a human-intervention file appears (`human_intervention`), a workflow stop node fires (the node's stop status), the workspace is found dirty before a harness send (`dirty_workspace`), or the step budget is exhausted (`max_steps`).

#### Scenario: Terminal state reached
- **WHEN** the workflow reaches a terminal state
- **THEN** the run loop stops with `completed`

#### Scenario: Human-intervention file appears
- **WHEN** a human-intervention file appears
- **THEN** the run loop stops with `human_intervention`

#### Scenario: Workflow stop node fires
- **WHEN** a workflow stop node fires
- **THEN** the run loop stops with the node's stop status

#### Scenario: Dirty workspace before harness send
- **WHEN** the workspace is found dirty before a harness send
- **THEN** the run loop stops with `dirty_workspace`

#### Scenario: Step budget exhausted
- **WHEN** the step budget is exhausted
- **THEN** the run loop stops with `max_steps`

### Requirement: ql-15 — Run scheduling: concurrent run lock
WHILE a run holds a quest checkout's run lock, THE service SHALL reject concurrent `run`, `advance`, and `land` operations on the same checkout with `409` including a `lock_owner` object (`quest_type`, `quest_number`, `request_id`).

#### Scenario: Concurrent operation on locked quest
- **WHEN** a concurrent `run`, `advance`, or `land` operation is attempted on a quest that holds a run lock
- **THEN** the service responds `409` with a `lock_owner` object containing `quest_type`, `quest_number`, and `request_id`

### Requirement: ql-16 — Run scheduling: unparseable state.md
IF the quest's `state.md` cannot be parsed when scheduling a run, THEN THE service SHALL respond `422` and release the run lock.

#### Scenario: state.md unparseable at run scheduling
- **WHEN** the quest's `state.md` cannot be parsed when scheduling a run
- **THEN** the service responds `422` and releases the run lock

### Requirement: ql-17 — Run scheduling: missing worktree guard
IF the quest worktree (or the experiment worktree when `experiment_id` is given) is missing or not a git working tree, THEN run, advance, upgrade, and slice-init SHALL respond `409` with `project`, `quest_type`, `quest_number`, and `expected_worktree`.

#### Scenario: Missing or invalid worktree
- **WHEN** the quest worktree (or the experiment worktree when `experiment_id` is given) is missing or not a git working tree
- **THEN** run, advance, upgrade, and slice-init respond `409` with `project`, `quest_type`, `quest_number`, and `expected_worktree`

### Requirement: ql-18 — Run scheduling: paused status
WHEN `paused_until.md` in the quest directory holds a future timestamp at scheduling time, THE `202` response `status` SHALL be `paused` instead of `running`. The pause file's display semantics belong to [dashboard](../quest-runner-dashboard/spec.md); the run loop itself does not block on it.

#### Scenario: paused_until.md holds a future timestamp
- **WHEN** `paused_until.md` in the quest directory holds a future timestamp at scheduling time
- **THEN** the `202` response `status` is `paused` instead of `running`

### Requirement: ql-19 — Run scheduling: billing/rate-limit deferred re-run
IF a harness send fails with detail `billing_error` or `rate_limit`, THEN THE service SHALL schedule an automatic re-run of the quest 3600 seconds later instead of requesting human intervention.

#### Scenario: Harness send fails with billing_error or rate_limit
- **WHEN** a harness send fails with detail `billing_error` or `rate_limit`
- **THEN** the service schedules an automatic re-run of the quest 3600 seconds later instead of requesting human intervention

### Requirement: ql-20 — Run scheduling: auto-upgrade legacy quests
WHEN run, advance, or slice initialization targets a legacy quest (one with `state_execution_config.yaml` and no `workflow/workflow.yaml`), THE service SHALL upgrade it in place first (same effect as ql-27).

#### Scenario: Legacy quest targeted by run, advance, or slice-init
- **WHEN** run, advance, or slice initialization targets a legacy quest with `state_execution_config.yaml` and no `workflow/workflow.yaml`
- **THEN** the service upgrades it in place first with the same effect as ql-27

### Requirement: ql-21 — Step commit convention: commit message format
WHEN a top-level step changes workflow state, THE runner SHALL create a git commit in the quest checkout whose message is, in order: the header lines `quest-step: <global_step>`, `state-machine-path: <machine_path>`, `node: <node_name>`, `state-before: <state>`, `state-after: <state>`; a blank line; the marker line `recursive-snapshot-json:`; and a multi-line JSON object with keys `global_step` (int) and `snapshot` (recursive object with `machine_path`, `machine_name`, `node_name`, `state_before`, `state_after`, `tags` (string map), `child` (nested snapshot or null), and optional `role` and `thread_name`).

#### Scenario: Top-level step changes workflow state
- **WHEN** a top-level step changes workflow state
- **THEN** the runner creates a git commit with the header lines `quest-step: <global_step>`, `state-machine-path: <machine_path>`, `node: <node_name>`, `state-before: <state>`, `state-after: <state>`, a blank line, the marker line `recursive-snapshot-json:`, and the multi-line JSON object with the specified keys

### Requirement: ql-22 — Step commit convention: header/JSON consistency
THE header values SHALL equal the corresponding fields of the JSON payload's root snapshot and `global_step`; readers (experiments replay, dashboard) reject commits where they disagree.

#### Scenario: Header values match JSON payload
- **WHEN** a step commit is read by experiments replay or dashboard
- **THEN** header values equal the corresponding fields of the JSON payload's root snapshot and `global_step`; commits where they disagree are rejected

### Requirement: ql-23 — Manual advance: single step execution
WHEN `POST /advance_quest` is accepted for a non-terminal quest, THE service SHALL execute exactly one top-level workflow step without invoking any harness, commit it per ql-21, and respond `200` with `status: "advanced"`, `previous_state`, `next_state`, optional `previous_slice_state`/`next_slice_state`/`active_slice`/`commit`, and `message`.

#### Scenario: advance_quest on non-terminal quest
- **WHEN** `POST /advance_quest` is accepted for a non-terminal quest
- **THEN** the service executes exactly one top-level workflow step without invoking any harness, commits it per ql-21, and responds `200` with `status: "advanced"`, `previous_state`, `next_state`, optional `previous_slice_state`/`next_slice_state`/`active_slice`/`commit`, and `message`

### Requirement: ql-24 — Manual advance: already terminal
WHEN the quest is already in a terminal state, THE service SHALL respond `200` with `{"status": "completed", "advanced": false}` and change nothing.

#### Scenario: Quest already in terminal state
- **WHEN** `POST /advance_quest` is called and the quest is already in a terminal state
- **THEN** the service responds `200` with `{"status": "completed", "advanced": false}` and changes nothing

### Requirement: ql-25 — Manual advance: unmet transition predicates
IF the current node's transition predicates are unmet, THEN THE service SHALL respond `422` with `{"error": ..., "reason": ...}` and leave quest state unchanged.

#### Scenario: Transition predicates unmet
- **WHEN** the current node's transition predicates are unmet
- **THEN** the service responds `422` with `{"error": ..., "reason": ...}` and leaves quest state unchanged

### Requirement: ql-26 — Manual advance: human-intervention file guard
IF the quest's human-intervention file exists, THEN `advance_quest` SHALL respond `409` without changing state.

#### Scenario: Human-intervention file exists at advance time
- **WHEN** the quest's human-intervention file exists
- **THEN** `advance_quest` responds `409` without changing state

### Requirement: ql-27 — Legacy upgrade: upgrade_quest endpoint
WHEN `POST /upgrade_quest` targets a writable project-local quest with `state_execution_config.yaml` and no `workflow/workflow.yaml`, THE service SHALL: copy the packaged default workflow into `workflow/`; port legacy per-role overrides (`harness`, `model`, `reasoning_effort`, `idle_timeout_seconds`, `modify_allow`, `modify_block` — renaming the placeholders `$currentQuest`→`$quest`, `$currentSlice`→`$active_child`, `$currentProject`→`$project`) into `workflow/profiles/<role>.yaml`; merge legacy harness configs into the repo-level service harness config, skipping names already defined; delete `state_execution_config.yaml`; rewrite `state.md` to the normalized format; and respond `200` with `status: "upgraded"` and the fields in Contracts.

#### Scenario: Upgrade eligible quest
- **WHEN** `POST /upgrade_quest` targets a writable project-local quest with `state_execution_config.yaml` and no `workflow/workflow.yaml`
- **THEN** the service copies the packaged default workflow into `workflow/`, ports legacy per-role overrides into `workflow/profiles/<role>.yaml`, merges legacy harness configs into the repo-level service harness config, deletes `state_execution_config.yaml`, rewrites `state.md` to the normalized format, and responds `200` with `status: "upgraded"` and the fields in Contracts

### Requirement: ql-28 — Legacy upgrade: already upgraded
WHEN the quest already has `workflow/workflow.yaml`, THE service SHALL respond `200` with `status: "already_upgraded"` and change nothing.

#### Scenario: Quest already has workflow/workflow.yaml
- **WHEN** the quest already has `workflow/workflow.yaml`
- **THEN** the service responds `200` with `status: "already_upgraded"` and changes nothing

### Requirement: ql-29 — Legacy upgrade: invalid upgrade target guard
IF the quest is not project-local or has no `state_execution_config.yaml`, THEN THE service SHALL respond `400`.

#### Scenario: Not project-local or no state_execution_config.yaml
- **WHEN** the quest is not project-local or has no `state_execution_config.yaml`
- **THEN** the service responds `400`

### Requirement: ql-30 — Landing: land endpoint sequence
WHEN `POST /land` is accepted, THE service SHALL, in order: verify the source checkout is clean; check out `target_branch` (default `main`) in the source checkout if not already on it; verify the quest worktree is clean; rebase the quest worktree branch onto `target_branch`; fast-forward-merge the quest branch into `target_branch`; remove the quest worktree; delete the quest branch; and respond `200` with `status: "landed"`, the progress flags, and `target_head` (new HEAD sha).

#### Scenario: Successful land
- **WHEN** `POST /land` is accepted and all steps succeed
- **THEN** the service verifies the source checkout is clean, checks out `target_branch`, verifies the quest worktree is clean, rebases the quest worktree branch onto `target_branch`, fast-forward-merges the quest branch, removes the quest worktree, deletes the quest branch, and responds `200` with `status: "landed"`, the progress flags, and `target_head`

### Requirement: ql-31 — Landing: dirty source checkout guard
IF the source checkout has uncommitted changes (before or after the target-branch checkout), THEN THE service SHALL respond `409` with `status: "target_dirty"` and the `git status --porcelain` output.

#### Scenario: Source checkout dirty
- **WHEN** the source checkout has uncommitted changes before or after the target-branch checkout
- **THEN** the service responds `409` with `status: "target_dirty"` and the `git status --porcelain` output

### Requirement: ql-32 — Landing: invalid target branch guard
IF `target_branch` does not exist, is blank, or the source checkout is in detached HEAD, THEN THE service SHALL respond `400`.

#### Scenario: Invalid target branch or detached HEAD
- **WHEN** `target_branch` does not exist, is blank, or the source checkout is in detached HEAD
- **THEN** the service responds `400`

### Requirement: ql-33 — Landing: dirty quest worktree guard
IF the quest worktree has uncommitted changes, THEN THE service SHALL respond `409` with `status: "worktree_dirty"`, `worktree_path`, and a `next_step` instruction; land may be re-run after cleanup.

#### Scenario: Quest worktree has uncommitted changes
- **WHEN** the quest worktree has uncommitted changes
- **THEN** the service responds `409` with `status: "worktree_dirty"`, `worktree_path`, and a `next_step` instruction

### Requirement: ql-34 — Landing: rebase conflict guard
IF the rebase stops with conflicts, THEN THE service SHALL respond `409` with `status: "rebase_failed"`, `worktree_path`, and `next_step`; the in-progress rebase is left in the worktree for manual resolution, after which land may be re-run.

#### Scenario: Rebase stops with conflicts
- **WHEN** the rebase stops with conflicts
- **THEN** the service responds `409` with `status: "rebase_failed"`, `worktree_path`, and `next_step`; the in-progress rebase is left in the worktree for manual resolution

### Requirement: ql-35 — Landing: post-rebase failure guard
IF the fast-forward merge, worktree removal, or branch deletion fails, THEN THE service SHALL respond `409` with `status` of `fast_forward_failed`, `worktree_delete_failed`, or `branch_delete_failed` respectively, including the progress flags (`rebased`/`fast_forwarded`/`worktree_deleted`) already achieved.

#### Scenario: Fast-forward merge fails
- **WHEN** the fast-forward merge fails
- **THEN** the service responds `409` with `status: "fast_forward_failed"` including the progress flags already achieved

#### Scenario: Worktree removal fails
- **WHEN** worktree removal fails
- **THEN** the service responds `409` with `status: "worktree_delete_failed"` including the progress flags already achieved

#### Scenario: Branch deletion fails
- **WHEN** branch deletion fails
- **THEN** the service responds `409` with `status: "branch_delete_failed"` including the progress flags already achieved

### Requirement: ql-36 — Landing: quest not found or missing worktree
IF the quest does not exist, THEN lifecycle endpoints SHALL respond `404`; IF the quest worktree is missing at land time, THEN `/land` SHALL respond `409` per ql-17.

#### Scenario: Quest does not exist
- **WHEN** the quest does not exist
- **THEN** lifecycle endpoints respond `404`

#### Scenario: Quest worktree missing at land time
- **WHEN** the quest worktree is missing at land time
- **THEN** `/land` responds `409` per ql-17

### Requirement: ql-37 — Human-intervention pause: run loop and advance blocked
WHILE the quest's human-intervention file (the workflow's `special.human_intervention_file`, default `human_intervention_request.md`, in the quest directory) exists, THE run loop SHALL stop with `status: "human_intervention"` before executing any further step, and `advance_quest` SHALL refuse with `409`. Deleting the file re-enables run and advance.

#### Scenario: Human-intervention file exists at run time
- **WHEN** the quest's human-intervention file exists at run time
- **THEN** the run loop stops with `status: "human_intervention"` before executing any further step

#### Scenario: Human-intervention file exists at advance time
- **WHEN** the quest's human-intervention file exists at advance time
- **THEN** `advance_quest` refuses with `409`

#### Scenario: Human-intervention file deleted
- **WHEN** the human-intervention file is deleted
- **THEN** run and advance are re-enabled

### Requirement: ql-38 — Human-intervention pause: runner writes intervention file
WHEN the runner itself requires intervention (harness error event other than billing/rate-limit, harness retries exhausted, illegal role edits reverted, step-commit failure, experiment metadata update failure), THE runner SHALL write the file with the content `# Human intervention requested`, a `**Reason:** <reason>` line, and a detail body.

#### Scenario: Runner requires intervention
- **WHEN** the runner itself requires intervention due to harness error event (other than billing/rate-limit), harness retries exhausted, illegal role edits reverted, step-commit failure, or experiment metadata update failure
- **THEN** the runner writes the intervention file with `# Human intervention requested`, a `**Reason:** <reason>` line, and a detail body

### Requirement: ql-39 — CLI: subcommands
THE CLI (`scripts/quest-runner`) SHALL provide `create`, `run`, `advance`, `upgrade`, and `land` subcommands mapping to the endpoints above with the flags in Contracts, exiting `0` on 2xx, `1` on HTTP error or transport failure, and `2` on local validation failure or unknown command.

#### Scenario: Successful CLI invocation
- **WHEN** a CLI subcommand completes with a 2xx response
- **THEN** the CLI exits `0`

#### Scenario: HTTP error or transport failure
- **WHEN** a CLI subcommand encounters an HTTP error or transport failure
- **THEN** the CLI exits `1`

#### Scenario: Local validation failure or unknown command
- **WHEN** a CLI subcommand encounters a local validation failure or unknown command
- **THEN** the CLI exits `2`

### Requirement: ql-40 — CLI: output format
WHERE `--json` is given, THE CLI SHALL print the raw response JSON (indented, sorted keys); otherwise it SHALL print human-readable `key: value` lines for the fields of each response (omitting absent fields), and `create` SHALL additionally print a `dashboard_url` derived from the base URL when the response lacks one.

#### Scenario: --json flag given
- **WHEN** `--json` is given
- **THEN** the CLI prints the raw response JSON (indented, sorted keys)

#### Scenario: No --json flag
- **WHEN** `--json` is not given
- **THEN** the CLI prints human-readable `key: value` lines for the fields of each response (omitting absent fields), and `create` additionally prints a `dashboard_url` derived from the base URL when the response lacks one

### Requirement: ql-41 — CLI: error output
WHEN a request returns a non-2xx status, THE CLI SHALL print `HTTP <status> <endpoint>` and `error: <message>` to stderr (for `land`, the formatted error body is also printed to stderr in non-JSON mode).

#### Scenario: Non-2xx response
- **WHEN** a request returns a non-2xx status
- **THEN** the CLI prints `HTTP <status> <endpoint>` and `error: <message>` to stderr

#### Scenario: Land non-2xx response in non-JSON mode
- **WHEN** a `land` request returns a non-2xx status and `--json` is not given
- **THEN** the CLI also prints the formatted error body to stderr

### Requirement: ql-42 — CLI: land --experiment-id routing
WHERE `land --experiment-id <id>` is given, THE CLI SHALL post `/experiments/land` instead of `/land` ([experiments](../quest-runner-experiments/spec.md)).

#### Scenario: land with --experiment-id
- **WHEN** `land --experiment-id <id>` is given
- **THEN** the CLI posts `/experiments/land` instead of `/land`

## Contracts

Quest identity fields appear in every request: `project` (string),
`quest_type` (`"main"` | `"side"`), `quest_number` (int, ≥ 0). Error bodies
are `{"error": <message>, ...}` unless noted. Quest-directory file formats
(`meta.json`, `state.md`, `state_history.md`, `thread_registry.json`,
`paused_until.md`, `human_intervention_request.md`, step logs):
[runtime files](../../../projects/quest-runner/docs/contracts/runtime-files.md).

### `POST /create_quest`

Request: `{"project", "quest_type", "name", "slug"?, "requested_by"?}`.
`requested_by` is stored in `meta.json` as `created_by`.

Response `201`:

```json
{
  "project": "example",
  "quest_type": "main",
  "quest_number": 7,
  "quest_slug": "my_quest",
  "quest_dir": "/abs/path/projects/example/quests/main/0007_my_quest",
  "state": "PrePlanning",
  "created_files": ["workflow/workflow.yaml", "state.md", "..."],
  "worktree_name": "example_main_0007_my_quest",
  "worktree_branch": "quest/example_main_0007_my_quest",
  "worktree_path": "/abs/path/.quest-worktrees/example_main_0007_my_quest",
  "quest_create_commit": "<sha>"
}
```

Errors: `400` (ql-3, ql-7..ql-10), `404` repo path missing, `422` source root
not a git repository, `500` (ql-11, with `error` describing the surviving
commit).

### `POST /run_quest`

Request: `{"project", "quest_type", "quest_number", "max_steps"?,
"experiment_id"?}`.

Response `202`:

```json
{
  "run_id": "<uuid>",
  "status": "running",
  "quest_url": "<base>/dashboard?project=...&quest_type=...&quest_number=...",
  "status_url": "<base>/api/dashboard/run_status?project=...&quest_type=...&quest_number=..."
}
```

`status` is `"paused"` when ql-18 applies. With `experiment_id`, the run
executes in the experiment worktree and `status_url` carries
`&experiment_id=...` ([experiments](../quest-runner-experiments/spec.md)). Errors: `400`, `404`,
`409` (ql-15 lock body, ql-17 worktree body), `422` (ql-16). Run outcomes
(`completed`, `human_intervention`, `max_steps`, `dirty_workspace`, stop
statuses, deferred re-run) are observable via the run-status API and step
logs, not this response.

### `POST /advance_quest`

Request: `{"project", "quest_type", "quest_number", "experiment_id"?}`.

Response `200` (advanced):

```json
{
  "project": "...", "quest_type": "...", "quest_number": 7,
  "status": "advanced",
  "previous_state": "Planning",
  "next_state": "PhysicalPlanning",
  "previous_slice_state": "...",
  "next_slice_state": "...",
  "active_slice": "0001_api",
  "commit": "<sha>",
  "message": "Advanced quest main/0007_my_quest"
}
```

Slice fields and `commit` appear only when applicable. Already-complete:
`{"status": "completed", "advanced": false, ...}`. In an experiment, reaching
the stop condition yields `status: "experiment_complete"` with
`workflow_state` ([experiments](../quest-runner-experiments/spec.md)). Errors: `400`, `404`, `409`
(ql-15, ql-17, ql-26), `422` `{"error", "reason"}` (ql-25).

### `POST /upgrade_quest`

Request: `{"project", "quest_type", "quest_number", "experiment_id"?}`.

Response `200` (upgraded):

```json
{
  "status": "upgraded",
  "project": "...", "quest_type": "...", "quest_number": 7,
  "quest_dir": "/abs/.../0007_my_quest",
  "workflow_dir": "/abs/.../0007_my_quest/workflow",
  "copied_workflow_files": ["workflow/workflow.yaml", "..."],
  "deleted_config": "state_execution_config.yaml",
  "ported_profiles": ["workflow/profiles/implementer.yaml"],
  "merged_harnesses": ["..."],
  "skipped_harnesses": ["..."],
  "service_harness_config": "/abs/path/...",
  "normalized_state_rewrite": true,
  "checkout_kind": "worktree",
  "checkout_path": "/abs/path/..."
}
```

Already upgraded: `{"status": "already_upgraded", "quest_dir", "workflow_dir",
...}`. Errors: `400` (ql-29), `404`, `409` (ql-17).

### `POST /land`

Request: `{"project", "quest_type", "quest_number", "target_branch"?}`
(default `"main"`).

Response `200`:

```json
{
  "status": "landed",
  "project": "...", "quest_type": "...", "quest_number": 7,
  "target_branch": "main",
  "worktree_branch": "quest/example_main_0007_my_quest",
  "rebased": true,
  "fast_forwarded": true,
  "worktree_deleted": true,
  "branch_deleted": true,
  "target_head": "<sha>"
}
```

Conflict `409` bodies carry `status` per ql-31/ql-33..ql-35 plus `error`, the
identity/branch fields, and where relevant `status_output`, `worktree_path`,
`next_step`, and achieved progress flags. Other errors: `400` (ql-32), `404`,
`409` worktree missing (ql-36).

### CLI commands

Global flags (before the subcommand): `--base-url <url>`, `--json`. URL
resolution: [service-lifecycle](../quest-runner-service-lifecycle/spec.md). Quest identity flags:
`--project <name>`, `--type main|side`, `--number <n>`; `--experiment-id <id>`
is accepted by `run`, `advance`, `upgrade`, and `land`.

| Command | Endpoint | Extra flags |
| --- | --- | --- |
| `create` | `POST /create_quest` | `--name <text>` (required), `--slug <slug>` |
| `run` | `POST /run_quest` | `--max-steps <n>` |
| `advance` | `POST /advance_quest` | — |
| `upgrade` | `POST /upgrade_quest` | — |
| `land` | `POST /land` (or `/experiments/land` with `--experiment-id`) | `--target-branch <branch>` (default `main`) |
| `help` | — | prints top-level help |

Invoking with no subcommand prints help and exits `0`. `slices` and `issues`
subcommands belong to [slices](../quest-runner-slices/spec.md) and [issues](../quest-runner-issues/spec.md);
`experiments` belongs to [experiments](../quest-runner-experiments/spec.md).

## Design

The API layer (`src/quest_runner_service/api.py`, `create_app`) is a thin
Flask wrapper: it validates field presence, delegates to
`QuestService` (`src/quest_runner_service/quest_service.py`), and maps
exception types to status codes via `@app.errorhandler` registrations —
`InvalidQuestInput`/`InvalidProject` → 400, `RepoNotFound`/`QuestNotFound` →
404, `MissingQuestWorktree`/`QuestLockContention`/`LandQuestConflict`/
`AdvanceQuestConflict` → 409, `NotAGitRepo`/`StateFileParseError`/
`AdvanceQuestValidationError` → 422, `WorktreeCreationError`/
`FatalInvariantError` → 500.

Creation (`QuestService.create_quest`) builds the directory, then calls
`create_quest_scaffold_commit` and `create_quest_worktree` in
`src/quest_runner_service/worktrees.py`. Worktree naming, branch naming, the
`.quest-worktrees` sibling directory, and the `quest-runner@local` fallback
git identity all live there. Failure ordering gives the two-phase cleanup of
ql-11: before the commit everything is deletable; after it, the commit is the
durable record and only the worktree is rolled back.

Runs: `schedule_run_quest` acquires the in-process `QuestLock`
(`src/quest_runner_service/quest_lock.py`) keyed by
`<resolved worktree path>::<project>/<type>/<NNNN>[::<experiment_id>]`, then
spawns a daemon worker thread that registers with `ActiveRunTracker`
(heartbeats every second; consumed by the dashboard run-status API) and
finally releases the lock. The loop itself is
`src/quest_runner_service/quest_runner_v2.py:run_quest_v2`, which executes
`execute_v2_top_level_step`
(`src/quest_runner_service/state_machine/v2_step_executor.py`) up to
`max_steps` times, checking the human-intervention file before and after each
step. Harness dispatch, retry, path-rule enforcement, and the
intervention-file writer `_write_human_intervention` are in
`src/quest_runner_service/quest_runner.py`. Deferred re-runs (ql-19) use the
in-memory `DeferredTaskScheduler` (`deferred_tasks.py`); scheduled tasks do
not survive a service restart.

Step commit messages are rendered and parsed by
`src/quest_runner_service/state_machine/commit_metadata.py`
(`render_step_commit_message`, `parse_step_commit_message`,
`validate_parsed_step_commit`); the header/JSON duplication exists so `git
log --oneline` stays readable while replay tooling gets a full recursive
snapshot. Manual advance reuses the same executor with harness operations
stubbed out (`advance_v2_top_level_step_without_harness`).

Upgrade logic is `src/quest_runner_service/workflow_upgrade.py`
(`upgrade_quest_workflow`, `upgrade_quest_if_needed`); the silent auto-upgrade
on run/advance/slice-init (ql-20) is `QuestService._ensure_quest_workflow_upgraded`.
Landing is `QuestService.land_quest` / `_land_quest_locked`, built on the git
helpers in `worktrees.py` (`rebase_onto`, `merge_ff_only`, `remove_worktree`,
`delete_branch`); it holds the same run lock as runs so a land cannot race an
active run. The CLI (`src/quest_runner_service/cli.py`, entry point
`bin/quest-runner`, dispatcher `scripts/quest-runner`) is purely a REST
client; it never touches quest files or git directly.

Tests: `tests/test_quest_creation.py`, `tests/test_worktrees.py`,
`tests/test_quest_service_api.py`, `tests/test_advance_quest_api.py`,
`tests/test_land_api.py`, `tests/test_commit_metadata.py`,
`tests/test_workflow_upgrade.py`, `tests/test_cli.py`.

## Interactions

- [service-lifecycle](../quest-runner-service-lifecycle/spec.md) — hosts these endpoints; CLI
  base-URL resolution and service startup.
- [state-machine-engine](../quest-runner-state-machine-engine/spec.md) — executes the steps that
  runs and advance trigger; defines stop nodes and terminal states.
- [workflow-config](../quest-runner-workflow-config/spec.md) — packaged default `workflow/`
  copied at creation and upgrade; `special.human_intervention_file`.
- [agent-harness](../quest-runner-agent-harness/spec.md) — harness sends inside run steps; step
  logs; the error details that trigger ql-19/ql-38.
- [slices](../quest-runner-slices/spec.md) — slice initialization shares the missing-worktree and
  auto-upgrade behavior (ql-17, ql-20).
- [experiments](../quest-runner-experiments/spec.md) — experiment-scoped run/advance/land via
  `experiment_id`; replays parse ql-21 commits.
- [dashboard](../quest-runner-dashboard/spec.md) — run-status/overview APIs surface lock state,
  pause state, and intervention state produced here.
- [issues](../quest-runner-issues/spec.md) — issue files referenced by workflow predicates that
  gate advance (ql-25).
- Shared file formats: [runtime files](../../../projects/quest-runner/docs/contracts/runtime-files.md).
