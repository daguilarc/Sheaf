"""Shared quest/slice transition predicates for v2 runner and manual advance."""

from __future__ import annotations

from pathlib import Path

from .. import quest_fs
from ..quest_runner import (
    all_required_slice_plan_files_exist,
    current_project_rel_for_quest,
    docs_updated_for_quest,
    implementer_done_signal,
    implementation_review_done_signal,
    physical_plan_review_done_signal,
    quest_has_open_physicalplan_issues,
    slice_has_open_polishing_issues,
)
from ..quest_types import QuestMeta, SliceState


class AdvanceValidationError(Exception):
    """Manual advance blocked by unmet predicates; state must not change."""

    def __init__(self, message: str, *, reason: str) -> None:
        self.message = message
        self.reason = reason
        super().__init__(message)


def physical_planning_next_state(quest_dir: Path) -> str:
    slice_dirs = quest_fs.list_slice_dirs(quest_dir)
    if slice_dirs and all_required_slice_plan_files_exist(quest_dir):
        return "ReviewPhysicalPlan"
    raise AdvanceValidationError(
        "Physical planning is incomplete: slice directories and required "
        "physicalplan/state files are missing.",
        reason="incomplete_physical_plan",
    )


def review_physical_plan_next_state(quest_dir: Path) -> str:
    if quest_has_open_physicalplan_issues(quest_dir):
        return "PhysicalPlanning"
    if physical_plan_review_done_signal(quest_dir):
        return "PrepareNextSlice"
    raise AdvanceValidationError(
        "Physical plan review is incomplete: resolve open issues and create "
        "`physicalplan_accepted.md` before advancing.",
        reason="physical_plan_review_incomplete",
    )


def prepare_next_slice_transition(quest_dir: Path) -> tuple[str, dict[str, str]]:
    dirs = quest_fs.list_slice_dirs(quest_dir)
    unfinished = [
        d
        for d in dirs
        if quest_fs.read_slice_state(d).state != SliceState.Done
    ]
    if not unfinished:
        return "QuestDocumenting", {}
    top = quest_fs.read_quest_state(quest_dir)
    cur = top.active_slice
    order = [d.name for d in dirs]
    if not cur:
        return "ExecuteSlice", {"active_slice": unfinished[0].name}
    try:
        i = order.index(cur)
    except ValueError:
        return "ExecuteSlice", {"active_slice": unfinished[0].name}
    for d in unfinished:
        if order.index(d.name) > i:
            return "ExecuteSlice", {"active_slice": d.name}
    return "QuestDocumenting", {}


def slice_implementing_next_state(slice_dir: Path) -> str:
    if implementer_done_signal(slice_dir, slice_dir, ""):
        return "PolishingReview"
    raise AdvanceValidationError(
        "Slice implementation is incomplete: create `implementation_done.md` "
        "before advancing.",
        reason="missing_implementation_done",
    )


def slice_polishing_review_next_state(slice_dir: Path) -> str:
    if slice_has_open_polishing_issues(slice_dir):
        return "PolishingFix"
    if implementation_review_done_signal(slice_dir):
        return "Completed"
    raise AdvanceValidationError(
        "Slice polishing review is incomplete: resolve open issues and create "
        "`implementation_accepted.md` before advancing.",
        reason="polishing_review_incomplete",
    )


def quest_documenting_next_state(
    *,
    repo_path: Path,
    quest_dir: Path,
    meta: QuestMeta,
    documenter_base_ref: str,
) -> str:
    quest_rel = quest_dir.resolve().relative_to(repo_path.resolve()).as_posix()
    project_rel = current_project_rel_for_quest(meta, quest_rel)
    docs_rel = f"{project_rel}/docs" if project_rel else "docs"
    if documenter_base_ref and docs_updated_for_quest(
        repo_path, documenter_base_ref, docs_rel
    ):
        return "Completed"
    raise AdvanceValidationError(
        "Quest documentation is incomplete: update project docs before advancing.",
        reason="docs_unchanged",
    )
