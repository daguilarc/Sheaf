"""Tests for the task-analyzer Bayesian cost model (model.py) and its
training entry point (train.py). See .superpowers/sdd/task-analyzer/
task-9-brief.md for the required test values / scenarios this covers.
"""
from __future__ import annotations

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

        rc = train.main(["--db", str(db_path)])
        self.assertEqual(rc, 0)

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
        expected = {("green", m, e) for m, e in arms}
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
        rc2 = train.main(["--db", str(db_path)])
        self.assertEqual(rc2, 0)
        estimators_after = conn.execute("SELECT estimator_id FROM estimators ORDER BY estimator_id").fetchall()
        self.assertEqual(len(estimators_after), 2)
        old_params_still_present = conn.execute(
            "SELECT COUNT(*) FROM estimator_params WHERE estimator_id = ?", (estimator_id,)
        ).fetchone()[0]
        self.assertEqual(old_params_still_present, 3)
        conn.close()

    def test_train_with_no_data_returns_nonzero(self):
        db_path = self.tmp_path / "empty.sqlite"
        conn = db.connect(db_path)
        conn.close()
        rc = train.main(["--db", str(db_path)])
        self.assertEqual(rc, 1)

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
