## 1. Fix defects

- [x] 1.1 `ingest.py --dry-run` (CLI, not `run()`/`plan_work()` themselves,
  which already returned a populated `WorkPlan`): print the `WorkPlan` as
  JSON instead of a RunReport shell of all-zero write counts. Full lists
  for changes/tasks/gaps; a session-count cutoff (`_DRY_RUN_SESSION_LIST_LIMIT`)
  falls back to count + a short sample for a very large `new_sessions`
  list, documented in code and README.
- [x] 1.2 `_discover`: when a landed change has zero committed briefs at
  the ref, derive its tasks from its committed Superpowers plan file
  (`LandedChange.plan_path`) instead — `_task_sections_from_plan` (parses
  `Task N:` headings, colon required, at any level, skips fenced code
  blocks; a section closes at the next SAME-level heading, whether or not
  it's itself a task heading — see task 1.4), `_iter_plan_derived_briefs`
  (per-change fallback entry point), and `_brief_text_for` (dispatches
  real-brief-path vs. synthetic `<plan_path>#task-N` plan-derived path at
  both existing brief-fetch call sites). Real briefs win outright, per
  change, whenever any exist.
- [x] 1.3 Tests: dry-run CLI output contract (plan fields present,
  RunReport-shaped write-count fields absent); plan-section parsing unit
  tests (heading-level-agnostic, code-fence skipping, section boundaries,
  no-headings case); plan-derived task discovery integration tests (tasks
  derived with correct keys/text/hashes/brief_path; real briefs win when
  both exist; a change with neither briefs nor a plan ingests with zero
  tasks, quarantine-free). Suite: 313 → 323.
- [x] 1.4 Fix round 1 (codex re-review, Important finding): the original
  rule closed a task's section at the next TASK heading of any number,
  not the next heading at the SAME level — real corpus case
  (`docs/superpowers/plans/2026-06-26-add-synth-midi-controller-io.md`,
  a plan-only change) has `### Task 1 Review` before `### Task 2`, which
  folded the review section into task 1's brief_text. Fixed: require a
  colon immediately after the task number (every real task heading on
  main has one; surveyed 362 of them, zero exceptions) so `Task N Review`
  is never itself a task heading, AND close a section at the next
  same-level heading regardless of whether it's a task heading. Rewrote
  the unit tests to encode the corrected rule; added a regression fixture
  modeled on the real midi-controller-io plan shape. Sanity-checked every
  plan committed on main (77 files, read-only via `git show`): zero plans
  have task-like headings the strict matcher misses entirely. Suite:
  323 → 328.

## 2. Spec amendment

- [x] 2.1 Amend `task-analyzer-data-gathering`'s "Idempotent, atomic,
  offline ingestion" requirement: state the dry-run JSON-plan-output
  contract explicitly, and add the plan-derived-briefs fallback (with
  precedence rule) as normative text + two new scenarios.
- [x] 2.2 Fix round 1: corrected the requirement text and scenario to
  describe the colon-required, same-level-closing rule instead of the
  original (buggy) "next Task heading of any number" rule; added a
  scenario for the review-sub-section exclusion.

## Out of scope

- No change to `data/agents/task-analyzer.sqlite` or `.dump.jsonl` — this
  followup does not run ingest/train against the production database (the
  coordinator does that after merge).
- No change to schema, agentic dispatch, or cost derivation.
