"""Map quest runner harness JSONL events to AGUI events."""

from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


JsonObject = dict[str, Any]


@dataclass(frozen=True)
class OpenToolCall:
    tool_call_id: str
    tool_call_name: str
    parent_message_id: str | None = None


@dataclass(frozen=True)
class ClaudeContentBlock:
    kind: str
    message_id: str
    tool_call_id: str | None = None
    tool_call_name: str | None = None


class QuestLogToAguiMapper:
    """Stateful adapter from quest runner log events to AGUI events."""

    def __init__(self) -> None:
        self._fallback_events: list[JsonObject] = []
        self._open_runs: set[str] = set()
        self._open_text_messages: set[str] = set()
        self._open_reasoning_messages: set[str] = set()
        self._open_reasoning_phases: set[str] = set()
        self._open_tools: dict[str, OpenToolCall] = {}
        self._seen_tools: set[str] = set()
        self._tools_with_args: set[str] = set()
        self._claude_session_messages: dict[str, str] = {}
        self._claude_blocks: dict[tuple[str, int], ClaudeContentBlock] = {}

    def consume(self, event: JsonObject) -> list[JsonObject]:
        event_kind = event.get("event_kind")
        harness = event.get("harness")

        try:
            if event_kind == "sheaf.run_started":
                return self._consume_run_started(event)
            if event_kind == "sheaf.run_completed":
                return self._consume_run_completed(event)
            if event_kind == "sheaf.run_failed":
                return self._consume_run_failed(event)
            if event_kind == "sheaf.prompt":
                return self._text_message_triplet(event, self._source_id(event, "prompt"), event.get("text", ""), role="user")
            if event_kind == "sheaf.path_enforcement":
                return [self._custom(event, "sheaf.path_enforcement", self._without_raw_event_fields(event))]
            if event_kind == "provider.text":
                return [self._custom(event, "provider.text", {"text": event.get("text", "")})]
            if event_kind == "provider.json":
                payload = event.get("payload")
                if isinstance(payload, dict):
                    if harness == "cursor":
                        return self._consume_cursor_payload(event, payload)
                    if harness == "codex":
                        return self._consume_codex_payload(event, payload)
                    if harness == "claude_code":
                        return self._consume_claude_payload(event, payload)
                    if harness == "pi":
                        return self._consume_pi_payload(event, payload)
                return self._fallback(event)
        except Exception:
            return self._fallback(event)

        return self._fallback(event)

    def flush(self) -> list[JsonObject]:
        out: list[JsonObject] = []
        for tool_call_id in sorted(self._open_tools):
            out.append(self._agui({"type": "TOOL_CALL_END", "toolCallId": tool_call_id}))
        self._open_tools.clear()

        for message_id in sorted(self._open_reasoning_messages):
            out.append(self._agui({"type": "REASONING_MESSAGE_END", "messageId": message_id}))
        self._open_reasoning_messages.clear()

        for message_id in sorted(self._open_reasoning_phases):
            out.append(self._agui({"type": "REASONING_END", "messageId": message_id}))
        self._open_reasoning_phases.clear()

        for message_id in sorted(self._open_text_messages):
            out.append(self._agui({"type": "TEXT_MESSAGE_END", "messageId": message_id}))
        self._open_text_messages.clear()

        for run_id in sorted(self._open_runs):
            out.append(
                self._agui(
                    {
                        "type": "RUN_FINISHED",
                        "threadId": run_id,
                        "runId": run_id,
                    }
                )
            )
        self._open_runs.clear()
        self._claude_session_messages.clear()
        self._claude_blocks.clear()
        return out

    def reset(self) -> None:
        self.__init__()

    def errors(self) -> list[JsonObject]:
        return [deepcopy(event) for event in self._fallback_events]

    def _consume_run_started(self, event: JsonObject) -> list[JsonObject]:
        run_id = self._run_id(event)
        self._open_runs.add(run_id)
        return [
            self._agui(
                {
                    "type": "RUN_STARTED",
                    "threadId": str(event.get("provider_thread_id") or event.get("thread") or run_id),
                    "runId": run_id,
                    "rawEvent": event,
                },
                event,
            )
        ]

    def _consume_run_completed(self, event: JsonObject) -> list[JsonObject]:
        run_id = self._run_id(event)
        out = self._close_open_for_event(event)
        self._open_runs.discard(run_id)
        out.append(
            self._agui(
                {
                    "type": "RUN_FINISHED",
                    "threadId": str(event.get("provider_thread_id") or event.get("thread") or run_id),
                    "runId": run_id,
                    "result": self._without_raw_event_fields(event),
                    "rawEvent": event,
                },
                event,
            )
        )
        return out

    def _consume_run_failed(self, event: JsonObject) -> list[JsonObject]:
        run_id = self._run_id(event)
        out = self._close_open_for_event(event)
        self._open_runs.discard(run_id)
        detail = event.get("detail") or event.get("reason") or "Harness run failed"
        out.append(
            self._agui(
                {
                    "type": "RUN_ERROR",
                    "message": str(detail),
                    "code": str(event.get("reason") or event.get("exit_code") or "run_failed"),
                    "rawEvent": event,
                },
                event,
            )
        )
        return out

    def _consume_pi_payload(self, event: JsonObject, payload: JsonObject) -> list[JsonObject]:
        """Map Pi JSON mode events to AGUI events."""
        pi_type = payload.get("type")

        if pi_type == "agent_start":
            return []

        if pi_type == "agent_end":
            return []

        if pi_type == "turn_start":
            return [self._agui({"type": "STEP_STARTED", "stepName": "pi.turn", "rawEvent": event}, event)]

        if pi_type == "turn_end":
            return [self._agui({"type": "STEP_FINISHED", "stepName": "pi.turn", "rawEvent": event}, event)]

        if pi_type == "message_start":
            message = payload.get("message")
            if not isinstance(message, dict):
                return self._fallback(event)
            message_id = self._pi_message_id(event, message)
            if message_id in self._open_text_messages:
                return []
            self._open_text_messages.add(message_id)
            return [
                self._agui(
                    {"type": "TEXT_MESSAGE_START", "messageId": message_id, "role": self._agui_text_role(message.get("role")), "rawEvent": event},
                    event,
                ),
            ]

        if pi_type == "message_update":
            message = payload.get("message")
            message_event = payload.get("assistantMessageEvent")
            if not isinstance(message, dict) or not isinstance(message_event, dict):
                return self._fallback(event)
            message_id = self._pi_message_id(event, message)
            delta_type = message_event.get("type")

            if delta_type == "text_delta":
                text = message_event.get("delta", "")
                return self._append_text(event, message_id, str(text), role=self._agui_text_role(message.get("role")))

            if delta_type == "thinking_delta":
                text = message_event.get("delta", "")
                return self._append_reasoning(event, f"{message_id}:thinking", str(text))

            if delta_type == "tool_call_delta":
                tool_call_id, tool_name = self._pi_tool_call_identity(event, message, message_event)
                out = self._ensure_pi_tool_started(event, tool_call_id, tool_name, parent_message_id=message_id)
                delta = message_event.get("delta", "")
                out.append(self._tool_args(event, tool_call_id, str(delta)))
                return out

            return self._fallback(event)

        if pi_type == "message_end":
            message = payload.get("message")
            if not isinstance(message, dict):
                return self._fallback(event)
            message_id = self._pi_message_id(event, message)
            out = self._close_reasoning(event, f"{message_id}:thinking")
            out.extend(self._close_text(event, message_id))
            return out

        if pi_type == "tool_execution_start":
            tool_call_id = str(payload.get("toolCallId") or self._source_id(event, "pi-tool-exec"))
            tool_name = str(payload.get("toolName", "pi_tool"))
            out = self._ensure_pi_tool_started(event, tool_call_id, tool_name)
            if tool_call_id not in self._tools_with_args and "args" in payload:
                out.append(self._tool_args(event, tool_call_id, payload.get("args")))
            return out

        if pi_type == "tool_execution_update":
            tool_call_id = str(payload.get("toolCallId") or self._source_id(event, "pi-tool-exec"))
            tool_name = str(payload.get("toolName", "pi_tool"))
            partial_result = payload.get("partialResult")
            out = self._ensure_pi_tool_started(event, tool_call_id, tool_name)
            if tool_call_id not in self._tools_with_args and "args" in payload:
                out.append(self._tool_args(event, tool_call_id, payload.get("args")))
            out.append(self._tool_result(event, tool_call_id, partial_result))
            return out

        if pi_type == "tool_execution_end":
            tool_call_id = str(payload.get("toolCallId") or self._source_id(event, "pi-tool-exec"))
            tool_name = str(payload.get("toolName", "pi_tool"))
            result = {"result": payload.get("result"), "isError": payload.get("isError")} if "isError" in payload else payload.get("result")
            out = self._ensure_pi_tool_started(event, tool_call_id, tool_name)
            out.append(self._tool_result(event, tool_call_id, result))
            if tool_call_id in self._open_tools:
                out.append(self._agui({"type": "TOOL_CALL_END", "toolCallId": tool_call_id, "rawEvent": event}, event))
                self._open_tools.pop(tool_call_id, None)
            return out

        if pi_type == "compaction_start":
            return []

        if pi_type == "compaction_end":
            return []

        if pi_type == "auto_retry_start":
            return []

        if pi_type == "auto_retry_end":
            return []

        if pi_type == "queue_update":
            return []

        return self._fallback(event)

    def _pi_message_id(self, event: JsonObject, message: JsonObject) -> str:
        timestamp = message.get("timestamp")
        if timestamp is not None:
            thread = event.get("thread") or event.get("provider_thread_id") or "pi"
            step = event.get("step", "unknown")
            role = message.get("role") or "message"
            return f"{thread}:step:{step}:pi-message:{role}:{timestamp}"
        return self._source_id(event, "pi-message")

    def _pi_tool_call_identity(self, event: JsonObject, message: JsonObject, message_event: JsonObject) -> tuple[str, str]:
        content = message.get("content")
        if isinstance(content, list):
            for block in reversed(content):
                if isinstance(block, dict) and block.get("type") == "toolCall":
                    tool_call_id = str(block.get("id") or f"{self._pi_message_id(event, message)}:tool")
                    tool_name = str(message_event.get("name") or block.get("name") or "pi_tool")
                    return tool_call_id, tool_name
        return f"{self._pi_message_id(event, message)}:tool", str(message_event.get("name") or "pi_tool")

    def _ensure_pi_tool_started(
        self,
        event: JsonObject,
        tool_call_id: str,
        tool_name: str,
        parent_message_id: str | None = None,
    ) -> list[JsonObject]:
        if tool_call_id in self._open_tools:
            return []
        self._open_tools[tool_call_id] = OpenToolCall(tool_call_id, tool_name, parent_message_id)
        self._seen_tools.add(tool_call_id)
        fields: JsonObject = {
            "type": "TOOL_CALL_START",
            "toolCallId": tool_call_id,
            "toolCallName": tool_name,
            "rawEvent": event,
        }
        if parent_message_id is not None:
            fields["parentMessageId"] = parent_message_id
        return [self._agui(fields, event)]

    def _consume_cursor_payload(self, event: JsonObject, payload: JsonObject) -> list[JsonObject]:
        payload_type = payload.get("type")
        subtype = payload.get("subtype")

        if payload_type == "assistant":
            message_id = str(
                payload.get("model_call_id")
                or f"{payload.get('session_id') or event.get('provider_thread_id')}:assistant"
            )
            text = self._content_text(payload.get("message", {}).get("content"))
            return self._append_text(event, message_id, text, role="assistant")

        if payload_type == "user":
            message_id = self._source_id(event, "cursor-user")
            text = self._content_text(payload.get("message", {}).get("content"))
            return self._text_message_triplet(event, message_id, text, role="user")

        if payload_type == "thinking" and subtype == "delta":
            message_id = str(
                payload.get("model_call_id")
                or f"{payload.get('session_id') or event.get('provider_thread_id')}:thinking"
            )
            return self._append_reasoning(event, message_id, str(payload.get("text") or ""))

        if payload_type == "thinking" and subtype == "completed":
            message_id = str(
                payload.get("model_call_id")
                or f"{payload.get('session_id') or event.get('provider_thread_id')}:thinking"
            )
            return self._close_reasoning(event, message_id)

        if payload_type == "tool_call":
            if subtype == "started":
                return self._start_tool_from_payload(event, payload)
            if subtype == "completed":
                return self._complete_tool_from_payload(event, payload)

        if payload_type == "system" or payload_type == "result":
            return [self._custom(event, f"cursor.{payload_type}", payload)]

        if payload_type == "interaction_query":
            return [self._custom(event, "cursor.interaction_query", payload)]

        return self._fallback(event)

    def _consume_codex_payload(self, event: JsonObject, payload: JsonObject) -> list[JsonObject]:
        payload_type = payload.get("type")

        if payload_type == "turn.started":
            return [self._agui({"type": "STEP_STARTED", "stepName": "codex.turn", "rawEvent": event}, event)]
        if payload_type == "turn.completed":
            return [self._agui({"type": "STEP_FINISHED", "stepName": "codex.turn", "rawEvent": event}, event)]
        if payload_type == "thread.started":
            return [self._custom(event, "codex.thread.started", payload)]

        item = payload.get("item")
        if not isinstance(item, dict):
            return self._fallback(event)

        item_type = item.get("type")
        if payload_type == "item.completed" and item_type == "agent_message":
            return self._text_message_triplet(event, str(item.get("id") or self._source_id(event, "codex-message")), str(item.get("text") or ""), role="assistant")

        if item_type == "command_execution":
            return self._consume_codex_command(event, payload_type, item)

        if item_type == "file_change":
            return [
                self._agui(
                    {
                        "type": "ACTIVITY_SNAPSHOT",
                        "messageId": str(item.get("id") or self._source_id(event, "file-change")),
                        "activityType": "codex.file_change",
                        "content": item,
                        "replace": payload_type == "item.completed",
                        "rawEvent": event,
                    },
                    event,
                )
            ]

        return self._fallback(event)

    def _consume_claude_payload(self, event: JsonObject, payload: JsonObject) -> list[JsonObject]:
        payload_type = payload.get("type")

        if payload_type == "stream_event":
            stream_event = payload.get("event")
            if isinstance(stream_event, dict):
                return self._consume_claude_stream_event(event, payload, stream_event)
            return self._fallback(event)

        if payload_type == "user":
            message_id = self._source_id(event, "claude-user")
            text = self._content_text(payload.get("message", {}).get("content"))
            return self._text_message_triplet(event, message_id, text, role="user")

        if payload_type in {"assistant", "system", "rate_limit_event", "result"}:
            return [self._custom(event, f"claude.{payload_type}", payload)]

        return self._fallback(event)

    def _consume_claude_stream_event(
        self,
        event: JsonObject,
        payload: JsonObject,
        stream_event: JsonObject,
    ) -> list[JsonObject]:
        event_type = stream_event.get("type")
        session_id = str(payload.get("session_id") or event.get("provider_thread_id") or event.get("thread") or "claude")

        if event_type == "message_start":
            message = stream_event.get("message") if isinstance(stream_event.get("message"), dict) else {}
            message_id = str(message.get("id") or self._source_id(event, "claude-message"))
            self._claude_session_messages[session_id] = message_id
            if message_id not in self._open_text_messages:
                self._open_text_messages.add(message_id)
                return [self._agui({"type": "TEXT_MESSAGE_START", "messageId": message_id, "role": "assistant", "rawEvent": event}, event)]
            return []

        if event_type == "message_stop":
            message_id = self._claude_session_messages.get(session_id)
            if message_id:
                return self._close_text(event, message_id)
            return []

        if event_type == "content_block_start":
            return self._consume_claude_content_block_start(event, payload, stream_event, session_id)

        if event_type == "content_block_delta":
            return self._consume_claude_content_block_delta(event, payload, stream_event, session_id)

        if event_type == "content_block_stop":
            index = self._block_index(stream_event)
            block = self._claude_blocks.pop((session_id, index), None)
            if block is not None and block.kind == "tool_use" and block.tool_call_id:
                self._open_tools.pop(block.tool_call_id, None)
                return [self._agui({"type": "TOOL_CALL_END", "toolCallId": block.tool_call_id, "rawEvent": event}, event)]
            if block is not None and block.kind == "thinking":
                return self._close_reasoning(event, block.message_id)
            return []

        if event_type == "message_delta":
            return [self._custom(event, "claude.message_delta", stream_event)]

        return self._fallback(event)

    def _consume_claude_content_block_start(
        self,
        event: JsonObject,
        payload: JsonObject,
        stream_event: JsonObject,
        session_id: str,
    ) -> list[JsonObject]:
        content_block = stream_event.get("content_block")
        if not isinstance(content_block, dict):
            return self._fallback(event)
        index = self._block_index(stream_event)
        kind = str(content_block.get("type") or "unknown")
        message_id = self._claude_session_messages.get(session_id) or self._source_id(event, "claude-message")

        if kind == "text":
            self._claude_blocks[(session_id, index)] = ClaudeContentBlock(kind="text", message_id=message_id)
            text = str(content_block.get("text") or "")
            return self._append_text(event, message_id, text, role="assistant")

        if kind == "thinking":
            self._claude_blocks[(session_id, index)] = ClaudeContentBlock(kind="thinking", message_id=message_id)
            return self._append_reasoning(event, message_id, str(content_block.get("thinking") or ""))

        if kind == "tool_use":
            tool_call_id = str(content_block.get("id") or self._source_id(event, f"claude-tool-{index}"))
            tool_call_name = str(content_block.get("name") or "claude_tool")
            self._claude_blocks[(session_id, index)] = ClaudeContentBlock(
                kind="tool_use",
                message_id=message_id,
                tool_call_id=tool_call_id,
                tool_call_name=tool_call_name,
            )
            self._open_tools[tool_call_id] = OpenToolCall(tool_call_id, tool_call_name, message_id)
            self._seen_tools.add(tool_call_id)
            out = [
                self._agui(
                    {
                        "type": "TOOL_CALL_START",
                        "toolCallId": tool_call_id,
                        "toolCallName": tool_call_name,
                        "parentMessageId": message_id,
                        "rawEvent": event,
                    },
                    event,
                )
            ]
            tool_input = content_block.get("input")
            if tool_input is not None:
                out.append(self._tool_args(event, tool_call_id, tool_input))
            return out

        return self._fallback(event)

    def _consume_claude_content_block_delta(
        self,
        event: JsonObject,
        payload: JsonObject,
        stream_event: JsonObject,
        session_id: str,
    ) -> list[JsonObject]:
        index = self._block_index(stream_event)
        block = self._claude_blocks.get((session_id, index))
        delta = stream_event.get("delta") if isinstance(stream_event.get("delta"), dict) else {}
        delta_type = delta.get("type")
        message_id = block.message_id if block else self._claude_session_messages.get(session_id) or self._source_id(event, "claude-message")

        if delta_type == "text_delta":
            return self._append_text(event, message_id, str(delta.get("text") or ""), role="assistant")
        if delta_type == "thinking_delta":
            return self._append_reasoning(event, message_id, str(delta.get("thinking") or ""))
        if delta_type == "input_json_delta":
            tool_call_id = block.tool_call_id if block and block.tool_call_id else self._source_id(event, f"claude-tool-{index}")
            out: list[JsonObject] = []
            if tool_call_id not in self._open_tools:
                tool_call_name = block.tool_call_name if block and block.tool_call_name else "claude_tool"
                self._open_tools[tool_call_id] = OpenToolCall(tool_call_id, tool_call_name, message_id)
                self._seen_tools.add(tool_call_id)
                out.append(
                    self._agui(
                        {
                            "type": "TOOL_CALL_START",
                            "toolCallId": tool_call_id,
                            "toolCallName": tool_call_name,
                            "parentMessageId": message_id,
                            "rawEvent": event,
                        },
                        event,
                    )
                )
            out.append(self._tool_args(event, tool_call_id, str(delta.get("partial_json") or "")))
            return out
        if delta_type == "signature_delta":
            return [
                self._agui(
                    {
                        "type": "REASONING_ENCRYPTED_VALUE",
                        "subtype": "message",
                        "entityId": message_id,
                        "encryptedValue": str(delta.get("signature") or ""),
                        "rawEvent": event,
                    },
                    event,
                )
            ]

        return self._fallback(event)

    def _consume_codex_command(self, event: JsonObject, payload_type: Any, item: JsonObject) -> list[JsonObject]:
        tool_call_id = str(item.get("id") or self._source_id(event, "codex-command"))
        command = str(item.get("command") or "command")
        if payload_type == "item.started":
            self._open_tools[tool_call_id] = OpenToolCall(tool_call_id, "command_execution")
            self._seen_tools.add(tool_call_id)
            return [
                self._agui({"type": "TOOL_CALL_START", "toolCallId": tool_call_id, "toolCallName": "command_execution", "rawEvent": event}, event),
                self._tool_args(event, tool_call_id, {"command": command}),
            ]
        if payload_type == "item.completed":
            out: list[JsonObject] = []
            if tool_call_id not in self._seen_tools:
                out.append(self._agui({"type": "TOOL_CALL_START", "toolCallId": tool_call_id, "toolCallName": "command_execution", "rawEvent": event}, event))
                out.append(self._tool_args(event, tool_call_id, {"command": command}))
            content = {
                "command": command,
                "exit_code": item.get("exit_code"),
                "status": item.get("status"),
                "output": item.get("aggregated_output", ""),
            }
            out.append(self._tool_result(event, tool_call_id, content))
            if tool_call_id in self._open_tools:
                out.append(self._agui({"type": "TOOL_CALL_END", "toolCallId": tool_call_id, "rawEvent": event}, event))
                self._open_tools.pop(tool_call_id, None)
            return out
        return self._fallback(event)

    def _start_tool_from_payload(self, event: JsonObject, payload: JsonObject) -> list[JsonObject]:
        tool_call_id = str(payload.get("call_id") or self._source_id(event, "tool"))
        tool_name, tool_body = self._tool_name_and_body(payload.get("tool_call"))
        self._open_tools[tool_call_id] = OpenToolCall(tool_call_id, tool_name, self._message_id_from_payload(payload))
        self._seen_tools.add(tool_call_id)
        out = [
            self._agui(
                {
                    "type": "TOOL_CALL_START",
                    "toolCallId": tool_call_id,
                    "toolCallName": tool_name,
                    "parentMessageId": self._message_id_from_payload(payload),
                    "rawEvent": event,
                },
                event,
            )
        ]
        args = tool_body.get("args") if isinstance(tool_body, dict) else None
        if args is not None:
            out.append(self._tool_args(event, tool_call_id, args))
        return out

    def _complete_tool_from_payload(self, event: JsonObject, payload: JsonObject) -> list[JsonObject]:
        tool_call_id = str(payload.get("call_id") or self._source_id(event, "tool"))
        tool_name, tool_body = self._tool_name_and_body(payload.get("tool_call"))
        out: list[JsonObject] = []
        if tool_call_id not in self._seen_tools:
            out.extend(self._start_tool_from_payload(event, payload))
        result = tool_body.get("result") if isinstance(tool_body, dict) else payload.get("tool_call")
        out.append(self._tool_result(event, tool_call_id, result))
        if tool_call_id in self._open_tools:
            out.append(self._agui({"type": "TOOL_CALL_END", "toolCallId": tool_call_id, "rawEvent": event}, event))
            self._open_tools.pop(tool_call_id, None)
        return out

    def _close_open_for_event(self, event: JsonObject) -> list[JsonObject]:
        out: list[JsonObject] = []
        for tool_call_id in sorted(self._open_tools):
            out.append(self._agui({"type": "TOOL_CALL_END", "toolCallId": tool_call_id, "rawEvent": event}, event))
        self._open_tools.clear()
        for message_id in sorted(self._open_reasoning_messages):
            out.append(self._agui({"type": "REASONING_MESSAGE_END", "messageId": message_id, "rawEvent": event}, event))
        self._open_reasoning_messages.clear()
        for message_id in sorted(self._open_reasoning_phases):
            out.append(self._agui({"type": "REASONING_END", "messageId": message_id, "rawEvent": event}, event))
        self._open_reasoning_phases.clear()
        for message_id in sorted(self._open_text_messages):
            out.append(self._agui({"type": "TEXT_MESSAGE_END", "messageId": message_id, "rawEvent": event}, event))
        self._open_text_messages.clear()
        return out

    def _append_text(self, event: JsonObject, message_id: str, text: str, *, role: str) -> list[JsonObject]:
        if not text:
            return []
        out: list[JsonObject] = []
        if message_id not in self._open_text_messages:
            self._open_text_messages.add(message_id)
            out.append(self._agui({"type": "TEXT_MESSAGE_START", "messageId": message_id, "role": role, "rawEvent": event}, event))
        out.append(self._agui({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": text, "rawEvent": event}, event))
        return out

    def _close_text(self, event: JsonObject, message_id: str) -> list[JsonObject]:
        if message_id not in self._open_text_messages:
            return []
        self._open_text_messages.remove(message_id)
        return [self._agui({"type": "TEXT_MESSAGE_END", "messageId": message_id, "rawEvent": event}, event)]

    def _append_reasoning(self, event: JsonObject, message_id: str, text: str) -> list[JsonObject]:
        if not text:
            return []
        out: list[JsonObject] = []
        if message_id not in self._open_reasoning_phases:
            self._open_reasoning_phases.add(message_id)
            out.append(self._agui({"type": "REASONING_START", "messageId": message_id, "rawEvent": event}, event))
        if message_id not in self._open_reasoning_messages:
            self._open_reasoning_messages.add(message_id)
            out.append(self._agui({"type": "REASONING_MESSAGE_START", "messageId": message_id, "role": "reasoning", "rawEvent": event}, event))
        out.append(self._agui({"type": "REASONING_MESSAGE_CONTENT", "messageId": message_id, "delta": text, "rawEvent": event}, event))
        return out

    def _close_reasoning(self, event: JsonObject, message_id: str) -> list[JsonObject]:
        out: list[JsonObject] = []
        if message_id in self._open_reasoning_messages:
            self._open_reasoning_messages.remove(message_id)
            out.append(self._agui({"type": "REASONING_MESSAGE_END", "messageId": message_id, "rawEvent": event}, event))
        if message_id in self._open_reasoning_phases:
            self._open_reasoning_phases.remove(message_id)
            out.append(self._agui({"type": "REASONING_END", "messageId": message_id, "rawEvent": event}, event))
        return out

    def _text_message_triplet(self, event: JsonObject, message_id: str, text: Any, *, role: str) -> list[JsonObject]:
        text_value = str(text or "")
        return [
            self._agui({"type": "TEXT_MESSAGE_START", "messageId": message_id, "role": role, "rawEvent": event}, event),
            self._agui({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": text_value, "rawEvent": event}, event),
            self._agui({"type": "TEXT_MESSAGE_END", "messageId": message_id, "rawEvent": event}, event),
        ]

    def _tool_args(self, event: JsonObject, tool_call_id: str, args: Any) -> JsonObject:
        self._tools_with_args.add(tool_call_id)
        return self._agui(
            {
                "type": "TOOL_CALL_ARGS",
                "toolCallId": tool_call_id,
                "delta": self._string_payload(args),
                "rawEvent": event,
            },
            event,
        )

    def _tool_result(self, event: JsonObject, tool_call_id: str, content: Any) -> JsonObject:
        return self._agui(
            {
                "type": "TOOL_CALL_RESULT",
                "messageId": f"{tool_call_id}:result",
                "toolCallId": tool_call_id,
                "content": self._string_payload(content),
                "role": "tool",
                "rawEvent": event,
            },
            event,
        )

    def _custom(self, event: JsonObject, name: str, value: Any) -> JsonObject:
        return self._agui(
            {
                "type": "CUSTOM",
                "name": name,
                "value": value,
                "rawEvent": event,
            },
            event,
        )

    def _fallback(self, event: JsonObject) -> list[JsonObject]:
        self._fallback_events.append(deepcopy(event))
        return [
            self._agui(
                {
                    "type": "RAW",
                    "event": event,
                    "source": str(event.get("harness") or event.get("event_kind") or "quest-log"),
                    "rawEvent": event,
                },
                event,
            )
        ]

    def _agui(self, fields: JsonObject, source_event: JsonObject | None = None) -> JsonObject:
        event = {key: value for key, value in fields.items() if value is not None}
        if "timestamp" not in event:
            timestamp = self._timestamp(source_event or {})
            if timestamp is not None:
                event["timestamp"] = timestamp
        return event

    def _timestamp(self, event: JsonObject) -> int | None:
        payload = event.get("payload")
        if isinstance(payload, dict) and isinstance(payload.get("timestamp_ms"), int | float):
            return int(payload["timestamp_ms"])
        timestamp = event.get("timestamp")
        if not isinstance(timestamp, str):
            return None
        try:
            parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except ValueError:
            return None
        return int(parsed.timestamp() * 1000)

    def _run_id(self, event: JsonObject) -> str:
        thread = event.get("thread") or event.get("provider_thread_id") or "quest-runner"
        return f"{thread}:step:{event.get('step', 'unknown')}"

    def _source_id(self, event: JsonObject, suffix: str) -> str:
        thread = event.get("thread") or event.get("provider_thread_id") or "quest-runner"
        step = event.get("step", "unknown")
        sequence = event.get("sequence", "unknown")
        return f"{thread}:step:{step}:seq:{sequence}:{suffix}"

    def _message_id_from_payload(self, payload: JsonObject) -> str | None:
        value = payload.get("model_call_id") or payload.get("session_id")
        return str(value) if value is not None else None

    def _agui_text_role(self, role: Any) -> str:
        role_value = str(role or "assistant")
        if role_value in {"developer", "system", "assistant", "user"}:
            return role_value
        return "assistant"

    def _content_text(self, content: Any) -> str:
        if isinstance(content, str):
            return content
        if not isinstance(content, list):
            return ""
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                if isinstance(item.get("text"), str):
                    parts.append(item["text"])
                elif isinstance(item.get("content"), str):
                    parts.append(item["content"])
                elif isinstance(item.get("thinking"), str):
                    parts.append(item["thinking"])
            elif isinstance(item, str):
                parts.append(item)
        return "".join(parts)

    def _tool_name_and_body(self, tool_call: Any) -> tuple[str, JsonObject]:
        if not isinstance(tool_call, dict) or not tool_call:
            return "tool", {}
        name = next(iter(tool_call))
        body = tool_call.get(name)
        return str(name), body if isinstance(body, dict) else {}

    def _string_payload(self, value: Any) -> str:
        if isinstance(value, str):
            return value
        return json.dumps(value, sort_keys=True, ensure_ascii=False)

    def _without_raw_event_fields(self, event: JsonObject) -> JsonObject:
        return {
            key: value
            for key, value in event.items()
            if key not in {"rawEvent"}
        }

    def _block_index(self, stream_event: JsonObject) -> int:
        value = stream_event.get("index")
        return int(value) if isinstance(value, int | float) else -1


def iter_quest_log_paths(repo_root: Path) -> list[Path]:
    paths: dict[Path, Path] = {}
    for base in (repo_root / "quests", repo_root / "projects"):
        if not base.is_dir():
            continue
        for path in base.glob("**/logs/*.jsonl"):
            paths[path.resolve()] = path
    return sorted(paths.values(), key=lambda path: path.relative_to(repo_root).as_posix())


def iter_jsonl_events(path: Path) -> list[JsonObject]:
    events: list[JsonObject] = []
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_number}: expected a JSON object")
            events.append(value)
    return events
