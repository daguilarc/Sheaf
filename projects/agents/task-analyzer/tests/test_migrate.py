"""Tests for migrate_v0.py: one-shot migration of the 2026-07-19
``analysis/sdd-model-analysis/data`` dataset into the task-analyzer schema.

Builds a miniature source tree (2 tasks, 3 sessions, 1 grade, 1 complexity,
1 label+timeline pair) mirroring the real dataset's exact file formats
(codex_sessions.json/claude_sessions.json/tasks.json/complexity/*.json/
grades/*.json/phase_labels/*.json/timelines/*.md/review_texts/*.md), then
asserts row counts, hardcoded rubric/taxonomy versions, the brief-text
fallback rule, review_text stitching, phase-token aggregation, idempotent
re-run (byte-identical dump), and that costs.rebuild produces task_costs
rows.
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db  # noqa: E402
import migrate_v0  # noqa: E402

CHANGE = "widget-fixture"


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def _build_source_tree(root: Path, brief_path: Path) -> Path:
    """Miniature ``analysis/sdd-model-analysis/data``-shaped tree:
    task-1 (brief survives on disk, 1 implementer + 1 reviewer session,
    1 complexity row, 1 grade row referencing the reviewer's review text,
    1 phase-labels+timeline pair for the implementer session) and task-2
    (brief_file is None -- brief_text must fall back to the implementer
    session's own prompt, 1 implementer session, no agentic rows)."""
    source = root / "data"

    brief_path.write_text("Widget core brief text.\n", encoding="utf-8")

    codex_sessions = [
        {
            "provider": "codex", "file": "/fake/rollout-impl-1.jsonl", "session_id": "impl-1",
            "entry": "exec", "spawn_path": None, "spawn_role": None,
            "started_at": "2026-07-01T00:00:00Z", "ended_at": "2026-07-01T00:10:00Z",
            "cwd": "/fake", "model": "gpt-5.5", "effort": "high", "context_window": 200000,
            "prompt": "Implement task-1 per its brief.",
            "tokens": {
                "input_tokens": 1000, "cached_input_tokens": 200,
                "output_tokens": 500, "reasoning_output_tokens": 50, "total_tokens": 1550,
            },
            "peak_context": 12000, "n_compactions": 0, "n_tool_calls": 5, "n_turns": 3,
            "last_agent_message": "Done.", "timeline_file": "timelines/codex-impl-1.md",
            "keys": {}, "n_labeled_turns": 3,
        },
    ]
    claude_sessions = [
        {
            "provider": "claude", "file": "/fake/rev-1.jsonl", "session_id": "rev-1",
            "started_at": "2026-07-01T02:00:00Z", "ended_at": "2026-07-01T02:15:00Z",
            "cwd": "/fake", "model": "claude-sonnet-5", "effort": None, "context_window": None,
            "prompt": "Review task-1.",
            "tokens": {
                "input_tokens": 800, "cached_input_tokens": 100,
                "cache_creation_tokens": 0, "output_tokens": 300, "total_tokens": 1100,
            },
            "peak_context": 5000, "n_compactions": 0, "n_tool_calls": 2, "n_turns": 2,
            "last_agent_message": "APPROVED", "timeline_file": "timelines/claude-rev-1.md",
            "keys": {}, "is_sidechain": False, "n_subagent_spawns": 0, "n_user_msgs": 1,
            "review_traits": {"scope": "task"}, "final_text_file": "review_texts/claude-rev-1.md",
        },
        {
            "provider": "claude", "file": "/fake/impl-2.jsonl", "session_id": "impl-2",
            "started_at": "2026-07-02T00:00:00Z", "ended_at": "2026-07-02T00:20:00Z",
            "cwd": "/fake", "model": "claude-sonnet-5", "effort": None, "context_window": None,
            "prompt": "Implement task-2: build the second widget module (no brief file survived).",
            "tokens": {
                "input_tokens": 900, "cached_input_tokens": 150,
                "cache_creation_tokens": 0, "output_tokens": 400, "total_tokens": 1300,
            },
            "peak_context": 4000, "n_compactions": 0, "n_tool_calls": 3, "n_turns": 4,
            "last_agent_message": "Implemented.", "timeline_file": "timelines/claude-impl-2.md",
            "keys": {}, "is_sidechain": False, "n_subagent_spawns": 0, "n_user_msgs": 1,
            "review_traits": None, "final_text_file": None,
        },
    ]
    tasks = [
        {
            "change": CHANGE, "task": "task-1", "worktree": "wt-1",
            "brief_file": str(brief_path), "report_file": None, "brief_bytes": 25,
            "implementer_sessions": [{
                "sid": "codex:impl-1", "file": "/fake/rollout-impl-1.jsonl",
                "model": "gpt-5.5", "effort": "high", "kind": "implementer",
                "started_at": "2026-07-01T00:00:00Z", "tokens": 1550, "worktree": "wt-1",
                "timeline_file": "timelines/codex-impl-1.md", "review_traits": None,
                "final_text_file": None,
            }],
            "fixer_sessions": [],
            "review_sessions": [{
                "sid": "claude:rev-1", "file": "/fake/rev-1.jsonl",
                "model": "claude-sonnet-5", "effort": None, "kind": "reviewer",
                "started_at": "2026-07-01T02:00:00Z", "tokens": 1100, "worktree": "wt-1",
                "timeline_file": "timelines/claude-rev-1.md", "review_traits": {"scope": "task"},
                "final_text_file": "review_texts/claude-rev-1.md",
            }],
            "audit_sessions": [],
        },
        {
            "change": CHANGE, "task": "task-2", "worktree": "wt-2",
            "brief_file": None, "report_file": None, "brief_bytes": None,
            "implementer_sessions": [{
                "sid": "claude:impl-2", "file": "/fake/impl-2.jsonl",
                "model": "claude-sonnet-5", "effort": None, "kind": "implementer",
                "started_at": "2026-07-02T00:00:00Z", "tokens": 1300, "worktree": "wt-2",
                "timeline_file": "timelines/claude-impl-2.md", "review_traits": None,
                "final_text_file": None,
            }],
            "fixer_sessions": [],
            "review_sessions": [],
            "audit_sessions": [],
        },
    ]
    complexity_row = {
        "task_key": f"{CHANGE}__task-1",
        "C1": 2, "C2": 2, "C3": 2, "C4": 2, "C5": 2, "C6": 2, "C7": 2, "composite": 2.0,
        "rationale": {"C1": "two files"},
    }
    grade_row = {
        "task_key": f"{CHANGE}__task-1",
        "G1": 5, "G2": 5, "G3": 5, "G4": 5, "G5": 5,
        "n_critical": 0, "n_important": 0, "n_minor": 1,
        "verdict_sequence": ["PASS"], "rounds_to_accept": 1, "final_grade": "A",
        "evidence": ["looks good"], "reviewer_models": ["claude-sonnet-5"], "excluded_reviews": [],
    }
    phase_labels = {
        "session_key": "codex-impl-1",
        "labels": {"1": "orient", "2": "green", "3": "green"},
    }
    timeline_text = (
        "# codex session impl-1\n"
        "kind: implementer  model: gpt-5.5/high\n\n"
        "## Turn 1  (output_tokens=100, reasoning=10, input=500)\n"
        "- SAY: starting\n\n"
        "## Turn 2  (output_tokens=200, reasoning=20, input=600)\n"
        "- SAY: writing code\n\n"
        "## Turn 3  (output_tokens=200, reasoning=20, input=700)\n"
        "- SAY: writing more code\n\n"
    )
    review_text = "APPROVED. No issues found.\n"

    _write_json(source / "codex_sessions.json", codex_sessions)
    _write_json(source / "claude_sessions.json", claude_sessions)
    _write_json(source / "tasks.json", tasks)
    _write_json(source / "complexity" / f"{CHANGE}__task-1.json", complexity_row)
    _write_json(source / "grades" / f"{CHANGE}__task-1.json", grade_row)
    _write_json(source / "phase_labels" / "codex-impl-1.json", phase_labels)
    (source / "timelines").mkdir(parents=True, exist_ok=True)
    (source / "timelines" / "codex-impl-1.md").write_text(timeline_text, encoding="utf-8")
    (source / "review_texts").mkdir(parents=True, exist_ok=True)
    (source / "review_texts" / "claude-rev-1.md").write_text(review_text, encoding="utf-8")

    return source


class MigrateTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp(prefix="task-analyzer-migrate-test-")
        self.tmp_path = Path(self._tmp)
        self.addCleanup(shutil.rmtree, self._tmp, ignore_errors=True)
        self.source_dir = _build_source_tree(self.tmp_path, self.tmp_path / "task-1-brief.md")
        self.db_path = self.tmp_path / "t.sqlite"

    def _connect(self):
        return db.connect(self.db_path)

    def test_row_counts(self):
        conn = self._connect()
        stats = migrate_v0.migrate(conn, self.source_dir)

        self.assertEqual(conn.execute("SELECT COUNT(*) FROM changes").fetchone()[0], 1)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0], 2)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 3)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM complexity").fetchone()[0], 1)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM grades").fetchone()[0], 1)
        self.assertEqual(
            conn.execute("SELECT COUNT(DISTINCT session_id) FROM phase_tokens").fetchone()[0], 1
        )
        self.assertEqual(stats["implementer_fixer_sessions"], 2)
        self.assertEqual(stats["complexity_rows"], 1)
        self.assertEqual(stats["grades_rows"], 1)
        self.assertEqual(stats["phase_labeled_session_rows"], 1)
        conn.close()

    def test_versions_hardcoded(self):
        conn = self._connect()
        migrate_v0.migrate(conn, self.source_dir)

        (rv,) = conn.execute("SELECT rubric_version FROM complexity").fetchone()
        self.assertEqual(rv, "1")
        (rv,) = conn.execute("SELECT rubric_version FROM grades").fetchone()
        self.assertEqual(rv, "1")
        for (tv,) in conn.execute("SELECT taxonomy_version FROM phase_tokens").fetchall():
            self.assertEqual(tv, "1")
        for (sb,) in conn.execute(
            "SELECT scored_by FROM complexity UNION SELECT scored_by FROM grades "
            "UNION SELECT scored_by FROM phase_tokens"
        ).fetchall():
            self.assertEqual(sb, "migrated_v0")
        conn.close()

    def test_brief_text_from_disk_when_it_survives(self):
        conn = self._connect()
        migrate_v0.migrate(conn, self.source_dir)
        row = conn.execute(
            "SELECT brief_text FROM tasks WHERE task_key = 'task-1'"
        ).fetchone()
        self.assertEqual(row[0], "Widget core brief text.\n")
        conn.close()

    def test_brief_text_falls_back_to_implementer_prompt(self):
        conn = self._connect()
        migrate_v0.migrate(conn, self.source_dir)
        row = conn.execute(
            "SELECT brief_text FROM tasks WHERE task_key = 'task-2'"
        ).fetchone()
        self.assertEqual(
            row[0], "Implement task-2: build the second widget module (no brief file survived)."
        )
        conn.close()

    def test_token_conversion(self):
        conn = self._connect()
        migrate_v0.migrate(conn, self.source_dir)
        row = conn.execute(
            "SELECT input_tokens, cached_tokens, output_tokens, reasoning_tokens "
            "FROM sessions WHERE session_id = 'codex:impl-1'"
        ).fetchone()
        # source: input_tokens=1000, cached_input_tokens=200 -> new input = 800
        self.assertEqual(tuple(row), (800, 200, 500, 50))

        row = conn.execute(
            "SELECT input_tokens, cached_tokens, output_tokens, reasoning_tokens "
            "FROM sessions WHERE session_id = 'claude:rev-1'"
        ).fetchone()
        # source: input_tokens=800, cached_input_tokens=100 -> new input = 700
        self.assertEqual(tuple(row), (700, 100, 300, 0))
        conn.close()

    def test_review_text_stitched_into_grade(self):
        conn = self._connect()
        migrate_v0.migrate(conn, self.source_dir)
        (review_text,) = conn.execute("SELECT review_text FROM grades").fetchone()
        self.assertEqual(review_text, "APPROVED. No issues found.\n")
        conn.close()

    def test_phase_tokens_aggregated_by_label(self):
        conn = self._connect()
        migrate_v0.migrate(conn, self.source_dir)
        rows = {
            phase: (out_tokens, turns)
            for phase, out_tokens, turns in conn.execute(
                "SELECT phase, output_tokens, turns FROM phase_tokens "
                "WHERE session_id = 'codex:impl-1'"
            ).fetchall()
        }
        self.assertEqual(rows, {"orient": (100, 1), "green": (400, 2)})
        conn.close()

    def test_task_costs_nonempty_after_rebuild(self):
        conn = self._connect()
        migrate_v0.migrate(conn, self.source_dir)
        count = conn.execute("SELECT COUNT(*) FROM task_costs").fetchone()[0]
        self.assertGreater(count, 0)
        conn.close()

    def test_second_run_is_a_noop(self):
        conn = self._connect()
        migrate_v0.migrate(conn, self.source_dir)
        conn.close()

        dump_path = self.db_path.parent / (self.db_path.stem + ".dump.jsonl")
        first_dump = dump_path.read_bytes()

        conn = self._connect()
        migrate_v0.migrate(conn, self.source_dir)
        conn.close()
        second_dump = dump_path.read_bytes()

        self.assertEqual(first_dump, second_dump)


if __name__ == "__main__":
    unittest.main()
