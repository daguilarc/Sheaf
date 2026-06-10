"""Single-commit v2 top-level step: metadata validation, one git commit, no history append."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .. import quest_fs
from ..errors import FatalInvariantError
from ..quest_runner import (
    _slice_path_for_quest,
    _write_human_intervention,
    collect_changed_paths_since,
)
from ..quest_types import (
    QuestMeta,
    QuestState,
    QuestStateInfo,
    RecursiveSnapshot,
    SliceStateInfo,
    StateMachineId,
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
from ..errors import AdvanceValidationError
from .workflow_harness_callback import build_workflow_run_callback
from ..workflow_config import WorkflowDefinition
from .workflow_interpreter import ExecutionMode, WorkflowStateMachine
from .workflow_runner_helpers import (
    build_workflow_runner_bundle,
    has_workflow_human_intervention,
    is_top_level_workflow_complete,
)


@dataclass
class V2StepResult:
    kind: str
    last_commit: str | None = None
    snapshot: RecursiveSnapshot | None = None
    stop_status: str | None = None


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
    snapshot: RecursiveSnapshot | None = None


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
    state_changed: bool,
) -> V2StepResult:
    aq = quest_fs.read_quest_state(quest_dir)
    changed = collect_changed_paths_since(repo_path, step_base)
    if not state_changed and not changed:
        return V2StepResult(kind="noop", snapshot=snapshot)

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
        return V2StepResult(kind="human_intervention", snapshot=snapshot)

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
        return V2StepResult(kind="human_intervention", snapshot=snapshot)

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
        return V2StepResult(kind="human_intervention", snapshot=snapshot)

    try:
        sha = git_ops.Commit(repo_path, msg)
    except FatalInvariantError as exc:
        _write_human_intervention(
            quest_dir,
            "v2 git commit failed",
            str(exc),
        )
        return V2StepResult(kind="human_intervention", snapshot=snapshot)

    return V2StepResult(kind="committed", last_commit=sha, snapshot=snapshot)


def execute_v2_top_level_step(
    *,
    repo_path: Path,
    quest_dir: Path,
    quest_key: str,
    meta: QuestMeta,
    top: WorkflowStateMachine,
    ctx: RunContext,
    git_ops: SubprocessGitOps,
    sm_id: StateMachineId,
    workflow: WorkflowDefinition,
) -> V2StepResult:
    step_base = git_ops.GetHeadSha(repo_path)
    bq = quest_fs.read_quest_state(quest_dir)
    bsp = _slice_path_for_quest(quest_dir, bq)
    bsi = quest_fs.read_slice_state(bsp) if bsp else None

    run_callback = build_workflow_run_callback(ctx, top, workflow)
    result = top.RunWorkflowStep(
        mode=ExecutionMode.Automated,
        run_callback=run_callback,
    )

    if result.stop_status is not None:
        return V2StepResult(
            kind="stop",
            stop_status=result.stop_status,
            snapshot=result.snapshot,
        )

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
        snapshot=result.snapshot,
        state_changed=result.state_changed,
    )


def advance_v2_top_level_step_without_harness(
    *,
    repo_path: Path,
    quest_dir: Path,
    quest_key: str,
    meta: QuestMeta,
    git_ops: SubprocessGitOps,
) -> ManualAdvanceResult:
    bundle = build_workflow_runner_bundle(repo_path, quest_dir, meta)

    if has_workflow_human_intervention(quest_dir, bundle.workflow):
        raise HumanInterventionConflict(
            "Quest has an open human_intervention_request.md; resolve it before advancing."
        )

    bq = quest_fs.read_quest_state(quest_dir)
    bsp = _slice_path_for_quest(quest_dir, bq)
    bsi = quest_fs.read_slice_state(bsp) if bsp else None
    prev_quest = bq.state.value
    prev_slice = bsi.state.value if bsi is not None else None

    if is_top_level_workflow_complete(
        bundle.workflow, bundle.workflow_io, quest_dir
    ):
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

    result = bundle.top.RunWorkflowStep(mode=ExecutionMode.Manual)

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
        sm_id=bundle.sm_id,
        step_base=step_base,
        before_quest=bq,
        before_slice=bsi,
        snapshot=result.snapshot,
        state_changed=result.state_changed,
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
        snapshot=result.snapshot,
    )
