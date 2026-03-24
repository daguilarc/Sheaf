"""Vault database schema bootstrap helpers."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from sheaf.config.settings import REPO_ROOT
from sheaf.sqlite_migrations import apply_migrations as apply_sqlite_migrations
from sheaf.sqlite_migrations import migration_files as list_migration_files


_MIGRATIONS_DIR = REPO_ROOT / "src" / "sheaf" / "vaults" / "migrations"


def migration_files() -> list[Path]:
    return list_migration_files(_MIGRATIONS_DIR)


def apply_migrations(conn: sqlite3.Connection, *, applied_at: str) -> None:
    apply_sqlite_migrations(
        conn,
        migrations_dir=_MIGRATIONS_DIR,
        applied_at=applied_at,
    )
