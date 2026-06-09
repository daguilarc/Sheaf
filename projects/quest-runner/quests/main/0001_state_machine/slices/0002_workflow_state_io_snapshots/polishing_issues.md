# Issues

## Issue PL-0001

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-09T21:41:09Z
- updated_at: 2026-06-09T21:43:20Z
- title: Remove dead/duplicated _collection_for_dir helper in workflow_state_io.py
- details: ## What is wrong
`WorkflowStateIo._collection_for_dir` (projects/quest-runner/src/quest_runner_service/state_machine/workflow_state_io.py, lines 124-131) is defined but never called anywhere in src/ or tests/ (verified by grep across the repo). It also duplicates the collection-pattern matching logic already implemented inline in `_machine_key_for_dir` (lines 113-122) via `_path_matches_collection_pattern`.

## Why it is a problem
- Dead code: an unused private method adds maintenance surface and reader confusion in a freshly-introduced module.
- Logic duplication: the same `rel = machine_dir.resolve().relative_to(self.quest_dir)` + collection-pattern loop appears twice, so a future change to collection matching must be kept in sync in two places. The slice review checklist explicitly calls out avoiding unnecessary duplication and keeping the implementation clean/maintainable.

## What must be true to close
Either:
- `_collection_for_dir` is removed entirely (no remaining references), OR
- it is actually used (e.g. `_machine_key_for_dir` is refactored to call it) so the matching logic exists in exactly one place.
Plus: `make -C projects/quest-runner test` still passes after the change.

## Severity
Low — maintainability only; no functional/behavioral defect. Does not block correctness of the slice.
- resolution_notes: none
