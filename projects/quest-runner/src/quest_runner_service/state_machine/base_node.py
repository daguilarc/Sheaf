"""Default node behavior shared by concrete node types."""

from __future__ import annotations

from typing import TYPE_CHECKING, Mapping

from ..quest_types import RecursiveSnapshot
from .context import RunContext

if TYPE_CHECKING:
    from .protocols import StateMachine as StateMachineProto


class BaseNode:
    def NodeName(self) -> str:
        return self.__class__.__name__

    def Execute(self, ctx: RunContext, machine: StateMachineProto) -> None:
        raise NotImplementedError

    def NextState(self, ctx: RunContext, machine: StateMachineProto) -> str:
        raise NotImplementedError

    def NodeTags(self, ctx: RunContext, machine: StateMachineProto) -> Mapping[str, str]:
        return {}

    def PopChildRecursiveSnapshot(self) -> RecursiveSnapshot | None:
        return None
