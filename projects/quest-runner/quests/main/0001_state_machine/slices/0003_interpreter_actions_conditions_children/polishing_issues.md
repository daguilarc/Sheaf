# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-09T21:52:01Z
- updated_at: 2026-06-09T21:52:01Z
- title: Duplicated collection-pattern matcher across workflow_paths and workflow_state_io
- details: ## What is wrong

`path_matches_collection_pattern` in `state_machine/workflow_paths.py` (lines 18-28) is a byte-for-byte duplicate of `_path_matches_collection_pattern` in `state_machine/workflow_state_io.py` (lines 23-33). Both implement the identical segment-wise glob-vs-path comparison.

## Why it is a problem

The two copies will drift independently. Collection path matching is core to child discovery (`list_collection_children`) and machine-key resolution (`_machine_key_for_dir`); a fix or semantic change applied to one copy but not the other would silently produce divergent child enumeration vs. machine routing. The reviewer checklist explicitly flags unnecessary code duplication.

The duplication is also unnecessary: `workflow_paths` already imports from `workflow_state_io` (`from .workflow_state_io import WorkflowStateIo`), while `workflow_state_io` does NOT import `workflow_paths`. So `workflow_paths` can import and reuse the existing helper from `workflow_state_io` (or both can share a single leaf-level definition) with no circular-import risk.

## What must be true to close

A single canonical implementation of the collection-pattern matcher exists, and both `workflow_paths` and `workflow_state_io` use it (no duplicated body). Existing tests (`test_workflow_interpreter`, `test_workflow_state_io`) still pass.
- resolution_notes: none

## Issue PL-0002

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-09T21:52:05Z
- updated_at: 2026-06-09T21:52:05Z
- title: Genericity not proven by interpreter tests (spec validation bullet)
- details: ## What is wrong

The slice plan lists this validation expectation (plan.md, lines 173-174):

> Tests prove no Python condition branches on the default role names, issue aliases, marker names, or state graph outside the loaded workflow data.

`test_workflow_interpreter.py` only ever exercises the packaged default workflow via `load_packaged_default_workflow()`. There is no test that drives the interpreter with a synthetic workflow using non-default state names, role/profile names, issue file names, or marker file names, and no structural assertion that the interpreter modules contain no hard-coded default identifiers.

## Why it is a problem

Data-driven genericity is the headline goal of this slice (replacing hard-coded `quest_v2_predicates`/`quest_v2_nodes` logic). The implementation is in fact generic by construction (I read `workflow_interpreter.py`, `workflow_conditions.py`, `workflow_actions.py`, `workflow_paths.py` — none branch on default role/state/marker names). However, because every test uses the default workflow, a future regression that reintroduces a hard-coded name (e.g. special-casing `"slices"`, `"Completed"`, or a marker filename) would not be caught by the current suite. The explicit spec bullet is therefore not met.

## What must be true to close

Either:
- Add a focused test that loads a minimal synthetic `WorkflowDefinition` with renamed states, collection, marker files, and at least one role/profile, then runs a transition (and ideally a child step) proving the interpreter behaves purely from the loaded data; or
- A structural test asserting the interpreter modules do not reference default identifiers.

If the polisher believes existing coverage already satisfies the bullet, record a CLI response with the concrete rationale (which test demonstrates genericity) so the reviewer can evaluate it.
- resolution_notes: none
