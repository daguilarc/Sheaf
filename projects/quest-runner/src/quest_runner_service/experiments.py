"""Experiment metadata, naming helpers, and scoped checkout resolution."""

from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

from . import quest_fs
from .dashboard_data import DashboardCheckout, DashboardBadRequest, DashboardNotFound
from .quest_types import QuestMeta
from .worktrees import is_git_worktree, quest_worktree_base_dir, run_git

_EXPERIMENT_DIR_RE = re.compile(r"^\d{4}$")

_EXPERIMENT_STATUSES = frozenset(
    {"created", "open", "experiment_complete", "landed", "failed"}
)


class ExperimentError(Exception):
    """Experiment metadata or resolution error."""


class ExperimentNotFound(ExperimentError):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class ExperimentValidationError(ExperimentError):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class ExperimentWorktreeCreationError(ExperimentError):
    """Experiment metadata was committed but worktree creation failed."""

    def __init__(
        self,
        message: str,
        *,
        metadata_commit: str,
        branch_name: str,
        worktree_path: Path,
        experiment_dir: Path,
    ) -> None:
        self.metadata_commit = metadata_commit
        self.branch_name = branch_name
        self.worktree_path = worktree_path
        self.experiment_dir = experiment_dir
        super().__init__(message)


@dataclass
class ExperimentStartStep:
    global_step: int
    step_commit: str
    base_commit: str
    role: str | None = None
    step_log: str | None = None


@dataclass
class ExperimentStopCondition:
    machine_path: str
    node_name: str


@dataclass
class ExperimentMeta:
    experiment_id: str
    experiment_number: int
    project: str
    quest_type: str
    quest_number: int
    quest_slug: str
    description: str
    start_step: ExperimentStartStep
    stop_condition: ExperimentStopCondition
    worktree_name: str
    branch_name: str
    status: str
    created_at: str
    created_by: str | None = None
    landed_at: str | None = None
    remote_branch: str | None = None
    source_commit: str | None = None


def experiment_dir_name(number: int) -> str:
    return f"{number:04d}"


def experiment_id(
    project: str,
    quest_type: str,
    quest_number: int,
    experiment_number: int,
) -> str:
    return (
        f"experiment_{project}_{quest_type}_{quest_number}_{experiment_number}"
    )


def experiment_branch_name(
    project: str,
    quest_type: str,
    quest_number: int,
    experiment_number: int,
) -> str:
    return (
        f"experiment/{project}/{quest_type}/"
        f"{quest_number:04d}/{experiment_number:04d}"
    )


def experiment_worktree_path(
    source_repo_root: Path,
    experiment_meta_or_id: ExperimentMeta | str,
) -> Path:
    if isinstance(experiment_meta_or_id, ExperimentMeta):
        worktree_name = experiment_meta_or_id.worktree_name
    else:
        worktree_name = experiment_meta_or_id
    return quest_worktree_base_dir(source_repo_root) / worktree_name


def experiments_root(quest_dir: Path) -> Path:
    return quest_dir / "experiments"


def list_experiment_dirs(quest_dir: Path) -> list[Path]:
    root = experiments_root(quest_dir)
    if not root.is_dir():
        return []
    entries: list[tuple[int, Path]] = []
    for child in root.iterdir():
        if not child.is_dir():
            continue
        if not _EXPERIMENT_DIR_RE.match(child.name):
            continue
        entries.append((int(child.name), child))
    entries.sort(key=lambda item: item[0])
    return [path for _num, path in entries]


def next_experiment_number(quest_dir: Path) -> int:
    numbers: list[int] = []
    for path in list_experiment_dirs(quest_dir):
        numbers.append(int(path.name))
    if not numbers:
        return 0
    return max(numbers) + 1


def _experiment_meta_path(path_or_dir: Path) -> Path:
    if path_or_dir.name == "experiment.json":
        return path_or_dir
    return path_or_dir / "experiment.json"


def _start_step_from_json(data: dict) -> ExperimentStartStep:
    raw = data.get("start_step")
    if not isinstance(raw, dict):
        raise ValueError("experiment.json missing required start_step object")
    return ExperimentStartStep(
        global_step=int(raw["global_step"]),
        step_commit=str(raw["step_commit"]),
        base_commit=str(raw["base_commit"]),
        role=raw.get("role"),
        step_log=raw.get("step_log"),
    )


def _stop_condition_from_json(data: dict) -> ExperimentStopCondition:
    raw = data.get("stop_condition")
    if not isinstance(raw, dict):
        raise ValueError("experiment.json missing required stop_condition object")
    return ExperimentStopCondition(
        machine_path=str(raw["machine_path"]),
        node_name=str(raw["node_name"]),
    )


def read_experiment_meta(path_or_dir: Path) -> ExperimentMeta:
    path = _experiment_meta_path(path_or_dir)
    if not path.is_file():
        raise FileNotFoundError(f"Missing experiment meta file: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    status = str(data.get("status", "created"))
    return ExperimentMeta(
        experiment_id=str(data["experiment_id"]),
        experiment_number=int(data["experiment_number"]),
        project=str(data["project"]),
        quest_type=str(data["quest_type"]),
        quest_number=int(data["quest_number"]),
        quest_slug=str(data["quest_slug"]),
        description=str(data.get("description", "")),
        start_step=_start_step_from_json(data),
        stop_condition=_stop_condition_from_json(data),
        worktree_name=str(data["worktree_name"]),
        branch_name=str(data["branch_name"]),
        status=status,
        created_at=str(data["created_at"]),
        created_by=data.get("created_by"),
        landed_at=data.get("landed_at"),
        remote_branch=data.get("remote_branch"),
        source_commit=data.get("source_commit"),
    )


def _meta_to_json(meta: ExperimentMeta) -> dict:
    payload: dict = {
        "experiment_id": meta.experiment_id,
        "experiment_number": meta.experiment_number,
        "project": meta.project,
        "quest_type": meta.quest_type,
        "quest_number": meta.quest_number,
        "quest_slug": meta.quest_slug,
        "description": meta.description,
        "start_step": {
            "global_step": meta.start_step.global_step,
            "step_commit": meta.start_step.step_commit,
            "base_commit": meta.start_step.base_commit,
        },
        "stop_condition": {
            "machine_path": meta.stop_condition.machine_path,
            "node_name": meta.stop_condition.node_name,
        },
        "worktree_name": meta.worktree_name,
        "branch_name": meta.branch_name,
        "status": meta.status,
        "created_at": meta.created_at,
    }
    if meta.start_step.role is not None:
        payload["start_step"]["role"] = meta.start_step.role
    if meta.start_step.step_log is not None:
        payload["start_step"]["step_log"] = meta.start_step.step_log
    if meta.created_by is not None:
        payload["created_by"] = meta.created_by
    if meta.landed_at is not None:
        payload["landed_at"] = meta.landed_at
    if meta.remote_branch is not None:
        payload["remote_branch"] = meta.remote_branch
    if meta.source_commit is not None:
        payload["source_commit"] = meta.source_commit
    return payload


def write_experiment_meta(path_or_dir: Path, meta: ExperimentMeta) -> Path:
    path = _experiment_meta_path(path_or_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(_meta_to_json(meta), indent=2) + "\n",
        encoding="utf-8",
    )
    return path


def update_experiment_status(
    path_or_dir: Path,
    status: str,
    *,
    landed_at: str | None = None,
    remote_branch: str | None = None,
    source_commit: str | None = None,
) -> ExperimentMeta:
    if status not in _EXPERIMENT_STATUSES:
        raise ExperimentValidationError(f"Invalid experiment status: {status!r}")
    meta = read_experiment_meta(path_or_dir)
    meta.status = status
    if landed_at is not None:
        meta.landed_at = landed_at
    if remote_branch is not None:
        meta.remote_branch = remote_branch
    if source_commit is not None:
        meta.source_commit = source_commit
    write_experiment_meta(path_or_dir, meta)
    return meta


_HISTORY_GLOBAL_STEP_RE = re.compile(r"global_step:\s*(\d+)", re.IGNORECASE)
_HISTORY_ROLE_RE = re.compile(r"role:\s*(\S+)", re.IGNORECASE)

_STOP_NODE_ALIASES: dict[str, str] = {
    "slice_completed": "slice_completed",
}


def _quest_machine_path(source_repo_root: Path, quest_dir: Path) -> str:
    return quest_dir.resolve().relative_to(source_repo_root.resolve()).as_posix()


def _rev_parse_parent(source_repo_root: Path, commit: str) -> str:
    result = run_git(
        source_repo_root,
        "rev-parse",
        f"{commit}^",
        check=False,
    )
    if result.returncode != 0:
        raise ExperimentValidationError(
            f"Start step commit {commit!r} has no parent (root commit)"
        )
    return result.stdout.strip()


def _role_from_metadata_row(row: dict) -> str | None:
    role = row.get("role")
    if isinstance(role, str) and role.strip():
        return role.strip()
    chain = row.get("child_chain")
    if isinstance(chain, list):
        for item in chain:
            if not isinstance(item, dict):
                continue
            child_role = item.get("role")
            if isinstance(child_role, str) and child_role.strip():
                return child_role.strip()
    return None


def _step_log_for_role(quest_dir: Path, global_step: int, role: str | None) -> str | None:
    if role is None:
        return None
    rel = f"logs/step_{global_step:04d}_{role}.jsonl"
    if (quest_dir / rel).is_file():
        return rel
    return None


def _history_record_global_step(record: quest_fs.TransitionRecord) -> int | None:
    match = _HISTORY_GLOBAL_STEP_RE.search(record.notes)
    if match is None:
        return None
    return int(match.group(1))


def _history_record_role(record: quest_fs.TransitionRecord) -> str | None:
    match = _HISTORY_ROLE_RE.search(record.notes)
    if match is None:
        return None
    return match.group(1)


def resolve_start_step(
    source_repo_root: Path,
    quest_dir: Path,
    start_step: int,
) -> ExperimentStartStep:
    if start_step < 1:
        raise ExperimentValidationError(
            f"start_step must be a positive integer, got {start_step}"
        )
    from .dashboard_git import scan_quest_metadata_step_commits

    quest_machine_path = _quest_machine_path(source_repo_root, quest_dir)
    rows = scan_quest_metadata_step_commits(source_repo_root, quest_machine_path)
    matching = [row for row in rows if int(row["global_step"]) == start_step]
    seen: set[int] = set()
    deduped: list[dict] = []
    for row in matching:
        gs = int(row["global_step"])
        if gs in seen:
            raise ExperimentValidationError(
                f"Duplicate metadata rows for global_step {start_step}"
            )
        seen.add(gs)
        deduped.append(row)
    if len(deduped) == 1:
        row = deduped[0]
        step_commit = str(row["sha"])
        role = _role_from_metadata_row(row)
        base_commit = _rev_parse_parent(source_repo_root, step_commit)
        return ExperimentStartStep(
            global_step=start_step,
            step_commit=step_commit,
            base_commit=base_commit,
            role=role,
            step_log=_step_log_for_role(quest_dir, start_step, role),
        )

    history = quest_fs.read_history(quest_dir / "state_history.md")
    if not history:
        raise ExperimentValidationError(
            f"No start step metadata found for global_step {start_step}"
        )
    by_global_step = [
        record
        for record in history
        if _history_record_global_step(record) == start_step
    ]
    if len(by_global_step) > 1:
        raise ExperimentValidationError(
            f"Duplicate state_history records for global_step {start_step}"
        )
    if len(by_global_step) == 1:
        record = by_global_step[0]
    else:
        if start_step > len(history):
            raise ExperimentValidationError(
                f"No state_history record for start_step {start_step}"
            )
        record = history[start_step - 1]
    step_commit = record.commit.strip()
    if not step_commit:
        raise ExperimentValidationError(
            f"state_history record for start_step {start_step} has no commit"
        )
    role = _history_record_role(record)
    base_commit = _rev_parse_parent(source_repo_root, step_commit)
    return ExperimentStartStep(
        global_step=start_step,
        step_commit=step_commit,
        base_commit=base_commit,
        role=role,
        step_log=_step_log_for_role(quest_dir, start_step, role),
    )


def _normalize_machine_path(machine_path: str | None) -> str:
    if machine_path is None or not str(machine_path).strip():
        return "root/slice"
    return str(machine_path).strip().replace("\\", "/")


def _node_class_name(node_cls: type) -> str:
    return node_cls.__name__


def validate_stop_condition(
    machine_path: str | None,
    stop_node: str,
) -> ExperimentStopCondition:
    normalized_path = _normalize_machine_path(machine_path)
    if not stop_node or not str(stop_node).strip():
        raise ExperimentValidationError("stop_node must be non-empty")
    raw_node = str(stop_node).strip()
    lower_node = raw_node.lower()

    alias = _STOP_NODE_ALIASES.get(lower_node)
    if alias is not None:
        return ExperimentStopCondition(
            machine_path=normalized_path,
            node_name=alias,
        )

    from .state_machine.quest_v2_definitions import (
        build_quest_machine_definition,
        build_slice_machine_definition,
    )

    if normalized_path in ("root/slice", "slice"):
        node_map = build_slice_machine_definition().node_map
    else:
        node_map = build_quest_machine_definition().node_map

    for key, node_cls in node_map.items():
        if raw_node == key:
            return ExperimentStopCondition(
                machine_path=normalized_path,
                node_name=key,
            )
        if lower_node == key.lower():
            return ExperimentStopCondition(
                machine_path=normalized_path,
                node_name=key,
            )
        class_name = _node_class_name(node_cls)
        if raw_node == class_name or lower_node == class_name.lower():
            return ExperimentStopCondition(
                machine_path=normalized_path,
                node_name=key,
            )

    raise ExperimentValidationError(
        f"Unknown stop node {raw_node!r} for machine_path {normalized_path!r}"
    )


def create_experiment_branch_and_worktree(
    source_repo_root: Path,
    branch_name: str,
    worktree_path: Path,
    base_commit: str,
) -> Path:
    worktree_path.parent.mkdir(parents=True, exist_ok=True)
    run_git(
        source_repo_root,
        "worktree",
        "add",
        "-b",
        branch_name,
        str(worktree_path),
        base_commit,
    )
    return worktree_path


def remove_partial_experiment_worktree(
    source_repo_root: Path,
    branch_name: str,
    worktree_path: Path,
) -> None:
    if worktree_path.is_dir():
        run_git(
            source_repo_root,
            "worktree",
            "remove",
            "--force",
            str(worktree_path),
            check=False,
        )
        if worktree_path.exists():
            shutil.rmtree(worktree_path, ignore_errors=True)
    run_git(source_repo_root, "branch", "-D", branch_name, check=False)


def commit_experiment_metadata(
    source_repo_root: Path,
    experiment_dir: Path,
    project: str,
    quest_type: str,
    quest_number: int,
    experiment_number: int,
) -> str:
    rel = experiment_dir.resolve().relative_to(source_repo_root.resolve()).as_posix()
    run_git(source_repo_root, "add", "--", rel)
    message = (
        f"experiment-create: {project}/{quest_type}/"
        f"{quest_number:04d}/{experiment_number:04d}"
    )
    run_git(source_repo_root, "commit", "-m", message)
    rev = run_git(source_repo_root, "rev-parse", "HEAD")
    return rev.stdout.strip()


def format_experiment_notes(
    *,
    description: str,
    start_step: ExperimentStartStep,
    stop_condition: ExperimentStopCondition,
) -> str:
    role_label = start_step.role or "unknown role"
    lines = [
        "# Experiment Notes",
        "",
        description.strip(),
        "",
        f"Start step: {start_step.global_step} ({role_label})",
        (
            f"Stop condition: {stop_condition.node_name} "
            f"({stop_condition.machine_path})"
        ),
        "",
    ]
    return "\n".join(lines)


def validate_experiment_belongs_to_quest(
    meta: ExperimentMeta,
    project: str,
    quest_type: str,
    quest_number: int,
) -> None:
    mismatches: list[str] = []
    if meta.project != project:
        mismatches.append(f"project {meta.project!r} != {project!r}")
    if meta.quest_type != quest_type:
        mismatches.append(f"quest_type {meta.quest_type!r} != {quest_type!r}")
    if meta.quest_number != quest_number:
        mismatches.append(
            f"quest_number {meta.quest_number} != {quest_number}"
        )
    if mismatches:
        raise ExperimentValidationError(
            f"Experiment {meta.experiment_id!r} does not belong to "
            f"{project}/{quest_type}/{quest_number}: "
            + "; ".join(mismatches)
        )


def find_experiment_by_id(
    source_repo_root: Path,
    project: str,
    quest_type: str,
    quest_number: int,
    experiment_id_value: str,
) -> ExperimentMeta:
    quest_dir = quest_fs.find_quest_dir(
        source_repo_root, project, quest_type, quest_number
    )
    if quest_dir is None:
        raise ExperimentNotFound(
            f"No quest found for project={project!r} type={quest_type!r} "
            f"number={quest_number}"
        )
    for exp_dir in list_experiment_dirs(quest_dir):
        meta_path = exp_dir / "experiment.json"
        if not meta_path.is_file():
            continue
        meta = read_experiment_meta(meta_path)
        if meta.experiment_id == experiment_id_value:
            return meta
    raise ExperimentNotFound(
        f"No experiment {experiment_id_value!r} under quest "
        f"{project}/{quest_type}/{quest_number}"
    )


def _experiment_worktree_exists(
    source_repo_root: Path,
    meta: ExperimentMeta,
) -> bool:
    path = experiment_worktree_path(source_repo_root, meta)
    if not path.is_dir():
        return False
    return is_git_worktree(path)


def resolve_quest_scope_checkout(
    source_repo_root: Path,
    meta: QuestMeta,
    *,
    experiment_id: str | None = None,
    require_open_experiment: bool = False,
) -> DashboardCheckout:
    source_root = source_repo_root.resolve()
    source_qdir = quest_fs.find_quest_dir(
        source_repo_root,
        meta.project,
        meta.quest_type,
        meta.quest_number,
    )
    if source_qdir is None:
        raise DashboardNotFound(
            f"No quest found for project={meta.project!r} "
            f"type={meta.quest_type!r} number={meta.quest_number}"
        )

    if experiment_id is None:
        from .worktrees import quest_worktree_path, worktree_exists

        if worktree_exists(source_repo_root, meta):
            checkout_root = quest_worktree_path(source_repo_root, meta).resolve()
            worktree_qdir = quest_fs.find_quest_dir(
                checkout_root,
                meta.project,
                meta.quest_type,
                meta.quest_number,
            )
            if worktree_qdir is not None:
                quest_dir_rel = (
                    worktree_qdir.resolve().relative_to(checkout_root).as_posix()
                )
                return DashboardCheckout(
                    checkout_kind="worktree",
                    checkout_path=str(checkout_root),
                    worktree_missing=False,
                    checkout_root=checkout_root,
                    quest_dir=worktree_qdir,
                    quest_dir_rel=quest_dir_rel,
                )
        quest_dir_rel = source_qdir.resolve().relative_to(source_root).as_posix()
        return DashboardCheckout(
            checkout_kind="source",
            checkout_path=str(source_root),
            worktree_missing=True,
            checkout_root=source_root,
            quest_dir=source_qdir,
            quest_dir_rel=quest_dir_rel,
        )

    try:
        exp_meta = find_experiment_by_id(
            source_repo_root,
            meta.project,
            meta.quest_type,
            meta.quest_number,
            experiment_id,
        )
    except ExperimentNotFound as e:
        raise DashboardNotFound(e.message) from e
    except ExperimentValidationError as e:
        raise DashboardBadRequest(e.message) from e

    try:
        validate_experiment_belongs_to_quest(
            exp_meta,
            meta.project,
            meta.quest_type,
            meta.quest_number,
        )
    except ExperimentValidationError as e:
        raise DashboardBadRequest(e.message) from e

    checkout_root = experiment_worktree_path(source_repo_root, exp_meta).resolve()
    worktree_present = _experiment_worktree_exists(source_repo_root, exp_meta)
    if require_open_experiment and not worktree_present:
        raise DashboardNotFound(
            f"Experiment worktree is missing for {experiment_id!r}: "
            f"{checkout_root}"
        )

    if worktree_present:
        worktree_qdir = quest_fs.find_quest_dir(
            checkout_root,
            meta.project,
            meta.quest_type,
            meta.quest_number,
        )
        if worktree_qdir is None:
            raise DashboardNotFound(
                f"Quest directory not found in experiment worktree for "
                f"{experiment_id!r}: {checkout_root}"
            )
        quest_dir_rel = (
            worktree_qdir.resolve().relative_to(checkout_root).as_posix()
        )
        return DashboardCheckout(
            checkout_kind="experiment",
            checkout_path=str(checkout_root),
            worktree_missing=False,
            checkout_root=checkout_root,
            quest_dir=worktree_qdir,
            quest_dir_rel=quest_dir_rel,
            experiment_id=exp_meta.experiment_id,
            experiment_number=exp_meta.experiment_number,
            parent_quest_dir=source_qdir.resolve(),
        )

    raise DashboardNotFound(
        f"Experiment worktree is missing for {experiment_id!r}: {checkout_root}"
    )
