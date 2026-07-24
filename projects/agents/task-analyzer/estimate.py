"""Decomposition estimator CLI (design.md D6/D7;
specs/task-analyzer-cost-model/spec.md "Decomposition estimator CLI").

Reads a candidate decomposition (annotation-format doc with per-task
complexity vectors -- see ``annotations.py``), queries a trained estimator's
posteriors (``estimators``/``estimator_params``, written by ``train.py``),
and for every task ranks every known (model, effort) arm by predicted cost,
picks a selected arm, and flags tasks where the leading arms' posteriors
overlap too much to be confident in that pick ("explore").

Total task cost per arm is the sum over every category in the estimator's
``config_json["categories"]`` (per spec.md, this is "implementation phases +
unlabeled + review + followup_fix" -- whatever categories the estimator was
actually trained on) of that category's per-arm posterior predictive,
inverse-transformed back to USD (``model.inverse_transform``, i.e. ``usd =
exp(y) - epsilon`` per the estimator's own ``output_format``).

An arm missing a posterior for some category falls back to that category's
*pooled* posterior instead -- the sentinel ``estimator_params`` row
``train.py`` persists per category (``model.POOLED_SENTINEL_ARM``), fit
across every arm's rows in that category. This is honest and wide rather
than silently contributing 0 USD for what's missing (an earlier version of
this module did that, which undercounted totals and biased selection toward
the least-covered arms -- fixed after review round 1) and rather than
excluding the arm entirely (a later version did that -- a "full-coverage"
rule -- but an excluded arm can never be selected, so it accrues no new
data and is frozen out permanently; replaced by this pooled fallback per
followup-1). Categories scored via fallback are listed per arm under
``fallback_categories`` in the report, and (per spec.md "Sparse arm yields
wide posterior") their contribution to the total is wider than a
well-sampled cell's, which the existing ``explore`` overlap check already
treats as low-evidence. An arm is **unscorable** only if *even the pooled
posterior* has no row for some category it needs; such arms are excluded
from ranking/selection entirely and reported separately (per task) under
``unscorable_arms`` with their ``missing_categories`` listed.

Selection ("expected total minimizing subject to the p_q guard", the spec's
literal but underspecified phrase): for every task, compute two per-arm
totals -- ``expected_total`` (sum of per-category posterior *means*) and
``pq_total`` (sum of per-category posterior quantiles at ``--quantile``,
default p80). The guard excludes any arm whose ``pq_total`` exceeds a
*guard factor* times the *minimum* ``pq_total`` across all fully-scorable
candidate arms for that task; this stops "cheap on average, catastrophic in
the tail" arms from winning on mean alone. The selected arm is then
whichever guard-passing arm has the lowest ``expected_total``. The guard
factor itself (default ``DEFAULT_GUARD_FACTOR = 2.0``) is resolved per run
as: ``--guard-factor`` CLI flag, else ``config_json["guard_factor"]`` if the
estimator's own config specifies one, else the hardcoded default -- and is
echoed back in the JSON report as ``"guard_factor"`` so a reader always
knows which value produced a given selection. This mechanism (both its
existence and its exact resolution precedence) is a documented design
choice (see task-10-report.md), not something the spec spells out
numerically.

``explore`` (also spec-literal: "runner-up p20 < winner p80", a posterior-
overlap proxy) compares the *selected* arm's ``p80_total`` against the best
non-selected arm's ``p20_total`` (ranked by ``expected_total``, regardless of
guard status) -- if the runner-up's downside could plausibly beat the
winner's upside, we're not confident enough to skip exploring.

No randomness is used anywhere in this module (no Thompson sampling) --
every number is a closed-form function of the persisted posterior and the
input complexity vector, so determinism for a fixed ``--estimator-id`` is
automatic, not something this module has to work to preserve.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Optional

import annotations
import db
import model

DEFAULT_DB = Path(__file__).resolve().parents[3] / "data" / "agents" / "task-analyzer.sqlite"
DEFAULT_QUANTILE = 0.8
EXPLORE_LOW_Q = 0.2
DEFAULT_GUARD_FACTOR = 2.0
SANITY_COMPOSITES = (2.0, 3.0, 4.0)


def resolve_guard_factor(config: dict, guard_factor: Optional[float]) -> float:
    """Resolve the effective guard factor: explicit ``--guard-factor`` CLI
    value wins, then the estimator's own ``config_json["guard_factor"]``,
    then ``DEFAULT_GUARD_FACTOR``."""
    if guard_factor is not None:
        return guard_factor
    return float(config.get("guard_factor", DEFAULT_GUARD_FACTOR))


class EstimatorError(RuntimeError):
    pass


def load_estimator(conn, estimator_id: Optional[int] = None):
    """Return ``(estimator_id, config, posteriors)`` where ``posteriors``
    maps ``(category, model, effort) -> model.NIG``. Defaults to the
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


def _arm_totals(posteriors: dict, categories, epsilon: float, x, arm, quantile: float) -> dict:
    per_category = {}
    missing = []
    fallback = []
    expected_total = pq_total = p20_total = p80_total = 0.0
    for category in categories:
        nig = posteriors.get((category, arm[0], arm[1]))
        used_fallback = False
        if nig is None:
            nig = posteriors.get((category,) + model.POOLED_SENTINEL_ARM)
            used_fallback = nig is not None
        if nig is None:
            missing.append(category)
            continue
        if used_fallback:
            fallback.append(category)
        mean_log, _scale, _df = nig.predictive(x)
        mean_usd = model.inverse_transform(mean_log, epsilon)
        pq_usd = model.inverse_transform(nig.quantile(x, quantile), epsilon)
        p20_usd = model.inverse_transform(nig.quantile(x, EXPLORE_LOW_Q), epsilon)
        p80_usd = model.inverse_transform(nig.quantile(x, 1.0 - EXPLORE_LOW_Q), epsilon)
        per_category[category] = {
            "mean_usd": mean_usd, "pq_usd": pq_usd, "p20_usd": p20_usd, "p80_usd": p80_usd,
            "fallback": used_fallback,
        }
        expected_total += mean_usd
        pq_total += pq_usd
        p20_total += p20_usd
        p80_total += p80_usd
    return {
        "model": arm[0], "effort": arm[1],
        "categories": per_category, "missing_categories": missing,
        "fallback_categories": fallback,
        "expected_total_usd": expected_total, "pq_total_usd": pq_total,
        "p20_total_usd": p20_total, "p80_total_usd": p80_total,
    }


def score_task(config: dict, posteriors: dict, complexity: dict, quantile: float,
               guard_factor: Optional[float] = None) -> dict:
    """Score every known arm (``config["arms"]``) for one task's complexity
    vector. Returns the ranked, fully-scorable arm list (sorted by
    ``pq_total_usd`` ascending -- "arm rankings at the configured quantile"
    per spec.md), the arms excluded as ``unscorable`` (missing a posterior,
    *and* a pooled fallback, for at least one category), the selected arm
    (min ``expected_total_usd`` among fully-scorable arms passing the
    ``pq_total_usd`` guard), and the ``explore`` flag. An arm is eligible
    for ranking/selection once every category in ``config["categories"]``
    resolves to a posterior -- its own, or (per the module docstring) that
    category's pooled fallback; each arm's ``fallback_categories`` records
    which categories, if any, resolved via fallback."""
    row = _recomputed_complexity(complexity)
    x = model.features(row, config)
    epsilon = config.get("epsilon", model.DEFAULT_EPSILON)
    categories = config.get("categories", [])
    resolved_guard_factor = resolve_guard_factor(config, guard_factor)
    arms_all = [_arm_totals(posteriors, categories, epsilon, x, tuple(arm), quantile) for arm in config.get("arms", [])]

    arms = [a for a in arms_all if not a["missing_categories"]]
    unscorable = [
        {"model": a["model"], "effort": a["effort"], "missing_categories": a["missing_categories"]}
        for a in arms_all if a["missing_categories"]
    ]

    ranked = sorted(arms, key=lambda a: (a["pq_total_usd"], a["model"], a["effort"]))
    by_expected = sorted(arms, key=lambda a: (a["expected_total_usd"], a["model"], a["effort"]))

    selected = None
    if by_expected:
        min_pq = min(a["pq_total_usd"] for a in arms)
        guard_limit = resolved_guard_factor * min_pq
        passing = [a for a in by_expected if a["pq_total_usd"] <= guard_limit]
        selected = passing[0] if passing else by_expected[0]

    explore = False
    if selected is not None:
        runner_up = next((a for a in by_expected if a is not selected), None)
        if runner_up is not None:
            explore = runner_up["p20_total_usd"] < selected["p80_total_usd"]

    return {
        "complexity": {**{f"C{i}": complexity.get(f"C{i}") for i in range(1, 8)}, "composite": row["composite"]},
        "arms": ranked,
        "unscorable_arms": unscorable,
        "selected": ({"model": selected["model"], "effort": selected["effort"],
                       "expected_total_usd": selected["expected_total_usd"],
                       "pq_total_usd": selected["pq_total_usd"],
                       "fallback_categories": selected["fallback_categories"]} if selected else None),
        "explore": explore,
    }


def run(conn, decomposition: dict, quantile: float = DEFAULT_QUANTILE, estimator_id: Optional[int] = None,
        guard_factor: Optional[float] = None) -> dict:
    """Score every task in ``decomposition["tasks"]``; returns the full
    report dict (JSON-serializable) with per-task results and
    decomposition-level totals of the selected arms. ``guard_factor``, if
    given, overrides both the estimator config's own value and
    ``DEFAULT_GUARD_FACTOR`` (see ``resolve_guard_factor``); the value
    actually used is echoed back as ``report["guard_factor"]``."""
    resolved_id, config, posteriors = load_estimator(conn, estimator_id)
    resolved_guard_factor = resolve_guard_factor(config, guard_factor)

    tasks_out = []
    total_expected = total_pq = 0.0
    for entry in decomposition.get("tasks", []):
        result = score_task(config, posteriors, entry.get("complexity", {}), quantile, resolved_guard_factor)
        result["task"] = entry.get("task")
        result["title"] = entry.get("title")
        tasks_out.append(result)
        if result["selected"]:
            total_expected += result["selected"]["expected_total_usd"]
            total_pq += result["selected"]["pq_total_usd"]

    return {
        "estimator_id": resolved_id,
        "quantile": quantile,
        "guard_factor": resolved_guard_factor,
        "tasks": tasks_out,
        "decomposition_totals": {"expected_total_usd": total_expected, "pq_total_usd": total_pq},
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


def render_table(report: dict) -> str:
    lines = [f"estimator_id={report['estimator_id']} quantile={report['quantile']}"]
    for task in report["tasks"]:
        lines.append("")
        lines.append(f"task: {task['task']}  composite={task['complexity']['composite']}")
        lines.append(f"  {'model':<20} {'effort':<10} {'expected$':>18} {'pq$':>18} {'p20$':>18} {'p80$':>18}")
        for arm in task["arms"]:
            marker = "*" if task["selected"] and arm["model"] == task["selected"]["model"] and arm["effort"] == task["selected"]["effort"] else " "
            fallback_note = f"  (pooled: {', '.join(arm['fallback_categories'])})" if arm["fallback_categories"] else ""
            lines.append(
                f"{marker} {arm['model']:<20} {arm['effort']:<10}"
                f" {arm['expected_total_usd']:>18.4f} {arm['pq_total_usd']:>18.4f}"
                f" {arm['p20_total_usd']:>18.4f} {arm['p80_total_usd']:>18.4f}"
                f"{fallback_note}"
            )
        if task["unscorable_arms"]:
            for arm in task["unscorable_arms"]:
                lines.append(f"  (unscorable: {arm['model']}/{arm['effort']}, missing={arm['missing_categories']})")
        sel = task["selected"]
        sel_desc = f"{sel['model']}/{sel['effort']}" if sel else "none"
        lines.append(f"  selected: {sel_desc}  explore={task['explore']}")
    totals = report["decomposition_totals"]
    lines.append("")
    lines.append(
        f"decomposition totals: expected=${totals['expected_total_usd']:.4f} "
        f"pq=${totals['pq_total_usd']:.4f} (guard_factor={report['guard_factor']})"
    )
    return "\n".join(lines)


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Score a candidate decomposition against a trained cost estimator.")
    p.add_argument("--decomposition", help="path to a decomposition file (.json or annotation-subset .yaml)")
    p.add_argument("--db", default=str(DEFAULT_DB), help="path to the task-analyzer sqlite database")
    p.add_argument("--quantile", type=float, default=DEFAULT_QUANTILE)
    p.add_argument("--estimator-id", type=int, default=None)
    p.add_argument("--guard-factor", type=float, default=None,
                    help="override the selection guard factor (default: the estimator config's own value, or 2.0)")
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
        report = run(conn, decomposition, quantile=args.quantile, estimator_id=args.estimator_id,
                      guard_factor=args.guard_factor)
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
