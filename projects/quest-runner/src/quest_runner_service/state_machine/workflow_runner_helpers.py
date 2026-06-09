"""Shared workflow runner loading and pre-step checks."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ..quest_types import QuestMeta, StateMachineId
from ..workflow_config import WorkflowDefinition
from ..workflow_profile_execution import resolve_quest_workflow
from .workflow_interpreter import WorkflowMachineLoader, WorkflowStateMachine
from .workflow_state_io import WorkflowStateIo

_RESERVED_COMPLETED = frozenset({"ExperimentComplete"})


@dataclass(frozen=True)
class WorkflowRunnerBundle:
    workflow: WorkflowDefinition
    workflow_io: WorkflowStateIo
    loader: WorkflowMachineLoader
    top: WorkflowStateMachine
    sm_id: StateMachineId


def build_workflow_runner_bundle(
    repo_path: Path,
    quest_dir: Path,
    meta: QuestMeta,
) -> WorkflowRunnerBundle:
    workflow = resolve_quest_workflow(quest_dir)
    workflow_io = WorkflowStateIo(repo_path, quest_dir, meta, workflow)
    loader = WorkflowMachineLoader(
        repo_path, quest_dir, meta, workflow, workflow_io
    )
    top = loader.LoadTopStateMachine(quest_dir)
    rel = quest_dir.resolve().relative_to(repo_path.resolve()).as_posix()
    entry_machine = workflow.get_machine(workflow.entry_machine)
    sm_id = StateMachineId(
        root_machine_id=rel,
        machine_path=rel,
        machine_name=entry_machine.machine,
    )
    return WorkflowRunnerBundle(
        workflow=workflow,
        workflow_io=workflow_io,
        loader=loader,
        top=top,
        sm_id=sm_id,
    )


def has_workflow_human_intervention(
    quest_dir: Path, workflow: WorkflowDefinition
) -> bool:
    return (quest_dir / workflow.special.human_intervention_file).is_file()


def is_top_level_workflow_complete(
    workflow: WorkflowDefinition,
    workflow_io: WorkflowStateIo,
    quest_dir: Path,
) -> bool:
    sm = workflow_io.ReadStateMachineState(quest_dir)
    if sm.state in _RESERVED_COMPLETED:
        return True
    machine = workflow.get_machine(workflow.entry_machine)
    if sm.state in machine.terminal:
        return True
    state_def = machine.states.get(sm.state)
    return state_def is not None and state_def.terminal
