"""Tests for the estimator CLI (estimate.py). See
.superpowers/sdd/task-analyzer/task-10-brief.md and
specs/task-analyzer-cost-model/spec.md "Decomposition estimator CLI" for the
required scenarios. Per the brief, estimators are hand-built directly into
``estimators``/``estimator_params`` -- no training run needed.
"""
from __future__ import annotations

import contextlib
import io
import json
import math
import os
import shutil
import stat
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import annotations  # noqa: E402
import db  # noqa: E402
import estimate  # noqa: E402
import model  # noqa: E402

CHEAP_ARM = ("claude-sonnet-5", "medium")
SPARSE_ARM = ("gpt-5", "low")
CATEGORIES = ["green", "review"]


def _cheap_nig():
    # Narrow posterior (high precision, high a/b -> small scale), low base cost.
    return model.NIG(mu=np.array([math.log(0.05 + 1e-4), 0.0]), Lambda=np.diag([1000.0, 1000.0]), a=1000.0, b=1.0)


def _sparse_nig():
    # Wide posterior (low precision, low a/b -> large scale), slightly higher base cost.
    return model.NIG(mu=np.array([math.log(0.06 + 1e-4), 0.05]), Lambda=np.diag([0.5, 0.5]), a=2.0, b=2.0)


def _pooled_nig():
    # A category's pooled fit: wider than _cheap_nig() (low precision, low
    # a/b), representing "honest but wide" fallback evidence.
    return model.NIG(mu=np.array([math.log(0.07 + 1e-4), 0.02]), Lambda=np.diag([0.05, 0.05]), a=1.5, b=1.5)


def _seed_estimator_db(conn, estimator_id=1, categories=CATEGORIES, arms=(CHEAP_ARM, SPARSE_ARM)):
    config = model.default_config(features=["1", "composite"])
    config["categories"] = list(categories)
    config["arms"] = [list(a) for a in arms]
    conn.execute(
        "INSERT INTO estimators (estimator_id, trained_at, code_version, train_task_count, config_json, metrics_json) "
        "VALUES (?, 't0', 'test', 0, ?, '{}')",
        (estimator_id, json.dumps(config)),
    )
    posteriors = {CHEAP_ARM: _cheap_nig(), SPARSE_ARM: _sparse_nig()}
    for category in categories:
        for arm in arms:
            db.upsert(
                conn, "estimator_params",
                {
                    "estimator_id": estimator_id, "category": category,
                    "model": arm[0], "effort": arm[1],
                    "posterior_json": posteriors[arm].to_json(),
                },
                ["estimator_id", "category", "model", "effort"],
            )
    conn.commit()
    return config


def _decomposition(task_composites=(("task-1", 3.0),)):
    return {
        "format": 1, "change": "test", "tasks": [
            {"task": key, "title": f"title {key}",
             "complexity": {f"C{i}": composite for i in range(1, 8)}}
            for key, composite in task_composites
        ],
    }


class EstimateTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp(prefix="task-analyzer-estimate-test-")
        self.tmp_path = Path(self._tmp)
        self.db_path = self.tmp_path / "t.sqlite"
        self.conn = db.connect(self.db_path)

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self._tmp, ignore_errors=True)


class TestScoreTask(EstimateTestCase):
    def test_cheap_arm_selected_and_sparse_flagged_explore(self):
        config = _seed_estimator_db(self.conn)
        _, _, posteriors = estimate.load_estimator(self.conn)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, 0.8)
        self.assertEqual((result["selected"]["model"], result["selected"]["effort"]), CHEAP_ARM)
        self.assertTrue(result["explore"])

    def test_arm_ranking_sorted_by_pq_ascending(self):
        config = _seed_estimator_db(self.conn)
        _, _, posteriors = estimate.load_estimator(self.conn)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, 0.8)
        pqs = [a["pq_total_usd"] for a in result["arms"]]
        self.assertEqual(pqs, sorted(pqs))

    def test_supplied_composite_is_ignored_and_recomputed(self):
        config = _seed_estimator_db(self.conn)
        _, _, posteriors = estimate.load_estimator(self.conn)
        complexity = {f"C{i}": 2 for i in range(1, 7)}
        complexity["C7"] = 2
        complexity["composite"] = 999.0  # deliberately wrong; must be ignored
        result = estimate.score_task(config, posteriors, complexity, 0.8)
        self.assertEqual(result["complexity"]["composite"], 2.0)

    def test_partial_coverage_arm_is_unscorable_not_partially_scored(self):
        # An arm missing a posterior for even one category must NOT appear
        # in the scorable "arms" ranking with a partial (undercounted)
        # total -- it's excluded entirely and reported under
        # "unscorable_arms" instead (review round 1 finding: silently
        # contributing $0 for missing categories biased selection toward
        # the least-covered arm).
        config = _seed_estimator_db(self.conn, categories=["green"])
        config["categories"] = ["green", "phantom"]
        _, _, posteriors = estimate.load_estimator(self.conn)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, 0.8)
        scorable_pairs = {(a["model"], a["effort"]) for a in result["arms"]}
        self.assertNotIn(CHEAP_ARM, scorable_pairs)
        self.assertNotIn(SPARSE_ARM, scorable_pairs)
        unscorable_pairs = {(a["model"], a["effort"]) for a in result["unscorable_arms"]}
        self.assertEqual(unscorable_pairs, {CHEAP_ARM, SPARSE_ARM})
        cheap_unscorable = next(a for a in result["unscorable_arms"] if (a["model"], a["effort"]) == CHEAP_ARM)
        self.assertEqual(cheap_unscorable["missing_categories"], ["phantom"])
        self.assertIsNone(result["selected"])

    def test_totals_sum_across_categories(self):
        config = _seed_estimator_db(self.conn)
        _, _, posteriors = estimate.load_estimator(self.conn)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, 0.8)
        cheap = next(a for a in result["arms"] if (a["model"], a["effort"]) == CHEAP_ARM)
        summed = sum(v["mean_usd"] for v in cheap["categories"].values())
        self.assertAlmostEqual(cheap["expected_total_usd"], summed, places=9)
        self.assertEqual(set(cheap["categories"]), set(CATEGORIES))

    def test_zero_coverage_arm_is_excluded_not_falsely_cheapest(self):
        # A hand-built/corrupted config listing an arm with no posterior
        # rows at all must not win by showing a false $0.00 total.
        config = _seed_estimator_db(self.conn)
        config["arms"].append(["nonexistent-model", "none"])
        _, _, posteriors = estimate.load_estimator(self.conn)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, 0.8)
        arm_pairs = {(a["model"], a["effort"]) for a in result["arms"]}
        self.assertNotIn(("nonexistent-model", "none"), arm_pairs)
        unscorable_pairs = {(a["model"], a["effort"]) for a in result["unscorable_arms"]}
        self.assertIn(("nonexistent-model", "none"), unscorable_pairs)
        self.assertEqual((result["selected"]["model"], result["selected"]["effort"]), CHEAP_ARM)


class TestPooledFallback(EstimateTestCase):
    """Follow-up 1, Part A: an arm missing a (category, arm) posterior falls
    back to that category's pooled posterior (model.POOLED_SENTINEL_ARM)
    instead of being excluded outright -- see estimate.py's module
    docstring and .superpowers/sdd/task-analyzer/followup-1-brief.md."""

    def _seed_with_missing_review_cell(self):
        # CHEAP_ARM has real posteriors for both categories; SPARSE_ARM has
        # no posterior of its own for "review" (simulating a near-empty
        # category for that arm), but the estimator persisted a pooled
        # fallback row for "review".
        config = _seed_estimator_db(self.conn, arms=(CHEAP_ARM,))
        db.upsert(
            self.conn, "estimator_params",
            {"estimator_id": 1, "category": "green", "model": SPARSE_ARM[0], "effort": SPARSE_ARM[1],
             "posterior_json": _sparse_nig().to_json()},
            ["estimator_id", "category", "model", "effort"],
        )
        # Deliberately no ("review", *SPARSE_ARM) row.
        db.upsert(
            self.conn, "estimator_params",
            {"estimator_id": 1, "category": "review",
             "model": model.POOLED_SENTINEL_MODEL, "effort": model.POOLED_SENTINEL_EFFORT,
             "posterior_json": _pooled_nig().to_json()},
            ["estimator_id", "category", "model", "effort"],
        )
        config["arms"].append(list(SPARSE_ARM))
        self.conn.execute("UPDATE estimators SET config_json = ? WHERE estimator_id = 1", (json.dumps(config),))
        self.conn.commit()
        return config

    def test_missing_cell_scored_via_pooled_fallback_with_wider_interval(self):
        config = self._seed_with_missing_review_cell()
        _, _, posteriors = estimate.load_estimator(self.conn)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, 0.8)
        sparse = next(a for a in result["arms"] if (a["model"], a["effort"]) == SPARSE_ARM)
        self.assertEqual(sparse["missing_categories"], [])
        self.assertTrue(sparse["categories"]["review"]["fallback"])
        self.assertFalse(sparse["categories"]["green"]["fallback"])
        review_width = sparse["categories"]["review"]["p80_usd"] - sparse["categories"]["review"]["p20_usd"]
        green_width = sparse["categories"]["green"]["p80_usd"] - sparse["categories"]["green"]["p20_usd"]
        self.assertGreater(review_width, green_width)

    def test_fallback_categories_reported_per_arm_and_selection(self):
        config = self._seed_with_missing_review_cell()
        _, _, posteriors = estimate.load_estimator(self.conn)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, 0.8)
        sparse = next(a for a in result["arms"] if (a["model"], a["effort"]) == SPARSE_ARM)
        self.assertEqual(sparse["fallback_categories"], ["review"])
        cheap = next(a for a in result["arms"] if (a["model"], a["effort"]) == CHEAP_ARM)
        self.assertEqual(cheap["fallback_categories"], [])
        self.assertEqual(result["unscorable_arms"], [])
        # SPARSE_ARM was scored (via fallback), not excluded -- it must be
        # eligible to be selected, unlike the old full-coverage exclusion
        # rule this replaces.
        arm_pairs = {(a["model"], a["effort"]) for a in result["arms"]}
        self.assertEqual(arm_pairs, {CHEAP_ARM, SPARSE_ARM})

    def test_unscorable_only_when_pooled_fallback_also_missing(self):
        # A category with neither a per-arm posterior NOR a pooled fallback
        # (e.g. a brand-new category name not present at training time)
        # still makes an arm unscorable -- fallback isn't magic.
        config = self._seed_with_missing_review_cell()
        config["categories"] = ["green", "review", "phantom"]
        _, _, posteriors = estimate.load_estimator(self.conn)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, 0.8)
        unscorable_pairs = {(a["model"], a["effort"]) for a in result["unscorable_arms"]}
        self.assertEqual(unscorable_pairs, {CHEAP_ARM, SPARSE_ARM})
        for arm in result["unscorable_arms"]:
            self.assertEqual(arm["missing_categories"], ["phantom"])
        self.assertIsNone(result["selected"])


RISKY_ARM = ("gpt-5.4", "high")


class TestGuard(EstimateTestCase):
    def _seed_risky_arm(self, guard_factor=None):
        """Seed the cheap arm plus a third, ``RISKY_ARM``: an even lower
        raw mean than the cheap arm, but a wide-enough posterior that its
        pq_total is ~5x the cheap arm's (verified numerically) -- fails the
        default 2x guard, but comfortably passes a permissive (e.g. 1000x)
        override, so the same fixture exercises both "guard rejects" and
        "guard, when relaxed, accepts" without needing separate posteriors.
        Optionally embeds ``guard_factor`` into the persisted estimator
        config."""
        config = _seed_estimator_db(self.conn, arms=(CHEAP_ARM,))
        risky_nig = model.NIG(mu=np.array([math.log(0.01 + 1e-4), 0.0]), Lambda=np.diag([0.15, 0.15]), a=5.0, b=1.0)
        for category in CATEGORIES:
            db.upsert(
                self.conn, "estimator_params",
                {"estimator_id": 1, "category": category, "model": RISKY_ARM[0], "effort": RISKY_ARM[1],
                 "posterior_json": risky_nig.to_json()},
                ["estimator_id", "category", "model", "effort"],
            )
        config["arms"].append(list(RISKY_ARM))
        if guard_factor is not None:
            config["guard_factor"] = guard_factor
        self.conn.execute(
            "UPDATE estimators SET config_json = ? WHERE estimator_id = 1", (json.dumps(config),)
        )
        self.conn.commit()
        return estimate.load_estimator(self.conn)

    def test_guard_rejects_low_mean_but_explosive_quantile_arm(self):
        # With the default guard factor (2.0, absent from config here), the
        # risky arm must lose to the cheap arm despite having the lowest
        # raw mean.
        _, config, posteriors = self._seed_risky_arm()
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, 0.8)
        risky = next(a for a in result["arms"] if (a["model"], a["effort"]) == RISKY_ARM)
        self.assertLess(risky["expected_total_usd"], next(
            a["expected_total_usd"] for a in result["arms"] if (a["model"], a["effort"]) == CHEAP_ARM
        ))
        self.assertEqual((result["selected"]["model"], result["selected"]["effort"]), CHEAP_ARM)

    def test_guard_factor_read_from_estimator_config(self):
        # A permissive guard factor persisted in the estimator's own
        # config_json (no CLI override) must let the risky arm win, since
        # it has the lowest mean and the guard no longer excludes it.
        _, config, posteriors = self._seed_risky_arm(guard_factor=1000.0)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, 0.8)
        self.assertEqual((result["selected"]["model"], result["selected"]["effort"]), RISKY_ARM)

    def test_guard_factor_cli_override_takes_precedence_over_config(self):
        # config_json says "permissive" (1000x) but an explicit
        # guard_factor argument (as --guard-factor would supply) must win:
        # a strict 1.0x factor rejects the risky arm again.
        _, config, posteriors = self._seed_risky_arm(guard_factor=1000.0)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, 0.8, guard_factor=1.0)
        self.assertEqual((result["selected"]["model"], result["selected"]["effort"]), CHEAP_ARM)

    def test_guard_factor_default_when_absent_from_config_and_cli(self):
        self.assertEqual(estimate.resolve_guard_factor({}, None), estimate.DEFAULT_GUARD_FACTOR)

    def test_guard_factor_echoed_in_run_report(self):
        self._seed_risky_arm(guard_factor=7.5)
        report = estimate.run(self.conn, _decomposition((("task-1", 3.0),)))
        self.assertEqual(report["guard_factor"], 7.5)

    def test_guard_factor_echoed_reflects_cli_override(self):
        self._seed_risky_arm(guard_factor=7.5)
        report = estimate.run(self.conn, _decomposition((("task-1", 3.0),)), guard_factor=1.0)
        self.assertEqual(report["guard_factor"], 1.0)


class TestRunAndCLI(EstimateTestCase):
    def _write_decomposition(self, suffix=".json"):
        doc = _decomposition((("task-1", 2.0), ("task-2", 4.0)))
        path = self.tmp_path / f"decomp{suffix}"
        if suffix == ".json":
            path.write_text(json.dumps(doc), encoding="utf-8")
        else:
            path.write_text(annotations.dump_yaml_subset(doc), encoding="utf-8")
        return path

    def test_run_produces_report_for_every_task(self):
        _seed_estimator_db(self.conn)
        report = estimate.run(self.conn, _decomposition((("task-1", 2.0), ("task-2", 4.0))))
        self.assertEqual([t["task"] for t in report["tasks"]], ["task-1", "task-2"])
        self.assertEqual(report["estimator_id"], 1)
        self.assertGreater(report["decomposition_totals"]["expected_total_usd"], 0.0)

    def test_json_and_yaml_decomposition_inputs_agree(self):
        _seed_estimator_db(self.conn)
        json_path = self._write_decomposition(".json")
        yaml_path = self._write_decomposition(".yaml")
        report_json = estimate.run(self.conn, annotations.load(json_path))
        report_yaml = estimate.run(self.conn, annotations.load(yaml_path))
        self.assertEqual(
            json.dumps(report_json, sort_keys=True), json.dumps(report_yaml, sort_keys=True)
        )

    def test_cli_byte_determinism_across_two_runs(self):
        _seed_estimator_db(self.conn)
        path = self._write_decomposition(".json")
        argv = ["--decomposition", str(path), "--db", str(self.db_path), "--estimator-id", "1", "--json"]

        def _capture():
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = estimate.main(argv)
            return rc, buf.getvalue()

        rc1, out1 = _capture()
        rc2, out2 = _capture()
        self.assertEqual(rc1, 0)
        self.assertEqual(rc2, 0)
        self.assertEqual(out1, out2)
        self.assertGreater(len(out1), 0)

    def test_cli_human_table_default_output(self):
        _seed_estimator_db(self.conn)
        path = self._write_decomposition(".json")
        argv = ["--decomposition", str(path), "--db", str(self.db_path), "--estimator-id", "1"]
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = estimate.main(argv)
        self.assertEqual(rc, 0)
        out = buf.getvalue()
        self.assertIn("task-1", out)
        self.assertIn("selected:", out)
        self.assertNotIn("{", out)  # not JSON

    def test_cli_json_output_is_valid_json(self):
        _seed_estimator_db(self.conn)
        path = self._write_decomposition(".json")
        argv = ["--decomposition", str(path), "--db", str(self.db_path), "--estimator-id", "1", "--json"]
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            estimate.main(argv)
        parsed = json.loads(buf.getvalue())
        self.assertEqual(parsed["estimator_id"], 1)

    def test_cli_requires_decomposition_unless_sanity(self):
        _seed_estimator_db(self.conn)
        argv = ["--db", str(self.db_path), "--estimator-id", "1"]
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            rc = estimate.main(argv)
        self.assertEqual(rc, 2)

    def test_cli_sanity_covers_composites_2_3_4_across_all_arms(self):
        _seed_estimator_db(self.conn)
        argv = ["--sanity", "--db", str(self.db_path), "--estimator-id", "1", "--json"]
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = estimate.main(argv)
        self.assertEqual(rc, 0)
        report = json.loads(buf.getvalue())
        composites = [t["complexity"]["composite"] for t in report["tasks"]]
        self.assertEqual(composites, [2.0, 3.0, 4.0])
        for task in report["tasks"]:
            arm_pairs = {(a["model"], a["effort"]) for a in task["arms"]}
            self.assertEqual(arm_pairs, {CHEAP_ARM, SPARSE_ARM})

    def test_cli_sanity_is_deterministic(self):
        _seed_estimator_db(self.conn)
        argv = ["--sanity", "--db", str(self.db_path), "--estimator-id", "1", "--json"]

        def _capture():
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                estimate.main(argv)
            return buf.getvalue()

        self.assertEqual(_capture(), _capture())

    def test_missing_estimator_id_errors_cleanly(self):
        _seed_estimator_db(self.conn)
        path = self._write_decomposition(".json")
        argv = ["--decomposition", str(path), "--db", str(self.db_path), "--estimator-id", "999"]
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            rc = estimate.main(argv)
        self.assertEqual(rc, 1)

    def test_default_estimator_id_is_latest(self):
        _seed_estimator_db(self.conn, estimator_id=1)
        _seed_estimator_db(self.conn, estimator_id=2)
        resolved_id, _config, _posteriors = estimate.load_estimator(self.conn)
        self.assertEqual(resolved_id, 2)


class TestReadOnlyDb(EstimateTestCase):
    """Final review finding A: estimate.py must open its --db read-only
    (db.connect_readonly), since that db is typically the shared
    main-branch copy -- it must work even when the file itself is
    filesystem-read-only, and it must not mutate/create anything."""

    def test_cli_works_against_chmod_readonly_db_file(self):
        _seed_estimator_db(self.conn)
        self.conn.close()
        path = self.tmp_path / "decomp.json"
        path.write_text(json.dumps(_decomposition((("task-1", 3.0),))), encoding="utf-8")

        original_mode = self.db_path.stat().st_mode
        os.chmod(self.db_path, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
        try:
            argv = ["--decomposition", str(path), "--db", str(self.db_path), "--estimator-id", "1", "--json"]
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = estimate.main(argv)
            self.assertEqual(rc, 0)
            report = json.loads(buf.getvalue())
            self.assertEqual((report["tasks"][0]["selected"]["model"], report["tasks"][0]["selected"]["effort"]), CHEAP_ARM)
        finally:
            os.chmod(self.db_path, original_mode)

    def test_cli_missing_db_errors_cleanly_without_creating_file(self):
        missing = self.tmp_path / "does-not-exist.sqlite"
        path = self.tmp_path / "decomp.json"
        path.write_text(json.dumps(_decomposition((("task-1", 3.0),))), encoding="utf-8")
        argv = ["--decomposition", str(path), "--db", str(missing)]
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            rc = estimate.main(argv)
        self.assertEqual(rc, 1)
        self.assertFalse(missing.exists())


if __name__ == "__main__":
    unittest.main()
