# Tasks: add-sdd-task-analyzer

## 1. Assets and schema

- [x] 1.1 Create `projects/agents/task-analyzer/` skeleton (README, `rubrics/`, `prompts/`, `staging/` gitignored) and port the three 2026-07-19 rubrics as standalone versioned assets: `rubrics/complexity.md` (C1–C7 + anchors, `version: 1`), `rubrics/grading.md` (G1–G5, severity mapping, letter definitions, `version: 1`), `rubrics/phase-taxonomy.md` (10 phases + tie-break rules, `version: 1`)
- [x] 1.2 Port the three agent prompts from the analysis session as assets (`prompts/complexity.md`, `prompts/grading.md`, `prompts/phase-labeling.md`), parameterized by rubric path, input paths, and output staging path
- [x] 1.3 Implement `schema.sql` exactly per design D2 plus `db.py` (open/create, WAL, migrations table, stable-ordered JSONL dump writer) and seed `model_prices` for the arms observed in the corpus

## 2. Ingestion (deterministic core)

- [x] 2.1 Implement transcript extractors as a library, porting the analysis scripts: codex sessions (`exec` + `thread_spawn`; model/effort from turn_context, token totals, per-turn deltas, compactions, peak context) and claude sessions (top-level + `subagents/agent-*.jsonl`; per-assistant-request turns), emitting condensed timelines for phase labeling
- [x] 2.2 Implement discovery + joining: enumerate landed changes from `openspec/changes/archive/` on main, locate their SDD briefs/reports/review texts and sessions, classify session role (implementer/reviewer/fixer) and review_round by timestamp order; quarantine ambiguous joins to `ingest_log` rather than guessing
- [x] 2.3 Implement the idempotent ingest driver: per-task transactions, cache-key checks (`rubric_version` + `input_sha256`), staging-dir resume, `--dry-run`, `--no-agents`, `--rescore <table>`, run report; archive brief text and graded tasks' review texts into the DB
- [x] 2.4 Implement `rebuild-derived`: `task_costs` per design D5 (phase apportionment by output-token share, `review`, `followup_fix` via review-round mechanics) using versioned `model_prices`

## 3. Agentic scoring integration

- [x] 3.1 Implement xagent dispatch wrappers for the three scorers (grading→sonnet, complexity→sonnet, phase-labeling→haiku): batch missing items, write staged JSON, validate schema, upsert with version+hash keys
- [x] 3.2 End-to-end ingest test on one landed change not in the migrated set: dry-run plan, real run, verify idempotent second run (zero writes, zero dispatches)

## 4. Migration of existing dataset

- [x] 4.1 Implement `migrate_v0.py` importing `analysis/sdd-model-analysis/data/` (sessions, tasks/changes, complexity, grades, phase labels + timeline turn costs) as `rubric_version` 1 rows with zero agent dispatches; flag rows `migrated_v0`
- [x] 4.2 Run migration + `rebuild-derived`; reconcile row counts against the analysis findings (203 implementer sessions, 143 complexity, 117 grades); commit `task-analyzer.sqlite` + JSONL dump

## 5. Cost model

- [x] 5.1 Implement `train.py`: NIG Bayesian linear regression on log-cost per (category, arm) with pooled prior (design D6), config-driven features, persisted to `estimators`/`estimator_params` with metrics (held-out log-loss, calibration of p50/p80)
- [x] 5.2 Implement posterior query library: predictive quantiles + Thompson sample per (category, complexity, arm)
- [x] 5.3 Implement `estimate.py` CLI per spec (candidate YAML in → per-task arm ranking, selection with p80 guard, explore flags, totals; JSON + table output; deterministic given estimator id)
- [x] 5.4 Train on migrated data; sanity-check outputs against known findings (sol/high dominated by 5.5/high; terra/medium cheapest at composite ≤3; sparse arms flagged explore); commit estimator rows

## 6. Annotations and decomposer

- [x] 6.1 Implement the `.assignments.yaml` sibling format writer + validator per spec (format version, task-key match, ranges, known arms)
- [x] 6.2 Write `prompts/decomposer.md`: candidate-generation guidance (bracketing vs build/test-target regrouping), in-context complexity scoring against the rubric, `estimate.py` invocation protocol, guardrails (split composite >3.5, prefer C7 ≤ 2, dependency order), required outputs (annotation YAML + comparison table + rationale)
- [x] 6.3 Dry-run the decomposer subagent on one archived change (e.g. `add-note-system-message-mappings`) against the trained estimator; check the protocol produces ≥3 scored candidates and a defensible selection; refine prompt once
- [x] 6.4 Document the whole pipeline in `projects/agents/task-analyzer/README.md`: run cadence, recompute matrix (what changing each rubric/price/estimator invalidates), and explicit non-integration note (workflow rewrite is a future change)

## 7. Amendments

Two approved follow-ups landed after the change above was implemented and
reviewed (5.1–6.4); this change was kept active rather than archived so
these could amend its deltas directly instead of opening a new change for a
query-layer-only redesign of an already-active one.

- [x] 7.1 Follow-up 1, Part A — pooled-posterior fallback: `train.py` now
  also persists each category's pooled fit as a sentinel `estimator_params`
  row (`model.POOLED_SENTINEL_ARM`); `estimate.py` falls back to it for any
  (category, arm) cell with no posterior of its own instead of excluding
  the arm outright (the prior "full-coverage" exclusion rule left only 2 of
  10 arms scorable on the migrated dataset, and an excluded arm can never
  accrue new data). `fallback_categories` reported per arm.
- [x] 7.2 Follow-up 1, Part B — real model prices: replaced the ten
  `$1`/`$1`/`$1` `TODO(price-audit)` placeholder rows in `model_prices`
  (eight gpt-5.x models, claude-sonnet-4-6, claude-fable-5) with verified
  July-2026 list prices; rebuilt `task_costs`, retrained (new `estimators`
  generation, prior generations kept), regenerated the JSONL dump.
- [x] 7.3 Follow-up 1 fix round — a selected arm that scored via pooled
  fallback could report `explore: false` if its interval happened not to
  overlap the runner-up's; fixed to fold fallback into the (then-existing)
  `explore` signal. Superseded by 7.4 below, which removes `explore`
  entirely.
- [x] 7.4 Follow-up 2 — p20-bandit selection via Monte Carlo, `explore` flag
  removed: total task cost per arm is now a seeded Monte Carlo quantile of
  the *sum* of per-category predictives (`model.NIG.predictive_draws`), not
  a sum of each category's own quantile — quantiles don't commute with sums
  in general (summing typically overstates p80 / understates p20 under
  independence for moderate tails, though the direction isn't universal at
  very heavy tails; see spec.md "Total cost is a quantile of the sum").
  Selection is the lowest Monte Carlo p20 total among arms passing a p80
  guard (same guard factor/precedence as before); a `--thompson` mode
  selects via one Thompson draw per arm instead. The `explore`/
  `explore_reasons` flags, the p20/p80 overlap check, and the
  `expected_total_usd`/`pq_total_usd`/`--quantile` fields are removed
  outright (no longer needed once selection is p20-driven) — see
  `estimate.py`'s module docstring and design.md D6 for the full rationale.
  Estimator training/persistence and the database are unchanged; this was a
  query-layer-only redesign.
- [x] 7.5 Follow-up 3 — p80 guard removed: the guard introduced in 7.4
  (exclude any arm whose MC p80 total exceeded a guard factor times the
  minimum p80 among scorable arms) suppressed exploration of exactly the
  sparse arms p20 selection exists to explore, so it was removed entirely
  (user decision) — selection is now the lowest p20 total among ALL
  scorable arms (Thompson mode likewise ungated); `p20`/`p50`/`p80` stay as
  reported diagnostics. `DEFAULT_GUARD_FACTOR`, `resolve_guard_factor`,
  `--guard-factor`, and `config_json["guard_factor"]` handling are removed
  outright. Estimator training/persistence and the database are unchanged;
  this was a query-layer-only change.
- [x] 7.6 Follow-up 4 — persistent-session review-round attribution fix
  (design.md D5 amendment): the `openspec-superpowers-workflow` skill's
  "Provider and model rules" now keep implementer/reviewer sessions open
  across fix/re-review rounds, which broke session-granularity cost
  attribution two ways — a fix performed inside a resumed round-0
  implementer session was misattributed to phases instead of
  `followup_fix`, and a resumed reviewer session doing review + re-review
  contributed one review boundary instead of one per verdict. Fixed with:
  new `session_turns`/`turn_phases` tables + `sessions.verdict_boundaries_json`
  column (schema v2→v3, idempotent `ALTER TABLE`-based migration in
  `db.py`); mechanical verdict-turn detection in `extractors.py` (`SPEC:
  PASS|FAIL` + `QUALITY: ...` co-occurrence on one turn's full assistant
  text); `discovery.review_boundaries` generalized to the union of every
  reviewer session's detected verdict timestamps (falling back to the old
  one-boundary-per-session behavior when no verdict data exists); a
  spanning-session split in `costs.py` that partitions a round-0
  implementer session's turns at the task's first review boundary
  (post-boundary turns fund `followup_fix`, pre-boundary turns fund the
  phase categories — directly from `turn_phases` when present, else scaled
  from the session's aggregate `phase_tokens`), with a proven
  sum-preservation invariant (every split sums back to exactly the
  session's usd); and a new `ingest.py backfill-turns` subcommand that
  re-extracts turns from `sessions.transcript_path` for any session
  predating these tables, with `turn_phases` recovered from the analysis
  dataset's per-turn labels where the transcript-derived source doesn't
  survive. 32 new tests added (263 total, up from a 231 baseline), covering
  turn persistence, verdict-boundary detection, the spanning split (direct
  and scaled-fallback branches, sum-preservation, no-turn-data fallback),
  and backfill (recoverable/unrecoverable, idempotency, phase-label
  aggregation integrity). Ran against the real dataset: `backfill-turns`
  recovered `session_turns` for all 616 already-ingested sessions (0
  unrecoverable) and `turn_phases` for 161 of 164 eligible round-0
  implementer sessions (3 unavailable — no surviving per-turn label
  source); found 3 real reviewer sessions with multiple detected verdicts
  and 11 real round-0 implementer sessions spanning a review boundary.
  `rebuild-derived` shifted `followup_fix` from $588.25 to $607.83 (+$19.58,
  +3.33%), pulled proportionally from the phase/`unlabeled` categories,
  with the grand total across all categories unchanged to the cent
  ($2141.50263245 before and after, byte-identical). Retrained
  (`estimators` id 4, prior 1–3 kept); `--sanity` selected the same arm per
  task before and after retraining (gpt-5.6-terra/high, gpt-5.6-terra/high,
  gpt-5.5/high) — only the reported p20/p50/p80 totals shifted slightly,
  no selection change.
- [x] 7.6 Fix round 1 (codex review of 7.6/followup-4, four findings) — verify
  `turn_phases` all-or-nothing against `phase_tokens` before writing
  (self-heals a prior buggy backfill instead of silently mismatching);
  tightened verdict-line detection to reject brief-quoting template text
  while still matching a genuine verdict's trailing reason; fixed
  timestamp comparisons to use parsed datetimes, not raw ISO strings;
  separated zero-turn extractions from genuine backfills in the reported
  counts. Added `ingest.py verify-turn-phases` (CI-usable, exits 1 on any
  violation). 286 tests (up from 263).
- [x] 7.7 Fix round 2 — corrected an overstated "diagnostic only" claim:
  for a session that actually gets split at a review boundary, missing
  `session_turns` coverage biases the `followup_fix`/phase USD split
  itself, not just the `weighted_tokens` sanity figure. Added turn-coverage
  computation + surfacing (`RebuildResult.spanning_session_coverage`,
  stderr `WARN` below `costs.DEFAULT_COVERAGE_WARN_THRESHOLD = 0.9`) —
  observability only, no attribution redesign. All 11 real spanning
  sessions were below 100% coverage (worst ~22%). 293 tests.
- [x] 7.8 Follow-up 5 — closed the turn-coverage gap at its root:
  `extractors.py` was discarding "silent checkpoint" deltas (a token-usage
  checkpoint with no accompanying condensed content) instead of folding
  them into an adjacent existing turn; fixed for both providers (codex's
  fix additionally sources each checkpoint's delta from the cumulative
  `total_token_usage` counter's own step, not `last_token_usage`, closing
  a second gap for resumed/`thread_spawn` sessions). Turn count/indices
  are provably unchanged; `sum(session_turns.output_tokens) ==
  sessions.output_tokens` now holds with zero exceptions across the real
  corpus (one documented, unrelated exception: a still-growing "main"
  claude transcript whose `sessions.output_tokens` snapshot predates
  content the file grew to after its original ingest). Sessions with
  existing `turn_phases` now get `phase_tokens` mechanically recomputed
  from those (unchanged) labels against corrected deltas; `sessions.n_turns`
  refreshed from the authoritative re-extraction. `ingest.py backfill-turns
  --regenerate` added to re-derive already-backfilled sessions under the
  fixed extractor. Re-ran the pipeline: `spanning_session_coverage` is
  exactly `1.0` for all 11 spanning sessions (was as low as 0.219);
  `followup_fix` moved to $606.87 (+3.17% vs the original followup-4
  baseline, DOWN from the previously-reported +3.33% — confirming the
  pre-boundary-bias analysis); grand total unchanged to the cent.
  Retrained (`estimators` id 6, prior 1–5 kept); `--sanity` kept two of
  three selections unchanged, with one sparse-arm (`gpt-5.6-terra/high`,
  7 training tasks) selection changing at the synthetic high-complexity
  tier — see the followup-5 report for the full explanation. 313 tests.
