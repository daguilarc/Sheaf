# Issue responses

## Response PL-0001 2026-06-09T22:20:34Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Removed the superseded role-name runner helpers and stale prompt/runtime-context builders from quest_runner.py and quest_thread.py, removed legacy tests that pinned them, retargeted experiment guidance coverage to workflow-profile preamble rendering, and updated the workflow reference docs to describe profile-based prompt assembly.

## Response PL-0002 2026-06-09T22:20:34Z

- issue_id: PL-0002
- outcome: Fixed
- explanation: Changed the harness-config loader test to use a temporary repository fixture with a known config/quest-runner.json instead of asserting a developer-machine absolute cli_path from the live repo-root config.
