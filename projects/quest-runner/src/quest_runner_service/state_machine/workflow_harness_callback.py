"""Workflow profile harness execution via interpreter run callbacks."""

from __future__ import annotations

from pathlib import Path

from .. import quest_fs
from ..harness import create_harness
from ..harness_config import read_service_harness_configs
from ..quest_runner import git_rev_parse_head, perform_role_harness_sequence
from ..quest_thread import create_thread_with_provider_name, load_thread
from ..workflow_config import WorkflowDefinition
from ..workflow_profile_execution import (
    build_profile_execution_context,
    render_thread_name,
    render_thread_registry_key,
    workflow_profile_to_execution_profile,
)
from .context import RunContext
from .workflow_interpreter import RunProfileCallback, WorkflowStateMachine


class HumanInterventionRequested(RuntimeError):
    """A harness run produced a human-intervention request."""


def build_workflow_run_callback(
    ctx: RunContext,
    machine: WorkflowStateMachine,
    workflow: WorkflowDefinition,
) -> RunProfileCallback:
    def callback(profile_name: str, task_text: str) -> None:
        _invoke_workflow_profile_harness(
            ctx=ctx,
            machine=machine,
            workflow=workflow,
            profile_name=profile_name,
            task_text=task_text,
        )

    return callback


def _invoke_workflow_profile_harness(
    *,
    ctx: RunContext,
    machine: WorkflowStateMachine,
    workflow: WorkflowDefinition,
    profile_name: str,
    task_text: str,
) -> None:
    assert ctx.captured_outputs_list is not None
    assert ctx.role_step_seq_box is not None
    assert ctx.quest_docs_dir is not None
    if ctx.harness_steps_acc is not None:
        ctx.harness_steps_acc[0] += 1
    quest_dir = ctx.machine_root_dir
    machine_dir = machine.StateMachineDir()
    slice_dir: Path | None = None
    collection_name: str | None = None
    if machine_dir.resolve() != quest_dir.resolve():
        slice_dir = machine_dir
        collection = ctx.state_io._collection_for_dir(machine_dir)
        collection_name = collection.name if collection is not None else None
    else:
        active_child = ctx.state_io.active_child()
        if active_child is not None:
            slice_dir = active_child.child_dir
            collection_name = active_child.collection.name
    meta = quest_fs.read_quest_meta(quest_dir)
    profile = workflow.get_profile(profile_name)
    exec_profile = workflow_profile_to_execution_profile(profile)
    harness_configs = read_service_harness_configs(ctx.repo_root)
    harness = create_harness(
        exec_profile.harness, harness_configs.get(exec_profile.harness.value)
    )
    exec_ctx = build_profile_execution_context(
        repo_path=ctx.repo_root,
        quest_dir=quest_dir,
        machine_dir=machine_dir,
        meta=meta,
        workflow=workflow,
        profile=profile,
        profile_name=profile_name,
        quest_docs_dir=ctx.quest_docs_dir,
        active_child_dir=slice_dir,
        collection_name=collection_name,
        experiment_id=ctx.experiment_id,
    )
    quest_rel = quest_dir.resolve().relative_to(ctx.repo_root.resolve()).as_posix()
    active_child_rel: str | None = None
    if slice_dir is not None:
        active_child_rel = (
            slice_dir.resolve().relative_to(ctx.repo_root.resolve()).as_posix()
        )
    step_base = git_rev_parse_head(ctx.repo_root)
    thread_key = render_thread_registry_key(exec_ctx)
    thread_box: list = [
        load_thread(quest_dir, ctx.repo_root, profile_name, registry_key=thread_key)
    ]

    def _create() -> object:
        thread_name = render_thread_name(exec_ctx)
        return create_thread_with_provider_name(
            quest_dir,
            ctx.repo_root,
            profile_name,
            harness,
            thread_name,
            exec_profile.model,
            exec_profile.reasoning_effort,
            exec_profile.idle_timeout_seconds,
            registry_key=thread_key,
        )

    perform_role_harness_sequence(
        repo_path=ctx.repo_root,
        quest_dir=quest_dir,
        meta=meta,
        quest_docs_dir=ctx.quest_docs_dir,
        machine_dir=machine_dir,
        workflow=workflow,
        profile=profile,
        profile_name=profile_name,
        task_text=task_text,
        harness=harness,
        thread_key=thread_key,
        quest_rel=quest_rel,
        active_child_rel=active_child_rel,
        step_base_commit=step_base,
        thread_box=thread_box,
        role_step_seq=ctx.role_step_seq_box,
        captured_outputs=ctx.captured_outputs_list,
        create_thread_if_missing=_create,
        event_bus=ctx.event_bus,
        experiment_id=ctx.experiment_id,
        active_child_dir=slice_dir,
        collection_name=collection_name,
    )
    if (quest_dir / workflow.special.human_intervention_file).is_file():
        raise HumanInterventionRequested(
            f"Quest has an open {workflow.special.human_intervention_file}; "
            "stopping before workflow state advances."
        )
