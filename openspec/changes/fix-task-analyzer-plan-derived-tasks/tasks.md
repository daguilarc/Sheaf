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
  `#+ Task N` headings at any level, skips fenced code blocks, mirrors the
  `subagent-driven-development` skill's `task-brief` script exactly),
  `_iter_plan_derived_briefs` (per-change fallback entry point), and
  `_brief_text_for` (dispatches real-brief-path vs. synthetic
  `<plan_path>#task-N` plan-derived path at both existing brief-fetch call
  sites). Real briefs win outright, per change, whenever any exist.
- [x] 1.3 Tests: dry-run CLI output contract (plan fields present,
  RunReport-shaped write-count fields absent); plan-section parsing unit
  tests (heading-level-agnostic, code-fence skipping, section boundaries,
  no-headings case); plan-derived task discovery integration tests (tasks
  derived with correct keys/text/hashes/brief_path; real briefs win when
  both exist; a change with neither briefs nor a plan ingests with zero
  tasks, quarantine-free). Suite: 313 → 323.

## 2. Spec amendment

- [x] 2.1 Amend `task-analyzer-data-gathering`'s "Idempotent, atomic,
  offline ingestion" requirement: state the dry-run JSON-plan-output
  contract explicitly, and add the plan-derived-briefs fallback (with
  precedence rule) as normative text + two new scenarios.

## Out of scope

- No change to `data/agents/task-analyzer.sqlite` or `.dump.jsonl` — this
  followup does not run ingest/train against the production database (the
  coordinator does that after merge).
- No change to schema, agentic dispatch, or cost derivation.
