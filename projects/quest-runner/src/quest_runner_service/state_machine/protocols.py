"""Protocol definitions for the generic state machine runtime."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, Mapping, Protocol, Sequence

from ..quest_types import RecursiveSnapshot, RoleProfile, StateMachineId, StateMachineState

NodeFactory = Callable[[], "Node"]


@dataclass
class StateMachineDefinition:
    machine_name: str
    node_map: Dict[str, NodeFactory]
    terminal_states: Sequence[str]


class GitOps(Protocol):
    def IsClean(self, repo_root: Path) -> bool:
        ...

    def GetHeadSha(self, repo_root: Path) -> str:
        ...

    def StageAll(self, repo_root: Path) -> None:
        ...

    def HasStagedChanges(self, repo_root: Path) -> bool:
        ...

    def Commit(self, repo_root: Path, message: str) -> str:
        ...

    def ReadGlobalStep(self, repo_root: Path, state_machine_id: StateMachineId) -> int:
        ...


class ThreadRegistryOps(Protocol):
    def ResolveOrCreateThread(
        self, machine_root_dir: Path, role: str, thread_name: str
    ) -> str:
        ...


class HarnessOps(Protocol):
    def SendThreadMessage(
        self,
        *,
        role: str,
        harness: str,
        model: str,
        thread_id: str,
        prompt: str,
        idle_timeout_seconds: int,
    ) -> str:
        ...


class RoleProfileResolver(Protocol):
    def ResolveRoleProfile(self, state_machine_dir: Path, role: str) -> RoleProfile:
        ...


class StateIo(Protocol):
    def ReadStateMachineState(self, state_machine_dir: Path) -> StateMachineState:
        ...

    def WriteStateMachineState(
        self, state_machine_dir: Path, state: StateMachineState
    ) -> None:
        ...


class Node(Protocol):
    def NodeName(self) -> str:
        ...

    def Execute(self, ctx: RunContext, machine: StateMachine) -> None:
        ...

    def NextState(self, ctx: RunContext, machine: StateMachine) -> str:
        ...

    def NodeTags(self, ctx: RunContext, machine: StateMachine) -> Mapping[str, str]:
        ...

    def PopChildRecursiveSnapshot(self) -> RecursiveSnapshot | None:
        ...


class StateMachine(Protocol):
    def StateMachineDir(self) -> Path:
        ...

    def Definition(self) -> StateMachineDefinition:
        ...

    def ReadState(self) -> StateMachineState:
        ...

    def WriteState(self, new_state: str, tags: Mapping[str, str]) -> None:
        ...

    def RunOneStep(self, ctx: RunContext) -> RecursiveSnapshot:
        ...


class StateMachineLoader(Protocol):
    def LoadStateMachine(self, state_machine_dir: Path) -> StateMachine:
        ...

    def LoadTopStateMachine(self, machine_root_dir: Path) -> StateMachine:
        ...


class StepExecutor(Protocol):
    def ExecuteSingleTopLevelStep(self, ctx: RunContext) -> str:
        ...
