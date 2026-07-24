# task-analyzer-data-gathering

## MODIFIED Requirements

### Requirement: Idempotent, atomic, offline ingestion
The system SHALL provide an ingestion script in
`projects/agents/task-analyzer/` that discovers landed changes via git (present in
`git ls-tree <archive-ref> openspec/changes/archive/`, where `--archive-ref`
defaults to `refs/heads/main`), recording the resolved ref and commit SHA in
`ingest_log`, and their SDD tasks, transcripts, and
review sessions; ingests only what is missing; wraps each task's ingestion in
a single transaction; and supports `--dry-run` (write nothing) and
`--no-agents` (mechanical extraction only). Running it twice in succession
MUST produce no changes on the second run.

A landed change's tasks are discovered from its committed SDD task briefs
(`.superpowers/sdd/<change>/*-brief.md`) at the archive ref when any exist.
When a landed change has NO committed briefs at that ref — the steady-state
case, since `.superpowers/` is the SDD workflow's own uncommitted scratch
space and is never committed — its tasks SHALL instead be derived from its
own committed Superpowers plan file (already resolved as `plan_path` by
change discovery): every heading of the form "Task N:" (a colon
immediately after the number, at any markdown heading level — every real
task heading across the plans committed on main has this shape, which is
what distinguishes a genuine task heading from a same-plan "Task N Review"
sub-heading) opens one task section running through the line before the
next heading at the SAME level, whether or not that next heading is
itself a task heading; the section's task key is `task-N` and its full
text becomes that task's brief text, hashed and cached exactly like a
real committed brief. Real committed briefs, when any exist for a
change, MUST take precedence outright over plan derivation for that same
change (never mixed within one change); a change with neither committed
briefs nor a resolvable plan file MUST still ingest as a change row with
zero tasks, not an error.

`--dry-run` MUST print the full computed work plan as JSON — every new
change/task, session identifiers (or a count plus a bounded sample for a
very large list), and every agentic gap with its entity key, kind, version,
and reason — rather than a summary of write counts, all of which are
necessarily zero on a run that writes nothing.

#### Scenario: Second run is a no-op
- **WHEN** ingestion completes successfully and is immediately re-run with no new landed changes
- **THEN** the second run writes no rows and dispatches no agents

#### Scenario: Crash leaves no partial task
- **WHEN** ingestion is interrupted mid-task
- **THEN** the database contains either all of that task's rows or none, and the next run resumes from staged agent outputs — atomically written files named by scorer kind, entity key, version, and input hash — without re-dispatching completed agent work; staged files that failed validation are marked `.err` and are re-dispatched, and the dry-run work plan distinguishes staging-satisfied gaps from to-be-dispatched gaps

#### Scenario: Only landed changes are ingested
- **WHEN** a change exists only in a worktree branch or only in the local working tree, and not in the archive tree of the configured `--archive-ref`
- **THEN** it is not ingested (even when named via `--change`), and is listed in the run report as unlanded

#### Scenario: Dry run prints the work plan, not a write-count summary
- **WHEN** `ingest.py --dry-run` runs against a repo with at least one new landed change
- **THEN** the printed JSON contains the new changes, new tasks, session identifiers or count, and every agentic gap's entity key/kind/version/reason — not a report of write counts, which are always zero on a dry run

#### Scenario: Tasks derived from a committed plan when no briefs are committed
- **WHEN** a landed change has zero committed task briefs at the archive ref but a resolvable committed Superpowers plan file
- **THEN** its tasks are ingested with `task-N` keys and brief text equal to that plan's own "Task N:" section text, and their cache-key hashes derive from that text exactly as for a committed brief

#### Scenario: A plan's own review sub-section is excluded from the preceding task's brief
- **WHEN** a plan-derived task's section is followed by a same-level heading that is not itself a "Task N:" heading (e.g. a "Task N Review" sub-heading) before the next task's heading
- **THEN** that section's text is excluded from the preceding task's brief text, and no task is created for it

#### Scenario: Committed briefs take precedence over plan derivation
- **WHEN** a landed change has at least one committed task brief at the archive ref
- **THEN** its tasks are discovered from those committed briefs only, never from its plan file, even if the plan file also exists
