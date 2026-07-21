# Proposal: add-sdd-task-analyzer

## Why

The SDD/TDD analysis of 2026-07-19 (branch `claude/codex-sdd-tdd-analysis-0a1964`,
`analysis/sdd-model-analysis/`) showed that task complexity, brief
prescriptiveness, and model/effort choice each move implementer outcomes by
about a letter grade, and that per-model token burn differs by 2×+ at equal
quality — but that analysis was ad hoc and its dataset frozen. To improve task
breakdowns over time we need a durable pipeline: continuous structured data
collection from landed SDD changes, a retrainable cost model with uncertainty
estimates (usable for explore/exploit decisions), and a decomposition subagent
that searches over candidate task breakdowns and pre-assigns models using the
learned estimator.

## What Changes

- Define an **optional SDD task-annotation extension**: per-task model/effort
  assignment and complexity vector, stored in a sibling file next to the SDD
  task list (does not alter the existing Superpowers format).
- New project **`projects/agents/task-analyzer`** with:
  - An **idempotent, offline ingestion script** that scans landed changes on
    main, discovers their SDD tasks and agent transcripts, dispatches xagent
    graders/labelers only for missing pieces, and folds results into
    `data/agents/task-analyzer.sqlite` (schema defined in detail; atomic
    per-task upserts).
  - **Standalone rubric assets** (complexity rubric, grading rubric, TDD phase
    taxonomy) as versioned markdown files matching the 2026-07-19 methodology.
  - A **migration path** that imports the existing
    `analysis/sdd-model-analysis/data/` dataset with minimal regeneration.
  - A **retrainable cost estimator**: per cost category (TDD phases, review,
    follow-up fix), (complexity, model/effort) → dollar-weighted token cost
    with uncertainty (posterior/quantiles, e.g. p50/p80), persisted in the
    same SQLite database.
  - An **estimator CLI** that scores a proposed decomposition (task list +
    complexity vectors) against the main-branch database and returns per-task
    model assignments, cost quantiles, and totals.
  - A **decomposition subagent prompt/protocol** that proposes several
    candidate decompositions of an OpenSpec change, scores each via the
    estimator CLI, and emits the chosen decomposition with pre-assigned
    models. (Integration into openspec-superpowers-workflow is explicitly out
    of scope for this change.)

## Capabilities

### New Capabilities
- `task-analyzer-sdd-annotations`: sibling-file format for per-task model
  assignment and complexity scores alongside an SDD task list.
- `task-analyzer-data-gathering`: idempotent offline ingestion of landed SDD
  changes into the SQLite dataset — task discovery, transcript stats, xagent
  grading and phase labeling, rubric assets, and migration of the existing
  2026-07-19 dataset.
- `task-analyzer-cost-model`: retrainable per-category cost regression with
  uncertainty output, persisted in SQLite, plus the estimator CLI over
  proposed decompositions.
- `task-analyzer-decomposition-agent`: subagent prompt and search protocol
  that proposes candidate decompositions, scores them with the estimator, and
  selects the cost-minimizing decomposition with per-task model assignments.

### Modified Capabilities

(none — no existing spec's requirements change; workflow integration is a
future change)

## Impact

- New code under `projects/agents/task-analyzer/` (scripts, prompts, rubrics).
- New database file `data/agents/task-analyzer.sqlite` (committed or
  gitignored per design decision; see design.md).
- Reads `~/.codex/sessions`, `~/.claude/projects`, codex worktrees, and the
  repo's `openspec/changes/archive/` — read-only.
- Imports from `analysis/sdd-model-analysis/data/` (existing analysis branch).
- No changes to openspec-superpowers-workflow, xagent, or existing specs in
  this change.
