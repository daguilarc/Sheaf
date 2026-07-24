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

Followup-7 (the first real canary ingest against the live corpus) surfaced
two more defects, folded into this same open change per the coordinator's
direction rather than opening a new one:

3. `ingest.py --change <name>` narrowed `brief_index` to that one change,
   so ANY session merely mentioning a task_key (e.g. "implement task 1")
   joined it outright, with zero affirmative evidence it was actually
   about that change — harmless-looking under `--change` (only one
   candidate survives scope narrowing, so it reads as "unambiguous"), but
   wrong: unscoped, the same session is genuinely ambiguous across every
   other landed change sharing that task_key and should quarantine. The
   canary (`--change add-sdd-task-analyzer`) joined ~75 unrelated sessions
   this way; the grading agent correctly refused to grade the resulting
   mash of unrelated reviews.
4. The grading prompt's contract implicitly permitted silently skipping an
   item's output file when nothing in it was gradeable (e.g. every review
   joined to a task was itself a mis-join, as above). `ingest.py`
   unconditionally raised when a dispatched agent produced no staged file,
   treating a correct "nothing to grade" decline exactly like a crashed
   subprocess — aborting the whole run, including every other task's
   perfectly good work.

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
- Session-to-task joining is now evidence-based, computed over the FULL
  landed-change universe always (never narrowed by `--change`): a session
  joins `(change, task_key)` only when its own prompt affirmatively names
  that change (its change_dir/openspec-change key, its plan file, or its
  SDD brief directory path). `--change` continues to filter which of the
  resulting joins get ingested this run, but never changes the join/
  quarantine outcome itself. A session with a recognized task_key but no
  change evidence quarantines with a new reason, `"no change evidence for
  task key"`, distinct from the pre-existing `"task key matches >1 task"`
  (now reserved for real multi-change evidence, not mere task_key
  collision). A run also now heals any already-committed session whose
  stored `task_id` disagrees with today's evidence-based outcome (residue
  from a run predating this fix), converging idempotently.
- A grading result where nothing was gradeable is no longer indistinguish-
  able from a crash: `prompts/grading.md` now requires an output file for
  every item always, with an explicit "ungradeable" shape (null grade
  fields, a `reason` string) when nothing in it can be graded. `ingest.py`
  records that result durably (no `grades` row; noted in the run report
  and `ingest_log`) and continues the run. A genuinely missing/invalid
  staged file after retry now fails only that one item by default (also
  recorded, run continues); a new `--strict` flag (default off) restores
  the prior abort-the-whole-run behavior for that case.

## Impact

- Affected spec: `task-analyzer-data-gathering` (amends the "Idempotent,
  atomic, offline ingestion" requirement).
- Affected code: `projects/agents/task-analyzer/ingest.py`,
  `projects/agents/task-analyzer/agents.py` (schema comment only, no
  behavior change), `projects/agents/task-analyzer/prompts/grading.md`.
- No schema change. Already-ingested rows are unaffected except where a
  session's `task_id` disagreed with the new evidence-based join outcome,
  in which case the next run heals it (see above).
