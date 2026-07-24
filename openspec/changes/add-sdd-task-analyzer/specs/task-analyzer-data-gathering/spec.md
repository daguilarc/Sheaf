# task-analyzer-data-gathering

## ADDED Requirements

### Requirement: SQLite dataset with specified schema
The system SHALL maintain the dataset in `data/agents/task-analyzer.sqlite`
using the schema defined in this change's design (tables: changes, tasks,
sessions, session_turns, complexity, grades, phase_tokens, turn_phases,
model_prices, task_costs, task_arms, meta, estimators, estimator_params,
ingest_log). Every agentic judgment row (complexity, grades, phase_tokens,
turn_phases) MUST carry `rubric_version`/`taxonomy_version`, `input_sha256`,
and `scored_by`. Each ingest MUST also write a stable-ordered JSONL export
(`data/agents/task-analyzer.dump.jsonl`) for reviewable diffs. Schema changes
MUST be applied idempotently on every connect (new tables via `CREATE TABLE
IF NOT EXISTS`; new columns on existing tables via an explicit, column-
presence-gated `ALTER TABLE`), bumping `meta.schema_version`.

#### Scenario: Judgments are cache-keyed
- **WHEN** a task already has a complexity row whose `rubric_version` matches the current rubric asset and whose `input_sha256` matches the brief
- **THEN** re-running ingestion dispatches no agent for that task's complexity

#### Scenario: Version history is retained
- **WHEN** a rubric bump causes re-scoring of a task
- **THEN** the version-1 row remains queryable alongside the new row, and the documented current-version selection rule picks the newer one

#### Scenario: Rubric bump triggers opt-in rescoring
- **WHEN** the complexity rubric asset's version is bumped and ingestion runs with `--rescore complexity`
- **THEN** tasks whose stored `rubric_version` differs are re-scored with new version rows written alongside the retained prior-version rows; without the flag they are left untouched and reported as stale

#### Scenario: Schema migration is idempotent and preserves data
- **WHEN** an existing database created under an older schema version is opened by a newer version of the tooling
- **THEN** any missing tables are created, any missing columns on existing tables are added via `ALTER TABLE`, `meta.schema_version` is bumped to match, all pre-existing rows and columns are left unchanged, and repeating the connect a second time makes no further changes

### Requirement: Idempotent, atomic, offline ingestion
The system SHALL provide an ingestion script in
`projects/agents/task-analyzer/` that discovers landed changes via git (present in
`git ls-tree <archive-ref> openspec/changes/archive/`, where `--archive-ref`
defaults to `refs/heads/main`), recording the resolved ref and commit SHA in
`ingest_log`, and their SDD tasks, transcripts, and
review sessions; ingests only what is missing; wraps each task's ingestion in
a single transaction; and supports `--dry-run` (print work plan, write
nothing) and `--no-agents` (mechanical extraction only). Running it twice in
succession MUST produce no changes on the second run.

#### Scenario: Second run is a no-op
- **WHEN** ingestion completes successfully and is immediately re-run with no new landed changes
- **THEN** the second run writes no rows and dispatches no agents

#### Scenario: Crash leaves no partial task
- **WHEN** ingestion is interrupted mid-task
- **THEN** the database contains either all of that task's rows or none, and the next run resumes from staged agent outputs — atomically written files named by scorer kind, entity key, version, and input hash — without re-dispatching completed agent work; staged files that failed validation are marked `.err` and are re-dispatched, and the dry-run work plan distinguishes staging-satisfied gaps from to-be-dispatched gaps

#### Scenario: Only landed changes are ingested
- **WHEN** a change exists only in a worktree branch or only in the local working tree, and not in the archive tree of the configured `--archive-ref`
- **THEN** it is not ingested (even when named via `--change`), and is listed in the run report as unlanded

### Requirement: Agentic scoring via xagent with asset-pinned prompts
The system SHALL dispatch grading (from review texts, per the grading rubric),
complexity scoring (from briefs, per the complexity rubric), and TDD phase
labeling (from condensed per-turn timelines, per the phase taxonomy) to
cheap models via xagent, using prompt files stored in
`projects/agents/task-analyzer/prompts/` and rubric files in
`projects/agents/task-analyzer/rubrics/`; the rubrics MUST be standalone
versioned markdown deliverables matching the 2026-07-19 methodology
(complexity C1–C7, grading G1–G5 + letter + severity counts +
rounds-to-accept, 10-phase TDD taxonomy). Failure-mode classification SHALL
NOT be part of ingestion.

#### Scenario: Missing grade triggers exactly one grading dispatch
- **WHEN** a newly ingested task has review texts but no grades row
- **THEN** one grading agent is dispatched with the pinned prompt and rubric, and its output is upserted with the rubric version and input hash

### Requirement: Deterministic cost derivation including review and follow-up
The system SHALL deterministically compute per-task dollar-weighted token
costs into `task_costs`: one category per TDD phase (session cost apportioned
by phase output-token share), plus `review` (all reviewer/auditor sessions) and `followup_fix` per the
design's deterministic event rules: a review boundary is the timestamp of a
detected review verdict turn (a co-occurring `SPEC: PASS|FAIL` and `QUALITY:
...` match within one reviewer turn's assistant text), falling back to a
reviewer session's own `ended_at` when no turn-level verdict data exists for
it; a task's review boundaries are the sorted union of every reviewer
session's detected verdict-turn timestamps (or fallback); implementer/fixer
sessions get `review_round = n` where n is the count of boundaries strictly
before their start, and every session with round ≥ 1 is a follow-up fix;
round-0 implementer sessions lacking phase labels fund the legal category
`unlabeled`; re-reviews without intervening fixes contribute to `review`
only; aborted and zero-output sessions are included in their category;
quarantined sessions fund nothing. The canonical implementer arm per task
SHALL be recorded in `task_arms` (round-0 implementer session with greatest
output tokens; alternates recorded in `basis_json`).
Dollar weighting MUST use the versioned `model_prices` table, and a
`rebuild-derived` subcommand MUST recompute all derived rows from raw data.

A round-0 implementer session whose own transcript turns span the task's
first review boundary (a persistent session resumed across fix/re-review
rounds) MUST have its turns partitioned at that boundary: turns starting
strictly after it fund `followup_fix` (proportional to their share of the
session's total turn output tokens); the remaining turns fund the phase
categories exactly as an unsplit round-0 session would, scaled to their
share of the session's total turn output tokens. Every category split MUST
sum back to exactly the session's full dollar cost (no cost lost or double-
counted across the split). A round-0 session with no per-turn data at all
MUST fall back to the prior (unsplit, whole-session) apportionment
unchanged — this is a documented approximation for such sessions, not an
error condition.

#### Scenario: Price update recomputes derived costs only
- **WHEN** a new `model_prices` row is added and `rebuild-derived` runs
- **THEN** `task_costs` rows are recomputed with the new `price_version` and no agentic tables are touched

#### Scenario: Multi-verdict reviewer session contributes multiple boundaries
- **WHEN** a single (persistent, resumed) reviewer session's transcript contains two distinct detected review verdicts
- **THEN** the task's review boundaries include both verdict timestamps, and an implementer/fixer session starting between them is assigned the review round opened by the first verdict, not round 0

#### Scenario: Spanning round-0 session's fix turns fund followup_fix
- **WHEN** a round-0 implementer session has per-turn data and some of its turns start strictly after the task's first review boundary
- **THEN** those turns' dollar cost funds `followup_fix` and the session's remaining turns fund the phase categories, with the category totals summing back to exactly the session's full cost

### Requirement: Backfill of per-turn data for pre-existing sessions
The system SHALL provide an `ingest.py backfill-turns` subcommand that
populates `session_turns` (and, for round-0 implementer sessions,
`turn_phases`) for any already-ingested session lacking them, by re-parsing
`sessions.transcript_path` when that file still exists on disk. Turn-level
phase labels MAY additionally be recovered from a still-valid staged
`phase_labeling` JSON or from a historical per-session phase-label dataset
when the transcript-derived labels are unavailable. A session whose
transcript can no longer be read MUST be left with no `session_turns` rows
(and therefore no spanning-session split for it) rather than erroring the
whole run; the subcommand MUST report backfilled and unrecoverable counts.

#### Scenario: Backfill recovers turns from a still-present transcript
- **WHEN** `backfill-turns` runs against a session lacking `session_turns` whose `transcript_path` still points to a readable file
- **THEN** `session_turns` rows are written for that session and it is counted as backfilled

#### Scenario: Backfill reports an unrecoverable session without erroring
- **WHEN** `backfill-turns` runs against a session lacking `session_turns` whose `transcript_path` is missing, unset, or unreadable
- **THEN** that session is counted as unrecoverable, no `session_turns` rows are written for it, and the run completes successfully for every other session

### Requirement: Migration of the 2026-07-19 dataset
The system SHALL provide a one-shot idempotent migration importing the
existing `analysis/sdd-model-analysis/data/` JSON dataset (sessions, tasks,
complexity, grades, phase labels with timeline turn costs) into the schema as
version-1 rubric rows, without re-running any agentic scoring; review-round
numbering and `task_costs` for migrated rows MUST be computed by the normal
deterministic pass.

#### Scenario: Migration requires no agent dispatches
- **WHEN** the migration script runs against the analysis-branch data directory
- **THEN** all existing complexity, grade, and phase-label results appear in the database with `rubric_version` 1 and zero agents are dispatched

#### Scenario: Migration reconciles against known corpus counts
- **WHEN** the real migration completes
- **THEN** the run report reconciles row counts against the source dataset (implementer+fixer sessions, complexity rows, grade rows, phase-labeled sessions) and any discrepancy beyond ±2 per count is reported as an error requiring investigation before commit
