"""Tests for normalized machine ``state.md`` I/O."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from quest_runner_service.quest_fs import (
    QuestStateParseError,
    format_normalized_state_md,
    parse_normalized_state_md_text,
    read_normalized_machine_state,
    write_normalized_machine_state,
)
from quest_runner_service.quest_types import StateMachineState


class NormalizedStateMdRoundTripTests(unittest.TestCase):
    def test_round_trip_stable_shape(self) -> None:
        original = StateMachineState(
            machine_name="quest",
            machine_path="quests/main/0002_state_machine_abstraction",
            state="ExecuteSlice",
            global_step=7,
            tags={"active_slice": "0000_bootstrap", "quest_type": "main"},
            updated_at="2026-04-01T12:00:00Z",
        )
        text = format_normalized_state_md(original)
        parsed = parse_normalized_state_md_text(
            text,
            require_global_step=True,
            label="inline",
        )
        self.assertEqual(parsed.machine_name, original.machine_name)
        self.assertEqual(parsed.machine_path, original.machine_path)
        self.assertEqual(parsed.state, original.state)
        self.assertEqual(parsed.global_step, original.global_step)
        self.assertEqual(parsed.tags, original.tags)
        self.assertEqual(parsed.updated_at, original.updated_at)
        text2 = format_normalized_state_md(parsed)
        self.assertEqual(text2, text)

    def test_write_read_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "machine"
            d.mkdir()
            s = StateMachineState(
                machine_name="slice",
                machine_path="quests/main/0001_x/slices/0000_a",
                state="Implementing",
                global_step=None,
                tags={},
                updated_at="2026-04-01T00:00:00Z",
            )
            write_normalized_machine_state(d, s)
            loaded = read_normalized_machine_state(d, require_global_step=False)
            self.assertEqual(loaded.global_step, None)
            self.assertEqual(loaded.state, "Implementing")

    def test_top_level_requires_global_step(self) -> None:
        body = (
            "# State\n\n"
            "- machine_name: quest\n"
            "- machine_path: quests/main/x\n"
            "- state: A\n"
            "- updated_at: 2026-04-01T00:00:00Z\n\n"
            "## Tags\n\n"
        )
        with self.assertRaises(QuestStateParseError):
            parse_normalized_state_md_text(
                body,
                require_global_step=True,
                label="t",
            )

    def test_unknown_key_rejected(self) -> None:
        body = (
            "# State\n\n"
            "- machine_name: quest\n"
            "- machine_path: quests/main/x\n"
            "- state: A\n"
            "- updated_at: 2026-04-01T00:00:00Z\n"
            "- extra_field: no\n\n"
            "## Tags\n\n"
        )
        with self.assertRaises(QuestStateParseError):
            parse_normalized_state_md_text(
                body,
                require_global_step=False,
                label="t",
            )

    def test_wrong_heading_rejected(self) -> None:
        body = "# Quest State\n\n- state: A\n"
        with self.assertRaises(QuestStateParseError):
            parse_normalized_state_md_text(
                body,
                require_global_step=False,
                label="t",
            )

    def test_missing_tags_section_rejected(self) -> None:
        body = (
            "# State\n\n"
            "- global_step: 1\n"
            "- machine_name: quest\n"
            "- machine_path: quests/main/x\n"
            "- state: A\n"
            "- updated_at: 2026-04-01T00:00:00Z\n"
        )
        with self.assertRaises(QuestStateParseError):
            parse_normalized_state_md_text(
                body,
                require_global_step=True,
                label="t",
            )
