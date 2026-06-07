# Implementation accepted

Slice 0002 (project-local creation and worktrees) is accepted by the polisher
reviewer. No open polishing issues remain.

## Reviewed scope

- `QuestMeta.project` added, persisted by `write_quest_meta`, and derived from
  the quest path in `read_quest_meta` with correct rejection when neither
  metadata nor path identifies a project-local quest.
- Project-local discovery helpers (`project_quest_root`, `find_quest_dir`,
  `list_quest_dirs`, `iter_project_quest_roots`) scope to
  `projects/<project>/quests/` and ignore legacy top-level `quests/`.
- `worktrees.py` provides deterministic worktree naming/path, source-checkout
  clean/detached validation, scoped quest-create commit, worktree creation, and
  rollback of partial worktree/branch.
- `QuestService.create_quest` requires `project`, scaffolds under
  `projects/<project>/quests/`, commits only the new quest record, and creates a
  clean quest worktree; rollback handles both pre-commit and post-commit
  failures.
- Default execution config `modify_block` updated from `quests/**` to
  `projects/**`; dashboard discovery enumerates project-local quests only.

## Issue resolution

- PR-0001 (deferred rate-limit/billing retry dropped the new required `project`
  argument to `run_quest`) — verified completed. `project` is threaded through
  `_run_quest_locked`, `_schedule_deferred_quest_run`, the deferred task
  description, and the deferred callback's `run_quest` call. Covered by
  `test_deferred_retry_preserves_project`.

## Test coverage

Unit/integration tests cover normalize_slug, per-(project,type) numbering,
metadata project field and reader compatibility, legacy exclusion, deterministic
worktree naming/path, project-name validation, dirty/detached refusal,
scoped-commit content, both rollback paths, and the deferred-retry project
threading.
