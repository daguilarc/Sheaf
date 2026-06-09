"""Run context passed into node and machine execution."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ..chat_event_bus import ChatEventBus
from ..quest_types import StateMachineId
from .protocols import (
    GitOps,
    HarnessOps,
    RoleProfileResolver,
    StateIo,
    StateMachineLoader,
    ThreadRegistryOps,
)


@dataclass
class RunContext:
    repo_root: Path
    machine_root_dir: Path
    state_machine_id: StateMachineId
    git_ops: GitOps
    thread_registry_ops: ThreadRegistryOps
    harness_ops: HarnessOps
    role_profile_resolver: RoleProfileResolver
    state_io: StateIo
    state_machine_loader: StateMachineLoader
    harness_steps_acc: list[int] | None = None
    conductor_repo_path: Path | None = None
    quest_docs_dir: Path | None = None
    documenter_base_ref_box: list[str | None] | None = None
    role_step_seq_box: list[int] | None = None
    captured_outputs_list: list | None = None
    event_bus: ChatEventBus | None = None
    experiment_id: str | None = None
