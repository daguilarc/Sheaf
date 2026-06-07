# Issue responses

## Response PR-0001 2026-06-07T08:16:59Z

- issue_id: PR-0001
- outcome: Fixed
- explanation: Transport errors now retain request context through `TransportError` and `_send_request` in `projects/quest-runner/src/quest_runner_service/cli.py`. The CLI prints the underlying transport reason plus `base_url` and `endpoint` before exiting with code 1. `projects/quest-runner/tests/test_cli.py` now asserts that a transport failure includes the resolved base URL and `/advance_quest` endpoint in stderr.

## Response PR-0002 2026-06-07T08:16:59Z

- issue_id: PR-0002
- outcome: Fixed
- explanation: `issues edit --body-file` now uses the existing `_read_text_source` helper in `projects/quest-runner/src/quest_runner_service/cli.py`, so unreadable files are reported as `CliValidationError` messages with exit code 2 instead of uncaught `OSError` tracebacks. `projects/quest-runner/tests/test_cli.py` now covers the missing body-file failure path and verifies no service request is sent.
