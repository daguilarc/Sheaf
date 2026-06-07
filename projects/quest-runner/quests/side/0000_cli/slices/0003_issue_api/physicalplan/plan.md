# Issue REST APIs

## Objective

Add REST APIs for listing, reading, creating, editing, responding to, and listing responses for quest issues while preserving the existing markdown files as storage. The API hides schema details from agents and humans while keeping dashboard readers compatible.

Expected outcome: both physical plan issues and polishing issues can be managed through stable JSON endpoints with validation, safe writes, and active-run protection.

## Sequencing

This slice is independent of manual advancement and landing, but it must be complete before the CLI issue commands in slice `0004_cli`.

## Key Files And Systems

- `projects/quest-runner/src/quest_runner_service/api.py`
- `projects/quest-runner/src/quest_runner_service/quest_service.py`
- `projects/quest-runner/src/quest_runner_service/quest_fs.py`
- New module, for example `projects/quest-runner/src/quest_runner_service/issue_service.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_data.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_slice.py`
- `projects/quest-runner/src/quest_runner_service/quest_types.py`
- `projects/quest-runner/tests/test_quest_fs_core.py`
- `projects/quest-runner/tests/test_quest_service_api.py`

## Existing APIs To Reuse As-Is

- `quest_fs.read_issues(...)` and `quest_fs.write_issues(...)` for issue markdown parsing and rendering.
- `IssueEntry` from `quest_types.py` as the underlying issue record.
- Existing response parsing concepts in `dashboard_data.read_physicalplan_issue_responses(...)` and `dashboard_slice.read_polishing_issue_responses(...)`.
- Quest lookup and validation patterns from `dashboard_data.resolve_quest_dirs(...)` for read-only resolution.
- Quest worktree metadata helpers from `worktrees.py` to prefer the worktree when it exists.

## APIs To Extend Or Modify

### Issue service module

Create an issue-focused service module that owns scope validation, path resolution, markdown parsing/rendering, and response-file writes. Suggested concepts:

- `IssueScope`: `physicalplan` or `polishing`.
- `IssueContext`: source root, quest identity, chosen checkout root, quest dir, optional slice dir, issue path, response path, id prefix, owner role.
- `IssueResponseEntry`: `issue_id`, `response_timestamp`, `outcome`, `explanation`.

Scope/path rules:

- `scope=physicalplan` uses quest-root `physicalplan_issues.md`, response file `physicalplan_issue_responses.md`, id prefix `QP`, and default `owner_role: physical_plan_reviewer`.
- `scope=polishing` requires `slice`; resolve numeric slice values to an existing `slices/<NNNN>_*` directory, use `polishing_issues.md`, response file `polishing_issue_responses.md`, id prefix `PL`, and default `owner_role: polisher_reviewer`.
- Reject `slice` for `physicalplan` unless it is absent or empty.
- Return empty issue/response lists for absent files, but create files on mutation.

Data shape:

- Issue JSON should include `issue_id`, `status`, `owner_role`, `created_at`, `updated_at`, `title`, `body`, `details`, and `resolution_notes`. `body` and `details` should both reflect `IssueEntry.details`; accept `body` in create/edit request bodies.
- Response JSON should include `issue_id`, `response_timestamp`, `outcome`, and `explanation`.

Mutation rules:

- New issue ids use the next integer for the scope prefix already present in the file, formatted as `QP-0001` or `PL-0001`.
- `status` defaults to `open`; valid statuses are only `open` and `completed`.
- `title` and `body` must be non-empty on create.
- Edit preserves omitted fields and updates `updated_at`.
- Respond requires `outcome` `Fixed` or `NotFixed` and non-empty `explanation`.
- Respond appends to the response file and does not edit issue status.
- Writes should be atomic: add an atomic write helper in `quest_fs.py` or use a temporary sibling file plus `replace(...)` inside the issue service. Preserve UTF-8 and final newline.

Active-run protection:

- For issue mutations, resolve the quest and expected worktree. If the worktree exists, operate in that checkout and attempt to acquire the same run-lock key used by `run_quest`; if the lock is held, return `409 Conflict`.
- If the worktree does not exist, operate on the source quest directory so read/list still work and a human can create or close planning issues before a worktree exists.
- Read-only list/read/response-list endpoints do not need to acquire the run lock.

### API routes

Add routes:

- `GET /api/issues`
- `GET /api/issues/<issue_id>`
- `POST /api/issues`
- `PATCH /api/issues/<issue_id>`
- `POST /api/issues/<issue_id>/responses`
- `GET /api/issues/<issue_id>/responses`

All routes must validate `project`, `quest_type`, `quest_number`, `scope`, `slice` where applicable, and issue id format. Return JSON errors for invalid input and `404` when a requested issue id does not exist in the selected scope.

## Enabling Refactor

Move duplicated response parsing from dashboard modules into the new issue service or a shared parser in `quest_fs.py`. Update dashboard payload functions to reuse the shared response parser so API and dashboard behavior stay consistent.

Do not change the markdown schema. Existing dashboard issue cards must continue to render from the same files.

## Validation Expectations

Add tests for physical plan and polishing scopes:

- List returns all issues by default and supports `status=open|completed|all`.
- List returns an empty list for absent files.
- Read returns one issue with matching responses and returns `404` for missing ids.
- Create produces canonical markdown with the right id prefix, owner role, timestamps, title, details/body, and default status.
- Edit updates `status`, `title`, and `body`, preserves omitted fields, updates timestamp, and rejects invalid status.
- Respond appends a response, rejects invalid outcome or empty explanation, and does not change issue status.
- Response list returns only responses for the requested issue in chronological order.
- Polishing issue APIs require `slice`; physicalplan rejects unexpected slice.
- Mutation endpoints return `409` while the quest run lock is held.
- Existing dashboard issue tests still pass after response parsing is shared.

Run:

```text
make -C projects/quest-runner test
```
