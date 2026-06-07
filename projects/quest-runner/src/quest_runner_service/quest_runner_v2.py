"""Canonical recursive state-machine quest runner (``run_quest`` delegates here)."""

from __future__ import annotations

from pathlib import Path

from . import quest_fs
from .harness import HarnessMessageError
from .quest_runner import (
    DirtyWorkspaceError,
    QuestHarnessError,
    _quest_key,
    build_v2_transition_plan,
    git_rev_parse_head,
    next_log_step_number,
)
from .quest_types import QuestState, StateMachineId
from .state_machine.adapters import QuestRootRoleProfileResolver, SubprocessGitOps
from .state_machine.context import RunContext
from .state_machine.machine import ConcreteStateMachine
from .state_machine.quest_v2_definitions import QuestV2MachineLoader, build_quest_machine_definition
from .state_machine.v2_quest_state_io import V2QuestStateIo
from .state_machine.v2_step_executor import execute_v2_top_level_step


class _NoopThreadRegistry:
    def ResolveOrCreateThread(
        self, machine_root_dir: Path, role: str, thread_name: str
    ) -> str:
        return thread_name


class _NoopHarnessOps:
    def SendThreadMessage(self, **kwargs: object) -> str:
        raise NotImplementedError


def run_quest_v2(
    repo_path: Path,
    quest_dir: Path,
    conductor_repo_path: Path,
    max_steps: int = 500,
) -> dict:
    meta = quest_fs.read_quest_meta(quest_dir)
    quest_key = _quest_key(meta)
    del conductor_repo_path
    quest_docs_dir = (Path(__file__).resolve().parent / "quest_docs").resolve()
    rel = quest_dir.resolve().relative_to(repo_path.resolve()).as_posix()
    sm_id = StateMachineId(
        root_machine_id=rel, machine_path=rel, machine_name="quest"
    )
    io_v2 = V2QuestStateIo(repo_path, quest_dir, meta)
    loader = QuestV2MachineLoader(io_v2)
    top = ConcreteStateMachine(
        quest_dir.resolve(), build_quest_machine_definition(), io_v2
    )

    captured_outputs: list[dict] = []
    steps_executed = 0
    last_commit: str | None = None
    documenter_base_ref: str | None = None
    role_step_seq = next_log_step_number(quest_dir) - 1
    role_step_seq_box = [role_step_seq]
    documenter_base_ref_box: list[str | None] = [None]

    git_ops = SubprocessGitOps()
    noop_tr = _NoopThreadRegistry()
    noop_h = _NoopHarnessOps()
    resolver = QuestRootRoleProfileResolver()

    harness_steps_acc = [0]

    for _ in range(max_steps):
        harness_steps_acc[0] = 0
        if quest_fs.has_human_intervention_request(quest_dir):
            return {
                "status": "human_intervention",
                "steps_executed": steps_executed,
                "last_commit": last_commit,
                "captured_outputs": captured_outputs,
            }

        qsi = quest_fs.read_quest_state(quest_dir)
        if qsi.state == QuestState.PrePlanning:
            return {
                "status": "pre_planning",
                "steps_executed": steps_executed,
                "last_commit": last_commit,
                "captured_outputs": captured_outputs,
            }
        if qsi.state == QuestState.Completed:
            return {
                "status": "completed",
                "steps_executed": steps_executed,
                "last_commit": last_commit,
                "captured_outputs": captured_outputs,
            }

        if (
            qsi.state == QuestState.QuestDocumenting
            and documenter_base_ref is None
        ):
            documenter_base_ref = git_rev_parse_head(repo_path)
        documenter_base_ref_box[0] = documenter_base_ref

        ctx = RunContext(
            repo_root=repo_path,
            machine_root_dir=quest_dir,
            state_machine_id=sm_id,
            git_ops=git_ops,
            thread_registry_ops=noop_tr,
            harness_ops=noop_h,
            role_profile_resolver=resolver,
            state_io=io_v2,
            state_machine_loader=loader,
            harness_steps_acc=harness_steps_acc,
            conductor_repo_path=conductor_repo_path,
            quest_docs_dir=quest_docs_dir,
            documenter_base_ref_box=documenter_base_ref_box,
            role_step_seq_box=role_step_seq_box,
            captured_outputs_list=captured_outputs,
        )

        try:
            step_out = execute_v2_top_level_step(
                repo_path=repo_path,
                quest_dir=quest_dir,
                quest_key=quest_key,
                meta=meta,
                top=top,
                ctx=ctx,
                git_ops=git_ops,
                sm_id=sm_id,
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

        if quest_fs.has_human_intervention_request(quest_dir):
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

        if step_out.kind == "committed" and step_out.last_commit is not None:
            last_commit = step_out.last_commit

    return {
        "status": "max_steps",
        "steps_executed": steps_executed,
        "last_commit": last_commit,
        "captured_outputs": captured_outputs,
    }
