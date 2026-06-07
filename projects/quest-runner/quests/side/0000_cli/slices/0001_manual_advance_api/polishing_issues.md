# Issues

## Issue PL-0001

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-07T07:49:35Z
- updated_at: 2026-06-07T07:54:37Z
- title: Manual ExecuteSlice child snapshot uses machine_name "slice", drifting from the harness path
- details: In `state_machine/v2_step_executor.py`, `_evaluate_quest_advance(...)`
  builds the child `RecursiveSnapshot` for the `ExecuteSlice` branch with a
  hard-coded `machine_name="slice"`. The normal harness path derives the slice
  machine name from `LegacyQuestStateIo._read_slice(...)`, which sets
  `machine_name=f"slice_{slice_dir.name}"` (confirmed by the harness commit at
  HEAD whose child snapshot is `"slice_0001_manual_advance_api"`). As a result,
  for the same logical ExecuteSlice transition, `run_quest` commits emit
  `machine_name="slice_<dir>"` while `advance_quest` commits emit
  `machine_name="slice"`. This metadata is observable: `dashboard_git._snapshot_chain_payload(...)`
  copies `cur.machine_name` into the dashboard history payload, so manual-advance
  steps will render an inconsistent child machine name. The physical plan
  explicitly requires that `run_quest` and `advance_quest` "do not drift", and
  `commit_v2_snapshot_step(...)`/metadata validation do not catch this because
  `validate_parsed_step_commit(...)` never checks child `machine_name`. Note the
  same branch already reads `slice_before = state_io.ReadStateMachineState(slice_dir)`,
  whose `machine_name` is the correct per-slice value, so the correct value is
  already in scope.
- resolution_notes: To mark completed: the manual ExecuteSlice child snapshot must
  carry the same `machine_name` the harness path produces for the same slice
  (e.g. use `slice_before.machine_name` instead of the literal `"slice"`), and a
  test must assert that a manual ExecuteSlice advancement produces a child
  snapshot/commit whose `machine_name` matches the harness convention
  (`slice_<dir>`).
- resolution_notes (verified 2026-06-07T07:54:37Z): Confirmed
  `v2_step_executor.py` now builds the manual ExecuteSlice child snapshot with
  `machine_name=slice_before.machine_name`, matching the harness convention.
  `test_execute_slice_setup_advances_with_slice_machine_name_in_commit` drives the
  real `/advance_quest` route through `commit_v2_snapshot_step` and asserts the
  committed child snapshot `machine_name == "slice_0001_manual"`. Drift resolved.

## Issue PL-0002

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-07T07:49:35Z
- updated_at: 2026-06-07T07:54:37Z
- title: Positive manual ExecuteSlice and QuestDocumenting advance paths are untested
- details: The new tests cover PrePlanning->PhysicalPlanning, Completed no-op,
  missing-worktree, lock contention, missing-project, missing
  `implementation_done.md` (422), and a mocked physical-plan acceptance. However,
  no test exercises a real positive manual ExecuteSlice advancement
  (`SliceSetup`->`Implementing` scaffolding, `Implementing`->`PolishingReview`,
  `PolishingReview`->`Completed`/`PolishingFix`, `PolishingFix`->`PolishingReview`,
  and slice `Completed`->quest `PrepareNextSlice`), and `quest_documenting_next_state(...)`
  has no unit or API coverage at all. The absence of a positive ExecuteSlice test
  is precisely why the PL-0001 `machine_name` drift went undetected. The
  QuestDocumenting manual path additionally has non-trivial base-ref semantics
  (`documenter_base_ref = step_base if QuestDocumenting else ""`, then
  `docs_updated_for_quest(repo, step_base, ...)`) that rely on uncommitted/untracked
  doc edits being present at advance time; this behavior is currently unverified.
- resolution_notes: To mark completed: add tests covering at least one real
  (non-mocked) manual ExecuteSlice advancement through `commit_v2_snapshot_step`
  that asserts the resulting slice state transition and commit, and add coverage
  for `quest_documenting_next_state(...)` (both the docs-changed -> Completed case
  and the docs-unchanged -> validation-failure case, the latter asserting no state
  change and a non-2xx response).
- resolution_notes (verified 2026-06-07T07:54:37Z): Confirmed the following real
  (non-mocked) tests exist and assert the expected behavior:
  `test_execute_slice_setup_advances_with_slice_machine_name_in_commit`
  (SliceSetup->Implementing through the route + commit),
  `test_quest_documenting_advances_when_project_docs_changed`
  (QuestDocumenting->Completed with untracked project docs, asserting commit
  metadata), and `test_quest_documenting_without_doc_changes_returns_422_without_state_change`
  (docs-unchanged 422 asserting quest state, global_step, and HEAD all unchanged).
  Coverage gap resolved.
