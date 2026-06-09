# Implementation Complete: Slice 0007 Issue File CLI And API

## Summary

Replaced scope-based issue operations with workflow-declared issue file paths across the runner.

- `issue_service.py`: added `parse_issue_file()` and `resolve_issue_context_by_file()`; removed `IssueScope`, `parse_scope()`, `parse_optional_slice()`, and scope-based `resolve_issue_context()`. `IssueContext` now carries `issue_file` and `workflow_issue_alias`; response paths derive from `_issues.md` → `_issue_responses.md`.
- `workflow_config.py`: workflow version 1 requires `id_prefix` (two uppercase ASCII letters) on every issue declaration.
- `quest_service.py`, `api.py`, `cli.py`: all issue commands/endpoints require `--file` / `issue_file`; optional `--owner` / `owner_role` on create; legacy `scope` and `slice` parameters removed.
- Tests: updated `test_cli.py`, `test_issue_api.py`, `test_experiment_scoped_operations.py`; added `test_issue_file_resolution.py`.

All targeted tests pass (110 tests in the slice test suite).
