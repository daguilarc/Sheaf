# OpenSpec Requirement ID Uniqueness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the duplicate live `spm-*` requirement identifiers and prevent future live-spec collisions.

**Architecture:** A repository-level unittest scans `spm-*` headings in the live `synth-parameter-modulation` spec and reports every duplicated ID with source locations. The live spec and current coverage references are renumbered minimally; archived OpenSpec deltas remain immutable.

**Tech Stack:** Python 3 standard-library `unittest`, GNU Make, Markdown/OpenSpec.

## Global Constraints

- Keep the first live use of `spm-69` and `spm-70` unchanged.
- Rename the later uses to `spm-80` and `spm-81` respectively.
- Do not edit `openspec/changes/archive/`.
- Scan only the live `openspec/specs/synth-parameter-modulation/spec.md` capability.

---

### Task 1: Add the live-spec uniqueness guard

**Files:**
- Create: `tests/openspec_requirement_ids_test.py`
- Modify: `Makefile`

**Interfaces:**
- Consumes: Markdown headings shaped as `### Requirement: spm-<number> ...`.
- Produces: `make openspec-check`, returning nonzero with all duplicate IDs and locations.

- [x] **Step 1: Write the failing test**

Create a unittest that scans the live `synth-parameter-modulation` spec,
records matching `spm-*` heading IDs and line numbers, and asserts that no ID
has multiple occurrences.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `python3 -m unittest tests/openspec_requirement_ids_test.py`

Expected: failure listing both `spm-69` and `spm-70` with their two live source
locations.

- [x] **Step 3: Wire the check into Make**

Add an `openspec-check` target that runs the focused unittest. Invoke that
target from the root `test` recipe while preserving the existing behavior of
running every project test even when one project fails.

### Task 2: Repair the live traceability IDs

**Files:**
- Modify: `openspec/specs/synth-parameter-modulation/spec.md`
- Modify: `projects/synth/docs/coverage.md`
- Modify: `docs/superpowers/plans/2026-07-12-portable-modulator-visualizers.md`

**Interfaces:**
- Consumes: Existing human-readable `spm-*` references.
- Produces: Unique live IDs with visualizer references consistently using `spm-81`.

- [x] **Step 1: Apply the minimal renumbering**

Rename only `Parameter appearance registration` from `spm-69` to `spm-80`
and `UI topology: optional modulator visualizer publication` from `spm-70` to
`spm-81`.

- [x] **Step 2: Update current references**

Change the live coverage row and portable-visualizer implementation-plan
references from `spm-70` to `spm-81`. Do not update archived change artifacts.

- [x] **Step 3: Run focused verification**

Run: `make openspec-check`

Expected: one passing test.

### Task 3: Verify and land

**Files:**
- Verify all modified files above.

**Interfaces:**
- Consumes: Root repository validation and Git landing workflow.
- Produces: A linear commit landed on and pushed from `main`.

- [x] **Step 1: Validate OpenSpec and references**

Run: `openspec validate --all --json`

Expected: every item valid.

Run a live-heading duplicate scan and repository reference search.

Expected: no duplicate live `spm-*` headings; only historical archived files
retain the former IDs for the renamed requirements.

- [x] **Step 2: Review the diff and user-owned files**

Confirm the diff contains only the planned files and leaves the existing
untracked `projects/synth/browser/package-lock.json` and
`projects/synth/miniapp/` untouched.

- [ ] **Step 3: Commit and land linearly**

Commit the focused change, rebase it onto current `main`, fast-forward `main`,
push `main`, and preserve the harness-owned worktree. No service rebuild or
redeploy is required because only specifications, documentation, tests, and a
Makefile validation target change.
