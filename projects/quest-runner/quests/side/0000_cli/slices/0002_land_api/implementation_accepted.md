# Implementation accepted

Slice `0002_land_api` is accepted by the polisher reviewer. No open polishing issues.

## Review summary

- `POST /land` route added in `api.py` with required `project`/`quest_type`/`quest_number`,
  optional `target_branch` (default `main`), and a `LandQuestConflict` -> 409 error handler.
- `QuestService.land_quest(...)` implements the spec workflow: validation, lock
  serialization using the same lock-family key as `run_quest`
  (`_build_run_lock_key(worktree_path.resolve(), ...)`), clean source/target checkout
  guards, branch-exists check, clean-worktree guard, rebase onto target, fast-forward
  merge, and worktree removal without deleting the quest branch.
- Structured conflict responses cover `target_dirty`, `worktree_dirty`,
  `rebase_failed`, `fast_forward_failed`, and `worktree_delete_failed`.
- `worktrees.py` extended with thin, reusable git helpers (`run_git`,
  `porcelain_status`, `branch_exists`, `checkout_branch`, `rebase_onto`,
  `merge_ff_only`, `remove_worktree`, `rev_parse_head`); legacy `_git` retained as a
  delegating wrapper.

## Test coverage

`tests/test_land_api.py` covers every validation expectation in the physical plan
(missing fields, lock contention, missing worktree, dirty source, dirty worktree,
success with no merge commit and retained branch, rebase conflict, fast-forward
failure). `tests/test_worktrees.py` adds direct coverage for the new helpers; the
remaining helpers are exercised through the success integration path. `Makefile`
registers `tests.test_land_api`. Implementer reported 194 tests passing.
