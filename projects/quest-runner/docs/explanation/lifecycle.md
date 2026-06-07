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
