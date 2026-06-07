# Issue responses

## Response PL-0001 2026-06-07T07:53:04Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Updated `projects/quest-runner/src/quest_runner_service/state_machine/v2_step_executor.py` so the manual ExecuteSlice child snapshot uses `slice_before.machine_name` instead of the literal `"slice"`. Added `test_execute_slice_setup_advances_with_slice_machine_name_in_commit` in `projects/quest-runner/tests/test_advance_quest_api.py`, which drives the real `/advance_quest` route through `commit_v2_snapshot_step` and asserts the child commit metadata uses `slice_0001_manual`.

## Response PL-0002 2026-06-07T07:53:04Z

- issue_id: PL-0002
- outcome: Fixed
- explanation: Added positive manual advancement coverage in `projects/quest-runner/tests/test_advance_quest_api.py`: `test_execute_slice_setup_advances_with_slice_machine_name_in_commit` verifies a real ExecuteSlice SliceSetup-to-Implementing transition and resulting commit, `test_quest_documenting_advances_when_project_docs_changed` verifies QuestDocumenting-to-Completed with untracked project docs changes, and `test_quest_documenting_without_doc_changes_returns_422_without_state_change` verifies the docs-unchanged validation failure leaves state and HEAD unchanged.
