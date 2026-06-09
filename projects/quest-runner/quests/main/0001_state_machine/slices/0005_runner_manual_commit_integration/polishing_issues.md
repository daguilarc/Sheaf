# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-09T22:33:08Z
- updated_at: 2026-06-09T22:33:08Z
- title: Missing automated-run test for a committed step (global_step increment + metadata)
- details: ## What is wrong

The slice spec (physicalplan/plan.md, "Validation Expectations" -> "Automated run tests cover") explicitly requires an automated-run test for: "one committed step increments global step and writes metadata". This scenario is not exercised through the automated `run_quest_v2` path anywhere in the suite.

In `test_workflow_runner_integration.py` the `AutomatedRunTests` cover only NON-committing automated outcomes:
- `test_pre_planning_returns_without_commit` (stop, no commit)
- `test_completed_returns_without_commit` (no commit)
- `test_human_intervention_stops_before_step` (no commit)
- `test_implementing_stay_is_noop_without_file_changes` (noop, no commit)

The committing + global_step-increment + metadata assertions exist only for the MANUAL path (`test_manual_advance_commits_and_increments_global_step`, `test_execute_slice_child_commit_has_nested_snapshot`, both via `advance_v2_top_level_step_without_harness`). `test_worktree_execution_path.py`'s only `run_quest` test asserts `dirty_workspace`, not a commit. A grep over `tests/` confirms `run_quest_v2` is referenced only in `test_workflow_runner_integration.py`, and no automated test asserts `last_commit` / `steps_executed > 0` from a produced commit.

## Why it is a problem

The automated loop in `quest_runner_v2.py` has committed-path-specific wiring that no test currently covers end-to-end:
- `steps_executed += harness_steps_acc[0]` accumulation
- `last_commit = step_out.last_commit` propagation across loop iterations
- the `result.state_changed=True` branch flowing `execute_v2_top_level_step` -> `commit_v2_snapshot_step` (automated mode builds the `run_callback`; manual mode does not)
- loop continuation after a committed step and the subsequent `_maybe_finalize_experiment_after_step` gating on `step_out.kind == "committed"`

A regression in any of these (e.g. dropping `last_commit`, mis-accumulating `steps_executed`, or mis-passing `state_changed`) would not be caught, because the shared `commit_v2_snapshot_step` is only reached via the manual advance path in tests.

## What must be true to close

Add an automated-run test that drives `run_quest_v2` (or `run_quest` dispatching to v2) with the harness mocked, in a state where the automated step performs a real state transition that produces file changes, and asserts:
- a new git commit is created (HEAD advances) with parseable step-commit metadata (correct `node_name` / `state_before` / `state_after`);
- `global_step` increments by exactly one;
- the returned payload carries `last_commit` and the expected `steps_executed`.

Alternatively, if the team deems the shared commit machinery sufficiently covered by the manual-path tests, document that rationale in the test module so the intentional omission is explicit.
- resolution_notes: none
