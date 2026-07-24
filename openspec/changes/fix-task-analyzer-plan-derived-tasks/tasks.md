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

## 3. Evidence-based join + residue healing (followup-7, defect 1)

- [x] 3.1 `_has_change_evidence(rec, landed_change, keys)`: a session joins
  a specific change only via affirmative evidence in its own prompt --
  reusing `discovery.task_keys()`'s own `change_dir`/`openspec_change`/
  `plan` extraction, plus a raw `.superpowers/sdd/<name>/` substring check
  (broader than `task_keys`'s own brief-suffix regex, which misses
  reviewer/auditor sessions referencing sibling files like
  `-review-package.md`).
- [x] 3.2 `_discover`: join evidence (`all_briefs`/`all_brief_index`) is
  now computed over the FULL landed set always, never narrowed by
  `--change`; `--change` continues to narrow only `briefs` (what actually
  gets ingested this run) via `in_scope_names`. The per-session join loop
  quarantines with `"no change evidence for task key"` when zero
  candidates have evidence, `"task key matches >1 task"` when more than
  one does (now meaning real multi-change evidence, not mere task_key
  collision).
- [x] 3.3 `run()`: a healing pass, after the per-task loop and
  new-quarantined writes, reconciles any already-committed session whose
  stored `task_id` disagrees with the current evidence-based join/
  quarantine outcome (computed over the same full-universe `disc.joined`/
  `disc.quarantined_sessions`) -- heals to the correct `task_id`, or to
  NULL when the correct target task doesn't exist in the DB yet (a later
  run that ingests it heals again). `RunReport.healed_sessions`/
  `healed_session_ids` surface it; captured in `ingest_log` when nonzero.
- [x] 3.4 Tests: scoped-vs-unscoped identical join/quarantine outcome
  (regression for the actual canary bug); the two new evidence sources
  (plan-path mention, SDD-dir substring without an exact brief suffix);
  the "no evidence" vs "matches >1 task" reason split; a healing-pass test
  simulating pre-fix residue (a session wrongly joined the way the old
  scope-narrowing bug would have) that heals on re-run and stays healed
  (idempotent) on a further re-run. Suite: 328 → 333 (defect 1 alone).
- [x] 3.5 Verified live against the real corpus (read-only, no `data/`
  writes): of 1714 session files scanned, 363 quarantine, 100% for "no
  change evidence for task key" (0 for the multi-evidence reason -- no
  session in the real corpus names more than one change) -- confirmed
  byte-identical scoped vs. unscoped. Under `--change
  add-sdd-task-analyzer`, only 6 sessions (one implementer session per
  task, tasks 2/4/5/6/9/10) actually evidence-join, versus the canary's
  ~75 false joins -- see followup-7-report.md for the full breakdown and
  what this project's own dev sessions (referencing the
  `.superpowers/sdd/task-analyzer/` alias, not the real change name) are
  expected to keep quarantining under, unaffected by this fix.

## 4. Scorer-decline robustness (followup-7, defect 2)

- [x] 4.1 `prompts/grading.md`: the Output section now requires a file for
  every item always, defining a second valid "Ungradeable" shape (all
  G1-G5/verdict_sequence/rounds_to_accept/final_grade/evidence null,
  severity counts 0, `reviewer_models` empty, `excluded_reviews` listing
  everything excluded, plus a `reason` string) for when nothing in an item
  is gradeable. `complexity.md`/`phase-labeling.md` reviewed and left
  unchanged -- neither has an analogous "nothing to score" failure mode
  (their inputs are always well-formed once the underlying task/session
  row exists; only grading's input can be entirely mis-joined reviewer
  text).
- [x] 4.2 `agents.py`: `_validate_output`'s required-key check already
  accepts the ungradeable shape as-is (it only checks key presence, never
  value types) -- documented explicitly in `_REQUIRED_KEYS`'s comment; no
  behavior change.
- [x] 4.3 `ingest.py` `_resolve_gap`: a staged grading result carrying a
  non-empty `reason` key is recorded durably WITHOUT a `grades` row
  (`RunReport.ungradeable`/`ungradeable_items`, surfaced in `ingest_log`)
  and the gap is treated as resolved for this call -- the durable record
  is the staged JSON file itself (found again, byte-identically handled,
  on any future run over unchanged input). A dispatch that produces no
  valid staged file at all now fails only that item by default
  (`RunReport.failed`/`failed_items`, gap left open for a future run)
  instead of raising; a new `--strict` CLI flag (default off) restores the
  prior abort-the-whole-run `RuntimeError`. A missing `agent_runner`
  itself (misconfiguration, not a per-item outcome) still always raises.
- [x] 4.4 Tests: `agents.py` accepts + stages the ungradeable shape on the
  first attempt (no spurious retry); `ingest.py` -- a decline with no
  output fails only that item and the run continues by default, raises
  under `--strict`, and rolls back only that task's transaction the same
  way a genuine crash already did; an ungradeable result is recorded
  without a `grades` row, the run continues, other kinds for the same task
  still land, and it's idempotent (no re-dispatch, no re-recording drift)
  across re-runs. Suite: 333 → 340.

## 5. Canary residue check (followup-7)

- [x] 5.1 Checked this worktree's own `data/agents/task-analyzer.sqlite`
  (read-only; never written to this followup, per the "data/ untouched"
  constraint) for `add-sdd-task-analyzer` residue from the failed canary:
  zero rows found (no `changes`/`tasks`/`sessions`/`grades`/`complexity`
  rows for it, `ingest_log` has no entries mentioning it) -- the canary
  evidently ran in a different checkout (its `staging/grading/_work/...`
  diagnostic artifacts and `data/agents/task-analyzer.sqlite` both live
  under the main checkout at `/Users/joyo/Sheaf`, outside this worktree
  and inaccessible to it). No healing was needed here; the general
  mechanism (task 3.3) still applies wherever the coordinator eventually
  re-runs ingest for real.

## Out of scope

- No change to `data/agents/task-analyzer.sqlite` or `.dump.jsonl` in
  THIS worktree -- this followup does not run a real ingest/train against
  the production database (the coordinator does that after merge); the
  read-only real-corpus checks in 3.5/5.1 opened connections against an
  in-memory `:memory:` database and the real session corpus only, never
  the worktree's committed `data/` files.
- No change to schema, cost derivation, or the complexity/phase_labeling
  agentic contracts.
