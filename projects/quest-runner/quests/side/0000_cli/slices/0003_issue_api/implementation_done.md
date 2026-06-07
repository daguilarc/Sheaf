# Implementation complete

Slice `0003_issue_api` is implemented.

## Summary

- Added `issue_service.py` with `IssueScope`, `IssueContext`, scope/path resolution, validation, and markdown-backed list/read/create/edit/respond operations for physical plan (`QP`) and polishing (`PL`) issues.
- Extended `quest_fs.py` with `atomic_write_text`, shared `read_issue_responses` / `append_issue_response`, and atomic issue writes.
- Added `IssueResponseEntry` to `quest_types.py` and refactored `dashboard_data.py` / `dashboard_slice.py` to reuse the shared response parser.
- Wired `QuestService` issue methods with worktree-aware checkout and run-lock protection on mutations.
- Added REST routes: `GET/POST /api/issues`, `GET/PATCH /api/issues/<id>`, `GET/POST /api/issues/<id>/responses`.
- Added `tests/test_issue_api.py` and response round-trip coverage in `tests/test_quest_fs_core.py`.

All 212 project tests pass (`make -C projects/quest-runner test`).
