"""Tests for recursive step commit metadata rendering and parsing."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from quest_runner_service.state_machine.commit_metadata import (
    CommitMetadataValidationError,
    parse_step_commit_message,
    render_step_commit_message,
    validate_parsed_step_commit,
)
from quest_runner_service.quest_types import RecursiveSnapshot, StepCommitMetadata


def _sample_snapshot() -> RecursiveSnapshot:
    return RecursiveSnapshot(
        machine_path="quests/main/0002_state_machine_abstraction",
        machine_name="quest",
        node_name="PhysicalPlanningNode",
        state_before="PhysicalPlanning",
        state_after="ReviewPhysicalPlan",
        tags={
            "quest_slug": "state_machine_abstraction",
            "quest_type": "main",
            "quest_number": "2",
        },
        child=None,
    )


class CommitMetadataGoldenTests(unittest.TestCase):
    def test_render_parse_validate_round_trip(self) -> None:
        snap = _sample_snapshot()
        meta = StepCommitMetadata(global_step=1, snapshot=snap)
        msg = render_step_commit_message(meta)
        self.assertIn("recursive-snapshot-json:\n", msg)
        self.assertIn("\n", msg.split("recursive-snapshot-json:\n", 1)[1].strip())
        parsed = parse_step_commit_message(msg)
        self.assertIsNotNone(parsed)
        assert parsed is not None
        validate_parsed_step_commit(parsed)

    def test_compact_json_rejected(self) -> None:
        bad = (
            "quest-step: 1\n"
            "state-machine-path: quests/main/x\n"
            "node: N\n"
            "state-before: A\n"
            "state-after: B\n"
            "\n"
            "recursive-snapshot-json:\n"
            '{"global_step": 1, "snapshot": {}}\n'
        )
        self.assertIsNone(parse_step_commit_message(bad))

    def test_header_json_mismatch_raises_on_validate(self) -> None:
        snap = _sample_snapshot()
        meta = StepCommitMetadata(global_step=2, snapshot=snap)
        msg = render_step_commit_message(meta)
        lines = msg.splitlines()
        out_lines: list[str] = []
        for ln in lines:
            if ln.startswith("quest-step:"):
                out_lines.append("quest-step: 99")
            else:
                out_lines.append(ln)
        tampered = "\n".join(out_lines) + "\n"
        parsed = parse_step_commit_message(tampered)
        self.assertIsNotNone(parsed)
        assert parsed is not None
        with self.assertRaises(CommitMetadataValidationError):
            validate_parsed_step_commit(parsed)

    def test_validate_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel = Path("quests/main/0002_x")
            machine = root / rel
            machine.mkdir(parents=True)
            snap = RecursiveSnapshot(
                machine_path=str(rel).replace("\\", "/"),
                machine_name="quest",
                node_name="N",
                state_before="A",
                state_after="B",
                tags={},
                child=None,
            )
            meta = StepCommitMetadata(global_step=1, snapshot=snap)
            msg = render_step_commit_message(meta)
            parsed = parse_step_commit_message(msg)
            self.assertIsNotNone(parsed)
            assert parsed is not None
            validate_parsed_step_commit(parsed, repo_root=root)
            bad_snap = RecursiveSnapshot(
                machine_path="quests/missing/path",
                machine_name="quest",
                node_name="N",
                state_before="A",
                state_after="B",
                tags={},
                child=None,
            )
            bad_meta = StepCommitMetadata(global_step=1, snapshot=bad_snap)
            bad_msg = render_step_commit_message(bad_meta)
            bad_parsed = parse_step_commit_message(bad_msg)
            self.assertIsNotNone(bad_parsed)
            assert bad_parsed is not None
            with self.assertRaises(CommitMetadataValidationError):
                validate_parsed_step_commit(bad_parsed, repo_root=root)
