# Capability: Experiments

ID prefix: `exp`

## Purpose

Experiments let an operator replay an existing quest from an earlier recorded
step with an alternate workflow package, in an isolated git branch and
worktree, without disturbing the parent quest. An experiment runs until a
configured stop condition is reached, then its runtime artifacts (step logs,
issue files, issue responses) are archived under the parent quest and its
branch is pushed to the remote for later inspection. Landing an experiment
never merges experiment code into the main line.

## Requirements

### Creation

- **[exp-1]** THE service SHALL accept `POST /experiments/create` and, on
  success, respond `201` with the created experiment's identity, worktree,
  branch, resolved start step, and stop condition (see Contracts).
- **[exp-2]** WHEN creating an experiment, THE service SHALL require the
  source checkout to be a clean git checkout on a named branch; IF it is
  dirty or detached, THEN THE service SHALL reject the request with `400`
  before writing anything.
- **[exp-3]** THE service SHALL resolve `start_step` (a positive global step
  number of the parent quest) to that step's commit, preferring quest step
  commit metadata and falling back to a matching `state_history.md` record;
  the experiment `base_commit` is the parent of the step commit
  (`<step_commit>^`), so the replay re-executes the selected step.
- **[exp-4]** IF `start_step` is less than 1, cannot be resolved to a commit,
  resolves ambiguously (duplicate metadata or history rows), or resolves to a
  root commit with no parent, THEN THE service SHALL reject the request with
  `400`.
- **[exp-5]** THE service SHALL validate that `workflow_path` names a loadable
  workflow directory (relative paths resolve against the source repo root);
  IF the directory is missing or its workflow definition is invalid, THEN THE
  service SHALL reject the request with `400`.
- **[exp-6]** THE service SHALL validate `stop_node` against the workflow
  machine selected by `stop_machine_path` (default `root/slice`), accepting a
  state name or a node class name, case-insensitively, plus the alias
  `slice_completed` for `SliceCompletedNode`; IF the node is unknown for that
  machine, THEN THE service SHALL reject the request with `400`.
- **[exp-7]** WHEN an experiment is created, THE service SHALL write
  `experiments/<NNNN>/` under the parent quest directory on the source
  checkout, containing `experiment.json`, `notes.md` (rendered from `notes`,
  the start step, and the stop condition), and a `workflow/` copy of the
  alternate workflow directory, and SHALL commit it with subject
  `experiment-create: <project>/<type>/<NNNN>/<NNNN>`. See
  [runtime files](../contracts/runtime-files.md) for `experiment.json` fields
  and directory layout.
- **[exp-8]** THE service SHALL number experiments per quest starting at 0
  (`max existing + 1`, four-digit directory names), and SHALL derive the
  experiment id `experiment_<project>_<type>_<questNumber>_<expNumber>`
  (also the worktree directory name) and the branch
  `experiment/<project>/<type>/<questNumber:04d>/<expNumber:04d>`.
- **[exp-9]** WHEN metadata is committed, THE service SHALL create the
  experiment branch and a git worktree at `base_commit` under
  `<source-parent>/.quest-worktrees/<experiment_id>`, and SHALL replace the
  quest-local `workflow/` inside that worktree with the experiment's workflow
  copy.
- **[exp-10]** THE service SHALL create `experiment.json` with
  `status: "open"`. Valid statuses are `created`, `open`,
  `experiment_complete`, `landed`, and `failed`; the service writes `open` →
  `experiment_complete` → `landed` (`created`/`failed` are accepted on read).
- **[exp-11]** IF creation fails before the metadata commit, THEN THE service
  SHALL remove the partial experiment directory, branch, and worktree and
  report the underlying error; IF the metadata commit succeeded but worktree
  creation failed, THEN THE service SHALL respond `500` with
  `metadata_commit`, `branch_name`, `worktree_path`, and `experiment_dir` so
  the operator can clean up or retry.

### Experiment-scoped operations

- **[exp-12]** WHEN `experiment_id` is supplied to a quest-scoped operation
  (`/run_quest`, `/advance_quest`, `/upgrade_quest`, `/api/slices/init`, the
  issue endpoints, and the dashboard quest APIs via the `experiment_id` query
  parameter), THE service SHALL resolve the operation's checkout to the
  experiment worktree, so state, logs, slices, issues, and git inspection all
  read and write inside that worktree.
- **[exp-13]** IF the named experiment does not exist under the quest, THEN
  THE service SHALL respond `404`; IF the experiment metadata's quest
  identity does not match the requested quest, THEN THE service SHALL respond
  `400`.
- **[exp-14]** IF an experiment-scoped operation finds the experiment
  worktree missing or invalid, THEN THE service SHALL respond `404` (the
  service never falls back from an experiment to the source checkout or the
  parent quest worktree).
- **[exp-15]** WHEN `experiment_id` is omitted, THE service SHALL never route
  an operation to an experiment worktree, even when the parent quest worktree
  is missing.
- **[exp-16]** THE service SHALL key run locks on the checkout worktree plus
  the experiment id, so an experiment run and a parent quest run do not
  contend, while two concurrent operations on the same experiment conflict
  with `409`.
- **[exp-17]** WHILE running an experiment, THE agent prompt SHALL include
  experiment guidance naming the experiment id and instructing agents to pass
  `--experiment-id <id>` on every `scripts/quest-runner` call.

### Stop conditions and completion

- **[exp-18]** WHILE a run or advance executes with an experiment scope, THE
  service SHALL evaluate the post-step recursive state snapshot against the
  experiment's stop condition; node matching accepts the stored state name,
  its node class name (case-insensitively), and the `slice_completed` alias.
- **[exp-19]** THE stop `machine_path` SHALL select which snapshot level may
  match: `root/quest` matches only the root machine, `root/slice` (or
  `slice`, the default) matches any child machine, and a concrete machine
  path matches that exact path.
- **[exp-20]** WHEN the stop condition matches, THE service SHALL write the
  workflow state `ExperimentComplete` into the experiment worktree's quest
  `state.md`, commit it on the experiment branch with subject
  `experiment-complete-state: <experiment_id>`, and report status
  `experiment_complete` (run results and `/advance_quest` responses carry
  `workflow_state: "ExperimentComplete"`; an async run's status endpoint
  reports `experiment_complete`).
- **[exp-21]** WHEN an experiment reaches its stop condition, THE service
  SHALL update the source-checkout `experiment.json` to
  `status: "experiment_complete"` with `completed_at` and commit it with
  subject `experiment-complete: <project>/<type>/<NNNN>/<NNNN>`; this update
  is idempotent (an already-complete experiment is not re-committed).
- **[exp-22]** IF the source checkout is dirty when the completion metadata
  update runs, THEN THE service SHALL write a human-intervention request into
  the experiment worktree quest and report status `human_intervention` with
  reason `experiment_metadata_update_failed`, leaving the worktree's
  `ExperimentComplete` state intact for retry.
- **[exp-23]** WHILE the experiment worktree state is `ExperimentComplete`,
  re-running the experiment SHALL return `experiment_complete` without
  executing further steps.

### Landing

- **[exp-24]** THE service SHALL accept `POST /experiments/land` and respond
  `200` with `status: "landed"` and the archive/cleanup summary on success
  (see Contracts). The CLI `land --experiment-id <id>` routes to the same
  endpoint instead of normal quest landing.
- **[exp-25]** WHEN landing, THE service SHALL require, in order: a clean
  source checkout, an existing valid experiment worktree containing the quest
  directory, worktree workflow state `ExperimentComplete`, and metadata
  status `experiment_complete`; IF any check fails, THEN THE service SHALL
  respond `409` with a `status` discriminator (`target_dirty`,
  `worktree_missing`, `quest_dir_missing`, `not_complete`) and an `error`
  message, without modifying anything.
- **[exp-26]** WHEN landing succeeds, THE service SHALL archive from the
  experiment worktree into the source-checkout `experiments/<NNNN>/`
  directory: every `logs/*.jsonl` step log into `logs/`, every
  workflow-declared issue file into `issues/`, and every issue response file
  into `issue_responses/` (quest-level files are nested under a `quest/`
  subdirectory; `$active_child` declarations expand over all slice
  directories; missing optional response files are counted as skipped, not
  errors).
- **[exp-27]** WHEN artifacts are archived, THE service SHALL push the
  experiment branch to `origin`, remove the experiment worktree (forcing
  removal if needed) and delete the local branch, update `experiment.json` to
  `status: "landed"` with `landed_at` and `remote_branch`, and commit the
  archive with subject `experiment-land: <project>/<type>/<NNNN>/<NNNN>`. The
  remote branch is retained; no merge or rebase onto a target branch occurs.
- **[exp-28]** IF artifact copying or the branch push fails, THEN THE service
  SHALL restore the source experiment directory to its pre-land state
  (removing partial `logs/`, `issues/`, `issue_responses/` copies), preserve
  the local worktree and branch, leave the status unchanged, and respond
  `409` with `status` `artifact_copy_failed` or `push_failed` so landing can
  be retried.
- **[exp-29]** IF worktree removal or local branch deletion fails after a
  successful push, THEN THE service SHALL respond `409` with `status`
  `worktree_delete_failed` or `branch_delete_failed` and flags
  `pushed`/`worktree_deleted`/`branch_deleted` reflecting what completed.
- **[exp-30]** IF `experiment_id` is unknown for the quest or its metadata
  identity mismatches, THEN landing SHALL fail with `400`; IF the quest does
  not exist, `404`. Landing takes the experiment's run lock and responds
  `409` on contention.

## Contracts

### `POST /experiments/create`

Request body (all fields required unless noted):

```json
{
  "project": "quest-runner",
  "quest_type": "main",
  "quest_number": 0,
  "start_step": 5,
  "stop_node": "slice_completed",
  "stop_machine_path": "root/slice",
  "notes": "Try a different implementer profile.",
  "workflow_path": "/tmp/experiment-workflow",
  "requested_by": "joyo"
}
```

`stop_machine_path` (default `root/slice`) and `requested_by` are optional.
`quest_number` and `start_step` must be JSON integers; `notes` and
`workflow_path` must be non-empty. Missing fields, non-integer numbers, and
all validation failures ([exp-2]–[exp-6]) return `400 {"error": ...}`.

Response `201`:

```json
{
  "experiment_id": "experiment_quest-runner_main_0_0",
  "experiment_number": 0,
  "project": "quest-runner",
  "quest_type": "main",
  "quest_number": 0,
  "worktree_path": "/abs/.quest-worktrees/experiment_quest-runner_main_0_0",
  "branch_name": "experiment/quest-runner/main/0000/0000",
  "base_commit": "<sha>",
  "start_step": {
    "global_step": 5,
    "role": "implementer",
    "step_log": "logs/step_0005_implementer.jsonl",
    "step_commit": "<sha>",
    "base_commit": "<sha>"
  },
  "stop_condition": {
    "machine_path": "root/slice",
    "node_name": "SliceCompleted"
  },
  "metadata_commit": "<sha>",
  "dashboard_url": "<url>"
}
```

`start_step.role` and `start_step.step_log` are `null` when not derivable.
Partial-creation failure returns `500` with `error`, `metadata_commit`,
`branch_name`, `worktree_path`, `experiment_dir` ([exp-11]).

### `POST /experiments/land`

Request body: `project`, `quest_type`, `quest_number` (integer),
`experiment_id` — all required.

Response `200`:

```json
{
  "status": "landed",
  "project": "quest-runner",
  "quest_type": "main",
  "quest_number": 0,
  "experiment_id": "experiment_quest-runner_main_0_0",
  "experiment_number": 0,
  "logs_copied": 3,
  "issues_copied": 2,
  "issue_responses_copied": 1,
  "skipped_missing": 1,
  "remote_branch": "experiment/quest-runner/main/0000/0000",
  "worktree_deleted": true,
  "branch_deleted": true,
  "landed_at": "<iso8601>",
  "dashboard_url": "<url>"
}
```

Conflict responses are `409` with the same quest/experiment identity fields
plus `status` ∈ {`target_dirty`, `worktree_missing`, `quest_dir_missing`,
`not_complete`, `artifact_copy_failed`, `push_failed`,
`worktree_delete_failed`, `branch_delete_failed`} and `error`; depending on
the failure they add `status_output` (dirty listing), `worktree_path`,
`workflow_state` or `experiment_status` (for `not_complete`), and
`pushed`/`worktree_deleted`/`branch_deleted` flags.

### Experiment scoping on shared endpoints

`POST /run_quest`, `/advance_quest`, `/upgrade_quest`, `/api/slices/init`,
and the issue mutation endpoints accept an optional `experiment_id` body
field; `GET` dashboard quest APIs and issue listing accept an
`experiment_id` query parameter. Semantics per [exp-12]–[exp-16]. These
endpoints' shapes are owned by their capabilities; the experiment-scoped
responses echo `experiment_id` and, on stop-condition hits, add
`status: "experiment_complete"`, `workflow_state: "ExperimentComplete"`, and
`source_metadata_commit` when the source metadata commit was made.

### CLI

```text
scripts/quest-runner experiments create
    --project <p> --type <main|side> --number <n>
    --start-step <int>           (required)
    --stop-node <name>           (required; state/node name or slice_completed)
    --stop-machine-path <path>   (optional; default root/slice)
    --notes-file <file>          (required; file contents sent as notes)
    --config-file <dir>          (required; alternate workflow directory,
                                  resolved to an absolute path client-side)

scripts/quest-runner experiments land
    --project <p> --type <main|side> --number <n>
    --experiment-id <id>         (required)

scripts/quest-runner land ... --experiment-id <id>   # routes to /experiments/land
scripts/quest-runner run|advance|upgrade ... --experiment-id <id>
scripts/quest-runner slices init ... --experiment-id <id>
scripts/quest-runner issues <list|read|create|edit|respond|responses> ... --experiment-id <id>
```

Human-readable `experiments create` output prints `experiment_id`,
`experiment_number`, `branch_name`, `worktree_path`, `base_commit`,
`dashboard_url`; `experiments land` prints `status`, `experiment_id`, the
four copy counters, `remote_branch`, `worktree_deleted`, `branch_deleted`,
`dashboard_url`, and `error` when present (also printed to stderr on
non-2xx). `--json` prints the raw response body.

### Files

`experiments/<NNNN>/` layout (`experiment.json`, `notes.md`, `workflow/`,
and post-land `logs/`, `issues/`, `issue_responses/`) and the
`experiment.json` schema are specified in
[runtime files](../contracts/runtime-files.md).

## Design

- `src/quest_runner_service/experiments.py` — the experiment domain module:
  naming (`experiment_id`, `experiment_branch_name`, `experiment_dir_name`),
  `experiment.json` IO (`read_experiment_meta`/`write_experiment_meta`/
  `update_experiment_status` with the `_EXPERIMENT_STATUSES` set),
  `resolve_start_step` (metadata-commit scan via
  `dashboard_git.scan_quest_metadata_step_commits`, then `state_history.md`
  fallback), `validate_stop_condition` / `snapshot_matches_stop_condition`
  (alias table `_STOP_NODE_ALIASES`), `validate_workflow_directory`,
  `archive_experiment_artifacts`, branch/worktree git helpers, and
  `resolve_quest_scope_checkout`, the single routing point that maps an
  optional `experiment_id` to a `DashboardCheckout` of kind `experiment`.
- `src/quest_runner_service/quest_service.py` — `create_experiment`
  (validate everything before touching disk; metadata commit, then worktree;
  `ExperimentWorktreeCreationError` carries retry coordinates once the commit
  exists), `_prepare_run`/`_resolve_mutable_quest_scope` (experiment scoping
  for run/advance/upgrade/slices, `require_open_experiment=True` for
  mutations), `land_experiment`/`_land_experiment_locked` (ordering:
  precondition checks → archive copy → push → worktree removal → branch
  delete → status update → land commit; `
  _restore_source_experiment_dir_for_retry` rolls back partial archives so
  copy/push failures are retryable), and
  `_apply_experiment_source_completion` (source `experiment.json` update on
  stop, dirty-checkout escalation to human intervention).
- `src/quest_runner_service/quest_runner_v2.py` —
  `_maybe_finalize_experiment_after_step` evaluates the recursive snapshot
  after every executed step and writes/commits `ExperimentComplete`
  (`EXPERIMENT_COMPLETE_STATE` in `quest_types.py`); the run loop also
  short-circuits when the state file already reads `ExperimentComplete`.
- `src/quest_runner_service/workflow_profile_execution.py` —
  `render_experiment_guidance` injects the experiment id and the
  `--experiment-id` instruction into agent prompts.
- `src/quest_runner_service/api.py` — `/experiments/create` (201),
  `/experiments/land` (200), error handlers mapping `InvalidQuestInput`→400,
  `QuestNotFound`/`DashboardNotFound`→404, `ExperimentLandConflict`→409 (body
  is the conflict dict), `ExperimentWorktreeCreationError`→500.
- `src/quest_runner_service/cli.py` — `experiments create|land` parsers,
  `_add_experiment_id_arg` on quest-scoped commands, `land --experiment-id`
  rerouting, and the `_format_create_experiment`/`_format_land_experiment`
  output shapes.
- Non-obvious choices: the worktree is created at `base_commit`
  (`step_commit^`) so the replayed step itself runs under the alternate
  workflow; the run-lock key embeds the experiment id so parent and
  experiment runs are independently serialized; landing pushes before any
  destructive cleanup so the branch always survives somewhere.
- Tests: `tests/test_experiments.py` (naming, meta IO, start-step
  resolution, stop validation, creation atomicity, archive, land service),
  `tests/test_experiment_scoped_operations.py` (scoping across API/CLI,
  no-fallback, deferred runs), `tests/test_experiment_stop_conditions.py`
  (snapshot matching, advance/run completion, dirty-source escalation,
  idempotency), `tests/test_experiment_lifecycle.py` (end-to-end).

## Interactions

- [quest-lifecycle](quest-lifecycle.md) — experiments reuse the run, advance,
  upgrade, and land plumbing; experiment landing replaces quest landing when
  `--experiment-id` is given.
- [service-lifecycle](service-lifecycle.md) — endpoints live on the quest
  runner service; async runs report `experiment_complete` via run status.
- [state-machine-engine](state-machine-engine.md) — stop conditions match
  against the engine's recursive snapshots; `ExperimentComplete` is a
  normalized state written through the engine's state IO.
- [workflow-config](workflow-config.md) — the alternate workflow package
  format, validation, and quest-local `workflow/` installation.
- [agent-harness](agent-harness.md) — prompts carry the experiment guidance
  block ([exp-17]).
- [issues](issues.md) and [slices](slices.md) — experiment-scoped issue and
  slice operations; landing archives the workflow-declared issue files.
- [dashboard](dashboard.md) — open experiments appear in the project
  snapshot, quest APIs accept `experiment_id`, and
  `GET /api/dashboard/experiments` serves archived experiment detail.
- [chat-stream](chat-stream.md) — experiment runs publish to the same chat
  event bus as normal runs.
- [Runtime files](../contracts/runtime-files.md) — `experiment.json` schema
  and the `experiments/<NNNN>/` directory layout.
