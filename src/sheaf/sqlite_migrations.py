"""Shared SQLite schema migration helpers."""

from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path


logger = logging.getLogger(__name__)
_TRACKING_TABLE_NAME = "schema_migrations"


@dataclass(frozen=True)
class BackupPolicy:
    directory: Path
    database_name: str
    retention_days: int = 14
    minimum_keep: int = 10


@dataclass(frozen=True)
class MigrationResult:
    applied_versions: tuple[str, ...]
    pending_versions: tuple[str, ...]
    backup_path: Path | None
    removed_backups: tuple[Path, ...]


def migration_files(migrations_dir: Path) -> list[Path]:
    return sorted(path for path in migrations_dir.glob("*.sql") if path.is_file())


def apply_migrations(
    conn: sqlite3.Connection,
    *,
    migrations_dir: Path,
    applied_at: str,
    backup_policy: BackupPolicy | None = None,
) -> MigrationResult:
    files = migration_files(migrations_dir)
    if not files:
        raise RuntimeError(f"No migration files found in {migrations_dir}")

    fresh_database = _is_fresh_database(conn)
    tracking_exists = _tracking_table_exists(conn)

    if tracking_exists:
        applied_versions = _applied_versions(conn)
    else:
        applied_versions = set()

    pending_files = [path for path in files if path.stem not in applied_versions]
    pending_versions = tuple(path.stem for path in pending_files)

    backup_path: Path | None = None
    if pending_files and not fresh_database and backup_policy is not None:
        backup_path = _create_backup(conn, backup_policy)

    applied_now: list[str] = []
    if pending_files:
        _ensure_tracking_table(conn)
        for path in pending_files:
            sql = path.read_text(encoding="utf-8")
            conn.execute("BEGIN")
            try:
                _execute_script_transactionally(conn, sql)
                _record_applied_version(conn, version=path.stem, applied_at=applied_at)
            except Exception:
                conn.rollback()
                raise
            else:
                conn.commit()
            applied_now.append(path.stem)

    removed_backups: tuple[Path, ...] = ()
    if backup_path is not None:
        removed_backups = _cleanup_old_backups(backup_policy)

    return MigrationResult(
        applied_versions=tuple(applied_now),
        pending_versions=pending_versions,
        backup_path=backup_path,
        removed_backups=removed_backups,
    )


def _is_fresh_database(conn: sqlite3.Connection) -> bool:
    rows = conn.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type IN ('table', 'index', 'trigger', 'view')
          AND name NOT LIKE 'sqlite_%'
        """
    ).fetchall()
    return len(rows) == 0


def _tracking_table_exists(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        """,
        (_TRACKING_TABLE_NAME,),
    ).fetchone()
    return row is not None


def _ensure_tracking_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
        """
    )


def _applied_versions(conn: sqlite3.Connection) -> set[str]:
    _ensure_tracking_table(conn)
    return {
        str(row[0]) for row in conn.execute("SELECT version FROM schema_migrations").fetchall()
    }


def _record_applied_version(conn: sqlite3.Connection, *, version: str, applied_at: str) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO schema_migrations(version, applied_at)
        VALUES (?, ?)
        """,
        (version, applied_at),
    )


def _execute_script_transactionally(conn: sqlite3.Connection, sql: str) -> None:
    statement = ""
    for char in sql:
        statement += char
        if not sqlite3.complete_statement(statement):
            continue
        normalized = statement.strip()
        if normalized:
            conn.execute(normalized)
        statement = ""

    if statement.strip():
        raise sqlite3.ProgrammingError("Migration script ended with an incomplete SQL statement")


def _create_backup(conn: sqlite3.Connection, policy: BackupPolicy) -> Path:
    policy.directory.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = policy.directory / f"{policy.database_name}_pre_migration_{timestamp}.sqlite3"

    destination = sqlite3.connect(backup_path)
    try:
        conn.backup(destination)
    except Exception:
        destination.close()
        backup_path.unlink(missing_ok=True)
        raise
    else:
        destination.close()
        return backup_path


def _cleanup_old_backups(policy: BackupPolicy) -> tuple[Path, ...]:
    try:
        files = sorted(
            (
                path
                for path in policy.directory.glob(
                    f"{policy.database_name}_pre_migration_*.sqlite3"
                )
                if path.is_file()
            ),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
    except OSError as exc:
        logger.warning("Failed to list schema backups in %s: %s", policy.directory, exc)
        return ()

    cutoff = datetime.now(timezone.utc) - timedelta(days=policy.retention_days)
    keep: set[Path] = set(files[: policy.minimum_keep])
    for path in files:
        try:
            modified_at = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        except OSError as exc:
            logger.warning("Failed to read backup timestamp for %s: %s", path, exc)
            keep.add(path)
            continue
        if modified_at >= cutoff:
            keep.add(path)

    removed: list[Path] = []
    for path in files:
        if path in keep:
            continue
        try:
            path.unlink()
        except OSError as exc:
            logger.warning("Failed to prune schema backup %s: %s", path, exc)
            continue
        removed.append(path)
    return tuple(removed)
