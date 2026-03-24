from __future__ import annotations

import shutil
import sqlite3
import os
from pathlib import Path

import pytest

import sheaf.server.runtime as rr
import sheaf.sqlite_migrations as sqlite_migrations
import sheaf.vaults.runtime as vault_runtime
from sheaf.server.runtime import RewriteRuntime
from sheaf.sqlite_migrations import BackupPolicy, apply_migrations


def _write_migration(path: Path, sql: str) -> None:
    path.write_text(sql, encoding="utf-8")


def _create_server_migrations_dir(tmp_path: Path, *, include_upgrade: bool = False) -> Path:
    migrations_dir = tmp_path / "server_migrations"
    migrations_dir.mkdir(parents=True)
    source = rr.REPO_ROOT / "src" / "sheaf" / "server" / "migrations" / "001_bootstrap.sql"
    shutil.copy(source, migrations_dir / "001_bootstrap.sql")
    if include_upgrade:
        _write_migration(
            migrations_dir / "002_add_migration_marker.sql",
            """
            CREATE TABLE IF NOT EXISTS migration_marker (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                note TEXT NOT NULL
            );
            """,
        )
    return migrations_dir


def _initialize_tracked_server_db(db_path: Path, migrations_dir: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        apply_migrations(conn, migrations_dir=migrations_dir, applied_at="2026-03-24T00:00:00Z")


def test_apply_migrations_fresh_db_applies_bootstrap_and_upgrades(tmp_path: Path) -> None:
    migrations_dir = tmp_path / "migrations"
    migrations_dir.mkdir()
    _write_migration(
        migrations_dir / "001_bootstrap.sql",
        """
        CREATE TABLE IF NOT EXISTS alpha (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        );
        """,
    )
    _write_migration(
        migrations_dir / "002_add_beta.sql",
        """
        CREATE TABLE IF NOT EXISTS beta (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alpha_id INTEGER NOT NULL
        );
        """,
    )

    conn = sqlite3.connect(tmp_path / "fresh.sqlite3")
    try:
        result = apply_migrations(conn, migrations_dir=migrations_dir, applied_at="2026-03-24T00:00:00Z")
        applied = conn.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('alpha', 'beta') ORDER BY name"
        ).fetchall()
    finally:
        conn.close()

    assert result.applied_versions == ("001_bootstrap", "002_add_beta")
    assert [row[0] for row in applied] == ["001_bootstrap", "002_add_beta"]
    assert [row[0] for row in tables] == ["alpha", "beta"]


def test_apply_migrations_rerun_is_noop_and_skips_backup(tmp_path: Path) -> None:
    migrations_dir = tmp_path / "migrations"
    migrations_dir.mkdir()
    _write_migration(
        migrations_dir / "001_bootstrap.sql",
        """
        CREATE TABLE IF NOT EXISTS alpha (
            id INTEGER PRIMARY KEY AUTOINCREMENT
        );
        """,
    )

    db_path = tmp_path / "tracked.sqlite3"
    conn = sqlite3.connect(db_path)
    try:
        apply_migrations(conn, migrations_dir=migrations_dir, applied_at="2026-03-24T00:00:00Z")
        result = apply_migrations(
            conn,
            migrations_dir=migrations_dir,
            applied_at="2026-03-24T00:05:00Z",
            backup_policy=BackupPolicy(directory=tmp_path / "backups", database_name="tracked"),
        )
    finally:
        conn.close()

    assert result.applied_versions == ()
    assert result.pending_versions == ()
    assert result.backup_path is None
    assert not (tmp_path / "backups").exists()


def test_server_initialize_tracked_bootstrap_db_is_noop_without_backup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data_dir = tmp_path / "data"
    server_db_path = data_dir / "server.sqlite3"
    backup_dir = data_dir / "backups" / "schema" / "server"
    migrations_dir = _create_server_migrations_dir(tmp_path)
    _initialize_tracked_server_db(server_db_path, migrations_dir)

    monkeypatch.setattr(rr, "DATA_DIR", data_dir)
    monkeypatch.setattr(rr, "SERVER_DB_PATH", server_db_path)
    monkeypatch.setattr(rr, "USER_DBS_DIR", data_dir / "user_dbs")
    monkeypatch.setattr(rr, "SYSTEM_PROMPTS_DIR", data_dir / "system_prompts")
    monkeypatch.setattr(rr, "_SERVER_MIGRATIONS_DIR", migrations_dir)
    monkeypatch.setattr(rr, "_SERVER_SCHEMA_BACKUP_DIR", backup_dir)
    monkeypatch.setattr(vault_runtime, "VAULT_DB_PATH", data_dir / "vaults.sqlite3")

    runtime = RewriteRuntime()
    runtime.initialize()

    with sqlite3.connect(server_db_path) as conn:
        versions = conn.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()

    assert [row[0] for row in versions] == ["001_bootstrap"]
    assert not backup_dir.exists()


def test_server_initialize_creates_backup_before_pending_upgrade(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data_dir = tmp_path / "data"
    server_db_path = data_dir / "server.sqlite3"
    backup_dir = data_dir / "backups" / "schema" / "server"
    migrations_dir = _create_server_migrations_dir(tmp_path, include_upgrade=True)
    bootstrap_only_dir = _create_server_migrations_dir(tmp_path / "baseline")
    _initialize_tracked_server_db(server_db_path, bootstrap_only_dir)

    original_backup = sqlite_migrations._create_backup

    def backup_spy(conn: sqlite3.Connection, policy: BackupPolicy) -> Path:
        marker = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_marker'"
        ).fetchone()
        assert marker is None
        return original_backup(conn, policy)

    monkeypatch.setattr(rr, "DATA_DIR", data_dir)
    monkeypatch.setattr(rr, "SERVER_DB_PATH", server_db_path)
    monkeypatch.setattr(rr, "USER_DBS_DIR", data_dir / "user_dbs")
    monkeypatch.setattr(rr, "SYSTEM_PROMPTS_DIR", data_dir / "system_prompts")
    monkeypatch.setattr(rr, "_SERVER_MIGRATIONS_DIR", migrations_dir)
    monkeypatch.setattr(rr, "_SERVER_SCHEMA_BACKUP_DIR", backup_dir)
    monkeypatch.setattr(vault_runtime, "VAULT_DB_PATH", data_dir / "vaults.sqlite3")
    monkeypatch.setattr(sqlite_migrations, "_create_backup", backup_spy)

    runtime = RewriteRuntime()
    runtime.initialize()

    with sqlite3.connect(server_db_path) as conn:
        versions = conn.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
        marker = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_marker'"
        ).fetchone()

    backups = sorted(backup_dir.glob("*.sqlite3"))
    assert [row[0] for row in versions] == ["001_bootstrap", "002_add_migration_marker"]
    assert marker is not None
    assert len(backups) == 1


def test_server_initialize_backup_failure_blocks_upgrade(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data_dir = tmp_path / "data"
    server_db_path = data_dir / "server.sqlite3"
    migrations_dir = _create_server_migrations_dir(tmp_path, include_upgrade=True)
    bootstrap_only_dir = _create_server_migrations_dir(tmp_path / "baseline")
    _initialize_tracked_server_db(server_db_path, bootstrap_only_dir)

    def fail_backup(conn: sqlite3.Connection, policy: BackupPolicy) -> Path:
        raise RuntimeError("backup failed")

    monkeypatch.setattr(rr, "DATA_DIR", data_dir)
    monkeypatch.setattr(rr, "SERVER_DB_PATH", server_db_path)
    monkeypatch.setattr(rr, "USER_DBS_DIR", data_dir / "user_dbs")
    monkeypatch.setattr(rr, "SYSTEM_PROMPTS_DIR", data_dir / "system_prompts")
    monkeypatch.setattr(rr, "_SERVER_MIGRATIONS_DIR", migrations_dir)
    monkeypatch.setattr(rr, "_SERVER_SCHEMA_BACKUP_DIR", data_dir / "backups" / "schema" / "server")
    monkeypatch.setattr(vault_runtime, "VAULT_DB_PATH", data_dir / "vaults.sqlite3")
    monkeypatch.setattr(sqlite_migrations, "_create_backup", fail_backup)

    runtime = RewriteRuntime()
    with pytest.raises(RuntimeError, match="backup failed"):
        runtime.initialize()

    with sqlite3.connect(server_db_path) as conn:
        versions = conn.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
        marker = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_marker'"
        ).fetchone()

    assert [row[0] for row in versions] == ["001_bootstrap"]
    assert marker is None


def test_apply_migrations_prunes_backups_beyond_retention_thresholds(tmp_path: Path) -> None:
    migrations_dir = tmp_path / "migrations"
    migrations_dir.mkdir()
    _write_migration(
        migrations_dir / "001_bootstrap.sql",
        """
        CREATE TABLE IF NOT EXISTS alpha (
            id INTEGER PRIMARY KEY AUTOINCREMENT
        );
        """,
    )
    _write_migration(
        migrations_dir / "002_add_beta.sql",
        """
        CREATE TABLE IF NOT EXISTS beta (
            id INTEGER PRIMARY KEY AUTOINCREMENT
        );
        """,
    )

    baseline_dir = tmp_path / "baseline_migrations"
    baseline_dir.mkdir()
    _write_migration(
        baseline_dir / "001_bootstrap.sql",
        """
        CREATE TABLE IF NOT EXISTS alpha (
            id INTEGER PRIMARY KEY AUTOINCREMENT
        );
        """,
    )

    db_path = tmp_path / "existing.sqlite3"
    with sqlite3.connect(db_path) as conn:
        apply_migrations(conn, migrations_dir=baseline_dir, applied_at="2026-03-24T00:00:00Z")

    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    stale_files = []
    for index in range(4):
        path = backup_dir / f"server_pre_migration_2026030{index}T000000Z.sqlite3"
        path.write_text("old", encoding="utf-8")
        stale_files.append(path)

    now = 1_711_238_400
    for offset, path in enumerate(stale_files):
        timestamp = now - ((20 - offset) * 86400)
        os.utime(path, (timestamp, timestamp))

    conn = sqlite3.connect(db_path)
    try:
        result = apply_migrations(
            conn,
            migrations_dir=migrations_dir,
            applied_at="2026-03-24T00:00:00Z",
            backup_policy=BackupPolicy(
                directory=backup_dir,
                database_name="server",
                retention_days=14,
                minimum_keep=2,
            ),
        )
    finally:
        conn.close()

    remaining = sorted(path.name for path in backup_dir.glob("*.sqlite3"))
    assert result.applied_versions == ("002_add_beta",)
    assert len(result.removed_backups) == 3
    assert len(remaining) == 2


def test_apply_migrations_failure_rolls_back_schema_and_version(tmp_path: Path) -> None:
    baseline_dir = tmp_path / "baseline_migrations"
    baseline_dir.mkdir()
    _write_migration(
        baseline_dir / "001_bootstrap.sql",
        """
        CREATE TABLE IF NOT EXISTS alpha (
            id INTEGER PRIMARY KEY AUTOINCREMENT
        );
        """,
    )

    migrations_dir = tmp_path / "migrations"
    migrations_dir.mkdir()
    _write_migration(
        migrations_dir / "001_bootstrap.sql",
        """
        CREATE TABLE IF NOT EXISTS alpha (
            id INTEGER PRIMARY KEY AUTOINCREMENT
        );
        """,
    )
    _write_migration(
        migrations_dir / "002_partial_failure.sql",
        """
        CREATE TABLE IF NOT EXISTS beta (
            id INTEGER PRIMARY KEY AUTOINCREMENT
        );
        CREATE TABLE broken (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
        );
        """,
    )

    db_path = tmp_path / "failing.sqlite3"
    with sqlite3.connect(db_path) as conn:
        apply_migrations(conn, migrations_dir=baseline_dir, applied_at="2026-03-24T00:00:00Z")

    conn = sqlite3.connect(db_path)
    try:
        with pytest.raises(sqlite3.DatabaseError):
            apply_migrations(conn, migrations_dir=migrations_dir, applied_at="2026-03-24T00:05:00Z")

        versions = conn.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
        beta = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'beta'"
        ).fetchone()
    finally:
        conn.close()

    assert [row[0] for row in versions] == ["001_bootstrap"]
    assert beta is None


def test_apply_migrations_prunes_only_matching_database_backups(tmp_path: Path) -> None:
    migrations_dir = tmp_path / "migrations"
    migrations_dir.mkdir()
    _write_migration(
        migrations_dir / "001_bootstrap.sql",
        """
        CREATE TABLE IF NOT EXISTS alpha (
            id INTEGER PRIMARY KEY AUTOINCREMENT
        );
        """,
    )
    _write_migration(
        migrations_dir / "002_add_beta.sql",
        """
        CREATE TABLE IF NOT EXISTS beta (
            id INTEGER PRIMARY KEY AUTOINCREMENT
        );
        """,
    )

    baseline_dir = tmp_path / "baseline_migrations"
    baseline_dir.mkdir()
    _write_migration(
        baseline_dir / "001_bootstrap.sql",
        """
        CREATE TABLE IF NOT EXISTS alpha (
            id INTEGER PRIMARY KEY AUTOINCREMENT
        );
        """,
    )

    db_path = tmp_path / "existing.sqlite3"
    with sqlite3.connect(db_path) as conn:
        apply_migrations(conn, migrations_dir=baseline_dir, applied_at="2026-03-24T00:00:00Z")

    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    targeted = backup_dir / "server_pre_migration_20260301T000000Z.sqlite3"
    unrelated = backup_dir / "other.sqlite3"
    targeted.write_text("old", encoding="utf-8")
    unrelated.write_text("keep", encoding="utf-8")

    old_timestamp = 1_711_238_400 - (30 * 86400)
    os.utime(targeted, (old_timestamp, old_timestamp))
    os.utime(unrelated, (old_timestamp, old_timestamp))

    conn = sqlite3.connect(db_path)
    try:
        result = apply_migrations(
            conn,
            migrations_dir=migrations_dir,
            applied_at="2026-03-24T00:10:00Z",
            backup_policy=BackupPolicy(
                directory=backup_dir,
                database_name="server",
                retention_days=14,
                minimum_keep=0,
            ),
        )
    finally:
        conn.close()

    assert result.applied_versions == ("002_add_beta",)
    assert targeted in result.removed_backups
    assert unrelated.exists()
