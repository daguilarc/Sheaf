from __future__ import annotations

import asyncio
import json
import logging
import re
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import WebSocket

from sheaf.config.settings import (
    DATA_DIR,
    REPO_ROOT,
    SERVER_DB_PATH,
    SYSTEM_PROMPTS_DIR,
    USER_DBS_DIR,
    configured_default_model,
    configured_system_prompt_file,
)
from sheaf.llm.dispatcher import (
    Message,
    ProviderConfigurationError,
    ToolCall,
    UnsupportedModelError,
    build_dispatcher,
)
from sheaf.llm.model_properties import resolve_model_properties
from sheaf.llm.model_registry import get_model_registry
from sheaf.tools import build_agent_tools
from sheaf.tools.patching import parse_patch_envelope
from sheaf.sqlite_migrations import BackupPolicy, apply_migrations
from sheaf.vaults.paths import canonicalize_path, validate_distinct_root
from sheaf.vaults.runtime import db as vault_db
from sheaf.vaults.runtime import initialize as initialize_vault_db

try:
    from openai import AuthenticationError as OpenAIAuthenticationError
    from openai import BadRequestError as OpenAIBadRequestError
    from openai import NotFoundError as OpenAINotFoundError
    from openai import PermissionDeniedError as OpenAIPermissionDeniedError
except Exception:  # noqa: BLE001
    OpenAIAuthenticationError = None
    OpenAIBadRequestError = None
    OpenAINotFoundError = None
    OpenAIPermissionDeniedError = None

PROTOCOL_VERSION = 1
HEARTBEAT_SECONDS = 15
_WORKER_POLL_SECONDS = 0.25
_RETRY_BASE_SECONDS = 0.5
_RETRY_MAX_SECONDS = 10.0
logger = logging.getLogger(__name__)
_SERVER_MIGRATIONS_DIR = REPO_ROOT / "src" / "sheaf" / "server" / "migrations"
_SERVER_SCHEMA_BACKUP_DIR = DATA_DIR / "backups" / "schema" / "server"
_STREAM_PROGRESS_TRACE = re.compile(r"^streamed_\d+_chunks$")
_DEFAULT_SYSTEM_PROMPT = """You are Sheaf, a local-first assistant.

Follow these rules:
- Be accurate, concise, and explicit about uncertainty.
- Prefer using available tools when they materially improve correctness.
- When using tools, explain results clearly and cite concrete outputs.
- Keep responses actionable; avoid unnecessary filler.
- Preserve user intent and constraints exactly.
"""

def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def utc_after(seconds: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def _json(data: Any) -> str:
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)


class ProtocolError(RuntimeError):
    pass


class FatalExecutionError(RuntimeError):
    pass


class CorruptTurnChainError(FatalExecutionError):
    pass


class CorruptStateContextError(FatalExecutionError):
    pass


@dataclass
class SessionInfo:
    session_id: str
    thread_id: str
    known_tail_turn_id: Optional[str]
    websocket: Optional[WebSocket] = None


@dataclass(frozen=True)
class StateContextKey:
    context_type: str
    key: str


@dataclass(frozen=True)
class StateContextMutation:
    context_type: str
    key: str
    operation: str
    target_key: str | None = None


@dataclass(frozen=True)
class ContextBuildResult:
    messages: list[Message]
    open_state_keys: list[StateContextKey]


@dataclass(frozen=True)
class CompactionPlan:
    summary_text: str
    open_state_keys: list[StateContextKey]
    payload: dict[str, Any]


@dataclass(frozen=True)
class InflightRequestState:
    is_continuation: bool
    user_turn_id: str | None


class RewriteRuntime:
    def __init__(self) -> None:
        self._init_lock = threading.Lock()
        self._initialized = False
        self._tools = {tool.name: tool for tool in build_agent_tools()}

        self._session_lock = threading.Lock()
        self._sessions: dict[str, SessionInfo] = {}
        self._queue_delivery_map: dict[int, Optional[str]] = {}
        self._queue_request_map: dict[int, str] = {}

        self._worker_task: asyncio.Task[None] | None = None
        self._worker_stop: asyncio.Event | None = None
        self._worker_wake: asyncio.Event | None = None
        self._worker_loop_event_loop: asyncio.AbstractEventLoop | None = None
        self._worker_id = f"worker-{uuid.uuid4().hex[:8]}"

    def initialize(self) -> None:
        with self._init_lock:
            if self._initialized:
                return
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            USER_DBS_DIR.mkdir(parents=True, exist_ok=True)
            SYSTEM_PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
            self._ensure_default_system_prompt()
            SERVER_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            initialize_vault_db()
            with self._db() as conn:
                self._apply_database_pragmas(conn)
                self._bootstrap_schema(conn)
                self._reset_queue_locks(conn)
                self._seed_models(conn)
                self._seed_visible_directories(conn)
            self._initialized = True

    async def start_worker(self) -> None:
        self.initialize()
        if self._worker_task is not None and not self._worker_task.done():
            return
        self._worker_stop = asyncio.Event()
        self._worker_wake = asyncio.Event()
        self._worker_loop_event_loop = asyncio.get_running_loop()
        self._worker_task = asyncio.create_task(self._worker_loop(), name="sheaf-queue-worker")

    async def stop_worker(self) -> None:
        if self._worker_stop is not None:
            self._worker_stop.set()
        task = self._worker_task
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._worker_task = None
        self._worker_wake = None
        self._worker_loop_event_loop = None

    async def _worker_loop(self) -> None:
        while self._worker_stop is None or not self._worker_stop.is_set():
            try:
                processed = await self.process_next_runnable()
            except Exception:  # noqa: BLE001
                logger.exception("Unhandled exception in worker loop")
                processed = False
            if not processed:
                wake = self._worker_wake
                if wake is None:
                    await asyncio.sleep(_WORKER_POLL_SECONDS)
                else:
                    try:
                        await asyncio.wait_for(wake.wait(), timeout=_WORKER_POLL_SECONDS)
                        wake.clear()
                    except asyncio.TimeoutError:
                        pass

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(SERVER_DB_PATH)
        conn.row_factory = sqlite3.Row
        self._apply_connection_pragmas(conn)
        return conn

    @contextmanager
    def _db(self):
        conn = self._connect()
        try:
            yield conn
        finally:
            conn.close()

    def _apply_connection_pragmas(self, conn: sqlite3.Connection) -> None:
        conn.execute("PRAGMA foreign_keys=ON;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA busy_timeout=5000;")

    def _apply_database_pragmas(self, conn: sqlite3.Connection) -> None:
        conn.execute("PRAGMA journal_mode=WAL;")
        self._apply_connection_pragmas(conn)

    def _bootstrap_schema(self, conn: sqlite3.Connection) -> None:
        result = apply_migrations(
            conn,
            migrations_dir=_SERVER_MIGRATIONS_DIR,
            applied_at=utc_now(),
            backup_policy=BackupPolicy(
                directory=_SERVER_SCHEMA_BACKUP_DIR,
                database_name=SERVER_DB_PATH.stem,
            ),
        )
        if result.backup_path is not None:
            logger.info(
                "Applied server schema migrations %s with backup %s",
                list(result.applied_versions),
                result.backup_path,
            )
        elif result.applied_versions:
            logger.info("Applied server schema migrations %s", list(result.applied_versions))

    def _reset_queue_locks(self, conn: sqlite3.Connection) -> None:
        conn.execute("UPDATE message_queue SET locked_by = NULL, locked_at = NULL")
        conn.commit()

    def _seed_models(self, conn: sqlite3.Connection) -> None:
        now = utc_now()
        for model in get_model_registry().list_models():
            conn.execute(
                """
                INSERT INTO models(
                    name, provider, api_model_id, is_local, local_url,
                    context_window_tokens, max_output_tokens, metadata_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET
                    provider=excluded.provider,
                    api_model_id=excluded.api_model_id,
                    is_local=excluded.is_local,
                    local_url=excluded.local_url,
                    metadata_json=excluded.metadata_json,
                    updated_at=excluded.updated_at
                """,
                (
                    model.name,
                    model.provider,
                    model.name,
                    1 if model.provider == "ollama" else 0,
                    model.metadata.get("base_url") if isinstance(model.metadata, dict) else None,
                    None,
                    None,
                    _json(model.metadata),
                    now,
                    now,
                ),
            )
        conn.commit()

    def _seed_visible_directories(self, conn: sqlite3.Connection) -> None:
        now = utc_now()
        defaults = [
            (str(REPO_ROOT.resolve()), "read_only"),
            (str((DATA_DIR / "system_prompts").resolve()), "read_only"),
        ]
        for path, mode in defaults:
            conn.execute(
                """
                INSERT INTO visible_directories(path, access_mode, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(path) DO NOTHING
                """,
                (path, mode, now, now),
            )
        conn.commit()

    def _register_visible_directory(self, conn: sqlite3.Connection, path: Path, *, access_mode: str) -> None:
        now = utc_now()
        conn.execute(
            """
            INSERT INTO visible_directories(path, access_mode, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                access_mode=excluded.access_mode,
                updated_at=excluded.updated_at
            """,
            (str(path.resolve()), access_mode, now, now),
        )

    def refresh_local_models(self) -> list[dict[str, Any]]:
        self.initialize()
        with self._db() as conn:
            self._seed_models(conn)
            rows = conn.execute("SELECT * FROM models WHERE is_local = 1 ORDER BY name").fetchall()
            return [self._model_row_to_dict(row, include_client_shape=True) for row in rows]

    def list_models(self) -> list[dict[str, Any]]:
        self.initialize()
        with self._db() as conn:
            rows = conn.execute("SELECT * FROM models ORDER BY name").fetchall()
            return [self._model_row_to_dict(row, include_client_shape=True) for row in rows]

    def _model_row_to_dict(self, row: sqlite3.Row, *, include_client_shape: bool = False) -> dict[str, Any]:
        metadata: dict[str, Any] = {}
        if row["metadata_json"]:
            try:
                parsed = json.loads(row["metadata_json"])
                if isinstance(parsed, dict):
                    metadata = parsed
            except json.JSONDecodeError:
                metadata = {}

        item: dict[str, Any] = {
            "name": row["name"],
            "provider": row["provider"],
            "api_model_id": row["api_model_id"],
            "is_local": bool(row["is_local"]),
            "local_url": row["local_url"],
            "context_window_tokens": row["context_window_tokens"],
            "max_output_tokens": row["max_output_tokens"],
            "metadata_json": row["metadata_json"],
        }
        if include_client_shape:
            item.update(
                {
                    "source": "registry",
                    "metadata": metadata,
                    "is_default": row["name"] == configured_default_model(),
                }
            )
        return item

    def create_thread(
        self,
        *,
        thread_id: Optional[str] = None,
        name: Optional[str] = None,
        prev_thread_id: Optional[str] = None,
        start_turn_id: Optional[str] = None,
    ) -> str:
        self.initialize()
        resolved = thread_id or str(uuid.uuid4())
        resolved_name = (name or "").strip() or f"Thread {resolved[:8]}"
        now = utc_now()
        with self._db() as conn:
            conn.execute(
                """
                INSERT INTO threads(id, name, prev_thread_id, start_turn_id, is_archived, created_at, updated_at, tail_turn_id)
                VALUES (?, ?, ?, ?, 0, ?, ?, NULL)
                """,
                (resolved, resolved_name, prev_thread_id, start_turn_id, now, now),
            )
            conn.commit()
        return resolved

    def list_threads(self) -> list[dict[str, Any]]:
        self.initialize()
        with self._db() as conn:
            rows = conn.execute(
                """
                SELECT id, name, prev_thread_id, start_turn_id, is_archived, tail_turn_id, created_at, updated_at
                FROM threads
                WHERE is_archived = 0
                ORDER BY updated_at DESC
                """
            ).fetchall()
        return [
            {
                "thread_id": row["id"],
                "name": row["name"],
                "prev_thread_id": row["prev_thread_id"],
                "start_turn_id": row["start_turn_id"],
                "is_archived": bool(row["is_archived"]),
                "tail_turn_id": row["tail_turn_id"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]

    def create_vault(self, *, root_path: str, metadata_json: str | None = None) -> dict[str, Any]:
        self.initialize()
        resolved_root = canonicalize_path(root_path)
        ensure_parent = resolved_root.parent
        ensure_parent.mkdir(parents=True, exist_ok=True)
        if resolved_root.exists() and not resolved_root.is_dir():
            raise ValueError(f"Vault root must be a directory path: {resolved_root}")
        resolved_root.mkdir(parents=True, exist_ok=True)
        now = utc_now()
        with vault_db() as conn:
            validate_distinct_root(conn, resolved_root)
            cursor = conn.execute(
                """
                INSERT INTO vaults(root_path, metadata_json, created_at, updated_at, is_active)
                VALUES (?, ?, ?, ?, 1)
                """,
                (str(resolved_root), metadata_json, now, now),
            )
            conn.commit()
        with self._db() as conn:
            self._register_visible_directory(conn, resolved_root, access_mode="read_write")
            conn.commit()
        return {
            "vault_id": int(cursor.lastrowid),
            "root_path": str(resolved_root),
            "created": True,
        }

    def archive_thread(self, thread_id: str, *, archived: bool) -> None:
        self.initialize()
        with self._db() as conn:
            conn.execute(
                "UPDATE threads SET is_archived = ?, updated_at = ? WHERE id = ?",
                (1 if archived else 0, utc_now(), thread_id),
            )
            conn.commit()

    def create_session(self, thread_id: str, known_tail_turn_id: Optional[str]) -> SessionInfo:
        self.initialize()
        with self._db() as conn:
            exists = conn.execute("SELECT 1 FROM threads WHERE id = ?", (thread_id,)).fetchone()
        if exists is None:
            raise ProtocolError(f"Unknown thread '{thread_id}'")

        session = SessionInfo(
            session_id=str(uuid.uuid4()),
            thread_id=thread_id,
            known_tail_turn_id=known_tail_turn_id,
        )
        with self._session_lock:
            self._sessions[session.session_id] = session
        return session

    def attach_websocket(self, session_id: str, websocket: WebSocket) -> SessionInfo:
        with self._session_lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise ProtocolError("Unknown session")
            session.websocket = websocket
            return session

    def detach_websocket(self, session_id: str) -> None:
        self._drop_session(session_id)

    def _drop_session(self, session_id: str) -> None:
        with self._session_lock:
            self._sessions.pop(session_id, None)
            stale_queue_ids = [queue_id for queue_id, mapped in self._queue_delivery_map.items() if mapped == session_id]
            for queue_id in stale_queue_ids:
                self._queue_delivery_map.pop(queue_id, None)

    async def send_frame(self, websocket: WebSocket, session_id: str, frame_type: str, payload: dict[str, Any]) -> None:
        frame = {
            "protocol_version": PROTOCOL_VERSION,
            "type": frame_type,
            "session_id": session_id,
            "server_time": utc_now(),
            **payload,
        }
        await websocket.send_json(frame)

    async def _send_to_session(self, session: Optional[SessionInfo], frame_type: str, payload: dict[str, Any]) -> None:
        if session is None or session.websocket is None:
            return
        try:
            await self.send_frame(session.websocket, session.session_id, frame_type, payload)
        except Exception:  # noqa: BLE001
            self.detach_websocket(session.session_id)

    async def stream_handshake(self, session: SessionInfo, websocket: WebSocket) -> None:
        await self.send_frame(
            websocket,
            session.session_id,
            "handshake_snapshot_begin",
            {"thread_id": session.thread_id},
        )
        with self._db() as conn:
            turns = self._fetch_handshake_turns(conn, session.thread_id, session.known_tail_turn_id)
        for turn in turns:
            await self.send_frame(websocket, session.session_id, "committed_turn", {"turn": turn})

        context_messages = [
            Message(role=str(turn["speaker"]), content=str(turn["message_text"]))
            for turn in turns
            if str(turn.get("speaker", "")) in {"assistant", "user", "system"}
        ]
        provider = self._model_provider(configured_default_model())
        model_limits = resolve_model_properties(provider=provider, model=configured_default_model()).limits
        await self.send_frame(
            websocket,
            session.session_id,
            "context_budget",
            {
                "context_size": self._estimate_message_tokens(context_messages),
                "max_context_size": model_limits.context_window_tokens,
            },
        )

        await self.drain_thread_outstanding(session.thread_id)
        await self.send_frame(websocket, session.session_id, "handshake_ready", {})

    def _fetch_handshake_turns(
        self,
        conn: sqlite3.Connection,
        thread_id: str,
        known_tail_turn_id: Optional[str],
    ) -> list[dict[str, Any]]:
        raw_rows = self._walk_turn_chain(conn, thread_id, stop_at_turn_id=None, limit=None) or []
        visible_turns = self._serialize_visible_turns(raw_rows)
        if known_tail_turn_id:
            for idx, turn in enumerate(visible_turns):
                if turn["id"] == known_tail_turn_id:
                    return visible_turns[idx + 1 :]
            return visible_turns[-20:]
        return visible_turns[-20:]

    def _walk_turn_chain(
        self,
        conn: sqlite3.Connection,
        thread_id: str,
        *,
        stop_at_turn_id: Optional[str],
        limit: Optional[int],
    ) -> Optional[list[sqlite3.Row]]:
        tail_row = conn.execute("SELECT tail_turn_id FROM threads WHERE id = ?", (thread_id,)).fetchone()
        if tail_row is None or tail_row["tail_turn_id"] is None:
            return []

        rows_reversed: list[sqlite3.Row] = []
        current_id: Optional[str] = str(tail_row["tail_turn_id"])
        seen: set[str] = set()
        found_stop = stop_at_turn_id is None

        while current_id is not None:
            if current_id in seen:
                break
            seen.add(current_id)

            row = conn.execute(
                "SELECT * FROM turns WHERE id = ? AND thread_id = ?",
                (current_id, thread_id),
            ).fetchone()
            if row is None:
                break

            if stop_at_turn_id is not None and current_id == stop_at_turn_id:
                found_stop = True
                break

            rows_reversed.append(row)
            if limit is not None and len(rows_reversed) >= limit:
                break

            prev_turn = row["prev_turn_id"]
            current_id = str(prev_turn) if prev_turn is not None else None

        if stop_at_turn_id is not None and not found_stop:
            return None
        rows_reversed.reverse()
        return rows_reversed

    def _serialize_visible_turns(self, rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
        visible: list[dict[str, Any]] = []
        tool_calls: list[dict[str, Any]] = []
        by_tool_call_id: dict[str, dict[str, Any]] = {}
        trailing_tool_call_turn: sqlite3.Row | None = None
        self._validate_tool_response_links(rows)

        for row in rows:
            turn_type = str(row["turn_type"])
            if turn_type == "tool_call":
                trailing_tool_call_turn = row
                for tool_call in self._tool_calls_from_row(row):
                    tool_calls.append(tool_call)
                    by_tool_call_id[tool_call["id"]] = tool_call
                continue

            if turn_type == "tool_response":
                tool_call_id = row["tool_call_id"]
                if tool_call_id is None:
                    continue
                payload = by_tool_call_id.get(str(tool_call_id))
                if payload is None:
                    if self._is_synthetic_tool_response_row(row):
                        continue
                    continue
                payload["result"] = row["message_text"]
                response_stats = self._parse_json_object(row["stats_json"])
                payload["is_error"] = bool(response_stats.get("is_error")) if response_stats else False
                continue

            if turn_type != "assistant_message" and turn_type != "user_message":
                continue

            if tool_calls and trailing_tool_call_turn is not None:
                visible.append(self._assistant_tool_call_payload(trailing_tool_call_turn, tool_calls))
                tool_calls = []
                by_tool_call_id = {}
                trailing_tool_call_turn = None

            speaker = "assistant" if turn_type == "assistant_message" else "user"
            payload: dict[str, Any] = {
                "id": row["id"],
                "thread_id": row["thread_id"],
                "prev_turn_id": row["prev_turn_id"],
                "speaker": speaker,
                "message_text": row["message_text"],
                "model_name": row["model_name"],
                "created_at": row["created_at"],
            }
            visible.append(payload)
        if tool_calls and trailing_tool_call_turn is not None:
            payload = self._assistant_tool_call_payload(trailing_tool_call_turn, tool_calls)
            visible.append(payload)
        return visible

    def _parse_json_object(self, raw: Any) -> dict[str, Any]:
        if not isinstance(raw, str) or not raw.strip():
            return {}
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}

    def _parse_tool_calls_json(self, raw: Any) -> list[dict[str, Any]]:
        if not isinstance(raw, str) or not raw.strip():
            return []
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return []
        if not isinstance(parsed, list):
            return []
        calls: list[dict[str, Any]] = []
        for item in parsed:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            args = item.get("args")
            calls.append(
                {
                    "id": str(item.get("id") or f"tool-call-{uuid.uuid4().hex[:8]}"),
                    "name": name,
                    "args": args if isinstance(args, dict) else {},
                }
            )
        return calls

    def _normalize_tool_calls(self, tool_calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        for index, call in enumerate(tool_calls):
            if not isinstance(call, dict):
                raise ProtocolError(f"Generation emitted invalid tool call at index {index}")
            name = str(call.get("name") or "").strip()
            if not name:
                raise ProtocolError(f"Generation emitted tool call without a name at index {index}")
            args = call.get("args")
            normalized.append(
                {
                    "id": str(call.get("id") or f"tool-call-{uuid.uuid4().hex[:8]}"),
                    "name": name,
                    "args": args if isinstance(args, dict) else {},
                }
            )
        return normalized

    def _tool_calls_from_row(self, row: sqlite3.Row) -> list[dict[str, Any]]:
        return self._parse_tool_calls_json(row["tool_calls_json"])

    def _assistant_tool_call_payload(
        self,
        row: sqlite3.Row,
        tool_calls: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": row["id"],
            "thread_id": row["thread_id"],
            "prev_turn_id": row["prev_turn_id"],
            "speaker": "assistant",
            "message_text": row["message_text"],
            "model_name": row["model_name"],
            "created_at": row["created_at"],
        }
        payload["tool_calls"] = [dict(item) for item in (tool_calls or self._tool_calls_from_row(row))]
        return payload

    def _serialize_state_context_mutations(self, mutations: list[StateContextMutation]) -> str | None:
        if not mutations:
            return None
        return _json(
            [
                {
                    "context_type": mutation.context_type,
                    "key": mutation.key,
                    "operation": mutation.operation,
                    "target_key": mutation.target_key,
                }
                for mutation in mutations
            ]
        )

    def _state_context_mutations_from_row(self, row: sqlite3.Row) -> list[StateContextMutation]:
        raw = row["state_context_json"]
        if not isinstance(raw, str) or not raw.strip():
            return []
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return []
        if not isinstance(parsed, list):
            return []
        mutations: list[StateContextMutation] = []
        for item in parsed:
            if not isinstance(item, dict):
                continue
            context_type = str(item.get("context_type") or "").strip()
            key = str(item.get("key") or "").strip()
            operation = str(item.get("operation") or "").strip()
            target_key_raw = item.get("target_key")
            target_key = str(target_key_raw).strip() if isinstance(target_key_raw, str) and target_key_raw.strip() else None
            if context_type not in {"file", "directory"}:
                continue
            if operation not in {"read", "close", "rename"}:
                continue
            if not key:
                continue
            if operation == "rename" and not target_key:
                continue
            if operation != "rename":
                target_key = None
            mutations.append(StateContextMutation(context_type, key, operation, target_key))
        return mutations

    def _parse_json_string_list(self, raw: Any) -> list[str]:
        if not isinstance(raw, list):
            return []
        values: list[str] = []
        for item in raw:
            if isinstance(item, str) and item.strip():
                values.append(item.strip())
        return values

    def _is_synthetic_tool_response_row(self, row: sqlite3.Row) -> bool:
        stats = self._parse_json_object(row["stats_json"])
        return bool(stats.get("synthetic"))

    def _validate_tool_response_links(self, rows: list[sqlite3.Row]) -> None:
        seen_tool_call_ids: set[str] = set()
        for row in rows:
            turn_type = str(row["turn_type"])
            if turn_type == "tool_call":
                for tool_call in self._tool_calls_from_row(row):
                    seen_tool_call_ids.add(tool_call["id"])
                continue
            if turn_type != "tool_response":
                continue
            tool_call_id = row["tool_call_id"]
            if tool_call_id is None or self._is_synthetic_tool_response_row(row):
                continue
            if str(tool_call_id) not in seen_tool_call_ids:
                raise CorruptTurnChainError(
                    f"tool_response turn '{row['id']}' references unknown tool_call_id '{tool_call_id}'"
                )

    def _sort_state_keys(self, state_keys: list[StateContextKey]) -> list[StateContextKey]:
        return sorted(
            state_keys,
            key=lambda item: (0 if item.context_type == "directory" else 1, item.key.count("/"), item.key),
        )

    def _normalize_compaction_selection_entry(
        self,
        entry: Any,
        *,
        by_identity: dict[tuple[str, str], StateContextKey],
        by_key: dict[str, list[StateContextKey]],
    ) -> StateContextKey | None:
        if isinstance(entry, dict):
            context_type = entry.get("context_type")
            key = entry.get("key")
            if isinstance(context_type, str) and isinstance(key, str):
                return by_identity.get((context_type, key))
            return None
        if not isinstance(entry, str):
            return None
        candidates = by_key.get(entry.strip(), [])
        if len(candidates) == 1:
            return candidates[0]
        return None

    def _extract_json_object_from_text(self, text: str) -> dict[str, Any]:
        raw = text.strip()
        if not raw:
            return {}
        candidates = [raw]
        fenced = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", raw, flags=re.DOTALL)
        candidates.extend(fenced)
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            candidates.append(raw[start : end + 1])
        for candidate in candidates:
            try:
                parsed = json.loads(candidate)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                return parsed
        return {}

    def enqueue_message(
        self,
        *,
        thread_id: str,
        text: str,
        model_name: str,
        in_response_to_turn_id: Optional[str],
        client_message_id: Optional[str],
        session_id: Optional[str],
    ) -> int:
        self.initialize()
        now = utc_now()
        resolved_model = model_name.strip() or configured_default_model()
        with self._db() as conn:
            exists = conn.execute("SELECT id FROM threads WHERE id = ?", (thread_id,)).fetchone()
            if exists is None:
                raise ProtocolError(f"Unknown thread '{thread_id}'")
            cur = conn.execute(
                """
                INSERT INTO message_queue(
                    thread_id, response_to_turn_id, sender, message_text, model_name,
                    client_message_id, enqueued_at, available_at
                ) VALUES (?, ?, 'user', ?, ?, ?, ?, ?)
                """,
                (thread_id, in_response_to_turn_id, text, resolved_model, client_message_id, now, now),
            )
            conn.commit()
            queue_id = int(cur.lastrowid)

        with self._session_lock:
            self._queue_delivery_map[queue_id] = session_id
        wake = self._worker_wake
        loop = self._worker_loop_event_loop
        if wake is not None:
            if loop is not None:
                loop.call_soon_threadsafe(wake.set)
            else:
                wake.set()
        return queue_id

    def _bind_request_to_queue(self, queue_id: int, request_id: str) -> None:
        with self._session_lock:
            self._queue_request_map[queue_id] = request_id

    def _clear_request_for_queue(self, queue_id: int) -> None:
        with self._session_lock:
            self._queue_request_map.pop(queue_id, None)

    def _request_id_for_queue(self, queue_id: int) -> Optional[str]:
        with self._session_lock:
            return self._queue_request_map.get(queue_id)

    def _mark_request_failed_for_queue(self, queue_id: int, message: str) -> None:
        request_id = self._request_id_for_queue(queue_id)
        if request_id is None:
            return
        with self._db() as conn:
            conn.execute(
                """
                UPDATE requests
                SET error_text = ?, completed_at = COALESCE(completed_at, ?)
                WHERE id = ? AND turn_id IS NULL
                """,
                (message, utc_now(), request_id),
            )
            conn.commit()
        self._clear_request_for_queue(queue_id)

    async def process_next_runnable(self) -> bool:
        self.initialize()
        claimed = self._claim_next_runnable_row()
        if claimed is None:
            return False
        await self._execute_claimed_row(claimed)
        return True

    async def drain_thread_outstanding(self, thread_id: str) -> None:
        while True:
            claimed = self._claim_next_runnable_row(thread_id=thread_id)
            if claimed is None:
                return
            await self._execute_claimed_row(claimed)

    def _claim_next_runnable_row(self, *, thread_id: Optional[str] = None) -> Optional[sqlite3.Row]:
        now = utc_now()
        with self._db() as conn:
            if thread_id is None:
                candidates = conn.execute(
                    """
                    SELECT mq.*, t.tail_turn_id, tail.turn_type AS tail_turn_type
                    FROM message_queue mq
                    JOIN threads t ON t.id = mq.thread_id
                    LEFT JOIN turns tail ON tail.id = t.tail_turn_id
                    WHERE mq.locked_by IS NULL AND mq.available_at <= ?
                    ORDER BY mq.available_at ASC, mq.enqueued_at ASC
                    """,
                    (now,),
                ).fetchall()
            else:
                candidates = conn.execute(
                    """
                    SELECT mq.*, t.tail_turn_id, tail.turn_type AS tail_turn_type
                    FROM message_queue mq
                    JOIN threads t ON t.id = mq.thread_id
                    LEFT JOIN turns tail ON tail.id = t.tail_turn_id
                    WHERE mq.thread_id = ? AND mq.locked_by IS NULL AND mq.available_at <= ?
                    ORDER BY mq.available_at ASC, mq.enqueued_at ASC
                    """,
                    (thread_id, now),
                ).fetchall()

            ranked: list[tuple[int, sqlite3.Row]] = []
            for candidate in candidates:
                tail_turn_type = candidate["tail_turn_type"]
                if tail_turn_type in {"tool_call", "tool_response"}:
                    if self._queue_row_matches_inflight_request(conn, candidate):
                        ranked.append((1, candidate))
                    continue
                if tail_turn_type == "user_message" and self._queue_row_matches_inflight_request(conn, candidate):
                    ranked.append((1, candidate))
                    continue
                ranked.append((0, candidate))

            if not ranked:
                return None

            ranked.sort(key=lambda item: (item[0], str(item[1]["available_at"]), str(item[1]["enqueued_at"]), int(item[1]["id"])))
            queue_id = int(ranked[0][1]["id"])
            updated = conn.execute(
                """
                UPDATE message_queue
                SET locked_by = ?, locked_at = ?
                WHERE id = ? AND locked_by IS NULL
                """,
                (self._worker_id, now, queue_id),
            )
            conn.commit()
            if updated.rowcount == 0:
                return None

            claimed = conn.execute("SELECT * FROM message_queue WHERE id = ?", (queue_id,)).fetchone()
            return claimed

    def _queue_row_matches_inflight_request(self, conn: sqlite3.Connection, queue_row: sqlite3.Row) -> bool:
        thread_id = str(queue_row["thread_id"])
        tail = conn.execute(
            """
            SELECT turns.id, turns.prev_turn_id, turns.turn_type, turns.message_text
            FROM threads
            JOIN turns ON turns.id = threads.tail_turn_id
            WHERE threads.id = ?
            """,
            (thread_id,),
        ).fetchone()
        if tail is None or tail["turn_type"] not in {"user_message", "tool_call", "tool_response"}:
            return False

        current_id = str(tail["id"])
        seen: set[str] = set()
        while current_id:
            if current_id in seen:
                raise CorruptTurnChainError("cycle detected while resolving in-flight request state")
            seen.add(current_id)
            row = conn.execute(
                "SELECT id, prev_turn_id, turn_type, message_text FROM turns WHERE id = ? AND thread_id = ?",
                (current_id, thread_id),
            ).fetchone()
            if row is None:
                return False
            turn_type = str(row["turn_type"])
            if turn_type == "user_message":
                return (
                    row["prev_turn_id"] == queue_row["response_to_turn_id"]
                    and str(row["message_text"]) == str(queue_row["message_text"])
                )
            if turn_type not in {"tool_call", "tool_response"}:
                return False
            prev_turn_id = row["prev_turn_id"]
            current_id = str(prev_turn_id) if prev_turn_id is not None else ""
        return False

    async def _execute_claimed_row(self, queue_row: sqlite3.Row) -> None:
        queue_id = int(queue_row["id"])
        thread_id = str(queue_row["thread_id"])
        expected_tail = queue_row["response_to_turn_id"]

        session = self._session_for_queue(queue_id=queue_id, thread_id=thread_id)

        with self._db() as conn:
            thread_row = conn.execute(
                """
                SELECT threads.tail_turn_id, turns.turn_type AS tail_turn_type
                FROM threads
                LEFT JOIN turns ON turns.id = threads.tail_turn_id
                WHERE threads.id = ?
                """,
                (thread_id,),
            ).fetchone()

        if thread_row is None:
            await self._move_to_fatal_error(
                queue_row,
                "thread_validation",
                FatalExecutionError(f"Unknown thread '{thread_id}'"),
            )
            return

        actual_tail = thread_row["tail_turn_id"]
        inflight_state = InflightRequestState(is_continuation=False, user_turn_id=None)
        if thread_row["tail_turn_type"] in {"tool_call", "tool_response"}:
            with self._db() as conn:
                if self._queue_row_matches_inflight_request(conn, queue_row):
                    inflight_state = self._load_inflight_request_state(conn, thread_id)
                else:
                    await self._release_queue_row(queue_id)
                    return
        elif thread_row["tail_turn_type"] == "user_message":
            with self._db() as conn:
                if self._queue_row_matches_inflight_request(conn, queue_row):
                    inflight_state = self._load_inflight_request_state(conn, thread_id)
        elif expected_tail != actual_tail:
            with self._db() as conn:
                conn.execute("DELETE FROM message_queue WHERE id = ?", (queue_id,))
                conn.commit()
            self._mark_request_failed_for_queue(queue_id, "execution_conflict: stale thread tail before execution")
            await self._send_to_session(
                session,
                "execution_conflict",
                {
                    "queue_id": queue_id,
                    "expected_tail_turn_id": expected_tail,
                    "actual_tail_turn_id": actual_tail,
                },
            )
            self._clear_delivery_map(queue_id)
            return

        await self._send_to_session(
            session,
            "turn_event",
            {"queue_id": queue_id, "event": "execution_started"},
        )

        model_name = str(queue_row["model_name"] or configured_default_model())
        if not inflight_state.is_continuation:
            try:
                user_turn = self._append_user_turn(
                    thread_id=thread_id,
                    expected_tail=expected_tail,
                    message_text=str(queue_row["message_text"]),
                )
            except Exception as exc:  # noqa: BLE001
                if self._is_fatal_error(exc):
                    await self._move_to_fatal_error(queue_row, "commit", exc)
                else:
                    await self._retry_nonfatal(queue_row, exc)
                return
            inflight_state = InflightRequestState(is_continuation=True, user_turn_id=str(user_turn["id"]))
            await self._send_to_session(session, "committed_turn", {"turn": user_turn})

        try:
            with self._db() as conn:
                tail_row = conn.execute(
                    """
                    SELECT turns.*
                    FROM threads
                    JOIN turns ON turns.id = threads.tail_turn_id
                    WHERE threads.id = ?
                    """,
                    (thread_id,),
                ).fetchone()
            if tail_row is None:
                raise FatalExecutionError(f"Unknown tail state for thread '{thread_id}'")

            tail_turn_type = str(tail_row["turn_type"])
            if tail_turn_type == "tool_call":
                self._commit_tool_response_step(
                    thread_id=thread_id,
                    model_name=model_name,
                    expected_tool_call_turn_id=str(tail_row["id"]),
                )
                await self._release_queue_row(queue_id)
                return

            if tail_turn_type not in {"user_message", "tool_response"}:
                raise FatalExecutionError(f"Unsupported runnable tail turn type '{tail_turn_type}'")

            with self._db() as conn:
                context_result = self._build_context_messages(conn, thread_id)
            context_messages, compaction_plan, final_context_size, max_context_size = await self._maybe_compact_thread_context(
                context_result=context_result,
                model_name=model_name,
            )
            await self._send_to_session(
                session,
                "context_budget",
                {"context_size": final_context_size, "max_context_size": max_context_size},
            )

            with self._db() as conn:
                latest = conn.execute("SELECT tail_turn_id FROM threads WHERE id = ?", (thread_id,)).fetchone()
            expected_generation_tail = latest["tail_turn_id"] if latest is not None else None

            request_id = str(uuid.uuid4())
            with self._db() as conn:
                conn.execute(
                    """
                    INSERT INTO requests(id, turn_id, model_name, request_json, input_tokens, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        request_id,
                        None,
                        model_name,
                        _json({"model": model_name, "messages": self._messages_to_payload(context_messages), "stream": True}),
                        self._estimate_message_tokens(context_messages),
                        utc_now(),
                    ),
                )
                conn.commit()
            self._bind_request_to_queue(queue_id, request_id)

            assistant_text, thinking_traces, tool_calls, elapsed_ms = await self._run_generation_with_stream(
                prompt_messages=context_messages,
                model_name=model_name,
                queue_id=queue_id,
                session=session,
            )
            if assistant_text is None:
                return

            committed_turn, finalized = self._commit_generation_step(
                thread_id=thread_id,
                model_name=model_name,
                queue_id=queue_id,
                expected_tail_turn_id=expected_generation_tail,
                assistant_text=assistant_text,
                tool_calls=tool_calls,
                thinking_traces=thinking_traces,
                request_id=request_id,
                elapsed_ms=elapsed_ms,
                compaction_plan=compaction_plan,
            )
            self._clear_request_for_queue(queue_id)

            if compaction_plan is not None:
                await self._send_to_session(
                    session,
                    "turn_event",
                    {"queue_id": queue_id, "event": "context_compaction", "payload": compaction_plan.payload},
                )
            if committed_turn is not None:
                await self._send_to_session(session, "committed_turn", {"turn": committed_turn})
            if finalized and committed_turn is not None:
                await self._send_to_session(session, "turn_finalized", {"queue_id": queue_id, "turn_id": committed_turn["id"]})
                self._clear_delivery_map(queue_id)
            else:
                await self._release_queue_row(queue_id)
        except Exception as exc:  # noqa: BLE001
            if self._is_fatal_error(exc):
                await self._move_to_fatal_error(queue_row, "commit", exc)
            else:
                await self._retry_nonfatal(queue_row, exc)
            return

    async def _release_queue_row(self, queue_id: int) -> None:
        with self._db() as conn:
            conn.execute(
                "UPDATE message_queue SET locked_by = NULL, locked_at = NULL WHERE id = ?",
                (queue_id,),
            )
            conn.commit()

    def _load_inflight_request_state(self, conn: sqlite3.Connection, thread_id: str) -> InflightRequestState:
        tail_row = conn.execute(
            """
            SELECT turns.id
            FROM threads
            JOIN turns ON turns.id = threads.tail_turn_id
            WHERE threads.id = ?
            """,
            (thread_id,),
        ).fetchone()
        if tail_row is None:
            return InflightRequestState(is_continuation=False, user_turn_id=None)

        current_id = str(tail_row["id"])
        seen: set[str] = set()
        while current_id:
            if current_id in seen:
                raise CorruptTurnChainError("cycle detected while loading in-flight request")
            seen.add(current_id)
            row = conn.execute(
                "SELECT id, prev_turn_id, turn_type FROM turns WHERE id = ? AND thread_id = ?",
                (current_id, thread_id),
            ).fetchone()
            if row is None:
                return InflightRequestState(is_continuation=False, user_turn_id=None)
            turn_type = str(row["turn_type"])
            if turn_type == "user_message":
                return InflightRequestState(is_continuation=True, user_turn_id=str(row["id"]))
            if turn_type not in {"tool_call", "tool_response"}:
                return InflightRequestState(is_continuation=False, user_turn_id=None)
            prev_turn_id = row["prev_turn_id"]
            current_id = str(prev_turn_id) if prev_turn_id is not None else ""
        return InflightRequestState(is_continuation=False, user_turn_id=None)

    def _append_user_turn(self, *, thread_id: str, expected_tail: Any, message_text: str) -> dict[str, Any]:
        turn_id = str(uuid.uuid4())
        now = utc_now()
        with self._db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            latest = conn.execute("SELECT tail_turn_id FROM threads WHERE id = ?", (thread_id,)).fetchone()
            if latest is None or latest["tail_turn_id"] != expected_tail:
                conn.rollback()
                raise FatalExecutionError("execution_conflict: tail changed before user turn commit")
            conn.execute(
                """
                INSERT INTO turns(
                    id, thread_id, prev_turn_id, turn_type, actor_name, message_text,
                    tool_call_id, tool_name, tool_calls_json,
                    state_context_json,
                    stats_json, model_name, created_at
                )
                VALUES (?, ?, ?, 'user_message', 'user', ?, NULL, NULL, NULL, NULL, NULL, NULL, ?)
                """,
                (turn_id, thread_id, expected_tail, message_text, now),
            )
            conn.execute(
                "UPDATE threads SET tail_turn_id = ?, updated_at = ? WHERE id = ?",
                (turn_id, now, thread_id),
            )
            conn.commit()
        return {
            "id": turn_id,
            "thread_id": thread_id,
            "prev_turn_id": expected_tail,
            "speaker": "user",
            "message_text": message_text,
            "model_name": None,
            "created_at": now,
        }

    def _commit_generation_step(
        self,
        *,
        thread_id: str,
        model_name: str,
        queue_id: int,
        expected_tail_turn_id: Any,
        assistant_text: str,
        tool_calls: list[dict[str, Any]],
        thinking_traces: list[str],
        request_id: str,
        elapsed_ms: int,
        compaction_plan: CompactionPlan | None,
    ) -> tuple[dict[str, Any] | None, bool]:
        now = utc_now()
        normalized_tool_calls = self._normalize_tool_calls(tool_calls)
        if tool_calls and not normalized_tool_calls:
            raise ProtocolError("Generation entered tool-request branch with an empty tool-call list")
        with self._db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            latest = conn.execute("SELECT tail_turn_id FROM threads WHERE id = ?", (thread_id,)).fetchone()
            if latest is None:
                conn.rollback()
                raise FatalExecutionError(f"Unknown thread '{thread_id}'")
            if latest["tail_turn_id"] != expected_tail_turn_id:
                conn.rollback()
                raise FatalExecutionError("execution_conflict: tail changed before generation commit")
            prev_turn_id = latest["tail_turn_id"]

            if compaction_plan is not None:
                prev_turn_id = self._insert_compaction_turns(
                    conn,
                    thread_id=thread_id,
                    prev_turn_id=prev_turn_id,
                    summary_text=compaction_plan.summary_text,
                    open_state_keys=compaction_plan.open_state_keys,
                    model_name=model_name,
                    now=now,
                )

            if normalized_tool_calls:
                turn_id = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO turns(
                        id, thread_id, prev_turn_id, turn_type, actor_name, message_text,
                        tool_call_id, tool_name, tool_calls_json,
                        state_context_json,
                        stats_json, model_name, created_at
                    )
                    VALUES (?, ?, ?, 'tool_call', 'assistant', ?, NULL, NULL, ?, NULL, NULL, ?, ?)
                    """,
                    (
                        turn_id,
                        thread_id,
                        prev_turn_id,
                        "",
                        _json(normalized_tool_calls),
                        model_name,
                        now,
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO turn_events(turn_id, event_type, payload_json, created_at)
                    VALUES (?, 'model_request', ?, ?)
                    """,
                    (turn_id, _json({"model_name": model_name, "queue_id": queue_id}), now),
                )
                for idx, trace in enumerate(thinking_traces, start=1):
                    conn.execute(
                        """
                        INSERT INTO thinking_traces(turn_id, sequence_no, trace_text, created_at)
                        VALUES (?, ?, ?, ?)
                        """,
                        (turn_id, idx, trace, now),
                    )
                conn.execute(
                    "UPDATE threads SET tail_turn_id = ?, updated_at = ? WHERE id = ?",
                    (turn_id, now, thread_id),
                )
                conn.execute(
                    """
                    UPDATE requests
                    SET turn_id = ?, response_json = ?, output_tokens = ?, latency_ms = ?, completed_at = ?
                    WHERE id = ?
                    """,
                    (
                        turn_id,
                        _json({"tool_calls": normalized_tool_calls}),
                        0,
                        elapsed_ms,
                        utc_now(),
                        request_id,
                    ),
                )
                conn.commit()
                return (
                    {
                        "id": turn_id,
                        "thread_id": thread_id,
                        "prev_turn_id": prev_turn_id,
                        "speaker": "assistant",
                        "message_text": "",
                        "model_name": model_name,
                        "created_at": now,
                        "tool_calls": [dict(item) for item in normalized_tool_calls],
                    },
                    False,
                )

            assistant_turn_id = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO turns(
                    id, thread_id, prev_turn_id, turn_type, actor_name, message_text,
                    tool_call_id, tool_name, tool_calls_json,
                    state_context_json,
                    stats_json, model_name, created_at
                )
                VALUES (?, ?, ?, 'assistant_message', 'assistant', ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
                """,
                (assistant_turn_id, thread_id, prev_turn_id, assistant_text, model_name, now),
            )
            conn.execute(
                """
                INSERT INTO turn_events(turn_id, event_type, payload_json, created_at)
                VALUES (?, 'model_request', ?, ?)
                """,
                (assistant_turn_id, _json({"model_name": model_name, "queue_id": queue_id}), now),
            )
            conn.execute(
                """
                INSERT INTO turn_events(turn_id, event_type, payload_json, created_at)
                VALUES (?, 'assistant_stream_complete', ?, ?)
                """,
                (assistant_turn_id, _json({"queue_id": queue_id, "token_count": self._estimate_tokens(assistant_text)}), now),
            )
            for idx, trace in enumerate(thinking_traces, start=1):
                conn.execute(
                    """
                    INSERT INTO thinking_traces(turn_id, sequence_no, trace_text, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (assistant_turn_id, idx, trace, now),
                )
            conn.execute(
                "UPDATE threads SET tail_turn_id = ?, updated_at = ? WHERE id = ?",
                (assistant_turn_id, now, thread_id),
            )
            conn.execute("DELETE FROM message_queue WHERE id = ?", (queue_id,))
            conn.execute(
                """
                UPDATE requests
                SET turn_id = ?, response_json = ?, output_tokens = ?, latency_ms = ?, completed_at = ?
                WHERE id = ?
                """,
                (
                    assistant_turn_id,
                    _json({"response": assistant_text}),
                    self._estimate_tokens(assistant_text),
                    elapsed_ms,
                    utc_now(),
                    request_id,
                ),
            )
            conn.commit()
        payload = {
            "id": assistant_turn_id,
            "thread_id": thread_id,
            "prev_turn_id": prev_turn_id,
            "speaker": "assistant",
            "message_text": assistant_text,
            "model_name": model_name,
            "created_at": now,
        }
        return payload, True

    def _commit_tool_response_step(
        self,
        *,
        thread_id: str,
        model_name: str,
        expected_tool_call_turn_id: str,
    ) -> dict[str, Any]:
        with self._db() as conn:
            tail = conn.execute(
                "SELECT * FROM turns WHERE id = ? AND thread_id = ?",
                (expected_tool_call_turn_id, thread_id),
            ).fetchone()
        if tail is None or str(tail["turn_type"]) != "tool_call":
            raise FatalExecutionError("execution_conflict: expected tail tool_call before tool execution")

        requested_calls = self._tool_calls_from_row(tail)
        if not requested_calls:
            raise FatalExecutionError(f"tool_call turn '{expected_tool_call_turn_id}' does not contain any requested calls")

        executed_calls: list[tuple[ToolCall, list[StateContextMutation]]] = []
        for requested_call in requested_calls:
            tool_name = requested_call["name"]
            tool_args = requested_call["args"]
            planned_mutations = self._state_context_mutations_for_tool_invocation(tool_name, tool_args)
            executed = self._execute_tool_call(
                ToolCall(
                    id=requested_call["id"],
                    name=tool_name,
                    args=tool_args,
                    result="",
                    is_error=False,
                )
            )
            executed_calls.append((executed, planned_mutations if not executed.is_error else []))

        first_tool_response_turn_id: str | None = None
        now = utc_now()

        with self._db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            latest = conn.execute("SELECT tail_turn_id FROM threads WHERE id = ?", (thread_id,)).fetchone()
            if latest is None or latest["tail_turn_id"] != expected_tool_call_turn_id:
                conn.rollback()
                raise FatalExecutionError("execution_conflict: tail changed before tool response commit")
            prev_turn_id = expected_tool_call_turn_id
            for executed, mutations in executed_calls:
                tool_response_turn_id = str(uuid.uuid4())
                if first_tool_response_turn_id is None:
                    first_tool_response_turn_id = tool_response_turn_id
                conn.execute(
                    """
                    INSERT INTO turns(
                        id, thread_id, prev_turn_id, turn_type, actor_name, message_text,
                        tool_call_id, tool_name, tool_calls_json,
                        state_context_json,
                        stats_json, model_name, created_at
                    )
                    VALUES (?, ?, ?, 'tool_response', ?, ?, ?, ?, NULL, ?, ?, ?, ?)
                    """,
                    (
                        tool_response_turn_id,
                        thread_id,
                        prev_turn_id,
                        executed.name,
                        executed.result,
                        executed.id,
                        executed.name,
                        self._serialize_state_context_mutations(mutations),
                        _json({"is_error": executed.is_error}),
                        model_name,
                        now,
                    ),
                )
                prev_turn_id = tool_response_turn_id
                conn.execute(
                    """
                    INSERT INTO turn_events(turn_id, event_type, tool_name, tool_args_json, payload_json, created_at)
                    VALUES (?, 'tool_use', ?, ?, ?, ?)
                    """,
                    (
                        tool_response_turn_id,
                        executed.name,
                        _json(executed.args),
                        _json(
                            {
                                "id": executed.id,
                                "name": executed.name,
                                "args": executed.args,
                                "result": executed.result,
                                "is_error": executed.is_error,
                            }
                        ),
                        now,
                    ),
                )
            conn.execute(
                "UPDATE threads SET tail_turn_id = ?, updated_at = ? WHERE id = ?",
                (prev_turn_id, now, thread_id),
            )
            conn.commit()
        return {
            "id": first_tool_response_turn_id,
            "thread_id": thread_id,
            "prev_turn_id": expected_tool_call_turn_id,
            "speaker": "tool",
            "message_text": executed_calls[0][0].result,
            "model_name": model_name,
            "created_at": now,
            "tool_call_id": executed_calls[0][0].id,
        }

    def _execute_tool_call(self, call: ToolCall) -> ToolCall:
        if call.is_error:
            return call
        tool = self._tools.get(call.name)
        if tool is None:
            return ToolCall(
                id=call.id,
                name=call.name,
                args=call.args,
                result=f"Tool error: unknown tool '{call.name}'",
                is_error=True,
            )
        try:
            return ToolCall(
                id=call.id,
                name=call.name,
                args=call.args,
                result=str(tool.invoke(call.args)),
                is_error=False,
            )
        except Exception as exc:  # noqa: BLE001
            return ToolCall(
                id=call.id,
                name=call.name,
                args=call.args,
                result=f"Tool error: {exc}",
                is_error=True,
            )

    def _state_context_mutations_for_tool_invocation(
        self,
        tool_name: str,
        args: dict[str, Any],
    ) -> list[StateContextMutation]:
        if tool_name == "read_file":
            return [StateContextMutation("file", canonicalize_path(args.get("path", "")).as_posix(), "read")]
        if tool_name == "list_directory":
            path = args.get("path", ".")
            canonical = canonicalize_path(path if path != "." else REPO_ROOT)
            return [StateContextMutation("directory", canonical.as_posix(), "read")]
        if tool_name == "create_file":
            return [StateContextMutation("file", canonicalize_path(args.get("path", "")).as_posix(), "read")]
        if tool_name == "apply_patch":
            return self._state_context_mutations_for_patch(args.get("patch"))
        if tool_name == "move_path":
            source = canonicalize_path(args.get("source_path", ""))
            destination = canonicalize_path(args.get("destination_path", ""))
            if not source.exists():
                return []
            context_type = "directory" if source.is_dir() else "file"
            return [StateContextMutation(context_type, source.as_posix(), "rename", destination.as_posix())]
        if tool_name == "delete_path":
            target = canonicalize_path(args.get("path", ""))
            if not target.exists():
                return []
            context_type = "directory" if target.is_dir() else "file"
            return [StateContextMutation(context_type, target.as_posix(), "close")]
        if tool_name == "close_file_context":
            return [StateContextMutation("file", canonicalize_path(args.get("path", "")).as_posix(), "close")]
        if tool_name == "close_directory_context":
            return [StateContextMutation("directory", canonicalize_path(args.get("path", "")).as_posix(), "close")]
        return []

    def _state_context_mutations_for_patch(self, patch_text: Any) -> list[StateContextMutation]:
        if not isinstance(patch_text, str):
            return []
        mutations: list[StateContextMutation] = []
        for operation in parse_patch_envelope(patch_text):
            target = canonicalize_path(operation.path)
            if operation.kind == "delete":
                mutations.append(StateContextMutation("file", target.as_posix(), "close"))
                continue
            mutations.append(StateContextMutation("file", target.as_posix(), "read"))
        return mutations

    def _messages_to_payload(self, messages: list[Message]) -> list[dict[str, Any]]:
        payload: list[dict[str, Any]] = []
        for message in messages:
            item: dict[str, Any] = {"role": message.role, "content": message.content}
            if message.tool_call_id is not None:
                item["tool_call_id"] = message.tool_call_id
            if message.tool_calls is not None:
                item["tool_calls"] = message.tool_calls
            payload.append(item)
        return payload

    async def _run_generation_with_stream(
        self,
        *,
        prompt_messages: list[Message],
        model_name: str,
        queue_id: int,
        session: Optional[SessionInfo],
    ) -> tuple[Optional[str], list[str], list[dict[str, Any]], int]:
        token_queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()
        loop = asyncio.get_running_loop()
        started = time.perf_counter()

        def _on_token(token: str) -> None:
            loop.call_soon_threadsafe(token_queue.put_nowait, ("token", token))

        def _on_thinking(trace: str) -> None:
            loop.call_soon_threadsafe(token_queue.put_nowait, ("thinking", trace))

        def _run_sync() -> tuple[str, list[dict[str, Any]]]:
            dispatcher = build_dispatcher(model_override=model_name)
            result = dispatcher.stream_generate_with_details(
                prompt_messages,
                on_token=_on_token,
                on_thinking=_on_thinking,
                enable_tools=True,
            )
            calls = [
                {
                    "id": item.id,
                    "name": item.name,
                    "args": item.args,
                    "result": item.result,
                    "is_error": item.is_error,
                }
                for item in result.tool_calls
            ]
            return result.response, calls

        worker = asyncio.create_task(asyncio.to_thread(_run_sync))

        full: list[str] = []
        traces: list[str] = []
        try:
            while True:
                if worker.done() and token_queue.empty():
                    break
                try:
                    kind, value = await asyncio.wait_for(token_queue.get(), timeout=0.1)
                except asyncio.TimeoutError:
                    continue
                if kind == "token":
                    token = str(value)
                    full.append(token)
                    await self._send_to_session(
                        session,
                        "assistant_token",
                        {"queue_id": queue_id, "chunk": token},
                    )
                    if len(full) % 25 == 0:
                        trace = f"streamed_{len(full)}_chunks"
                        await self._send_to_session(
                            session,
                            "turn_event",
                            {
                                "queue_id": queue_id,
                                "event": "thinking_trace",
                                "trace": trace,
                                "trace_kind": "operational",
                            },
                        )
                elif kind == "thinking":
                    trace = str(value)
                    is_reasoning = self._is_reasoning_trace(trace)
                    if is_reasoning:
                        traces.append(trace)
                    await self._send_to_session(
                        session,
                        "turn_event",
                        {
                            "queue_id": queue_id,
                            "event": "thinking_trace",
                            "trace": trace,
                            "trace_kind": "model_reasoning" if is_reasoning else "operational",
                        },
                    )

            response, tool_calls = await worker
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            return response, traces, tool_calls, elapsed_ms
        except Exception as exc:  # noqa: BLE001
            worker.cancel()
            if self._is_fatal_error(exc):
                await self._move_to_fatal_error_from_values(
                    queue_id=queue_id,
                    stage="generation",
                    error=exc,
                )
                return None, [], [], 0
            await self._retry_nonfatal_by_id(queue_id, exc)
            await self._send_to_session(
                session,
                "error",
                {"queue_id": queue_id, "message": str(exc)},
            )
            return None, [], [], 0

    def _is_fatal_error(self, exc: Exception) -> bool:
        fatal_types: tuple[type[BaseException], ...] = (
            ProtocolError,
            FatalExecutionError,
            UnsupportedModelError,
            ProviderConfigurationError,
        )
        openai_types = tuple(
            t
            for t in (
                OpenAIAuthenticationError,
                OpenAIBadRequestError,
                OpenAINotFoundError,
                OpenAIPermissionDeniedError,
            )
            if t is not None
        )
        return isinstance(exc, fatal_types + openai_types)

    def _is_reasoning_trace(self, trace: str) -> bool:
        operational_prefixes = (
            "openai_request_started_round_",
            "openai_request_completed_round_",
            "tool_call_",
            "ollama_request_started",
            "ollama_request_completed",
        )
        if trace.startswith(operational_prefixes):
            return False
        if _STREAM_PROGRESS_TRACE.match(trace):
            return False
        return True

    async def _retry_nonfatal(self, queue_row: sqlite3.Row, exc: Exception) -> None:
        queue_id = int(queue_row["id"])
        attempts = int(queue_row["attempts"]) + 1
        delay = min(_RETRY_MAX_SECONDS, _RETRY_BASE_SECONDS * (2 ** max(0, attempts - 1)))
        with self._db() as conn:
            conn.execute(
                """
                UPDATE message_queue
                SET attempts = ?,
                    available_at = ?,
                    locked_by = NULL,
                    locked_at = NULL,
                    last_error = ?
                WHERE id = ?
                """,
                (attempts, utc_after(delay), str(exc), queue_id),
            )
            conn.commit()
        self._mark_request_failed_for_queue(queue_id, f"retry_scheduled: {exc}")

        session = self._session_for_queue(queue_id=queue_id, thread_id=str(queue_row["thread_id"]))
        await self._send_to_session(
            session,
            "turn_event",
            {
                "queue_id": queue_id,
                "event": "retry_scheduled",
                "attempt": attempts,
                "retry_in_seconds": delay,
                "error": str(exc),
            },
        )

    async def _retry_nonfatal_by_id(self, queue_id: int, exc: Exception) -> None:
        with self._db() as conn:
            row = conn.execute("SELECT * FROM message_queue WHERE id = ?", (queue_id,)).fetchone()
        if row is None:
            return
        await self._retry_nonfatal(row, exc)

    async def _move_to_fatal_error(self, queue_row: sqlite3.Row, stage: str, error: Exception) -> None:
        queue_id = int(queue_row["id"])
        self._mark_request_failed_for_queue(queue_id, f"fatal_error[{stage}]: {error}")
        with self._db() as conn:
            conn.execute(
                """
                INSERT INTO queue_errors(
                    queue_id, thread_id, response_to_turn_id, model_name, message_text,
                    attempts, error_type, error_text, failure_stage, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    queue_id,
                    str(queue_row["thread_id"]),
                    queue_row["response_to_turn_id"],
                    str(queue_row["model_name"]),
                    str(queue_row["message_text"]),
                    int(queue_row["attempts"]),
                    error.__class__.__name__,
                    str(error),
                    stage,
                    utc_now(),
                ),
            )
            conn.execute("DELETE FROM message_queue WHERE id = ?", (queue_id,))
            conn.commit()

        session = self._session_for_queue(queue_id=queue_id, thread_id=str(queue_row["thread_id"]))
        await self._send_to_session(
            session,
            "error",
            {
                "queue_id": queue_id,
                "message": str(error),
                "fatal": True,
            },
        )
        self._clear_delivery_map(queue_id)

    async def _move_to_fatal_error_from_values(self, *, queue_id: int, stage: str, error: Exception) -> None:
        with self._db() as conn:
            row = conn.execute("SELECT * FROM message_queue WHERE id = ?", (queue_id,)).fetchone()
        if row is not None:
            await self._move_to_fatal_error(row, stage, error)

    def _session_for_queue(self, *, queue_id: int, thread_id: str) -> Optional[SessionInfo]:
        with self._session_lock:
            session_id = self._queue_delivery_map.get(queue_id)
            if session_id is not None:
                session = self._sessions.get(session_id)
                if session is not None and session.websocket is not None:
                    return session
            for session in self._sessions.values():
                if session.thread_id == thread_id and session.websocket is not None:
                    return session
        return None

    def _clear_delivery_map(self, queue_id: int) -> None:
        with self._session_lock:
            self._queue_delivery_map.pop(queue_id, None)

    def _load_thread_messages(self, conn: sqlite3.Connection, thread_id: str) -> list[Message]:
        return self._build_context_messages(conn, thread_id).messages

    def _build_context_messages(self, conn: sqlite3.Connection, thread_id: str) -> ContextBuildResult:
        rows_rev: list[sqlite3.Row] = []
        tail_row = conn.execute("SELECT tail_turn_id FROM threads WHERE id = ?", (thread_id,)).fetchone()
        if tail_row is None or tail_row["tail_turn_id"] is None:
            messages: list[Message] = []
            system_prompt = self._load_active_system_prompt()
            if system_prompt:
                messages.append(Message(role="system", content=system_prompt))
            return ContextBuildResult(messages=messages, open_state_keys=[])

        current_id: str | None = str(tail_row["tail_turn_id"])
        seen_turn_ids: set[str] = set()
        while current_id is not None:
            if current_id in seen_turn_ids:
                raise CorruptTurnChainError("cycle detected in turns.prev_turn_id chain")
            seen_turn_ids.add(current_id)
            turn = conn.execute(
                "SELECT * FROM turns WHERE id = ? AND thread_id = ?",
                (current_id, thread_id),
            ).fetchone()
            if turn is None:
                break
            rows_rev.append(turn)
            if str(turn["turn_type"]) == "compaction":
                break
            prev_turn_id = turn["prev_turn_id"]
            current_id = str(prev_turn_id) if prev_turn_id is not None else None

        self._validate_tool_response_links(list(reversed(rows_rev)))

        file_alias_map: dict[str, str] = {}
        dir_alias_map: dict[str, str] = {}
        state_map: dict[StateContextKey, str] = {}
        injections_by_turn_id: dict[str, list[StateContextKey]] = {}

        def resolve_directory_key(dir_key: str) -> str:
            node = canonicalize_path(dir_key).as_posix()
            chain_seen: set[str] = set()
            while node in dir_alias_map:
                if node in chain_seen:
                    raise CorruptStateContextError("cycle detected in state context rename aliases")
                chain_seen.add(node)
                next_node = dir_alias_map[node]
                if next_node == node:
                    break
                node = next_node
            return node

        def resolve_file_key(file_key: str) -> str:
            path = canonicalize_path(file_key).as_posix()
            chain_seen: set[str] = set()
            while path in file_alias_map:
                if path in chain_seen:
                    raise CorruptStateContextError("cycle detected in file rename aliases")
                chain_seen.add(path)
                next_path = file_alias_map[path]
                if next_path == path:
                    break
                path = next_path
            while True:
                matched = False
                for source_dir in sorted(dir_alias_map.keys(), key=len, reverse=True):
                    if path == source_dir or path.startswith(f"{source_dir}/"):
                        target_dir = resolve_directory_key(dir_alias_map[source_dir])
                        suffix = path[len(source_dir) :]
                        path = f"{target_dir}{suffix}"
                        matched = True
                        break
                if not matched:
                    break
            return path

        def resolve_key(context_type: str, context_key: str) -> StateContextKey:
            if context_type == "directory":
                return StateContextKey(context_type, resolve_directory_key(context_key))
            return StateContextKey(context_type, resolve_file_key(context_key))

        for turn in rows_rev:
            row_mutations = self._state_context_mutations_from_row(turn)
            if not row_mutations:
                continue
            for mutation in reversed(row_mutations):
                operation = mutation.operation
                context_type = mutation.context_type
                context_key = mutation.key
                if operation == "rename":
                    target_key = str(mutation.target_key or "")
                    if context_type == "directory":
                        source_dir = resolve_directory_key(context_key)
                        dest_dir = resolve_directory_key(target_key)
                        if source_dir != dest_dir:
                            dir_alias_map[source_dir] = dest_dir
                    else:
                        source_file = resolve_file_key(context_key)
                        dest_file = resolve_file_key(target_key)
                        if source_file != dest_file:
                            file_alias_map[source_file] = dest_file
                    continue

                canonical_key = resolve_key(context_type, context_key)
                if canonical_key in state_map:
                    continue
                if operation == "close":
                    state_map[canonical_key] = "close"
                    continue
                state_map[canonical_key] = "read"
                injections_by_turn_id.setdefault(str(turn["id"]), []).append(canonical_key)

        rows = list(reversed(rows_rev))
        messages: list[Message] = []
        system_prompt = self._load_active_system_prompt()
        if system_prompt:
            messages.append(Message(role="system", content=system_prompt))

        pending_injections: list[StateContextKey] = []
        for index, turn in enumerate(rows):
            turn_message = self._message_from_turn(turn)
            if turn_message is not None:
                messages.append(turn_message)
            pending_injections.extend(injections_by_turn_id.get(str(turn["id"]), []))

            turn_type = str(turn["turn_type"])
            next_turn_type = str(rows[index + 1]["turn_type"]) if index + 1 < len(rows) else None
            should_flush_injections = bool(pending_injections) and (
                turn_type != "tool_response" or next_turn_type != "tool_response"
            )
            if not should_flush_injections:
                continue
            for state_key in pending_injections:
                if state_map.get(state_key) != "read":
                    continue
                messages.append(Message(role="system", content=self._render_state_injection(state_key)))
            pending_injections = []

        open_keys = self._sort_state_keys([key for key, state in state_map.items() if state == "read"])
        return ContextBuildResult(messages=messages, open_state_keys=open_keys)

    def _message_from_turn(self, row: sqlite3.Row) -> Message | None:
        turn_type = str(row["turn_type"])
        if turn_type == "user_message":
            return Message(role="user", content=str(row["message_text"]))
        if turn_type == "assistant_message":
            return Message(role="assistant", content=str(row["message_text"]))
        if turn_type == "tool_call":
            tool_calls = []
            for tool_call in self._tool_calls_from_row(row):
                tool_calls.append(
                    {
                        "id": tool_call["id"],
                        "type": "function",
                        "function": {
                            "name": tool_call["name"],
                            "arguments": _json(tool_call["args"]),
                        },
                    }
                )
            return Message(
                role="assistant",
                content="",
                tool_calls=tool_calls,
            )
        if turn_type == "tool_response":
            return Message(role="tool", content=str(row["message_text"]), tool_call_id=str(row["tool_call_id"]))
        if turn_type == "compaction":
            return Message(role="system", content=str(row["message_text"]))
        return None

    def _render_state_injection(self, state_key: StateContextKey) -> str:
        path = Path(state_key.key)
        if not path.exists():
            return f"Cannot read {state_key.key}, it may have been moved or deleted."
        if state_key.context_type == "file":
            try:
                content = path.read_text(encoding="utf-8")
            except Exception as exc:  # noqa: BLE001
                return f"Cannot read {state_key.key}: {exc}"
            return f"File: {state_key.key}. This is the contents of this file:\n{content}"
        try:
            entries = sorted(item.name for item in path.iterdir())
        except Exception as exc:  # noqa: BLE001
            return f"Cannot read {state_key.key}: {exc}"
        listing = "\n".join(entries) if entries else "(empty)"
        return f"Directory: {state_key.key}. This is the current visible listing of this directory:\n{listing}"

    def _ensure_default_system_prompt(self) -> None:
        default_path = SYSTEM_PROMPTS_DIR / "sheaf_default.md"
        if default_path.exists():
            return
        default_path.write_text(_DEFAULT_SYSTEM_PROMPT.strip() + "\n", encoding="utf-8")

    def _load_active_system_prompt(self) -> str:
        configured_name = Path(configured_system_prompt_file()).name
        configured_path = SYSTEM_PROMPTS_DIR / configured_name
        if configured_path.exists():
            try:
                return configured_path.read_text(encoding="utf-8").strip()
            except OSError:
                return ""

        fallback = SYSTEM_PROMPTS_DIR / "sheaf_default.md"
        if fallback.exists():
            try:
                return fallback.read_text(encoding="utf-8").strip()
            except OSError:
                return ""
        return ""

    def _model_provider(self, model_name: str) -> str:
        descriptor = get_model_registry().resolve_model(model_name, allow_refresh=False)
        if descriptor is not None and descriptor.provider:
            return str(descriptor.provider)
        return "openai"

    def _estimate_tokens(self, text: str) -> int:
        # Deterministic approximation to avoid provider-specific tokenizers in worker hot path.
        return max(1, (len(text) + 3) // 4)

    def _estimate_message_tokens(self, messages: list[Message]) -> int:
        return sum(self._estimate_tokens(message.content) + 4 for message in messages)

    def _build_summary(self, messages: list[Message]) -> str:
        parts: list[str] = []
        for message in messages:
            flattened = " ".join(message.content.split())
            if len(flattened) > 240:
                flattened = flattened[:240] + "..."
            parts.append(f"{message.role}: {flattened}")
        return " | ".join(parts)

    async def _maybe_compact_thread_context(
        self,
        *,
        context_result: ContextBuildResult,
        model_name: str,
    ) -> tuple[list[Message], CompactionPlan | None, int, int]:
        provider = self._model_provider(model_name)
        properties = resolve_model_properties(provider=provider, model=model_name)
        limits = properties.limits
        max_context_size = limits.context_window_tokens
        prompt_messages = context_result.messages
        original_context_size = self._estimate_message_tokens(prompt_messages)

        trigger = int(max_context_size * limits.compaction_trigger_ratio)
        if original_context_size <= trigger or len(prompt_messages) <= 2:
            return prompt_messages, None, original_context_size, max_context_size

        keep_recent = min(max(1, limits.recent_messages_to_keep), max(1, len(prompt_messages) - 1))
        base_messages: list[Message] = []
        working = prompt_messages
        if prompt_messages and prompt_messages[0].role == "system":
            base_messages.append(prompt_messages[0])
            working = prompt_messages[1:]
            keep_recent = min(keep_recent, len(working)) if working else 0
        dropped = working[:-keep_recent] if keep_recent else working[:]
        kept = working[-keep_recent:] if keep_recent else []
        remain_open, selection_source = await self._select_open_state_keys_for_compaction(
            context_result=context_result,
            dropped=dropped,
            kept=kept,
            model_name=model_name,
        )
        summary = await self._summarize_for_compaction(dropped=dropped, model_name=model_name)
        summary_source = "llm"
        if not summary:
            summary = self._build_summary(dropped)
            summary_source = "deterministic_fallback"
        summary_text = f"Context compaction summary of earlier turns: {summary}"
        summary_message = Message(role="system", content=summary_text)
        compacted = [*base_messages, summary_message, *kept]

        target = int(max_context_size * limits.compaction_target_ratio)
        compacted_size = self._estimate_message_tokens(compacted)
        if compacted_size > target and summary_message.content:
            overflow = compacted_size - target
            trim_chars = overflow * 4
            summary_content = summary_message.content
            min_len = 80
            if len(summary_content) > min_len:
                clipped = summary_content[: max(min_len, len(summary_content) - trim_chars)]
                if len(clipped) < len(summary_content):
                    clipped = clipped.rstrip() + "..."
                summary_message = Message(role="system", content=clipped)
                compacted = [*base_messages, summary_message, *kept]
                compacted_size = self._estimate_message_tokens(compacted)

        payload = {
            "original_context_size": original_context_size,
            "compacted_context_size": compacted_size,
            "max_context_size": max_context_size,
            "dropped_message_count": len(dropped),
            "kept_recent_message_count": len(kept),
            "reopened_state_key_count": len(remain_open),
            "closed_state_key_count": max(0, len(context_result.open_state_keys) - len(remain_open)),
            "trigger_ratio": limits.compaction_trigger_ratio,
            "target_ratio": limits.compaction_target_ratio,
            "selection_source": selection_source,
            "summary_source": summary_source,
        }
        return compacted, CompactionPlan(summary_text=summary_text, open_state_keys=remain_open, payload=payload), compacted_size, max_context_size

    async def _select_open_state_keys_for_compaction(
        self,
        *,
        context_result: ContextBuildResult,
        dropped: list[Message],
        kept: list[Message],
        model_name: str,
    ) -> tuple[list[StateContextKey], str]:
        open_state_keys = self._sort_state_keys(list(context_result.open_state_keys))
        if not open_state_keys:
            return [], "no_open_state"

        selection_prompt = [
            Message(
                role="system",
                content=(
                    "You are selecting which already-open filesystem context blocks should remain open after "
                    "compaction. Return JSON only with keys remain_open and close. Each list item must be either "
                    "a string path or an object with context_type and key. Do not repeat file contents. Preserve "
                    "only context that is still actively needed."
                ),
            ),
            *context_result.messages,
            Message(
                role="user",
                content=(
                    "Choose the post-compaction open state.\n"
                    f"Currently open keys: {_json([{'context_type': item.context_type, 'key': item.key} for item in open_state_keys])}\n"
                    f"Dropped message count: {len(dropped)}\n"
                    f"Kept recent message count: {len(kept)}\n"
                    'Return JSON only, for example: {"remain_open":[{"context_type":"file","key":"/abs/path.txt"}],"close":[]}.'
                ),
            ),
        ]

        def _run() -> tuple[list[StateContextKey], str]:
            dispatcher = build_dispatcher(model_override=model_name)
            generator = getattr(dispatcher, "generate", None)
            if not callable(generator):
                return open_state_keys, "deterministic_keep_all"

            raw = generator(selection_prompt, enable_tools=False)
            parsed = self._extract_json_object_from_text(str(raw))
            remain_raw = parsed.get("remain_open", [])
            close_raw = parsed.get("close", [])
            by_identity = {(item.context_type, item.key): item for item in open_state_keys}
            by_key: dict[str, list[StateContextKey]] = {}
            for item in open_state_keys:
                by_key.setdefault(item.key, []).append(item)

            remain: list[StateContextKey] = []
            seen_remain: set[tuple[str, str]] = set()
            for entry in remain_raw:
                normalized = self._normalize_compaction_selection_entry(
                    entry,
                    by_identity=by_identity,
                    by_key=by_key,
                )
                if normalized is None:
                    continue
                identity = (normalized.context_type, normalized.key)
                if identity in seen_remain:
                    continue
                seen_remain.add(identity)
                remain.append(normalized)

            closed_identities: set[tuple[str, str]] = set()
            for entry in close_raw:
                normalized = self._normalize_compaction_selection_entry(
                    entry,
                    by_identity=by_identity,
                    by_key=by_key,
                )
                if normalized is not None:
                    closed_identities.add((normalized.context_type, normalized.key))

            if remain:
                remain = [item for item in remain if (item.context_type, item.key) not in closed_identities]
                return self._sort_state_keys(remain), "llm"

            close_strings = self._parse_json_string_list(close_raw)
            if closed_identities or close_strings:
                filtered = [
                    item
                    for item in open_state_keys
                    if (item.context_type, item.key) not in closed_identities and item.key not in close_strings
                ]
                return self._sort_state_keys(filtered), "llm"

            logger.warning("Compaction open-state selector returned invalid payload; keeping all open state.")
            return open_state_keys, "deterministic_keep_all"

        return await asyncio.to_thread(_run)

    def _insert_compaction_turns(
        self,
        conn: sqlite3.Connection,
        *,
        thread_id: str,
        prev_turn_id: str | None,
        summary_text: str,
        open_state_keys: list[StateContextKey],
        model_name: str,
        now: str,
    ) -> str:
        compaction_turn_id = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO turns(
                id, thread_id, prev_turn_id, turn_type, actor_name, message_text,
                tool_call_id, tool_name, tool_calls_json,
                state_context_json,
                stats_json, model_name, created_at
            )
            VALUES (?, ?, ?, 'compaction', 'compactor', ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
            """,
            (compaction_turn_id, thread_id, prev_turn_id, summary_text, model_name, now),
        )
        prev_turn_id = compaction_turn_id
        for state_key in self._sort_state_keys(list(open_state_keys)):
            reopen_turn_id = str(uuid.uuid4())
            tool_call_id = f"compaction-reopen-{uuid.uuid4().hex[:8]}"
            conn.execute(
                """
                INSERT INTO turns(
                    id, thread_id, prev_turn_id, turn_type, actor_name, message_text,
                    tool_call_id, tool_name, tool_calls_json,
                    state_context_json,
                    stats_json, model_name, created_at
                )
                VALUES (?, ?, ?, 'tool_response', 'compaction_reopen_context', ?, ?, 'compaction_reopen_context', NULL, ?, ?, ?, ?)
                """,
                (
                    reopen_turn_id,
                    thread_id,
                    prev_turn_id,
                    f"Reopened {state_key.context_type} context for {state_key.key} after compaction.",
                    tool_call_id,
                    self._serialize_state_context_mutations([StateContextMutation(state_key.context_type, state_key.key, "read")]),
                    _json({"synthetic": True}),
                    model_name,
                    now,
                ),
            )
            prev_turn_id = reopen_turn_id
        return prev_turn_id

    async def _summarize_for_compaction(self, *, dropped: list[Message], model_name: str) -> Optional[str]:
        if not dropped:
            return None
        loop = asyncio.get_running_loop()

        def _run() -> Optional[str]:
            dispatcher = build_dispatcher(model_override=model_name)
            generator = getattr(dispatcher, "generate", None)
            if not callable(generator):
                return None
            transcript = "\n".join(f"{m.role}: {m.content}" for m in dropped)
            prompt = [
                Message(
                    role="system",
                    content=(
                        "Summarize the conversation transcript for future context retention. "
                        "Preserve facts, decisions, constraints, and open tasks. "
                        "Do not fabricate information."
                    ),
                ),
                Message(role="user", content=transcript),
            ]
            summary = generator(prompt, enable_tools=False)
            text = summary.strip()
            return text or None

        try:
            return await asyncio.to_thread(_run)
        except Exception:  # noqa: BLE001
            return None


runtime = RewriteRuntime()
