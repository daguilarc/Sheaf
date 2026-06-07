# Implementation accepted

Slice `0003_issue_api` is accepted by the polisher reviewer with no open polishing
issues.

## What was reviewed

- `issue_service.py`: scope parsing, slice/path resolution, id validation, and
  list/read/create/edit/respond/list-responses operations for `physicalplan` (`QP`)
  and `polishing` (`PL`) scopes.
- `quest_fs.py`: `atomic_write_text`, shared `read_issue_responses` /
  `append_issue_response`, and atomic issue writes.
- `quest_service.py`: worktree-aware context resolution and run-lock acquisition on
  mutations only (reads are lock-free).
- `api.py`: `GET/POST /api/issues`, `GET/PATCH /api/issues/<id>`,
  `GET/POST /api/issues/<id>/responses`, with error handlers mapping to 400/404/409.
- `dashboard_data.py` / `dashboard_slice.py`: refactored to reuse the shared
  response parser.
- Tests: `tests/test_issue_api.py` and the response round-trip in
  `tests/test_quest_fs_core.py`.

## Verification notes

- Scope rules match the spec: `physicalplan` rejects `slice` (400), `polishing`
  requires `slice` (400), id prefixes `QP`/`PL`, owner roles defaulted correctly.
- Mutation lock behavior is correct: when the worktree exists, mutations acquire the
  same run-lock used by `run_quest` and return 409 on contention; when the worktree
  is absent, mutations operate on the source checkout so pre-worktree planning issues
  can still be created. Read endpoints never acquire the lock.
- Response markdown round-trips (including multi-line explanations) and matches both
  the bundled `schemas/issue-responses.md` format and the existing real
  `slices/0001_manual_advance_api/polishing_issue_responses.md`, so dashboard readers
  remain compatible.
- Create/edit accept `body` (with `details` fallback) and surface both `body` and
  `details` in JSON, per spec.
- Test coverage matches the spec's validation expectations (status filters, 404 for
  missing ids, default status/owner/prefix on create, omitted-field preservation and
  timestamp update on edit, invalid-status/outcome/empty-explanation rejection,
  chronological filtered responses, scope/slice validation, 409 under lock, and the
  pre-worktree mutation path).

## Minor non-blocking observation

There is no dedicated test that edits `title`/`body` to new values (or exercises the
edit-time empty-title/empty-body rejection branches). The create path already covers
title/body rendering and round-trip, and the edit assignment/validation logic is
symmetric, so this is a low-risk coverage gap and does not block acceptance.
