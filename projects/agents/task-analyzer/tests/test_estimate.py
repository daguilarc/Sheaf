"""Tests for the estimator CLI (estimate.py). See
.superpowers/sdd/task-analyzer/followup-2-brief.md for the p20-bandit/
Monte-Carlo redesign this covers (supersedes the old expected/pq/explore-flag
design; see git history for that version's tests) and
.superpowers/sdd/task-analyzer/followup-3-brief.md for the removal of the
p80 tail-risk guard (selection is now min p20 among ALL scorable arms, no
exclusion by p80; see git history for the guard-era tests) and
specs/task-analyzer-cost-model/spec.md "Decomposition estimator CLI" for the
required scenarios. Per convention, estimators are hand-built directly into
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
    # Wide posterior (low precision, low a/b -> large scale), slightly higher
    # base cost than _cheap_nig() -- but its width pulls its own low quantile
    # (p20) BELOW the narrow arm's p20 despite the higher center, which is
    # exactly the "unknown arms get a low, optimistic p20" behavior the
    # p20-bandit selection rule (followup-2) is built to exploit/explore.
    return model.NIG(mu=np.array([math.log(0.06 + 1e-4), 0.05]), Lambda=np.diag([0.5, 0.5]), a=2.0, b=2.0)


def _pooled_nig():
    # A category's pooled fit: wider than _cheap_nig() (low precision, low
    # a/b), representing "honest but wide" fallback evidence.
    return model.NIG(mu=np.array([math.log(0.07 + 1e-4), 0.02]), Lambda=np.diag([0.05, 0.05]), a=1.5, b=1.5)


def _moderate_nig():
    # Moderately dispersed, higher-df (less heavy-tailed) posterior -- used
    # by the quantile-of-sum-vs-sum-of-quantiles test, where a very
    # heavy-tailed (low-df) posterior can flip the usual independence-gives-
    # diversification direction (superadditive VaR under extremely heavy
    # tails is a known phenomenon; this fixture stays in the regime where
    # the brief's claimed direction holds robustly -- verified numerically
    # across seeds during test authoring).
    return model.NIG(mu=np.array([math.log(0.06 + 1e-4), 0.02]), Lambda=np.diag([5.0, 5.0]), a=20.0, b=2.0)


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
    def test_huge_p80_but_lowest_p20_arm_now_wins(self):
        # Followup-3: the p80 guard is gone. SPARSE_ARM's p80 total (~52) is
        # roughly 500x CHEAP_ARM's (~0.10) -- the exact case the old guard
        # used to exclude -- but SPARSE_ARM's width pulls its own p20 (~0.03)
        # BELOW CHEAP_ARM's (~0.10), so it now wins selection outright, no
        # override/permissive config needed. This is the intended behavior
        # (user decision, followup-3 brief): the guard was suppressing
        # exploration of exactly the sparse arms p20-selection exists to
        # explore.
        config = _seed_estimator_db(self.conn)
        _, _, posteriors = estimate.load_estimator(self.conn)
        rng = np.random.default_rng(0)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, rng)
        cheap = next(a for a in result["arms"] if (a["model"], a["effort"]) == CHEAP_ARM)
        sparse = next(a for a in result["arms"] if (a["model"], a["effort"]) == SPARSE_ARM)
        self.assertLess(sparse["p20_total_usd"], cheap["p20_total_usd"])
        self.assertGreater(sparse["p80_total_usd"], 10 * cheap["p80_total_usd"])
        self.assertEqual((result["selected"]["model"], result["selected"]["effort"]), SPARSE_ARM)

    def test_arm_ranking_sorted_by_p20_ascending(self):
        config = _seed_estimator_db(self.conn)
        _, _, posteriors = estimate.load_estimator(self.conn)
        rng = np.random.default_rng(0)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, rng)
        p20s = [a["p20_total_usd"] for a in result["arms"]]
        self.assertEqual(p20s, sorted(p20s))

    def test_supplied_composite_is_ignored_and_recomputed(self):
        config = _seed_estimator_db(self.conn)
        _, _, posteriors = estimate.load_estimator(self.conn)
        complexity = {f"C{i}": 2 for i in range(1, 7)}
        complexity["C7"] = 2
        complexity["composite"] = 999.0  # deliberately wrong; must be ignored
        rng = np.random.default_rng(0)
        result = estimate.score_task(config, posteriors, complexity, rng)
        self.assertEqual(result["complexity"]["composite"], 2.0)

    def test_partial_coverage_arm_is_unscorable_not_partially_scored(self):
        # An arm missing a posterior (own AND pooled) for even one category
        # must NOT appear in the scorable "arms" ranking with a partial
        # (undercounted) total -- it's excluded entirely and reported under
        # "unscorable_arms" instead.
        config = _seed_estimator_db(self.conn, categories=["green"])
        config["categories"] = ["green", "phantom"]
        _, _, posteriors = estimate.load_estimator(self.conn)
        rng = np.random.default_rng(0)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, rng)
        scorable_pairs = {(a["model"], a["effort"]) for a in result["arms"]}
        self.assertNotIn(CHEAP_ARM, scorable_pairs)
        self.assertNotIn(SPARSE_ARM, scorable_pairs)
        unscorable_pairs = {(a["model"], a["effort"]) for a in result["unscorable_arms"]}
        self.assertEqual(unscorable_pairs, {CHEAP_ARM, SPARSE_ARM})
        cheap_unscorable = next(a for a in result["unscorable_arms"] if (a["model"], a["effort"]) == CHEAP_ARM)
        self.assertEqual(cheap_unscorable["missing_categories"], ["phantom"])
        self.assertIsNone(result["selected"])

    def test_totals_well_formed_and_categories_present(self):
        config = _seed_estimator_db(self.conn)
        _, _, posteriors = estimate.load_estimator(self.conn)
        rng = np.random.default_rng(0)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, rng)
        cheap = next(a for a in result["arms"] if (a["model"], a["effort"]) == CHEAP_ARM)
        self.assertEqual(set(cheap["categories"]), set(CATEGORIES))
        self.assertLessEqual(cheap["p20_total_usd"], cheap["p50_total_usd"])
        self.assertLessEqual(cheap["p50_total_usd"], cheap["p80_total_usd"])
        self.assertIsNone(cheap["thompson_total_usd"])  # not --thompson mode
        for cat_diag in cheap["categories"].values():
            for key in ("median_usd", "p20_usd", "p80_usd", "fallback"):
                self.assertIn(key, cat_diag)
            # No dollar-mean field: exp(Student-t) has no finite moments, so
            # a "mean_usd" cannot honestly exist (the removed field of that
            # name was exp of the log-space mean -- the median again, under
            # a misleading name).
            self.assertNotIn("mean_usd", cat_diag)

    def test_zero_coverage_arm_is_excluded_not_falsely_cheapest(self):
        # A hand-built/corrupted config listing an arm with no posterior
        # rows at all must not win by showing a false $0.00 total.
        config = _seed_estimator_db(self.conn)
        config["arms"].append(["nonexistent-model", "none"])
        _, _, posteriors = estimate.load_estimator(self.conn)
        rng = np.random.default_rng(0)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, rng)
        arm_pairs = {(a["model"], a["effort"]) for a in result["arms"]}
        self.assertNotIn(("nonexistent-model", "none"), arm_pairs)
        unscorable_pairs = {(a["model"], a["effort"]) for a in result["unscorable_arms"]}
        self.assertIn(("nonexistent-model", "none"), unscorable_pairs)
        # Among the two real arms, SPARSE_ARM has the lower p20 (no guard to
        # exclude it despite its huge p80 -- see
        # test_huge_p80_but_lowest_p20_arm_now_wins) and wins; the point of
        # this test is only that the zero-coverage arm never wins by
        # default, not which real arm does.
        self.assertEqual((result["selected"]["model"], result["selected"]["effort"]), SPARSE_ARM)

    def test_selection_is_min_p20_not_min_p50(self):
        # SPARSE_ARM's total p50 (median) is far ABOVE CHEAP_ARM's -- under a
        # min-p50/median selection rule CHEAP_ARM would win outright. But
        # SPARSE_ARM's width pulls its p20 BELOW CHEAP_ARM's, so under the
        # actual min-p20-among-all-scorable-arms rule it wins instead. This
        # is the core "why p20, not p50" property from the brief.
        config = _seed_estimator_db(self.conn)
        _, _, posteriors = estimate.load_estimator(self.conn)
        rng = np.random.default_rng(0)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, rng)
        self.assertEqual((result["selected"]["model"], result["selected"]["effort"]), SPARSE_ARM)
        cheap = next(a for a in result["arms"] if (a["model"], a["effort"]) == CHEAP_ARM)
        sparse = next(a for a in result["arms"] if (a["model"], a["effort"]) == SPARSE_ARM)
        self.assertLess(sparse["p20_total_usd"], cheap["p20_total_usd"])
        self.assertGreater(sparse["p50_total_usd"], cheap["p50_total_usd"])


class TestMonteCarloProperties(EstimateTestCase):
    """Followup-2 section 7(a)/(b): MC determinism and quantile-of-sum vs
    sum-of-quantiles."""

    def test_mc_determinism_same_seed_byte_identical(self):
        config = _seed_estimator_db(self.conn)
        _, _, posteriors = estimate.load_estimator(self.conn)

        def _run():
            rng = np.random.default_rng(0)
            result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, rng)
            return json.dumps(result, sort_keys=True)

        self.assertEqual(_run(), _run())

    def test_different_seed_gives_different_draws(self):
        config = _seed_estimator_db(self.conn)
        _, _, posteriors = estimate.load_estimator(self.conn)
        result_a = estimate.score_task(
            config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, np.random.default_rng(0)
        )
        result_b = estimate.score_task(
            config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, np.random.default_rng(1)
        )
        self.assertNotEqual(
            json.dumps(result_a, sort_keys=True), json.dumps(result_b, sort_keys=True)
        )

    def test_mc_total_quantiles_vs_sum_of_analytic_quantiles(self):
        # On a 2-category, MODERATE-tail posterior (independent draws per
        # category): the MC total's p80 <= the sum of each category's own
        # analytic p80, and the MC total's p20 >= the sum of each category's
        # own analytic p20 -- i.e. summing overstates the true upper tail
        # and understates the true lower tail here. This directional
        # inequality is NOT the normative requirement (spec.md, fix round 1:
        # it can flip for sufficiently heavy tails -- independence no longer
        # guarantees the usual diversification benefit); it's a property of
        # this specific moderate-tail fixture, checked as a non-normative
        # sanity note. The requirement this module actually satisfies,
        # unconditionally, is narrower and always true: totals are
        # quantiles *of the sum* of draws (this MC procedure), never a sum
        # *of* per-category quantiles (the design this replaced) -- see
        # test_selection_is_min_p20_not_min_p50 and the module docstring for
        # why that distinction is what matters for selection correctness,
        # independent of which way any particular posterior's inequality
        # happens to point.
        arm = ("claude-sonnet-5", "medium")
        nig = _moderate_nig()
        config = model.default_config(features=["1", "composite"])
        config["categories"] = list(CATEGORIES)
        config["arms"] = [list(arm)]
        posteriors = {(cat, *arm): nig for cat in CATEGORIES}

        row = estimate._recomputed_complexity({f"C{i}": 3 for i in range(1, 8)})
        x = model.features(row, config)
        analytic_p20_sum = 2 * model.inverse_transform(nig.quantile(x, 0.2), config["epsilon"])
        analytic_p80_sum = 2 * model.inverse_transform(nig.quantile(x, 0.8), config["epsilon"])

        rng = np.random.default_rng(0)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, rng)
        arm_result = result["arms"][0]

        tolerance = 0.01
        self.assertLessEqual(arm_result["p80_total_usd"], analytic_p80_sum + tolerance)
        self.assertGreaterEqual(arm_result["p20_total_usd"], analytic_p20_sum - tolerance)


class TestNonFiniteDraws(EstimateTestCase):
    """Fix round 1 (codex review, Important finding 4): overflowed Monte
    Carlo/Thompson draws must never reach the JSON report as Infinity/NaN --
    quantiles are computed over the finite subset only, non-finite counts
    are reported diagnostically, and an arm with zero finite draws is
    unscorable rather than silently producing a non-finite total."""

    # mu itself is already far beyond exp() overflow (~709) -- essentially
    # every draw for this posterior overflows (verified: 0/2000 finite).
    _ALL_OVERFLOW_NIG = model.NIG(mu=np.array([1000.0, 0.0]), Lambda=np.diag([1000.0, 1000.0]), a=1000.0, b=1.0)
    # Wide, heavy-tailed (df=1, Cauchy) but centered at a plausible cost --
    # most draws are large-but-finite, a minority overflow (verified: ~32 of
    # 2000 at seed 0).
    _PARTIAL_OVERFLOW_NIG = model.NIG(mu=np.array([50.0, 0.0]), Lambda=np.diag([0.01, 0.01]), a=0.5, b=0.5)

    def _seed_with_overflow_arm(self, nig, arm=("gpt-5.4", "high")):
        config = _seed_estimator_db(self.conn, arms=(CHEAP_ARM,))
        for category in CATEGORIES:
            db.upsert(
                self.conn, "estimator_params",
                {"estimator_id": 1, "category": category, "model": arm[0], "effort": arm[1],
                 "posterior_json": nig.to_json()},
                ["estimator_id", "category", "model", "effort"],
            )
        config["arms"].append(list(arm))
        self.conn.execute("UPDATE estimators SET config_json = ? WHERE estimator_id = 1", (json.dumps(config),))
        self.conn.commit()
        return config, arm

    def test_partial_overflow_reports_nonfinite_draws_and_stays_scorable(self):
        config, arm = self._seed_with_overflow_arm(self._PARTIAL_OVERFLOW_NIG)
        _, _, posteriors = estimate.load_estimator(self.conn)
        rng = np.random.default_rng(0)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, rng)
        risky = next(a for a in result["arms"] if (a["model"], a["effort"]) == arm)
        self.assertGreater(risky["nonfinite_draws"], 0)
        self.assertIsNotNone(risky["p20_total_usd"])
        self.assertIsNotNone(risky["p50_total_usd"])
        self.assertIsNotNone(risky["p80_total_usd"])
        self.assertTrue(math.isfinite(risky["p20_total_usd"]))
        self.assertTrue(math.isfinite(risky["p50_total_usd"]))
        self.assertTrue(math.isfinite(risky["p80_total_usd"]))

    def test_all_overflow_arm_is_unscorable_with_reason(self):
        config, arm = self._seed_with_overflow_arm(self._ALL_OVERFLOW_NIG)
        _, _, posteriors = estimate.load_estimator(self.conn)
        rng = np.random.default_rng(0)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, rng)
        arm_pairs = {(a["model"], a["effort"]) for a in result["arms"]}
        self.assertNotIn(arm, arm_pairs)
        unscorable = next(u for u in result["unscorable_arms"] if (u["model"], u["effort"]) == arm)
        self.assertEqual(unscorable["reason"], "all_draws_nonfinite")
        self.assertEqual(unscorable["missing_categories"], [])  # not a coverage problem
        # CHEAP_ARM must still win -- one unscorable arm shouldn't break selection.
        self.assertEqual((result["selected"]["model"], result["selected"]["effort"]), CHEAP_ARM)

    def test_json_output_is_rfc_compliant_with_overflow_heavy_fixture(self):
        # allow_nan=False must not raise -- every field reaching main()'s
        # json.dumps has already been through a finite check.
        config, arm = self._seed_with_overflow_arm(self._PARTIAL_OVERFLOW_NIG)
        self.conn.commit()
        path = self.tmp_path / "decomp.json"
        path.write_text(json.dumps(_decomposition((("task-1", 3.0),))), encoding="utf-8")
        argv = ["--decomposition", str(path), "--db", str(self.db_path), "--estimator-id", "1", "--json"]
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = estimate.main(argv)
        self.assertEqual(rc, 0)
        raw = buf.getvalue()
        self.assertNotIn("Infinity", raw)
        self.assertNotIn("NaN", raw)
        # json.loads accepts Infinity/NaN by default (it's forgiving on
        # read), so the real assertion is that dumping with allow_nan=False
        # (main()'s own call) didn't need to raise -- confirmed by rc == 0
        # above; parse here just double-checks the output is otherwise
        # well-formed JSON.
        json.loads(raw)

    def test_thompson_total_null_and_finite_when_present(self):
        # A Thompson draw can itself overflow (single sample, no averaging
        # to smooth it out); such an arm's thompson_total_usd must be null,
        # not inf/nan, and must not crash selection.
        config, arm = self._seed_with_overflow_arm(self._ALL_OVERFLOW_NIG)
        mc_rng, thompson_rng = estimate._derive_rngs(0)
        _, _, posteriors = estimate.load_estimator(self.conn)
        result = estimate.score_task(
            config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, mc_rng,
            thompson_rng=thompson_rng, thompson=True,
        )
        # The all-overflow arm is unscorable at the MC-total level already
        # (finding 4's primary mechanism), so it never reaches the Thompson
        # pass at all -- confirms Thompson mode doesn't crash on it either.
        arm_pairs = {(a["model"], a["effort"]) for a in result["arms"]}
        self.assertNotIn(arm, arm_pairs)
        for a in result["arms"]:
            if a["thompson_total_usd"] is not None:
                self.assertTrue(math.isfinite(a["thompson_total_usd"]))
        self.assertIsNotNone(result["selected"])


class TestThompsonMode(EstimateTestCase):
    def test_thompson_mode_deterministic_and_selects_among_all_scorable_arms(self):
        config = _seed_estimator_db(self.conn)
        _, _, posteriors = estimate.load_estimator(self.conn)

        def _run():
            mc_rng, thompson_rng = estimate._derive_rngs(0)
            result = estimate.score_task(
                config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, mc_rng,
                thompson_rng=thompson_rng, thompson=True,
            )
            return result

        result_a = _run()
        result_b = _run()
        self.assertEqual(json.dumps(result_a, sort_keys=True), json.dumps(result_b, sort_keys=True))

        self.assertIsNotNone(result_a["selected"]["thompson_total_usd"])
        selected_pair = (result_a["selected"]["model"], result_a["selected"]["effort"])
        # No guard: the selected arm is whichever of CHEAP_ARM/SPARSE_ARM
        # drew the lower single Thompson sample at this seed (both are
        # eligible candidates -- there is no tail-risk exclusion of either).
        self.assertIn(selected_pair, (CHEAP_ARM, SPARSE_ARM))
        for arm in result_a["arms"]:
            self.assertIsNotNone(arm["thompson_total_usd"])

    def test_thompson_requires_thompson_rng(self):
        config = _seed_estimator_db(self.conn)
        _, _, posteriors = estimate.load_estimator(self.conn)
        with self.assertRaises(ValueError):
            estimate.score_task(
                config, posteriors, {f"C{i}": 3 for i in range(1, 8)},
                np.random.default_rng(0), thompson=True,
            )

    def test_p20_mode_leaves_thompson_total_null(self):
        config = _seed_estimator_db(self.conn)
        _, _, posteriors = estimate.load_estimator(self.conn)
        rng = np.random.default_rng(0)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, rng, thompson=False)
        for arm in result["arms"]:
            self.assertIsNone(arm["thompson_total_usd"])
        self.assertIsNone(result["selected"]["thompson_total_usd"])


class TestRngStreamSeparation(EstimateTestCase):
    """Fix round 1 (codex review, Important finding 1): MC and Thompson
    draws must come from independent rng streams, so a report's MC
    p20/p50/p80 totals are identical for a given seed whether or not
    --thompson was also requested -- otherwise Thompson's extra draws
    inside task 1 desynchronize task 2's (and later tasks') MC draws
    between the two modes."""

    def test_mc_totals_identical_with_and_without_thompson_multi_task(self):
        _seed_estimator_db(self.conn)
        decomposition = _decomposition((("task-1", 2.0), ("task-2", 4.0)))

        report_p20 = estimate.run(self.conn, decomposition, seed=0, thompson=False)
        report_thompson = estimate.run(self.conn, decomposition, seed=0, thompson=True)

        for task_p20, task_thompson in zip(report_p20["tasks"], report_thompson["tasks"]):
            arms_p20 = {(a["model"], a["effort"]): a for a in task_p20["arms"]}
            arms_thompson = {(a["model"], a["effort"]): a for a in task_thompson["arms"]}
            self.assertEqual(set(arms_p20), set(arms_thompson))
            for key, arm_p20 in arms_p20.items():
                arm_thompson = arms_thompson[key]
                self.assertEqual(arm_p20["p20_total_usd"], arm_thompson["p20_total_usd"])
                self.assertEqual(arm_p20["p50_total_usd"], arm_thompson["p50_total_usd"])
                self.assertEqual(arm_p20["p80_total_usd"], arm_thompson["p80_total_usd"])
                for category, diag_p20 in arm_p20["categories"].items():
                    self.assertEqual(diag_p20, arm_thompson["categories"][category])

        # Sanity: this isn't trivially true because nothing used the rng --
        # the Thompson-mode report really did draw extra (Thompson) samples
        # per arm, evidenced by non-null thompson_total_usd everywhere a
        # p20-mode report has null.
        for task_thompson in report_thompson["tasks"]:
            for arm in task_thompson["arms"]:
                self.assertIsNotNone(arm["thompson_total_usd"])

    def test_cli_mc_totals_identical_with_and_without_thompson_flag(self):
        _seed_estimator_db(self.conn)
        path = self.tmp_path / "decomp.json"
        path.write_text(json.dumps(_decomposition((("task-1", 2.0), ("task-2", 4.0)))), encoding="utf-8")

        def _capture(extra_args):
            argv = ["--decomposition", str(path), "--db", str(self.db_path), "--estimator-id", "1",
                    "--json", "--seed", "0"] + extra_args
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                estimate.main(argv)
            return json.loads(buf.getvalue())

        report_p20 = _capture([])
        report_thompson = _capture(["--thompson"])
        for task_p20, task_thompson in zip(report_p20["tasks"], report_thompson["tasks"]):
            arms_p20 = {(a["model"], a["effort"]): (a["p20_total_usd"], a["p50_total_usd"], a["p80_total_usd"])
                        for a in task_p20["arms"]}
            arms_thompson = {(a["model"], a["effort"]): (a["p20_total_usd"], a["p50_total_usd"], a["p80_total_usd"])
                              for a in task_thompson["arms"]}
            self.assertEqual(arms_p20, arms_thompson)


class TestPooledFallback(EstimateTestCase):
    """Follow-up 1, Part A: an arm missing a (category, arm) posterior falls
    back to that category's pooled posterior (model.POOLED_SENTINEL_ARM)
    instead of being excluded outright. Selection-affecting behavior
    (fallback-forces-explore) was removed in followup-2 -- fallback is now
    diagnostic-only (``fallback_categories``), consistent with the removal
    of the explore flag entirely."""

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
        rng = np.random.default_rng(0)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, rng)
        sparse = next(a for a in result["arms"] if (a["model"], a["effort"]) == SPARSE_ARM)
        self.assertEqual(sparse["missing_categories"], [])
        self.assertTrue(sparse["categories"]["review"]["fallback"])
        self.assertFalse(sparse["categories"]["green"]["fallback"])
        review_width = sparse["categories"]["review"]["p80_usd"] - sparse["categories"]["review"]["p20_usd"]
        green_width = sparse["categories"]["green"]["p80_usd"] - sparse["categories"]["green"]["p20_usd"]
        self.assertGreater(review_width, green_width)

    def test_fallback_categories_reported_per_arm_and_scorable(self):
        config = self._seed_with_missing_review_cell()
        _, _, posteriors = estimate.load_estimator(self.conn)
        rng = np.random.default_rng(0)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, rng)
        sparse = next(a for a in result["arms"] if (a["model"], a["effort"]) == SPARSE_ARM)
        self.assertEqual(sparse["fallback_categories"], ["review"])
        cheap = next(a for a in result["arms"] if (a["model"], a["effort"]) == CHEAP_ARM)
        self.assertEqual(cheap["fallback_categories"], [])
        self.assertEqual(result["unscorable_arms"], [])
        # SPARSE_ARM was scored (via fallback), not excluded -- it must be
        # eligible for ranking/selection, unlike the old full-coverage
        # exclusion rule this replaces.
        arm_pairs = {(a["model"], a["effort"]) for a in result["arms"]}
        self.assertEqual(arm_pairs, {CHEAP_ARM, SPARSE_ARM})

    def test_unscorable_only_when_pooled_fallback_also_missing(self):
        # A category with neither a per-arm posterior NOR a pooled fallback
        # (e.g. a brand-new category name not present at training time)
        # still makes an arm unscorable -- fallback isn't magic.
        config = self._seed_with_missing_review_cell()
        config["categories"] = ["green", "review", "phantom"]
        _, _, posteriors = estimate.load_estimator(self.conn)
        rng = np.random.default_rng(0)
        result = estimate.score_task(config, posteriors, {f"C{i}": 3 for i in range(1, 8)}, rng)
        unscorable_pairs = {(a["model"], a["effort"]) for a in result["unscorable_arms"]}
        self.assertEqual(unscorable_pairs, {CHEAP_ARM, SPARSE_ARM})
        for arm in result["unscorable_arms"]:
            self.assertEqual(arm["missing_categories"], ["phantom"])
        self.assertIsNone(result["selected"])


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
        self.assertEqual(report["seed"], estimate.DEFAULT_SEED)
        self.assertEqual(report["mc_draws"], estimate.DEFAULT_MC_DRAWS)
        self.assertEqual(report["selection_mode"], "p20")
        self.assertGreater(report["decomposition_totals"]["p50_total_usd"], 0.0)

    def test_run_honors_seed_and_mc_draws_arguments(self):
        _seed_estimator_db(self.conn)
        report = estimate.run(
            self.conn, _decomposition((("task-1", 3.0),)), seed=42, mc_draws=500
        )
        self.assertEqual(report["seed"], 42)
        self.assertEqual(report["mc_draws"], 500)

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

    def test_cli_different_seed_gives_different_json(self):
        _seed_estimator_db(self.conn)
        path = self._write_decomposition(".json")

        def _capture(seed):
            argv = ["--decomposition", str(path), "--db", str(self.db_path), "--estimator-id", "1",
                     "--json", "--seed", str(seed)]
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                estimate.main(argv)
            return buf.getvalue()

        self.assertNotEqual(_capture(0), _capture(1))

    def test_cli_thompson_flag_selects_and_reports_thompson_mode(self):
        _seed_estimator_db(self.conn)
        path = self._write_decomposition(".json")
        argv = ["--decomposition", str(path), "--db", str(self.db_path), "--estimator-id", "1",
                "--json", "--thompson"]
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = estimate.main(argv)
        self.assertEqual(rc, 0)
        report = json.loads(buf.getvalue())
        self.assertEqual(report["selection_mode"], "thompson")
        self.assertIsNotNone(report["decomposition_totals"]["thompson_total_usd"])
        for task in report["tasks"]:
            if task["selected"]:
                self.assertIsNotNone(task["selected"]["thompson_total_usd"])

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
            # SPARSE_ARM has the lower p20 in this fixture (no guard to
            # exclude it) -- see test_huge_p80_but_lowest_p20_arm_now_wins;
            # the point of this test is only the read-only-db plumbing.
            self.assertEqual((report["tasks"][0]["selected"]["model"], report["tasks"][0]["selected"]["effort"]), SPARSE_ARM)
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
