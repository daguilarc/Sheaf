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
)
from ..quest_types import (
    QuestMeta,
    QuestStateInfo,
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
from .machine import ConcreteStateMachine


@dataclass
class V2StepResult:
    kind: str
    last_commit: str | None = None


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
    gs_before = _resolve_gs_before(bq, repo_path, git_ops, sm_id)
    bsp = _slice_path_for_quest(quest_dir, bq)
    bsi = quest_fs.read_slice_state(bsp) if bsp else None

    snap = top.RunOneStep(ctx)

    aq = quest_fs.read_quest_state(quest_dir)
    asp = _slice_path_for_quest(quest_dir, aq)
    if asp is not None:
        asi = quest_fs.read_slice_state(asp)
    elif bsp is not None:
        asi = quest_fs.read_slice_state(bsp)
    else:
        asi = None

    plan = build_v2_transition_plan(quest_dir, bq, aq, bsi, asi)
    changed = collect_changed_paths_since(repo_path, step_base)
    if plan.is_noop and not changed:
        return V2StepResult(kind="noop")
    apply_transition_filesystem_side_effects(quest_dir, plan)

    new_gs = gs_before + 1
    step_meta = StepCommitMetadata(global_step=new_gs, snapshot=snap)
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
