## Why

The first steady-state `ingest.py` run after `add-sdd-task-analyzer` landed
(merge c72f30bc) surfaced two defects the migrated historical corpus never
exercised:

1. `python3 projects/agents/task-analyzer/ingest.py --dry-run` prints a
   RunReport-shaped JSON with all write counts at zero and no plan
   content, even though `ingest.plan_work()` itself returns a real,
   populated `WorkPlan` (a real run showed 70 new changes, 0 new tasks, 89
   new sessions, 13 agentic gaps). The README's own contract
   ("`--dry-run`: prints the work plan") is unmet — the CLI computes the
   plan but never prints it.
2. Every landed change ingests with **zero tasks**. `_iter_briefs` only
   reads `.superpowers/sdd/<change>/*-brief.md` at the landed ref, but the
   Superpowers SDD workflow treats `.superpowers/` as uncommitted scratch
   and never commits it — so a newly landed change has no discoverable
   briefs, no tasks, and nothing for its session transcripts to join. The
   2026-07-19 migrated corpus only worked because that one-shot extraction
   read live worktree scratch directly, not a committed git ref; it is not
   representative of the steady-state case this project is meant to run
   continuously against.

## What Changes

- `ingest.py --dry-run` now prints the actual `WorkPlan` as JSON (change
  names, task keys, session ids/count, gap items with
  `entity_key`/`kind`/`version`/`reason`, quarantined and unlanded
  entries) instead of an empty RunReport shell.
- When a landed change has no committed briefs at the archive ref, its
  tasks are now derived from its committed Superpowers plan file instead
  (`discovery.landed_changes`'s already-resolved `plan_path`): every
  `Task N:` heading (any markdown heading level; colon required — every
  real task heading across the plans committed on main has one, and it's
  what excludes a plan's own "Task N Review" sub-heading from being
  mistaken for a task boundary) opens a task section running through the
  line before the next heading at the SAME level, whether or not that
  heading is itself a task heading. Real committed briefs, when any exist
  for a change, always take precedence outright over plan derivation for
  that same change (never mixed). A change with neither committed briefs
  nor a resolvable plan file still ingests as a change row with zero
  tasks, exactly as before this fallback existed.

## Impact

- Affected spec: `task-analyzer-data-gathering` (amends the "Idempotent,
  atomic, offline ingestion" requirement).
- Affected code: `projects/agents/task-analyzer/ingest.py` only.
- No schema change, no data semantics change to already-ingested rows;
  this only affects what a *future* ingest run discovers and how a
  dry-run's output is formatted.
