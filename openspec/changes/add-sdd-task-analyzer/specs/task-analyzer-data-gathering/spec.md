# task-analyzer-data-gathering

## ADDED Requirements

### Requirement: SQLite dataset with specified schema
The system SHALL maintain the dataset in `data/agents/task-analyzer.sqlite`
using the schema defined in this change's design (tables: changes, tasks,
sessions, complexity, grades, phase_tokens, model_prices, task_costs,
task_arms, meta, estimators, estimator_params, ingest_log). Every agentic judgment row
(complexity, grades, phase_tokens) MUST carry `rubric_version`/
`taxonomy_version`, `input_sha256`, and `scored_by`. Each ingest MUST also
write a stable-ordered JSONL export (`data/agents/task-analyzer.dump.jsonl`)
for reviewable diffs.

#### Scenario: Judgments are cache-keyed
- **WHEN** a task already has a complexity row whose `rubric_version` matches the current rubric asset and whose `input_sha256` matches the brief
- **THEN** re-running ingestion dispatches no agent for that task's complexity

#### Scenario: Version history is retained
- **WHEN** a rubric bump causes re-scoring of a task
- **THEN** the version-1 row remains queryable alongside the new row, and the documented current-version selection rule picks the newer one

#### Scenario: Rubric bump triggers opt-in rescoring
- **WHEN** the complexity rubric asset's version is bumped and ingestion runs with `--rescore complexity`
- **THEN** tasks whose stored `rubric_version` differs are re-scored and their rows replaced; without the flag they are left untouched and reported as stale

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
design's deterministic event rules: review boundaries are reviewer-session
end times; implementer/fixer sessions starting after a boundary are
follow-up fixes (round n+1); re-reviews without intervening fixes contribute
to `review` only; aborted and zero-output sessions are included in their
category; quarantined sessions fund nothing. The canonical implementer arm
per task SHALL be recorded in `task_arms` (round-0 implementer session with
greatest output tokens; alternates recorded in `basis_json`).
Dollar weighting MUST use the versioned `model_prices` table, and a
`rebuild-derived` subcommand MUST recompute all derived rows from raw data.

#### Scenario: Price update recomputes derived costs only
- **WHEN** a new `model_prices` row is added and `rebuild-derived` runs
- **THEN** `task_costs` rows are recomputed with the new `price_version` and no agentic tables are touched

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
