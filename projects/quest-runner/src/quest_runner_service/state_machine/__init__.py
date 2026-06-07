"""Generic recursive filesystem state machine core (quest migration foundations)."""

from __future__ import annotations

from .adapters import (
    FileStateIo,
    QuestRootRoleProfileResolver,
    RegistryStateMachineLoader,
    SubprocessGitOps,
    find_quest_root_for_machine_dir,
)
from .base_node import BaseNode
from .commit_metadata import (
    CommitMetadataValidationError,
    ParsedCommitMessage,
    parse_step_commit_message,
    render_step_commit_message,
    validate_parsed_step_commit,
)
from .context import RunContext
from .machine import ConcreteStateMachine
from .protocols import (
    GitOps,
    HarnessOps,
    Node,
    NodeFactory,
    RoleProfileResolver,
    StateIo,
    StateMachine,
    StateMachineDefinition,
    StateMachineLoader,
    StepExecutor,
    ThreadRegistryOps,
)

__all__ = [
    "BaseNode",
    "CommitMetadataValidationError",
    "ConcreteStateMachine",
    "FileStateIo",
    "GitOps",
    "HarnessOps",
    "Node",
    "NodeFactory",
    "ParsedCommitMessage",
    "QuestRootRoleProfileResolver",
    "RegistryStateMachineLoader",
    "RoleProfileResolver",
    "RunContext",
    "StateIo",
    "StateMachine",
    "StateMachineDefinition",
    "StateMachineLoader",
    "StepExecutor",
    "SubprocessGitOps",
    "ThreadRegistryOps",
    "find_quest_root_for_machine_dir",
    "parse_step_commit_message",
    "render_step_commit_message",
    "validate_parsed_step_commit",
]
