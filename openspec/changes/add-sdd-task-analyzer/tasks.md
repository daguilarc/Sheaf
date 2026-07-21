# Tasks: add-sdd-task-analyzer

## 1. Assets and schema

- [ ] 1.1 Create `projects/agents/task-analyzer/` skeleton (README, `rubrics/`, `prompts/`, `staging/` gitignored) and port the three 2026-07-19 rubrics as standalone versioned assets: `rubrics/complexity.md` (C1–C7 + anchors, `version: 1`), `rubrics/grading.md` (G1–G5, severity mapping, letter definitions, `version: 1`), `rubrics/phase-taxonomy.md` (10 phases + tie-break rules, `version: 1`)
- [ ] 1.2 Port the three agent prompts from the analysis session as assets (`prompts/complexity.md`, `prompts/grading.md`, `prompts/phase-labeling.md`), parameterized by rubric path, input paths, and output staging path
- [ ] 1.3 Implement `schema.sql` exactly per design D2 plus `db.py` (open/create, WAL, migrations table, stable-ordered JSONL dump writer) and seed `model_prices` for the arms observed in the corpus

## 2. Ingestion (deterministic core)

- [ ] 2.1 Implement transcript extractors as a library, porting the analysis scripts: codex sessions (`exec` + `thread_spawn`; model/effort from turn_context, token totals, per-turn deltas, compactions, peak context) and claude sessions (top-level + `subagents/agent-*.jsonl`; per-assistant-request turns), emitting condensed timelines for phase labeling
- [ ] 2.2 Implement discovery + joining: enumerate landed changes from `openspec/changes/archive/` on main, locate their SDD briefs/reports/review texts and sessions, classify session role (implementer/reviewer/fixer) and review_round by timestamp order; quarantine ambiguous joins to `ingest_log` rather than guessing
- [ ] 2.3 Implement the idempotent ingest driver: per-task transactions, cache-key checks (`rubric_version` + `input_sha256`), staging-dir resume, `--dry-run`, `--no-agents`, `--rescore <table>`, run report; archive brief text and graded tasks' review texts into the DB
- [ ] 2.4 Implement `rebuild-derived`: `task_costs` per design D5 (phase apportionment by output-token share, `review`, `followup_fix` via review-round mechanics) using versioned `model_prices`

## 3. Agentic scoring integration

- [ ] 3.1 Implement xagent dispatch wrappers for the three scorers (grading→sonnet, complexity→sonnet, phase-labeling→haiku): batch missing items, write staged JSON, validate schema, upsert with version+hash keys
- [ ] 3.2 End-to-end ingest test on one landed change not in the migrated set: dry-run plan, real run, verify idempotent second run (zero writes, zero dispatches)

## 4. Migration of existing dataset

- [ ] 4.1 Implement `migrate_v0.py` importing `analysis/sdd-model-analysis/data/` (sessions, tasks/changes, complexity, grades, phase labels + timeline turn costs) as `rubric_version` 1 rows with zero agent dispatches; flag rows `migrated_v0`
- [ ] 4.2 Run migration + `rebuild-derived`; reconcile row counts against the analysis findings (203 implementer sessions, 143 complexity, 117 grades); commit `task-analyzer.sqlite` + JSONL dump

## 5. Cost model

- [ ] 5.1 Implement `train.py`: NIG Bayesian linear regression on log-cost per (category, arm) with pooled prior (design D6), config-driven features, persisted to `estimators`/`estimator_params` with metrics (held-out log-loss, calibration of p50/p80)
- [ ] 5.2 Implement posterior query library: predictive quantiles + Thompson sample per (category, complexity, arm)
- [ ] 5.3 Implement `estimate.py` CLI per spec (candidate YAML in → per-task arm ranking, selection with p80 guard, explore flags, totals; JSON + table output; deterministic given estimator id)
- [ ] 5.4 Train on migrated data; sanity-check outputs against known findings (sol/high dominated by 5.5/high; terra/medium cheapest at composite ≤3; sparse arms flagged explore); commit estimator rows

## 6. Annotations and decomposer

- [ ] 6.1 Implement the `.assignments.yaml` sibling format writer + validator per spec (format version, task-key match, ranges, known arms)
- [ ] 6.2 Write `prompts/decomposer.md`: candidate-generation guidance (bracketing vs build/test-target regrouping), in-context complexity scoring against the rubric, `estimate.py` invocation protocol, guardrails (split composite >3.5, prefer C7 ≤ 2, dependency order), required outputs (annotation YAML + comparison table + rationale)
- [ ] 6.3 Dry-run the decomposer subagent on one archived change (e.g. `add-note-system-message-mappings`) against the trained estimator; check the protocol produces ≥3 scored candidates and a defensible selection; refine prompt once
- [ ] 6.4 Document the whole pipeline in `projects/agents/task-analyzer/README.md`: run cadence, recompute matrix (what changing each rubric/price/estimator invalidates), and explicit non-integration note (workflow rewrite is a future change)
