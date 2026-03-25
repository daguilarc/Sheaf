from __future__ import annotations

import asyncio
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import sheaf.server.runtime as rr
import sheaf.tools.visibility as visibility
import sheaf.vaults.runtime as vault_runtime
from sheaf.llm.dispatcher import GenerationResult
from sheaf.llm.model_properties import ModelLimits, ModelProperties


class _FlakyDispatcher:
    def __init__(self) -> None:
        self.calls = 0

    def stream_generate_with_details(self, messages, *, on_token, on_thinking=None, enable_tools=True):
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("temporary network issue")
        if on_thinking is not None:
            on_thinking("flaky_recovered")
        on_token("hello")
        return GenerationResult(response="hello", tool_calls=[])


class _FatalDispatcher:
    def stream_generate_with_details(self, messages, *, on_token, on_thinking=None, enable_tools=True):
        raise rr.FatalExecutionError("Unsupported model 'bad-model'")


class _ThinkingDispatcher:
    def stream_generate_with_details(self, messages, *, on_token, on_thinking=None, enable_tools=True):
        if on_thinking is not None:
            on_thinking("model_request_started")
            on_thinking("planning_next_step")
        on_token("hi")
        on_token(" there")
        return GenerationResult(response="hi there", tool_calls=[])


class _CompactionDispatcher:
    def stream_generate_with_details(self, messages, *, on_token, on_thinking=None, enable_tools=True):
        on_token("ok")
        return GenerationResult(response="ok", tool_calls=[])


class _ConflictDispatcher:
    def stream_generate_with_details(self, messages, *, on_token, on_thinking=None, enable_tools=True):
        with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
            conn.execute("UPDATE threads SET tail_turn_id = 'external-tail-update'")
            conn.commit()
        on_token("ok")
        return GenerationResult(response="ok", tool_calls=[])


class _LLMSummaryDispatcher:
    def __init__(self) -> None:
        self.summary_calls = 0

    def generate(self, messages, *, enable_tools=True):
        self.summary_calls += 1
        return "short summary"

    def stream_generate_with_details(self, messages, *, on_token, on_thinking=None, enable_tools=True):
        on_token("ok")
        return GenerationResult(response="ok", tool_calls=[])


class _CompactionSelectionDispatcher:
    def __init__(self, keep_key: str) -> None:
        self.keep_key = keep_key
        self.selection_calls = 0
        self.summary_calls = 0

    def generate(self, messages, *, enable_tools=True):
        prompt = list(messages)
        last_content = prompt[-1].content if prompt else ""
        if "Choose the post-compaction open state." in last_content:
            self.selection_calls += 1
            return rr.json.dumps(
                {
                    "remain_open": [{"context_type": "file", "key": self.keep_key}],
                    "close": [],
                }
            )
        self.summary_calls += 1
        return "selected summary"

    def stream_generate_with_details(self, messages, *, on_token, on_thinking=None, enable_tools=True):
        on_token("ok")
        return GenerationResult(response="ok", tool_calls=[])


class _CaptureMessagesDispatcher:
    def __init__(self) -> None:
        self.last_messages = None

    def stream_generate_with_details(self, messages, *, on_token, on_thinking=None, enable_tools=True):
        self.last_messages = list(messages)
        on_token("ok")
        return GenerationResult(response="ok", tool_calls=[])


class _MultiCaptureDispatcher:
    def __init__(self) -> None:
        self.calls: list[list[rr.Message]] = []

    def stream_generate_with_details(self, messages, *, on_token, on_thinking=None, enable_tools=True):
        self.calls.append(list(messages))
        on_token("ok")
        return GenerationResult(response="ok", tool_calls=[])


class _SingleToolLoopDispatcher:
    def __init__(self, path: str = "/tmp/example.txt") -> None:
        self.calls = 0
        self.path = path

    def stream_generate_with_details(self, messages, *, on_token, on_thinking=None, enable_tools=True):
        self.calls += 1
        if self.calls == 1:
            return GenerationResult(
                response="",
                tool_calls=[
                    rr.ToolCall(
                        id="tool-1",
                        name="close_file_context",
                        args={"path": self.path},
                        result="",
                        is_error=False,
                    )
                ],
            )
        on_token("done")
        return GenerationResult(response="done", tool_calls=[])


class _ApplyPatchToolLoopDispatcher:
    def __init__(self, patch: str) -> None:
        self.patch = patch
        self.calls = 0

    def stream_generate_with_details(self, messages, *, on_token, on_thinking=None, enable_tools=True):
        self.calls += 1
        if self.calls == 1:
            return GenerationResult(
                response="",
                tool_calls=[
                    rr.ToolCall(
                        id="tool-1",
                        name="apply_patch",
                        args={"patch": self.patch},
                        result="",
                        is_error=False,
                    )
                ],
            )
        on_token("done")
        return GenerationResult(response="done", tool_calls=[])


class _BatchedToolLoopDispatcher:
    def __init__(self, file_path: str, dir_path: str) -> None:
        self.calls = 0
        self.file_path = file_path
        self.dir_path = dir_path

    def stream_generate_with_details(self, messages, *, on_token, on_thinking=None, enable_tools=True):
        self.calls += 1
        if self.calls == 1:
            return GenerationResult(
                response="",
                tool_calls=[
                    rr.ToolCall(
                        id="tool-1",
                        name="close_file_context",
                        args={"path": self.file_path},
                        result="",
                        is_error=False,
                    ),
                    rr.ToolCall(
                        id="tool-2",
                        name="close_directory_context",
                        args={"path": self.dir_path},
                        result="",
                        is_error=False,
                    ),
                ],
            )
        on_token("done")
        return GenerationResult(response="done", tool_calls=[])


class _BatchedReadFileLoopDispatcher:
    def __init__(self, file_paths: list[str]) -> None:
        self.calls = 0
        self.file_paths = file_paths
        self.prompts: list[list[rr.Message]] = []

    def stream_generate_with_details(self, messages, *, on_token, on_thinking=None, enable_tools=True):
        self.calls += 1
        self.prompts.append(list(messages))
        if self.calls == 1:
            return GenerationResult(
                response="",
                tool_calls=[
                    rr.ToolCall(
                        id=f"tool-{index + 1}",
                        name="read_file",
                        args={"path": path},
                        result="",
                        is_error=False,
                    )
                    for index, path in enumerate(self.file_paths)
                ],
            )
        on_token("done")
        return GenerationResult(response="done", tool_calls=[])


class _ResumeOnlyDispatcher:
    def __init__(self, response: str = "resumed") -> None:
        self.calls = 0
        self.last_messages = None
        self.response = response

    def stream_generate_with_details(self, messages, *, on_token, on_thinking=None, enable_tools=True):
        self.calls += 1
        self.last_messages = list(messages)
        on_token(self.response)
        return GenerationResult(response=self.response, tool_calls=[])


class _CollectingWebSocket:
    def __init__(self) -> None:
        self.frames: list[dict[str, object]] = []

    async def send_json(self, payload: dict[str, object]) -> None:
        self.frames.append(payload)


def _configure_paths(tmp_path: Path) -> None:
    rr.DATA_DIR = tmp_path / "data"
    rr.DATA_ARCHIVE_DIR = tmp_path / "data_archive"
    rr.SERVER_DB_PATH = rr.DATA_DIR / "server.sqlite3"
    rr.USER_DBS_DIR = rr.DATA_DIR / "user_dbs"
    rr.SYSTEM_PROMPTS_DIR = rr.DATA_DIR / "system_prompts"


def _new_runtime(tmp_path: Path) -> rr.RewriteRuntime:
    _configure_paths(tmp_path)
    runtime = rr.RewriteRuntime()
    runtime.initialize()
    return runtime


def _drain_thread(runtime: rr.RewriteRuntime, thread_id: str) -> None:
    asyncio.run(runtime.drain_thread_outstanding(thread_id))


def _state_ops_json(
    *ops: tuple[str, str, str, str | None] | tuple[str, str, str, str | None, str | None]
) -> str:
    payload = []
    for op in ops:
        if len(op) == 4:
            context_type, key, operation, target_key = op
            action = None
        else:
            context_type, key, operation, target_key, action = op
        item = {
            "context_type": context_type,
            "key": key,
            "operation": operation,
        }
        if target_key is not None:
            item["target_key"] = target_key
        if action is not None:
            item["action"] = action
        payload.append(item)
    return rr.json.dumps(payload)


def _insert_turn(
    conn: sqlite3.Connection,
    *,
    turn_id: str,
    thread_id: str,
    prev_turn_id: str | None,
    turn_type: str,
    actor_name: str,
    message_text: str,
    model_name: str | None = None,
    tool_call_id: str | None = None,
    tool_name: str | None = None,
    tool_calls_json: str | None = None,
    state_context_json: str | None = None,
    stats_json: str | None = None,
    created_at: str | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO turns(
            id, thread_id, prev_turn_id, turn_type, actor_name, message_text,
            tool_call_id, tool_name, tool_calls_json,
            state_context_json,
            stats_json, model_name, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            turn_id,
            thread_id,
            prev_turn_id,
            turn_type,
            actor_name,
            message_text,
            tool_call_id,
            tool_name,
            tool_calls_json,
            state_context_json,
            stats_json,
            model_name,
            created_at or rr.utc_now(),
        ),
    )


def test_nonfatal_retry_and_backoff(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    flaky = _FlakyDispatcher()
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: flaky)

    thread_id = runtime.create_thread()
    queue_id = runtime.enqueue_message(
        thread_id=thread_id,
        text="hello",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="m1",
        session_id=None,
    )

    _drain_thread(runtime, thread_id)

    conn = sqlite3.connect(rr.SERVER_DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM message_queue WHERE id = ?", (queue_id,)).fetchone()
    assert row is not None
    assert int(row["attempts"]) == 1
    assert row["locked_by"] is None

    conn.execute("UPDATE message_queue SET available_at = ? WHERE id = ?", (rr.utc_now(), queue_id))
    conn.commit()
    conn.close()

    _drain_thread(runtime, thread_id)

    conn = sqlite3.connect(rr.SERVER_DB_PATH)
    queue_row = conn.execute("SELECT * FROM message_queue WHERE id = ?", (queue_id,)).fetchone()
    assert queue_row is None
    turn_count = conn.execute("SELECT COUNT(*) FROM turns WHERE thread_id = ?", (thread_id,)).fetchone()[0]
    assert turn_count == 2
    conn.close()


def test_fatal_errors_move_to_error_table(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: _FatalDispatcher())

    thread_id = runtime.create_thread()
    queue_id = runtime.enqueue_message(
        thread_id=thread_id,
        text="hello",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="m2",
        session_id=None,
    )

    asyncio.run(runtime.process_next_runnable())

    conn = sqlite3.connect(rr.SERVER_DB_PATH)
    conn.row_factory = sqlite3.Row
    queue_row = conn.execute("SELECT * FROM message_queue WHERE id = ?", (queue_id,)).fetchone()
    assert queue_row is None
    error_row = conn.execute("SELECT * FROM queue_errors WHERE queue_id = ?", (queue_id,)).fetchone()
    assert error_row is not None
    assert "Unsupported model" in str(error_row["error_text"])
    request_row = conn.execute("SELECT * FROM requests ORDER BY created_at DESC LIMIT 1").fetchone()
    assert request_row is not None
    assert request_row["turn_id"] is None
    assert "fatal_error[" in str(request_row["error_text"])
    assert request_row["completed_at"] is not None
    conn.close()


def test_streaming_persists_thinking_traces(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: _ThinkingDispatcher())

    thread_id = runtime.create_thread()
    runtime.enqueue_message(
        thread_id=thread_id,
        text="hello",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="m3",
        session_id=None,
    )

    asyncio.run(runtime.process_next_runnable())

    conn = sqlite3.connect(rr.SERVER_DB_PATH)
    conn.row_factory = sqlite3.Row
    assistant = conn.execute(
        "SELECT id FROM turns WHERE thread_id = ? AND turn_type = 'assistant_message' ORDER BY created_at DESC LIMIT 1",
        (thread_id,),
    ).fetchone()
    assert assistant is not None

    traces = conn.execute(
        "SELECT trace_text FROM thinking_traces WHERE turn_id = ? ORDER BY sequence_no",
        (assistant["id"],),
    ).fetchall()
    assert len(traces) >= 2

    stream_event = conn.execute(
        "SELECT payload_json FROM turn_events WHERE turn_id = ? AND event_type = 'assistant_stream_complete'",
        (assistant["id"],),
    ).fetchone()
    assert stream_event is not None
    conn.close()


def test_context_compaction_event_persisted(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: _CompactionDispatcher())

    def _tiny_limits(*, provider: str, model: str):
        return ModelProperties(
            provider=provider,
            model=model,
            limits=ModelLimits(
                context_window_tokens=100,
                max_output_tokens=32,
                compaction_trigger_ratio=0.5,
                compaction_target_ratio=0.35,
                recent_messages_to_keep=2,
            ),
        )

    monkeypatch.setattr(rr, "resolve_model_properties", _tiny_limits)

    thread_id = runtime.create_thread()
    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        now = rr.utc_now()
        prev = None
        for i in range(6):
            turn_id = f"u-{i}"
            _insert_turn(
                conn,
                turn_id=turn_id,
                thread_id=thread_id,
                prev_turn_id=prev,
                turn_type="user_message",
                actor_name="user",
                message_text="x" * 120,
                created_at=now,
            )
            prev = turn_id
        conn.execute("UPDATE threads SET tail_turn_id = ?, updated_at = ? WHERE id = ?", (prev, now, thread_id))
        conn.commit()

    runtime.enqueue_message(
        thread_id=thread_id,
        text="new message to trigger compaction",
        model_name="gpt-5-mini",
        in_response_to_turn_id=prev,
        client_message_id="m4",
        session_id=None,
    )

    asyncio.run(runtime.process_next_runnable())

    conn = sqlite3.connect(rr.SERVER_DB_PATH)
    conn.row_factory = sqlite3.Row
    compaction = conn.execute(
        "SELECT id, message_text FROM turns WHERE thread_id = ? AND turn_type = 'compaction' ORDER BY created_at DESC LIMIT 1",
        (thread_id,),
    ).fetchone()
    assert compaction is not None
    conn.close()


def test_system_prompt_injected_into_prompt_messages(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    dispatcher = _CaptureMessagesDispatcher()
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: dispatcher)

    prompt_path = rr.SYSTEM_PROMPTS_DIR / "sheaf_default.md"
    prompt_path.write_text("You are sheaf test prompt.", encoding="utf-8")

    thread_id = runtime.create_thread()
    runtime.enqueue_message(
        thread_id=thread_id,
        text="hello",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="m5",
        session_id=None,
    )

    asyncio.run(runtime.process_next_runnable())

    assert dispatcher.last_messages is not None
    assert dispatcher.last_messages[0].role == "system"
    assert "You are sheaf test prompt." in dispatcher.last_messages[0].content


def test_detach_websocket_removes_session_and_queue_mapping(tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    thread_id = runtime.create_thread()
    session = runtime.create_session(thread_id, None)
    queue_id = runtime.enqueue_message(
        thread_id=thread_id,
        text="hello",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="m6",
        session_id=session.session_id,
    )

    runtime.detach_websocket(session.session_id)

    assert session.session_id not in runtime._sessions
    assert queue_id not in runtime._queue_delivery_map


def test_handshake_context_budget_uses_token_estimate(tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    thread_id = runtime.create_thread()

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        now = rr.utc_now()
        _insert_turn(
            conn,
            turn_id="u1",
            thread_id=thread_id,
            prev_turn_id=None,
            turn_type="user_message",
            actor_name="user",
            message_text="hello world",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="a1",
            thread_id=thread_id,
            prev_turn_id="u1",
            turn_type="assistant_message",
            actor_name="assistant",
            message_text="response text",
            model_name="gpt-5-mini",
            created_at=now,
        )
        conn.execute("UPDATE threads SET tail_turn_id = 'a1', updated_at = ? WHERE id = ?", (now, thread_id))
        conn.commit()

    session = runtime.create_session(thread_id, None)
    ws = _CollectingWebSocket()
    asyncio.run(runtime.stream_handshake(session, ws))

    context_budget = next(frame for frame in ws.frames if frame["type"] == "context_budget")
    expected = runtime._estimate_message_tokens(
        [
            rr.Message(role="user", content="hello world"),
            rr.Message(role="assistant", content="response text"),
        ]
    )
    assert context_budget["context_size"] == expected
    assert int(context_budget["max_context_size"]) > 0


def test_live_websocket_omits_tool_response_committed_turns(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    visible_file = tmp_path / "visible.txt"
    monkeypatch.setattr(visibility, "SERVER_DB_PATH", rr.SERVER_DB_PATH)
    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO visible_directories(path, access_mode, created_at, updated_at) VALUES (?, 'read_write', ?, ?)",
            (str(tmp_path.resolve()), "t", "t"),
        )
        conn.commit()
    dispatcher = _SingleToolLoopDispatcher(str(visible_file))
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: dispatcher)

    thread_id = runtime.create_thread()
    session = runtime.create_session(thread_id, None)
    ws = _CollectingWebSocket()
    session.websocket = ws

    runtime.enqueue_message(
        thread_id=thread_id,
        text="please close that file context",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="tool-live-1",
        session_id=session.session_id,
    )

    _drain_thread(runtime, thread_id)

    committed = [frame["turn"] for frame in ws.frames if frame["type"] == "committed_turn"]
    assert [turn["speaker"] for turn in committed] == ["user", "assistant", "assistant"]
    assert committed[1]["tool_calls"][0]["name"] == "close_file_context"
    assert committed[2]["message_text"] == "done"
    assert committed[2].get("tool_calls", []) == []


def test_live_websocket_batch_tool_call_turn_preserves_order(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    visible_file = tmp_path / "visible.txt"
    visible_dir = tmp_path / "docs"
    visible_dir.mkdir()
    monkeypatch.setattr(visibility, "SERVER_DB_PATH", rr.SERVER_DB_PATH)
    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO visible_directories(path, access_mode, created_at, updated_at) VALUES (?, 'read_write', ?, ?)",
            (str(tmp_path.resolve()), "t", "t"),
        )
        conn.commit()
    dispatcher = _BatchedToolLoopDispatcher(str(visible_file), str(visible_dir))
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: dispatcher)

    thread_id = runtime.create_thread()
    session = runtime.create_session(thread_id, None)
    ws = _CollectingWebSocket()
    session.websocket = ws

    runtime.enqueue_message(
        thread_id=thread_id,
        text="close both contexts",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="tool-live-batch-1",
        session_id=session.session_id,
    )

    asyncio.run(runtime.process_next_runnable())

    committed = [frame["turn"] for frame in ws.frames if frame["type"] == "committed_turn"]
    assert [turn["speaker"] for turn in committed] == ["user", "assistant"]
    assert [call["name"] for call in committed[1]["tool_calls"]] == [
        "close_file_context",
        "close_directory_context",
    ]


def test_live_websocket_does_not_repeat_tool_calls_on_final_assistant_turn(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    visible_file = tmp_path / "visible.txt"
    visible_dir = tmp_path / "docs"
    visible_dir.mkdir()
    monkeypatch.setattr(visibility, "SERVER_DB_PATH", rr.SERVER_DB_PATH)
    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO visible_directories(path, access_mode, created_at, updated_at) VALUES (?, 'read_write', ?, ?)",
            (str(tmp_path.resolve()), "t", "t"),
        )
        conn.commit()
    dispatcher = _BatchedToolLoopDispatcher(str(visible_file), str(visible_dir))
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: dispatcher)

    thread_id = runtime.create_thread()
    session = runtime.create_session(thread_id, None)
    ws = _CollectingWebSocket()
    session.websocket = ws

    runtime.enqueue_message(
        thread_id=thread_id,
        text="close both contexts",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="tool-live-batch-2",
        session_id=session.session_id,
    )

    _drain_thread(runtime, thread_id)

    committed = [frame["turn"] for frame in ws.frames if frame["type"] == "committed_turn"]
    assert [turn["speaker"] for turn in committed] == ["user", "assistant", "assistant"]
    assert [call["name"] for call in committed[1]["tool_calls"]] == [
        "close_file_context",
        "close_directory_context",
    ]
    assert committed[2]["message_text"] == "done"
    assert committed[2].get("tool_calls", []) == []


def test_fetch_handshake_turns_uses_prev_turn_chain_not_created_at(tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    thread_id = runtime.create_thread()
    same_time = rr.utc_now()

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        _insert_turn(conn, turn_id="t1", thread_id=thread_id, prev_turn_id=None, turn_type="user_message", actor_name="user", message_text="u1", created_at=same_time)
        _insert_turn(conn, turn_id="t2", thread_id=thread_id, prev_turn_id="t1", turn_type="assistant_message", actor_name="assistant", message_text="a1", model_name="gpt-5-mini", created_at=same_time)
        _insert_turn(conn, turn_id="t3", thread_id=thread_id, prev_turn_id="t2", turn_type="user_message", actor_name="user", message_text="u2", created_at=same_time)
        conn.execute("UPDATE threads SET tail_turn_id = 't3', updated_at = ? WHERE id = ?", (same_time, thread_id))
        conn.commit()

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        turns = runtime._fetch_handshake_turns(conn, thread_id, "t1")

    assert [turn["id"] for turn in turns] == ["t2", "t3"]


def test_connect_applies_per_connection_pragmas(tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)

    conn = runtime._connect()
    try:
        sync = conn.execute("PRAGMA synchronous").fetchone()[0]
        busy = conn.execute("PRAGMA busy_timeout").fetchone()[0]
    finally:
        conn.close()

    assert int(sync) == 1  # NORMAL
    assert int(busy) == 5000


def test_enqueue_message_wakes_worker_event(tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    worker_loop = asyncio.get_event_loop_policy().new_event_loop()
    asyncio.get_event_loop_policy().set_event_loop(worker_loop)
    runtime._worker_loop_event_loop = worker_loop
    runtime._worker_wake = asyncio.Event()
    thread_id = runtime.create_thread()
    try:
        assert runtime._worker_wake.is_set() is False
        runtime.enqueue_message(
            thread_id=thread_id,
            text="wake me",
            model_name="gpt-5-mini",
            in_response_to_turn_id=None,
            client_message_id="wake-1",
            session_id=None,
        )
        # call_soon_threadsafe schedules onto the worker loop; process pending callbacks.
        runtime._worker_loop_event_loop.call_soon(runtime._worker_loop_event_loop.stop)
        runtime._worker_loop_event_loop.run_forever()
        assert runtime._worker_wake.is_set() is True
    finally:
        runtime._worker_loop_event_loop.close()
        asyncio.get_event_loop_policy().set_event_loop(None)
        runtime._worker_loop_event_loop = None
        runtime._worker_wake = None


def test_load_thread_messages_uses_chain_order(tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    thread_id = runtime.create_thread()
    same_time = rr.utc_now()

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        _insert_turn(conn, turn_id="c1", thread_id=thread_id, prev_turn_id=None, turn_type="user_message", actor_name="user", message_text="first", created_at=same_time)
        _insert_turn(conn, turn_id="c2", thread_id=thread_id, prev_turn_id="c1", turn_type="assistant_message", actor_name="assistant", message_text="second", model_name="gpt-5-mini", created_at=same_time)
        _insert_turn(conn, turn_id="c3", thread_id=thread_id, prev_turn_id="c2", turn_type="user_message", actor_name="user", message_text="third", created_at=same_time)
        conn.execute("UPDATE threads SET tail_turn_id = 'c3', updated_at = ? WHERE id = ?", (same_time, thread_id))
        conn.commit()

    with runtime._db() as conn:
        messages = runtime._load_thread_messages(conn, thread_id)

    non_system = [m.content for m in messages if m.role != "system"]
    assert non_system == ["first", "second", "third"]


def test_load_thread_messages_stop_at_nearest_compaction(tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    thread_id = runtime.create_thread()
    now = rr.utc_now()

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        _insert_turn(conn, turn_id="u0", thread_id=thread_id, prev_turn_id=None, turn_type="user_message", actor_name="user", message_text="u0", created_at=now)
        _insert_turn(conn, turn_id="a0", thread_id=thread_id, prev_turn_id="u0", turn_type="assistant_message", actor_name="assistant", message_text="a0", model_name="gpt-5-mini", created_at=now)
        _insert_turn(conn, turn_id="cmp", thread_id=thread_id, prev_turn_id="a0", turn_type="compaction", actor_name="compactor", message_text="compacted summary", model_name="gpt-5-mini", created_at=now)
        _insert_turn(conn, turn_id="u2", thread_id=thread_id, prev_turn_id="cmp", turn_type="user_message", actor_name="user", message_text="u2", created_at=now)
        conn.execute("UPDATE threads SET tail_turn_id = 'u2', updated_at = ? WHERE id = ?", (now, thread_id))
        conn.commit()

    with runtime._db() as conn:
        messages = runtime._load_thread_messages(conn, thread_id)

    roles_and_contents = [(m.role, m.content) for m in messages]
    assert ("system", "compacted summary") in roles_and_contents
    assert ("user", "u0") not in roles_and_contents
    assert ("assistant", "a0") not in roles_and_contents
    assert roles_and_contents[-1] == ("user", "u2")


def test_request_token_fields_use_estimator(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: _CompactionDispatcher())

    thread_id = runtime.create_thread()
    runtime.enqueue_message(
        thread_id=thread_id,
        text="hello world",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="m7",
        session_id=None,
    )

    asyncio.run(runtime.process_next_runnable())

    conn = sqlite3.connect(rr.SERVER_DB_PATH)
    conn.row_factory = sqlite3.Row
    request_row = conn.execute("SELECT input_tokens, output_tokens, request_json FROM requests ORDER BY created_at DESC LIMIT 1").fetchone()
    conn.close()
    assert request_row is not None

    payload = rr.json.loads(str(request_row["request_json"]))
    prompt_messages = [rr.Message(role=item["role"], content=item["content"]) for item in payload["messages"]]
    assert int(request_row["input_tokens"]) == runtime._estimate_message_tokens(prompt_messages)
    assert int(request_row["output_tokens"]) == runtime._estimate_tokens("ok")


def test_request_marked_failed_on_commit_conflict(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: _ConflictDispatcher())

    thread_id = runtime.create_thread()
    runtime.enqueue_message(
        thread_id=thread_id,
        text="trigger commit conflict",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="m8",
        session_id=None,
    )
    asyncio.run(runtime.process_next_runnable())

    conn = sqlite3.connect(rr.SERVER_DB_PATH)
    conn.row_factory = sqlite3.Row
    request_row = conn.execute("SELECT * FROM requests ORDER BY created_at DESC LIMIT 1").fetchone()
    queue_rows = conn.execute("SELECT COUNT(*) AS c FROM message_queue").fetchone()
    assistant_rows = conn.execute(
        "SELECT COUNT(*) AS c FROM turns WHERE thread_id = ? AND turn_type = 'assistant_message'",
        (thread_id,),
    ).fetchone()
    conn.close()
    assert request_row is not None
    assert str(request_row["error_text"]).startswith("fatal_error[commit]: execution_conflict:")
    assert request_row["completed_at"] is not None
    assert int(queue_rows["c"]) == 0
    assert int(assistant_rows["c"]) == 0


def test_visible_directories_defaults_read_only(tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT path, access_mode FROM visible_directories").fetchall()
    by_path = {str(row["path"]): str(row["access_mode"]) for row in rows}
    assert str(rr.REPO_ROOT.resolve()) in by_path
    assert by_path[str(rr.REPO_ROOT.resolve())] == "read_only"
    assert str((rr.DATA_DIR / "user_dbs").resolve()) not in by_path


def test_turn_schema_omits_turn_context_and_request_captures_prompt(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: _CompactionDispatcher())
    thread_id = runtime.create_thread()
    runtime.enqueue_message(
        thread_id=thread_id,
        text="context test",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="m9",
        session_id=None,
    )
    asyncio.run(runtime.process_next_runnable())

    conn = sqlite3.connect(rr.SERVER_DB_PATH)
    conn.row_factory = sqlite3.Row
    columns = [row[1] for row in conn.execute("PRAGMA table_info(turns)").fetchall()]
    request_row = conn.execute("SELECT request_json FROM requests ORDER BY created_at DESC LIMIT 1").fetchone()
    conn.close()

    assert "turn_context" not in columns
    assert request_row is not None
    payload = rr.json.loads(str(request_row["request_json"]))
    messages = payload["messages"]
    assert messages[-1]["role"] == "user"
    assert messages[-1]["content"] == "context test"
    assert "tool_calls_json" in columns
    assert "state_context_json" in columns


def test_context_compaction_uses_llm_summary_when_available(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    dispatcher = _LLMSummaryDispatcher()
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: dispatcher)

    def _tiny_limits(*, provider: str, model: str):
        return ModelProperties(
            provider=provider,
            model=model,
            limits=ModelLimits(
                context_window_tokens=100,
                max_output_tokens=32,
                compaction_trigger_ratio=0.5,
                compaction_target_ratio=0.35,
                recent_messages_to_keep=2,
            ),
        )

    monkeypatch.setattr(rr, "resolve_model_properties", _tiny_limits)

    thread_id = runtime.create_thread()
    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        now = rr.utc_now()
        prev = None
        for i in range(6):
            turn_id = f"s-{i}"
            _insert_turn(
                conn,
                turn_id=turn_id,
                thread_id=thread_id,
                prev_turn_id=prev,
                turn_type="user_message",
                actor_name="user",
                message_text="x" * 120,
                created_at=now,
            )
            prev = turn_id
        conn.execute("UPDATE threads SET tail_turn_id = ?, updated_at = ? WHERE id = ?", (prev, now, thread_id))
        conn.commit()

    runtime.enqueue_message(
        thread_id=thread_id,
        text="trigger",
        model_name="gpt-5-mini",
        in_response_to_turn_id=prev,
        client_message_id="m10",
        session_id=None,
    )
    asyncio.run(runtime.process_next_runnable())
    assert dispatcher.summary_calls >= 1


def test_context_compaction_reopens_only_selected_state(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    kept = tmp_path / "kept.txt"
    closed = tmp_path / "closed.txt"
    kept.write_text("keep me\n", encoding="utf-8")
    closed.write_text("close me\n", encoding="utf-8")
    dispatcher = _CompactionSelectionDispatcher(str(kept.resolve()))
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: dispatcher)

    def _tiny_limits(*, provider: str, model: str):
        return ModelProperties(
            provider=provider,
            model=model,
            limits=ModelLimits(
                context_window_tokens=100,
                max_output_tokens=32,
                compaction_trigger_ratio=0.5,
                compaction_target_ratio=0.35,
                recent_messages_to_keep=2,
            ),
        )

    monkeypatch.setattr(rr, "resolve_model_properties", _tiny_limits)

    thread_id = runtime.create_thread()
    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        now = rr.utc_now()
        _insert_turn(
            conn,
            turn_id="call-1",
            thread_id=thread_id,
            prev_turn_id=None,
            turn_type="tool_call",
            actor_name="assistant",
            message_text="",
            tool_calls_json=rr.json.dumps(
                [{"id": "tool-read-1", "name": "read_file", "args": {"path": str(kept.resolve())}}]
            ),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="read-1",
            thread_id=thread_id,
            prev_turn_id="call-1",
            turn_type="tool_response",
            actor_name="read_file",
            message_text="opened kept",
            tool_call_id="tool-read-1",
            tool_name="read_file",
            state_context_json=_state_ops_json(("file", str(kept.resolve()), "read", None)),
            stats_json=rr.json.dumps({"is_error": False}),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="call-2",
            thread_id=thread_id,
            prev_turn_id="read-1",
            turn_type="tool_call",
            actor_name="assistant",
            message_text="",
            tool_calls_json=rr.json.dumps(
                [{"id": "tool-read-2", "name": "read_file", "args": {"path": str(closed.resolve())}}]
            ),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="read-2",
            thread_id=thread_id,
            prev_turn_id="call-2",
            turn_type="tool_response",
            actor_name="read_file",
            message_text="opened closed",
            tool_call_id="tool-read-2",
            tool_name="read_file",
            state_context_json=_state_ops_json(("file", str(closed.resolve()), "read", None)),
            stats_json=rr.json.dumps({"is_error": False}),
            model_name="gpt-5-mini",
            created_at=now,
        )
        prev = "read-2"
        for i in range(4):
            turn_id = f"u-{i}"
            _insert_turn(
                conn,
                turn_id=turn_id,
                thread_id=thread_id,
                prev_turn_id=prev,
                turn_type="user_message",
                actor_name="user",
                message_text="x" * 120,
                created_at=now,
            )
            prev = turn_id
        conn.execute("UPDATE threads SET tail_turn_id = ?, updated_at = ? WHERE id = ?", (prev, now, thread_id))
        conn.commit()

    runtime.enqueue_message(
        thread_id=thread_id,
        text="trigger selection compaction",
        model_name="gpt-5-mini",
        in_response_to_turn_id=prev,
        client_message_id="m10b",
        session_id=None,
    )

    _drain_thread(runtime, thread_id)

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        reopened = conn.execute(
            """
            SELECT state_context_json
            FROM turns
            WHERE thread_id = ? AND actor_name = 'compaction_reopen_context'
            ORDER BY rowid
            """,
            (thread_id,),
        ).fetchall()

    assert [rr.json.loads(str(row["state_context_json"]))[0]["key"] for row in reopened] == [str(kept.resolve())]


def test_incremental_prompt_uses_compacted_ancestor_context(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    dispatcher = _MultiCaptureDispatcher()
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: dispatcher)

    def _tiny_limits(*, provider: str, model: str):
        return ModelProperties(
            provider=provider,
            model=model,
            limits=ModelLimits(
                context_window_tokens=100,
                max_output_tokens=32,
                compaction_trigger_ratio=0.5,
                compaction_target_ratio=0.35,
                recent_messages_to_keep=2,
            ),
        )

    monkeypatch.setattr(rr, "resolve_model_properties", _tiny_limits)

    thread_id = runtime.create_thread()
    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        now = rr.utc_now()
        prev = None
        for i in range(6):
            turn_id = f"z-{i}"
            _insert_turn(
                conn,
                turn_id=turn_id,
                thread_id=thread_id,
                prev_turn_id=prev,
                turn_type="user_message",
                actor_name="user",
                message_text="x" * 120,
                created_at=now,
            )
            prev = turn_id
        conn.execute("UPDATE threads SET tail_turn_id = ?, updated_at = ? WHERE id = ?", (prev, now, thread_id))
        conn.commit()

    runtime.enqueue_message(
        thread_id=thread_id,
        text="first new",
        model_name="gpt-5-mini",
        in_response_to_turn_id=prev,
        client_message_id="m12",
        session_id=None,
    )
    asyncio.run(runtime.process_next_runnable())
    assert len(dispatcher.calls) == 1

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        tail = conn.execute("SELECT tail_turn_id FROM threads WHERE id = ?", (thread_id,)).fetchone()
        assert tail is not None
        new_tail = str(tail["tail_turn_id"])

    runtime.enqueue_message(
        thread_id=thread_id,
        text="second new",
        model_name="gpt-5-mini",
        in_response_to_turn_id=new_tail,
        client_message_id="m13",
        session_id=None,
    )
    asyncio.run(runtime.process_next_runnable())
    assert len(dispatcher.calls) == 2

    second_prompt = dispatcher.calls[1]
    second_contents = [m.content for m in second_prompt]
    assert any(content.startswith("Context compaction summary of earlier turns:") for content in second_contents)


def test_tool_loop_advances_one_step_per_do_work_call(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    visible_file = tmp_path / "visible.txt"
    monkeypatch.setattr(visibility, "SERVER_DB_PATH", rr.SERVER_DB_PATH)
    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO visible_directories(path, access_mode, created_at, updated_at) VALUES (?, 'read_write', ?, ?)",
            (str(tmp_path.resolve()), "t", "t"),
        )
        conn.commit()
    dispatcher = _SingleToolLoopDispatcher(str(visible_file))
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: dispatcher)

    thread_id = runtime.create_thread()
    runtime.enqueue_message(
        thread_id=thread_id,
        text="please close that file context",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="tool-loop-1",
        session_id=None,
    )

    asyncio.run(runtime.process_next_runnable())

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT turn_type, tool_calls_json FROM turns WHERE thread_id = ? ORDER BY rowid",
            (thread_id,),
        ).fetchall()
        queue_row = conn.execute("SELECT locked_by FROM message_queue WHERE thread_id = ?", (thread_id,)).fetchone()

    assert [row["turn_type"] for row in rows] == ["user_message", "tool_call"]
    assert rr.json.loads(str(rows[1]["tool_calls_json"])) == [
        {"id": "tool-1", "name": "close_file_context", "args": {"path": str(visible_file)}}
    ]
    assert queue_row is not None
    assert queue_row["locked_by"] is None

    asyncio.run(runtime.process_next_runnable())

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT turn_type, state_context_json, actor_name FROM turns WHERE thread_id = ? ORDER BY rowid",
            (thread_id,),
        ).fetchall()

    assert [row["turn_type"] for row in rows] == ["user_message", "tool_call", "tool_response"]
    assert rr.json.loads(str(rows[2]["state_context_json"]))[0]["operation"] == "close"
    assert rows[2]["actor_name"] == "close_file_context"

    asyncio.run(runtime.process_next_runnable())

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT turn_type, tool_name, actor_name, message_text FROM turns WHERE thread_id = ? ORDER BY rowid",
            (thread_id,),
        ).fetchall()

    assert [row["turn_type"] for row in rows] == ["user_message", "tool_call", "tool_response", "assistant_message"]
    assert rows[3]["message_text"] == "done"


def test_tool_call_batch_persists_on_one_turn_and_executes_in_order(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    visible_file = tmp_path / "visible.txt"
    visible_dir = tmp_path / "docs"
    visible_dir.mkdir()
    monkeypatch.setattr(visibility, "SERVER_DB_PATH", rr.SERVER_DB_PATH)
    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO visible_directories(path, access_mode, created_at, updated_at) VALUES (?, 'read_write', ?, ?)",
            (str(tmp_path.resolve()), "t", "t"),
        )
        conn.commit()
    dispatcher = _BatchedToolLoopDispatcher(str(visible_file), str(visible_dir))
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: dispatcher)

    thread_id = runtime.create_thread()
    runtime.enqueue_message(
        thread_id=thread_id,
        text="close both contexts",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="tool-loop-batch-1",
        session_id=None,
    )

    asyncio.run(runtime.process_next_runnable())

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        tool_call_row = conn.execute(
            "SELECT id, tool_calls_json FROM turns WHERE thread_id = ? AND turn_type = 'tool_call'",
            (thread_id,),
        ).fetchone()
    assert tool_call_row is not None
    assert rr.json.loads(str(tool_call_row["tool_calls_json"])) == [
        {"id": "tool-1", "name": "close_file_context", "args": {"path": str(visible_file)}},
        {"id": "tool-2", "name": "close_directory_context", "args": {"path": str(visible_dir)}},
    ]

    asyncio.run(runtime.process_next_runnable())

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT turn_type, tool_call_id, actor_name, state_context_json FROM turns WHERE thread_id = ? ORDER BY rowid",
            (thread_id,),
        ).fetchall()

    assert [row["turn_type"] for row in rows] == ["user_message", "tool_call", "tool_response", "tool_response"]
    assert [
        (row["tool_call_id"], rr.json.loads(str(row["state_context_json"]))[0]["operation"], rr.json.loads(str(row["state_context_json"]))[0]["key"])
        for row in rows[2:]
    ] == [
        ("tool-1", "close", str(visible_file.resolve())),
        ("tool-2", "close", str(visible_dir.resolve())),
    ]

    asyncio.run(runtime.process_next_runnable())

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT turn_type, message_text FROM turns WHERE thread_id = ? ORDER BY rowid",
            (thread_id,),
        ).fetchall()
    assert [row["turn_type"] for row in rows] == [
        "user_message",
        "tool_call",
        "tool_response",
        "tool_response",
        "assistant_message",
    ]
    assert rows[-1]["message_text"] == "done"


def test_pending_tool_call_batch_survives_handshake_and_prompt_reconstruction(tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    thread_id = runtime.create_thread()
    now = rr.utc_now()

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        _insert_turn(
            conn,
            turn_id="u1",
            thread_id=thread_id,
            prev_turn_id=None,
            turn_type="user_message",
            actor_name="user",
            message_text="inspect pending calls",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="tc1",
            thread_id=thread_id,
            prev_turn_id="u1",
            turn_type="tool_call",
            actor_name="assistant",
            message_text="",
            tool_calls_json=rr.json.dumps(
                [
                    {"id": "tool-1", "name": "close_file_context", "args": {"path": str((tmp_path / 'a.txt').resolve())}},
                    {"id": "tool-2", "name": "close_directory_context", "args": {"path": str((tmp_path / 'docs').resolve())}},
                ]
            ),
            model_name="gpt-5-mini",
            created_at=now,
        )
        conn.execute("UPDATE threads SET tail_turn_id = 'tc1', updated_at = ? WHERE id = ?", (now, thread_id))
        conn.commit()

    with runtime._db() as conn:
        visible_turns = runtime._fetch_handshake_turns(conn, thread_id, None)
        messages = runtime._load_thread_messages(conn, thread_id)

    assert visible_turns[-1]["speaker"] == "assistant"
    assert [call["name"] for call in visible_turns[-1]["tool_calls"]] == [
        "close_file_context",
        "close_directory_context",
    ]
    assistant_messages = [message for message in messages if message.role == "assistant" and message.tool_calls]
    assert assistant_messages
    assert [call["function"]["name"] for call in assistant_messages[-1].tool_calls] == [
        "close_file_context",
        "close_directory_context",
    ]


def test_batched_tool_prompt_keeps_tool_responses_contiguous_before_state_injections(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    monkeypatch.setattr(visibility, "SERVER_DB_PATH", rr.SERVER_DB_PATH)
    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO visible_directories(path, access_mode, created_at, updated_at) VALUES (?, 'read_write', ?, ?)",
            (str(tmp_path.resolve()), "t", "t"),
        )
        conn.commit()

    first = tmp_path / "a.txt"
    second = tmp_path / "b.txt"
    third = tmp_path / "c.txt"
    first.write_text("alpha\n", encoding="utf-8")
    second.write_text("beta\n", encoding="utf-8")
    third.write_text("gamma\n", encoding="utf-8")

    dispatcher = _BatchedReadFileLoopDispatcher([str(first), str(second), str(third)])
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: dispatcher)

    thread_id = runtime.create_thread()
    runtime.enqueue_message(
        thread_id=thread_id,
        text="read all three files",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="read-batch-1",
        session_id=None,
    )

    _drain_thread(runtime, thread_id)

    assert len(dispatcher.prompts) == 2
    second_prompt = dispatcher.prompts[1]
    assistant_index = next(i for i, message in enumerate(second_prompt) if message.role == "assistant" and message.tool_calls)
    assert [message.role for message in second_prompt[assistant_index + 1 : assistant_index + 4]] == ["tool", "tool", "tool"]
    assert [message.tool_call_id for message in second_prompt[assistant_index + 1 : assistant_index + 4]] == [
        "tool-1",
        "tool-2",
        "tool-3",
    ]
    assert second_prompt[assistant_index + 4].role == "system"

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT tool_call_id, state_context_json FROM turns WHERE thread_id = ? AND turn_type = 'tool_response' ORDER BY rowid",
            (thread_id,),
        ).fetchall()
    assert [(row["tool_call_id"], rr.json.loads(str(row["state_context_json"]))[0]["key"]) for row in rows] == [
        ("tool-1", str(first.resolve())),
        ("tool-2", str(second.resolve())),
        ("tool-3", str(third.resolve())),
    ]


def test_handshake_replays_one_tool_call_turn_without_repeating_it_on_final_assistant_turn(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    visible_file = tmp_path / "visible.txt"
    visible_dir = tmp_path / "docs"
    visible_dir.mkdir()
    monkeypatch.setattr(visibility, "SERVER_DB_PATH", rr.SERVER_DB_PATH)
    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO visible_directories(path, access_mode, created_at, updated_at) VALUES (?, 'read_write', ?, ?)",
            (str(tmp_path.resolve()), "t", "t"),
        )
        conn.commit()
    dispatcher = _BatchedToolLoopDispatcher(str(visible_file), str(visible_dir))
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: dispatcher)

    thread_id = runtime.create_thread()
    runtime.enqueue_message(
        thread_id=thread_id,
        text="close both contexts",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="tool-handshake-batch-1",
        session_id=None,
    )

    _drain_thread(runtime, thread_id)

    session = runtime.create_session(thread_id, None)
    ws = _CollectingWebSocket()
    asyncio.run(runtime.stream_handshake(session, ws))

    committed = [frame["turn"] for frame in ws.frames if frame["type"] == "committed_turn"]
    assert [turn["speaker"] for turn in committed] == ["user", "assistant", "assistant"]
    assert [call["name"] for call in committed[1]["tool_calls"]] == [
        "close_file_context",
        "close_directory_context",
    ]
    assert committed[2]["message_text"] == "done"
    assert committed[2].get("tool_calls", []) == []


def test_context_builder_applies_directory_rename_and_close(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    monkeypatch.setattr(rr, "REPO_ROOT", tmp_path)
    thread_id = runtime.create_thread()
    old_dir = tmp_path / "docs"
    new_dir = tmp_path / "renamed-docs"
    old_dir.mkdir(parents=True, exist_ok=True)
    file_path = new_dir / "note.txt"
    new_dir.mkdir(parents=True, exist_ok=True)
    file_path.write_text("hello world\n", encoding="utf-8")
    now = rr.utc_now()

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        _insert_turn(
            conn,
            turn_id="tc1-turn",
            thread_id=thread_id,
            prev_turn_id=None,
            turn_type="tool_call",
            actor_name="assistant",
            message_text="",
            tool_calls_json=rr.json.dumps(
                [{"id": "tc1", "name": "read_file", "args": {"path": str((old_dir / "note.txt").resolve())}}]
            ),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="t1",
            thread_id=thread_id,
            prev_turn_id="tc1-turn",
            turn_type="tool_response",
            actor_name="read_file",
            message_text="File context opened.",
            tool_call_id="tc1",
            tool_name="read_file",
            state_context_json=_state_ops_json(("file", str((old_dir / "note.txt").resolve()), "read", None)),
            stats_json=rr.json.dumps({"is_error": False}),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="tc2-turn",
            thread_id=thread_id,
            prev_turn_id="t1",
            turn_type="tool_call",
            actor_name="assistant",
            message_text="",
            tool_calls_json=rr.json.dumps(
                [
                    {
                        "id": "tc2",
                        "name": "move_path",
                        "args": {
                            "source_path": str(old_dir.resolve()),
                            "destination_path": str(new_dir.resolve()),
                        },
                    }
                ]
            ),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="t2",
            thread_id=thread_id,
            prev_turn_id="tc2-turn",
            turn_type="tool_response",
            actor_name="move_path",
            message_text="Moved file.",
            tool_call_id="tc2",
            tool_name="move_path",
            state_context_json=_state_ops_json(("directory", str(old_dir.resolve()), "rename", str(new_dir.resolve()))),
            stats_json=rr.json.dumps({"is_error": False}),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="t3",
            thread_id=thread_id,
            prev_turn_id="t2",
            turn_type="user_message",
            actor_name="user",
            message_text="what is open?",
            created_at=now,
        )
        conn.execute("UPDATE threads SET tail_turn_id = 't3', updated_at = ? WHERE id = ?", (now, thread_id))
        conn.commit()

    with runtime._db() as conn:
        messages = runtime._build_context_messages(conn, thread_id).messages
    assert any(
        f"You just read this file.\nFile: {file_path.resolve()}." in message.content
        for message in messages
    )

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        _insert_turn(
            conn,
            turn_id="t4",
            thread_id=thread_id,
            prev_turn_id="t3",
            turn_type="tool_call",
            actor_name="assistant",
            message_text="",
            tool_calls_json=rr.json.dumps(
                [{"id": "tc3", "name": "close_file_context", "args": {"path": str(file_path.resolve())}}]
            ),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="t4-response",
            thread_id=thread_id,
            prev_turn_id="t4",
            turn_type="tool_response",
            actor_name="close_file_context",
            message_text="Closed file context.",
            tool_call_id="tc3",
            tool_name="close_file_context",
            state_context_json=_state_ops_json(("file", str(file_path.resolve()), "close", None)),
            stats_json=rr.json.dumps({"is_error": False}),
            model_name="gpt-5-mini",
            created_at=now,
        )
        conn.execute("UPDATE threads SET tail_turn_id = 't4-response', updated_at = ? WHERE id = ?", (now, thread_id))
        conn.commit()

    with runtime._db() as conn:
        messages = runtime._build_context_messages(conn, thread_id).messages
    assert not any("File: " + str(file_path.resolve()) in message.content for message in messages)


def test_state_context_mutations_use_preexecution_path_types(tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    extless_file = tmp_path / "LICENSE"
    extless_file.write_text("hello\n", encoding="utf-8")
    folder = tmp_path / "docs"
    folder.mkdir()

    delete_mutations = runtime._state_context_mutations_for_tool_invocation(
        "delete_path",
        {"path": str(extless_file)},
    )
    move_mutations = runtime._state_context_mutations_for_tool_invocation(
        "move_path",
        {
            "source_path": str(folder),
            "destination_path": str(tmp_path / "renamed-docs"),
        },
    )

    assert delete_mutations == [
        rr.StateContextMutation("file", str(extless_file.resolve()), "close")
    ]
    assert move_mutations == [
        rr.StateContextMutation(
            "directory",
            str(folder.resolve()),
            "rename",
            str((tmp_path / "renamed-docs").resolve()),
        )
    ]


def test_state_context_mutations_capture_file_actions(tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    file_path = tmp_path / "note.txt"
    patch = "\n".join(
        [
            "*** Begin Patch",
            f"*** Add File: {file_path}",
            "+hello",
            "*** End Patch",
        ]
    )

    read_mutations = runtime._state_context_mutations_for_tool_invocation(
        "read_file",
        {"path": str(file_path)},
    )
    write_mutations = runtime._state_context_mutations_for_tool_invocation(
        "create_file",
        {"path": str(file_path)},
    )
    patch_mutations = runtime._state_context_mutations_for_tool_invocation(
        "apply_patch",
        {"patch": patch},
    )

    assert read_mutations == [
        rr.StateContextMutation("file", str(file_path.resolve()), "read", action="read")
    ]
    assert write_mutations == [
        rr.StateContextMutation("file", str(file_path.resolve()), "read", action="write")
    ]
    assert patch_mutations == [
        rr.StateContextMutation("file", str(file_path.resolve()), "read", action="patch")
    ]


def test_context_builder_uses_operation_aware_file_messages_and_deferred_notes(tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    thread_id = runtime.create_thread()
    file_path = tmp_path / "note.txt"
    file_path.write_text("updated\n", encoding="utf-8")
    now = rr.utc_now()

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        _insert_turn(
            conn,
            turn_id="call-read",
            thread_id=thread_id,
            prev_turn_id=None,
            turn_type="tool_call",
            actor_name="assistant",
            message_text="",
            tool_calls_json=rr.json.dumps(
                [{"id": "tool-read", "name": "read_file", "args": {"path": str(file_path.resolve())}}]
            ),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="resp-read",
            thread_id=thread_id,
            prev_turn_id="call-read",
            turn_type="tool_response",
            actor_name="read_file",
            message_text="Opened note.",
            tool_call_id="tool-read",
            tool_name="read_file",
            state_context_json=_state_ops_json(("file", str(file_path.resolve()), "read", None, "read")),
            stats_json=rr.json.dumps({"is_error": False}),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="call-write",
            thread_id=thread_id,
            prev_turn_id="resp-read",
            turn_type="tool_call",
            actor_name="assistant",
            message_text="",
            tool_calls_json=rr.json.dumps(
                [
                    {
                        "id": "tool-write",
                        "name": "create_file",
                        "args": {"path": str(file_path.resolve()), "content": "updated\n", "overwrite": True},
                    }
                ]
            ),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="resp-write",
            thread_id=thread_id,
            prev_turn_id="call-write",
            turn_type="tool_response",
            actor_name="create_file",
            message_text="Wrote note.",
            tool_call_id="tool-write",
            tool_name="create_file",
            state_context_json=_state_ops_json(("file", str(file_path.resolve()), "read", None, "write")),
            stats_json=rr.json.dumps({"is_error": False}),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="u1",
            thread_id=thread_id,
            prev_turn_id="resp-write",
            turn_type="user_message",
            actor_name="user",
            message_text="what changed?",
            created_at=now,
        )
        conn.execute("UPDATE threads SET tail_turn_id = 'u1', updated_at = ? WHERE id = ?", (now, thread_id))
        conn.commit()

    with runtime._db() as conn:
        messages = runtime._build_context_messages(conn, thread_id).messages

    system_messages = [message.content for message in messages if message.role == "system"]
    assert any(
        content == "You just read this file; its contents will appear later in your context."
        for content in system_messages
    )
    assert any(
        content.startswith(f"You just wrote this file.\nFile: {file_path.resolve()}.")
        and "updated\n" in content
        for content in system_messages
    )


def test_context_builder_keeps_duplicate_directory_reads_silently_skipped(tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    thread_id = runtime.create_thread()
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "a.txt").write_text("a\n", encoding="utf-8")
    now = rr.utc_now()

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        _insert_turn(
            conn,
            turn_id="call-dir-1",
            thread_id=thread_id,
            prev_turn_id=None,
            turn_type="tool_call",
            actor_name="assistant",
            message_text="",
            tool_calls_json=rr.json.dumps(
                [{"id": "tool-dir-1", "name": "list_directory", "args": {"path": str(docs_dir.resolve())}}]
            ),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="resp-dir-1",
            thread_id=thread_id,
            prev_turn_id="call-dir-1",
            turn_type="tool_response",
            actor_name="list_directory",
            message_text="Listed docs.",
            tool_call_id="tool-dir-1",
            tool_name="list_directory",
            state_context_json=_state_ops_json(("directory", str(docs_dir.resolve()), "read", None)),
            stats_json=rr.json.dumps({"is_error": False}),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="call-dir-2",
            thread_id=thread_id,
            prev_turn_id="resp-dir-1",
            turn_type="tool_call",
            actor_name="assistant",
            message_text="",
            tool_calls_json=rr.json.dumps(
                [{"id": "tool-dir-2", "name": "list_directory", "args": {"path": str(docs_dir.resolve())}}]
            ),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="resp-dir-2",
            thread_id=thread_id,
            prev_turn_id="call-dir-2",
            turn_type="tool_response",
            actor_name="list_directory",
            message_text="Listed docs again.",
            tool_call_id="tool-dir-2",
            tool_name="list_directory",
            state_context_json=_state_ops_json(("directory", str(docs_dir.resolve()), "read", None)),
            stats_json=rr.json.dumps({"is_error": False}),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="user-1",
            thread_id=thread_id,
            prev_turn_id="resp-dir-2",
            turn_type="user_message",
            actor_name="user",
            message_text="show open context",
            created_at=now,
        )
        conn.execute("UPDATE threads SET tail_turn_id = 'user-1', updated_at = ? WHERE id = ?", (now, thread_id))
        conn.commit()

    with runtime._db() as conn:
        messages = runtime._build_context_messages(conn, thread_id).messages

    directory_messages = [
        message.content for message in messages if message.role == "system" and message.content.startswith("Directory: ")
    ]
    assert len(directory_messages) == 1
    assert directory_messages[0].startswith(f"Directory: {docs_dir.resolve()}.")


def test_context_builder_keeps_deferred_file_note_when_file_is_deleted(tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    thread_id = runtime.create_thread()
    file_path = tmp_path / "note.txt"
    file_path.write_text("updated\n", encoding="utf-8")
    now = rr.utc_now()

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        _insert_turn(
            conn,
            turn_id="call-read",
            thread_id=thread_id,
            prev_turn_id=None,
            turn_type="tool_call",
            actor_name="assistant",
            message_text="",
            tool_calls_json=rr.json.dumps(
                [{"id": "tool-read", "name": "read_file", "args": {"path": str(file_path.resolve())}}]
            ),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="resp-read",
            thread_id=thread_id,
            prev_turn_id="call-read",
            turn_type="tool_response",
            actor_name="read_file",
            message_text="Opened note.",
            tool_call_id="tool-read",
            tool_name="read_file",
            state_context_json=_state_ops_json(("file", str(file_path.resolve()), "read", None, "read")),
            stats_json=rr.json.dumps({"is_error": False}),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="call-write",
            thread_id=thread_id,
            prev_turn_id="resp-read",
            turn_type="tool_call",
            actor_name="assistant",
            message_text="",
            tool_calls_json=rr.json.dumps(
                [
                    {
                        "id": "tool-write",
                        "name": "create_file",
                        "args": {"path": str(file_path.resolve()), "content": "updated\n", "overwrite": True},
                    }
                ]
            ),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="resp-write",
            thread_id=thread_id,
            prev_turn_id="call-write",
            turn_type="tool_response",
            actor_name="create_file",
            message_text="Wrote note.",
            tool_call_id="tool-write",
            tool_name="create_file",
            state_context_json=_state_ops_json(("file", str(file_path.resolve()), "read", None, "write")),
            stats_json=rr.json.dumps({"is_error": False}),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="u1",
            thread_id=thread_id,
            prev_turn_id="resp-write",
            turn_type="user_message",
            actor_name="user",
            message_text="what changed?",
            created_at=now,
        )
        conn.execute("UPDATE threads SET tail_turn_id = 'u1', updated_at = ? WHERE id = ?", (now, thread_id))
        conn.commit()

    file_path.unlink()

    with runtime._db() as conn:
        messages = runtime._build_context_messages(conn, thread_id).messages

    system_messages = [message.content for message in messages if message.role == "system"]
    assert any(
        content == "You just read this file; its contents will appear later in your context."
        for content in system_messages
    )
    assert any(
        content == f"Cannot read {file_path.resolve()}, it may have been moved or deleted."
        for content in system_messages
    )


def test_context_builder_defaults_legacy_file_entries_to_read_presentation(tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    thread_id = runtime.create_thread()
    file_path = tmp_path / "legacy.txt"
    file_path.write_text("legacy\n", encoding="utf-8")
    now = rr.utc_now()

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        _insert_turn(
            conn,
            turn_id="tc1",
            thread_id=thread_id,
            prev_turn_id=None,
            turn_type="tool_call",
            actor_name="assistant",
            message_text="",
            tool_calls_json=rr.json.dumps(
                [{"id": "tool-1", "name": "read_file", "args": {"path": str(file_path.resolve())}}]
            ),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="tr1",
            thread_id=thread_id,
            prev_turn_id="tc1",
            turn_type="tool_response",
            actor_name="read_file",
            message_text="Opened legacy file.",
            tool_call_id="tool-1",
            tool_name="read_file",
            state_context_json=_state_ops_json(("file", str(file_path.resolve()), "read", None)),
            stats_json=rr.json.dumps({"is_error": False}),
            model_name="gpt-5-mini",
            created_at=now,
        )
        conn.execute("UPDATE threads SET tail_turn_id = 'tr1', updated_at = ? WHERE id = ?", (now, thread_id))
        conn.commit()

    with runtime._db() as conn:
        messages = runtime._build_context_messages(conn, thread_id).messages

    assert any(
        message.role == "system"
        and message.content.startswith(f"You just read this file.\nFile: {file_path.resolve()}.")
        for message in messages
    )


def test_apply_patch_tool_loop_tracks_all_targets(monkeypatch, tmp_path: Path) -> None:
    _configure_paths(tmp_path)
    repo_root = tmp_path / "repo"
    vault_root = repo_root / "vault"
    repo_root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(visibility, "REPO_ROOT", repo_root)
    monkeypatch.setattr(visibility, "SERVER_DB_PATH", rr.SERVER_DB_PATH)
    monkeypatch.setattr(vault_runtime, "VAULT_DB_PATH", rr.DATA_DIR / "vaults.sqlite3")

    runtime = rr.RewriteRuntime()
    runtime.initialize()
    runtime.create_vault(root_path=str(vault_root))

    existing = vault_root / "existing.txt"
    removed = vault_root / "remove.txt"
    existing.parent.mkdir(parents=True, exist_ok=True)
    existing.write_text("one\n", encoding="utf-8")
    removed.write_text("bye\n", encoding="utf-8")

    patch = "\n".join(
        [
            "*** Begin Patch",
            f"*** Update File: {existing}",
            "@@",
            "-one",
            "+two",
            f"*** Add File: {vault_root / 'added.txt'}",
            "+hello",
            f"*** Delete File: {removed}",
            "*** End Patch",
        ]
    )
    dispatcher = _ApplyPatchToolLoopDispatcher(patch)
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: dispatcher)

    thread_id = runtime.create_thread()
    runtime.enqueue_message(
        thread_id=thread_id,
        text="patch these files",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="patch-loop-1",
        session_id=None,
    )

    _drain_thread(runtime, thread_id)

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT turn_type, tool_call_id, state_context_json
            FROM turns
            WHERE thread_id = ? AND turn_type = 'tool_response'
            ORDER BY rowid
            """,
            (thread_id,),
        ).fetchall()

    parsed_ops = [rr.json.loads(str(row["state_context_json"])) for row in rows]
    assert [(item["operation"], item.get("action"), item["key"]) for item in parsed_ops[0]] == [
        ("read", "patch", str(existing.resolve())),
        ("read", "patch", str((vault_root / "added.txt").resolve())),
        ("close", None, str(removed.resolve())),
    ]
    assert rows[0]["tool_call_id"] == "tool-1"
    assert len(rows) == 1

    with runtime._db() as conn:
        messages = runtime._build_context_messages(conn, thread_id).messages
    contents = [message.content for message in messages]
    assert any(
        content.startswith(f"You just patched this file.\nFile: {existing.resolve()}.") and "two" in content
        for content in contents
    )
    assert any(
        content.startswith(f"You just patched this file.\nFile: {(vault_root / 'added.txt').resolve()}.")
        and "hello" in content
        for content in contents
    )
    assert not any(f"File: {removed.resolve()}" in content for content in contents)


def test_unrelated_thread_can_run_while_other_thread_waits_in_tool_loop(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    dispatcher = _SingleToolLoopDispatcher()
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: dispatcher)

    thread_one = runtime.create_thread()
    thread_two = runtime.create_thread()
    runtime.enqueue_message(
        thread_id=thread_one,
        text="first thread",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="thread-1",
        session_id=None,
    )
    asyncio.run(runtime.process_next_runnable())

    runtime.enqueue_message(
        thread_id=thread_two,
        text="second thread",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="thread-2",
        session_id=None,
    )
    asyncio.run(runtime.process_next_runnable())

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        one_rows = conn.execute(
            "SELECT turn_type FROM turns WHERE thread_id = ? ORDER BY created_at, id",
            (thread_one,),
        ).fetchall()
        two_rows = conn.execute(
            "SELECT turn_type FROM turns WHERE thread_id = ? ORDER BY created_at, id",
            (thread_two,),
        ).fetchall()

    assert [row["turn_type"] for row in one_rows][-1] == "tool_call"
    assert [row["turn_type"] for row in two_rows][-1] == "assistant_message"


def test_restart_continuation_resumes_from_persisted_tool_loop(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    thread_id = runtime.create_thread()
    example_path = tmp_path / "example.txt"
    dispatcher = _ResumeOnlyDispatcher("resumed after restart")
    now = rr.utc_now()

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        _insert_turn(
            conn,
            turn_id="u1",
            thread_id=thread_id,
            prev_turn_id=None,
            turn_type="user_message",
            actor_name="user",
            message_text="do the thing",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="tc1",
            thread_id=thread_id,
            prev_turn_id="u1",
            turn_type="tool_call",
            actor_name="assistant",
            message_text="",
            tool_calls_json=rr.json.dumps(
                [{"id": "tool-1", "name": "close_file_context", "args": {"path": str(example_path.resolve())}}]
            ),
            model_name="gpt-5-mini",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="tr1",
            thread_id=thread_id,
            prev_turn_id="tc1",
            turn_type="tool_response",
            actor_name="close_file_context",
            message_text="Closed file context.",
            tool_call_id="tool-1",
            tool_name="close_file_context",
            state_context_json=_state_ops_json(("file", str(example_path.resolve()), "close", None)),
            stats_json=rr.json.dumps({"is_error": False}),
            model_name="gpt-5-mini",
            created_at=now,
        )
        conn.execute("UPDATE threads SET tail_turn_id = 'tr1', updated_at = ? WHERE id = ?", (now, thread_id))
        conn.execute(
            """
            INSERT INTO message_queue(
                thread_id, response_to_turn_id, sender, message_text, model_name,
                client_message_id, enqueued_at, available_at
            ) VALUES (?, ?, 'user', ?, ?, ?, ?, ?)
            """,
            (thread_id, None, "do the thing", "gpt-5-mini", "restart-1", now, now),
        )
        conn.commit()

    restarted = rr.RewriteRuntime()
    restarted.initialize()
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: dispatcher)

    asyncio.run(restarted.process_next_runnable())

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT turn_type, message_text FROM turns WHERE thread_id = ? ORDER BY rowid",
            (thread_id,),
        ).fetchall()
        queue_rows = conn.execute("SELECT id FROM message_queue WHERE thread_id = ?", (thread_id,)).fetchall()

    assert dispatcher.calls == 1
    assert dispatcher.last_messages is not None
    assert any(message.role == "assistant" and message.tool_calls for message in dispatcher.last_messages)
    assert any(message.role == "tool" and message.tool_call_id == "tool-1" for message in dispatcher.last_messages)
    assert [row["turn_type"] for row in rows] == ["user_message", "tool_call", "tool_response", "assistant_message"]
    assert rows[-1]["message_text"] == "resumed after restart"
    assert queue_rows == []


def test_orphan_tool_response_fails_before_assistant_commit(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    thread_id = runtime.create_thread()
    dispatcher = _ResumeOnlyDispatcher("should not commit")
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: dispatcher)
    now = rr.utc_now()

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        _insert_turn(
            conn,
            turn_id="u1",
            thread_id=thread_id,
            prev_turn_id=None,
            turn_type="user_message",
            actor_name="user",
            message_text="do the broken thing",
            created_at=now,
        )
        _insert_turn(
            conn,
            turn_id="tr1",
            thread_id=thread_id,
            prev_turn_id="u1",
            turn_type="tool_response",
            actor_name="close_file_context",
            message_text="broken orphan response",
            tool_call_id="missing-tool-call",
            tool_name="close_file_context",
            stats_json=rr.json.dumps({"is_error": False}),
            model_name="gpt-5-mini",
            created_at=now,
        )
        conn.execute("UPDATE threads SET tail_turn_id = 'tr1', updated_at = ? WHERE id = ?", (now, thread_id))
        conn.execute(
            """
            INSERT INTO message_queue(
                thread_id, response_to_turn_id, sender, message_text, model_name,
                client_message_id, enqueued_at, available_at
            ) VALUES (?, ?, 'user', ?, ?, ?, ?, ?)
            """,
            (thread_id, None, "do the broken thing", "gpt-5-mini", "orphan-1", now, now),
        )
        conn.commit()

    asyncio.run(runtime.process_next_runnable())

    with sqlite3.connect(rr.SERVER_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        assistant_rows = conn.execute(
            "SELECT id FROM turns WHERE thread_id = ? AND turn_type = 'assistant_message'",
            (thread_id,),
        ).fetchall()
        error_row = conn.execute(
            "SELECT error_text FROM queue_errors WHERE thread_id = ? ORDER BY id DESC LIMIT 1",
            (thread_id,),
        ).fetchone()
        queue_rows = conn.execute("SELECT id FROM message_queue WHERE thread_id = ?", (thread_id,)).fetchall()

    assert dispatcher.calls == 0
    assert assistant_rows == []
    assert error_row is not None
    assert "unknown tool_call_id" in str(error_row["error_text"])
    assert queue_rows == []


def test_fatal_classification_uses_exception_types_not_message_text(tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    assert runtime._is_fatal_error(RuntimeError("authentication failed")) is False
    assert runtime._is_fatal_error(rr.FatalExecutionError("fatal")) is True
    assert runtime._is_fatal_error(rr.UnsupportedModelError("unsupported")) is True


def test_model_provider_uses_registry_without_db_roundtrip(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)

    @contextmanager
    def _db_should_not_be_called():
        raise AssertionError("_db() should not be called by _model_provider")
        yield

    monkeypatch.setattr(runtime, "_db", _db_should_not_be_called)
    monkeypatch.setattr(
        rr,
        "get_model_registry",
        lambda: SimpleNamespace(
            resolve_model=lambda _name, allow_refresh=False: SimpleNamespace(provider="ollama")
        ),
    )
    assert runtime._model_provider("llama3.2:latest") == "ollama"


def test_commit_stage_fatal_error_moves_row_to_queue_errors(monkeypatch, tmp_path: Path) -> None:
    runtime = _new_runtime(tmp_path)
    monkeypatch.setattr(rr, "build_dispatcher", lambda model_override=None: _CompactionDispatcher())
    monkeypatch.setattr(runtime, "_model_provider", lambda _model_name: "openai")

    thread_id = runtime.create_thread()
    queue_id = runtime.enqueue_message(
        thread_id=thread_id,
        text="trigger commit fatal",
        model_name="gpt-5-mini",
        in_response_to_turn_id=None,
        client_message_id="m11",
        session_id=None,
    )

    original_db = runtime._db
    calls = {"n": 0}

    @contextmanager
    def _db_with_commit_failure():
        calls["n"] += 1
        if calls["n"] == 5:
            raise rr.FatalExecutionError("forced commit failure")
        with original_db() as conn:
            yield conn

    monkeypatch.setattr(runtime, "_db", _db_with_commit_failure)
    asyncio.run(runtime.process_next_runnable())

    conn = sqlite3.connect(rr.SERVER_DB_PATH)
    conn.row_factory = sqlite3.Row
    queue_row = conn.execute("SELECT * FROM message_queue WHERE id = ?", (queue_id,)).fetchone()
    error_row = conn.execute("SELECT * FROM queue_errors WHERE queue_id = ?", (queue_id,)).fetchone()
    request_row = conn.execute("SELECT * FROM requests ORDER BY created_at DESC LIMIT 1").fetchone()
    conn.close()

    assert queue_row is None
    assert error_row is not None
    assert error_row["failure_stage"] == "commit"
    if request_row is not None:
        assert "fatal_error[commit]" in str(request_row["error_text"])
