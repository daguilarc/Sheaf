# Land Quest REST API

## Objective

Add `POST /land` to land a quest worktree branch onto a target branch using the specified linear git workflow: clean target checkout, rebase quest branch onto target, fast-forward target to quest branch, then delete the quest worktree without deleting the branch.

Expected outcome: a human operator can land completed quest work from the REST service and receive structured success or manual-cleanup JSON.

## Sequencing

This slice can be implemented after slice `0001_manual_advance_api` or in parallel if there is only one implementer touching `quest_service.py`. The CLI slice depends on this endpoint.

## Key Files And Systems

- `projects/quest-runner/src/quest_runner_service/api.py`
- `projects/quest-runner/src/quest_runner_service/quest_service.py`
- `projects/quest-runner/src/quest_runner_service/worktrees.py`
- `projects/quest-runner/tests/test_quest_service_api.py`
- `projects/quest-runner/tests/test_worktrees.py`
- `projects/quest-runner/tests/test_worktree_execution_path.py`

## Existing APIs To Reuse As-Is

- `quest_fs.find_quest_dir(...)` and `quest_fs.read_quest_meta(...)` for quest metadata.
- `quest_worktree_name(...)`, `quest_worktree_branch(...)`, `quest_worktree_path(...)`, `worktree_exists(...)`, `is_git_worktree(...)`, and `is_worktree_clean(...)`.
- `_resolve_repo(...)`, `_is_git_repo(...)`, `_validate_project(...)`, and `_build_run_lock_key(...)` from `quest_service.py`.
- `QuestLock` for serialization with `run_quest` and `advance_quest`.

## APIs To Extend Or Modify

### Worktree/git helpers

Extend `worktrees.py` with small reusable helpers rather than ad hoc route shell-outs:

- A public git runner that returns `CompletedProcess[str]` with the existing quest-runner git environment.
- `current_branch(...)` is already available; reuse it.
- Add helpers as needed for:
  - checking a checkout's porcelain status and returning the dirty output;
  - verifying a branch exists;
  - checking out the target branch when the source checkout is clean;
  - rebasing the quest worktree branch;
  - fast-forwarding the target branch;
  - removing the worktree without deleting the branch.

Keep helpers thin and testable. Do not add network fetch/pull behavior.

### Service method

Add `QuestService.land_quest(...)`:

- Request fields: `project`, `quest_type`, `quest_number`, optional `target_branch` defaulting to `main`.
- Validate quest identity against the source checkout and resolve quest metadata.
- Resolve expected `worktree_path` and `worktree_branch` from metadata.
- Fail clearly if the quest worktree is missing or not a git worktree.
- Acquire the same lock-family key as `run_quest` for the quest worktree before mutating refs or worktrees.
- Fail with lock contention if the quest is currently running.
- Before any checkout/rebase/merge operation, verify the source checkout has a clean working tree. If dirty, fail with status such as `target_dirty`, include the dirty status output, and do not mutate.
- Ensure the target branch exists. If the source checkout is not already on the target branch, check it out only after the clean check, then check cleanliness again.
- Verify the quest worktree is clean before rebase. If not clean, return a manual-cleanup failure and do not start a rebase.
- Rebase the quest worktree branch onto the current target branch.
- If rebase fails or leaves the worktree dirty/conflicted, stop and return JSON with `status: "rebase_failed"`, `worktree_path`, `worktree_branch`, and `next_step`.
- After a clean rebase, fast-forward the target branch checkout to the quest worktree branch with `git merge --ff-only <worktree_branch>`.
- If fast-forward fails, return a clear error and do not delete the worktree.
- After fast-forward succeeds, delete only the worktree checkout with `git worktree remove`; do not delete the quest branch.
- Return the completed step flags and `target_head`.

### API route

Add `POST /land` in `api.py`:

- Required JSON fields: `project`, `quest_type`, `quest_number`.
- Optional field: `target_branch`, default `main`.
- Use existing JSON error style.
- Return `200` for successful landing.
- Return `409` for active run lock contention, dirty target checkout, missing worktree, rebase conflict/manual cleanup, fast-forward failure, or worktree deletion failure that requires operator action.
- Return `400`/`404` for invalid input or missing quest as existing handlers do.

## Enabling Refactor

If the current private `_git(...)` helper in `worktrees.py` is too narrow, make the minimal public wrapper needed by `QuestService.land_quest(...)`. Keep git command construction in product code, not in the Flask route.

## Validation Expectations

Add tests for:

- `POST /land` requires `project`, `quest_type`, and `quest_number`.
- Active-run lock contention returns `409`.
- Missing worktree returns a clear failure including `worktree_path` or `expected_worktree`.
- Dirty source checkout fails before checkout/rebase/merge mutation.
- Dirty quest worktree fails before rebase and returns manual cleanup guidance.
- Successful land rebases the quest worktree branch onto `main`, fast-forwards `main`, deletes the worktree directory, leaves the quest branch present, and does not create a merge commit.
- Rebase conflict returns `status: "rebase_failed"` and leaves the worktree for manual cleanup.
- Fast-forward failure does not delete the worktree.

Run:

```text
make -C projects/quest-runner test
```
