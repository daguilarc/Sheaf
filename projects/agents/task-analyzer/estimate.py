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
exp(y) - epsilon`` per the estimator's own ``output_format``). An arm
missing posterior data for some category simply contributes 0 USD from that
category and is listed under ``missing_categories`` in the output -- real
training data is uneven across arms, and refusing to estimate at all would
make the tool useless for exactly the sparse arms it most needs to flag.

Selection ("expected total minimizing subject to the p_q guard", the spec's
literal but underspecified phrase): for every task, compute two per-arm
totals -- ``expected_total`` (sum of per-category posterior *means*) and
``pq_total`` (sum of per-category posterior quantiles at ``--quantile``,
default p80). The guard excludes any arm whose ``pq_total`` exceeds
``GUARD_FACTOR`` (2x, a documented, hardcoded constant -- no CLI flag for it
since the brief doesn't specify one) times the *minimum* ``pq_total`` across
all candidate arms for that task; this stops "cheap on average, catastrophic
in the tail" arms from winning on mean alone. The selected arm is then
whichever guard-passing arm has the lowest ``expected_total``. This is a
documented design choice (see task-10-report.md), not something the spec
spells out numerically.

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
import sys
from pathlib import Path
from typing import Optional

import annotations
import db
import model

DEFAULT_DB = Path(__file__).resolve().parents[3] / "data" / "agents" / "task-analyzer.sqlite"
DEFAULT_QUANTILE = 0.8
EXPLORE_LOW_Q = 0.2
GUARD_FACTOR = 2.0
SANITY_COMPOSITES = (2.0, 3.0, 4.0)


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
    expected_total = pq_total = p20_total = p80_total = 0.0
    for category in categories:
        nig = posteriors.get((category, arm[0], arm[1]))
        if nig is None:
            missing.append(category)
            continue
        mean_log, _scale, _df = nig.predictive(x)
        mean_usd = model.inverse_transform(mean_log, epsilon)
        pq_usd = model.inverse_transform(nig.quantile(x, quantile), epsilon)
        p20_usd = model.inverse_transform(nig.quantile(x, EXPLORE_LOW_Q), epsilon)
        p80_usd = model.inverse_transform(nig.quantile(x, 1.0 - EXPLORE_LOW_Q), epsilon)
        per_category[category] = {
            "mean_usd": mean_usd, "pq_usd": pq_usd, "p20_usd": p20_usd, "p80_usd": p80_usd,
        }
        expected_total += mean_usd
        pq_total += pq_usd
        p20_total += p20_usd
        p80_total += p80_usd
    return {
        "model": arm[0], "effort": arm[1],
        "categories": per_category, "missing_categories": missing,
        "expected_total_usd": expected_total, "pq_total_usd": pq_total,
        "p20_total_usd": p20_total, "p80_total_usd": p80_total,
    }


def score_task(config: dict, posteriors: dict, complexity: dict, quantile: float) -> dict:
    """Score every known arm (``config["arms"]``) for one task's complexity
    vector. Returns the ranked arm list (sorted by ``pq_total_usd``
    ascending -- "arm rankings at the configured quantile" per spec.md),
    the selected arm (min ``expected_total_usd`` among arms passing the
    ``pq_total_usd`` guard), and the ``explore`` flag."""
    row = _recomputed_complexity(complexity)
    x = model.features(row, config)
    epsilon = config.get("epsilon", model.DEFAULT_EPSILON)
    categories = config.get("categories", [])
    arms_all = [_arm_totals(posteriors, categories, epsilon, x, tuple(arm), quantile) for arm in config.get("arms", [])]
    # An arm with zero category coverage (no posterior for any category at
    # all) would otherwise show a $0.00 total and falsely win every
    # ranking -- exclude it rather than silently pretend it's free.
    # train.py-produced config["arms"] never actually contains such an arm
    # (every listed arm has >=1 posterior by construction), so this only
    # guards against a hand-built or corrupted config.
    arms = [a for a in arms_all if len(a["missing_categories"]) < len(categories)] if categories else arms_all

    ranked = sorted(arms, key=lambda a: (a["pq_total_usd"], a["model"], a["effort"]))
    by_expected = sorted(arms, key=lambda a: (a["expected_total_usd"], a["model"], a["effort"]))

    selected = None
    if by_expected:
        min_pq = min(a["pq_total_usd"] for a in arms)
        guard_limit = GUARD_FACTOR * min_pq
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
        "selected": ({"model": selected["model"], "effort": selected["effort"],
                       "expected_total_usd": selected["expected_total_usd"],
                       "pq_total_usd": selected["pq_total_usd"]} if selected else None),
        "explore": explore,
    }


def run(conn, decomposition: dict, quantile: float = DEFAULT_QUANTILE, estimator_id: Optional[int] = None) -> dict:
    """Score every task in ``decomposition["tasks"]``; returns the full
    report dict (JSON-serializable) with per-task results and
    decomposition-level totals of the selected arms."""
    resolved_id, config, posteriors = load_estimator(conn, estimator_id)

    tasks_out = []
    total_expected = total_pq = 0.0
    for entry in decomposition.get("tasks", []):
        result = score_task(config, posteriors, entry.get("complexity", {}), quantile)
        result["task"] = entry.get("task")
        result["title"] = entry.get("title")
        tasks_out.append(result)
        if result["selected"]:
            total_expected += result["selected"]["expected_total_usd"]
            total_pq += result["selected"]["pq_total_usd"]

    return {
        "estimator_id": resolved_id,
        "quantile": quantile,
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
            lines.append(
                f"{marker} {arm['model']:<20} {arm['effort']:<10}"
                f" {arm['expected_total_usd']:>18.4f} {arm['pq_total_usd']:>18.4f}"
                f" {arm['p20_total_usd']:>18.4f} {arm['p80_total_usd']:>18.4f}"
                + (f"  missing={arm['missing_categories']}" if arm["missing_categories"] else "")
            )
        sel = task["selected"]
        sel_desc = f"{sel['model']}/{sel['effort']}" if sel else "none"
        lines.append(f"  selected: {sel_desc}  explore={task['explore']}")
    totals = report["decomposition_totals"]
    lines.append("")
    lines.append(f"decomposition totals: expected=${totals['expected_total_usd']:.4f} pq=${totals['pq_total_usd']:.4f}")
    return "\n".join(lines)


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Score a candidate decomposition against a trained cost estimator.")
    p.add_argument("--decomposition", help="path to a decomposition file (.json or annotation-subset .yaml)")
    p.add_argument("--db", default=str(DEFAULT_DB), help="path to the task-analyzer sqlite database")
    p.add_argument("--quantile", type=float, default=DEFAULT_QUANTILE)
    p.add_argument("--estimator-id", type=int, default=None)
    p.add_argument("--json", action="store_true", help="emit machine-readable JSON instead of the human table")
    p.add_argument("--sanity", action="store_true", help="score the fixed reference decomposition (composites 2/3/4) instead of --decomposition")
    return p


def main(argv=None) -> int:
    args = _build_arg_parser().parse_args(argv)
    if not args.sanity and not args.decomposition:
        print("error: --decomposition is required unless --sanity is given", file=sys.stderr)
        return 2

    decomposition = _sanity_decomposition() if args.sanity else annotations.load(args.decomposition)

    conn = db.connect(args.db)
    try:
        report = run(conn, decomposition, quantile=args.quantile, estimator_id=args.estimator_id)
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
