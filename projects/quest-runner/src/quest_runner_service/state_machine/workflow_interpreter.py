"""Generic workflow interpreter for state-machine execution."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Mapping

from ..quest_service import FatalInvariantError
from ..quest_types import QuestMeta, RecursiveSnapshot, StateMachineState, utc_now_iso
from ..workflow_config import WorkflowDefinition, WorkflowState
from .context import RunContext
from .protocols import StateMachineDefinition
from .quest_v2_predicates import AdvanceValidationError
from .workflow_actions import execute_actions
from .workflow_conditions import ChildStepResult, evaluate_condition
from .workflow_paths import WorkflowPathContext, collection_child_dir
from .workflow_state_io import WorkflowStateIo, build_workflow_step_snapshot


class ExecutionMode(Enum):
    Automated = "automated"
    Manual = "manual"


RunProfileCallback = Callable[[str, str], None]


@dataclass(frozen=True)
class WorkflowExecutionResult:
    snapshot: RecursiveSnapshot
    transition_kind: str | None
    stop_status: str | None
    stay_reason: str | None
    run_profile_invoked: bool
    state_changed: bool


@dataclass(frozen=True)
class _TransitionMatch:
    kind: str
    target: str | None = None
    actions: tuple[Any, ...] = ()
    stop_status: str | None = None
    stay_reason: str | None = None


class WorkflowStateMachine:
    def __init__(
        self,
        *,
        repo_path: Path,
        quest_dir: Path,
        meta: QuestMeta,
        workflow: WorkflowDefinition,
        workflow_io: WorkflowStateIo,
        machine_dir: Path,
        machine_key: str,
        loader: WorkflowMachineLoader,
    ) -> None:
        self._repo_path = repo_path.resolve()
        self._quest_dir = quest_dir.resolve()
        self._meta = meta
        self._workflow = workflow
        self._workflow_io = workflow_io
        self._machine_dir = machine_dir.resolve()
        self._machine_key = machine_key
        self._loader = loader

    def StateMachineDir(self) -> Path:
        return self._machine_dir

    def Definition(self) -> StateMachineDefinition:
        machine = self._workflow.get_machine(self._machine_key)
        return StateMachineDefinition(
            machine_name=machine.machine,
            node_map={},
            terminal_states=list(machine.terminal),
        )

    def ReadState(self) -> StateMachineState:
        return self._workflow_io.ReadStateMachineState(self._machine_dir)

    def WriteState(self, new_state: str, tags: Mapping[str, str]) -> None:
        prev = self.ReadState()
        updated = StateMachineState(
            machine_name=prev.machine_name,
            machine_path=prev.machine_path,
            state=new_state,
            global_step=prev.global_step,
            tags=dict(tags),
            updated_at=utc_now_iso(),
        )
        self._workflow_io.WriteStateMachineState(self._machine_dir, updated)

    def RunOneStep(self, ctx: RunContext) -> RecursiveSnapshot:
        result = self.RunWorkflowStep(
            mode=ExecutionMode.Automated,
            run_callback=None,
        )
        if result.stop_status is not None:
            raise FatalInvariantError(
                f"Unexpected stop transition with status {result.stop_status!r}"
            )
        return result.snapshot

    def RunWorkflowStep(
        self,
        *,
        mode: ExecutionMode = ExecutionMode.Automated,
        run_callback: RunProfileCallback | None = None,
    ) -> WorkflowExecutionResult:
        before = self.ReadState()
        state_def = self._workflow.get_machine(self._machine_key).states.get(before.state)
        if state_def is None:
            raise FatalInvariantError(
                f"Unknown workflow state {before.state!r} for machine {self._machine_key!r}"
            )
        path_ctx = WorkflowPathContext(
            repo_path=self._repo_path,
            quest_dir=self._quest_dir,
            machine_dir=self._machine_dir,
            machine_key=self._machine_key,
            workflow=self._workflow,
            workflow_io=self._workflow_io,
            meta=self._meta,
            persisted_tags=dict(before.tags),
        )
        execute_actions(state_def.actions, path_ctx)
        run_profile_invoked = False
        if (
            mode == ExecutionMode.Automated
            and state_def.run is not None
            and run_callback is not None
        ):
            profile = state_def.run.get("profile")
            task = state_def.run.get("task", "")
            if not isinstance(profile, str):
                raise FatalInvariantError(
                    f"State {state_def.name!r} run.profile must be a string"
                )
            if not isinstance(task, str):
                raise FatalInvariantError(
                    f"State {state_def.name!r} run.task must be a string"
                )
            run_callback(profile, task)
            run_profile_invoked = True
        child_snapshot: RecursiveSnapshot | None = None
        child_result: ChildStepResult | None = None
        if state_def.child is not None:
            child_snapshot, child_result = self._run_child_step(
                state_def,
                path_ctx,
                mode=mode,
                run_callback=run_callback,
            )
        transition = self._match_transition(
            state_def,
            path_ctx,
            mode=mode,
            child_result=child_result,
        )
        if transition is None:
            if mode == ExecutionMode.Manual:
                raise AdvanceValidationError(
                    "No eligible transition for manual advance.",
                    reason="no_eligible_transition",
                )
            after_state = before.state
            transition_kind = None
            stop_status = None
            stay_reason = None
        elif transition.kind == "stop":
            snapshot = build_workflow_step_snapshot(
                workflow_io=self._workflow_io,
                machine_key=self._machine_key,
                machine_dir=self._machine_dir,
                workflow_state=state_def,
                state_before=before.state,
                state_after=before.state,
                tags=path_ctx.persisted_tags,
                child=child_snapshot,
            )
            return WorkflowExecutionResult(
                snapshot=snapshot,
                transition_kind="stop",
                stop_status=transition.stop_status,
                stay_reason=None,
                run_profile_invoked=run_profile_invoked,
                state_changed=False,
            )
        elif transition.kind == "stay":
            if mode == ExecutionMode.Manual:
                raise AdvanceValidationError(
                    f"Manual advance blocked: {transition.stay_reason}",
                    reason=transition.stay_reason or "stay",
                )
            after_state = before.state
            transition_kind = "stay"
            stop_status = None
            stay_reason = transition.stay_reason
        else:
            execute_actions(list(transition.actions), path_ctx)
            after_state = transition.target or before.state
            transition_kind = "to"
            stop_status = None
            stay_reason = None
        tags = dict(path_ctx.persisted_tags)
        state_changed = after_state != before.state or tags != dict(before.tags)
        if state_changed:
            self.WriteState(after_state, tags)
        snapshot = build_workflow_step_snapshot(
            workflow_io=self._workflow_io,
            machine_key=self._machine_key,
            machine_dir=self._machine_dir,
            workflow_state=state_def,
            state_before=before.state,
            state_after=after_state,
            tags=tags,
            child=child_snapshot,
        )
        return WorkflowExecutionResult(
            snapshot=snapshot,
            transition_kind=transition_kind,
            stop_status=stop_status,
            stay_reason=stay_reason,
            run_profile_invoked=run_profile_invoked,
            state_changed=state_changed,
        )

    def _run_child_step(
        self,
        state_def: WorkflowState,
        path_ctx: WorkflowPathContext,
        *,
        mode: ExecutionMode,
        run_callback: RunProfileCallback | None,
    ) -> tuple[RecursiveSnapshot, ChildStepResult]:
        child_block = state_def.child
        if child_block is None:
            raise FatalInvariantError("child block is required")
        collection_name = child_block.get("collection")
        active_var = child_block.get("active")
        if not isinstance(collection_name, str):
            raise FatalInvariantError("child.collection must be a string")
        if not isinstance(active_var, str):
            raise FatalInvariantError("child.active must be a string")
        try:
            collection = self._workflow.collections[collection_name]
        except KeyError as e:
            raise FatalInvariantError(
                f"Unknown workflow collection {collection_name!r}"
            ) from e
        active_id = path_ctx.persisted_tags.get(active_var, "").strip()
        if not active_id:
            raise FatalInvariantError(
                f"Missing active child id in workflow variable {active_var!r}"
            )
        child_dir = collection_child_dir(collection, self._quest_dir, active_id)
        if not child_dir.is_dir():
            raise FatalInvariantError(f"Active child directory does not exist: {child_dir}")
        child_machine = self._loader.LoadStateMachine(child_dir)
        child_result = child_machine.RunWorkflowStep(
            mode=mode,
            run_callback=run_callback,
        )
        if child_result.stop_status is not None:
            raise FatalInvariantError(
                f"Child machine returned unexpected stop status "
                f"{child_result.stop_status!r}"
            )
        return child_result.snapshot, ChildStepResult(
            state_after=child_result.snapshot.state_after
        )

    def _match_transition(
        self,
        state_def: WorkflowState,
        path_ctx: WorkflowPathContext,
        *,
        mode: ExecutionMode,
        child_result: ChildStepResult | None,
    ) -> _TransitionMatch | None:
        for transition in state_def.transitions:
            if not isinstance(transition, dict):
                raise FatalInvariantError("Transition must be a mapping")
            if transition.get("mode") == "manual_only" and mode == ExecutionMode.Automated:
                continue
            if "stop" in transition:
                if mode == ExecutionMode.Manual:
                    continue
                stop_block = transition["stop"]
                if not isinstance(stop_block, dict):
                    raise FatalInvariantError("stop must be a mapping")
                status = stop_block.get("status")
                if not isinstance(status, str):
                    raise FatalInvariantError("stop.status must be a string")
                condition = transition.get("if")
                if condition is not None and not evaluate_condition(
                    condition, path_ctx, child_result=child_result
                ):
                    continue
                return _TransitionMatch(kind="stop", stop_status=status)
            if "stay" in transition:
                stay_block = transition["stay"]
                if not isinstance(stay_block, dict):
                    raise FatalInvariantError("stay must be a mapping")
                reason = stay_block.get("reason")
                if not isinstance(reason, str):
                    raise FatalInvariantError("stay.reason must be a string")
                condition = transition.get("if")
                if condition is not None and not evaluate_condition(
                    condition, path_ctx, child_result=child_result
                ):
                    continue
                return _TransitionMatch(kind="stay", stay_reason=reason)
            target = transition.get("to")
            if target is not None:
                if not isinstance(target, str):
                    raise FatalInvariantError("transition.to must be a string")
                condition = transition.get("if")
                if condition is not None and not evaluate_condition(
                    condition, path_ctx, child_result=child_result
                ):
                    continue
                actions = transition.get("actions", [])
                if not isinstance(actions, list):
                    raise FatalInvariantError("transition.actions must be a list")
                return _TransitionMatch(
                    kind="to",
                    target=target,
                    actions=tuple(actions),
                )
        return None


class WorkflowMachineLoader:
    def __init__(
        self,
        repo_path: Path,
        quest_dir: Path,
        meta: QuestMeta,
        workflow: WorkflowDefinition,
        workflow_io: WorkflowStateIo,
    ) -> None:
        self._repo_path = repo_path.resolve()
        self._quest_dir = quest_dir.resolve()
        self._meta = meta
        self._workflow = workflow
        self._workflow_io = workflow_io

    def LoadStateMachine(self, state_machine_dir: Path) -> WorkflowStateMachine:
        machine_dir = state_machine_dir.resolve()
        machine_key = self._workflow_io.machine_key_for_dir(machine_dir)
        return WorkflowStateMachine(
            repo_path=self._repo_path,
            quest_dir=self._quest_dir,
            meta=self._meta,
            workflow=self._workflow,
            workflow_io=self._workflow_io,
            machine_dir=machine_dir,
            machine_key=machine_key,
            loader=self,
        )

    def LoadTopStateMachine(self, machine_root_dir: Path) -> WorkflowStateMachine:
        return self.LoadStateMachine(machine_root_dir)
