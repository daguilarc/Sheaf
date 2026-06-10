"""Concrete state machine implementation."""

from __future__ import annotations

from pathlib import Path
from typing import Mapping

from ..errors import FatalInvariantError
from ..quest_types import RecursiveSnapshot, StateMachineState, utc_now_iso
from .context import RunContext
from .protocols import Node, StateMachineDefinition, StateIo


class ConcreteStateMachine:
    def __init__(
        self,
        machine_dir: Path,
        definition: StateMachineDefinition,
        state_io: StateIo,
    ) -> None:
        self._machine_dir = machine_dir
        self._definition = definition
        self._state_io = state_io

    def StateMachineDir(self) -> Path:
        return self._machine_dir

    def Definition(self) -> StateMachineDefinition:
        return self._definition

    def ReadState(self) -> StateMachineState:
        return self._state_io.ReadStateMachineState(self._machine_dir)

    def WriteState(self, new_state: str, tags: Mapping[str, str]) -> None:
        prev = self.ReadState()
        nxt = StateMachineState(
            machine_name=prev.machine_name,
            machine_path=prev.machine_path,
            state=new_state,
            global_step=prev.global_step,
            tags=dict(tags),
            updated_at=utc_now_iso(),
        )
        self._state_io.WriteStateMachineState(self._machine_dir, nxt)

    def RunOneStep(self, ctx: RunContext) -> RecursiveSnapshot:
        before = self.ReadState()
        factory = self._definition.node_map.get(before.state)
        if factory is None:
            raise FatalInvariantError(
                f"No node registered for state {before.state!r} "
                f"in machine {self._definition.machine_name!r}"
            )
        node: Node = factory()
        node.Execute(ctx, self)
        after_state = node.NextState(ctx, self)
        tag_map = dict(before.tags)
        tag_map.update(dict(node.NodeTags(ctx, self)))
        if after_state != before.state or tag_map != dict(before.tags):
            self.WriteState(after_state, tag_map)
        child = node.PopChildRecursiveSnapshot()
        return RecursiveSnapshot(
            machine_path=before.machine_path,
            machine_name=before.machine_name,
            node_name=node.NodeName(),
            state_before=before.state,
            state_after=after_state,
            tags=tag_map,
            child=child,
        )
