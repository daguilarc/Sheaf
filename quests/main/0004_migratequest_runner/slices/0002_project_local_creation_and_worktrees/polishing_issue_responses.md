# Issue responses

## Response PR-0001 2026-06-07T02:47:06Z

- issue_id: PR-0001
- outcome: Fixed
- explanation: Threaded `project` through the deferred retry path in `projects/quest-runner/src/quest_runner_service/quest_service.py`: `_run_quest_locked` now accepts the project, passes it into `_schedule_deferred_quest_run`, records it in the deferred task description, and the deferred callback calls `run_quest(..., project=project, ...)`. Both direct `run_quest` and background `schedule_run_quest` now pass the project into `_run_quest_locked`. Added `test_deferred_retry_preserves_project` in `projects/quest-runner/tests/test_quest_creation.py` to simulate a `rate_limit` `QuestHarnessError`, capture the scheduled callback, and assert the retry calls `run_quest` with the original project.
