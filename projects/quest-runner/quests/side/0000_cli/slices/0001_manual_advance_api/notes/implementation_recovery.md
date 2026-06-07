# Manual advance API — implementation recovery

Prior implementer turn completed this slice in-product, but the runner reverted all
`projects/**` edits because the implementer profile blocks them. Re-apply the
following (or widen `modify_allow` and re-run implementer).

## Physical plan checklist

- [ ] `commit_v2_snapshot_step(...)` extracted from `execute_v2_top_level_step`
- [ ] Shared predicates in new `quest_v2_predicates.py`; nodes call them
- [ ] `advance_v2_top_level_step_without_harness(...)` (evaluate-then-apply, no harness)
- [ ] `QuestService.advance_quest(...)` with lock + `_prepare_run`
- [ ] `POST /advance_quest` route + error handlers (`422` validation, `409` conflict)
- [ ] Tests: `test_advance_quest_api.py`, `test_quest_v2_predicates.py`, commit metadata case
- [ ] Makefile `TEST_MODULES` includes new test modules
- [ ] `make -C projects/quest-runner test` passes (181 tests)

## Key design points

### `quest_v2_predicates.py` (new)

Pure helpers raising `AdvanceValidationError` on blocked advance:

- `physical_planning_next_state`
- `review_physical_plan_next_state`
- `prepare_next_slice_transition` → `(next_state, tags)`
- `slice_implementing_next_state`
- `slice_polishing_review_next_state`
- `quest_documenting_next_state`

Nodes catch `Exception` and return current state (preserves harness-path behavior).

### `v2_step_executor.py`

- `commit_v2_snapshot_step(...)` — shared post-snapshot commit path
- `execute_v2_top_level_step` — `RunOneStep` then `commit_v2_snapshot_step`
- `advance_v2_top_level_step_without_harness` — manual snapshot via
  `_evaluate_quest_advance` / `_manual_run_quest_step`, then shared commit
- `Completed` → `{status: completed, advanced: false}` no commit
- `PrePlanning` → `PhysicalPlanning` with commit (unlike `run_quest` stop)

### `quest_service.py`

- `AdvanceQuestValidationError`, `AdvanceQuestConflict`
- `advance_quest(...)` — sync, same lock key as `run_quest`

### `api.py`

- `POST /advance_quest` body: `project`, `quest_type`, `quest_number`
- Error handlers for new exception types

## Validation

```bash
make -C projects/quest-runner test
```

After recovery, delete `human_intervention_request.md` and create
`implementation_done.md` in this slice.
