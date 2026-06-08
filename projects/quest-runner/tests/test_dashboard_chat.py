"""Tests for ChatStreamSession replay and live streaming."""

from __future__ import annotations

import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from quest_runner_service.chat_event_bus import ChatEventBus  # type: ignore[import-not-found]
from quest_runner_service.dashboard_chat import ChatStreamSession  # type: ignore[import-not-found]

from .test_helpers import TempRepo, ensure_project, make_app_client, quest_dir_on_checkout


def _base_event(*, sequence: int, event_kind: str, **fields: object) -> dict:
    event = {
        "schema_version": 1,
        "timestamp": "2026-01-01T00:00:00Z",
        "sequence": sequence,
        "step": 1,
        "role": "implementer",
        "thread": "test-thread",
        "harness": "cursor",
        "provider_thread_id": "provider-1",
        "event_kind": event_kind,
    }
    event.update(fields)
    return event


class FakeWebSocket:
    def __init__(self, *, close_after_caught_up: bool = True) -> None:
        self.messages: list[dict] = []
        self.closed = False
        self._send_raises = False
        self._close_after_caught_up = close_after_caught_up

    def send(self, data: str) -> None:
        if self.closed or self._send_raises:
            raise ConnectionError("send failed")
        message = json.loads(data)
        self.messages.append(message)
        if self._close_after_caught_up and message.get("type") == "caught_up":
            self.closed = True

    def fail_sends(self) -> None:
        self._send_raises = True


class ChatStreamSessionTests(unittest.TestCase):
    def _write_jsonl(self, path: Path, events: list[dict], *, extra_lines: list[str] | None = None) -> None:
        lines: list[str] = []
        for event in events:
            lines.append(json.dumps(event, sort_keys=True))
        if extra_lines:
            lines.extend(extra_lines)
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def _run_session(
        self,
        path: Path,
        *,
        ws: FakeWebSocket | None = None,
        bus: ChatEventBus | None = None,
        in_thread: bool = False,
    ) -> tuple[FakeWebSocket, ChatEventBus, threading.Thread | None]:
        websocket = ws or FakeWebSocket(close_after_caught_up=not in_thread)
        event_bus = bus or ChatEventBus()
        session = ChatStreamSession(path, websocket, event_bus)
        thread: threading.Thread | None = None
        if in_thread:
            thread = threading.Thread(target=session.run, daemon=True)
            thread.start()
        else:
            session.run()
        return websocket, event_bus, thread

    def _wait_for_message_type(self, ws: FakeWebSocket, message_type: str, timeout: float = 2.0) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if any(message.get("type") == message_type for message in ws.messages):
                return
            time.sleep(0.02)
        self.fail(f"timed out waiting for {message_type!r}")

    def test_replay_sends_events_and_caught_up(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "step_0001_implementer.jsonl"
            self._write_jsonl(
                path,
                [
                    _base_event(sequence=1, event_kind="sheaf.run_started", model="m"),
                    _base_event(sequence=2, event_kind="sheaf.prompt", text="hello"),
                    _base_event(sequence=3, event_kind="sheaf.run_completed"),
                ],
            )

            ws, _, _ = self._run_session(path)

        event_messages = [message for message in ws.messages if message["type"] == "events"]
        self.assertGreaterEqual(len(event_messages), 1)
        agui_types = [
            event["type"]
            for message in event_messages
            for event in message["events"]
        ]
        self.assertIn("RUN_STARTED", agui_types)
        self.assertIn("TEXT_MESSAGE_START", agui_types)
        self.assertIn("RUN_FINISHED", agui_types)
        self.assertEqual(ws.messages[-1], {"type": "caught_up"})

    def test_replay_batches_at_one_hundred_events(self) -> None:
        events = [_base_event(sequence=1, event_kind="sheaf.run_started", model="m")]
        sequence = 2
        while sequence < 36:
            events.append(
                _base_event(
                    sequence=sequence,
                    event_kind="sheaf.prompt",
                    text=f"prompt-{sequence}",
                )
            )
            sequence += 1

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "step_0001_implementer.jsonl"
            self._write_jsonl(path, events)
            ws, _, _ = self._run_session(path)

        event_messages = [message for message in ws.messages if message["type"] == "events"]
        batch_sizes = [len(message["events"]) for message in event_messages]
        self.assertIn(100, batch_sizes)
        self.assertGreater(sum(batch_sizes), 100)

    def test_live_event_streams_after_replay(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "step_0001_implementer.jsonl"
            self._write_jsonl(
                path,
                [
                    _base_event(sequence=1, event_kind="sheaf.run_started", model="m"),
                    _base_event(sequence=2, event_kind="sheaf.prompt", text="hello"),
                    _base_event(sequence=3, event_kind="sheaf.run_completed"),
                ],
            )

            ws = FakeWebSocket(close_after_caught_up=False)
            ws, bus, thread = self._run_session(path, ws=ws, in_thread=True)
            assert thread is not None
            self._wait_for_message_type(ws, "caught_up")

            replay_event_count = sum(
                len(message["events"])
                for message in ws.messages
                if message["type"] == "events"
            )

            bus.publish(
                path,
                _base_event(sequence=4, event_kind="sheaf.prompt", text="live"),
            )

            deadline = time.monotonic() + 2.0
            while time.monotonic() < deadline:
                live_count = sum(
                    len(message["events"])
                    for message in ws.messages
                    if message["type"] == "events"
                )
                if live_count > replay_event_count:
                    break
                time.sleep(0.02)
            else:
                self.fail("timed out waiting for live event")

            ws.closed = True
            thread.join(timeout=2.0)
            self.assertFalse(thread.is_alive())

    def test_live_event_skips_replayed_sequence(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "step_0001_implementer.jsonl"
            self._write_jsonl(
                path,
                [
                    _base_event(sequence=1, event_kind="sheaf.run_started", model="m"),
                    _base_event(sequence=2, event_kind="sheaf.prompt", text="hello"),
                ],
            )

            ws = FakeWebSocket(close_after_caught_up=False)
            ws, bus, thread = self._run_session(path, ws=ws, in_thread=True)
            assert thread is not None
            self._wait_for_message_type(ws, "caught_up")

            replay_event_count = sum(
                len(message["events"])
                for message in ws.messages
                if message["type"] == "events"
            )

            bus.publish(
                path,
                _base_event(sequence=2, event_kind="sheaf.prompt", text="duplicate"),
            )
            bus.publish(
                path,
                _base_event(sequence=3, event_kind="sheaf.prompt", text="new"),
            )

            deadline = time.monotonic() + 2.0
            while time.monotonic() < deadline:
                live_count = sum(
                    len(message["events"])
                    for message in ws.messages
                    if message["type"] == "events"
                )
                if live_count > replay_event_count:
                    break
                time.sleep(0.02)
            else:
                self.fail("timed out waiting for deduplicated live event")

            all_text_deltas = [
                event.get("delta", "")
                for message in ws.messages
                if message.get("type") == "events"
                for event in message["events"]
                if event.get("type") == "TEXT_MESSAGE_CONTENT"
            ]
            self.assertIn("new", all_text_deltas)
            self.assertNotIn("duplicate", all_text_deltas)

            ws.closed = True
            thread.join(timeout=2.0)

    def test_malformed_json_sends_error_and_continues_replay(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "step_0001_implementer.jsonl"
            self._write_jsonl(
                path,
                [
                    _base_event(sequence=1, event_kind="sheaf.run_started", model="m"),
                    _base_event(sequence=3, event_kind="sheaf.prompt", text="after error"),
                ],
                extra_lines=["not-json"],
            )

            ws, _, _ = self._run_session(path)

        error_messages = [message for message in ws.messages if message["type"] == "error"]
        self.assertEqual(len(error_messages), 1)
        self.assertIn("invalid JSON", error_messages[0]["message"])
        self.assertEqual(ws.messages[-1], {"type": "caught_up"})

    def test_send_failure_exits_and_unsubscribes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "step_0001_implementer.jsonl"
            self._write_jsonl(
                path,
                [
                    _base_event(sequence=1, event_kind="sheaf.run_started", model="m"),
                ],
            )

            ws = FakeWebSocket()
            bus = ChatEventBus()
            ws.fail_sends()
            ChatStreamSession(path, ws, bus).run()

            self.assertEqual(ws.messages, [])
            self.assertEqual(bus._subscribers, {})


class AgentLogStreamRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def _stream_handler(self, client_app):
        handler = client_app.view_functions["dashboard_agent_log_stream"]
        return handler.__wrapped__

    def _invoke_stream(self, app, ws, query_string: dict) -> None:
        with app.test_request_context(
            "/api/dashboard/agent_log/stream",
            query_string=query_string,
        ):
            self._stream_handler(app)(ws)

    def test_stream_route_replays_log_and_sends_caught_up(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            str(self.temp.root), "example", "main", "Streamy"
        )
        qdir = quest_dir_on_checkout(self.temp.root, out)
        logs = qdir / "logs"
        logs.mkdir()
        log_path = logs / "step_0001_implementer.jsonl"
        log_path.write_text(
            "\n".join(
                [
                    json.dumps(
                        _base_event(sequence=1, event_kind="sheaf.run_started", model="m"),
                        sort_keys=True,
                    ),
                    json.dumps(
                        _base_event(sequence=2, event_kind="sheaf.prompt", text="hello"),
                        sort_keys=True,
                    ),
                ]
            )
            + "\n",
            encoding="utf-8",
        )

        ws = FakeWebSocket()
        self._invoke_stream(
            client.application,
            ws,
            {
                "project": "example",
                "quest_type": "main",
                "quest_number": str(out["quest_number"]),
                "agent_key": "slice:implementer",
            },
        )

        self.assertTrue(any(message["type"] == "events" for message in ws.messages))
        self.assertEqual(ws.messages[-1], {"type": "caught_up"})

    def test_stream_route_invalid_agent_key_sends_error(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            str(self.temp.root), "example", "main", "Streamy"
        )

        ws = FakeWebSocket()
        self._invoke_stream(
            client.application,
            ws,
            {
                "project": "example",
                "quest_type": "main",
                "quest_number": str(out["quest_number"]),
                "agent_key": "slice:not_a_real_role",
            },
        )

        self.assertEqual(
            ws.messages,
            [{"type": "error", "message": "Unknown slice-scoped role: 'not_a_real_role'"}],
        )

    def test_stream_route_missing_log_sends_error(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            str(self.temp.root), "example", "main", "Streamy"
        )

        ws = FakeWebSocket()
        self._invoke_stream(
            client.application,
            ws,
            {
                "project": "example",
                "quest_type": "main",
                "quest_number": str(out["quest_number"]),
                "agent_key": "slice:implementer",
            },
        )

        self.assertEqual(
            ws.messages,
            [{"type": "error", "message": "No log artifacts for role 'implementer'"}],
        )


class QuestServiceChatBusTests(unittest.TestCase):
    def test_quest_service_has_chat_event_bus(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        temp = TempRepo(repo_root)
        self.addCleanup(temp.cleanup)
        _client, svc = make_app_client(temp.root, repo_root)
        self.assertIsInstance(svc.chat_event_bus, ChatEventBus)


if __name__ == "__main__":
    unittest.main()
