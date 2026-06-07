# Manual Advance REST API

## Objective

Add `POST /advance_quest` so a human can finish an interrupted role turn by running the same post-turn checks, state transition side effects, metadata validation, and git commit path used by the v2 runner, without sending any harness message.

Expected outcome: the service exposes a synchronous manual advancement endpoint that operates in the quest worktree, refuses active runs, handles `PrePlanning` and `Completed` specially, and returns structured JSON describing the state transition and commit.

## Sequencing

This is the first slice because the CLI and dashboard slices call `/advance_quest`. Later slices should treat this endpoint and service method as the stable integration point.

## Key Files And Systems

- `projects/quest-runner/src/quest_runner_service/api.py`
- `projects/quest-runner/src/quest_runner_service/quest_service.py`
- `projects/quest-runner/src/quest_runner_service/quest_runner_v2.py`
- `projects/quest-runner/src/quest_runner_service/state_machine/v2_step_executor.py`
- `projects/quest-runner/src/quest_runner_service/state_machine/quest_v2_nodes.py`
- `projects/quest-runner/src/quest_runner_service/quest_runner.py`
- `projects/quest-runner/tests/test_quest_service_api.py`
- `projects/quest-runner/tests/test_worktree_execution_path.py`
- `projects/quest-runner/tests/test_commit_metadata.py`

## Existing APIs To Reuse As-Is

- `QuestService._prepare_run(...)` for source repo validation, quest lookup, required worktree resolution, and the same missing-worktree behavior already used by `/run_quest`.
- `_build_run_lock_key(...)` and `QuestLock` for serialization with active `run_quest` background runs.
- `V2QuestStateIo`, `QuestV2MachineLoader`, and `ConcreteStateMachine` state I/O conventions for normalized quest state and legacy slice state.
- `build_v2_transition_plan(...)`, `apply_transition_filesystem_side_effects(...)`, `collect_changed_paths_since(...)`, and `git_rev_parse_head(...)`.
- `render_step_commit_message(...)`, `parse_step_commit_message(...)`, and `validate_parsed_step_commit(...)`.
- Existing predicate helpers in `quest_runner.py`: `all_required_slice_plan_files_exist`, `quest_has_open_physicalplan_issues`, `physical_plan_review_done_signal`, `slice_has_open_polishing_issues`, `implementation_review_done_signal`, and `docs_updated_for_quest`.

## APIs To Extend Or Modify

### Shared v2 post-turn commit helper

Refactor `execute_v2_top_level_step(...)` in `state_machine/v2_step_executor.py` so the "after a recursive snapshot exists" work is in one helper, for example:

```python
def commit_v2_snapshot_step(
    *,
    repo_path: Path,
    quest_dir: Path,
    quest_key: str,
    meta: QuestMeta,
    git_ops: SubprocessGitOps,
    sm_id: StateMachineId,
    step_base: str,
    before_quest: QuestStateInfo,
    before_slice: SliceStateInfo | None,
    snapshot: RecursiveSnapshot,
) -> V2StepResult:
    ...
```

The helper should contain the existing transition-plan diff, changed-path detection, side effects, global-step increment, commit message rendering, metadata validation, normalized state rewrite, stage-all, and commit behavior. `execute_v2_top_level_step(...)` should keep its current public behavior by calling `top.RunOneStep(ctx)` and then the new helper.

### Manual transition executor

Add a manual advancement function in `state_machine/v2_step_executor.py` or `quest_runner_v2.py`, for example `advance_v2_top_level_step_without_harness(...)`. It should build a `RecursiveSnapshot` by evaluating the same post-turn transition predicates without calling `_ThreadLlmNode.Execute` or `perform_role_harness_sequence`.

Before adding that manual function, extract the pure transition predicates currently embedded in node `NextState(...)` methods into shared helpers and update the normal nodes to call those helpers. At minimum, share:

- physical-plan completion detection;
- physical-plan review result detection;
- next unfinished slice selection and `active_slice` tag calculation;
- slice implementation/review/fix completion detection;
- documentation completion detection.

That keeps `run_quest` and `advance_quest` aligned without requiring a fake harness operation.

Required state handling:

- `PrePlanning`: write quest state to `PhysicalPlanning` and commit that transition. This is intentionally different from `run_quest`, which currently stops at `PrePlanning`.
- `PhysicalPlanning`: transition to `ReviewPhysicalPlan` only when slice directories exist and each slice has a `physicalplan/*.md`, `state.md`, `state_history.md`, and `polishing_issues.md`; otherwise return a validation failure without advancing.
- `ReviewPhysicalPlan`: transition to `PhysicalPlanning` if open physical plan issues exist; transition to `PrepareNextSlice` if `physicalplan_accepted.md` exists and no open issues remain; otherwise return a validation failure.
- `PrepareNextSlice`: reuse the same unfinished-slice selection semantics as `PrepareNextSliceNode`, including `active_slice` tags and `QuestDocumenting` when all slices are done.
- `ExecuteSlice`: recurse into the active slice and evaluate the slice's current logical state without a harness message. For `SliceSetup`, scaffold and move to `Implementing`; for `Implementing`, require `implementation_done.md` before moving to `PolishingReview`; for `PolishingReview`, move to `PolishingFix` when open polishing issues exist, to `Completed` when `implementation_accepted.md` exists and no open issues remain, and otherwise return a validation failure; for `PolishingFix`, move to `PolishingReview`; for `Completed`, leave completed. The root returns to `PrepareNextSlice` when the child snapshot ends at `Completed`.
- `QuestDocumenting`: use the pre-step HEAD as the documenter base ref and reuse `docs_updated_for_quest(...)`; transition to `Completed` only when project docs changed, otherwise return a validation failure.
- `Completed`: return a successful no-op response with `status: "completed"` and `advanced: false`; do not commit.

For validation failures where the runner would not advance yet, return a non-2xx API result without mutating state. The response should name the missing marker or blocking condition, such as missing `implementation_done.md`, open issues, missing `physicalplan_accepted.md`, or unchanged docs.

If the worktree is in a condition the existing runner would reject before a role turn, return the same failure class rather than committing. Do not add new permissive dirty-worktree behavior beyond the normal post-turn commit path.

### Service and route

Add `QuestService.advance_quest(...)`:

- Calls `_prepare_run(...)` so the operation is in the quest worktree and missing worktrees produce the same `409` body shape as `/run_quest`.
- Acquires the same lock key used by `run_quest`; lock contention returns the existing `QuestLockContention` `409`.
- Checks `human_intervention_request.md`; if present, returns a conflict-style response and does not advance unless the current runner semantics are explicitly broadened in code.
- Calls the manual v2 advancement function.
- Returns previous and next quest state, previous and next slice state when applicable, active slice when applicable, commit SHA when a commit was created, and a short message.

Add `POST /advance_quest` in `api.py`:

- Required JSON fields: `project`, `quest_type`, `quest_number`.
- Uses existing validation/error handlers for invalid input, not found, missing worktree, malformed state, and lock contention.
- Maps manual validation conflicts to `409 Conflict` or `422 Unprocessable Entity` with JSON error details. Use `409` for active runs, human intervention, missing worktree, and other runtime conflicts; use `422` for malformed state or unmet advancement predicates.

## Enabling Refactor

The refactor of `execute_v2_top_level_step(...)` into "produce recursive snapshot" and "commit recursive snapshot" is required before the endpoint is implemented. This keeps commit metadata and global-step behavior centralized and avoids duplicating normal runner commit logic in the Flask route.

Keep the refactor small: do not redesign the state machine abstraction. The manual path may use shared predicate functions for no-harness transition evaluation, but the commit path must be shared and the normal nodes must continue to use those same predicates.

## Validation Expectations

Add/extend tests for:

- `POST /advance_quest` requires `project`, `quest_type`, and `quest_number`.
- Active-run lock contention returns `409`.
- Missing worktree returns `409` with `project`, `quest_type`, `quest_number`, and `expected_worktree`.
- `PrePlanning` advances to `PhysicalPlanning`, writes a normal v2 step commit, and increments global step.
- `Completed` returns `status: "completed"` and does not create a commit.
- A missing `physicalplan_accepted.md`, missing `implementation_done.md`, open issue, or unchanged docs returns a non-2xx response without changing state.
- A valid physical-plan acceptance transition uses the same `commit_v2_snapshot_step(...)` helper as `execute_v2_top_level_step(...)`.
- Normal node `NextState(...)` tests still cover the shared predicate helpers, proving `run_quest` and `advance_quest` do not drift.
- Commit metadata from manual advancement parses and validates with the existing commit metadata tests.

Run:

```text
make -C projects/quest-runner test
```
