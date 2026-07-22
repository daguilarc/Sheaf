"""SQLite access layer for the task-analyzer data pipeline.

Stdlib only. Applies ``schema.sql`` (idempotent CREATE TABLE IF NOT EXISTS)
on connect, and exposes small helpers used by every later ingest/derive step:
``upsert`` for cache-keyed writes, ``dump_jsonl`` for a byte-stable snapshot
of the whole database, and sha256 helpers for content-addressed cache keys.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from urllib.parse import quote

_SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


def connect(path, create: bool = True) -> sqlite3.Connection:
    """Open a connection to the task-analyzer sqlite database at ``path``.

    Enables WAL mode and foreign key enforcement, sets ``row_factory`` to
    ``sqlite3.Row``, and (when ``create`` is True, the default) applies
    ``schema.sql`` — safe to call on an existing database since every
    statement in the schema is ``CREATE TABLE/INDEX IF NOT EXISTS`` or
    ``INSERT OR IGNORE``.

    This connection can write. Callers that only ever read (e.g. scoring a
    decomposition against the main-branch database) should use
    ``connect_readonly`` instead -- WAL mode alone still touches the
    filesystem (creates ``-wal``/``-shm`` sidecar files on first write) and
    ``executescript(schema.sql)`` mutates/creates the target file even when
    every statement is a no-op against an already-current schema, which is
    unacceptable against a database the caller must not write to at all
    (e.g. a read-only-mounted main-branch checkout).
    """
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    if create:
        conn.executescript(_SCHEMA_PATH.read_text(encoding="utf-8"))
        conn.commit()
    return conn


def connect_readonly(path) -> sqlite3.Connection:
    """Open a strictly read-only connection to an existing sqlite database
    at ``path``.

    Uses the ``file:...?mode=ro`` URI form (per Python's sqlite3 URI
    support) instead of ``connect()``: no ``schema.sql`` application, no
    ``PRAGMA journal_mode=WAL`` (WAL requires creating/writing ``-wal``/
    ``-shm`` sidecar files next to the db, which ``mode=ro`` forbids and
    which would fail or silently fall back depending on platform), and no
    implicit file creation -- ``mode=ro`` never creates a missing file, it
    raises instead. Also sets ``PRAGMA query_only=ON`` as a second,
    connection-level guard so an accidental write statement raises instead
    of silently mutating the database via some other path.

    Raises ``sqlite3.OperationalError`` if ``path`` does not exist (or isn't
    a valid sqlite database) -- callers must not depend on this function
    ever creating a file, unlike ``connect()``'s default ``create=True``.
    """
    resolved = Path(path).resolve()
    uri = f"file:{quote(str(resolved))}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    return conn


# Model-name aliases: normalize a raw ``sessions.model`` string to the name
# actually used as the ``model_prices`` lookup key, applied only at
# cost-derivation join time (``costs.py``'s price lookup via
# ``canonical_model``) -- never persisted back onto ``sessions.model``,
# which always retains the raw provider-reported string exactly as
# ingested. Add an entry here whenever a provider starts reporting a
# dated/suffixed variant of a model that already has (or should share) a
# priced canonical row, rather than adding a near-duplicate ``model_prices``
# row for every date-suffixed variant a provider happens to emit.
MODEL_ALIASES = {
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
}


def canonical_model(model):
    """Return the ``model_prices``-lookup name for a raw session ``model``
    string: the ``MODEL_ALIASES`` target if one is registered, else
    ``model`` unchanged. ``None`` is returned unchanged (matches no alias
    and, correctly, no price row)."""
    return MODEL_ALIASES.get(model, model)


def upsert(conn: sqlite3.Connection, table: str, row: dict, key_cols: list) -> None:
    """INSERT ``row`` into ``table``, or update it in place on a conflict.

    ``key_cols`` names the columns forming the conflict target (typically the
    table's primary key). Columns present in ``row`` but not in ``key_cols``
    are overwritten with the new value on conflict; if ``row`` contains only
    key columns, a conflict is a no-op.

    Does not commit — callers that need one-transaction-per-task atomicity
    (see design.md D3) should batch upserts and commit explicitly; callers
    that want each upsert durable immediately should call ``conn.commit()``
    themselves after this returns.
    """
    cols = list(row.keys())
    placeholders = ", ".join("?" for _ in cols)
    col_list = ", ".join(f'"{c}"' for c in cols)
    conflict_cols = ", ".join(f'"{c}"' for c in key_cols)
    update_cols = [c for c in cols if c not in key_cols]

    if update_cols:
        set_clause = ", ".join(f'"{c}" = excluded."{c}"' for c in update_cols)
        sql = (
            f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders}) '
            f'ON CONFLICT({conflict_cols}) DO UPDATE SET {set_clause}'
        )
    else:
        sql = (
            f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders}) '
            f'ON CONFLICT({conflict_cols}) DO NOTHING'
        )

    conn.execute(sql, [row[c] for c in cols])


def _primary_key_columns(conn: sqlite3.Connection, table: str) -> list:
    info = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
    # PRAGMA table_info columns: cid, name, type, notnull, dflt_value, pk
    ranked = [(r[5], r[1]) for r in info if r[5] and r[5] > 0]
    ranked.sort(key=lambda pair: pair[0])
    return [name for _, name in ranked]


def dump_jsonl(conn: sqlite3.Connection, out_path) -> None:
    """Dump every table to ``out_path`` as one JSON object per line.

    Each line is ``{"table": <name>, "row": {...}}`` with dict keys sorted.
    Tables are visited in name order; rows within a table are ordered by
    primary key (or table order if the table has no declared primary key).
    Output is byte-stable across repeated calls on the same database state.

    ``ingest_log`` is deliberately excluded: it's volatile run-audit data
    (a new row every real ingest run, timestamped), not part of the
    reviewable content snapshot -- including it would make the dump change
    on every run even when nothing else did, defeating "no-op re-run
    produces a byte-identical dump" (design.md D3 idempotency).
    """
    out_path = Path(out_path)
    table_names = [
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'ingest_log' "
            "ORDER BY name"
        )
    ]

    lines = []
    for table in table_names:
        pk_cols = _primary_key_columns(conn, table)
        order_clause = (
            " ORDER BY " + ", ".join(f'"{c}"' for c in pk_cols) if pk_cols else ""
        )
        rows = conn.execute(f'SELECT * FROM "{table}"{order_clause}').fetchall()
        for row in rows:
            record = {"table": table, "row": dict(row)}
            lines.append(json.dumps(record, sort_keys=True, separators=(",", ":")))

    text = "\n".join(lines)
    if lines:
        text += "\n"
    out_path.write_text(text, encoding="utf-8")


def sha256_text(text: str) -> str:
    """Return the hex sha256 digest of ``text`` (encoded as UTF-8)."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path) -> str:
    """Return the hex sha256 digest of the file at ``path``."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()
