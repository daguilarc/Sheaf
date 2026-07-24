# Design: add-sdd-task-analyzer

## Context

The 2026-07-19 analysis (branch `claude/codex-sdd-tdd-analysis-0a1964`,
`analysis/sdd-model-analysis/`) produced: extraction scripts for codex/claude
transcripts, rubrics (complexity C1–C7, grading G1–G5 + letter, 10-phase TDD
taxonomy), per-turn phase labels, complexity scores, grades, and a flat join —
all as ad-hoc JSON keyed by loose task keys. Findings worth operationalizing:
complexity/prescriptiveness/context predict grade more than model choice;
model arms differ ~2× in dollar cost at equal quality; review rounds are the
dominant hidden cost of weak implementers.

This change turns that one-off into three durable layers: (1) an idempotent
offline ingester into SQLite, (2) a retrainable cost estimator with
uncertainty, (3) a decomposition subagent + estimator CLI. Workflow
integration comes later.

## Goals / Non-Goals

**Goals:**
- Single SQLite source of truth at `data/agents/task-analyzer.sqlite` with a
  fully specified schema, versioned rubric/prompt assets, and clean
  deterministic/agentic separation so any layer can be recomputed.
- Offline, idempotent, resumable ingestion of *landed* changes only.
- Cost model that answers "p80 dollar-weighted token cost of (category |
  complexity, model, effort)" and exposes posterior uncertainty for
  explore/exploit (Thompson-style) decisions.
- Migration of the existing dataset with zero re-labeling.

**Non-Goals:**
- No changes to openspec-superpowers-workflow, xagent, or dispatch protocol.
- No failure-mode classification (that was ad-hoc analysis; grades + phase
  tokens only).
- No online/push-triggered collection; runs are manual.
- No reviewer-quality judgments.

## Decisions

### D1. Annotation sibling file (not inline edits)

Per-task model/complexity annotations live in a **sibling YAML file** next to
the SDD plan: `docs/superpowers/plans/<name>.assignments.yaml` (same basename,
`.assignments.yaml` suffix). Rationale: the Superpowers plan format is owned
by the plugin — a sibling file is allowed, diffable, and ignorable by tools
that don't know it. Schema (versioned, `format: 1`):

```yaml
format: 1
change: <openspec-change-name>
estimator_id: <id from estimators table, or null if hand-written>
tasks:
  - task: task-1
    title: "..."
    model: gpt-5.5        # implementer arm
    effort: high
    complexity: {C1: 2, C2: 3, C3: 4, C4: 2, C5: 3, C6: 2, C7: 2, composite: 2.7}
    predicted: {p20_usd: 0.29, p50_usd: 0.42, p80_usd: 0.71}
```

### D2. SQLite schema

One database, WAL mode, single-writer (the ingest script). All agentic
outputs carry `(rubric_version, input_sha256, scored_by)` so they are cache
keys, not opinions welded into the schema. Deterministic quantities are
derived tables that a `rebuild-derived` subcommand recomputes from raw.

```sql
-- raw layer (facts about the world; never recomputed, only appended)
CREATE TABLE changes(
  change_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,            -- openspec change name
  archive_path TEXT,                    -- openspec/changes/archive/<...>
  plan_path TEXT,                       -- docs/superpowers/plans/<...>.md
  merged_at TEXT, ingested_at TEXT NOT NULL);

CREATE TABLE tasks(
  task_id INTEGER PRIMARY KEY,
  change_id INTEGER NOT NULL REFERENCES changes,
  task_key TEXT NOT NULL,               -- e.g. task-3, p2-task-4
  brief_path TEXT, brief_sha256 TEXT, brief_bytes INTEGER,
  brief_text TEXT,                      -- archived verbatim (survives worktree cleanup)
  UNIQUE(change_id, task_key));

CREATE TABLE sessions(
  session_id TEXT PRIMARY KEY,          -- provider:native-id
  task_id INTEGER REFERENCES tasks,     -- null until joined
  provider TEXT NOT NULL,               -- codex | claude
  harness_entry TEXT,                   -- exec | thread_spawn | subagent | main
  role TEXT NOT NULL,                   -- implementer | reviewer | fixer | auditor
  model TEXT, effort TEXT,
  started_at TEXT, ended_at TEXT,
  transcript_path TEXT,
  input_tokens INTEGER, cached_tokens INTEGER, output_tokens INTEGER,
  reasoning_tokens INTEGER, peak_context INTEGER,
  n_compactions INTEGER, n_turns INTEGER, n_tool_calls INTEGER,
                                         -- n_turns: many rows are stale
                                         -- from the original migration;
                                         -- ingest.py backfill-turns
                                         -- refreshes it from the
                                         -- authoritative re-extraction
                                         -- (followup-5).
  review_round INTEGER,                 -- 1..n for reviewer/fixer sessions
  verdict_boundaries_json TEXT);         -- v3 (followup-4): reviewer's detected
                                         -- per-verdict timestamps (JSON array);
                                         -- a new column on an existing table,
                                         -- so db.py ALTER TABLEs it onto pre-v3
                                         -- DBs (CREATE TABLE IF NOT EXISTS can't).

CREATE TABLE session_turns(             -- v3 (followup-4): per-turn timing,
  session_id TEXT REFERENCES sessions,  -- mechanical (from extractors.py, or
  turn_idx INTEGER,                     -- backfilled from transcript_path).
  started_at TEXT, ended_at TEXT, output_tokens INTEGER,
  PRIMARY KEY(session_id, turn_idx));

-- agentic layer (cache-keyed judgments; re-run when rubric_version changes)
CREATE TABLE complexity(
  task_id INTEGER REFERENCES tasks,
  c1 INT, c2 INT, c3 INT, c4 INT, c5 INT, c6 INT, c7 INT, composite REAL,
  rationale_json TEXT,
  rubric_version TEXT NOT NULL, input_sha256 TEXT NOT NULL, scored_by TEXT,
  PRIMARY KEY(task_id, rubric_version));

CREATE TABLE grades(
  task_id INTEGER REFERENCES tasks,
  g1 INT, g2 INT, g3 INT, g4 INT, g5 INT,
  n_critical INT, n_important INT, n_minor INT,
  rounds_to_accept INT, verdict_sequence_json TEXT, final_grade TEXT,
  evidence_json TEXT, excluded_reviews_json TEXT,
  review_text TEXT,                     -- verbatim grading input (provenance)
  rubric_version TEXT NOT NULL, input_sha256 TEXT NOT NULL, scored_by TEXT,
  PRIMARY KEY(task_id, rubric_version));

CREATE TABLE phase_tokens(
  session_id TEXT REFERENCES sessions, phase TEXT,  -- 10-phase taxonomy
  output_tokens INTEGER, turns INTEGER,
  taxonomy_version TEXT NOT NULL, input_sha256 TEXT NOT NULL, scored_by TEXT,
  PRIMARY KEY(session_id, phase, taxonomy_version));

CREATE TABLE turn_phases(               -- v3 (followup-4): per-turn phase
  session_id TEXT REFERENCES sessions,  -- labels; same cache keys as
  turn_idx INTEGER, phase TEXT,         -- phase_tokens, which REMAINS and
  taxonomy_version TEXT NOT NULL,       -- must equal the aggregation of this
  input_sha256 TEXT NOT NULL, scored_by TEXT,  -- table x session_turns.output_tokens
  PRIMARY KEY(session_id, turn_idx, taxonomy_version));  -- for sessions with turn rows.
  -- followup-5 amendment: this invariant is maintained by treating
  -- turn_phases' PHASE column as the agentic judgment (cache-keyed,
  -- untouched by mechanical re-extraction) and phase_tokens.output_tokens/
  -- .turns as DERIVED from it -- ingest.py's backfill-turns recomputes
  -- phase_tokens in place (same input_sha256/scored_by) from (unchanged)
  -- turn_phases labels x current session_turns.output_tokens whenever the
  -- latter changes (e.g. an extractors.py delta fix). A session WITHOUT
  -- turn_phases rows keeps its stored phase_tokens untouched (still the
  -- only record) -- see D5's amendment below.

-- reference + derived layer (deterministic; `rebuild-derived` recomputes)
CREATE TABLE model_prices(
  model TEXT, effective_date TEXT,
  usd_per_m_input REAL, usd_per_m_cached REAL, usd_per_m_output REAL,
  PRIMARY KEY(model, effective_date));

CREATE TABLE task_costs(                -- one row per task per cost category
  task_id INTEGER REFERENCES tasks, category TEXT,
  -- categories: the 10 phases (round-0 implementer sessions, phase-weighted),
  -- 'unlabeled' (round-0 implementer sessions lacking phase labels),
  -- 'review' (all reviewer/auditor sessions), and
  -- 'followup_fix' (fixer + implementer sessions with review_round >= 1)
  weighted_tokens REAL, usd REAL,
  computed_at TEXT, price_version TEXT,
  PRIMARY KEY(task_id, category));

CREATE TABLE task_arms(                 -- canonical implementer arm per task
  task_id INTEGER PRIMARY KEY REFERENCES tasks,
  model TEXT, effort TEXT,
  basis_json TEXT);                     -- how chosen + other round-0 sessions

CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
-- meta rows include ('schema_version','3'); schema is applied idempotently
-- (CREATE TABLE IF NOT EXISTS); future schema changes bump schema_version.
-- v2 (Task 5/ingest.py): added grades.review_text.
-- v3 (followup-4): added session_turns/turn_phases (new tables -- CREATE
-- TABLE IF NOT EXISTS handles these on any pre-v3 DB unaided) and
-- sessions.verdict_boundaries_json (a new COLUMN on an already-existing
-- table, which CREATE TABLE IF NOT EXISTS cannot retrofit -- db.py's
-- connect() ALTER TABLEs it in when missing, and bumps this meta row from
-- '2' to '3' since the seed INSERT OR IGNORE never overwrites an existing
-- key). db.py's `_migrate` implements this idempotently, gated on
-- PRAGMA table_info column-presence checks, not the stored version number.

-- estimator layer
CREATE TABLE estimators(
  estimator_id INTEGER PRIMARY KEY,
  trained_at TEXT, code_version TEXT, train_task_count INTEGER,
  config_json TEXT, metrics_json TEXT);
CREATE TABLE estimator_params(          -- one row per (category, arm)
  estimator_id INTEGER REFERENCES estimators,
  category TEXT, model TEXT, effort TEXT,
  posterior_json TEXT,                  -- NIG params: mu vector, Lambda, a, b
  PRIMARY KEY(estimator_id, category, model, effort));

CREATE TABLE ingest_log(
  run_id INTEGER PRIMARY KEY, started_at TEXT, finished_at TEXT,
  git_sha TEXT, actions_json TEXT);
```

Version semantics: one judgment row per (entity, version); re-scoring the
same version (e.g. after an input hash change) upserts in place, while a
rubric/taxonomy bump adds new rows and retains the old — the audit trail is
across versions. The **current** judgment for an entity is the row with the
numerically greatest version (versions are integer strings, compared as
integers); training and derived passes filter to one explicitly configured
version.

Phase-token attribution note: per-phase `weighted_tokens` for a session =
session dollar-cost × (phase output_tokens / total output_tokens). Output
tokens are the only per-turn observable common to both providers; cached-input
cost is spread proportionally. This matches the 2026-07-19 methodology and is
recomputable if we later prefer per-turn input attribution.

### D3. Idempotency and atomicity

- **Discovery** is a pure diff against a git ref, not the worktree
  filesystem: a change qualifies as landed when its archive dir appears in
  `git ls-tree <archive-ref> openspec/changes/archive/` where `--archive-ref`
  defaults to `refs/heads/main` (configurable, e.g. `origin/main`). The
  resolved ref and commit SHA are recorded in `ingest_log`. An explicit
  `--change NAME` restricts ingestion within the landed set only — it never
  bypasses the landed check. Tasks/sessions found for known changes but absent
  from their tables are ingested the same way.
- Each task is ingested in **one SQLite transaction**: task row + sessions +
  any agentic results, or nothing. A crash leaves no partial task.
- Agentic steps (grading, phase labeling, complexity) run **only when the
  cache key misses**: no row for (entity, version) or `input_sha256` changed.
  Their outputs land in a staging dir first with the cache key in the
  filename: `staging/<kind>/<entity_key>__v<version>__<sha256[:12]>.json`,
  written atomically (tmp file + rename). Files failing schema validation are
  renamed to `.err` (never upserted, never treated as complete). Re-running
  after a crash consults staging by exact filename before re-dispatching;
  `--dry-run`'s work plan lists which gaps will be satisfied from staging vs
  dispatched.
- `--dry-run` prints the work plan (which tasks, which agent calls) without
  writing; `--no-agents` ingests mechanical data only.
- Rubric changes: bump `rubric_version` in the asset frontmatter; the next run
  re-scores everything whose stored version differs (opt-in via
  `--rescore <table>` to avoid surprise fleet costs).

### D4. Agentic vs deterministic split

Deterministic (pure Python, no LLM): discovery, transcript parsing/token
stats, session→task joining (path/key based, same heuristics as the analysis
scripts, hardened by requiring change-scoped artifact names when present),
review-round numbering, cost derivation, training, estimation, migration.
Agentic (xagent to cheap models, prompts as assets): complexity scoring
(sonnet), grading from review texts (sonnet), TDD phase labeling (haiku).
Prompt assets live in `projects/agents/task-analyzer/prompts/*.md`; rubrics in
`projects/agents/task-analyzer/rubrics/*.md` (copied from the 2026-07-19
versions, given `version: 1` frontmatter). Both are deliverables.

### D5. Cost categories and the follow-up split (mechanical for old data)

Deterministic event rules over session timestamps (the only clock we have):
- A task's sessions are ordered by `started_at`. A **review boundary** is the
  `ended_at` of each reviewer session (verdict time ≈ session end).
- Implementer and fixer sessions that start **before the first review
  boundary** are initial implementation (`review_round = 0`) and fund the 10
  phase categories.
- Implementer/fixer sessions that start after review boundaries get
  `review_round = n` where n is the count of review boundaries before their
  start (so the first follow-up fix is round 1); every session with
  `review_round >= 1` funds `followup_fix` (no phase apportionment).
- Round-0 implementer sessions without phase labels fund the `unlabeled`
  category (a legal category alongside the 10 phases).
- All reviewer/auditor sessions fund `review`, whatever their round; a
  re-review with no intervening implementer/fixer session contributes to
  `review` only and creates no fix rows.
- Aborted or zero-output sessions are included in their category (their
  tokens were spent); sessions that failed to join a task (quarantined) fund
  nothing. Tasks with no reviewer sessions have only round-0 categories.
- The **canonical arm** for a task (`task_arms`) is the (model, effort) of the
  round-0 implementer session with the greatest output_tokens; other round-0
  implementer sessions are recorded in `basis_json`. All of the task's cost
  categories — including `review` and `followup_fix` — train against the
  canonical implementer arm; reviewer/fixer models stay in `sessions` for
  analysis but are never the training arm.
This is computable from the already-extracted 2026-07-19 session records — no
re-labeling needed. Letter grades stay recorded for offline analysis but are
not a regression target.

**Amendment (followup-4): persistent sessions and multi-verdict boundaries.**
The `openspec-superpowers-workflow` skill's "Provider and model rules" now
deliberately keep implementer and reviewer sessions **open and resumed**
across fix/re-review rounds, rather than spawning a fresh session per round.
This broke two assumptions the original rules above depended on:

1. A resumed round-0 implementer session can contain turns performed
   *after* the task's first review verdict — pure session-level
   apportionment would misattribute that fix work to the phase categories
   (or `unlabeled`) instead of `followup_fix`, even though `review_round`
   correctly stays 0 (round is a session-*start*-time property, unchanged).
2. A resumed reviewer session doing review + re-review is still just *one*
   session row, so "one review boundary per reviewer session's `ended_at`"
   collapsed multiple real verdicts into a single boundary — an
   implementer/fixer session starting between the first and second verdict
   was incorrectly assigned round 0 instead of round 1.

Both are fixed with mechanical, deterministic detection, never inference:

- **Verdict-turn detection** (`extractors.py`): a turn is a verdict turn iff
  its assistant text (the FULL, untruncated text — not the condensed/
  truncated timeline snippet used for phase labeling, since verdict lines
  conventionally sit at the very end of a long review response and would
  often fall outside the truncated form) matches both a `SPEC: PASS|FAIL`
  regex and a permissive `QUALITY: APPROVE[D]?|NEEDS[- ]FIXES|PASS|FAIL|
  REVISE` regex. Every verdict turn's own `ended_at` is persisted as one of
  the session's `verdict_boundaries` (`sessions.verdict_boundaries_json`).
- **Review boundaries are now the union of every reviewer session's
  detected verdict-turn timestamps** (`discovery.review_boundaries`),
  sorted, not one boundary per reviewer session. `assign_review_rounds`
  uses this union unchanged otherwise (implementer/fixer round = count of
  boundaries strictly before its `started_at`; a reviewer's own round =
  count of boundaries at-or-before its own `ended_at`). A reviewer session
  with no detected verdict turns at all (no SPEC:/QUALITY: co-occurrence
  found, or predating this amendment with no `session_turns` to re-derive
  it from) falls back to its own `ended_at` as a single boundary — the
  original, pre-amendment behavior — so this is a strict generalization,
  never a regression for data without verdict detail.
- **Spanning-session split** (`costs.py`): for a round-0 implementer session
  that has `session_turns` rows AND the task has at least one review
  boundary, turns starting strictly *after* the first boundary are the
  **fix partition** — they fund `followup_fix` at their summed
  `output_tokens`, and a proportional `session_usd * fix_output_tokens /
  total_turn_output_tokens` (the same "apportion by output_tokens share of
  session usd" convention the phase split already uses). The remaining
  pre-boundary turns fund the phase categories: if `turn_phases` rows exist
  for this session (direct — phase shares computed from just the
  pre-boundary turns' own labels, residual funding `unlabeled` as usual),
  else the session's original, full-session `phase_tokens` shares are
  *scaled* by `pre_boundary_output_tokens / total_turn_output_tokens`
  (less precise — assumes uniform phase proportions across turns — but
  still exact on the sum-preserving invariant, since the fix and scaled
  pre-boundary shares are defined to add back to exactly `session_usd`). A
  round-0 session with no `session_turns` rows at all (not yet backfilled,
  or unrecoverable) uses the original, unsplit whole-session apportionment
  — a real, documented approximation, not a bug: the split can only ever
  be as good as the per-turn data available.

  **Turn coverage caveat (fix-round-2 review).** `fix_share`/`pre_share`
  are computed entirely against `total_turn_output_tokens` (the
  `session_turns` sum for this session), NOT against the session's own
  `output_tokens` — and the two can disagree (a real, documented gap in
  `extractors.py`'s turn-splitting; see `README.md`'s "known limitation"
  section). The split still allocates the session's *entire* usd
  (`fix_share + pre_share == 1` by construction, so the task-level total
  is unaffected), but when `total_turn_output_tokens` is less than the
  session's true `output_tokens` (turn coverage < 100%), the *missing*
  delta mass is implicitly distributed pro-rata across BOTH the fix and
  phase partitions in whatever ratio the turns actually present in
  `session_turns` happen to reflect — so the split *between*
  `followup_fix` and the phase categories for that session is only as
  accurate as its coverage ratio, not exact. `costs.rebuild` computes and
  surfaces each split session's coverage (`RebuildResult.
  spanning_session_coverage`), warning loudly (stderr) below a documented
  threshold (`costs.DEFAULT_COVERAGE_WARN_THRESHOLD = 0.9`) — this is
  observability, not an attribution redesign: a fix-round-1 version of
  this document (and the followup-4 report) incorrectly characterized the
  coverage gap as affecting only the diagnostic `weighted_tokens` figure;
  that is true for an UNSPLIT round-0 session (phase shares there come
  from `output_tokens` directly, never `session_turns`), but not for a
  session that actually gets split at a review boundary.

  **Silent-checkpoint reconciliation (followup-5).** The turn-coverage gap
  above had a root cause in `extractors.py`: a token-usage checkpoint
  whose window produced no condensed timeline items (no `SAY`/`CALL`/
  `OUT`/`THINK`) used to discard its delta entirely -- counted in the
  session-level cumulative total but attributed to no turn at all. Fixed
  by folding every silent checkpoint's delta into an EXISTING adjacent
  turn (never creating a new turn or renumbering one, since `turn_phases`
  and the rendered timelines are keyed by turn index): mass before the
  first visible turn folds into turn 1, a gap between two visible turns
  folds into the next one, and trailing mass after the last visible turn
  folds into that last turn. For codex specifically, each checkpoint's
  delta is now computed as the increase in the cumulative
  `total_token_usage` counter since the previous checkpoint (verified
  monotonically non-decreasing across the entire real corpus) rather than
  read from `last_token_usage` directly -- this also correctly attributes
  a resumed/continued (`thread_spawn`) session's inherited leading
  baseline, and is immune to the rare checkpoint whose own reported delta
  doesn't match the counter's true step. Post-condition:
  `sum(session_turns.output_tokens) == sessions.output_tokens` for every
  session with at least one turn (verified on the entire real corpus,
  zero exceptions among sessions with turns; a session with genuinely
  zero turns has no turn to fold pending mass into, an explicit, tested,
  documented exception, not a silent leak). `spanning_session_coverage`
  should read 1.0 for every split session after `backfill-turns
  --regenerate` + `rebuild-derived` runs against the corrected extractor;
  see `.superpowers/sdd/task-analyzer/followup-5-report.md` for the real
  dataset's before/after numbers.
- **Backfill** (`ingest.py backfill-turns`): for any already-ingested
  session lacking `session_turns` (or, with `--regenerate`, EVERY session
  with a recoverable transcript, replacing existing rows -- followup-5:
  use this once after an `extractors.py` change that alters per-turn
  deltas, since the default only fills gaps and would never re-derive a
  session it already backfilled under older logic), re-extracts turns
  from `sessions.transcript_path` if that file still exists on disk,
  refreshing `sessions.n_turns` from the result; for round-0 implementer
  sessions that gain turns this way, also attempts to backfill
  `turn_phases` from a still-valid staged `phase_labeling` JSON, else the
  analysis dataset's per-turn `phase_labels/<key>.json` (the 2026-07-19
  migration's source data — the only recoverable per-turn label source for
  the currently 100%-`migrated_v0` corpus, which predates this module's
  live staging path entirely). Before that, any session that ALREADY has
  `turn_phases` rows gets its `phase_tokens` mechanically recomputed from
  those (untouched) labels joined against the current `session_turns`
  (followup-5 — see D2's `turn_phases` note) — this must run first, or a
  stale `phase_tokens` row would spuriously fail the next step's
  verification. A session whose transcript file no longer exists (or
  fails to parse) is reported unrecoverable — its cost attribution simply
  stays session-level, unchanged. Note a real recoverability limit this
  uncovered: the analysis dataset's rendered
  timelines carry per-turn output-token counts but never per-turn
  *timestamps*, so they can only ever backfill `turn_phases`, never
  `session_turns` (which needs real timestamps only available from the raw
  transcript file itself) — the analysis dataset is therefore a
  `turn_phases`-only fallback, never a `session_turns` source.

### D6. Estimator: conjugate Bayesian regression per (category, arm)

Per cost category and per (model, effort) arm, fit a **Normal-Inverse-Gamma
Bayesian linear regression on log(usd + ε)** with features
`[1, composite, C3, C4, C5]` (config-driven; start small). Closed form, no
dependencies beyond numpy, and the posterior predictive is a Student-t: p50,
p80, or any quantile is one line, and posterior variance per arm is exactly
what Thompson sampling needs. A weak global prior is shared across arms:
the pooled fit over all arms contributes the prior MEAN only (its coefficient
vector becomes μ0), while prior precision stays weak (Λ0 = I·1e-2, a0=1,
b0=1) — the arm's own rows are then counted exactly once, in the per-arm
update. Sparse arms (luna, 5.4) thus inherit sensible pooled behavior with
wide intervals, which is exactly what the p20-bandit selection rule below
is built to exploit/explore on. Alternatives considered: full hierarchical
MCMC (too heavy, unneeded at n≈150), quantile regression (no posterior →
no explore/exploit), gradient boosting (data-hungry, opaque). Log-space
handles the observed heavy right tail.

`train.py` reads `task_costs × complexity × task_arms`, writes one
`estimators` row + `estimator_params` rows; old estimators are kept
(audit/rollback). `estimators.config_json` is **normative** and sufficient to
reproduce every query: feature names and order, target transform and epsilon,
prior hyperparameters and pooling scheme, training filters (rubric_version,
taxonomy_version, price_version, date range, min rows per arm), the category
list, the arm list, the quantile algorithm identifier, and canonical output
formatting rules. Thompson sampling takes an explicit caller-supplied seed
(never persisted).

**Pooled fallback (followup-1, Part A).** In addition to the per-(category,
arm) mean-only pooling above, `train.py` also persists the *full* pooled
posterior per category (the weak prior updated on every arm's rows in that
category combined) as one `estimator_params` row per category, under a
sentinel arm key `("(pooled)", "(pooled)")` (`model.POOLED_SENTINEL_ARM`) —
a value no real provider ever reports, so it can't collide with an actual
arm. `estimate.py` uses this as its fallback whenever a real (category,
arm) cell has no posterior: honest and wide, rather than making the arm
**unscorable**. An arm is unscorable only if even the pooled fallback has
no row for some category it needs (e.g. a category absent from the
training data entirely). This replaces an earlier, rejected "full-coverage"
rule that excluded any arm missing even one per-arm posterior cell from
scoring altogether — with the migrated dataset that left only 2 of 10 arms
scorable, and an excluded arm can never be selected, so it never accrues
new data (the arm set freezes, defeating explore/exploit). Every arm's
`fallback_categories` (which categories, if any, resolved via the pooled
row rather than its own posterior) is echoed in `estimate.py`'s report as
a diagnostic; it does not, by itself, change selection.

**p20-bandit selection via Monte Carlo.**
A task's total cost per arm is the *sum* over categories of each category's
own (independent) log-space Student-t predictive, exponentiated to USD.
Quantiles do not commute with sums in general, and there is no closed form
for the quantiles of a sum of exponentiated Student-t's (`exp(t)` has no
finite moments) — for a moderate-tailed posterior, summing each category's
own p80 typically overstates the true p80 of the total and summing each
category's p20 typically understates the true p20 (independence means the
categories' tails don't usually all land together), but this direction is
**not guaranteed** at very heavy tails (a sparse or pooled-fallback
posterior can have few enough degrees of freedom that independence no
longer implies it, a known property of sufficiently heavy-tailed risks) —
so totals are always estimated by Monte Carlo *of the sum*, never a sum
*of* quantiles, regardless of which way any given posterior's inequality
happens to point (fix round 1, codex review of followup-2). Estimated by
seeded Monte Carlo (`model.NIG.predictive_draws`, `loc + scale *
rng.standard_t(df, size=n)`): draw `--mc-draws` samples per category
(independent), exponentiate each (floored at 0.0 — a dollar cost cannot be
negative), column-sum across categories, then take the empirical
p20/p50/p80 of the resulting per-arm total draws over the *finite* subset
only (`numpy.quantile`, linear interpolation) — a sufficiently heavy-tailed
draw can overflow `exp` to `inf`; the count of non-finite draws is reported
per arm (`nonfinite_draws`), and an arm with zero finite draws is
unscorable (`reason: "all_draws_nonfinite"`) rather than producing a
non-finite total (`json.dumps(..., allow_nan=False)` in `estimate.py`'s CLI
entry point is the hard boundary this exists to satisfy — a report must
never contain `Infinity`/`NaN`). Two independent `numpy.random.Generator`s
(one for MC draws, one for Thompson draws, both derived from one `--seed`
via `numpy.random.SeedSequence.spawn(2)` — `estimate._derive_rngs`) are
each shared across a whole `estimate.py` run and consumed in a fixed order
(tasks in decomposition order, arms sorted by `(model, effort)`, categories
in `config["categories"]` order), so output is byte-deterministic given
(estimator id, seed, mc-draws, thompson mode) — and, because the two
streams never share state, a report's MC totals are identical whether or
not `--thompson` was given (an earlier version of this design shared one
stream for both, which desynchronized later tasks' MC draws between the
two modes at the same seed — fix round 1).

Selection is **"p20 bandit"**, not "minimize expected total": the
selection statistic is each arm's MC `p20_total_usd` — a *low* quantile,
chosen because this is a cost-minimizing bandit, and low quantiles are
intrinsically explore-friendly (an unknown/sparse arm's wide posterior
pulls its own p20 down even though its median may be high; a genuinely
cheap, well-sampled arm's p20 stays low too) — so minimizing p20 both
exploits what's known-cheap and explores what's still uncertain, without
any separate advisory exploration flag. The selected arm is whichever
scorable arm has the lowest `p20_total_usd` (tie-break `(model, effort)`
lexicographic), among *all* scorable arms — no tail-risk exclusion.
`p80_total_usd` is still reported per arm as budgeting information; it
just never gates selection (followup-3: a p80-based guard was tried and
then deliberately removed — it suppressed exploration of exactly the
sparse arms p20-selection exists to explore, which defeated the point of
the bandit; reintroducing some form of tail-risk guard remains an option
if real usage shows a need for one). `estimate.py --thompson` selects
differently: one Thompson draw (`model.NIG.thompson`, the classic
sample-sigma2-then-beta-then-x·beta procedure) per (arm, category) from
the dedicated Thompson rng stream, summed to one `thompson_total_usd` per
arm (`None` if non-finite), argmin among all scorable arms with a finite
total (falls back to the p20 statistic if none is finite, rather than
crash comparing `None`s). Both modes are fully deterministic given the
same seed; see `estimate.py`'s module docstring for the complete
rng-consumption-order contract.

### D7. Decomposition subagent protocol

A prompt asset (`prompts/decomposer.md`) defining a search loop, run as a
subagent with the proposal/design/specs as input:

1. Generate K=3–5 candidate decompositions varying granularity and grouping
   axis (checklist-order bracketing vs build/test-target regrouping — both
   patterns observed in real runs).
2. For each candidate, score every task's C1–C7 against the complexity rubric
   (agentic, in-context) and write a candidate YAML.
3. Run `estimate.py` on each candidate (deterministic; reads the **main
   branch** database path passed in by the caller, never the worktree copy).
4. Compare each candidate's total p20 cost (the arm-selection statistic
   `estimate.py` itself ranks and picks by — the lowest Monte Carlo p20
   total among all scorable arms, not a configured quantile knob); apply
   guardrails: no task above composite 3.5 (split it), prefer C7 ≤ 2
   briefs, respect dependency order. (These are the decomposer's own
   candidate-shape guardrails, unrelated to `estimate.py`'s selection
   statistic — the latter no longer has any guard of its own, see D6.)
5. Emit: chosen decomposition, its annotation YAML, the per-candidate score
   table, and a one-paragraph rationale.

The subagent never edits workflow files; its output is consumed by a human or
(later) by openspec-superpowers-workflow.

### D8. Migration of the 2026-07-19 dataset

`migrate_v0.py` (one-shot, idempotent) imports from
`analysis/sdd-model-analysis/data/`: `codex_sessions.json`/
`claude_sessions.json` → `sessions` (+ transcript paths), `tasks.json` →
`changes`/`tasks` (brief text re-read from disk where files survive, else the
prompt text stored), `complexity/*.json` → `complexity` (rubric_version=1),
`grades/*.json` → `grades` (rubric_version=1), `phase_labels/*.json` +
timeline turn headers → `phase_tokens` (taxonomy_version=1). Review rounds and
`task_costs` are then computed by the normal deterministic pass. Nothing is
re-labeled; known data-quality caveats (mis-joined reviews, lost briefs) carry
over as-is and are marked with a `migrated_v0` flag in `ingest_log`.

### D9. Database location and versioning

`data/agents/task-analyzer.sqlite` is committed to git (single-writer,
occasional offline updates, ~MB scale). Every ingest also writes
`data/agents/task-analyzer.dump.jsonl` (stable-ordered JSONL export) so PRs
show reviewable diffs of what changed. Alternative (gitignored DB +
regenerate) rejected: agentic labels cost real tokens and must not be
regenerable-only.

## Risks / Trade-offs

- [Sparse arms → garbage point estimates] → partial pooling + wide posterior
  intervals; p20-bandit selection (followup-2) turns that width into low,
  optimistic p20 scores directly instead of a separate advisory flag, so a
  sparse arm's own uncertainty is what gets it tried.
- [Task-key mis-joins across reused worktrees (observed repeatedly)] →
  ingester requires change-scoped brief names when present, stores
  `brief_sha256`, and quarantines ambiguous joins into `ingest_log` for
  manual resolution instead of guessing.
- [Rubric drift silently mixing incomparable scores] → every agentic row keyed
  by rubric_version; training filters to one version; `--rescore` migrates.
- [Reviewer-provider severity skew biases grades (claude reviewers minor-happy,
  codex reviewers crit-happy)] → grades are recorded but not a regression
  target; cost targets (review/followup tokens) are provider-agnostic.
- [Price table staleness] → `model_prices` is versioned by effective_date;
  `task_costs.price_version` records which prices produced each row;
  `rebuild-derived` recomputes cheaply.
- [SQLite binary in git] → mitigated by JSONL dump for diffs; DB stays small.

## Migration Plan

1. Land schema + ingester + assets; run `migrate_v0.py` against the analysis
   branch data; run `rebuild-derived`; commit DB + dump.
2. Run `train.py`; commit estimator rows.
3. Decomposition subagent usable immediately via manual invocation; workflow
   integration is a separate future change.
Rollback: delete the DB file and `projects/agents/task-analyzer/`; nothing
else references them.

## Open Questions

- Quantile for the decision rule (p80 placeholder; config value, revisit after
  first retrain).
- Whether `brief_text` archival should also snapshot review texts (storage vs
  reproducibility; current lean: yes for reviews of graded tasks, they are
  the grades' provenance).
