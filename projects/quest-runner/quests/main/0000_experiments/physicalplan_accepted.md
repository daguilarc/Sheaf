# Physical Plan Accepted

Reviewed all 7 slice physical plans for quest `main/0000_experiments`
(Experiment System) against `specs/01_experiment_system.md`. Accepted with no
open issues.

## Slices reviewed

1. `0001_experiment_foundation` — shared data model, deterministic
   id/branch/worktree naming, centralized checkout resolver.
2. `0002_experiment_creation` — REST/CLI create, start-step→`<commit>^`
   resolution, stop-node validation, atomic create + partial cleanup.
3. `0003_experiment_scoped_operations` — optional `experiment_id` threaded
   through run/advance/issues/slices/dashboard + agent prompt injection +
   clear missing-worktree error.
4. `0004_experiment_stop_conditions` — `ExperimentComplete` state, recursive
   snapshot stop matching, source-metadata completion update with
   dirty-checkout guard.
5. `0005_experiment_landing` — archival + push + cleanup with strict ordering
   (push before local delete; no `landed` mark on push/copy failure).
6. `0006_experiment_dashboard` — open + archived experiment views, scoped
   detail reads, Land button routed to `/experiments/land`.
7. `0007_experiment_docs_validation` — docs, schema references, end-to-end
   lifecycle test, dead-path cleanup.

## Why accepted

- **Spec coverage**: Every spec-required behavior (creation, naming,
  start-step replay, scoped execution, prompt id-passing, stop/completion,
  landing archival/push/cleanup, dashboard open/closed views + Land button,
  testing, docs) maps to a slice.
- **Sequencing**: Explicit, correctly ordered dependency chain 1→2→3→4→5→6→7
  with no forward references; cohesive boundaries (not over- or under-sliced).
- **Grounded reuse**: All referenced existing APIs were verified to exist in
  `src/quest_runner_service/` (dashboard_data, dashboard_git, quest_runner_v2,
  state_machine, quest_thread, quest_fs, worktrees, quest_types, issue_service,
  quest_service) — low risk of churn from invented symbols.
- **Design soundness**: canonical stop-condition values shared between slices 2
  and 4 (no alias drift at execution time); `ExperimentComplete` kept out of
  normal quest machine transitions; backward compatibility preserved when
  `experiment_id` is absent; landing failure-ordering matches the spec.

## Notes for implementers (latitude, not blocking)

- `notes.md` is written from the operator-supplied `--notes-file` verbatim;
  the spec's structured start/stop fields are expected to come from the
  operator's note content.
- `created_by` should be populated on create (listed in `ExperimentMeta`).
- `root/slice` + `slice_completed` matches the first slice child completion
  after the start step — correct for single-slice replays; documented behavior
  for multi-slice cases.

Reviewer: physical_plan_reviewer
