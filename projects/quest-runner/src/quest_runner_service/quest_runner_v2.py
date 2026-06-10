"""Canonical recursive state-machine quest runner (``run_quest`` delegates here)."""

from __future__ import annotations

from pathlib import Path

from . import quest_fs
from .chat_event_bus import ChatEventBus
from .harness import HarnessMessageError
from .quest_runner import (
    DirtyWorkspaceError,
    QuestHarnessError,
    _quest_key,
    next_log_step_number,
    runtime_quest_docs_dir,
)
from .experiments import (
    ExperimentRunContext,
    commit_experiment_complete_state,
    mark_quest_experiment_complete,
    snapshot_matches_stop_condition,
)
from .quest_types import EXPERIMENT_COMPLETE_STATE, RecursiveSnapshot
from .state_machine.adapters import QuestRootRoleProfileResolver, SubprocessGitOps
from .state_machine.context import RunContext
from .state_machine.v2_step_executor import execute_v2_top_level_step
from .state_machine.workflow_runner_helpers import (
    build_workflow_runner_bundle,
    has_workflow_human_intervention,
    is_top_level_workflow_complete,
)


class _NoopThreadRegistry:
    def ResolveOrCreateThread(
        self, machine_root_dir: Path, role: str, thread_name: str
    ) -> str:
        return thread_name


class _NoopHarnessOps:
    def SendThreadMessage(self, **kwargs: object) -> str:
        raise NotImplementedError


def _experiment_complete_payload(
    *,
    steps_executed: int,
    last_commit: str | None,
    captured_outputs: list[dict],
    experiment_run: ExperimentRunContext,
) -> dict:
    return {
        "status": "experiment_complete",
        "steps_executed": steps_executed,
        "last_commit": last_commit,
        "captured_outputs": captured_outputs,
        "experiment_id": experiment_run.experiment_meta.experiment_id,
        "experiment_status": "experiment_complete",
        "workflow_state": EXPERIMENT_COMPLETE_STATE,
    }


def _maybe_finalize_experiment_after_step(
    *,
    repo_path: Path,
    quest_dir: Path,
    meta: object,
    experiment_run: ExperimentRunContext,
    snapshot: RecursiveSnapshot | None,
    workflow: object,
    last_commit: str | None,
    steps_executed: int,
    captured_outputs: list[dict],
) -> dict | None:
    if snapshot is None:
        return None
    if not snapshot_matches_stop_condition(
        snapshot,
        experiment_run.experiment_meta.stop_condition,
        workflow,
    ):
        return None
    changed = mark_quest_experiment_complete(quest_dir, meta, repo_path)
    commit_sha = last_commit
    if changed:
        extra = commit_experiment_complete_state(
            repo_path,
            quest_dir,
            experiment_run.experiment_meta.experiment_id,
        )
        if extra is not None:
            commit_sha = extra
    return _experiment_complete_payload(
        steps_executed=steps_executed,
        last_commit=commit_sha,
        captured_outputs=captured_outputs,
        experiment_run=experiment_run,
    )


def run_quest_v2(
    repo_path: Path,
    quest_dir: Path,
    conductor_repo_path: Path,
    max_steps: int = 500,
    event_bus: ChatEventBus | None = None,
    experiment_id: str | None = None,
    experiment_run: ExperimentRunContext | None = None,
) -> dict:
    meta = quest_fs.read_quest_meta(quest_dir)
    quest_key = _quest_key(meta)
    quest_docs_dir = runtime_quest_docs_dir()
    bundle = build_workflow_runner_bundle(repo_path, quest_dir, meta)

    captured_outputs: list[dict] = []
    steps_executed = 0
    last_commit: str | None = None
    role_step_seq = next_log_step_number(quest_dir) - 1
    role_step_seq_box = [role_step_seq]

    git_ops = SubprocessGitOps()
    noop_tr = _NoopThreadRegistry()
    noop_h = _NoopHarnessOps()
    resolver = QuestRootRoleProfileResolver()

    harness_steps_acc = [0]

    for _ in range(max_steps):
        harness_steps_acc[0] = 0
        if has_workflow_human_intervention(quest_dir, bundle.workflow):
            return {
                "status": "human_intervention",
                "steps_executed": steps_executed,
                "last_commit": last_commit,
                "captured_outputs": captured_outputs,
            }

        sm = bundle.workflow_io.ReadStateMachineState(quest_dir)
        if (
            experiment_run is not None
            and sm.state == EXPERIMENT_COMPLETE_STATE
        ):
            return _experiment_complete_payload(
                steps_executed=steps_executed,
                last_commit=last_commit,
                captured_outputs=captured_outputs,
                experiment_run=experiment_run,
            )
        if is_top_level_workflow_complete(
            bundle.workflow, bundle.workflow_io, quest_dir
        ):
            return {
                "status": "completed",
                "steps_executed": steps_executed,
                "last_commit": last_commit,
                "captured_outputs": captured_outputs,
            }

        ctx = RunContext(
            repo_root=repo_path,
            machine_root_dir=quest_dir,
            state_machine_id=bundle.sm_id,
            git_ops=git_ops,
            thread_registry_ops=noop_tr,
            harness_ops=noop_h,
            role_profile_resolver=resolver,
            state_io=bundle.workflow_io,
            state_machine_loader=bundle.loader,
            harness_steps_acc=harness_steps_acc,
            conductor_repo_path=conductor_repo_path,
            quest_docs_dir=quest_docs_dir,
            documenter_base_ref_box=None,
            role_step_seq_box=role_step_seq_box,
            captured_outputs_list=captured_outputs,
            event_bus=event_bus,
            experiment_id=experiment_id,
        )

        try:
            step_out = execute_v2_top_level_step(
                repo_path=repo_path,
                quest_dir=quest_dir,
                quest_key=quest_key,
                meta=meta,
                top=bundle.top,
                ctx=ctx,
                git_ops=git_ops,
                sm_id=bundle.sm_id,
                workflow=bundle.workflow,
            )
        except HarnessMessageError as exc:
            raise QuestHarnessError(
                detail=exc.detail,
                raw_output=exc.raw_output,
                steps_executed=steps_executed + harness_steps_acc[0],
                last_commit=last_commit,
                captured_outputs=list(captured_outputs),
            ) from exc
        except DirtyWorkspaceError as e:
            return {
                "status": "dirty_workspace",
                "message": e.message,
                "steps_executed": steps_executed + harness_steps_acc[0],
                "last_commit": last_commit,
                "captured_outputs": captured_outputs,
            }

        role_step_seq = role_step_seq_box[0]
        steps_executed += harness_steps_acc[0]

        if has_workflow_human_intervention(quest_dir, bundle.workflow):
            return {
                "status": "human_intervention",
                "steps_executed": steps_executed,
                "last_commit": last_commit,
                "captured_outputs": captured_outputs,
            }

        if step_out.kind == "human_intervention":
            return {
                "status": "human_intervention",
                "steps_executed": steps_executed,
                "last_commit": last_commit,
                "captured_outputs": captured_outputs,
            }

        if step_out.kind == "stop":
            return {
                "status": step_out.stop_status or "stop",
                "steps_executed": steps_executed,
                "last_commit": last_commit,
                "captured_outputs": captured_outputs,
            }

        if step_out.kind == "committed" and step_out.last_commit is not None:
            last_commit = step_out.last_commit

        if experiment_run is not None and step_out.kind == "committed":
            finalized = _maybe_finalize_experiment_after_step(
                repo_path=repo_path,
                quest_dir=quest_dir,
                meta=meta,
                experiment_run=experiment_run,
                snapshot=step_out.snapshot,
                workflow=bundle.workflow,
                last_commit=last_commit,
                steps_executed=steps_executed,
                captured_outputs=captured_outputs,
            )
            if finalized is not None:
                return finalized

    return {
        "status": "max_steps",
        "steps_executed": steps_executed,
        "last_commit": last_commit,
        "captured_outputs": captured_outputs,
    }
