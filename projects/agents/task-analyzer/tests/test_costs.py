"""Tests for costs.py: deterministic derived-cost rebuild (design.md D5).

Builds a synthetic task directly at the DB layer (not through ingest's git/
transcript pipeline -- that's test_ingest.py's job) so review_round and
phase labels can be pinned exactly, and hand-computes the expected USD per
category against the model_prices rows schema.sql seeds by default
(claude-sonnet-5 / claude-opus-4-8 / claude-haiku-4-5, all effective
2026-07-01), so no extra price rows are needed for the base scenario.
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import costs  # noqa: E402
import db  # noqa: E402


CHANGE_NAME = "add-widget"
TASK_KEY = "task-1"

# schema.sql-seeded prices, effective 2026-07-01 (usd per million tokens):
#   claude-sonnet-5:  in=2.0  cached=0.2  out=10.0
#   claude-opus-4-8:  in=5.0  cached=0.5  out=25.0
#   claude-haiku-4-5: in=1.0  cached=0.1  out=5.0
SONNET = ("claude-sonnet-5", 2.0, 0.2, 10.0)
OPUS = ("claude-opus-4-8", 5.0, 0.5, 25.0)
HAIKU = ("claude-haiku-4-5", 1.0, 0.1, 5.0)


class CostsTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp(prefix="task-analyzer-costs-test-")
        self.tmp_path = Path(self._tmp)
        self.addCleanup(shutil.rmtree, self._tmp, ignore_errors=True)
        self.conn = db.connect(self.tmp_path / "t.sqlite")

    def _make_task(self, task_key=TASK_KEY, change_name=CHANGE_NAME):
        db.upsert(self.conn, "changes", {"name": change_name, "ingested_at": "2026-07-01T00:00:00Z"}, ["name"])
        change_id = self.conn.execute(
            "SELECT change_id FROM changes WHERE name = ?", (change_name,)
        ).fetchone()[0]
        db.upsert(
            self.conn, "tasks",
            {"change_id": change_id, "task_key": task_key, "brief_text": "brief"},
            ["change_id", "task_key"],
        )
        self.conn.commit()
        return self.conn.execute(
            "SELECT task_id FROM tasks WHERE change_id = ? AND task_key = ?",
            (change_id, task_key),
        ).fetchone()[0]

    def _make_session(self, session_id, task_id, role, model, input_tokens, cached_tokens,
                       output_tokens, review_round=0, started_at="2026-07-10T00:00:00Z",
                       ended_at="2026-07-10T00:05:00Z"):
        row = {
            "session_id": session_id, "task_id": task_id, "provider": "claude",
            "harness_entry": "main", "role": role, "model": model, "effort": "medium",
            "started_at": started_at, "ended_at": ended_at,
            "input_tokens": input_tokens, "cached_tokens": cached_tokens,
            "output_tokens": output_tokens, "reasoning_tokens": 0,
            "n_turns": 1, "n_tool_calls": 0, "review_round": review_round,
        }
        db.upsert(self.conn, "sessions", row, ["session_id"])
        self.conn.commit()

    def _make_phase_tokens(self, session_id, phase, output_tokens, taxonomy_version="1"):
        db.upsert(
            self.conn, "phase_tokens",
            {
                "session_id": session_id, "phase": phase, "output_tokens": output_tokens,
                "turns": 1, "taxonomy_version": taxonomy_version, "input_sha256": "x",
            },
            ["session_id", "phase", "taxonomy_version"],
        )
        self.conn.commit()

    def _task_costs(self, task_id):
        rows = self.conn.execute(
            "SELECT category, weighted_tokens, usd, price_version FROM task_costs "
            "WHERE task_id = ? ORDER BY category",
            (task_id,),
        ).fetchall()
        return {r["category"]: dict(r) for r in rows}


class TestRebuildCategories(CostsTestBase):
    """The brief's core scenario: one round-0 implementer session labeled
    red(60)/green(40) output tokens, one reviewer session, one round-2
    implementer session (a follow-up fix after 2 review rounds) -- assert
    exact hand-computed USD per category."""

    def setUp(self):
        super().setUp()
        self.task_id = self._make_task()

        # Round-0 implementer: claude-sonnet-5, in=1000 cached=200 out=100
        # (= red 60 + green 40). Full session USD:
        #   1000 * 2.0  = 2000     (input)
        #   200  * 0.2  =   40     (cached)
        #   100  * 10.0 = 1000     (output)
        #   total = 3040 "per-million" units -> /1e6 = 0.00304 USD
        self._make_session("claude:impl-1", self.task_id, "implementer", SONNET[0],
                            input_tokens=1000, cached_tokens=200, output_tokens=100, review_round=0)
        self._make_phase_tokens("claude:impl-1", "red", 60)
        self._make_phase_tokens("claude:impl-1", "green", 40)

        # Reviewer: claude-opus-4-8, in=2000 cached=500 out=300.
        #   2000 * 5.0  = 10000
        #   500  * 0.5  =   250
        #   300  * 25.0 =  7500
        #   total = 17750 -> /1e6 = 0.01775 USD
        self._make_session("claude:review-1", self.task_id, "reviewer", OPUS[0],
                            input_tokens=2000, cached_tokens=500, output_tokens=300, review_round=1,
                            started_at="2026-07-10T01:00:00Z", ended_at="2026-07-10T01:10:00Z")

        # Round-2 implementer (a follow-up fix, arbitrary round >= 1):
        # claude-haiku-4-5, in=500 cached=100 out=50.
        #   500 * 1.0 =  500
        #   100 * 0.1 =   10
        #   50  * 5.0 =  250
        #   total = 760 -> /1e6 = 0.00076 USD
        self._make_session("claude:impl-2", self.task_id, "implementer", HAIKU[0],
                            input_tokens=500, cached_tokens=100, output_tokens=50, review_round=2,
                            started_at="2026-07-10T02:00:00Z", ended_at="2026-07-10T02:05:00Z")

        self.n_written = costs.rebuild(self.conn, as_of="2026-07-19")

    def test_phase_categories_apportioned_by_output_token_share(self):
        table = self._task_costs(self.task_id)
        # session usd 0.00304, red share 60/100=0.6, green share 40/100=0.4
        self.assertAlmostEqual(table["red"]["usd"], 0.00304 * 0.6, places=10)
        self.assertAlmostEqual(table["green"]["usd"], 0.00304 * 0.4, places=10)
        self.assertEqual(table["red"]["weighted_tokens"], 60)
        self.assertEqual(table["green"]["weighted_tokens"], 40)
        self.assertEqual(table["red"]["price_version"], "2026-07-01")
        self.assertEqual(table["green"]["price_version"], "2026-07-01")

    def test_review_category(self):
        table = self._task_costs(self.task_id)
        self.assertAlmostEqual(table["review"]["usd"], 0.01775, places=10)
        self.assertEqual(table["review"]["weighted_tokens"], 300)
        self.assertEqual(table["review"]["price_version"], "2026-07-01")

    def test_followup_fix_category(self):
        table = self._task_costs(self.task_id)
        self.assertAlmostEqual(table["followup_fix"]["usd"], 0.00076, places=10)
        self.assertEqual(table["followup_fix"]["weighted_tokens"], 50)

    def test_no_unlabeled_category_when_all_round0_sessions_labeled(self):
        table = self._task_costs(self.task_id)
        self.assertNotIn("unlabeled", table)

    def test_task_arms_records_canonical_implementer(self):
        row = self.conn.execute(
            "SELECT model, effort, basis_json FROM task_arms WHERE task_id = ?", (self.task_id,)
        ).fetchone()
        self.assertIsNotNone(row)
        # The only round-0 implementer session is impl-1 -> claude-sonnet-5.
        self.assertEqual(row["model"], "claude-sonnet-5")
        basis = json.loads(row["basis_json"])
        self.assertEqual(basis["session_id"], "claude:impl-1")

    def test_rows_written_count(self):
        # 4 task_costs rows (red, green, review, followup_fix) + 1 task_arms row.
        self.assertEqual(self.n_written, 5)

    def test_rebuild_is_idempotent(self):
        before = self._task_costs(self.task_id)
        n2 = costs.rebuild(self.conn, as_of="2026-07-19")
        after = self._task_costs(self.task_id)
        self.assertEqual(before, after)
        self.assertEqual(n2, self.n_written)
        # No duplicate rows accumulated across two rebuilds.
        count = self.conn.execute(
            "SELECT COUNT(*) FROM task_costs WHERE task_id = ?", (self.task_id,)
        ).fetchone()[0]
        self.assertEqual(count, 4)


class TestUnlabeledCategory(CostsTestBase):
    def test_round0_session_without_phase_labels_funds_unlabeled(self):
        task_id = self._make_task()
        self._make_session("claude:impl-1", task_id, "implementer", SONNET[0],
                            input_tokens=1000, cached_tokens=0, output_tokens=100, review_round=0)
        # No phase_tokens rows at all for this session.
        costs.rebuild(self.conn, as_of="2026-07-19")
        table = self._task_costs(task_id)
        self.assertIn("unlabeled", table)
        self.assertNotIn("red", table)
        # usd = (1000*2.0 + 0*0.2 + 100*10.0) / 1e6 = 3000/1e6 = 0.003
        self.assertAlmostEqual(table["unlabeled"]["usd"], 0.003, places=10)
        self.assertEqual(table["unlabeled"]["weighted_tokens"], 100)

    def test_partially_labeled_session_puts_residual_share_in_unlabeled(self):
        # Review fix: apportionment must divide by the session's own
        # output_tokens, not the sum of its phase-label rows -- a session
        # can be only partially labeled (some turns never phase-labeled).
        # Here labels cover only 60+40=100 of a 150-output-token session;
        # the other 50 tokens' worth of cost must land in `unlabeled`, not
        # be silently folded into red/green (which would over-allocate
        # them and under-count the session's true total cost).
        task_id = self._make_task()
        self._make_session("claude:impl-1", task_id, "implementer", SONNET[0],
                            input_tokens=1000, cached_tokens=0, output_tokens=150, review_round=0)
        self._make_phase_tokens("claude:impl-1", "red", 60)
        self._make_phase_tokens("claude:impl-1", "green", 40)
        # labeled_tokens = 60 + 40 = 100; residual = 150 - 100 = 50.

        # Full session usd = (1000*2.0 + 0*0.2 + 150*10.0) / 1e6
        #                   = (2000 + 0 + 1500) / 1e6 = 3500/1e6 = 0.0035
        session_usd = 0.0035

        costs.rebuild(self.conn, as_of="2026-07-19")
        table = self._task_costs(task_id)

        # Denominator is the session's output_tokens (150), not the labeled
        # sum (100): red share = 60/150 = 0.4, green share = 40/150.
        self.assertAlmostEqual(table["red"]["usd"], session_usd * (60 / 150), places=10)
        self.assertAlmostEqual(table["green"]["usd"], session_usd * (40 / 150), places=10)
        self.assertEqual(table["red"]["weighted_tokens"], 60)
        self.assertEqual(table["green"]["weighted_tokens"], 40)

        # Residual (50/150 share) funds `unlabeled`.
        self.assertIn("unlabeled", table)
        self.assertAlmostEqual(table["unlabeled"]["usd"], session_usd * (50 / 150), places=10)
        self.assertEqual(table["unlabeled"]["weighted_tokens"], 50)

        # Category totals must sum back to the full session usd -- no cost
        # is lost or double-counted across the split.
        total = table["red"]["usd"] + table["green"]["usd"] + table["unlabeled"]["usd"]
        self.assertAlmostEqual(total, session_usd, places=10)


class TestFixerRoleAlwaysFollowupFix(CostsTestBase):
    def test_fixer_session_at_round_0_still_funds_followup_fix(self):
        # Per the task brief's explicit rule ("fixer + implementer sessions
        # with review_round >= 1 -> followup_fix"): a fixer session funds
        # followup_fix regardless of its review_round, unlike implementer
        # sessions which only do so at round >= 1.
        task_id = self._make_task()
        self._make_session("claude:fix-1", task_id, "fixer", HAIKU[0],
                            input_tokens=100, cached_tokens=0, output_tokens=10, review_round=0)
        costs.rebuild(self.conn, as_of="2026-07-19")
        table = self._task_costs(task_id)
        self.assertIn("followup_fix", table)
        self.assertNotIn("unlabeled", table)


class TestAuditorFundsReview(CostsTestBase):
    def test_auditor_session_funds_review_category(self):
        task_id = self._make_task()
        self._make_session("claude:audit-1", task_id, "auditor", OPUS[0],
                            input_tokens=100, cached_tokens=0, output_tokens=10, review_round=1)
        costs.rebuild(self.conn, as_of="2026-07-19")
        table = self._task_costs(task_id)
        self.assertIn("review", table)


class TestQuarantinedSessionFundsNothing(CostsTestBase):
    def test_session_with_null_task_id_is_never_visited(self):
        # A quarantined session has task_id NULL in the sessions table.
        self._make_task()  # unrelated task so the DB isn't totally empty
        db.upsert(
            self.conn, "sessions",
            {
                "session_id": "claude:quarantined-1", "task_id": None, "provider": "claude",
                "role": "implementer", "model": SONNET[0], "input_tokens": 999999,
                "cached_tokens": 0, "output_tokens": 999999, "review_round": 0,
            },
            ["session_id"],
        )
        self.conn.commit()
        costs.rebuild(self.conn, as_of="2026-07-19")
        total_usd = self.conn.execute("SELECT COALESCE(SUM(usd), 0) FROM task_costs").fetchone()[0]
        self.assertEqual(total_usd, 0)  # only the unrelated task existed, and it has no sessions


class TestUncostableModelSkipped(CostsTestBase):
    def test_session_with_no_matching_price_row_funds_nothing(self):
        task_id = self._make_task()
        self._make_session("claude:impl-1", task_id, "implementer", "unknown-model-xyz",
                            input_tokens=1000, cached_tokens=0, output_tokens=100, review_round=0)
        n = costs.rebuild(self.conn, as_of="2026-07-19")
        table = self._task_costs(task_id)
        self.assertEqual(table, {})
        # Still writes the task_arms row (canonical arm is a token-count
        # selection, independent of pricing).
        arm = self.conn.execute("SELECT model FROM task_arms WHERE task_id = ?", (task_id,)).fetchone()
        self.assertEqual(arm["model"], "unknown-model-xyz")
        self.assertEqual(n, 1)


class TestPriceUpdateRecomputesCostsOnly(CostsTestBase):
    """Price-update scenario from the task brief + the data-gathering spec's
    scenario "Price update recomputes derived costs only": inserting a newer
    model_prices row and re-running rebuild changes usd/price_version, and
    touches no agentic table (row count + content hash of `complexity`
    unchanged)."""

    def setUp(self):
        super().setUp()
        self.task_id = self._make_task()
        self._make_session("claude:impl-1", self.task_id, "implementer", SONNET[0],
                            input_tokens=1000, cached_tokens=0, output_tokens=0, review_round=0)
        # Seed an agentic-table row (complexity) to prove rebuild never
        # touches it.
        db.upsert(
            self.conn, "complexity",
            {
                "task_id": self.task_id, "c1": 1, "c2": 1, "c3": 1, "c4": 1, "c5": 1, "c6": 1, "c7": 1,
                "composite": 1.0, "rationale_json": "{}", "rubric_version": "1",
                "input_sha256": "abc123", "scored_by": "test",
            },
            ["task_id", "rubric_version"],
        )
        self.conn.commit()

    def _complexity_snapshot(self):
        rows = self.conn.execute("SELECT * FROM complexity ORDER BY task_id, rubric_version").fetchall()
        return [dict(r) for r in rows]

    def _table_counts(self):
        tables = ["changes", "tasks", "sessions", "complexity", "grades", "phase_tokens", "model_prices"]
        return {t: self.conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}

    def test_new_price_row_changes_usd_and_price_version(self):
        costs.rebuild(self.conn, as_of="2026-07-19")
        before = self._task_costs(self.task_id)["unlabeled"]
        self.assertEqual(before["price_version"], "2026-07-01")
        # usd = 1000 * 2.0 / 1e6 = 0.002
        self.assertAlmostEqual(before["usd"], 0.002, places=10)

        counts_before = self._table_counts()
        complexity_before = self._complexity_snapshot()

        # A newer price row for the same model, effective before "today".
        db.upsert(
            self.conn, "model_prices",
            {
                "model": "claude-sonnet-5", "effective_date": "2026-07-15",
                "usd_per_m_input": 4.0, "usd_per_m_cached": 0.4, "usd_per_m_output": 20.0,
            },
            ["model", "effective_date"],
        )
        self.conn.commit()

        costs.rebuild(self.conn, as_of="2026-07-19")
        after = self._task_costs(self.task_id)["unlabeled"]
        self.assertEqual(after["price_version"], "2026-07-15")
        # usd = 1000 * 4.0 / 1e6 = 0.004
        self.assertAlmostEqual(after["usd"], 0.004, places=10)
        self.assertNotEqual(before["usd"], after["usd"])

        # Agentic table untouched: same row count and same content.
        counts_after = self._table_counts()
        counts_after["model_prices"] -= 1  # we deliberately added one price row
        self.assertEqual(counts_before, counts_after)
        self.assertEqual(complexity_before, self._complexity_snapshot())


if __name__ == "__main__":
    unittest.main()
