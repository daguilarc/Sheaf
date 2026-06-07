"""Tests for mapping quest runner JSONL logs into AGUI events."""

from __future__ import annotations

import json
import unittest
from collections import Counter
from pathlib import Path
from typing import Any

from quest_runner_service.agui_mapper import (  # type: ignore[import-not-found]
    QuestLogToAguiMapper,
    iter_jsonl_events,
    iter_quest_log_paths,
)


class SchemaValidationError(AssertionError):
    pass


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _load_agui_schema() -> dict[str, Any]:
    path = _repo_root() / "structure" / "schemas" / "ag_ui_events.schema.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _resolve_schema(schema: dict[str, Any], root: dict[str, Any]) -> dict[str, Any]:
    ref = schema.get("$ref")
    if not isinstance(ref, str):
        return schema
    prefix = "#/$defs/"
    if not ref.startswith(prefix):
        raise SchemaValidationError(f"unsupported ref {ref}")
    return root["$defs"][ref[len(prefix) :]]


def _type_matches(expected: str | list[str], value: Any) -> bool:
    expected_types = expected if isinstance(expected, list) else [expected]
    for expected_type in expected_types:
        if expected_type == "object" and isinstance(value, dict):
            return True
        if expected_type == "array" and isinstance(value, list):
            return True
        if expected_type == "string" and isinstance(value, str):
            return True
        if expected_type == "number" and isinstance(value, int | float) and not isinstance(value, bool):
            return True
        if expected_type == "integer" and isinstance(value, int) and not isinstance(value, bool):
            return True
        if expected_type == "boolean" and isinstance(value, bool):
            return True
        if expected_type == "null" and value is None:
            return True
    return False


def _validate_against_schema(value: Any, schema: dict[str, Any], root: dict[str, Any]) -> None:
    schema = _resolve_schema(schema, root)
    if not schema:
        return

    if "const" in schema and value != schema["const"]:
        raise SchemaValidationError(f"expected const {schema['const']!r}, got {value!r}")
    if "enum" in schema and value not in schema["enum"]:
        raise SchemaValidationError(f"expected one of {schema['enum']!r}, got {value!r}")
    if "type" in schema and not _type_matches(schema["type"], value):
        raise SchemaValidationError(f"expected type {schema['type']!r}, got {type(value).__name__}")

    if "anyOf" in schema:
        errors: list[Exception] = []
        for option in schema["anyOf"]:
            try:
                _validate_against_schema(value, option, root)
                return
            except SchemaValidationError as exc:
                errors.append(exc)
        raise SchemaValidationError(f"value did not match anyOf: {errors}")

    if "oneOf" in schema:
        matches = 0
        last_error: Exception | None = None
        for option in schema["oneOf"]:
            try:
                _validate_against_schema(value, option, root)
                matches += 1
            except SchemaValidationError as exc:
                last_error = exc
        if matches != 1:
            raise SchemaValidationError(f"value matched {matches} oneOf branches; last error: {last_error}")

    if isinstance(value, dict):
        for required_key in schema.get("required", []):
            if required_key not in value:
                raise SchemaValidationError(f"missing required key {required_key!r}")
        properties = schema.get("properties", {})
        for key, property_schema in properties.items():
            if key in value:
                _validate_against_schema(value[key], property_schema, root)

    if isinstance(value, list) and "items" in schema:
        for item in value:
            _validate_against_schema(item, schema["items"], root)


def _branch_by_type(schema: dict[str, Any]) -> dict[str, dict[str, Any]]:
    branches: dict[str, dict[str, Any]] = {}
    for branch_ref in schema["oneOf"]:
        branch = _resolve_schema(branch_ref, schema)
        event_type = branch["properties"]["type"]["const"]
        branches[event_type] = branch
    return branches


class AguiStreamVerifier:
    def __init__(self) -> None:
        self.open_text: set[str] = set()
        self.open_reasoning_messages: set[str] = set()
        self.open_reasoning_phases: set[str] = set()
        self.open_tools: set[str] = set()
        self.seen_tools: set[str] = set()

    def consume(self, event: dict[str, Any]) -> None:
        event_type = event["type"]
        if event_type == "TEXT_MESSAGE_START":
            message_id = event["messageId"]
            if message_id in self.open_text:
                raise AssertionError(f"text message already open: {message_id}")
            self.open_text.add(message_id)
        elif event_type == "TEXT_MESSAGE_CONTENT":
            if event["messageId"] not in self.open_text:
                raise AssertionError(f"text content without start: {event['messageId']}")
        elif event_type == "TEXT_MESSAGE_END":
            message_id = event["messageId"]
            if message_id not in self.open_text:
                raise AssertionError(f"text end without start: {message_id}")
            self.open_text.remove(message_id)
        elif event_type == "REASONING_START":
            self.open_reasoning_phases.add(event["messageId"])
        elif event_type == "REASONING_MESSAGE_START":
            message_id = event["messageId"]
            if message_id in self.open_reasoning_messages:
                raise AssertionError(f"reasoning message already open: {message_id}")
            self.open_reasoning_messages.add(message_id)
        elif event_type == "REASONING_MESSAGE_CONTENT":
            if event["messageId"] not in self.open_reasoning_messages:
                raise AssertionError(f"reasoning content without start: {event['messageId']}")
        elif event_type == "REASONING_MESSAGE_END":
            message_id = event["messageId"]
            if message_id not in self.open_reasoning_messages:
                raise AssertionError(f"reasoning end without start: {message_id}")
            self.open_reasoning_messages.remove(message_id)
        elif event_type == "REASONING_END":
            message_id = event["messageId"]
            if message_id not in self.open_reasoning_phases:
                raise AssertionError(f"reasoning phase end without start: {message_id}")
            self.open_reasoning_phases.remove(message_id)
        elif event_type == "TOOL_CALL_START":
            tool_call_id = event["toolCallId"]
            if tool_call_id in self.open_tools:
                raise AssertionError(f"tool call already open: {tool_call_id}")
            self.open_tools.add(tool_call_id)
            self.seen_tools.add(tool_call_id)
        elif event_type == "TOOL_CALL_ARGS":
            if event["toolCallId"] not in self.open_tools:
                raise AssertionError(f"tool args without start: {event['toolCallId']}")
        elif event_type == "TOOL_CALL_RESULT":
            if event["toolCallId"] not in self.seen_tools:
                raise AssertionError(f"tool result without known tool: {event['toolCallId']}")
        elif event_type == "TOOL_CALL_END":
            tool_call_id = event["toolCallId"]
            if tool_call_id not in self.open_tools:
                raise AssertionError(f"tool end without start: {tool_call_id}")
            self.open_tools.remove(tool_call_id)

    def assert_balanced(self) -> None:
        if self.open_text:
            raise AssertionError(f"open text messages remain: {sorted(self.open_text)[:5]}")
        if self.open_reasoning_messages:
            raise AssertionError(f"open reasoning messages remain: {sorted(self.open_reasoning_messages)[:5]}")
        if self.open_reasoning_phases:
            raise AssertionError(f"open reasoning phases remain: {sorted(self.open_reasoning_phases)[:5]}")
        if self.open_tools:
            raise AssertionError(f"open tool calls remain: {sorted(self.open_tools)[:5]}")


class QuestLogToAguiMapperTests(unittest.TestCase):
    def test_replays_current_quest_logs_as_valid_agui_events(self) -> None:
        repo_root = _repo_root()
        log_paths = iter_quest_log_paths(repo_root)
        self.assertGreaterEqual(len(log_paths), 55)

        schema = _load_agui_schema()
        branches = _branch_by_type(schema)
        mapper = QuestLogToAguiMapper()
        verifier = AguiStreamVerifier()
        source_count = 0
        agui_count = 0

        for path in log_paths:
            for source_event in iter_jsonl_events(path):
                source_count += 1
                for agui_event in mapper.consume(source_event):
                    branch = branches.get(agui_event.get("type"))
                    self.assertIsNotNone(branch, agui_event)
                    _validate_against_schema(agui_event, branch or {}, schema)
                    verifier.consume(agui_event)
                    agui_count += 1

        for agui_event in mapper.flush():
            branch = branches.get(agui_event.get("type"))
            self.assertIsNotNone(branch, agui_event)
            _validate_against_schema(agui_event, branch or {}, schema)
            verifier.consume(agui_event)
            agui_count += 1

        verifier.assert_balanced()
        self.assertGreaterEqual(source_count, 43966)
        self.assertGreater(agui_count, source_count)
        fallback_events = mapper.errors()
        fallback_counts = Counter(
            (
                event.get("harness"),
                event.get("event_kind"),
                event.get("payload", {}).get("type") if isinstance(event.get("payload"), dict) else None,
                event.get("payload", {}).get("subtype") if isinstance(event.get("payload"), dict) else None,
            )
            for event in fallback_events
        )
        self.assertEqual(
            fallback_events,
            [],
            f"Unhandled quest log event variants reached AGUI RAW fallback: {fallback_counts.most_common(10)}",
        )


if __name__ == "__main__":
    unittest.main()
