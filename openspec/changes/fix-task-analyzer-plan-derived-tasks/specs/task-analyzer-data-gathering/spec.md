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

A session joins a `(change, task_key)` pair only when the session's own
prompt text gives affirmative evidence for that SPECIFIC change — its
change directory name or OpenSpec change name, a mention of its committed
Superpowers plan file, or a mention of its SDD brief directory path — never
merely because it is the sole remaining candidate after `--change`
narrows the set of changes under consideration. This evidence computation
MUST be performed over the full set of landed changes regardless of
`--change`; `--change` MAY only filter which of the resulting joined
sessions are actually ingested in a given run, never alter which change
(if any) a session joins or whether it quarantines. A session whose
task_key is recognized by at least one landed change's brief but which
gives no affirmative evidence for any of them MUST quarantine with reason
`"no change evidence for task key"`; a session giving affirmative evidence
for more than one change MUST quarantine with reason `"task key matches >1
task"`. Each ingestion run MUST also reconcile any already-committed
session whose stored `task_id` disagrees with the currently-computed
evidence-based outcome (e.g. residue from a run predating this evidence
rule), so that repeated runs converge to the correct join state.

A grading result MAY legitimately find nothing gradeable in an item (e.g.
every review joined to that task is itself a mis-join). The grading
prompt MUST require an output file for every item unconditionally, using a
distinct "ungradeable" shape (all grade fields null, zero severity counts,
every excluded review listed, and a non-empty `reason` string) when this
happens. Ingestion MUST record such a result durably without writing a
`grades` row, and MUST continue the run rather than treat it as a failure.
A dispatch that produces no valid staged file at all (neither a graded nor
an ungradeable shape) after retry MUST fail only that one item by default
— logged, gap left open for a future run, run continues — and MUST abort
the whole run only when an explicit `--strict` flag is set.

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

#### Scenario: --change does not weaken join evidence
- **WHEN** a session's prompt mentions a task_key recognized by several landed changes' briefs but gives no affirmative evidence for any specific one, and ingestion is run once with `--change` set to one of those changes and once unscoped
- **THEN** the session quarantines identically in both runs, with the same reason and the same candidate list — it never joins the `--change`-named change merely because scoping left it as the sole candidate

#### Scenario: A session with real evidence for one change joins it, even referencing a sibling file the brief-suffix regex doesn't recognize
- **WHEN** a session's prompt mentions its change's committed Superpowers plan file, or a file under its change's SDD brief directory that isn't itself a `*-brief.md`/`*-implementer-prompt.md` (e.g. a reviewer's `-review-package.md`)
- **THEN** the session joins that change's task unambiguously, not quarantined

#### Scenario: A session naming two changes quarantines as ambiguous, not as no-evidence
- **WHEN** a session's prompt affirmatively names two different landed changes for the same task_key (e.g. comparing their briefs)
- **THEN** it quarantines with reason "task key matches >1 task", listing both changes as candidates

#### Scenario: A re-run heals a session mis-joined by a run that predates the evidence rule
- **WHEN** a session's `sessions.task_id` row already reflects a join decision that disagrees with today's evidence-based outcome for that session
- **THEN** the next ingestion run updates that session's `task_id` to match the current outcome (the correct task, or NULL if it should quarantine, or NULL if the correct task doesn't exist in the database yet), and a further run with no new evidence makes no further change

#### Scenario: A correctly ungradeable item does not abort the run
- **WHEN** every review joined to a task turns out to be mis-joined and the grading agent produces the ungradeable output shape for it
- **THEN** ingestion records the reason durably without writing a `grades` row for that task, and continues processing every other task in the run normally

#### Scenario: A genuine dispatch failure fails one item by default, the whole run only with --strict
- **WHEN** an agentic dispatch for one gap produces no valid staged output at all, even after the built-in retry
- **THEN** by default that one item is recorded as failed and the run continues with every other task; only when `--strict` is passed does this abort the run
