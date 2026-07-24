"""Train the per-(category, arm) NIG Bayesian cost estimator (design.md D6).

Reads ``task_costs`` joined with the *current* ``complexity`` row (the
numerically greatest ``rubric_version`` present) and ``task_arms`` (the
task's canonical implementer arm -- used for every category, including
``review``/``followup_fix``, per design.md D5). Pooling scheme
(``pooled-mean-weak-prior-v1``, per design.md D6 review): for each category,
fit a pooled NIG regression across *all* arms' rows (starting from the weak
shared prior) and take only its posterior *mean* coefficient vector; each
arm's prior is then a fresh weak-precision NIG (``Lambda0``/``a0``/``b0``
unchanged from the shared weak prior) centered at that pooled mean, updated
*once* on just that arm's own rows. This avoids double-counting an arm's
rows (once via the pooled fit, again via a from-the-pooled-posterior
update) while still pulling sparse arms toward the pooled mean and giving
them a wide posterior rather than overfitting to a handful of points
(spec.md "Sparse arm yields wide posterior"). Writes one new ``estimators``
row (config_json + metrics_json) and one ``estimator_params`` row per
(category, arm) with data; prior ``estimators`` rows are never touched
(design.md D9 -- old estimators are kept for audit/rollback).

The per-category LOO calibration metric (``metrics_json``) is leak-free: the
pooled-mean prior for each held-out fold is recomputed with that row
excluded (a downdate of the category's precomputed ``XtX``/``Xty`` sums, not
a reuse of the training-time pooled mean, which would have let the held-out
row influence its own prediction).

In addition to each (category, arm) posterior, the category's own pooled fit
(the full NIG posterior over *all* arms' rows in that category, from the
weak prior -- not just its mean, which is all the per-arm priors use) is
itself persisted as one ``estimator_params`` row per category, under the
sentinel key ``model.POOLED_SENTINEL_ARM`` (``("(pooled)", "(pooled)")``).
``estimate.py`` reads this row as its fallback whenever a real (category,
model, effort) cell has no posterior -- honest and wide, since it reflects
however little (or however skewed) data the category has across all arms,
rather than making an arm permanently unscorable and therefore never
selectable (which would freeze the arm set: an excluded arm can never
accrue new data). See design.md D6 "pooled fallback".

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
    """Rows with a usable training arm only -- ``task_arms.model``/``effort``
    are NULL for tasks with no round-0 implementer session (review-only or
    quarantined tasks; expected, not corrupt) and can train no arm, so
    they're excluded at the join. See ``_count_excluded_null_arm_tasks``."""
    sql = """
        SELECT tc.task_id AS task_id, tc.category AS category, tc.usd AS usd,
               c.composite AS composite, c.c3 AS c3, c.c4 AS c4, c.c5 AS c5,
               ta.model AS model, ta.effort AS effort
        FROM task_costs tc
        JOIN complexity c ON c.task_id = tc.task_id AND c.rubric_version = ?
        JOIN task_arms ta ON ta.task_id = tc.task_id
        WHERE tc.price_version = ? AND ta.model IS NOT NULL AND ta.effort IS NOT NULL
    """
    return conn.execute(sql, (rubric_version, price_version)).fetchall()


def _count_excluded_null_arm_tasks(conn, rubric_version, price_version):
    """Count of distinct tasks that would otherwise join for training but
    have no canonical arm (``task_arms.model``/``effort`` NULL)."""
    sql = """
        SELECT COUNT(DISTINCT tc.task_id)
        FROM task_costs tc
        JOIN complexity c ON c.task_id = tc.task_id AND c.rubric_version = ?
        JOIN task_arms ta ON ta.task_id = tc.task_id
        WHERE tc.price_version = ? AND (ta.model IS NULL OR ta.effort IS NULL)
    """
    return conn.execute(sql, (rubric_version, price_version)).fetchone()[0]


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
    excluded_null_arm_tasks = _count_excluded_null_arm_tasks(conn, rubric_version, price_version)

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
    category_prior_by_category: dict = {}
    pooled_sums_by_category: dict = {}   # category -> (XtX_total, Xty_total)
    pooled_posteriors: dict = {}         # category -> NIG (persisted as the sentinel row)
    task_ids_all = set()

    for category, cat_rows in by_category.items():
        by_arm: dict = {}
        pooled_X = []
        pooled_y = []
        for row in cat_rows:
            x = model.features(row, config)
            y = model.transform_target(row["usd"], epsilon)
            idx = len(pooled_X)
            pooled_X.append(x)
            pooled_y.append(y)
            task_ids_all.add(row["task_id"])
            key = (category, row["model"], row["effort"])
            arm = by_arm.setdefault(key, {"idx": []})
            arm["idx"].append(idx)

        pooled_X_arr = np.array(pooled_X)
        pooled_y_arr = np.array(pooled_y)
        pooled_XtX_total = pooled_X_arr.T @ pooled_X_arr
        pooled_Xty_total = pooled_X_arr.T @ pooled_y_arr
        pooled_sums_by_category[category] = (pooled_XtX_total, pooled_Xty_total)

        # Pooled fit across all arms in this category contributes only its
        # posterior *mean* (pulls sparse arms toward it); prior precision
        # (Lambda0/a0/b0) stays the original weak, fixed values so an arm's
        # own rows are counted exactly once (see module docstring).
        pooled_fit = weak_prior.update(pooled_X_arr, pooled_y_arr)
        category_prior = model.NIG(mu=pooled_fit.mu, Lambda=weak_prior.Lambda, a=weak_prior.a, b=weak_prior.b)
        category_prior_by_category[category] = category_prior
        # The pooled fit's *full* posterior (not just its mean, which is all
        # `category_prior` above uses) is persisted verbatim as this
        # category's fallback -- see module docstring.
        pooled_posteriors[category] = pooled_fit

        for key, arm in by_arm.items():
            idx = arm["idx"]
            n = len(idx)
            if n < min_rows:
                continue
            arm_X = pooled_X_arr[idx]
            arm_y = pooled_y_arr[idx]
            posteriors[key] = category_prior.update(arm_X, arm_y)
            arm_row_counts["|".join(str(part) for part in key)] = n
            arm_data[key] = (arm_X, arm_y)

    # Leave-one-out calibration (arms with >= _LOO_MIN_ROWS rows): the
    # pooled-mean prior must NOT see the held-out row, or the metric leaks
    # (the held-out row would influence its own prediction via mu0). So for
    # each fold, downdate the category's precomputed XtX/Xty sums to remove
    # the held-out row's contribution, recompute the pooled mean from that,
    # then fit the arm's fold posterior on its remaining rows only.
    metrics = {
        "categories": {},
        "arm_row_counts": arm_row_counts,
        "excluded_null_arm_tasks": excluded_null_arm_tasks,
    }
    for category in category_prior_by_category:
        pooled_XtX_total, pooled_Xty_total = pooled_sums_by_category[category]
        below_p50 = below_p80 = total = 0
        for (cat, _mdl, _eff), (arm_X, arm_y) in arm_data.items():
            if cat != category:
                continue
            n = arm_X.shape[0]
            if n < _LOO_MIN_ROWS:
                continue
            for i in range(n):
                x_i = arm_X[i]
                y_i = arm_y[i]
                lambda_n_fold = weak_prior.Lambda + (pooled_XtX_total - np.outer(x_i, x_i))
                rhs_fold = weak_prior.Lambda @ weak_prior.mu + (pooled_Xty_total - x_i * y_i)
                mu0_fold = np.linalg.solve(lambda_n_fold, rhs_fold)
                category_prior_fold = model.NIG(mu=mu0_fold, Lambda=weak_prior.Lambda, a=weak_prior.a, b=weak_prior.b)

                mask = np.ones(n, dtype=bool)
                mask[i] = False
                loo_posterior = category_prior_fold.update(arm_X[mask], arm_y[mask])
                p50 = loo_posterior.quantile(x_i, 0.5)
                p80 = loo_posterior.quantile(x_i, 0.8)
                if y_i <= p50:
                    below_p50 += 1
                if y_i <= p80:
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

    # One sentinel row per category (model.POOLED_SENTINEL_ARM) carrying that
    # category's pooled posterior -- estimate.py's fallback for any (category,
    # arm) cell with no posterior of its own. Written after the per-arm loop
    # above so it can never be mistaken for a real arm (config["arms"] was
    # already computed from `posteriors` alone, not this dict).
    pooled_model, pooled_effort = model.POOLED_SENTINEL_ARM
    for category, posterior in pooled_posteriors.items():
        db.upsert(
            conn,
            "estimator_params",
            {
                "estimator_id": estimator_id,
                "category": category,
                "model": pooled_model,
                "effort": pooled_effort,
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
