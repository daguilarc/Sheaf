"""Single-commit v2 top-level step: metadata validation, one git commit, no history append."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .. import quest_fs
from ..quest_service import FatalInvariantError
from ..quest_runner import (
    _slice_path_for_quest,
    _write_human_intervention,
    apply_transition_filesystem_side_effects,
    build_v2_transition_plan,
    collect_changed_paths_since,
    scaffold_slice_dir,
)
from ..quest_types import (
    QuestMeta,
    QuestState,
    QuestStateInfo,
    RecursiveSnapshot,
    SliceStateInfo,
    StateMachineId,
    StateMachineState,
    StepCommitMetadata,
    utc_now_iso,
)
from .adapters import SubprocessGitOps
from .commit_metadata import (
    CommitMetadataValidationError,
    parse_step_commit_message,
    render_step_commit_message,
    validate_parsed_step_commit,
)
from .context import RunContext
from .machine import ConcreteStateMachine
from .quest_v2_predicates import (
    AdvanceValidationError,
    physical_planning_next_state,
    prepare_next_slice_transition,
    quest_documenting_next_state,
    review_physical_plan_next_state,
    slice_implementing_next_state,
    slice_polishing_review_next_state,
)


@dataclass
class V2StepResult:
    kind: str
    last_commit: str | None = None


@dataclass
class ManualAdvanceResult:
    kind: str
    previous_quest_state: str
    next_quest_state: str
    previous_slice_state: str | None = None
    next_slice_state: str | None = None
    active_slice: str | None = None
    commit: str | None = None
    message: str = ""


class HumanInterventionConflict(Exception):
    """Quest has an open human intervention request."""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def _write_commit_metadata_failure_log(quest_dir: Path, detail: str) -> Path:
    logs = quest_dir / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    safe_ts = utc_now_iso().replace(":", "-")
    path = logs / f"commit_metadata_validation_{safe_ts}.md"
    path.write_text(
        f"# Commit metadata validation failed\n\n{detail}\n",
        encoding="utf-8",
    )
    return path


def _resolve_gs_before(
    qsi: QuestStateInfo,
    repo_path: Path,
    git_ops: SubprocessGitOps,
    sm_id: StateMachineId,
) -> int:
    if qsi.global_step is not None:
        return qsi.global_step
    return git_ops.ReadGlobalStep(repo_path, sm_id)


def _merge_tags(
    before: StateMachineState, extra: dict[str, str]
) -> dict[str, str]:
    tags = dict(before.tags)
    tags.update(extra)
    return tags


def _write_machine_state(
    state_io: object,
    machine_dir: Path,
    after_state: str,
    tags: dict[str, str],
) -> None:
    prev = state_io.ReadStateMachineState(machine_dir)
    if after_state == prev.state and tags == dict(prev.tags):
        return
    state_io.WriteStateMachineState(
        machine_dir,
        StateMachineState(
            machine_name=prev.machine_name,
            machine_path=prev.machine_path,
            state=after_state,
            global_step=prev.global_step,
            tags=tags,
            updated_at=utc_now_iso(),
        ),
    )


def _evaluate_slice_advance(
    *,
    slice_dir: Path,
    before: StateMachineState,
) -> tuple[str, str, bool]:
    logical = before.state
    if logical == "SliceSetup":
        return "Implementing", "SliceSetupNode", True
    if logical == "Implementing":
        return (
            slice_implementing_next_state(slice_dir),
            "SliceImplementingNode",
            False,
        )
    if logical == "PolishingReview":
        return (
            slice_polishing_review_next_state(slice_dir),
            "SlicePolishingReviewNode",
            False,
        )
    if logical == "PolishingFix":
        return "PolishingReview", "SlicePolishingFixNode", False
    if logical == "Completed":
        return "Completed", "SliceCompletedNode", False
    raise FatalInvariantError(f"Unsupported slice logical state {logical!r}")


def _evaluate_quest_advance(
    *,
    repo_path: Path,
    quest_dir: Path,
    meta: QuestMeta,
    state_io: object,
    before: StateMachineState,
    documenter_base_ref: str,
) -> tuple[str, dict[str, str], str, RecursiveSnapshot | None, bool]:
    logical = before.state
    tags = dict(before.tags)
    child: RecursiveSnapshot | None = None
    child_scaffold = False

    if logical == "PrePlanning":
        return "PhysicalPlanning", tags, "PrePlanningGateNode", None, False
    if logical == "PhysicalPlanning":
        return (
            physical_planning_next_state(quest_dir),
            tags,
            "PhysicalPlanningNode",
            None,
            False,
        )
    if logical == "ReviewPhysicalPlan":
        return (
            review_physical_plan_next_state(quest_dir),
            tags,
            "ReviewPhysicalPlanNode",
            None,
            False,
        )
    if logical == "PrepareNextSlice":
        nxt, extra = prepare_next_slice_transition(quest_dir)
        return nxt, _merge_tags(before, extra), "PrepareNextSliceNode", None, False
    if logical == "ExecuteSlice":
        active = before.tags.get("active_slice") or quest_fs.read_quest_state(
            quest_dir
        ).active_slice
        if not active:
            raise FatalInvariantError("ExecuteSlice requires active_slice")
        slice_dir = quest_dir / "slices" / active
        if not slice_dir.is_dir():
            raise FatalInvariantError(f"Missing active slice directory {slice_dir}")
        slice_before = state_io.ReadStateMachineState(slice_dir)
        child_after, child_node, child_scaffold = _evaluate_slice_advance(
            slice_dir=slice_dir, before=slice_before
        )
        child = RecursiveSnapshot(
            machine_path=slice_before.machine_path,
            machine_name="slice",
            node_name=child_node,
            state_before=slice_before.state,
            state_after=child_after,
            tags=dict(slice_before.tags),
            child=None,
        )
        quest_after = (
            "PrepareNextSlice" if child_after == "Completed" else "ExecuteSlice"
        )
        return quest_after, tags, "ExecuteActiveSliceNode", child, child_scaffold
    if logical == "QuestDocumenting":
        return (
            quest_documenting_next_state(
                repo_path=repo_path,
                quest_dir=quest_dir,
                meta=meta,
                documenter_base_ref=documenter_base_ref,
            ),
            tags,
            "QuestDocumentingNode",
            None,
            False,
        )
    if logical == "Completed":
        return "Completed", tags, "CompletedGateNode", None, False
    raise FatalInvariantError(f"Unsupported quest logical state {logical!r}")


def _manual_run_quest_step(
    *,
    repo_path: Path,
    quest_dir: Path,
    meta: QuestMeta,
    state_io: object,
    documenter_base_ref: str,
) -> RecursiveSnapshot:
    before = state_io.ReadStateMachineState(quest_dir)
    after_state, tags, node_name, child, child_scaffold = _evaluate_quest_advance(
        repo_path=repo_path,
        quest_dir=quest_dir,
        meta=meta,
        state_io=state_io,
        before=before,
        documenter_base_ref=documenter_base_ref,
    )

    if child is not None:
        active = before.tags.get("active_slice") or quest_fs.read_quest_state(
            quest_dir
        ).active_slice
        assert active is not None
        slice_dir = quest_dir / "slices" / active
        slice_before = state_io.ReadStateMachineState(slice_dir)
        if child_scaffold:
            scaffold_slice_dir(slice_dir)
        _write_machine_state(
            state_io, slice_dir, child.state_after, dict(slice_before.tags)
        )

    _write_machine_state(state_io, quest_dir, after_state, tags)
    return RecursiveSnapshot(
        machine_path=before.machine_path,
        machine_name="quest",
        node_name=node_name,
        state_before=before.state,
        state_after=after_state,
        tags=tags,
        child=child,
    )


def commit_v2_snapshot_step(
    *,
    repo_path: Path,
    quest_dir: Path,
    quest_key: str,
    meta: QuestMeta,
    git_ops: SubprocessGitOps,
    sm_id: StateMachineId,
    step_base: str,
    before_quest: QuestStateInfo,
    before_slice: SliceStateInfo | None,
    snapshot: RecursiveSnapshot,
) -> V2StepResult:
    aq = quest_fs.read_quest_state(quest_dir)
    asp = _slice_path_for_quest(quest_dir, aq)
    if asp is not None:
        asi = quest_fs.read_slice_state(asp)
    elif before_slice is not None:
        bsp = _slice_path_for_quest(quest_dir, before_quest)
        asi = (
            quest_fs.read_slice_state(bsp)
            if bsp is not None
            else before_slice
        )
    else:
        asi = None

    plan = build_v2_transition_plan(quest_dir, before_quest, aq, before_slice, asi)
    changed = collect_changed_paths_since(repo_path, step_base)
    if plan.is_noop and not changed:
        return V2StepResult(kind="noop")

    apply_transition_filesystem_side_effects(quest_dir, plan)

    gs_before = _resolve_gs_before(before_quest, repo_path, git_ops, sm_id)
    new_gs = gs_before + 1
    step_meta = StepCommitMetadata(global_step=new_gs, snapshot=snapshot)
    msg = render_step_commit_message(step_meta)
    parsed = parse_step_commit_message(msg)
    if parsed is None:
        _write_commit_metadata_failure_log(
            quest_dir,
            f"quest: {quest_key}\n\n"
            "parse_step_commit_message returned None for rendered metadata "
            "(internal invariant violation).",
        )
        _write_human_intervention(
            quest_dir,
            "commit metadata validation failed",
            "Rendered step metadata did not round-trip parse. See logs/commit_metadata_validation_*.md.",
        )
        return V2StepResult(kind="human_intervention")

    try:
        validate_parsed_step_commit(
            parsed,
            repo_root=repo_path,
            expected_state_after=aq.state.value,
        )
    except CommitMetadataValidationError as exc:
        _write_commit_metadata_failure_log(quest_dir, f"quest: {quest_key}\n\n{exc}")
        _write_human_intervention(
            quest_dir,
            "commit metadata validation failed",
            f"{exc}\n\nSee logs/commit_metadata_validation_*.md.",
        )
        return V2StepResult(kind="human_intervention")

    quest_fs.write_quest_normalized_machine_state(
        quest_dir,
        QuestStateInfo(
            state=aq.state,
            current_slice=aq.current_slice,
            updated_at=utc_now_iso(),
            active_slice=aq.active_slice,
            global_step=new_gs,
        ),
        meta,
        repo_path,
    )

    git_ops.StageAll(repo_path)
    if not git_ops.HasStagedChanges(repo_path):
        _write_human_intervention(
            quest_dir,
            "v2 commit staging empty",
            "Expected staged changes after a v2 top-level step but index was empty.",
        )
        return V2StepResult(kind="human_intervention")

    try:
        sha = git_ops.Commit(repo_path, msg)
    except FatalInvariantError as exc:
        _write_human_intervention(
            quest_dir,
            "v2 git commit failed",
            str(exc),
        )
        return V2StepResult(kind="human_intervention")

    return V2StepResult(kind="committed", last_commit=sha)


def execute_v2_top_level_step(
    *,
    repo_path: Path,
    quest_dir: Path,
    quest_key: str,
    meta: QuestMeta,
    top: ConcreteStateMachine,
    ctx: RunContext,
    git_ops: SubprocessGitOps,
    sm_id: StateMachineId,
) -> V2StepResult:
    step_base = git_ops.GetHeadSha(repo_path)
    bq = quest_fs.read_quest_state(quest_dir)
    bsp = _slice_path_for_quest(quest_dir, bq)
    bsi = quest_fs.read_slice_state(bsp) if bsp else None

    snap = top.RunOneStep(ctx)

    return commit_v2_snapshot_step(
        repo_path=repo_path,
        quest_dir=quest_dir,
        quest_key=quest_key,
        meta=meta,
        git_ops=git_ops,
        sm_id=sm_id,
        step_base=step_base,
        before_quest=bq,
        before_slice=bsi,
        snapshot=snap,
    )


def advance_v2_top_level_step_without_harness(
    *,
    repo_path: Path,
    quest_dir: Path,
    quest_key: str,
    meta: QuestMeta,
    state_io: object,
    git_ops: SubprocessGitOps,
    sm_id: StateMachineId,
) -> ManualAdvanceResult:
    if quest_fs.has_human_intervention_request(quest_dir):
        raise HumanInterventionConflict(
            "Quest has an open human_intervention_request.md; resolve it before advancing."
        )

    bq = quest_fs.read_quest_state(quest_dir)
    bsp = _slice_path_for_quest(quest_dir, bq)
    bsi = quest_fs.read_slice_state(bsp) if bsp else None
    prev_quest = bq.state.value
    prev_slice = bsi.state.value if bsi is not None else None

    if bq.state == QuestState.Completed:
        return ManualAdvanceResult(
            kind="completed",
            previous_quest_state=prev_quest,
            next_quest_state=prev_quest,
            previous_slice_state=prev_slice,
            next_slice_state=prev_slice,
            active_slice=bq.active_slice,
            message="Quest is already completed.",
        )

    step_base = git_ops.GetHeadSha(repo_path)
    documenter_base_ref = (
        step_base if bq.state == QuestState.QuestDocumenting else ""
    )

    snap = _manual_run_quest_step(
        repo_path=repo_path,
        quest_dir=quest_dir,
        meta=meta,
        state_io=state_io,
        documenter_base_ref=documenter_base_ref,
    )

    aq = quest_fs.read_quest_state(quest_dir)
    asp = _slice_path_for_quest(quest_dir, aq)
    asi = quest_fs.read_slice_state(asp) if asp else None
    next_quest = aq.state.value
    next_slice = asi.state.value if asi is not None else None

    step_out = commit_v2_snapshot_step(
        repo_path=repo_path,
        quest_dir=quest_dir,
        quest_key=quest_key,
        meta=meta,
        git_ops=git_ops,
        sm_id=sm_id,
        step_base=step_base,
        before_quest=bq,
        before_slice=bsi,
        snapshot=snap,
    )

    if step_out.kind == "human_intervention":
        raise HumanInterventionConflict(
            "Commit metadata or git commit failed; see human_intervention_request.md."
        )

    commit_sha = step_out.last_commit if step_out.kind == "committed" else None
    return ManualAdvanceResult(
        kind="advanced",
        previous_quest_state=prev_quest,
        next_quest_state=next_quest,
        previous_slice_state=prev_slice,
        next_slice_state=next_slice,
        active_slice=aq.active_slice,
        commit=commit_sha,
        message=f"Advanced quest {quest_key}",
    )
