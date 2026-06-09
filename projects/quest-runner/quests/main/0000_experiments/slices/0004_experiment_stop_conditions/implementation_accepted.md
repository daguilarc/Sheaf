# Implementation Accepted

Slice `0004_experiment_stop_conditions` is accepted.

## Scope reviewed

Experiment runs now stop at their configured workflow graph node, persist
`ExperimentComplete` in the experiment worktree, update source `experiment.json`
to `experiment_complete`, and return a distinct `experiment_complete` run status
for dashboard and landing flows.

Reviewed the slice changeset (commit range `fe579ed..HEAD`) against the physical
plan:

- `QuestState.ExperimentComplete` added; round-trips in legacy + normalized
  `state.md` (written to `quest_dir/state.md`, correctly staged by the finalizing
  commit).
- `snapshot_matches_stop_condition` walks root + child snapshots and matches node
  names (direct, class-name, lowercase, `state_after`) with `root/quest` /
  `root/slice` / concrete-path scoping.
- Both the synchronous run path (`run_quest_v2` →
  `_maybe_finalize_experiment_after_step` and the `ExperimentComplete`
  early-return) and the manual `advance_quest` path finalize worktree state,
  commit it, and apply source-metadata completion.
- Dirty source checkout escalates to `human_intervention_request.md` rather than
  committing unrelated source changes.
- Normal (non-experiment) quest behavior remains gated behind
  `experiment_run is not None`.

## Issue history

Three polishing issues were raised in the first review cycle and all resolved and
verified in the second:

- **PL-0001** — added `QuestService.run_quest` coverage exercising
  `run_quest_v2` stop finalization (state/source-commit/`global_step` preserved)
  and the `ExperimentComplete` re-entry early-return (zero steps, no new commits).
- **PL-0002** — added run-path coverage for a dirty source checkout, asserting
  `human_intervention` with `reason=experiment_metadata_update_failed`, the
  worktree intervention request, and unchanged source metadata.
- **PL-0003** — `complete_experiment_source_metadata` is now idempotent (returns
  `None` without rewriting/committing when already `experiment_complete`), with a
  regression test confirming a stable `completed_at` and a single completion
  commit across repeated calls.

No open issues remain.
