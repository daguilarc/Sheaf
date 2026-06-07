"""Quest and slice machine nodes for the canonical recursive runner."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from .. import quest_fs
from ..harness import create_harness
from ..quest_runner import (
    _get_slice_dir,
    all_required_slice_plan_files_exist,
    current_project_rel_for_quest,
    docs_updated_for_quest,
    git_rev_parse_head,
    implementer_done_signal,
    implementation_review_done_signal,
    perform_role_harness_sequence,
    physical_plan_review_done_signal,
    quest_has_open_physicalplan_issues,
    role_thread_key,
    scaffold_slice_dir,
    slice_has_open_polishing_issues,
)
from ..quest_thread import load_thread, resolve_or_create_thread_spec
from ..quest_types import QuestState, RecursiveSnapshot, SliceState
from .base_node import BaseNode
from .context import RunContext
from .machine import ConcreteStateMachine

if TYPE_CHECKING:
    from .protocols import StateMachine


class PrePlanningGateNode(BaseNode):
    def Execute(self, ctx: RunContext, machine: StateMachine) -> None:
        return None

    def NextState(self, ctx: RunContext, machine: StateMachine) -> str:
        return "PrePlanning"


class CompletedGateNode(BaseNode):
    def Execute(self, ctx: RunContext, machine: StateMachine) -> None:
        return None

    def NextState(self, ctx: RunContext, machine: StateMachine) -> str:
        return "Completed"


class _ThreadLlmNode(BaseNode):
    m_role: str

    def Execute(self, ctx: RunContext, machine: StateMachine) -> None:
        assert ctx.captured_outputs_list is not None
        assert ctx.role_step_seq_box is not None
        if ctx.harness_steps_acc is not None:
            ctx.harness_steps_acc[0] += 1
        quest_dir = ctx.machine_root_dir
        qsi = quest_fs.read_quest_state(quest_dir)
        slice_dir: Path | None = None
        slice_state: SliceState | None = None
        if qsi.state == QuestState.ExecuteSlice and qsi.current_slice is not None:
            slice_dir = _get_slice_dir(quest_dir, qsi.current_slice)
            slice_state = quest_fs.read_slice_state(slice_dir).state
        meta = quest_fs.read_quest_meta(quest_dir)
        profiles = quest_fs.read_execution_config(quest_dir)
        harness_configs = quest_fs.read_harness_configs(quest_dir)
        profile = profiles[self.m_role]
        harness = create_harness(
            profile.harness, harness_configs.get(profile.harness.value)
        )
        quest_rel = quest_dir.resolve().relative_to(ctx.repo_root.resolve()).as_posix()
        slice_rel: str | None = None
        if slice_dir is not None:
            slice_rel = slice_dir.resolve().relative_to(ctx.repo_root.resolve()).as_posix()
        step_base = git_rev_parse_head(ctx.repo_root)
        thread_key = role_thread_key(self.m_role, slice_dir)
        thread_box: list = [
            load_thread(quest_dir, ctx.repo_root, self.m_role, registry_key=thread_key)
        ]
        assert ctx.conductor_repo_path is not None
        assert ctx.quest_docs_dir is not None
        assert ctx.role_step_seq_box is not None
        snum = qsi.current_slice if qsi.state == QuestState.ExecuteSlice else None

        def _create() -> object:
            return resolve_or_create_thread_spec(
                quest_dir,
                ctx.repo_root,
                self.m_role,
                harness,
                meta.quest_number,
                profile.model,
                profile.reasoning_effort,
                profile.idle_timeout_seconds,
                snum,
                registry_key=thread_key,
            )

        perform_role_harness_sequence(
            repo_path=ctx.repo_root,
            quest_dir=quest_dir,
            conductor_repo_path=ctx.conductor_repo_path,
            meta=meta,
            quest_docs_dir=ctx.quest_docs_dir,
            quest_state_info=qsi,
            slice_dir=slice_dir,
            slice_state=slice_state,
            profile=profile,
            harness=harness,
            role_name=self.m_role,
            thread_key=thread_key,
            quest_rel=quest_rel,
            slice_rel=slice_rel,
            step_base_commit=step_base,
            thread_box=thread_box,
            role_step_seq=ctx.role_step_seq_box,
            captured_outputs=ctx.captured_outputs_list,
            create_thread_if_missing=_create,
        )

    def NextState(self, ctx: RunContext, machine: StateMachine) -> str:
        raise NotImplementedError


class PhysicalPlanningNode(_ThreadLlmNode):
    m_role = "physical_planner"

    def NextState(self, ctx: RunContext, machine: StateMachine) -> str:
        quest_dir = ctx.machine_root_dir
        slice_dirs = quest_fs.list_slice_dirs(quest_dir)
        if slice_dirs and all_required_slice_plan_files_exist(quest_dir):
            return "ReviewPhysicalPlan"
        return "PhysicalPlanning"


class ReviewPhysicalPlanNode(_ThreadLlmNode):
    m_role = "physical_plan_reviewer"

    def NextState(self, ctx: RunContext, machine: StateMachine) -> str:
        quest_dir = ctx.machine_root_dir
        if quest_has_open_physicalplan_issues(quest_dir):
            return "PhysicalPlanning"
        if physical_plan_review_done_signal(quest_dir):
            return "PrepareNextSlice"
        return "ReviewPhysicalPlan"


class PrepareNextSliceNode(BaseNode):
    def __init__(self) -> None:
        self._picked = ""

    def Execute(self, ctx: RunContext, machine: StateMachine) -> None:
        return None

    def NextState(self, ctx: RunContext, machine: StateMachine) -> str:
        quest_dir = ctx.machine_root_dir
        dirs = quest_fs.list_slice_dirs(quest_dir)
        unfinished = [
            d
            for d in dirs
            if quest_fs.read_slice_state(d).state != SliceState.Done
        ]
        self._picked = ""
        if not unfinished:
            return "QuestDocumenting"
        top = quest_fs.read_quest_state(quest_dir)
        cur = top.active_slice
        order = [d.name for d in dirs]
        if not cur:
            self._picked = unfinished[0].name
            return "ExecuteSlice"
        try:
            i = order.index(cur)
        except ValueError:
            self._picked = unfinished[0].name
            return "ExecuteSlice"
        for d in unfinished:
            if order.index(d.name) > i:
                self._picked = d.name
                return "ExecuteSlice"
        return "QuestDocumenting"

    def NodeTags(self, ctx: RunContext, machine: StateMachine) -> dict[str, str]:
        if self._picked:
            return {"active_slice": self._picked}
        return {}


class ExecuteActiveSliceNode(BaseNode):
    m_child_snapshot: object | None

    def __init__(self) -> None:
        self.m_child_snapshot = None

    def Execute(self, ctx: RunContext, machine: StateMachine) -> None:
        quest_dir = ctx.machine_root_dir
        top = quest_fs.read_quest_state(quest_dir)
        active = top.active_slice
        if not active:
            raise RuntimeError("ExecuteActiveSliceNode: missing active_slice")
        slice_dir = quest_dir / "slices" / active
        if not slice_dir.is_dir():
            raise RuntimeError(f"ExecuteActiveSliceNode: missing {slice_dir}")
        child = ctx.state_machine_loader.LoadStateMachine(slice_dir)
        assert isinstance(child, ConcreteStateMachine)
        self.m_child_snapshot = child.RunOneStep(ctx)

    def NextState(self, ctx: RunContext, machine: StateMachine) -> str:
        if self.m_child_snapshot is None:
            raise RuntimeError("child snapshot missing")
        snap: RecursiveSnapshot = self.m_child_snapshot
        if snap.state_after == "Completed":
            return "PrepareNextSlice"
        return "ExecuteSlice"

    def PopChildRecursiveSnapshot(self) -> object | None:
        c = self.m_child_snapshot
        self.m_child_snapshot = None
        return c


class QuestDocumentingNode(_ThreadLlmNode):
    m_role = "documenter"

    def NextState(self, ctx: RunContext, machine: StateMachine) -> str:
        box = ctx.documenter_base_ref_box
        if box is None:
            return "QuestDocumenting"
        ref = box[0]
        quest_dir = ctx.machine_root_dir
        meta = quest_fs.read_quest_meta(quest_dir)
        quest_rel = quest_dir.resolve().relative_to(ctx.repo_root.resolve()).as_posix()
        project_rel = current_project_rel_for_quest(meta, quest_rel)
        docs_rel = f"{project_rel}/docs" if project_rel else "docs"
        if ref and docs_updated_for_quest(ctx.repo_root, ref, docs_rel):
            return "Completed"
        return "QuestDocumenting"


class SliceSetupNode(BaseNode):
    def Execute(self, ctx: RunContext, machine: StateMachine) -> None:
        scaffold_slice_dir(machine.StateMachineDir())

    def NextState(self, ctx: RunContext, machine: StateMachine) -> str:
        return "Implementing"


class SliceImplementingNode(_ThreadLlmNode):
    m_role = "implementer"

    def Execute(self, ctx: RunContext, machine: StateMachine) -> None:
        self._step_base = git_rev_parse_head(ctx.repo_root)
        super().Execute(ctx, machine)

    def NextState(self, ctx: RunContext, machine: StateMachine) -> str:
        if implementer_done_signal(
            machine.StateMachineDir(), ctx.repo_root, self._step_base
        ):
            return "PolishingReview"
        return "Implementing"


class SlicePolishingReviewNode(_ThreadLlmNode):
    m_role = "polisher_reviewer"

    def NextState(self, ctx: RunContext, machine: StateMachine) -> str:
        sd = machine.StateMachineDir()
        if slice_has_open_polishing_issues(sd):
            return "PolishingFix"
        if implementation_review_done_signal(sd):
            return "Completed"
        return "PolishingReview"


class SlicePolishingFixNode(_ThreadLlmNode):
    m_role = "polisher"

    def NextState(self, ctx: RunContext, machine: StateMachine) -> str:
        return "PolishingReview"


class SliceCompletedNode(BaseNode):
    def Execute(self, ctx: RunContext, machine: StateMachine) -> None:
        return None

    def NextState(self, ctx: RunContext, machine: StateMachine) -> str:
        return "Completed"
