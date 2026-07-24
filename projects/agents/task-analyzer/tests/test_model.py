"""Tests for the task-analyzer Bayesian cost model (model.py) and its
training entry point (train.py). See .superpowers/sdd/task-analyzer/
task-9-brief.md for the required test values / scenarios this covers.
"""
from __future__ import annotations

import contextlib
import io
import json
import math
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import db  # noqa: E402
import model  # noqa: E402
import train  # noqa: E402


def _linear_data(rng, n, mu0=2.0, mu1=3.0, noise_sd=0.5, x_range=3.0):
    """Synthetic y = mu0 + mu1*x + noise, with an intercept column."""
    x = rng.uniform(-x_range, x_range, n)
    y = mu0 + mu1 * x + rng.normal(0, noise_sd, n)
    X = np.column_stack([np.ones(n), x])
    return X, y


class TestTPpf(unittest.TestCase):
    def test_known_values(self):
        self.assertAlmostEqual(model.t_ppf(0.8, 5), 0.9195, places=3)
        self.assertEqual(model.t_ppf(0.5, 7), 0.0)
        self.assertAlmostEqual(model.t_ppf(0.8, 1e6), 0.8416, places=3)

    def test_symmetry(self):
        # t_ppf(1-q, df) == -t_ppf(q, df) by symmetry of the t distribution.
        self.assertAlmostEqual(model.t_ppf(0.2, 9), -model.t_ppf(0.8, 9), places=6)

    def test_rejects_out_of_range_q(self):
        with self.assertRaises(ValueError):
            model.t_ppf(0.0, 5)
        with self.assertRaises(ValueError):
            model.t_ppf(1.0, 5)


class TestInverseTransformArray(unittest.TestCase):
    def test_matches_scalar_inverse_transform_elementwise(self):
        ys = np.array([-2.0, -0.5, 0.0, 1.0, 3.0])
        got = model.inverse_transform_array(ys)
        expected = np.array([model.inverse_transform(float(y)) for y in ys])
        np.testing.assert_allclose(got, expected)

    def test_floors_at_zero_for_deeply_negative_log_draws(self):
        # A left-tail MC draw well below -epsilon must floor at 0.0 (a
        # dollar cost cannot be negative), unlike the scalar
        # inverse_transform used for analytic quantiles (module docstring).
        ys = np.array([-50.0, -20.0, -1e-3])
        got = model.inverse_transform_array(ys)
        self.assertTrue(np.all(got >= 0.0))
        self.assertEqual(got[0], 0.0)
        self.assertEqual(got[1], 0.0)


class TestNIG(unittest.TestCase):
    def test_update_recovers_known_coefficients(self):
        rng = np.random.default_rng(0)
        X, y = _linear_data(rng, n=200)
        prior = model.NIG.weak_prior(2)
        post = prior.update(X, y)
        self.assertLess(abs(post.mu[0] - 2.0), 0.2)
        self.assertLess(abs(post.mu[1] - 3.0), 0.2)

    def test_predictive_calibration(self):
        rng = np.random.default_rng(1)
        X_train, y_train = _linear_data(rng, n=200)
        prior = model.NIG.weak_prior(2)
        post = prior.update(X_train, y_train)

        X_test, y_test = _linear_data(rng, n=300)
        below_p80 = sum(
            1 for xi, yi in zip(X_test, y_test) if yi <= post.quantile(xi, 0.8)
        )
        coverage = below_p80 / len(y_test)
        # ~80% of held-out points should fall below their p80.
        self.assertTrue(0.72 <= coverage <= 0.88, f"p80 coverage was {coverage}")

    def test_to_json_roundtrip_exact(self):
        nig = model.NIG(
            mu=np.array([1.5, -2.25, 0.0]),
            Lambda=np.array([[2.0, 0.5, 0.1], [0.5, 3.0, 0.0], [0.1, 0.0, 1.0]]),
            a=4.5,
            b=0.25,
        )
        s = nig.to_json()
        restored = model.NIG.from_json(s)
        np.testing.assert_array_equal(nig.mu, restored.mu)
        np.testing.assert_array_equal(nig.Lambda, restored.Lambda)
        self.assertEqual(nig.a, restored.a)
        self.assertEqual(nig.b, restored.b)
        self.assertEqual(s, restored.to_json())

    def test_sparse_arm_has_wider_interval(self):
        rng = np.random.default_rng(2)
        weak = model.NIG.weak_prior(2)

        X_sparse, y_sparse = _linear_data(rng, n=2)
        X_dense, y_dense = _linear_data(rng, n=50)

        post_sparse = weak.update(X_sparse, y_sparse)
        post_dense = weak.update(X_dense, y_dense)

        query = np.array([1.0, 0.0])
        gap_sparse = post_sparse.quantile(query, 0.8) - post_sparse.quantile(query, 0.5)
        gap_dense = post_dense.quantile(query, 0.8) - post_dense.quantile(query, 0.5)
        self.assertGreater(gap_sparse, gap_dense)

    def test_pooled_mean_weak_prior_pulls_sparse_arm_toward_pooled_mean(self):
        # Mirrors train.py's "pooled-mean-weak-prior-v1" scheme directly at
        # the NIG level: the pooled fit across all arms contributes only its
        # posterior mean (not its precision) as each arm's prior center;
        # prior precision (Lambda0/a0/b0) stays the original weak, fixed
        # values. A sparse arm should end up closer to the pooled mean than
        # a from-scratch (zero-mean-prior) fit on the same sparse rows would.
        rng = np.random.default_rng(4)
        weak = model.NIG.weak_prior(2)

        X_dense, y_dense = _linear_data(rng, n=50, mu0=2.0, mu1=3.0, noise_sd=0.1)
        X_sparse, y_sparse = _linear_data(rng, n=2, mu0=2.0, mu1=3.0, noise_sd=3.0)

        pooled_fit = weak.update(np.vstack([X_dense, X_sparse]), np.concatenate([y_dense, y_sparse]))
        category_prior = model.NIG(mu=pooled_fit.mu, Lambda=weak.Lambda, a=weak.a, b=weak.b)

        sparse_posterior = category_prior.update(X_sparse, y_sparse)
        naive_posterior = weak.update(X_sparse, y_sparse)  # zero-mean-prior fit, for comparison

        dist_pooled_mean_prior = np.linalg.norm(sparse_posterior.mu - pooled_fit.mu)
        dist_naive = np.linalg.norm(naive_posterior.mu - pooled_fit.mu)
        self.assertLess(dist_pooled_mean_prior, dist_naive)

        # Sparse-wider-than-dense still holds under the new scheme too.
        dense_posterior = category_prior.update(X_dense, y_dense)
        query = np.array([1.0, 0.0])
        gap_sparse = sparse_posterior.quantile(query, 0.8) - sparse_posterior.quantile(query, 0.5)
        gap_dense = dense_posterior.quantile(query, 0.8) - dense_posterior.quantile(query, 0.5)
        self.assertGreater(gap_sparse, gap_dense)

    def test_thompson_sample_is_finite_and_seed_reproducible(self):
        rng = np.random.default_rng(3)
        X, y = _linear_data(rng, n=50)
        post = model.NIG.weak_prior(2).update(X, y)

        s1 = post.thompson(np.array([1.0, 0.5]), np.random.default_rng(7))
        s2 = post.thompson(np.array([1.0, 0.5]), np.random.default_rng(7))
        self.assertEqual(s1, s2)
        self.assertTrue(math.isfinite(s1))

    def test_predictive_draws_matches_analytic_mean_and_quantiles(self):
        # followup-2: predictive_draws is what estimate.py's Monte Carlo
        # totals are built from -- its empirical mean/median/quantiles must
        # converge to the closed-form predictive() values it's drawing from.
        rng = np.random.default_rng(5)
        X, y = _linear_data(rng, n=200)
        post = model.NIG.weak_prior(2).update(X, y)
        x = np.array([1.0, 0.5])

        draws = post.predictive_draws(x, 200_000, np.random.default_rng(11))
        self.assertEqual(draws.shape, (200_000,))
        self.assertTrue(np.all(np.isfinite(draws)))

        mean, _scale, _df = post.predictive(x)
        self.assertAlmostEqual(float(np.mean(draws)), mean, delta=0.05)
        for q in (0.2, 0.5, 0.8):
            self.assertAlmostEqual(float(np.quantile(draws, q)), post.quantile(x, q), delta=0.05)

    def test_predictive_draws_seed_reproducible(self):
        rng = np.random.default_rng(3)
        X, y = _linear_data(rng, n=50)
        post = model.NIG.weak_prior(2).update(X, y)
        x = np.array([1.0, 0.5])

        d1 = post.predictive_draws(x, 100, np.random.default_rng(7))
        d2 = post.predictive_draws(x, 100, np.random.default_rng(7))
        np.testing.assert_array_equal(d1, d2)

    def test_features_default_layout(self):
        row = {"composite": 3.5, "c3": 2, "c4": 4, "c5": 1}
        x = model.features(row, model.default_config())
        np.testing.assert_array_equal(x, np.array([1.0, 3.5, 2.0, 4.0, 1.0]))


def _seed_training_db(conn, n_per_arm=20, category="green", seed=42):
    """Seed ~60 synthetic (task_costs, complexity, task_arms) rows across 3
    arms, per task-9-brief.md Step 3."""
    db.upsert(conn, "changes", {"change_id": 1, "name": "synthetic", "ingested_at": "t0"}, ["change_id"])
    arms = [
        ("claude-sonnet-5", "medium"),
        ("claude-opus-4-8", "high"),
        ("gpt-5", "low"),
    ]
    rng = np.random.default_rng(seed)
    task_id = 0
    for arm_model, effort in arms:
        for _ in range(n_per_arm):
            task_id += 1
            db.upsert(
                conn, "tasks",
                {"task_id": task_id, "change_id": 1, "task_key": f"task-{task_id}"},
                ["task_id"],
            )
            composite = float(rng.uniform(1.0, 5.0))
            db.upsert(
                conn, "complexity",
                {
                    "task_id": task_id, "c1": 1, "c2": 1,
                    "c3": int(rng.integers(1, 6)), "c4": int(rng.integers(1, 6)),
                    "c5": int(rng.integers(1, 6)), "c6": 1, "c7": 1,
                    "composite": composite, "rationale_json": "{}",
                    "rubric_version": "1", "input_sha256": "deadbeef", "scored_by": "test",
                },
                ["task_id", "rubric_version"],
            )
            db.upsert(
                conn, "task_arms",
                {"task_id": task_id, "model": arm_model, "effort": effort, "basis_json": "{}"},
                ["task_id"],
            )
            usd = math.exp(0.5 + 0.3 * composite + rng.normal(0, 0.2))
            db.upsert(
                conn, "task_costs",
                {
                    "task_id": task_id, "category": category,
                    "weighted_tokens": 1000.0, "usd": usd,
                    "computed_at": "t0", "price_version": "2026-07-01",
                },
                ["task_id", "category"],
            )
    conn.commit()
    return task_id, arms


def _add_null_arm_task(conn, task_id, category="green", change_id=1):
    """A task with a task_costs/complexity row but a NULL-arm task_arms row
    -- e.g. a review-only or quarantined task with no round-0 implementer
    session (design.md D5). Real, expected data: train.py must skip it, not
    crash on it."""
    db.upsert(
        conn, "tasks",
        {"task_id": task_id, "change_id": change_id, "task_key": f"task-{task_id}"},
        ["task_id"],
    )
    db.upsert(
        conn, "complexity",
        {
            "task_id": task_id, "c1": 1, "c2": 1, "c3": 3, "c4": 3, "c5": 3, "c6": 1, "c7": 1,
            "composite": 3.0, "rationale_json": "{}",
            "rubric_version": "1", "input_sha256": "deadbeef", "scored_by": "test",
        },
        ["task_id", "rubric_version"],
    )
    db.upsert(
        conn, "task_arms",
        {"task_id": task_id, "model": None, "effort": None, "basis_json": "{}"},
        ["task_id"],
    )
    db.upsert(
        conn, "task_costs",
        {
            "task_id": task_id, "category": category,
            "weighted_tokens": 500.0, "usd": 1.23,
            "computed_at": "t0", "price_version": "2026-07-01",
        },
        ["task_id", "category"],
    )
    conn.commit()


class TestTrain(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp(prefix="task-analyzer-train-test-")
        self.tmp_path = Path(self._tmp)

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_train_writes_estimator_and_params_for_every_category_arm(self):
        db_path = self.tmp_path / "t.sqlite"
        conn = db.connect(db_path)
        n_tasks, arms = _seed_training_db(conn)
        conn.close()

        # train.main prints {"estimator_id": N} to stdout on success (see
        # train.py's CLI) -- captured rather than left to leak into the test
        # runner's own output, and asserted here as the one dedicated CLI
        # check of that printed shape.
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            rc = train.main(["--db", str(db_path)])
        self.assertEqual(rc, 0)
        printed = json.loads(stdout.getvalue())
        self.assertIn("estimator_id", printed)
        self.assertIsInstance(printed["estimator_id"], int)

        conn = db.connect(db_path, create=False)
        estimators = conn.execute("SELECT estimator_id, config_json, metrics_json, train_task_count FROM estimators").fetchall()
        self.assertEqual(len(estimators), 1)
        estimator_id = estimators[0]["estimator_id"]
        self.assertEqual(estimators[0]["train_task_count"], n_tasks)

        params = conn.execute(
            "SELECT category, model, effort FROM estimator_params WHERE estimator_id = ?",
            (estimator_id,),
        ).fetchall()
        got = {(r["category"], r["model"], r["effort"]) for r in params}
        # One row per (category, arm), plus one sentinel row per category
        # carrying the pooled fallback posterior (followup-1 Part A).
        expected = {("green", m, e) for m, e in arms}
        expected.add(("green",) + model.POOLED_SENTINEL_ARM)
        self.assertEqual(got, expected)

        config = json.loads(estimators[0]["config_json"])
        for key in (
            "features", "transform", "epsilon", "prior", "pooling",
            "training_filters", "categories", "arms",
            "quantile_algorithm", "output_format",
        ):
            self.assertIn(key, config, f"config_json missing normative key {key!r}")
        self.assertEqual(config["categories"], ["green"])
        self.assertEqual(config["training_filters"]["rubric_version"], "1")
        self.assertEqual(config["training_filters"]["price_version"], "2026-07-01")

        metrics = json.loads(estimators[0]["metrics_json"])
        self.assertIn("green", metrics["categories"])
        self.assertIn("p50_coverage", metrics["categories"]["green"])
        self.assertIn("p80_coverage", metrics["categories"]["green"])
        self.assertEqual(len(metrics["arm_row_counts"]), 3)
        for count in metrics["arm_row_counts"].values():
            self.assertEqual(count, 20)

        # Re-running creates a second estimators row; the old one is kept.
        with contextlib.redirect_stdout(io.StringIO()):
            rc2 = train.main(["--db", str(db_path)])
        self.assertEqual(rc2, 0)
        estimators_after = conn.execute("SELECT estimator_id FROM estimators ORDER BY estimator_id").fetchall()
        self.assertEqual(len(estimators_after), 2)
        old_params_still_present = conn.execute(
            "SELECT COUNT(*) FROM estimator_params WHERE estimator_id = ?", (estimator_id,)
        ).fetchone()[0]
        self.assertEqual(old_params_still_present, 4)  # 3 arms + 1 pooled sentinel row
        conn.close()

    def test_train_keeps_rows_across_mixed_price_versions(self):
        # task_costs.price_version is a *per-model* effective date, so a
        # perfectly healthy rebuild can leave different arms' rows carrying
        # different dates (each model priced by its own newest price row).
        # Training must not filter rows to any single date -- an earlier
        # version filtered to the global max price_version and silently
        # dropped every category funded by a model with an older price row.
        db_path = self.tmp_path / "mixed_prices.sqlite"
        conn = db.connect(db_path)
        n_tasks, arms = _seed_training_db(conn)  # all rows at "2026-07-01"
        # Re-date one arm's rows to an older per-model effective date.
        conn.execute(
            "UPDATE task_costs SET price_version = '2026-06-01' WHERE task_id IN "
            "(SELECT task_id FROM task_arms WHERE model = ? AND effort = ?)",
            arms[0],
        )
        conn.commit()

        estimator_id = train.run(conn)
        self.assertIsNotNone(estimator_id)

        row = conn.execute(
            "SELECT config_json, metrics_json, train_task_count FROM estimators WHERE estimator_id = ?",
            (estimator_id,),
        ).fetchone()
        # Every task still trains -- nothing dropped by price date.
        self.assertEqual(row["train_task_count"], n_tasks)
        metrics = json.loads(row["metrics_json"])
        self.assertEqual(len(metrics["arm_row_counts"]), len(arms))
        for count in metrics["arm_row_counts"].values():
            self.assertEqual(count, 20)
        # The old-dated arm still gets its own posterior row.
        params = conn.execute(
            "SELECT model, effort FROM estimator_params WHERE estimator_id = ?",
            (estimator_id,),
        ).fetchall()
        self.assertIn(arms[0], {(r["model"], r["effort"]) for r in params})
        # The newest date present is recorded as provenance.
        config = json.loads(row["config_json"])
        self.assertEqual(config["training_filters"]["price_version"], "2026-07-01")
        conn.close()

    def test_train_excludes_null_arm_tasks(self):
        # 139 real task_arms rows have NULL model/effort in production data
        # (review-only or quarantined tasks with no round-0 implementer
        # session -- expected, not corruption). train.py must skip them at
        # the join (they can train no arm) rather than crash sorting a
        # mix of None and str arm tuples, and must record how many it
        # skipped.
        db_path = self.tmp_path / "null_arm.sqlite"
        conn = db.connect(db_path)
        n_tasks, arms = _seed_training_db(conn)
        _add_null_arm_task(conn, task_id=n_tasks + 1)
        _add_null_arm_task(conn, task_id=n_tasks + 2)

        estimator_id = train.run(conn)
        self.assertIsNotNone(estimator_id)

        row = conn.execute(
            "SELECT metrics_json, train_task_count FROM estimators WHERE estimator_id = ?",
            (estimator_id,),
        ).fetchone()
        self.assertEqual(row["train_task_count"], n_tasks)  # the 2 null-arm tasks aren't counted
        metrics = json.loads(row["metrics_json"])
        self.assertEqual(metrics["excluded_null_arm_tasks"], 2)

        # The null-arm tasks contributed no estimator_params row.
        params = conn.execute(
            "SELECT model, effort FROM estimator_params WHERE estimator_id = ?", (estimator_id,)
        ).fetchall()
        self.assertTrue(all(r["model"] is not None and r["effort"] is not None for r in params))
        conn.close()

    def test_loo_calibration_is_leak_free(self):
        # Independent, deliberately slow reference implementation of the
        # leave-one-out calibration: for every held-out row, recompute the
        # pooled fit *from scratch excluding that row* (no XtX/Xty downdate
        # trick -- just a straightforward NIG.update over the remaining
        # rows), then fit the arm's fold posterior on its remaining rows.
        # train.py's fast downdate-based implementation must match this
        # exactly -- if the held-out row's own contribution leaked into the
        # pooled mean used for its prediction (the bug this test guards
        # against), the two would disagree.
        db_path = self.tmp_path / "loo.sqlite"
        conn = db.connect(db_path)
        _seed_training_db(conn)
        estimator_id = train.run(conn)
        metrics = json.loads(
            conn.execute(
                "SELECT metrics_json FROM estimators WHERE estimator_id = ?", (estimator_id,)
            ).fetchone()[0]
        )
        reported = metrics["categories"]["green"]

        config = model.default_config()
        rows = conn.execute(
            "SELECT tc.usd AS usd, c.composite AS composite, c.c3 AS c3, c.c4 AS c4, c.c5 AS c5, "
            "ta.model AS model, ta.effort AS effort "
            "FROM task_costs tc JOIN complexity c ON c.task_id = tc.task_id AND c.rubric_version = '1' "
            "JOIN task_arms ta ON ta.task_id = tc.task_id WHERE tc.category = 'green'"
        ).fetchall()
        X = np.array([model.features(r, config) for r in rows])
        y = np.array([model.transform_target(r["usd"], config["epsilon"]) for r in rows])
        arms = [(r["model"], r["effort"]) for r in rows]
        weak = model.NIG.weak_prior(len(config["features"]))

        below_p50 = below_p80 = total = 0
        for arm in sorted(set(arms)):
            arm_idx = [i for i, a in enumerate(arms) if a == arm]
            if len(arm_idx) < 8:
                continue
            for i in arm_idx:
                others = [j for j in range(len(rows)) if j != i]
                pooled_fit = weak.update(X[others], y[others])
                fold_prior = model.NIG(mu=pooled_fit.mu, Lambda=weak.Lambda, a=weak.a, b=weak.b)
                arm_fold_idx = [j for j in arm_idx if j != i]
                fold_posterior = fold_prior.update(X[arm_fold_idx], y[arm_fold_idx])
                p50 = fold_posterior.quantile(X[i], 0.5)
                p80 = fold_posterior.quantile(X[i], 0.8)
                if y[i] <= p50:
                    below_p50 += 1
                if y[i] <= p80:
                    below_p80 += 1
                total += 1

        self.assertEqual(reported["loo_n"], total)
        self.assertAlmostEqual(reported["p50_coverage"], below_p50 / total, places=9)
        self.assertAlmostEqual(reported["p80_coverage"], below_p80 / total, places=9)
        conn.close()

    def test_train_with_no_data_returns_nonzero(self):
        db_path = self.tmp_path / "empty.sqlite"
        conn = db.connect(db_path)
        conn.close()
        # train.main prints "no training data found; nothing written" to
        # stderr on this path (see train.py) -- captured rather than left to
        # leak into the test runner's own output, and asserted here.
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            rc = train.main(["--db", str(db_path)])
        self.assertEqual(rc, 1)
        self.assertIn("no training data found", stderr.getvalue())

    def test_pooled_posterior_persisted_as_sentinel_row(self):
        # Follow-up 1, Part A: train.py must persist each category's pooled
        # fit (all arms' rows, from the weak prior) as a sentinel
        # estimator_params row -- estimate.py's fallback for a (category,
        # arm) cell with no posterior of its own.
        db_path = self.tmp_path / "pooled.sqlite"
        conn = db.connect(db_path)
        _seed_training_db(conn)
        estimator_id = train.run(conn)

        pooled_model, pooled_effort = model.POOLED_SENTINEL_ARM
        row = conn.execute(
            "SELECT posterior_json FROM estimator_params "
            "WHERE estimator_id = ? AND category = 'green' AND model = ? AND effort = ?",
            (estimator_id, pooled_model, pooled_effort),
        ).fetchone()
        self.assertIsNotNone(row, "no pooled sentinel row persisted for category 'green'")
        pooled = model.NIG.from_json(row["posterior_json"])

        # Independently recompute the category's pooled fit -- the weak
        # prior updated on every arm's rows combined -- and compare exactly.
        config = model.default_config()
        rows = conn.execute(
            "SELECT tc.usd AS usd, c.composite AS composite, c.c3 AS c3, c.c4 AS c4, c.c5 AS c5 "
            "FROM task_costs tc JOIN complexity c ON c.task_id = tc.task_id AND c.rubric_version = '1' "
            "JOIN task_arms ta ON ta.task_id = tc.task_id WHERE tc.category = 'green'"
        ).fetchall()
        X = np.array([model.features(r, config) for r in rows])
        y = np.array([model.transform_target(r["usd"], config["epsilon"]) for r in rows])
        weak = model.NIG.weak_prior(len(config["features"]))
        expected = weak.update(X, y)

        np.testing.assert_allclose(pooled.mu, expected.mu)
        np.testing.assert_allclose(pooled.Lambda, expected.Lambda)
        self.assertAlmostEqual(pooled.a, expected.a)
        self.assertAlmostEqual(pooled.b, expected.b)

        # The sentinel arm must never leak into config["arms"] -- it's not a
        # real, selectable (model, effort) arm.
        config_json = json.loads(
            conn.execute(
                "SELECT config_json FROM estimators WHERE estimator_id = ?", (estimator_id,)
            ).fetchone()[0]
        )
        self.assertNotIn(list(model.POOLED_SENTINEL_ARM), config_json["arms"])
        conn.close()

    def test_posteriors_roundtrip_and_are_queryable(self):
        db_path = self.tmp_path / "t2.sqlite"
        conn = db.connect(db_path)
        _seed_training_db(conn)
        estimator_id = train.run(conn)
        self.assertIsNotNone(estimator_id)

        row = conn.execute(
            "SELECT posterior_json FROM estimator_params "
            "WHERE estimator_id = ? AND category = 'green' AND model = 'claude-sonnet-5' AND effort = 'medium'",
            (estimator_id,),
        ).fetchone()
        nig = model.NIG.from_json(row["posterior_json"])
        mean, scale, df = nig.predictive(np.array([1.0, 3.0, 3.0, 3.0, 3.0]))
        self.assertTrue(math.isfinite(mean))
        self.assertTrue(scale > 0)
        self.assertTrue(df > 0)
        conn.close()


if __name__ == "__main__":
    unittest.main()
