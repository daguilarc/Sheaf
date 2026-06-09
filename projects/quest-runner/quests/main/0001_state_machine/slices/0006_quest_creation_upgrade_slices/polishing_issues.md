# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-09T22:47:40Z
- updated_at: 2026-06-09T22:47:40Z
- title: Slice-init collection selection paths (explicit/multiple) are untested
- details: ## What is wrong

The slice adds a new public `slices init --collection <name>` flag and a
`resolve_workflow_collection()` selector (workflow_scaffold.py) with these
branches:

1. explicit name found -> returns that collection
2. explicit name missing -> raises ValueError -> wrapped as InvalidQuestInput
3. no collections declared -> ValueError
4. exactly one collection -> default to it
5. multiple collections, none specified -> validation error listing names

Only branch (4) is exercised by tests. The default packaged workflow declares
exactly one collection (`slices`), so no existing test ever passes a non-None
`--collection` or a workflow with multiple collections. Branches (1), (2), (3),
and (5) — including the new CLI flag's primary non-default path — have zero
direct coverage.

## Why it is a problem

The slice spec's "Validation Expectations" explicitly enumerate slice-init tests
that "cover default collection, explicit collection, multiple-collection error,
... and experiment worktree operation." Two of those (explicit collection,
multiple-collection error) are absent. The selection/validation logic is new
user-facing behavior wired through CLI -> API -> service; a future regression
(e.g. a broken error message, mis-wrapped exception, or wrong KeyError handling)
would not be caught. The code currently looks correct on inspection, so this is
a test-sufficiency gap, not a known defect.

## What must be true to close

Add slice-init test coverage (e.g. in test_workflow_upgrade.py or
test_quest_service_api.py) that, using a workflow fixture with the relevant
collections:

- passes an explicit valid `--collection`/`collection=` and asserts the returned
  `collection` and scaffold files match that collection;
- passes an unknown collection name and asserts a clear validation error
  (InvalidQuestInput / 400) is raised;
- uses a workflow declaring multiple collections with no collection specified and
  asserts the multiple-collection validation error is raised.

(The single-collection default and created_files order are already covered and
need no additional work.)
- resolution_notes: none
