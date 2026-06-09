# Quest lifecycle

This document describes create, run, worktree, lock, harness, and logging
behavior for project-local quests.

## Create flow

1. Client sends `POST /create_quest` with `project`, `quest_type`, and `name`.
2. `QuestService.create_quest` validates the source Sheaf checkout:
   - must be a git repository on a named branch
   - working tree must be clean
3. The service allocates the next quest number for the project and type.
4. Quest scaffold files are written under
   `projects/<project>/quests/<type>/<number>_<slug>/`.
5. A git commit containing only the quest path is created on the current branch.
6. A worktree is created at
   `<repo-parent>/.quest-worktrees/<project>_<type>_<number>_<slug>/` on branch
   `quest/<worktree_name>`.

If worktree creation fails after the scaffold commit, the API returns `500` with
guidance for manual cleanup. The quest record remains on the source branch.

Quest creation is the only automatic worktree creation path. Missing worktrees
for existing quests are operational errors surfaced by `run_quest` and the
dashboard (`worktree_missing: true`).

## Checkout resolution

For dashboard reads and git metadata:

1. If the expected quest worktree exists, use it as `checkout_root`.
2. Otherwise fall back to the source Sheaf repository for read-only discovery.

For execution:

- `run_quest` requires the worktree and returns `409` when it is absent.

## Run flow

1. Client sends `POST /run_quest` with project identity and optional `max_steps`.
2. `QuestService._prepare_run` locates the quest on the source checkout, verifies
   the worktree exists, and resolves the quest directory inside the worktree.
3. A per-worktree lock prevents concurrent runs of the same quest.
4. Execution is scheduled on a background thread; the HTTP handler returns
   `202` with `run_id` and dashboard URLs.
5. `quest_runner_v2.run_quest_v2` (or legacy path when applicable) executes
   state-machine steps:
   - reads and writes quest/slice state files
   - invokes role harnesses when agent nodes run
   - enforces `state_execution_config.yaml` path rules after harness turns
   - creates git commits with step metadata when filesystem changes occur
6. On harness rate limits, deferred retry may schedule through
   `deferred_tasks.py` without a database.

## Locks

Run locks are keyed by worktree path plus project/type/number. Lock contention
returns `409` with lock owner details.

## Human intervention

When the runner detects a condition requiring human input, it writes
`human_intervention_request.md` at the quest root. Presence of this file blocks
automatic progress until a human resolves the condition and removes or addresses
the request.

The dashboard shows a human-intervention overlay and hides the run button while
the file exists.

## Harness calls

Role harnesses (`cursor`, `codex`, `claude_code`) receive runtime context built
by `quest_thread.build_runtime_context`, including:

- repo-relative quest and slice paths
- bundled schema reference from `quest_docs/`
- role-specific task instructions

Harness stdout/stderr and structured events are logged verbosely. Step role logs
are written under the quest directory.

## Step commits

Successful v2 runner steps create git commits in the quest worktree when there
are staged filesystem changes. Commit messages include `quest-step`,
`state-machine-path`, node names, and a pretty-printed recursive snapshot JSON
payload.

Quest step history readers merge commit metadata with optional legacy
`state_history.md` rows.

Runtime file schemas and marker files are summarized in
[Runtime files](../reference/runtime-files.md).

## Logging summary

| Log type | Location |
| --- | --- |
| Service startup, HTTP, create/run events | `logs/quest-runner/` |
| Per-step role harness output | `<quest_dir>/logs/step_<n>_<role>.jsonl` |
| Thread transcripts | `<quest_dir>/threads/` |

## Completion markers

Slice implementation advances when `implementation_done.md` exists in the active
slice directory. Quest-level physical plan review uses `physicalplan_accepted.md`
at the quest root. Slice polishing acceptance uses `implementation_accepted.md`
in the slice directory. These files integrate with the recursive state machine
nodes in `state_machine/`.

## Experiments

Experiments let operators replay a completed quest from an earlier state-machine
step with an alternate `state_execution_config.yaml`. An experiment is a child
record of an existing main or side quest, not a third quest type.

### Terminology

| Term | Meaning |
| --- | --- |
| Source checkout | The normal Sheaf checkout (usually `main`) that owns quest metadata and receives landed experiment archives. |
| Experiment worktree | A separate git worktree where the experiment runs. |
| Experiment id | Stable name: `experiment_<project>_<type>_<questNumber>_<experimentNumber>`. |
| Open experiment | Metadata status is `open` or `experiment_complete` and the local experiment worktree exists. |
| Completed experiment | Stop condition reached; quest state is `ExperimentComplete`; ready to land. |
| Closed experiment | Status `landed`; local worktree and branch removed; artifacts archived on the source checkout. |

### Directory layout

On the source checkout:

```text
projects/<project>/quests/<type>/<number>_<slug>/
  experiments/
    0000/
      experiment.json
      notes.md
      state_execution_config.yaml
      logs/                 # populated after landing
      issues/               # populated after landing
      issue_responses/      # populated after landing
```

The experiment worktree contains the normal quest directory layout for execution.
Permanent metadata and archived artifacts live under `experiments/<number>/` on
the source branch.

### Start-step replay

Creation resolves the selected start step to its v2 step commit (from git commit
metadata, step logs, or `state_history.md`). The experiment branch and worktree
are created at the **parent** of that commit (`<step_commit>^`) so rerunning the
experiment can execute the selected step again.

### Create flow

1. Operator calls `POST /experiments/create` or `scripts/quest-runner experiments create`.
2. The service assigns the next experiment number under `experiments/`.
3. Metadata files are written and committed on the source checkout.
4. A branch is created at the base commit and an experiment worktree is added.
5. The experimental `state_execution_config.yaml` replaces the quest config in
   the worktree only.
6. Status becomes `open`.

If metadata is committed but worktree creation fails, the API returns error
details (metadata commit, branch name, worktree path) so an operator can retry
or clean up partial state.

### Scoped execution

When `experiment_id` is provided:

- `run_quest`, `advance_quest`, issue APIs, and slice init resolve the experiment
  worktree as the git and command boundary.
- Runtime logs, issues, and issue responses are written inside the experiment
  worktree quest directory.
- Agent prompts include the experiment id and instruct agents to pass
  `--experiment-id` on every Quest Runner CLI call.

When `experiment_id` is omitted and the normal quest worktree is missing, scoped
commands fail with a clear error requiring `--experiment-id`.

### Stop and completion

The runner stops when the configured stop condition is reached (for example
`slice_completed`, resolved to the slice machine `Completed` node). The quest
filesystem state becomes `ExperimentComplete`. Source metadata status becomes
`experiment_complete`. This is not normal quest landing.

### Land flow

1. Operator calls `POST /experiments/land` or `scripts/quest-runner experiments land`.
2. The service verifies the experiment worktree exists and state is
   `ExperimentComplete`.
3. JSONL logs, issues, and issue responses are copied into
   `experiments/<number>/logs`, `issues/`, and `issue_responses/`.
4. The experiment branch is pushed to the configured remote (remote branch is
   retained for inspection).
5. Local worktree and branch are removed only after a successful push.
6. Metadata status becomes `landed` with `landed_at` and `remote_branch` recorded.
7. Archived artifacts and metadata are committed on the source checkout.

Experiment landing does not rebase or merge experiment code into `main`.

### Operational recovery

| Failure | Recovery |
| --- | --- |
| Metadata committed, worktree creation failed | Use error response fields to remove partial branch/worktree or retry create after cleanup. |
| Push failed during landing | Local worktree and branch are preserved; fix remote access and retry `experiments land`. |
| Archive copy failed | Status stays `experiment_complete`; partial archive files are not committed; fix disk/permissions and retry. |
| Source checkout dirty during completion metadata update | Runner writes `human_intervention_request.md`; commit or discard source changes, then retry. |
| Quest command without `--experiment-id` when quest worktree is gone | Pass `--experiment-id` for all experiment-scoped operations. |
