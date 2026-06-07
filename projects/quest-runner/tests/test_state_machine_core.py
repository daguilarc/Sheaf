"""Tests for generic state machine execution primitives."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from quest_runner_service import quest_fs
from quest_runner_service.quest_types import StateMachineId, StateMachineState
from quest_runner_service.state_machine import (
    BaseNode,
    ConcreteStateMachine,
    FileStateIo,
    RunContext,
    StateMachineDefinition,
)


class FlipNode(BaseNode):
    def Execute(self, ctx: RunContext, machine: object) -> None:
        return None

    def NextState(self, ctx: RunContext, machine: object) -> str:
        return "B"

    def NodeTags(self, ctx: RunContext, machine: object) -> dict[str, str]:
        return {"k": "v"}


class ConcreteStateMachineRunOneStepTests(unittest.TestCase):
    def test_run_one_step_transitions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            machine_dir = Path(tmp) / "m"
            machine_dir.mkdir()
            top = machine_dir.resolve()
            st = StateMachineState(
                machine_name="test",
                machine_path="m",
                state="A",
                global_step=1,
                tags={},
                updated_at="2026-04-01T00:00:00Z",
            )
            quest_fs.write_normalized_machine_state(machine_dir, st)
            definition = StateMachineDefinition(
                machine_name="test",
                node_map={"A": FlipNode},
                terminal_states=("B",),
            )
            io = FileStateIo(top_level_machine_dir=top)
            sm = ConcreteStateMachine(machine_dir, definition, io)
            ctx = RunContext(
                repo_root=Path(tmp),
                machine_root_dir=top,
                state_machine_id=StateMachineId(
                    root_machine_id="r",
                    machine_path="m",
                    machine_name="test",
                ),
                git_ops=MagicMock(),
                thread_registry_ops=MagicMock(),
                harness_ops=MagicMock(),
                role_profile_resolver=MagicMock(),
                state_io=io,
                state_machine_loader=MagicMock(),
            )
            snap = sm.RunOneStep(ctx)
            self.assertEqual(snap.state_before, "A")
            self.assertEqual(snap.state_after, "B")
            self.assertEqual(snap.node_name, "FlipNode")
            after = sm.ReadState()
            self.assertEqual(after.state, "B")
            self.assertEqual(after.tags, {"k": "v"})
