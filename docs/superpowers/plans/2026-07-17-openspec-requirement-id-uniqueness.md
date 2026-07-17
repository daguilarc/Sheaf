# OpenSpec Requirement ID Uniqueness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair duplicate requirement identifiers within live OpenSpec capability files and prevent future collisions.

**Architecture:** A repository-level unittest scans requirement headings in every live capability spec and reports IDs repeated within the same file. Live requirements are renumbered minimally according to introduction provenance; archived OpenSpec deltas remain immutable.

**Tech Stack:** Python 3 standard-library `unittest`, GNU Make, Markdown/OpenSpec.

## Global Constraints

- Keep the first live use of `spm-69` and `spm-70` unchanged.
- Rename the later uses to `spm-80` and `spm-81` respectively.
- Do not edit `openspec/changes/archive/`.
- Enforce uniqueness within each live `openspec/specs/**/spec.md` file, not globally across capability files.
- Preserve the requirement that acquired a collided ID first and assign the later-introduced requirement the capability's next unused ID.

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

- [x] **Step 3: Commit and land linearly**

Commit the focused change, rebase it onto current `main`, fast-forward `main`,
push `main`, and preserve the harness-owned worktree. No service rebuild or
redeploy is required because only specifications, documentation, tests, and a
Makefile validation target change.

### Task 4: Generalize the guard and repair remaining live collisions

**Files:**
- Modify: `tests/openspec_requirement_ids_test.py`
- Modify: `openspec/specs/agents-skill-distribution/spec.md`
- Modify: `openspec/specs/sheaf-chat-agent-review-mode/spec.md`
- Modify: `openspec/specs/synth-app-runtime/spec.md`

**Interfaces:**
- Consumes: Requirement headings shaped as `### Requirement: <id> ...` in live capability specs.
- Produces: Per-file uniqueness diagnostics with source locations.

- [ ] **Step 1: Generalize the test and verify the red state**

Scan every live capability spec, group IDs by file, and run the focused test.
Expected: failure listing only `asd-20`, `arm-12`, and `sar-18`.

- [ ] **Step 2: Apply provenance-preserving renumbering**

Rename xagent `asd-20` to `asd-23`, logging `arm-12` to `arm-34`, and portable
UI `sar-18` to `sar-24`. Update live references if present; do not edit archive
artifacts.

- [ ] **Step 3: Verify and land**

Run `make openspec-check`, `openspec validate --all --json`, the full root test
suite, and Git diff checks. Commit, rebase onto current `main`, fast-forward
`main`, push, and remove the temporary branch while preserving the managed
worktree and user-owned untracked files.
