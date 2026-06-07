# Physical Plan: Worktree Execution Path

## Objective

Make quest execution operate from the deterministic quest worktree, using the worktree as the git and command boundary while keeping quest artifacts inside the project-local quest directory in that worktree.

Expected outcome:

- `run_quest` accepts project identity and resolves the project-local quest directory in the matching worktree.
- Execution refuses to run when the deterministic quest worktree is missing.
- `$currentQuest`, `$currentSlice`, thread transcripts, role logs, step commits, dashboard-linked paths, and path enforcement all use the project-local quest directory in the worktree.
- Recursive state-machine behavior and step commit metadata remain equivalent to the external Conductor v2 runner, except for project-local paths.

## Key Files And Systems

Likely affected files:

- `projects/quest-runner/src/quest_runner_service/quest_service.py`
- `projects/quest-runner/src/quest_runner_service/quest_runner.py`
- `projects/quest-runner/src/quest_runner_service/quest_runner_v2.py`
- `projects/quest-runner/src/quest_runner_service/quest_thread.py`
- `projects/quest-runner/src/quest_runner_service/state_machine/v2_quest_state_io.py`
- `projects/quest-runner/src/quest_runner_service/state_machine/v2_step_executor.py`
- `projects/quest-runner/src/quest_runner_service/state_machine/commit_metadata.py`
- `projects/quest-runner/src/quest_runner_service/worktrees.py`
- Tests migrated or split from `test_quest_runner.py`, `test_quest_runner_v2.py`, `test_quest_runner_v2_single_commit.py`, `test_role_profile_resolver.py`, and runner/path-enforcement portions of `test_harness_quest_thread.py`.

Slice-owned tests:

- Own runner execution, recursive v2 execution, role profile resolution, path enforcement, dirty workspace, project-local machine path, and git step metadata tests.
- Extend commit metadata coverage only for project-local quest/slice paths introduced by this slice; pure rendering/parsing coverage remains slice-1-owned.
- Do not own REST scheduling or dashboard API tests; those are slice 4.

## Existing APIs To Reuse As-Is

- Reuse `run_quest_v2`, `execute_v2_top_level_step`, state-machine definitions, and commit metadata rendering logic.
- Reuse `QuestLock` and `ActiveRunTracker`, but key them by worktree path plus project/quest identity rather than source checkout alone.
- Reuse path-rule enforcement in `quest_runner`, with the repo root set to the quest worktree.
- Reuse thread registry semantics and v2 thread names, with `repo_path.name` now naturally being the worktree basename.

## APIs To Extend Or Modify

- Change `QuestService._prepare_run` and public run methods to require `project`.
- Add a `MissingQuestWorktree` exception or equivalent, mapped by REST in slice 4 to a clear client-visible error.
- Resolve run paths as:
  - source checkout root from service configuration/process root
  - metadata/discovery quest in source checkout for identity
  - deterministic worktree path from source root and metadata
  - worktree quest dir at `worktree_path / "projects" / project / "quests" / quest_type / "<number>_<slug>"`
- Update all calls to `quest_fs.find_quest_dir` and `list_quest_dirs` to include `project`.
- Update `build_runtime_context` and prompt variables so quest paths are project-local relative paths when shown to agents.
- Update `build_spec_thread_name` tests to expect worktree-derived repo names where appropriate.
- Replace any runtime use of `/Users/joyo/conductor/docs/quest` with the bundled package docs directory from slice 1, for example `runtime_quest_docs_dir() -> Path(__file__).resolve().parent / "quest_docs"`.

## Implementation Notes

Run flow:

1. Validate the source Sheaf checkout root is a git repo.
2. Validate `project`, `quest_type`, and `quest_number`.
3. Resolve the source quest metadata at `source_root/projects/<project>/quests/<quest_type>/<number>_<slug>`.
4. Derive the expected worktree path from that metadata.
5. If the worktree path is missing or is not a git working tree, return/refuse with `MissingQuestWorktree`.
6. Resolve the active quest directory inside the worktree using project-aware `quest_fs`.
7. Acquire the lock using a key that distinguishes the worktree path and quest identity.
8. Call the existing v2 runner with `repo_path=worktree_path`, `quest_dir=<worktree project-local quest dir>`, and `quest_docs_dir=projects/quest-runner/src/quest_runner_service/quest_docs` resolved from the installed package/module location.
9. Keep all agent JSONL logs under `<worktree quest_dir>/logs/step_<n>_<role>.jsonl`.

Do not recreate a missing worktree in this flow. Creation remains the only automatic worktree creation path.

The `state_machine_id.machine_path`, normalized `state.md` `machine_path`, and commit metadata `state-machine-path` should be repo-relative paths like `projects/example/quests/main/0000_slug`, not top-level `quests/main/...`.

The pre-harness dirty workspace check must run against the worktree. If the source checkout is dirty but the worktree is clean, execution should proceed; if the worktree is dirty, preserve existing dirty-workspace behavior.

## Validation

- Tests for `_prepare_run`/run path resolution requiring `project`.
- Tests that missing deterministic worktree refuses execution and does not call runner internals.
- Tests that run uses `worktree_path` as `repo_path` and the worktree-local `projects/<project>/quests/...` path as `quest_dir`.
- Tests preserving recursive state transitions, normalized state writes, and commit metadata with project-local `machine_path`.
- Tests for `$currentQuest`/`$currentSlice` path rule expansion with project-local paths.
- Tests that top-level legacy quests are not found by run lookup.
- Run migrated v2 runner and commit metadata tests with updated fixtures.
