# Issues

## Issue PL-0001

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-09T01:09:06Z
- updated_at: 2026-06-09T01:17:08Z
- title: Run path (run_quest_v2) experiment stop/finalization is untested
- details: ## Problem

The synchronous experiment run path is the primary production code path for this slice, but it has no test coverage. `quest_runner_v2.run_quest_v2(...)` now contains two new experiment-only branches that are never exercised:

- `_maybe_finalize_experiment_after_step(...)` — invoked after each committed `execute_v2_top_level_step(...)` to detect the stop condition, rewrite the worktree quest `state.md` to `ExperimentComplete`, create the finalizing commit, and return `status="experiment_complete"`.
- The top-of-loop early return when `experiment_run is not None and qsi.state == QuestState.ExperimentComplete` (re-entry / dirty-recovery path).

The only end-to-end completion test (`tests/test_experiment_stop_conditions.py::ExperimentAdvanceStopTests`) drives the manual `/advance_quest` path through `advance_v2_top_level_step_without_harness`, not `run_quest_v2`. The `run_quest_v2` finalization logic is a separate, parallel implementation of the same stop/commit/source-metadata behavior, so the advance-path test does not transitively cover it.

## Why this is a problem

The physical plan Validation Expectations explicitly require:

- A run with an experiment id stops after reaching `SliceCompletedNode` when configured.
- The experiment worktree state becomes `ExperimentComplete`.
- The source metadata update commit is created with the expected message.

These target the run path (`run_quest_v2`), which is what dashboard/landing flows invoke. A regression in `_maybe_finalize_experiment_after_step` or in the `ExperimentComplete` early-return would ship undetected.

## What must be true to close

A test that drives `run_quest_v2` (or `QuestService.run_quest`/`_run_quest_locked`) with an `ExperimentRunContext` such that a committed step reaches the configured stop condition, asserting:

- returned payload has `status == "experiment_complete"` and `quest_state == "ExperimentComplete"`;
- experiment worktree quest `state.md` is `ExperimentComplete` (with `global_step` preserved);
- source `experiment.json` becomes `experiment_complete` with `completed_at` and the `experiment-complete: ...` source commit exists.

Plus coverage of the early-return: invoking the run path again on a worktree already in `ExperimentComplete` returns `experiment_complete` without executing further steps.

(If driving the harness in-test is impractical, a focused unit test of `_maybe_finalize_experiment_after_step` with a hand-built `RecursiveSnapshot` covering matched and unmatched cases is an acceptable minimum, but the early-return branch should still be covered.)
- resolution_notes: none

## Issue PL-0002

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-09T01:09:06Z
- updated_at: 2026-06-09T01:17:08Z
- title: Dirty source-checkout human-intervention path is untested
- details: ## Problem

The dirty-source-checkout escalation path is implemented but untested. When an experiment reaches its stop condition and the source checkout has uncommitted changes, `complete_experiment_source_metadata(...)` raises `ExperimentSourceCheckoutDirty`, and `quest_service._apply_experiment_source_completion(...)` catches it, writes `human_intervention_request.md` into the experiment worktree quest dir, and returns `status="human_intervention"` with `reason="experiment_metadata_update_failed"`.

No test exercises this branch. `tests/test_experiment_stop_conditions.py::ExperimentSourceMetadataTests` only covers the clean-checkout success path of `complete_experiment_source_metadata`.

## Why this is a problem

The physical plan calls this out explicitly:

> Avoid committing source metadata from a dirty source checkout. If source metadata update fails because the source checkout is dirty, write a clear `human_intervention_request.md` in the experiment worktree and return human-intervention status with the failed metadata update reason.

This is a data-safety guard (it prevents committing unrelated dirty source changes alongside the experiment metadata update). An untested guard can silently regress — e.g. the porcelain check is reordered after the file write, or the exception type changes — and the failure mode is committing unintended source-checkout changes.

## What must be true to close

A test that sets up an experiment at its stop condition with a deliberately dirty source checkout (an uncommitted/untracked change in `source_repo_root`) and asserts:

- the completion call returns `status == "human_intervention"` with `reason == "experiment_metadata_update_failed"`;
- a `human_intervention_request.md` is written into the experiment worktree quest dir;
- no `experiment-complete: ...` commit was created on the source checkout and `experiment.json` status was not changed to `experiment_complete`.

A direct unit test asserting `complete_experiment_source_metadata` raises `ExperimentSourceCheckoutDirty` on a dirty source (and makes no commit) is acceptable as the core of this.
- resolution_notes: none

## Issue PL-0003

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-09T01:09:06Z
- updated_at: 2026-06-09T01:17:09Z
- title: complete_experiment_source_metadata is not idempotent on re-completion
- details: ## Problem

`complete_experiment_source_metadata(...)` is not idempotent when invoked against an experiment that is already `experiment_complete`. It unconditionally:

1. computes a fresh `completed_at = utc_now_iso()`,
2. calls `update_experiment_status(..., "experiment_complete", completed_at=...)`, overwriting the existing `completed_at`,
3. `git add` + `git commit -m "experiment-complete: ..."`, creating another commit.

This branch is reachable: both `advance_quest` (via `advance_v2_top_level_step_without_harness` returning `kind="completed"` with `next_quest_state == "ExperimentComplete"`) and `run_quest_v2` (via the `ExperimentComplete` early-return) call `_apply_experiment_source_completion(...)` whenever the worktree is already `ExperimentComplete`. So re-triggering a run/advance on an already-completed experiment:

- resets `completed_at` to a new timestamp, and
- creates a redundant `experiment-complete: <...>` commit on the source checkout each time.

There is also a latent failure: if a re-trigger happens within the same second as the prior completion, `update_experiment_status` writes byte-identical content, nothing is staged, and `git commit` aborts with "nothing to commit", raising an unhandled `CalledProcessError` out of `run_git`.

## Why this is a problem

The dirty-recovery design depends on re-running to retry metadata, so re-entry is an expected, supported flow — it should be safe to call more than once. Today, the happy re-entry produces spurious history (multiple completion commits, drifting `completed_at`) and a small same-second crash window.

## What must be true to close

`complete_experiment_source_metadata` (or its caller) should be idempotent: if the source experiment metadata is already `experiment_complete`, do not rewrite `completed_at` and do not attempt a commit when nothing changed (return the existing/last commit or `None`). Re-invoking the completion on an already-completed experiment must not create additional `experiment-complete:` commits and must not raise. A regression test should call the completion twice and assert exactly one completion commit and a stable `completed_at`.
- resolution_notes: none
