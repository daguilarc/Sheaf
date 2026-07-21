"""Tests for the idempotent ingest driver (ingest.py).

Builds a throwaway git repo fixture (mirroring test_discovery.py's pattern)
under tmp_path with one landed change (``add-widget``), its SDD task brief
(``.superpowers/sdd/add-widget/task-1-brief.md``), and hand-written claude
transcript fixtures (an implementer session + a reviewer session) under a
separate fake "sessions corpus" directory, pointed at via the
``claude_projects_root``/``codex_sessions_root`` kwargs so the real
``~/.claude/projects`` on this machine is never touched.

``fake_agent_runner`` is a zero-LLM stand-in for Task 7's real
``agents.xagent_runner``: it just writes canned, schema-valid JSON straight
into the staging dir per the ``kind``/``entity_key``/``version``/
``input_sha256`` cache key ingest.py passes it, and records every call it
receives so tests can assert dispatch counts/idempotency directly.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import assets  # noqa: E402
import db  # noqa: E402
import ingest  # noqa: E402


def _run_git(repo, *args):
    subprocess.run(["git", "-C", str(repo)] + list(args), check=True, capture_output=True, text=True)


CHANGE_NAME = "add-widget"
TASK_KEY = "task-1"

IMPLEMENTER_PROMPT = (
    "Read your task brief at .superpowers/sdd/add-widget/task-1-brief.md and implement it."
)
REVIEWER_PROMPT = (
    "You are a READ-ONLY task reviewer. Read the brief at "
    ".superpowers/sdd/add-widget/task-1-brief.md and review the implementation "
    "for spec compliance. Do not edit any files."
)


def _make_repo(root: Path):
    """A git repo with one landed change (``add-widget``) on branch `main`,
    plus its SDD task brief under .superpowers/sdd/."""
    repo = root / "repo"
    repo.mkdir()
    _run_git(repo, "init", "-q")
    _run_git(repo, "checkout", "-q", "-b", "main")
    _run_git(repo, "config", "user.email", "test@example.com")
    _run_git(repo, "config", "user.name", "Test")

    archive = repo / "openspec" / "changes" / "archive" / "2026-07-10-add-widget"
    archive.mkdir(parents=True)
    (archive / "proposal.md").write_text("proposal\n")

    sdd = repo / ".superpowers" / "sdd" / CHANGE_NAME
    sdd.mkdir(parents=True)
    (sdd / f"{TASK_KEY}-brief.md").write_text("Implement the widget core module.\n")
    # A sibling review-brief file must NOT be mistaken for a task brief.
    (sdd / f"{TASK_KEY}-review-brief.md").write_text("Review guidance.\n")

    _run_git(repo, "add", "-A")
    _run_git(repo, "commit", "-q", "-m", "seed")
    return repo


def _write_claude_session(path: Path, session_id: str, prompt: str, last_message: str,
                           ts_start: str = "2026-07-10T00:00:00Z", ts_end: str = "2026-07-10T00:05:00Z"):
    lines = [
        json.dumps({
            "type": "user", "message": {"role": "user", "content": prompt},
            "sessionId": session_id, "timestamp": ts_start,
        }),
        json.dumps({
            "type": "assistant",
            "message": {
                "model": "claude-sonnet-5", "role": "assistant",
                "content": [{"type": "text", "text": last_message}],
                "usage": {"input_tokens": 100, "cache_read_input_tokens": 10,
                          "cache_creation_input_tokens": 0, "output_tokens": 50},
            },
            "sessionId": session_id, "timestamp": ts_end,
        }),
    ]
    path.write_text("\n".join(lines) + "\n")


def _make_sessions(root: Path):
    """One implementer session + one reviewer session, both referencing the
    add-widget/task-1 brief path (so they join unambiguously)."""
    claude_root = root / "claude_projects" / "proj"
    claude_root.mkdir(parents=True)
    _write_claude_session(
        claude_root / "impl-session.jsonl", "impl-1", IMPLEMENTER_PROMPT,
        "Implemented the widget core.",
        ts_start="2026-07-10T00:00:00Z", ts_end="2026-07-10T00:05:00Z",
    )
    _write_claude_session(
        claude_root / "review-session.jsonl", "review-1", REVIEWER_PROMPT,
        "PASS: looks correct, no issues found.",
        ts_start="2026-07-10T01:00:00Z", ts_end="2026-07-10T01:10:00Z",
    )
    return claude_root.parent


class FakeAgentRunner:
    """Writes canned, schema-valid staged JSON for every item it's handed.
    Records every call (kind, [item keys]) for idempotency assertions.
    ``fail_on_call`` (1-based) makes the runner stage its first item's file
    then raise, simulating a crash mid-dispatch."""

    def __init__(self, fail_on_call=None):
        self.calls = []
        self.fail_on_call = fail_on_call
        self._n = 0

    def __call__(self, kind, items, staging_dir):
        self._n += 1
        self.calls.append((kind, [dict(i) for i in items]))
        written = []
        for item in items:
            data = self._canned(kind, item)
            entity_key = item.get("task_key") or item.get("session_key")
            fname = ingest._staging_filename(entity_key, item["version"], item["input_sha256"])
            out_dir = Path(staging_dir) / kind
            out_dir.mkdir(parents=True, exist_ok=True)
            tmp = out_dir / (fname + ".tmp")
            tmp.write_text(json.dumps(data), encoding="utf-8")
            final = out_dir / fname
            os.replace(tmp, final)
            written.append(final)
            if self.fail_on_call == self._n:
                raise RuntimeError("simulated crash after staging one file")
        return written

    def _canned(self, kind, item):
        if kind == "complexity":
            return {
                "task_key": item["task_key"],
                "C1": 2, "C2": 2, "C3": 2, "C4": 2, "C5": 2, "C6": 2, "C7": 1,
                "composite": 2.0,
                "rationale": {k: "n/a" for k in ("C1", "C2", "C3", "C4", "C5", "C6", "C7")},
            }
        if kind == "grading":
            return {
                "task_key": item["task_key"],
                "G1": 5, "G2": 5, "G3": 5, "G4": 5, "G5": 5,
                "n_critical": 0, "n_important": 0, "n_minor": 0,
                "verdict_sequence": "PASS", "rounds_to_accept": 1,
                "final_grade": "A", "evidence": "clean review",
                "reviewer_models": ["claude-sonnet-5"], "excluded_reviews": [],
            }
        # phase_labeling
        return {"session_key": item["session_key"], "labels": {"1": "green"}}


class IngestTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.repo = _make_repo(self.root)
        self.claude_root = _make_sessions(self.root)
        self.staging_dir = self.root / "staging"
        self.db_path = self.root / "t.sqlite"

    def _conn(self):
        return db.connect(self.db_path)

    def _run(self, conn, agent_runner=None, **kwargs):
        return ingest.run(
            conn, self.repo,
            agent_runner=agent_runner,
            staging_dir=self.staging_dir,
            codex_sessions_root=self.root / "no-codex-here",
            claude_projects_root=self.claude_root,
            **kwargs,
        )

    def _plan(self, conn, **kwargs):
        return ingest.plan_work(
            conn, self.repo,
            staging_dir=self.staging_dir,
            codex_sessions_root=self.root / "no-codex-here",
            claude_projects_root=self.claude_root,
            **kwargs,
        )


class TestIdempotency(IngestTestBase):
    def test_fresh_run_writes_rows_then_second_run_is_a_no_op(self):
        conn = self._conn()
        fake = FakeAgentRunner()

        report1 = self._run(conn, agent_runner=fake)

        self.assertEqual(report1.changes_written, 1)
        self.assertEqual(report1.tasks_written, 1)
        self.assertEqual(report1.sessions_written, 2)
        self.assertEqual(report1.rows_written.get("complexity"), 1)
        self.assertEqual(report1.rows_written.get("grading"), 1)
        self.assertEqual(report1.rows_written.get("phase_labeling"), 1)
        self.assertEqual(len(fake.calls), 3)  # complexity, grading, phase_labeling

        self.assertEqual(conn.execute("SELECT COUNT(*) FROM changes").fetchone()[0], 1)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0], 1)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 2)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM complexity").fetchone()[0], 1)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM grades").fetchone()[0], 1)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM phase_tokens").fetchone()[0], 1)
        # brief_text and review_text archived verbatim.
        brief_text = conn.execute("SELECT brief_text FROM tasks").fetchone()[0]
        self.assertIn("widget core module", brief_text)
        review_text = conn.execute("SELECT review_text FROM grades").fetchone()[0]
        self.assertIn("PASS", review_text)

        # Second run: nothing new, fake runner not invoked again.
        report2 = self._run(conn, agent_runner=fake)
        self.assertEqual(report2.total_writes, 0)
        self.assertEqual(report2.rows_written, {})
        self.assertEqual(report2.dispatched, {})
        self.assertEqual(len(fake.calls), 3)  # unchanged from run 1

        # ingest_log still gets a row every real run (audit trail).
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM ingest_log").fetchone()[0], 2)


class TestDryRun(IngestTestBase):
    def test_dry_run_leaves_db_byte_identical_and_plan_nonempty(self):
        conn = self._conn()
        conn.close()
        before = self.db_path.read_bytes()

        conn = self._conn()
        report = self._run(conn, agent_runner=FakeAgentRunner(), dry_run=True)
        conn.close()
        after = self.db_path.read_bytes()

        self.assertEqual(before, after)
        self.assertTrue(report.dry_run)
        self.assertFalse(report.plan.is_empty())
        self.assertIn(f"{CHANGE_NAME}/{TASK_KEY}", report.plan.new_tasks)
        self.assertEqual(len(report.plan.missing_complexity), 1)
        self.assertEqual(len(report.plan.missing_grades), 1)
        self.assertEqual(len(report.plan.missing_phase_labels), 1)


class TestNoAgents(IngestTestBase):
    def test_no_agents_writes_mechanical_rows_only(self):
        conn = self._conn()
        fake = FakeAgentRunner()

        report = self._run(conn, agent_runner=fake, no_agents=True)

        self.assertEqual(report.tasks_written, 1)
        self.assertEqual(report.sessions_written, 2)
        self.assertEqual(report.rows_written, {})
        self.assertEqual(len(fake.calls), 0)  # never invoked

        self.assertEqual(conn.execute("SELECT COUNT(*) FROM complexity").fetchone()[0], 0)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM grades").fetchone()[0], 0)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM phase_tokens").fetchone()[0], 0)

        # Gaps are still visible in the report's plan, just not dispatched.
        self.assertEqual(len(report.plan.missing_complexity), 1)
        self.assertEqual(len(report.plan.missing_grades), 1)
        self.assertEqual(len(report.plan.missing_phase_labels), 1)


class TestCrashResume(IngestTestBase):
    def test_crash_after_staging_resumes_without_reinvoking(self):
        conn = self._conn()
        fake = FakeAgentRunner(fail_on_call=1)

        with self.assertRaises(RuntimeError):
            self._run(conn, agent_runner=fake)

        # The crash rolled back the whole task's transaction.
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0], 0)
        self.assertEqual(len(fake.calls), 1)

        # But its staged output survived the crash on disk.
        staged = list((self.staging_dir / "complexity").glob("*.json"))
        self.assertEqual(len(staged), 1)

        # Re-run completes, using the staged file for complexity without
        # re-invoking the runner for that key; the runner IS invoked again
        # for grading/phase_labeling (never attempted before the crash).
        report2 = self._run(conn, agent_runner=fake)

        self.assertEqual(report2.rows_written.get("complexity"), 1)
        self.assertEqual(report2.staged_used.get("complexity"), 1)
        self.assertNotIn("complexity", report2.dispatched)
        self.assertEqual(len(fake.calls), 1 + 2)  # +grading, +phase_labeling only

        self.assertEqual(conn.execute("SELECT COUNT(*) FROM complexity").fetchone()[0], 1)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM grades").fetchone()[0], 1)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM phase_tokens").fetchone()[0], 1)


class TestRescore(IngestTestBase):
    def test_rubric_bump_reported_stale_then_rescored_with_flag(self):
        conn = self._conn()
        fake = FakeAgentRunner()
        self._run(conn, agent_runner=fake)
        self.assertEqual(len(fake.calls), 3)

        real_version = assets.read_asset_version
        complexity_path = str(ingest.KIND_RUBRIC_PATH["complexity"])

        def bumped_version(path):
            if str(path) == complexity_path:
                return "2"
            return real_version(path)

        original = assets.read_asset_version
        assets.read_asset_version = bumped_version
        try:
            # Without --rescore: untouched, reported stale.
            report_no_rescore = self._run(conn, agent_runner=fake)
            self.assertEqual(report_no_rescore.stale.get("complexity"), 1)
            self.assertNotIn("complexity", report_no_rescore.dispatched)
            self.assertEqual(len(fake.calls), 3)  # not invoked again
            rows = conn.execute("SELECT rubric_version FROM complexity").fetchall()
            self.assertEqual([r[0] for r in rows], ["1"])  # v1 retained, untouched

            # With --rescore complexity: re-dispatched, new version row added
            # alongside the retained v1 row.
            report_rescore = self._run(conn, agent_runner=fake, rescore="complexity")
            self.assertEqual(report_rescore.rows_written.get("complexity"), 1)
            self.assertEqual(report_rescore.dispatched.get("complexity"), 1)
            self.assertEqual(len(fake.calls), 4)

            rows = conn.execute(
                "SELECT rubric_version FROM complexity ORDER BY rubric_version"
            ).fetchall()
            self.assertEqual([r[0] for r in rows], ["1", "2"])
        finally:
            assets.read_asset_version = original


class TestQuarantine(IngestTestBase):
    """Beyond the five required scenarios: a session whose task key ("task-1")
    matches more than one landed change's brief (no change_dir/openspec_change
    in its prompt to disambiguate) must be quarantined -- stored as a
    `sessions` row with task_id NULL, never guessed onto either task."""

    def setUp(self):
        super().setUp()
        # A second landed change, also with a task-1 brief.
        sdd2 = self.repo / ".superpowers" / "sdd" / "add-gadget"
        sdd2.mkdir(parents=True)
        (sdd2 / "task-1-brief.md").write_text("Implement the gadget core module.\n")
        archive2 = self.repo / "openspec" / "changes" / "archive" / "2026-07-11-add-gadget"
        archive2.mkdir(parents=True)
        (archive2 / "proposal.md").write_text("proposal\n")
        _run_git(self.repo, "add", "-A")
        _run_git(self.repo, "commit", "-q", "-m", "add second change")

        _write_claude_session(
            self.claude_root / "ambiguous-session.jsonl", "ambiguous-1",
            "Continue implementing task 1 as directed.",
            "Made progress.",
        )

    def test_ambiguous_task_key_is_quarantined_not_guessed(self):
        conn = self._conn()
        plan = self._plan(conn)
        self.assertEqual(len(plan.quarantined), 1)
        q = plan.quarantined[0]
        self.assertEqual(q.session_id, "claude:ambiguous-1")
        self.assertIn("add-widget/task-1", q.candidates)
        self.assertIn("add-gadget/task-1", q.candidates)

        report = self._run(conn, agent_runner=FakeAgentRunner())
        row = conn.execute(
            "SELECT task_id FROM sessions WHERE session_id = ?", ("claude:ambiguous-1",)
        ).fetchone()
        self.assertIsNotNone(row)
        self.assertIsNone(row[0])
        self.assertEqual(len(report.quarantined), 1)


if __name__ == "__main__":
    unittest.main()
