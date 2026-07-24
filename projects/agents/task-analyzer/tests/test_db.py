"""Tests for the task-analyzer db module (schema application, upsert, dump_jsonl)."""
import json
import shutil
import sqlite3
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

    def test_fresh_db_has_v3_tables_and_column(self):
        conn = db.connect(self.tmp_path / "fresh.sqlite")
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertIn("session_turns", tables)
        self.assertIn("turn_phases", tables)
        cols = {r[1] for r in conn.execute('PRAGMA table_info("sessions")')}
        self.assertIn("verdict_boundaries_json", cols)
        self.assertEqual(
            conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()[0], "3"
        )


class TestSchemaMigrationV2ToV3(unittest.TestCase):
    """followup-4 (design.md D5 amendment): session_turns/turn_phases are
    brand-new tables (CREATE TABLE IF NOT EXISTS handles those on any
    pre-v3 DB unaided), but sessions.verdict_boundaries_json is a new
    COLUMN on an already-existing table -- schema.sql's CREATE TABLE IF NOT
    EXISTS cannot retrofit that, so db.py's connect() must ALTER TABLE it
    in explicitly, and bump the schema_version meta row (whose own
    INSERT OR IGNORE seed line never overwrites an existing key)."""

    def setUp(self):
        self._tmp = tempfile.mkdtemp(prefix="task-analyzer-migration-test-")
        self.tmp_path = Path(self._tmp)
        self.db_path = self.tmp_path / "v2.sqlite"

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _make_v2_db(self):
        """A minimal, hand-built v2-shaped DB: sessions table without
        verdict_boundaries_json, no session_turns/turn_phases tables,
        schema_version='2' -- what every already-ingested DB (including
        the real committed one, pre-followup-4) actually looked like."""
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            """CREATE TABLE sessions(
                 session_id TEXT PRIMARY KEY, task_id INTEGER, provider TEXT NOT NULL,
                 harness_entry TEXT, role TEXT NOT NULL, model TEXT, effort TEXT,
                 started_at TEXT, ended_at TEXT, transcript_path TEXT,
                 input_tokens INTEGER, cached_tokens INTEGER, output_tokens INTEGER,
                 reasoning_tokens INTEGER, peak_context INTEGER,
                 n_compactions INTEGER, n_turns INTEGER, n_tool_calls INTEGER,
                 review_round INTEGER)"""
        )
        conn.execute("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT)")
        conn.execute("INSERT INTO meta(key, value) VALUES ('schema_version', '2')")
        conn.execute(
            "INSERT INTO sessions(session_id, provider, role, output_tokens) "
            "VALUES ('codex:existing-1', 'codex', 'implementer', 500)"
        )
        conn.commit()
        conn.close()

    def test_migration_adds_column_and_bumps_version_preserving_data(self):
        self._make_v2_db()
        conn = db.connect(self.db_path)

        cols = {r[1] for r in conn.execute('PRAGMA table_info("sessions")')}
        self.assertIn("verdict_boundaries_json", cols)
        self.assertEqual(
            conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()[0], "3"
        )
        # The pre-existing row survived the ALTER TABLE untouched.
        row = conn.execute(
            "SELECT provider, role, output_tokens, verdict_boundaries_json FROM sessions "
            "WHERE session_id = 'codex:existing-1'"
        ).fetchone()
        self.assertEqual((row["provider"], row["role"], row["output_tokens"]), ("codex", "implementer", 500))
        self.assertIsNone(row["verdict_boundaries_json"])
        # New v3 tables exist too.
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertIn("session_turns", tables)
        self.assertIn("turn_phases", tables)
        conn.close()

    def test_migration_is_idempotent_on_repeated_connect(self):
        self._make_v2_db()
        conn1 = db.connect(self.db_path)
        conn1.close()
        # Second connect() must not raise (e.g. "duplicate column") and must
        # leave the DB in the same already-migrated state.
        conn2 = db.connect(self.db_path)
        cols = [r[1] for r in conn2.execute('PRAGMA table_info("sessions")')]
        self.assertEqual(cols.count("verdict_boundaries_json"), 1)
        self.assertEqual(
            conn2.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()[0], "3"
        )
        conn2.close()


class TestConnectReadonly(unittest.TestCase):
    """connect_readonly must never mutate/create the target file (final
    review finding A): estimate.py/annotations.py open a database that is
    typically the shared main-branch copy, and db.connect()'s WAL pragma +
    schema.sql (re-)application both touch the filesystem even when
    "nothing changes" -- unacceptable against a db the caller must not
    write to at all."""

    def setUp(self):
        self._tmp = tempfile.mkdtemp(prefix="task-analyzer-db-ro-test-")
        self.tmp_path = Path(self._tmp)

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_query_on_existing_db_does_not_modify_file(self):
        path = self.tmp_path / "t.sqlite"
        conn = db.connect(path)
        db.upsert(conn, "changes", {"change_id": 1, "name": "x", "ingested_at": "t0"}, ["change_id"])
        conn.commit()
        conn.close()

        mtime_before = path.stat().st_mtime_ns
        bytes_before = path.read_bytes()

        ro = db.connect_readonly(path)
        row = ro.execute("SELECT name FROM changes WHERE change_id = 1").fetchone()
        self.assertEqual(row["name"], "x")
        ro.close()

        self.assertEqual(path.stat().st_mtime_ns, mtime_before)
        self.assertEqual(path.read_bytes(), bytes_before)

    def test_query_only_pragma_blocks_writes(self):
        path = self.tmp_path / "t.sqlite"
        db.connect(path).close()
        ro = db.connect_readonly(path)
        with self.assertRaises(sqlite3.OperationalError):
            ro.execute("INSERT INTO changes(name, ingested_at) VALUES ('x', 't0')")

    def test_missing_path_raises_and_does_not_create_file(self):
        path = self.tmp_path / "does-not-exist.sqlite"
        self.assertFalse(path.exists())
        with self.assertRaises(sqlite3.OperationalError):
            db.connect_readonly(path)
        self.assertFalse(path.exists())


class TestCanonicalModel(unittest.TestCase):
    def test_known_alias_is_normalized(self):
        self.assertEqual(db.canonical_model("claude-haiku-4-5-20251001"), "claude-haiku-4-5")

    def test_unaliased_model_passes_through(self):
        self.assertEqual(db.canonical_model("claude-sonnet-5"), "claude-sonnet-5")

    def test_none_passes_through(self):
        self.assertIsNone(db.canonical_model(None))


if __name__ == "__main__":
    unittest.main()
