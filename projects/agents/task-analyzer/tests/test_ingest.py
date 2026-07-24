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
import contextlib
import io
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
import costs  # noqa: E402
import db  # noqa: E402
import extractors  # noqa: E402
import ingest  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


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

        dump_path = self.db_path.parent / (self.db_path.stem + ".dump.jsonl")
        dump_after_run1 = dump_path.read_bytes()

        # Second run: nothing new, fake runner not invoked again.
        report2 = self._run(conn, agent_runner=fake)
        self.assertEqual(report2.total_writes, 0)
        self.assertEqual(report2.rows_written, {})
        self.assertEqual(report2.dispatched, {})
        self.assertEqual(len(fake.calls), 3)  # unchanged from run 1

        # A true no-op run does NOT append to ingest_log (it would otherwise
        # bloat the audit trail on every repeated no-op run); still exactly
        # the 1 row from run 1's real work.
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM ingest_log").fetchone()[0], 1)

        # And the JSONL dump -- which excludes ingest_log entirely -- is
        # byte-identical across the no-op re-run.
        self.assertEqual(dump_path.read_bytes(), dump_after_run1)


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


class TestLandedOnlyBriefs(IngestTestBase):
    """Review finding 1: brief content (and existence) must come from the
    resolved archive-ref git tree, never the working tree filesystem --
    otherwise `--dry-run`/`plan_work` could report work driven by
    uncommitted edits, violating D3's "discovery is a pure diff against a
    landed git ref" rule."""

    def test_brief_added_only_to_working_tree_is_not_ingested(self):
        # A second task brief written to disk but never `git add`/committed.
        sdd = self.repo / ".superpowers" / "sdd" / CHANGE_NAME
        (sdd / "task-2-brief.md").write_text("Uncommitted, working-tree-only brief.\n")

        conn = self._conn()
        plan = self._plan(conn)
        self.assertNotIn(f"{CHANGE_NAME}/task-2", plan.new_tasks)

        report = self._run(conn, agent_runner=FakeAgentRunner())
        self.assertEqual(report.tasks_written, 1)  # only the committed task-1
        rows = conn.execute("SELECT task_key FROM tasks").fetchall()
        self.assertEqual([r[0] for r in rows], [TASK_KEY])

    def test_brief_content_read_from_committed_ref_not_working_tree_edit(self):
        # Edit the already-committed brief on disk without committing the
        # edit -- the working-tree version must never be read.
        brief_path = self.repo / ".superpowers" / "sdd" / CHANGE_NAME / f"{TASK_KEY}-brief.md"
        brief_path.write_text("UNCOMMITTED EDIT should never be seen.\n")

        conn = self._conn()
        self._run(conn, agent_runner=FakeAgentRunner())
        brief_text = conn.execute("SELECT brief_text FROM tasks").fetchone()[0]
        self.assertIn("widget core module", brief_text)
        self.assertNotIn("UNCOMMITTED EDIT", brief_text)


class TestArchiveRefRecorded(IngestTestBase):
    """Review finding 3: the resolved archive ref name (not just its SHA)
    must be recoverable from ingest_log for audit purposes."""

    def test_archive_ref_recorded_in_ingest_log_actions(self):
        conn = self._conn()
        self._run(conn, agent_runner=FakeAgentRunner(), archive_ref="refs/heads/main")
        row = conn.execute("SELECT git_sha, actions_json FROM ingest_log").fetchone()
        self.assertIsNotNone(row)
        actions = json.loads(row[1])
        self.assertEqual(actions["archive_ref"], "refs/heads/main")
        self.assertTrue(row[0])  # git_sha (resolved commit) also present


class TestNumericVersionOrdering(unittest.TestCase):
    """Review finding 4: version strings are compared numerically (design.md:
    "the row with the numerically greatest version"), never lexicographically
    -- "10" < "2" as strings but 10 > 2 as versions."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "t.sqlite"

    def test_stale_versions_sorted_numerically_not_lexicographically(self):
        conn = db.connect(self.db_path)
        db.upsert(conn, "changes", {"name": "x", "ingested_at": "t0"}, ["name"])
        change_id = conn.execute("SELECT change_id FROM changes WHERE name = 'x'").fetchone()[0]
        db.upsert(
            conn, "tasks",
            {"change_id": change_id, "task_key": "task-1", "brief_text": "b"},
            ["change_id", "task_key"],
        )
        task_id = conn.execute("SELECT task_id FROM tasks").fetchone()[0]

        db.upsert(
            conn, "complexity",
            {"task_id": task_id, "rubric_version": "2", "input_sha256": "aaa"},
            ["task_id", "rubric_version"],
        )
        db.upsert(
            conn, "complexity",
            {"task_id": task_id, "rubric_version": "10", "input_sha256": "bbb"},
            ["task_id", "rubric_version"],
        )
        conn.commit()

        # Current version "11": both "2" and "10" are stale -- and must be
        # reported in numeric ascending order, not string order (which would
        # put "10" before "2").
        current_hash, stale = ingest._current_and_stale(
            conn, "complexity", "rubric_version", "task_id", task_id, "11"
        )
        self.assertIsNone(current_hash)
        self.assertEqual(stale, ["2", "10"])

        # Exact-match resolution also must not be fooled by digit count.
        current_hash2, stale2 = ingest._current_and_stale(
            conn, "complexity", "rubric_version", "task_id", task_id, "10"
        )
        self.assertEqual(current_hash2, "bbb")
        self.assertEqual(stale2, ["2"])


class TestTurnPersistence(IngestTestBase):
    """design.md D5 amendment (followup-4): a live `run()` must populate
    ``session_turns`` (and, for phase-labeled round-0 implementers,
    ``turn_phases``) for every session it writes, alongside the existing
    ``sessions`` row -- not just at some later ``backfill-turns`` step. The
    fixture sessions each hand-write exactly one assistant message, so each
    produces exactly one turn (extractors.py: claude turns split per
    assistant API message)."""

    def test_session_turns_populated_at_ingest_time(self):
        conn = self._conn()
        self._run(conn, agent_runner=FakeAgentRunner())

        impl_turns = conn.execute(
            "SELECT turn_idx, started_at, ended_at, output_tokens FROM session_turns "
            "WHERE session_id = ? ORDER BY turn_idx",
            ("claude:impl-1",),
        ).fetchall()
        self.assertEqual(len(impl_turns), 1)
        self.assertEqual(impl_turns[0]["turn_idx"], 1)
        self.assertEqual(impl_turns[0]["started_at"], "2026-07-10T00:05:00Z")
        self.assertEqual(impl_turns[0]["ended_at"], "2026-07-10T00:05:00Z")
        self.assertEqual(impl_turns[0]["output_tokens"], 50)

        review_turns = conn.execute(
            "SELECT turn_idx, started_at, output_tokens FROM session_turns "
            "WHERE session_id = ? ORDER BY turn_idx",
            ("claude:review-1",),
        ).fetchall()
        self.assertEqual(len(review_turns), 1)
        self.assertEqual(review_turns[0]["started_at"], "2026-07-10T01:10:00Z")

    def test_verdict_boundaries_json_persisted_on_sessions(self):
        # Neither fixture session's message matches the SPEC:/QUALITY:
        # verdict regex, so both sessions must persist an empty (not NULL)
        # boundaries list -- the documented no-verdict-data fallback.
        conn = self._conn()
        self._run(conn, agent_runner=FakeAgentRunner())
        for session_id in ("claude:impl-1", "claude:review-1"):
            vb_json = conn.execute(
                "SELECT verdict_boundaries_json FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()[0]
            self.assertEqual(json.loads(vb_json), [])

    def test_turn_phases_matches_phase_tokens_aggregation(self):
        # Integrity invariant (design.md D2/D5 amendment): turn_phases,
        # aggregated by (phase, taxonomy_version) with session_turns'
        # output_tokens, must equal phase_tokens exactly for any session
        # with turn-level data.
        conn = self._conn()
        self._run(conn, agent_runner=FakeAgentRunner())  # cans "green" for turn 1

        phase_tokens_row = conn.execute(
            "SELECT phase, output_tokens, taxonomy_version FROM phase_tokens "
            "WHERE session_id = ?",
            ("claude:impl-1",),
        ).fetchone()
        self.assertIsNotNone(phase_tokens_row)

        turn_phase_rows = conn.execute(
            "SELECT tp.phase, st.output_tokens FROM turn_phases tp "
            "JOIN session_turns st ON st.session_id = tp.session_id AND st.turn_idx = tp.turn_idx "
            "WHERE tp.session_id = ? AND tp.taxonomy_version = ?",
            ("claude:impl-1", phase_tokens_row["taxonomy_version"]),
        ).fetchall()
        aggregated = sum(r["output_tokens"] for r in turn_phase_rows if r["phase"] == phase_tokens_row["phase"])
        self.assertEqual(aggregated, phase_tokens_row["output_tokens"])


def _write_one_turn_claude_transcript(path: Path, session_id: str):
    """A standalone (not through IngestTestBase's git/staging fixtures)
    one-turn claude transcript, for backfill-turns tests that need a real
    transcript file to re-extract but don't need the full ingest join."""
    _write_claude_session(
        path, session_id, "Implement something.", "Done.",
        ts_start="2026-07-01T00:00:00Z", ts_end="2026-07-01T00:05:00Z",
    )


class TestBackfillTurns(unittest.TestCase):
    """``ingest.py backfill-turns`` (design.md D5 amendment, followup-4):
    populates session_turns (and, for round-0 implementers, turn_phases)
    for already-ingested sessions that predate those tables, keyed off
    ``sessions.transcript_path`` directly -- independent of `run()`'s git/
    prompt join machinery, since these sessions were ingested before that
    column/tables existed at all."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.db_path = self.root / "t.sqlite"
        self.conn = db.connect(self.db_path)
        self.no_analysis_dir = self.root / "no-analysis-dir"  # deliberately absent

    def _insert_session(self, session_id, provider, role, transcript_path, review_round=0, n_turns=None):
        db.upsert(
            self.conn, "sessions",
            {
                "session_id": session_id, "task_id": None, "provider": provider,
                "role": role, "model": "claude-sonnet-5",
                "transcript_path": str(transcript_path) if transcript_path else None,
                "input_tokens": 0, "cached_tokens": 0, "output_tokens": 0,
                "review_round": review_round, "n_turns": n_turns,
            },
            ["session_id"],
        )
        self.conn.commit()

    def test_backfills_session_turns_from_existing_transcript(self):
        transcript = self.root / "reviewer.jsonl"
        shutil.copy(os.path.join(FIXTURES, "codex_persistent_reviewer.jsonl"), transcript)
        self._insert_session("codex:reviewer-sess-1", "codex", "reviewer", transcript, review_round=1)

        stats = ingest.backfill_turns(self.conn, analysis_dir=self.no_analysis_dir)

        self.assertEqual(stats["session_turns_backfilled"], 1)
        self.assertEqual(stats["session_turns_unrecoverable"], 0)

        turns = self.conn.execute(
            "SELECT turn_idx, output_tokens FROM session_turns WHERE session_id = ? ORDER BY turn_idx",
            ("codex:reviewer-sess-1",),
        ).fetchall()
        self.assertEqual([r["output_tokens"] for r in turns], [200, 150])

        # Both verdict turns' ended_at persisted as review boundaries
        # (fixture has two SPEC:/QUALITY: verdicts -- see
        # test_extractors.TestExtractCodexPersistentReviewer).
        vb = json.loads(
            self.conn.execute(
                "SELECT verdict_boundaries_json FROM sessions WHERE session_id = ?",
                ("codex:reviewer-sess-1",),
            ).fetchone()[0]
        )
        self.assertEqual(vb, ["2026-07-05T00:00:08Z", "2026-07-05T01:00:05Z"])

    def test_missing_transcript_path_is_unrecoverable(self):
        self._insert_session("codex:gone-1", "codex", "implementer", None)
        stats = ingest.backfill_turns(self.conn, analysis_dir=self.no_analysis_dir)
        self.assertEqual(stats["session_turns_unrecoverable"], 1)
        self.assertEqual(stats["session_turns_backfilled"], 0)
        count = self.conn.execute(
            "SELECT COUNT(*) FROM session_turns WHERE session_id = ?", ("codex:gone-1",)
        ).fetchone()[0]
        self.assertEqual(count, 0)

    def test_deleted_transcript_file_is_unrecoverable(self):
        transcript = self.root / "deleted.jsonl"
        transcript.write_text('{"not": "used"}\n')
        self._insert_session("codex:deleted-1", "codex", "implementer", transcript)
        transcript.unlink()
        stats = ingest.backfill_turns(self.conn, analysis_dir=self.no_analysis_dir)
        self.assertEqual(stats["session_turns_unrecoverable"], 1)
        self.assertEqual(stats["session_turns_backfilled"], 0)

    def test_n_turns_refreshed_from_authoritative_reextraction(self):
        # followup-5 (design.md D5/D2 amendment): sessions.n_turns is
        # refreshed from the freshly re-extracted turn count during
        # backfill -- many rows are stale from the original migration and
        # were never corrected since.
        transcript = self.root / "reviewer.jsonl"
        shutil.copy(os.path.join(FIXTURES, "codex_persistent_reviewer.jsonl"), transcript)
        self._insert_session("codex:reviewer-sess-1", "codex", "reviewer", transcript, n_turns=999)

        ingest.backfill_turns(self.conn, analysis_dir=self.no_analysis_dir)

        n_turns = self.conn.execute(
            "SELECT n_turns FROM sessions WHERE session_id = ?", ("codex:reviewer-sess-1",)
        ).fetchone()[0]
        self.assertEqual(n_turns, 2)  # the fixture's real turn count, not the stale 999

    def test_regenerate_false_leaves_existing_session_turns_untouched(self):
        # Default behavior (regenerate=False) only fills gaps -- a session
        # that already has session_turns rows (even under an older,
        # leakier extractor) is left alone.
        transcript = self.root / "leaky.jsonl"
        shutil.copy(os.path.join(FIXTURES, "codex_leaky.jsonl"), transcript)
        self._insert_session("codex:leaky-1", "codex", "implementer", transcript, review_round=0)
        db.upsert(
            self.conn, "session_turns",
            {
                "session_id": "codex:leaky-1", "turn_idx": 1,
                "started_at": "t", "ended_at": "t", "output_tokens": 1,  # deliberately stale/wrong
            },
            ["session_id", "turn_idx"],
        )
        self.conn.commit()

        stats = ingest.backfill_turns(self.conn, analysis_dir=self.no_analysis_dir, regenerate=False)
        self.assertEqual(stats["session_turns_backfilled"], 0)
        self.assertEqual(stats["session_turns_regenerated"], 0)
        row = self.conn.execute(
            "SELECT output_tokens FROM session_turns WHERE session_id = ? AND turn_idx = 1",
            ("codex:leaky-1",),
        ).fetchone()
        self.assertEqual(row["output_tokens"], 1)  # unchanged

    def test_regenerate_true_replaces_existing_session_turns(self):
        # followup-5: regenerate=True widens the candidate set to every
        # session with a transcript, replacing existing (possibly stale,
        # pre-fix) session_turns rows with freshly re-extracted ones.
        transcript = self.root / "leaky.jsonl"
        shutil.copy(os.path.join(FIXTURES, "codex_leaky.jsonl"), transcript)
        self._insert_session("codex:leaky-1", "codex", "implementer", transcript, review_round=0)
        db.upsert(
            self.conn, "session_turns",
            {
                "session_id": "codex:leaky-1", "turn_idx": 1,
                "started_at": "t", "ended_at": "t", "output_tokens": 1,  # stale/wrong
            },
            ["session_id", "turn_idx"],
        )
        self.conn.commit()

        stats = ingest.backfill_turns(self.conn, analysis_dir=self.no_analysis_dir, regenerate=True)
        self.assertEqual(stats["session_turns_regenerated"], 1)
        self.assertEqual(stats["session_turns_backfilled"], 0)

        turns = self.conn.execute(
            "SELECT turn_idx, output_tokens FROM session_turns WHERE session_id = ? ORDER BY turn_idx",
            ("codex:leaky-1",),
        ).fetchall()
        # Matches TestExtractCodexLeaky's hand-traced values exactly.
        self.assertEqual([r["output_tokens"] for r in turns], [250, 50, 100])

    def test_regenerate_true_reconciles_previously_leaky_session(self):
        # End-to-end: a session whose session_turns were originally
        # written under the pre-followup-5 (leaky) extractor no longer
        # reconciles with sessions.output_tokens; --regenerate must fix
        # that by re-deriving session_turns under the fixed extractor.
        transcript = self.root / "leaky.jsonl"
        shutil.copy(os.path.join(FIXTURES, "codex_leaky.jsonl"), transcript)
        # sessions.output_tokens is the session-level total the (already
        # correct, untouched-by-this-fix) codex token_count cumulative
        # counter reports -- 400, matching the fixture's final checkpoint.
        self._insert_session("codex:leaky-2", "codex", "implementer", transcript, review_round=0)
        self.conn.execute(
            "UPDATE sessions SET output_tokens = 400 WHERE session_id = ?", ("codex:leaky-2",)
        )
        # Simulate the OLD leaky extraction's under-counted session_turns
        # (only the turns' own last_token_usage deltas, none of the
        # silent-checkpoint mass folded in): 50 + 50 + 40 = 140, not 400.
        for idx, tok in enumerate([50, 50, 40], start=1):
            db.upsert(
                self.conn, "session_turns",
                {"session_id": "codex:leaky-2", "turn_idx": idx, "started_at": "t", "ended_at": "t", "output_tokens": tok},
                ["session_id", "turn_idx"],
            )
        self.conn.commit()
        stale_sum = self.conn.execute(
            "SELECT SUM(output_tokens) FROM session_turns WHERE session_id = ?", ("codex:leaky-2",)
        ).fetchone()[0]
        self.assertNotEqual(stale_sum, 400)

        ingest.backfill_turns(self.conn, analysis_dir=self.no_analysis_dir, regenerate=True)

        fresh_sum = self.conn.execute(
            "SELECT SUM(output_tokens) FROM session_turns WHERE session_id = ?", ("codex:leaky-2",)
        ).fetchone()[0]
        self.assertEqual(fresh_sum, 400)  # reconciles exactly after regeneration

    def test_turn_phases_backfilled_from_analysis_dataset_for_round0_implementer(self):
        transcript = self.root / "impl.jsonl"
        _write_one_turn_claude_transcript(transcript, "old-impl-1")
        self._insert_session("claude:old-impl-1", "claude", "implementer", transcript, review_round=0)
        # Existing session-level phase_tokens row -- backfill reuses its
        # cache-key metadata (taxonomy_version/input_sha256/scored_by) so
        # the backfilled turn_phases row is directly comparable to it.
        db.upsert(
            self.conn, "phase_tokens",
            {
                "session_id": "claude:old-impl-1", "phase": "red", "output_tokens": 50,
                "turns": 1, "taxonomy_version": "1", "input_sha256": "x", "scored_by": "test",
            },
            ["session_id", "phase", "taxonomy_version"],
        )
        self.conn.commit()

        analysis_dir = self.root / "analysis"
        (analysis_dir / "phase_labels").mkdir(parents=True)
        (analysis_dir / "phase_labels" / "claude-old-impl-1.json").write_text(
            json.dumps({"labels": {"1": "red"}})
        )

        stats = ingest.backfill_turns(self.conn, analysis_dir=analysis_dir)
        self.assertEqual(stats["session_turns_backfilled"], 1)
        self.assertEqual(stats["turn_phases_backfilled"], 1)
        self.assertEqual(stats["turn_phases_unavailable"], 0)

        row = self.conn.execute(
            "SELECT phase, taxonomy_version, input_sha256 FROM turn_phases "
            "WHERE session_id = ? AND turn_idx = 1",
            ("claude:old-impl-1",),
        ).fetchone()
        self.assertEqual(row["phase"], "red")
        self.assertEqual(row["taxonomy_version"], "1")
        self.assertEqual(row["input_sha256"], "x")

    def test_turn_phases_unavailable_when_no_label_source_survives(self):
        transcript = self.root / "impl2.jsonl"
        _write_one_turn_claude_transcript(transcript, "old-impl-2")
        self._insert_session("claude:old-impl-2", "claude", "implementer", transcript, review_round=0)
        db.upsert(
            self.conn, "phase_tokens",
            {
                "session_id": "claude:old-impl-2", "phase": "red", "output_tokens": 50,
                "turns": 1, "taxonomy_version": "1", "input_sha256": "x", "scored_by": "test",
            },
            ["session_id", "phase", "taxonomy_version"],
        )
        self.conn.commit()

        stats = ingest.backfill_turns(self.conn, analysis_dir=self.no_analysis_dir)
        self.assertEqual(stats["session_turns_backfilled"], 1)
        self.assertEqual(stats["turn_phases_unavailable"], 1)
        self.assertEqual(stats["turn_phases_backfilled"], 0)

    def test_non_round0_session_never_gets_turn_phases_backfill_attempt(self):
        # A fixer/reviewer/round>=1 session has no phase categories to
        # backfill turn_phases for at all -- must not even be attempted.
        transcript = self.root / "fixer.jsonl"
        _write_one_turn_claude_transcript(transcript, "old-fixer-1")
        self._insert_session("claude:old-fixer-1", "claude", "fixer", transcript, review_round=1)
        stats = ingest.backfill_turns(self.conn, analysis_dir=self.no_analysis_dir)
        self.assertEqual(stats["session_turns_backfilled"], 1)
        self.assertEqual(stats["turn_phases_backfilled"], 0)
        self.assertEqual(stats["turn_phases_unavailable"], 0)

    def test_idempotent_second_backfill_is_a_no_op(self):
        transcript = self.root / "reviewer2.jsonl"
        shutil.copy(os.path.join(FIXTURES, "codex_persistent_reviewer.jsonl"), transcript)
        self._insert_session("codex:reviewer-sess-2", "codex", "reviewer", transcript)

        stats1 = ingest.backfill_turns(self.conn, analysis_dir=self.no_analysis_dir)
        self.assertEqual(stats1["session_turns_backfilled"], 1)

        stats2 = ingest.backfill_turns(self.conn, analysis_dir=self.no_analysis_dir)
        self.assertEqual(stats2["session_turns_backfilled"], 0)
        self.assertEqual(stats2["session_turns_unrecoverable"], 0)
        count = self.conn.execute(
            "SELECT COUNT(*) FROM session_turns WHERE session_id = ?", ("codex:reviewer-sess-2",)
        ).fetchone()[0]
        self.assertEqual(count, 2)  # not doubled

    def test_zero_turn_extraction_counted_separately_not_as_backfilled(self):
        # fix-round-1 review, finding 4: a transcript that parses cleanly
        # but yields zero turns (only a user message, no assistant
        # response at all) must not inflate session_turns_backfilled.
        transcript = self.root / "zero_turns.jsonl"
        transcript.write_text(json.dumps({
            "type": "user", "message": {"role": "user", "content": "hello"},
            "sessionId": "zero-turns-1", "timestamp": "2026-07-01T00:00:00Z",
        }) + "\n")
        # A stale n_turns from an earlier (pre-followup-5) migration/ingest
        # -- fix-round-1 review of followup-5, High finding: the original
        # code `continue`d on the zero-turns path BEFORE ever reaching the
        # n_turns UPDATE, so a zero-turn session kept whatever stale value
        # it had instead of being corrected to 0.
        self._insert_session("claude:zero-turns-1", "claude", "implementer", transcript, n_turns=1)

        stats = ingest.backfill_turns(self.conn, analysis_dir=self.no_analysis_dir)
        self.assertEqual(stats["session_turns_zero_turns"], 1)
        self.assertEqual(stats["session_turns_backfilled"], 0)
        count = self.conn.execute(
            "SELECT COUNT(*) FROM session_turns WHERE session_id = ?", ("claude:zero-turns-1",)
        ).fetchone()[0]
        self.assertEqual(count, 0)
        n_turns = self.conn.execute(
            "SELECT n_turns FROM sessions WHERE session_id = ?", ("claude:zero-turns-1",)
        ).fetchone()[0]
        self.assertEqual(n_turns, 0)  # refreshed to the true (zero) count, not left stale

    def test_verification_failure_writes_nothing_and_counts_separately(self):
        # fix-round-1 review, finding 1: turn_phases must be verified
        # against the stored phase_tokens BEFORE anything is written --
        # a mismatch writes zero rows for that session, counted distinctly
        # from "no label source at all".
        transcript = self.root / "impl3.jsonl"
        _write_one_turn_claude_transcript(transcript, "old-impl-3")
        self._insert_session("claude:old-impl-3", "claude", "implementer", transcript, review_round=0)
        # Stored phase_tokens (999) does not match what the label file
        # implies for the actual re-extracted turn (output_tokens=50) --
        # simulates a historical label source that no longer lines up
        # with this transcript.
        db.upsert(
            self.conn, "phase_tokens",
            {
                "session_id": "claude:old-impl-3", "phase": "red", "output_tokens": 999,
                "turns": 1, "taxonomy_version": "1", "input_sha256": "x", "scored_by": "test",
            },
            ["session_id", "phase", "taxonomy_version"],
        )
        self.conn.commit()

        analysis_dir = self.root / "analysis3"
        (analysis_dir / "phase_labels").mkdir(parents=True)
        (analysis_dir / "phase_labels" / "claude-old-impl-3.json").write_text(
            json.dumps({"labels": {"1": "red"}})
        )

        stats = ingest.backfill_turns(self.conn, analysis_dir=analysis_dir)
        self.assertEqual(stats["turn_phases_verification_failed"], 1)
        self.assertEqual(stats["turn_phases_backfilled"], 0)
        count = self.conn.execute(
            "SELECT COUNT(*) FROM turn_phases WHERE session_id = ?", ("claude:old-impl-3",)
        ).fetchone()[0]
        self.assertEqual(count, 0)

    def test_existing_turn_phases_gets_phase_tokens_recomputed_not_deleted(self):
        # followup-5 (design.md D5/D2 amendment): a session that ALREADY
        # has turn_phases rows has its LABELS trusted (the agentic
        # judgment, cache-keyed) -- if the stored phase_tokens weight is
        # stale relative to the CURRENT session_turns (e.g. after an
        # extractors.py delta fix changed per-turn token counts),
        # backfill_turns must RECOMPUTE phase_tokens to match those
        # existing labels, not delete them as if they were wrong. This
        # supersedes the old fix-round-1 self-heal-by-deletion behavior
        # for this exact shape of input -- deletion is now reserved for a
        # genuine LABEL mismatch (see the sibling test below).
        transcript = self.root / "impl4.jsonl"
        _write_one_turn_claude_transcript(transcript, "old-impl-4")
        self._insert_session("claude:old-impl-4", "claude", "implementer", transcript, review_round=0)
        db.upsert(
            self.conn, "phase_tokens",
            {
                "session_id": "claude:old-impl-4", "phase": "red", "output_tokens": 50,
                "turns": 1, "taxonomy_version": "1", "input_sha256": "x", "scored_by": "test",
            },
            ["session_id", "phase", "taxonomy_version"],
        )
        # session_turns already present (as if backfilled by a prior run
        # under an OLDER extractor whose deltas have since been
        # corrected) -- its current output_tokens (999) no longer matches
        # the STALE stored phase_tokens weight (50), even though the
        # LABEL itself (turn 1 -> "red") is correct and unchanged.
        db.upsert(
            self.conn, "session_turns",
            {
                "session_id": "claude:old-impl-4", "turn_idx": 1,
                "started_at": "t", "ended_at": "t", "output_tokens": 999,
            },
            ["session_id", "turn_idx"],
        )
        db.upsert(
            self.conn, "turn_phases",
            {
                "session_id": "claude:old-impl-4", "turn_idx": 1, "phase": "red",
                "taxonomy_version": "1", "input_sha256": "x", "scored_by": "prior-run",
            },
            ["session_id", "turn_idx", "taxonomy_version"],
        )
        self.conn.commit()
        self.assertNotEqual(costs.turn_phases_integrity_violations(self.conn, "claude:old-impl-4"), {})

        analysis_dir = self.root / "analysis4"
        (analysis_dir / "phase_labels").mkdir(parents=True)
        (analysis_dir / "phase_labels" / "claude-old-impl-4.json").write_text(
            json.dumps({"labels": {"1": "red"}})
        )

        stats = ingest.backfill_turns(self.conn, analysis_dir=analysis_dir)
        self.assertEqual(stats["session_turns_backfilled"], 0)  # already had session_turns
        self.assertEqual(stats["phase_tokens_recomputed"], 1)
        self.assertEqual(stats["turn_phases_verification_failed"], 0)
        self.assertEqual(stats["turn_phases_backfilled"], 1)

        row = self.conn.execute(
            "SELECT output_tokens FROM phase_tokens WHERE session_id = ? AND phase = 'red'",
            ("claude:old-impl-4",),
        ).fetchone()
        self.assertEqual(row["output_tokens"], 999)  # recomputed to match session_turns
        self.assertEqual(costs.turn_phases_integrity_violations(self.conn, "claude:old-impl-4"), {})

    def test_genuine_label_mismatch_self_heals_by_deletion(self):
        # A real label discrepancy (not just a stale token weight): the
        # existing turn_phases row says turn 1 is "red", but the
        # authoritative historical label source says it should be
        # "green". Recomputing phase_tokens from the EXISTING (arguably
        # wrong) label first, then finding pass 2's independently-derived
        # candidate disagrees, must still self-heal by removing the
        # session's turn_phases entirely -- not silently keep the
        # mismatched label.
        transcript = self.root / "impl5.jsonl"
        _write_one_turn_claude_transcript(transcript, "old-impl-5")
        self._insert_session("claude:old-impl-5", "claude", "implementer", transcript, review_round=0)
        db.upsert(
            self.conn, "phase_tokens",
            {
                "session_id": "claude:old-impl-5", "phase": "red", "output_tokens": 50,
                "turns": 1, "taxonomy_version": "1", "input_sha256": "x", "scored_by": "test",
            },
            ["session_id", "phase", "taxonomy_version"],
        )
        db.upsert(
            self.conn, "session_turns",
            {
                "session_id": "claude:old-impl-5", "turn_idx": 1,
                "started_at": "t", "ended_at": "t", "output_tokens": 50,
            },
            ["session_id", "turn_idx"],
        )
        db.upsert(
            self.conn, "turn_phases",
            {
                "session_id": "claude:old-impl-5", "turn_idx": 1, "phase": "red",
                "taxonomy_version": "1", "input_sha256": "x", "scored_by": "prior-run",
            },
            ["session_id", "turn_idx", "taxonomy_version"],
        )
        self.conn.commit()

        analysis_dir = self.root / "analysis5"
        (analysis_dir / "phase_labels").mkdir(parents=True)
        # The authoritative historical source disagrees: turn 1 should be
        # "green", not "red".
        (analysis_dir / "phase_labels" / "claude-old-impl-5.json").write_text(
            json.dumps({"labels": {"1": "green"}})
        )

        stats = ingest.backfill_turns(self.conn, analysis_dir=analysis_dir)
        self.assertEqual(stats["turn_phases_verification_failed"], 1)
        self.assertEqual(stats["turn_phases_backfilled"], 0)

        count = self.conn.execute(
            "SELECT COUNT(*) FROM turn_phases WHERE session_id = ?", ("claude:old-impl-5",)
        ).fetchone()[0]
        self.assertEqual(count, 0)  # self-healed: the mismatched label is gone


class TestVerifyTurnPhasesCli(unittest.TestCase):
    """fix-round-1 review, finding 1: ``ingest.py verify-turn-phases`` is
    the standalone check the review asked for -- so the turn_phases/
    phase_tokens invariant can be asserted against a real, committed
    database (e.g. a CI gate), not just implied by other tests passing."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "t.sqlite"
        self.conn = db.connect(self.db_path)

    def _make_session_with_turn_data(self, session_id, output_tokens):
        db.upsert(self.conn, "changes", {"name": "c", "ingested_at": "t"}, ["name"])
        change_id = self.conn.execute("SELECT change_id FROM changes WHERE name = 'c'").fetchone()[0]
        db.upsert(
            self.conn, "tasks", {"change_id": change_id, "task_key": "task-1", "brief_text": "b"},
            ["change_id", "task_key"],
        )
        task_id = self.conn.execute("SELECT task_id FROM tasks").fetchone()[0]
        db.upsert(
            self.conn, "sessions",
            {
                "session_id": session_id, "task_id": task_id, "provider": "claude",
                "role": "implementer", "model": "claude-sonnet-5", "review_round": 0,
                "input_tokens": 0, "cached_tokens": 0, "output_tokens": 50,
            },
            ["session_id"],
        )
        db.upsert(
            self.conn, "session_turns",
            {"session_id": session_id, "turn_idx": 1, "started_at": "t", "ended_at": "t", "output_tokens": output_tokens},
            ["session_id", "turn_idx"],
        )
        db.upsert(
            self.conn, "phase_tokens",
            {
                "session_id": session_id, "phase": "red", "output_tokens": 50,
                "turns": 1, "taxonomy_version": "1", "input_sha256": "x",
            },
            ["session_id", "phase", "taxonomy_version"],
        )
        db.upsert(
            self.conn, "turn_phases",
            {
                "session_id": session_id, "turn_idx": 1, "phase": "red",
                "taxonomy_version": "1", "input_sha256": "x",
            },
            ["session_id", "turn_idx", "taxonomy_version"],
        )
        self.conn.commit()

    def test_exit_zero_on_a_clean_database(self):
        self._make_session_with_turn_data("claude:clean-1", output_tokens=50)  # matches stored red=50
        self.conn.close()

        with contextlib.redirect_stdout(io.StringIO()) as buf:
            rc = ingest.main(["verify-turn-phases", "--db", str(self.db_path)])
        self.assertEqual(rc, 0)
        report = json.loads(buf.getvalue())
        self.assertEqual(report["violation_count"], 0)
        self.assertEqual(report["violations"], [])

    def test_exit_one_on_a_database_with_a_violation(self):
        self._make_session_with_turn_data("claude:bad-1", output_tokens=999)  # mismatches stored red=50
        self.conn.close()

        with contextlib.redirect_stdout(io.StringIO()) as buf:
            rc = ingest.main(["verify-turn-phases", "--db", str(self.db_path)])
        self.assertEqual(rc, 1)
        report = json.loads(buf.getvalue())
        self.assertEqual(report["violation_count"], 1)
        self.assertEqual(report["violations"][0]["session_id"], "claude:bad-1")


class TestDryRunNoDbFile(unittest.TestCase):
    """Review finding 5: `--dry-run` against a database path that doesn't
    exist yet must not create/touch it."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.repo = _make_repo(self.root)

    def test_dry_run_on_nonexistent_db_path_creates_no_file(self):
        missing_db = self.root / "does-not-exist" / "t.sqlite"
        self.assertFalse(missing_db.exists())

        # ingest.main prints a JSON run summary to stdout on this path (see
        # ingest.py) -- captured rather than left to leak into the test
        # runner's own output.
        with contextlib.redirect_stdout(io.StringIO()):
            rc = ingest.main(["--dry-run", "--repo", str(self.repo), "--db", str(missing_db)])

        self.assertEqual(rc, 0)
        self.assertFalse(missing_db.exists())
        self.assertFalse(missing_db.parent.exists())  # not even the directory


if __name__ == "__main__":
    unittest.main()
