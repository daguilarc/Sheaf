"""Decomposition estimator CLI (design.md D6/D7;
specs/task-analyzer-cost-model/spec.md "Decomposition estimator CLI").

Reads a candidate decomposition (annotation-format doc with per-task
complexity vectors -- see ``annotations.py``), queries a trained estimator's
posteriors (``estimators``/``estimator_params``, written by ``train.py``),
and for every task ranks every known (model, effort) arm by predicted total
cost and picks a selected arm.

Per-category diagnostics (mean/median/p20/p80) are exact and cheap: each
category's posterior predictive is a closed-form Student-t (``model.NIG.
predictive``/``quantile``). An arm missing a posterior for some category
falls back to that category's *pooled* posterior instead -- the sentinel
``estimator_params`` row ``train.py`` persists per category
(``model.POOLED_SENTINEL_ARM``), fit across every arm's rows in that
category. This is honest and wide rather than silently contributing 0 USD
for what's missing, or excluding the arm entirely (an excluded arm can
never be selected, so it accrues no new data and is frozen out
permanently). Categories scored via fallback are listed per arm under
``fallback_categories`` in the report -- diagnostic only, it does not by
itself change selection. An arm is **unscorable** only if *even the pooled
posterior* has no row for some category it needs; such arms are excluded
from ranking/selection entirely and reported separately (per task) under
``unscorable_arms`` with their ``missing_categories`` listed.

A task's TOTAL cost per arm, however, is not exact: it is the *sum* over
categories of each category's (independent) log-space Student-t predictive,
exponentiated back to USD. Quantiles do not commute with sums -- summing
each category's own p80 overstates the total's true p80 (independence means
the categories' tails don't all land together), and summing each category's
p20 understates the total's true p20, for the same reason in the other
direction. There is also no closed form for the quantiles of a sum of
exponentiated Student-t's (``exp(t)`` has no finite moments). So totals are
estimated by seeded Monte Carlo (``model.NIG.predictive_draws``): draw
``--mc-draws`` samples per category (independent, log space), exponentiate
each via ``model.inverse_transform_array`` (floored at 0.0 -- a dollar cost
cannot be negative), column-sum across categories to get that many draws of
the arm's *total* cost, then take the empirical p20/p50/p80 of those draws
(``numpy.quantile``, linear interpolation -- fixed and bit-stable given the
same draws). One ``numpy.random.Generator`` (seeded via ``--seed``, default
0) is shared across the whole run and consumed in a fixed order -- tasks in
decomposition order, arms sorted by ``(model, effort)``, categories in
``config["categories"]`` order -- so output is byte-deterministic given
(estimator id, seed, mc-draws) regardless of any dict's iteration order.

Selection ("p20 bandit selection with a p80 guard"): the selection
statistic is each arm's MC ``p20_total_usd`` -- a *low* quantile, not a
mean or median, because this is a cost-minimizing bandit: an arm's p20
starts low (wide, hopeful) when data is sparse and rises as data
accumulates if the arm turns out to be expensive, while a genuinely cheap
arm's p20 stays low -- so minimizing p20 both exploits what's known cheap
and explores what's still uncertain, without a separate advisory flag for
it. The guard excludes any arm whose MC ``p80_total_usd`` exceeds a *guard
factor* times the *minimum* MC ``p80_total_usd`` among scorable arms for
that task (unchanged rationale from the pre-MC design: this stops "cheap at
p20, catastrophic in the tail" arms from winning on the optimistic quantile
alone -- but now built from an honest quantile-of-the-sum instead of a
sum-of-quantiles, so the guard's own semantics are no longer overstated).
The guard factor itself (default ``DEFAULT_GUARD_FACTOR = 2.0``) is
resolved per run as: ``--guard-factor`` CLI flag, else
``config_json["guard_factor"]`` if the estimator's own config specifies
one, else the hardcoded default -- echoed back in the JSON report as
``"guard_factor"``. The selected arm is whichever guard-passing arm has the
lowest ``p20_total_usd`` (tie-break ``(model, effort)`` lexicographic); if
the guard excludes every arm (only possible with an overridden guard factor
below 1.0), selection falls back to the single best arm by the same
statistic among all scorable arms, bypassing the guard. The report's
``"arms"`` list is always ranked by ``p20_total_usd`` ascending, regardless
of selection mode.

``--thompson`` selects differently: for each scorable arm, draw exactly one
predictive sample per category from the *same* shared rng (``model.NIG.
thompson`` -- the genuine Bayesian Thompson draw: sample sigma2, then beta,
then ``x @ beta``, per design.md D6's "Thompson sampling takes an explicit
caller-supplied seed"), inverse-transform and floor each at 0.0, and sum
across categories to one ``thompson_total_usd`` per arm; the selected arm is
the guard-passing arm with the lowest ``thompson_total_usd`` (the guard
itself is still computed from the MC ``p80_total_usd``, which is always
computed regardless of mode). The report's top-level ``"selection_mode"``
is ``"thompson"`` or ``"p20"``; every arm's ``thompson_total_usd`` is
``null`` unless ``--thompson`` was given. Both modes are equally
deterministic given the same seed -- there is no non-deterministic
randomness anywhere in this module.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Optional

import numpy as np

import annotations
import db
import model

DEFAULT_DB = Path(__file__).resolve().parents[3] / "data" / "agents" / "task-analyzer.sqlite"
DEFAULT_GUARD_FACTOR = 2.0
DEFAULT_MC_DRAWS = 2000
DEFAULT_SEED = 0
SANITY_COMPOSITES = (2.0, 3.0, 4.0)


def resolve_guard_factor(config: dict, guard_factor: Optional[float]) -> float:
    """Resolve the effective guard factor: explicit ``--guard-factor`` CLI
    value wins, then the estimator's own ``config_json["guard_factor"]``,
    then ``DEFAULT_GUARD_FACTOR``."""
    if guard_factor is not None:
        return guard_factor
    return float(config.get("guard_factor", DEFAULT_GUARD_FACTOR))


def _empirical_quantile(draws: np.ndarray, q: float) -> float:
    """The ``q``-quantile of ``draws`` via sorted-array linear interpolation
    (``numpy.quantile``'s ``method="linear"``, the default) -- fixed and
    documented so a report is bit-stable given the same draws array."""
    return float(np.quantile(draws, q, method="linear"))


class EstimatorError(RuntimeError):
    pass


def load_estimator(conn, estimator_id: Optional[int] = None):
    """Return ``(estimator_id, config, posteriors)`` where ``posteriors``
    maps ``(category, model, effort) -> model.NIG`` (including the pooled
    sentinel rows under ``model.POOLED_SENTINEL_ARM``). Defaults to the
    numerically greatest ``estimator_id`` present (the most recently
    trained generation) when ``estimator_id`` is None."""
    if estimator_id is None:
        row = conn.execute("SELECT MAX(estimator_id) AS id FROM estimators").fetchone()
        estimator_id = row["id"] if row else None
        if estimator_id is None:
            raise EstimatorError("no estimators found in database; run train.py first")

    est_row = conn.execute(
        "SELECT config_json FROM estimators WHERE estimator_id = ?", (estimator_id,)
    ).fetchone()
    if est_row is None:
        raise EstimatorError(f"no estimator with id {estimator_id}")
    config = json.loads(est_row["config_json"])

    posteriors = {}
    for row in conn.execute(
        "SELECT category, model, effort, posterior_json FROM estimator_params WHERE estimator_id = ?",
        (estimator_id,),
    ):
        posteriors[(row["category"], row["model"], row["effort"])] = model.NIG.from_json(row["posterior_json"])

    return estimator_id, config, posteriors


def _recomputed_complexity(complexity: dict) -> dict:
    """Build the lowercase feature row (``model.features`` reads
    ``row["composite"]``/``row["c3"]``/... ) from an annotation-format
    ``{"C1": .., ...}`` dict, always recomputing ``composite`` from C1..C6
    (spec.md "Supplied composites are not trusted") regardless of whatever
    ``complexity.get("composite")`` says."""
    row = {f"c{i}": float(complexity.get(f"C{i}", 0)) for i in range(1, 8)}
    row["composite"] = round(sum(row[f"c{i}"] for i in range(1, 7)) / 6.0, 1)
    return row


def _resolve_category_nig(posteriors: dict, category: str, arm):
    """The category's own (arm-specific) posterior if present, else its
    pooled fallback (``model.POOLED_SENTINEL_ARM``), else ``None``. Returns
    ``(nig, used_fallback)``."""
    nig = posteriors.get((category, arm[0], arm[1]))
    if nig is not None:
        return nig, False
    nig = posteriors.get((category,) + model.POOLED_SENTINEL_ARM)
    return nig, nig is not None


def _score_arm(posteriors: dict, categories, epsilon: float, x, arm, rng: np.random.Generator, mc_draws: int):
    """Score one (model, effort) ``arm`` across every category (in the
    given, fixed ``categories`` order -- see the module docstring's rng
    consumption-order guarantee). Returns ``(public, mc_total_draws)``:
    ``public`` is the fully JSON-serializable per-arm report dict;
    ``mc_total_draws`` is the raw ``np.ndarray`` of ``mc_draws`` MC total-
    cost draws (``None`` if the arm is unscorable), kept *out* of ``public``
    so callers never need to strip anything before ``json.dumps``."""
    per_category = {}
    missing = []
    fallback = []
    category_draws = []
    for category in categories:
        nig, used_fallback = _resolve_category_nig(posteriors, category, arm)
        if nig is None:
            missing.append(category)
            continue
        if used_fallback:
            fallback.append(category)

        mean_log, _scale, _df = nig.predictive(x)
        per_category[category] = {
            "mean_usd": model.inverse_transform(mean_log, epsilon),
            "median_usd": model.inverse_transform(nig.quantile(x, 0.5), epsilon),
            "p20_usd": model.inverse_transform(nig.quantile(x, 0.2), epsilon),
            "p80_usd": model.inverse_transform(nig.quantile(x, 0.8), epsilon),
            "fallback": used_fallback,
        }
        log_draws = nig.predictive_draws(x, mc_draws, rng)
        category_draws.append(model.inverse_transform_array(log_draws, epsilon))

    public = {
        "model": arm[0], "effort": arm[1],
        "categories": per_category,
        "missing_categories": missing,
        "fallback_categories": fallback,
        "thompson_total_usd": None,
    }

    if missing or not category_draws:
        public["p20_total_usd"] = None
        public["p50_total_usd"] = None
        public["p80_total_usd"] = None
        return public, None

    total_draws = np.sum(np.vstack(category_draws), axis=0)
    public["p20_total_usd"] = _empirical_quantile(total_draws, 0.2)
    public["p50_total_usd"] = _empirical_quantile(total_draws, 0.5)
    public["p80_total_usd"] = _empirical_quantile(total_draws, 0.8)
    return public, total_draws


def _thompson_total(posteriors: dict, categories, epsilon: float, x, arm, rng: np.random.Generator) -> float:
    """One Thompson draw per category (fixed ``categories`` order, same
    fallback resolution as ``_score_arm``), inverse-transformed and floored
    at 0.0, summed to a single total. Caller guarantees ``arm`` is scorable
    (every category resolves to a posterior, own or pooled)."""
    total = 0.0
    for category in categories:
        nig, _used_fallback = _resolve_category_nig(posteriors, category, arm)
        sample_usd = model.inverse_transform(nig.thompson(x, rng), epsilon)
        total += max(sample_usd, 0.0)
    return total


def _score_task_core(config: dict, posteriors: dict, complexity: dict, rng: np.random.Generator,
                      mc_draws: int, resolved_guard_factor: float, thompson: bool):
    """Score every known arm (``config["arms"]``) for one task's complexity
    vector. Returns ``(result, selected_mc_draws, selected_thompson_total)``:
    ``result`` is the JSON-serializable per-task report dict; the other two
    are the *selected* arm's raw MC-draws array / Thompson total (whichever
    applies, else ``None``) -- used by ``run()`` to build decomposition-level
    totals without recomputing anything. Arms are processed sorted by
    ``(model, effort)`` (module docstring's rng consumption-order
    guarantee), independent of ``config["arms"]``'s own order."""
    row = _recomputed_complexity(complexity)
    x = model.features(row, config)
    epsilon = config.get("epsilon", model.DEFAULT_EPSILON)
    categories = config.get("categories", [])
    arms_sorted = sorted((tuple(a) for a in config.get("arms", [])), key=lambda a: (a[0], a[1]))

    scored = [_score_arm(posteriors, categories, epsilon, x, arm, rng, mc_draws) for arm in arms_sorted]

    if thompson:
        for pub, _draws in scored:
            if pub["missing_categories"]:
                continue
            pub["thompson_total_usd"] = _thompson_total(
                posteriors, categories, epsilon, x, (pub["model"], pub["effort"]), rng
            )

    public_arms = [pub for pub, _draws in scored]
    draws_by_key = {(pub["model"], pub["effort"]): draws for pub, draws in scored if draws is not None}

    scorable = [a for a in public_arms if not a["missing_categories"]]
    unscorable = [
        {"model": a["model"], "effort": a["effort"], "missing_categories": a["missing_categories"]}
        for a in public_arms if a["missing_categories"]
    ]

    ranked = sorted(scorable, key=lambda a: (a["p20_total_usd"], a["model"], a["effort"]))

    selected = None
    if scorable:
        min_p80 = min(a["p80_total_usd"] for a in scorable)
        guard_limit = resolved_guard_factor * min_p80
        passing = [a for a in scorable if a["p80_total_usd"] <= guard_limit]
        candidates = passing if passing else scorable
        if thompson:
            selected = min(candidates, key=lambda a: (a["thompson_total_usd"], a["model"], a["effort"]))
        else:
            selected = min(candidates, key=lambda a: (a["p20_total_usd"], a["model"], a["effort"]))

    selected_draws = draws_by_key.get((selected["model"], selected["effort"])) if selected else None
    selected_thompson = selected["thompson_total_usd"] if (selected and thompson) else None

    result = {
        "complexity": {**{f"C{i}": complexity.get(f"C{i}") for i in range(1, 8)}, "composite": row["composite"]},
        "arms": ranked,
        "unscorable_arms": unscorable,
        "selected": ({
            "model": selected["model"], "effort": selected["effort"],
            "p20_total_usd": selected["p20_total_usd"],
            "p50_total_usd": selected["p50_total_usd"],
            "p80_total_usd": selected["p80_total_usd"],
            "thompson_total_usd": selected["thompson_total_usd"],
            "fallback_categories": selected["fallback_categories"],
        } if selected else None),
    }
    return result, selected_draws, selected_thompson


def score_task(config: dict, posteriors: dict, complexity: dict, rng: np.random.Generator,
               mc_draws: int = DEFAULT_MC_DRAWS, guard_factor: Optional[float] = None,
               thompson: bool = False) -> dict:
    """Public single-task scoring entry point (what ``run()`` calls per
    task, minus the raw draws it uses only for decomposition-level
    aggregation). ``rng`` must be a caller-owned ``numpy.random.Generator``
    (e.g. ``np.random.default_rng(seed)``) -- callers scoring more than one
    task and wanting the module's full run-level determinism guarantee
    should share one ``rng`` across every call, in the same order every
    time (``run()`` does this automatically for a whole decomposition)."""
    resolved_guard_factor = resolve_guard_factor(config, guard_factor)
    result, _draws, _thompson = _score_task_core(
        config, posteriors, complexity, rng, mc_draws, resolved_guard_factor, thompson
    )
    return result


def run(conn, decomposition: dict, estimator_id: Optional[int] = None, guard_factor: Optional[float] = None,
        seed: int = DEFAULT_SEED, mc_draws: int = DEFAULT_MC_DRAWS, thompson: bool = False) -> dict:
    """Score every task in ``decomposition["tasks"]``; returns the full
    report dict (JSON-serializable) with per-task results and
    decomposition-level totals. One ``numpy.random.Generator`` (seeded via
    ``seed``) is created here and shared across every task, in decomposition
    order -- the module docstring's determinism guarantee. ``guard_factor``,
    if given, overrides both the estimator config's own value and
    ``DEFAULT_GUARD_FACTOR`` (see ``resolve_guard_factor``); the value
    actually used is echoed back as ``report["guard_factor"]``.
    ``decomposition_totals`` sums the *selected* arm's raw draws (MC mode)
    or Thompson totals (Thompson mode) element-wise across tasks before
    taking quantiles -- not a sum of each task's already-computed total
    quantiles, for the same quantiles-don't-commute-with-sums reason the
    per-task totals themselves are MC rather than summed per-category
    quantiles."""
    resolved_id, config, posteriors = load_estimator(conn, estimator_id)
    resolved_guard_factor = resolve_guard_factor(config, guard_factor)
    rng = np.random.default_rng(seed)

    tasks_out = []
    draws_sum = None
    thompson_sum = 0.0
    any_selected = False

    for entry in decomposition.get("tasks", []):
        result, selected_draws, selected_thompson = _score_task_core(
            config, posteriors, entry.get("complexity", {}), rng, mc_draws, resolved_guard_factor, thompson
        )
        result["task"] = entry.get("task")
        result["title"] = entry.get("title")
        tasks_out.append(result)
        if result["selected"] is not None:
            any_selected = True
            if selected_draws is not None:
                draws_sum = selected_draws.copy() if draws_sum is None else draws_sum + selected_draws
            if selected_thompson is not None:
                thompson_sum += selected_thompson

    decomposition_totals = {
        "p20_total_usd": _empirical_quantile(draws_sum, 0.2) if draws_sum is not None else 0.0,
        "p50_total_usd": _empirical_quantile(draws_sum, 0.5) if draws_sum is not None else 0.0,
        "p80_total_usd": _empirical_quantile(draws_sum, 0.8) if draws_sum is not None else 0.0,
        "thompson_total_usd": (thompson_sum if any_selected else 0.0) if thompson else None,
    }

    return {
        "estimator_id": resolved_id,
        "seed": seed,
        "mc_draws": mc_draws,
        "guard_factor": resolved_guard_factor,
        "selection_mode": "thompson" if thompson else "p20",
        "tasks": tasks_out,
        "decomposition_totals": decomposition_totals,
    }


def _sanity_decomposition() -> dict:
    """Synthetic 3-task decomposition at fixed reference composites {2, 3,
    4} (spec.md "Sanity report against known findings"). Every C1..C7 is set
    equal to the target composite so ``mean(C1..C6) == composite`` exactly
    and the default feature set (``[1, composite, c3, c4, c5]``) sees a
    consistent complexity level across every feature."""
    return {
        "format": 1, "change": "sanity", "tasks": [
            {"task": f"sanity-c{c:g}", "title": f"reference composite {c}",
             "complexity": {f"C{i}": c for i in range(1, 8)}}
            for c in SANITY_COMPOSITES
        ],
    }


def _fmt(value) -> str:
    return f"{value:>14.4f}" if value is not None else f"{'-':>14}"


def render_table(report: dict) -> str:
    lines = [
        f"estimator_id={report['estimator_id']} seed={report['seed']} "
        f"mc_draws={report['mc_draws']} selection_mode={report['selection_mode']}"
    ]
    for task in report["tasks"]:
        lines.append("")
        lines.append(f"task: {task['task']}  composite={task['complexity']['composite']}")
        lines.append(f"  {'model':<20} {'effort':<10} {'p20$':>14} {'p50$':>14} {'p80$':>14} {'thompson$':>14}")
        for arm in task["arms"]:
            marker = "*" if task["selected"] and arm["model"] == task["selected"]["model"] and arm["effort"] == task["selected"]["effort"] else " "
            fallback_note = f"  (pooled: {', '.join(arm['fallback_categories'])})" if arm["fallback_categories"] else ""
            lines.append(
                f"{marker} {arm['model']:<20} {arm['effort']:<10}"
                f" {_fmt(arm['p20_total_usd'])} {_fmt(arm['p50_total_usd'])}"
                f" {_fmt(arm['p80_total_usd'])} {_fmt(arm['thompson_total_usd'])}"
                f"{fallback_note}"
            )
        if task["unscorable_arms"]:
            for arm in task["unscorable_arms"]:
                lines.append(f"  (unscorable: {arm['model']}/{arm['effort']}, missing={arm['missing_categories']})")
        sel = task["selected"]
        sel_desc = (
            f"{sel['model']}/{sel['effort']}  p20=${sel['p20_total_usd']:.4f} "
            f"p50=${sel['p50_total_usd']:.4f} p80=${sel['p80_total_usd']:.4f}"
            if sel else "none"
        )
        lines.append(f"  selected: {sel_desc}")
    totals = report["decomposition_totals"]
    lines.append("")
    lines.append(
        f"decomposition totals: p20=${totals['p20_total_usd']:.4f} p50=${totals['p50_total_usd']:.4f} "
        f"p80=${totals['p80_total_usd']:.4f} (guard_factor={report['guard_factor']})"
    )
    return "\n".join(lines)


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Score a candidate decomposition against a trained cost estimator.")
    p.add_argument("--decomposition", help="path to a decomposition file (.json or annotation-subset .yaml)")
    p.add_argument("--db", default=str(DEFAULT_DB), help="path to the task-analyzer sqlite database")
    p.add_argument("--estimator-id", type=int, default=None)
    p.add_argument("--guard-factor", type=float, default=None,
                    help="override the selection guard factor (default: the estimator config's own value, or 2.0)")
    p.add_argument("--seed", type=int, default=DEFAULT_SEED, help="seed for the shared Monte Carlo/Thompson rng")
    p.add_argument("--mc-draws", type=int, default=DEFAULT_MC_DRAWS,
                    help="number of Monte Carlo draws per (arm, category) used for total-cost quantiles")
    p.add_argument("--thompson", action="store_true",
                    help="select via one Thompson draw per arm instead of minimum MC p20 total")
    p.add_argument("--json", action="store_true", help="emit machine-readable JSON instead of the human table")
    p.add_argument("--sanity", action="store_true", help="score the fixed reference decomposition (composites 2/3/4) instead of --decomposition")
    return p


def main(argv=None) -> int:
    args = _build_arg_parser().parse_args(argv)
    if not args.sanity and not args.decomposition:
        print("error: --decomposition is required unless --sanity is given", file=sys.stderr)
        return 2

    decomposition = _sanity_decomposition() if args.sanity else annotations.load(args.decomposition)

    # Read-only: estimate.py only ever queries `estimators`/`estimator_params`
    # -- it must never apply schema.sql or enable WAL against what is
    # typically the shared main-branch database (design.md: this CLI never
    # writes to or trains the database it reads from).
    try:
        conn = db.connect_readonly(args.db)
    except sqlite3.Error as exc:
        print(f"error: cannot open database at {args.db!r}: {exc}", file=sys.stderr)
        return 1

    try:
        report = run(
            conn, decomposition, estimator_id=args.estimator_id, guard_factor=args.guard_factor,
            seed=args.seed, mc_draws=args.mc_draws, thompson=args.thompson,
        )
    except EstimatorError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()

    if args.json:
        print(json.dumps(report, sort_keys=True))
    else:
        print(render_table(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
