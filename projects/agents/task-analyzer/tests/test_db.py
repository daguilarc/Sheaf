"""Tests for the task-analyzer db module (schema application, upsert, dump_jsonl)."""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import db  # noqa: E402


class TestDb(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp(prefix="task-analyzer-db-test-")
        self.tmp_path = Path(self._tmp)

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_connect_creates_schema(self):
        conn = db.connect(self.tmp_path / "t.sqlite")
        tables = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        expected = {
            "changes",
            "tasks",
            "sessions",
            "complexity",
            "grades",
            "phase_tokens",
            "model_prices",
            "task_costs",
            "estimators",
            "estimator_params",
            "ingest_log",
            "meta",
        }
        self.assertTrue(expected <= tables)
        self.assertEqual(conn.execute("PRAGMA journal_mode").fetchone()[0], "wal")

    def test_upsert_and_stable_dump(self):
        conn = db.connect(self.tmp_path / "t.sqlite")
        db.upsert(
            conn,
            "changes",
            {"change_id": 1, "name": "x", "ingested_at": "t0"},
            ["change_id"],
        )
        db.upsert(
            conn,
            "changes",
            {"change_id": 1, "name": "x2", "ingested_at": "t0"},
            ["change_id"],
        )
        self.assertEqual(
            conn.execute("SELECT name FROM changes").fetchone()[0], "x2"
        )
        db.dump_jsonl(conn, self.tmp_path / "a.jsonl")
        db.dump_jsonl(conn, self.tmp_path / "b.jsonl")
        self.assertEqual(
            (self.tmp_path / "a.jsonl").read_bytes(),
            (self.tmp_path / "b.jsonl").read_bytes(),
        )
        row = json.loads((self.tmp_path / "a.jsonl").read_text().splitlines()[0])
        self.assertEqual(set(row), {"table", "row"})

    def test_connect_is_idempotent(self):
        path = self.tmp_path / "t.sqlite"
        conn1 = db.connect(path)
        conn1.close()
        # Re-applying schema.sql to an existing db must not error.
        conn2 = db.connect(path)
        self.assertEqual(conn2.execute("PRAGMA foreign_keys").fetchone()[0], 1)

    def test_upsert_does_not_auto_commit(self):
        # upsert leaves transaction control to the caller (needed for
        # one-transaction-per-task atomicity in later ingest tasks); a
        # write is only durable across connections once the caller commits.
        path = self.tmp_path / "t.sqlite"
        conn1 = db.connect(path)
        conn2 = db.connect(path, create=False)

        db.upsert(
            conn1,
            "changes",
            {"change_id": 1, "name": "uncommitted", "ingested_at": "t0"},
            ["change_id"],
        )

        # Before conn1 commits, a second connection must not see the row —
        # this is what catches a regression to auto-commit.
        self.assertIsNone(
            conn2.execute("SELECT name FROM changes WHERE change_id = 1").fetchone()
        )

        conn1.commit()

        self.assertEqual(
            conn2.execute(
                "SELECT name FROM changes WHERE change_id = 1"
            ).fetchone()[0],
            "uncommitted",
        )

    def test_model_prices_seeded_for_all_observed_arms(self):
        conn = db.connect(self.tmp_path / "t.sqlite")
        observed_arms = {
            "gpt-5.5",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.4",
            "gpt-5.4-mini",
            "gpt-5-codex",
            "gpt-5",
            "claude-sonnet-5",
            "claude-opus-4-8",
            "claude-haiku-4-5",
        }
        rows = conn.execute("SELECT DISTINCT model FROM model_prices").fetchall()
        seeded = {r[0] for r in rows}
        missing = observed_arms - seeded
        self.assertFalse(missing, f"missing model_prices rows for: {missing}")

    def test_sha256_helpers(self):
        text = "hello world"
        self.assertEqual(len(db.sha256_text(text)), 64)
        self.assertEqual(db.sha256_text(text), db.sha256_text(text))

        f = self.tmp_path / "f.txt"
        f.write_text(text)
        self.assertEqual(db.sha256_file(f), db.sha256_text(text))


if __name__ == "__main__":
    unittest.main()
