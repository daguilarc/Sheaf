"""Train the per-(category, arm) NIG Bayesian cost estimator (design.md D6).

Reads ``task_costs`` joined with the *current* ``complexity`` row (the
numerically greatest ``rubric_version`` present) and ``task_arms`` (the
task's canonical implementer arm -- used for every category, including
``review``/``followup_fix``, per design.md D5). For each category, fits a
"pooled" NIG posterior across all arms' rows (starting from a weak shared
prior), then treats that pooled posterior as the prior for each arm and
updates it again on just that arm's rows -- partial pooling, so sparse arms
inherit the pooled behavior and get a wide posterior rather than
overfitting to a handful of points (spec.md "Sparse arm yields wide
posterior"). Writes one new ``estimators`` row (config_json + metrics_json)
and one ``estimator_params`` row per (category, arm) with data; prior
``estimators`` rows are never touched (design.md D9 -- old estimators are
kept for audit/rollback).

CLI: ``python3 train.py --db PATH [--config JSON]`` where ``--config`` is a
path to a JSON file of overrides deep-merged onto ``model.default_config()``
(e.g. to change ``epsilon``, the feature list, or prior hyperparameters).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np

import db
import model

CODE_VERSION = "task-analyzer-model-v1"
_LOO_MIN_ROWS = 8


def _numeric_max(values):
    """The numerically greatest of a set of version strings (falls back to
    lexicographic max if any value doesn't parse as a number)."""
    try:
        return max(values, key=lambda v: float(v))
    except (TypeError, ValueError):
        return max(values)


def _deep_update(base: dict, overrides: dict) -> dict:
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_update(base[key], value)
        else:
            base[key] = value
    return base


def _fetch_training_rows(conn, rubric_version, price_version):
    sql = """
        SELECT tc.task_id AS task_id, tc.category AS category, tc.usd AS usd,
               c.composite AS composite, c.c3 AS c3, c.c4 AS c4, c.c5 AS c5,
               ta.model AS model, ta.effort AS effort
        FROM task_costs tc
        JOIN complexity c ON c.task_id = tc.task_id AND c.rubric_version = ?
        JOIN task_arms ta ON ta.task_id = tc.task_id
        WHERE tc.price_version = ?
    """
    return conn.execute(sql, (rubric_version, price_version)).fetchall()


def run(conn, config_overrides: Optional[dict] = None) -> Optional[int]:
    """Train and persist a new estimator generation; returns the new
    ``estimator_id``, or ``None`` (writes nothing) if there is no
    complexity/cost data to train on yet."""
    rubric_versions = [
        r[0] for r in conn.execute("SELECT DISTINCT rubric_version FROM complexity").fetchall()
    ]
    if not rubric_versions:
        return None
    rubric_version = _numeric_max(rubric_versions)

    price_versions = [
        r[0]
        for r in conn.execute(
            "SELECT DISTINCT price_version FROM task_costs WHERE price_version IS NOT NULL"
        ).fetchall()
    ]
    if not price_versions:
        return None
    price_version = max(price_versions)

    taxonomy_versions = [
        r[0] for r in conn.execute("SELECT DISTINCT taxonomy_version FROM phase_tokens").fetchall()
    ]
    taxonomy_version = _numeric_max(taxonomy_versions) if taxonomy_versions else None

    rows = _fetch_training_rows(conn, rubric_version, price_version)

    config = model.default_config()
    if config_overrides:
        _deep_update(config, config_overrides)
    config["training_filters"] = {
        "rubric_version": rubric_version,
        "taxonomy_version": taxonomy_version,
        "price_version": price_version,
        "min_rows_per_arm": config["training_filters"].get("min_rows_per_arm", 1),
    }
    min_rows = config["training_filters"]["min_rows_per_arm"]
    epsilon = config["epsilon"]
    prior_cfg = config["prior"]
    weak_prior = model.NIG(
        mu=np.array(prior_cfg["mu0"], dtype=float),
        Lambda=np.array(prior_cfg["Lambda0"], dtype=float),
        a=float(prior_cfg["a0"]),
        b=float(prior_cfg["b0"]),
    )

    by_category: dict = {}
    for row in rows:
        by_category.setdefault(row["category"], []).append(row)

    posteriors: dict = {}       # (category, model, effort) -> NIG
    arm_row_counts: dict = {}   # "category|model|effort" -> n
    arm_data: dict = {}         # (category, model, effort) -> (X, y)
    pooled_by_category: dict = {}
    task_ids_all = set()

    for category, cat_rows in by_category.items():
        by_arm: dict = {}
        pooled_X = []
        pooled_y = []
        for row in cat_rows:
            x = model.features(row, config)
            y = model.transform_target(row["usd"], epsilon)
            pooled_X.append(x)
            pooled_y.append(y)
            task_ids_all.add(row["task_id"])
            key = (category, row["model"], row["effort"])
            arm = by_arm.setdefault(key, {"X": [], "y": []})
            arm["X"].append(x)
            arm["y"].append(y)

        pooled_posterior = weak_prior.update(np.array(pooled_X), np.array(pooled_y))
        pooled_by_category[category] = pooled_posterior

        for key, arm in by_arm.items():
            n = len(arm["y"])
            if n < min_rows:
                continue
            arm_X = np.array(arm["X"])
            arm_y = np.array(arm["y"])
            posteriors[key] = pooled_posterior.update(arm_X, arm_y)
            arm_row_counts["|".join(str(part) for part in key)] = n
            arm_data[key] = (arm_X, arm_y)

    metrics = {"categories": {}, "arm_row_counts": arm_row_counts}
    for category, pooled_posterior in pooled_by_category.items():
        below_p50 = below_p80 = total = 0
        for (cat, _mdl, _eff), (arm_X, arm_y) in arm_data.items():
            if cat != category:
                continue
            n = arm_X.shape[0]
            if n < _LOO_MIN_ROWS:
                continue
            for i in range(n):
                mask = np.ones(n, dtype=bool)
                mask[i] = False
                loo_posterior = pooled_posterior.update(arm_X[mask], arm_y[mask])
                p50 = loo_posterior.quantile(arm_X[i], 0.5)
                p80 = loo_posterior.quantile(arm_X[i], 0.8)
                actual = arm_y[i]
                if actual <= p50:
                    below_p50 += 1
                if actual <= p80:
                    below_p80 += 1
                total += 1
        if total:
            metrics["categories"][category] = {
                "p50_coverage": below_p50 / total,
                "p80_coverage": below_p80 / total,
                "loo_n": total,
            }

    config["categories"] = sorted(by_category.keys())
    config["arms"] = sorted({(mdl, eff) for (_cat, mdl, eff) in posteriors.keys()})

    trained_at = datetime.now(timezone.utc).isoformat()
    config_json = json.dumps(config, sort_keys=True)
    metrics_json = json.dumps(metrics, sort_keys=True)

    cur = conn.execute(
        "INSERT INTO estimators (trained_at, code_version, train_task_count, config_json, metrics_json) "
        "VALUES (?, ?, ?, ?, ?)",
        (trained_at, CODE_VERSION, len(task_ids_all), config_json, metrics_json),
    )
    estimator_id = cur.lastrowid

    for (category, mdl, eff), posterior in posteriors.items():
        db.upsert(
            conn,
            "estimator_params",
            {
                "estimator_id": estimator_id,
                "category": category,
                "model": mdl,
                "effort": eff,
                "posterior_json": posterior.to_json(),
            },
            ["estimator_id", "category", "model", "effort"],
        )

    conn.commit()
    return estimator_id


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Train the task-analyzer Bayesian cost estimator.")
    p.add_argument("--db", required=True)
    p.add_argument("--config", default=None, help="path to a JSON file of hyperparameter overrides")
    return p


def main(argv=None) -> int:
    args = _build_arg_parser().parse_args(argv)
    overrides = json.loads(Path(args.config).read_text()) if args.config else None

    conn = db.connect(args.db)
    try:
        estimator_id = run(conn, overrides)
    finally:
        conn.close()

    if estimator_id is None:
        print("no training data found; nothing written", file=sys.stderr)
        return 1
    print(json.dumps({"estimator_id": estimator_id}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
