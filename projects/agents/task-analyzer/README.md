# task-analyzer

SDD (spec-driven-development) data-collection and cost-model pipeline. It
mines real implementer/reviewer transcripts, scores task complexity (C1–C7)
and implementer quality (G1–G5) with cheap LLM subagents, derives per-task
dollar costs from token usage, trains a Bayesian estimator of cost per
(task complexity, model, effort) arm, and uses that estimator to help decompose
new OpenSpec changes into cost-aware task lists. See
`openspec/changes/archive/.../design.md` for the full design rationale (D1–D9)
this README assumes as background.

## Run cadence

Offline and occasional — there is no service, cron, or CI hook. A human runs
`ingest.py` after a batch of changes lands on `main` (weekly-ish is the
expected cadence, not enforced), commits the refreshed
`data/agents/task-analyzer.sqlite` + `data/agents/task-analyzer.dump.jsonl`,
and re-trains (`train.py`) only when there's enough new data to matter — there
is no fixed retrain schedule, see "Recompute matrix" below. The decomposer
(`prompts/decomposer.md`) is invoked manually per OpenSpec change, today; see
"Not yet integrated" below.

## Command reference

All commands are run from the repo root with `python3` (stdlib + numpy only,
no other dependencies). `--db` defaults to `data/agents/task-analyzer.sqlite`
where a command has a default at all; pass it explicitly when working against
a scratch/test copy.

### `ingest.py` — mechanical + agentic ingestion

```
python3 projects/agents/task-analyzer/ingest.py [ingest|rebuild-derived] \
    [--db PATH] [--repo PATH] [--dry-run] [--no-agents] \
    [--rescore complexity|grades|phase_tokens] [--change NAME]
```

- `ingest` (default command): diffs landed `openspec/changes/archive/` dirs
  against git (never the worktree filesystem — a change only qualifies once
  its archive dir is present at the resolved ref, default
  `refs/heads/main`), ingests new tasks/sessions, dispatches agentic scoring
  for cache misses (complexity/grading/phase-labeling), and calls
  `costs.rebuild` at the end.
- `rebuild-derived`: recomputes `task_costs`/`task_arms` from already-ingested
  raw + agentic rows only — no discovery, no agent dispatch. This is the
  command to run after a price-table change (see the recompute matrix).
- `--dry-run`: prints the work plan (which tasks, which agent calls would
  fire) without writing anything; against a DB that doesn't exist yet, it
  plans against a throwaway in-memory schema instead of creating the file.
- `--no-agents`: mechanical ingestion only — no xagent dispatch, no cost to
  a fleet.
- `--rescore TABLE`: opt-in re-scoring of everything whose stored
  `rubric_version`/`taxonomy_version` differs from the asset's current
  version (a rubric bump alone does not silently trigger a fleet-wide
  re-score; you ask for it).
- `--change NAME`: restricts ingestion to one change within the already-landed
  set — it never bypasses the landed check, it only narrows it.
- Both commands write the refreshed `<db>.dump.jsonl` sibling next to the
  database on every real (non-dry-run) run — that JSONL file is what PRs
  should be reviewed against, since the sqlite binary itself doesn't diff
  usefully.

### `migrate_v0.py` — one-shot 2026-07-19 dataset migration

```
python3 projects/agents/task-analyzer/migrate_v0.py --db PATH \
    [--source DIR] [--reconcile-targets JSON] [--reconcile-tolerance N]
```

Already run once against the landed dataset (D8); idempotent if re-run, but
there should be no reason to run it again absent a new historical corpus to
backfill. Prints a JSON summary plus a reconciliation table (expected vs.
actual row counts against `DEFAULT_RECONCILE_TARGETS`, ±`--reconcile-tolerance`).

### `train.py` — train a new estimator generation

```
python3 projects/agents/task-analyzer/train.py --db PATH [--config JSON]
```

Reads `task_costs` joined against the *current* (numerically greatest)
`complexity` rubric version and each task's canonical `task_arms` row (tasks
with no determinable arm — no round-0 implementer session — are excluded, not
crashed on). Writes one new `estimators` row + one `estimator_params` row per
(category, arm) with data, **plus one sentinel row per category** —
`model = effort = "(pooled)"` (`model.POOLED_SENTINEL_ARM`, a value no real
provider ever reports) — carrying that category's pooled posterior (every
arm's rows in that category, fit from the weak prior); `estimate.py` falls
back to this row for any (category, arm) cell that has no posterior of its
own. `train.py` **never** touches or deletes a prior generation — old
estimators stay for audit/rollback (D9), so `estimate.py` always defaults to
the numerically greatest `estimator_id` unless `--estimator-id` pins an
older one. `--config` is a path to a JSON file of overrides deep-merged onto
`model.default_config()` (feature list, epsilon, prior hyperparameters,
`min_rows_per_arm`, guard factor).

### `estimate.py` — score a candidate decomposition

```
python3 projects/agents/task-analyzer/estimate.py \
    (--decomposition FILE | --sanity) [--db PATH] \
    [--estimator-id N] [--guard-factor F] [--seed N] [--mc-draws N] \
    [--thompson] [--json]
```

Read-only against the database — never writes to it. `--decomposition` takes
either a `.json` file or an annotation-subset `.yaml` (same format
`annotations.py` reads/writes); `--sanity` scores a fixed synthetic 3-task
reference decomposition at composites {2, 3, 4} instead, for smoke-checking a
freshly trained estimator without hand-writing an input file. `--json` emits
the full machine-readable report; omit it for the human table (arm rankings,
selected-arm marker, `unscorable_arms`, decomposition totals).

An arm missing a per-arm posterior for some category falls back to that
category's pooled posterior (the `"(pooled)"` sentinel row `train.py`
persists — see above); each arm's `fallback_categories` in the report lists
which categories, if any, resolved that way (diagnostic only — it does not
by itself change selection). An arm is `unscorable` only if even the pooled
fallback has no row for a category it needs.

A task's total cost per arm is the *sum* of independent per-category
predictives — and quantiles don't commute with sums (summing each
category's p80 overstates the total's true p80; summing each category's p20
understates it), so totals are computed by seeded Monte Carlo
(`--seed`, default 0; `--mc-draws`, default 2000) rather than as a sum of
each category's own quantile. Selection is **"p20 bandit with a p80
guard"**: the selected arm is the one with the lowest MC `p20_total_usd`
among arms whose MC `p80_total_usd` doesn't exceed `--guard-factor` (default
2.0, or the estimator's own `config_json["guard_factor"]`) times the
cheapest scorable arm's p80 total. Minimizing a *low* quantile is
deliberately explore-friendly — a sparse arm's wide posterior pulls its own
p20 down even when its median is high — so there is no separate advisory
flag for exploration; `--thompson` selects via one Thompson draw per arm
instead (summed across categories from the same seeded rng), reported as
`"selection_mode": "thompson"` vs. the default `"p20"`. Both modes are
fully deterministic given the same `--seed`/`--mc-draws`/`--estimator-id`.

### `annotations.py` — validate a sibling annotation file

```
python3 projects/agents/task-analyzer/annotations.py FILE \
    (--plan PLAN.md | --tasks task-1,task-2) [--db PATH] [--estimator-id N]
```

Validates format version, task-key coverage against the plan as a *multiset*
(unknown/missing/duplicate all reported separately), C1–C7 ranges, composite
agreement, and `(model, effort)` arm membership (only checked if `--db` is
given — omitting it skips arm validation but still runs everything else).
Prints every violation, then an error count, and exits nonzero if any;
prints `valid` and exits 0 otherwise.

## Recompute matrix

| Change | What to run | Why |
| --- | --- | --- |
| Complexity/grading/phase-taxonomy rubric bump (frontmatter `version:` in `rubrics/*.md`) | `ingest.py --rescore <table>` | Re-scores every stored judgment whose recorded version differs from the asset's new one; old-version rows are kept (audit trail), not overwritten in place. |
| `model_prices` price-table change | `ingest.py rebuild-derived` | Recomputes `task_costs`/`task_arms` from already-ingested raw + agentic rows using the new price rows — cheap, no re-ingestion or re-scoring needed. |
| Phase taxonomy bump (new/renamed phase keys) | `ingest.py --rescore phase_tokens`, then relabel/remap any downstream category naming assumptions by hand (the taxonomy's phase keys feed `task_costs.category` via D5's event rules) | A taxonomy version bump changes what a "phase" *is*, not just its price — treat it as a relabel, not a mechanical recompute; review before retraining. |
| New batch of ingested changes | `ingest.py`, then eyeball `--dry-run` first if the batch is large or new-provider sessions are involved | Normal cadence — no forced retrain; training is a separate, deliberate step. |
| Estimator retrain | `train.py --db data/agents/task-analyzer.sqlite`, then `estimate.py --sanity` as a smoke check | No fixed cadence — retrain when there's enough new `task_costs` data to matter (a handful of new tasks won't move sparse-arm posteriors much). Every retrain adds a new `estimators` row; nothing is overwritten, so a bad retrain is recoverable by pinning `--estimator-id` back to the prior generation. |

## Staging / crash-recovery semantics

- Each task is ingested inside **one SQLite transaction** (task row +
  sessions + any agentic results, or nothing) — a crash mid-task leaves no
  partial row, just a task that will be picked up again on the next run.
- Agentic dispatch (complexity/grading/phase-labeling) writes its outputs to
  a staging directory first, atomically (tmp file + rename), keyed by
  `staging/<kind>/<entity_key>__v<version>__<input_sha256[:12]>.json`. A
  re-run after a crash consults staging by exact filename before
  re-dispatching anything — an interrupted run does not re-spend fleet
  tokens on work it already produced, it just re-reads the staged file.
  Files that fail schema validation on read-back are never upserted or
  treated as complete (see `agents.py`'s validate-then-write-atomically
  contract).
- `--dry-run` never writes to the target database (and never creates one
  that doesn't already exist — it plans against an in-memory schema
  instead), so it's always safe to run after a crash to see what the next
  real run would do before committing to it.

## Not yet integrated

The decomposer (`prompts/decomposer.md`) is usable today only via **manual
subagent dispatch** — there is no automated hook into
`openspec-superpowers-workflow` or any other planning flow. Wiring the
decomposer into that workflow (so a plan's task list and its
`.assignments.yaml` sibling are generated together, instead of the
decomposer being invoked by hand against an already-written plan) is
explicitly deferred to a future change (design.md's Migration Plan, step 3).
See `projects/agents/task-analyzer/examples/` for a worked dry-run of manual
dispatch against an already-archived change.

## Configuration

- `TASK_ANALYZER_XAGENT_MAIN` (env var): overrides the resolved path to the
  xagent CLI entry point (`node <path> run ...`) that `agents.xagent_runner`
  shells out to for real agentic dispatch. Resolution order: the
  `xagent_main` keyword argument passed directly to `xagent_runner` (highest
  priority) → this env var → the repo-relative default
  (`projects/xagent/dist/src/main.js`). Set it when running the pipeline
  against a different xagent checkout/build (e.g. a worktree with its own
  `dist/`); a missing resolved path raises loudly (`RuntimeError` naming all
  three resolution sources) rather than silently producing zero staged
  files.

## Known gaps / TODOs

- **Price audit**: `data/agents/task-analyzer.sqlite`'s `model_prices` table
  was populated during migration (D8) from the 2026-07-19 dataset's
  point-in-time price assumptions; ten rows (the eight gpt-5.x models plus
  claude-sonnet-4-6 and claude-fable-5) were $1/$1/$1 placeholders until a
  follow-up price audit (2026-07-23, see `schema.sql`'s seed comment)
  replaced them with verified list prices and retrained the estimator. No
  row here is independently re-audited on a schedule, though — before
  relying on `estimate.py`'s dollar figures for a real budget decision (as
  opposed to the relative/directional comparisons the decomposer uses),
  re-check `model_prices` against each provider's current pricing pages and,
  if it's stale, add a new `price_version` row and run
  `ingest.py rebuild-derived` to repropagate it into `task_costs`.

## Tests

```
python3 -m unittest discover -s projects/agents/task-analyzer/tests -v
```
