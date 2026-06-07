# Implementation complete

Slice `0002_land_api` is implemented.

## Summary

- Extended `worktrees.py` with reusable git helpers: `run_git`, `porcelain_status`, `branch_exists`, `checkout_branch`, `rebase_onto`, `merge_ff_only`, `remove_worktree`, and `rev_parse_head`.
- Added `QuestService.land_quest(...)` with lock serialization, clean-checkout guards, rebase/fast-forward workflow, and structured conflict responses via `LandQuestConflict`.
- Added `POST /land` Flask route with required `project`/`quest_type`/`quest_number` and optional `target_branch` (default `main`).
- Added `tests/test_land_api.py` covering validation, lock contention, missing worktree, dirty source/worktree, success path, rebase conflict, and fast-forward failure; extended `test_worktrees.py` for new helpers.
- Registered `tests.test_land_api` in the project `Makefile`.

## Validation

```text
make -C projects/quest-runner test
```

194 tests passed.
