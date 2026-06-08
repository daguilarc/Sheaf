"""Dashboard query validation, filesystem reads, and JSON-oriented payloads."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlencode

from . import quest_fs
from .dashboard_runs import ActiveRunTracker
from .quest_lock import QuestLock
from .quest_types import IssueEntry, IssueResponseEntry, QuestMeta, QuestState, slice_index_from_dirname
from .worktrees import quest_worktree_path, validate_project_name
_PAUSED_UNTIL_LINE_RE = re.compile(
    r"^\s*Paused\s+until\s+(.+?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)


class DashboardBadRequest(Exception):
    def __init__(self, message: str, *, fields: dict | None = None) -> None:
        self.message = message
        self.fields = fields or {}
        super().__init__(message)


class DashboardNotFound(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def quote_query_param(value: str) -> str:
    return quote(value, safe="")


def canonical_quest_dashboard_url(
    *,
    base_url: str,
    project: str,
    quest_type: str,
    quest_number: int,
) -> str:
    q = urlencode(
        {
            "project": project,
            "quest_type": quest_type,
            "quest_number": str(quest_number),
        }
    )
    return f"{base_url.rstrip('/')}/dashboard?{q}"


def parse_project(
    raw: str | None,
    *,
    source_repo_root: Path | None = None,
) -> str:
    if raw is None or not str(raw).strip():
        raise DashboardBadRequest(
            "Missing required query parameter: project",
            fields={"project": "required"},
        )
    project = str(raw).strip()
    try:
        validate_project_name(project)
    except ValueError as e:
        raise DashboardBadRequest(str(e), fields={"project": "invalid"}) from e
    if source_repo_root is not None:
        project_dir = source_repo_root / "projects" / project
        if not project_dir.is_dir():
            raise DashboardNotFound(f"Project not found: {project!r}")
    return project


def parse_max_steps(raw: object | None, *, default: int = 500) -> int:
    if raw is None:
        return default
    if not isinstance(raw, int) or raw < 1:
        raise DashboardBadRequest(
            "max_steps must be a positive integer",
            fields={"max_steps": "invalid"},
        )
    return raw


def lock_key_for_quest(source_repo_root: Path, meta: QuestMeta) -> str:
    from .quest_service import _build_run_lock_key

    worktree_path = quest_worktree_path(source_repo_root, meta).resolve()
    return _build_run_lock_key(
        worktree_path,
        meta.project,
        meta.quest_type,
        meta.quest_number,
    )


@dataclass
class DashboardCheckout:
    checkout_kind: str
    checkout_path: str
    worktree_missing: bool
    checkout_root: Path
    quest_dir: Path
    quest_dir_rel: str
    experiment_id: str | None = None
    experiment_number: int | None = None
    parent_quest_dir: Path | None = None


def resolve_dashboard_checkout(
    source_repo_root: Path,
    meta: QuestMeta,
) -> DashboardCheckout:
    from .experiments import resolve_quest_scope_checkout

    return resolve_quest_scope_checkout(
        source_repo_root,
        meta,
        experiment_id=None,
    )


def resolve_quest_checkout_root(source_repo_root: Path, quest_dir: Path) -> Path:
    meta = quest_fs.read_quest_meta(quest_dir)
    return resolve_dashboard_checkout(source_repo_root, meta).checkout_root


def resolve_quest_dirs(
    source_repo_root: Path,
    project: str,
    quest_type: str,
    quest_number: int,
) -> tuple[Path, Path]:
    source_qdir = resolve_quest_dir(
        source_repo_root, project, quest_type, quest_number
    )
    meta = quest_fs.read_quest_meta(source_qdir)
    checkout = resolve_dashboard_checkout(source_repo_root, meta)
    return checkout.checkout_root, checkout.quest_dir


def _project_has_quests(source_repo_root: Path, project: str) -> bool:
    for qt in ("main", "side"):
        if quest_fs.list_quest_dirs(source_repo_root, project, qt):
            return True
    return False


def projects_payload(source_repo_root: Path) -> dict:
    roots = quest_fs.iter_project_quest_roots(source_repo_root)
    projects = [
        {"project": root.project}
        for root in roots
        if _project_has_quests(source_repo_root, root.project)
    ]
    default_project = projects[0]["project"] if projects else None
    return {
        "projects": projects,
        "default_project": default_project,
    }


@dataclass
class PauseUntilState:
    kind: str
    until_iso: str | None = None


def read_paused_until_state(quest_dir: Path) -> PauseUntilState:
    path = quest_dir / "paused_until.md"
    if not path.is_file():
        return PauseUntilState(kind="absent")
    text = path.read_text(encoding="utf-8")
    m = _PAUSED_UNTIL_LINE_RE.search(text)
    if not m:
        return PauseUntilState(kind="invalid")
    raw_ts = m.group(1).strip()
    try:
        normalized = raw_ts.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        until = dt.astimezone(timezone.utc)
    except ValueError:
        return PauseUntilState(kind="invalid")
    until_iso = until.strftime("%Y-%m-%dT%H:%M:%SZ")
    now = datetime.now(timezone.utc)
    if until > now:
        return PauseUntilState(kind="active", until_iso=until_iso)
    return PauseUntilState(kind="expired", until_iso=until_iso)


def execution_overlay_status(
    *,
    quest_dir: Path,
    lock_key: str,
    quest_type: str,
    quest_number: int,
    lock: QuestLock,
) -> str:
    if quest_fs.has_human_intervention_request(quest_dir):
        return "human_intervention"
    pause = read_paused_until_state(quest_dir)
    if pause.kind == "invalid":
        return "human_intervention"
    if pause.kind == "active":
        return "paused"
    info = lock.get_lock_info(lock_key)
    if (
        info is not None
        and info.quest_type == quest_type
        and info.quest_number == quest_number
    ):
        return "running"
    return "none"


def paused_until_public(pause: PauseUntilState) -> str | None:
    if pause.kind == "active":
        return pause.until_iso
    return None


def issue_status_counts(issues: list[IssueEntry]) -> dict[str, int]:
    open_n = sum(1 for i in issues if i.status == "open")
    completed_n = sum(1 for i in issues if i.status == "completed")
    return {"open": open_n, "completed": completed_n}


def issues_latest_updated_at(issues: list[IssueEntry]) -> str | None:
    if not issues:
        return None
    return max(i.updated_at for i in issues)


def find_slice_dir(quest_dir: Path, slice_number: int) -> Path | None:
    for p in quest_fs.list_slice_dirs(quest_dir):
        if slice_index_from_dirname(p.name) == slice_number:
            return p
    return None


def resolve_quest_dir(
    source_repo_root: Path,
    project: str,
    quest_type: str,
    quest_number: int,
) -> Path:
    qdir = quest_fs.find_quest_dir(source_repo_root, project, quest_type, quest_number)
    if qdir is None:
        raise DashboardNotFound(
            f"No quest found for project={project!r} type={quest_type!r} "
            f"number={quest_number}"
        )
    return qdir


def parse_quest_type(raw: str | None) -> str:
    if raw is None or not str(raw).strip():
        raise DashboardBadRequest(
            "Missing required query parameter: quest_type",
            fields={"quest_type": "required"},
        )
    if raw not in ("main", "side"):
        raise DashboardBadRequest(
            "quest_type must be 'main' or 'side'",
            fields={"quest_type": "invalid"},
        )
    return raw


def parse_quest_number(raw: str | None) -> int:
    if raw is None or not str(raw).strip():
        raise DashboardBadRequest(
            "Missing required query parameter: quest_number",
            fields={"quest_number": "required"},
        )
    try:
        n = int(raw, 10)
    except ValueError as e:
        raise DashboardBadRequest(
            "quest_number must be an integer",
            fields={"quest_number": "invalid"},
        ) from e
    if n < 0:
        raise DashboardBadRequest(
            "quest_number must be non-negative",
            fields={"quest_number": "invalid"},
        )
    return n


PhysicalPlanResponseEntry = IssueResponseEntry


def read_physicalplan_issue_responses(quest_dir: Path) -> list[IssueResponseEntry]:
    return quest_fs.read_issue_responses(
        quest_dir / "physicalplan_issue_responses.md"
    )


def issue_entry_to_card(entry: IssueEntry) -> dict:
    return {
        "issue_id": entry.issue_id,
        "status": entry.status,
        "owner_role": entry.owner_role,
        "created_at": entry.created_at,
        "updated_at": entry.updated_at,
        "title": entry.title,
        "details": entry.details,
        "resolution_notes": entry.resolution_notes,
    }


def summarize_responses_for_issues(
    issues: list[IssueEntry],
    responses: list[IssueResponseEntry],
) -> list[dict]:
    ids = {i.issue_id for i in issues}
    matched = [r for r in responses if r.issue_id in ids]
    return [
        {
            "issue_id": r.issue_id,
            "response_timestamp": r.response_timestamp,
            "outcome": r.outcome,
            "explanation_preview": r.explanation[:500]
            + ("…" if len(r.explanation) > 500 else ""),
        }
        for r in matched
    ]


def human_intervention_payload(quest_dir: Path) -> dict:
    path = quest_dir / "human_intervention_request.md"
    if not path.is_file():
        return {
            "present": False,
            "markdown": None,
            "path": "human_intervention_request.md",
            "updated_at": None,
        }
    st = path.stat()
    updated = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    return {
        "present": True,
        "markdown": path.read_text(encoding="utf-8"),
        "path": "human_intervention_request.md",
        "updated_at": updated,
    }


def physicalplan_issues_payload(quest_dir: Path) -> dict:
    path = quest_dir / "physicalplan_issues.md"
    issues = quest_fs.read_issues(path)
    counts = issue_status_counts(issues)
    responses = read_physicalplan_issue_responses(quest_dir)
    latest = issues_latest_updated_at(issues)
    resp_ts = [r.response_timestamp for r in responses]
    latest_response_ts = max(resp_ts) if resp_ts else None
    latest_updates = [x for x in (latest, latest_response_ts) if x]
    latest_overall = max(latest_updates) if latest_updates else None
    return {
        "issues_path": "physicalplan_issues.md",
        "issues": [issue_entry_to_card(i) for i in issues],
        "open_count": counts["open"],
        "completed_count": counts["completed"],
        "latest_issue_updated_at": latest,
        "latest_response_updated_at": latest_response_ts,
        "latest_update_at": latest_overall,
        "responses_summary": summarize_responses_for_issues(issues, responses),
    }


def quest_summary_row(
    *,
    quest_dir: Path,
    source_repo_root: Path,
    lock: QuestLock,
    meta: QuestMeta,
) -> dict:
    lock_key = lock_key_for_quest(source_repo_root, meta)
    state_info = quest_fs.read_quest_state(quest_dir)
    pause = read_paused_until_state(quest_dir)
    overlay = execution_overlay_status(
        quest_dir=quest_dir,
        lock_key=lock_key,
        quest_type=meta.quest_type,
        quest_number=meta.quest_number,
        lock=lock,
    )
    return {
        "project": meta.project,
        "number": meta.quest_number,
        "slug": meta.quest_slug,
        "name": meta.quest_name,
        "state": state_info.state.value,
        "current_slice": state_info.current_slice,
        "updated_at": state_info.updated_at,
        "execution_overlay_status": overlay,
        "paused_until": paused_until_public(pause),
        "has_human_intervention_request": quest_fs.has_human_intervention_request(
            quest_dir
        ),
    }


def project_snapshot_payload(
    *,
    source_repo_root: Path,
    project: str,
    lock: QuestLock,
) -> dict:
    main_rows: list[dict] = []
    side_rows: list[dict] = []
    for qdir in quest_fs.list_quest_dirs(source_repo_root, project, "main"):
        meta = quest_fs.read_quest_meta(qdir)
        main_rows.append(
            quest_summary_row(
                quest_dir=qdir,
                source_repo_root=source_repo_root,
                lock=lock,
                meta=meta,
            )
        )
    for qdir in quest_fs.list_quest_dirs(source_repo_root, project, "side"):
        meta = quest_fs.read_quest_meta(qdir)
        side_rows.append(
            quest_summary_row(
                quest_dir=qdir,
                source_repo_root=source_repo_root,
                lock=lock,
                meta=meta,
            )
        )
    main_rows.sort(key=lambda r: r["number"], reverse=True)
    side_rows.sort(key=lambda r: r["number"], reverse=True)
    return {
        "project": project,
        "main": main_rows,
        "side": side_rows,
    }


_MAX_QUEST_STEP_HISTORY = 400


def _epoch_from_iso_timestamp(ts: str) -> float:
    try:
        normalized = ts.strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except ValueError:
        return 0.0


def build_quest_step_history(repo_root: Path, quest_dir: Path) -> list[dict]:
    """Merge legacy ``state_history.md`` with recursive commit metadata (v2).

    When the same ``commit`` appears in both sources, the metadata row wins.
    Entries are sorted by time (then ``global_step`` for stability). At most
    :data:`_MAX_QUEST_STEP_HISTORY` **most recent** rows are returned.
    """
    from . import dashboard_git

    quest_rel = quest_dir.resolve().relative_to(repo_root.resolve()).as_posix()
    meta_raw = dashboard_git.scan_quest_metadata_step_commits(repo_root, quest_rel)
    meta_shas_all = {m["sha"] for m in meta_raw}
    by_gs: dict[int, dict] = {}
    for row in meta_raw:
        by_gs.setdefault(row["global_step"], row)
    meta_rows = list(by_gs.values())

    legacy_recs = quest_fs.read_history(quest_dir / "state_history.md")

    unified: list[dict] = []
    for m in meta_rows:
        unified.append(
            {
                "source": "metadata",
                "commit": m["sha"],
                "timestamp": m["committed_at"],
                "sort_epoch": m["committed_epoch"],
                "previous_state": m["state_before"],
                "next_state": m["state_after"],
                "notes": "",
                "global_step": m["global_step"],
                "node_name": m.get("node_name"),
                "role": m.get("role"),
                "thread_name": m.get("thread_name"),
                "child_chain": m.get("child_chain", []),
            }
        )

    for rec in legacy_recs:
        if rec.commit in meta_shas_all:
            continue
        unified.append(
            {
                "source": "legacy",
                "commit": rec.commit,
                "timestamp": rec.timestamp,
                "sort_epoch": _epoch_from_iso_timestamp(rec.timestamp),
                "previous_state": rec.previous_state,
                "next_state": rec.next_state,
                "notes": rec.notes,
                "global_step": None,
                "node_name": None,
                "role": None,
                "thread_name": rec.thread_name,
                "child_chain": [],
            }
        )

    unified.sort(
        key=lambda e: (e["sort_epoch"], e.get("global_step") if e.get("global_step") is not None else -1)
    )
    out: list[dict] = []
    for e in unified:
        pub = {k: v for k, v in e.items() if k != "sort_epoch"}
        out.append(pub)
    if len(out) > _MAX_QUEST_STEP_HISTORY:
        out = out[-_MAX_QUEST_STEP_HISTORY:]
    return out


def last_transition_from_step_history(step_history: list[dict]) -> dict | None:
    if not step_history:
        return None
    last = step_history[-1]
    return {
        "timestamp": last["timestamp"],
        "previous_state": last["previous_state"],
        "next_state": last["next_state"],
        "notes": last.get("notes", ""),
        "global_step": last.get("global_step"),
        "source": last.get("source"),
        "child_chain": last.get("child_chain", []),
    }


def quest_overview_payload(
    *,
    quest_dir: Path,
    source_repo_root: Path,
    checkout_root: Path,
    project: str,
    lock: QuestLock,
    public_base_url: str,
) -> dict:
    meta = quest_fs.read_quest_meta(quest_dir)
    lock_key = lock_key_for_quest(source_repo_root, meta)
    state_info = quest_fs.read_quest_state(quest_dir)
    pause = read_paused_until_state(quest_dir)
    overlay = execution_overlay_status(
        quest_dir=quest_dir,
        lock_key=lock_key,
        quest_type=meta.quest_type,
        quest_number=meta.quest_number,
        lock=lock,
    )
    quest_issues = quest_fs.read_issues(quest_dir / "physicalplan_issues.md")
    q_counts = issue_status_counts(quest_issues)
    slice_open = 0
    slice_state_payload: dict | None = None
    slice_meta: dict | None = None
    if state_info.state == QuestState.ExecuteSlice and state_info.current_slice is not None:
        sd = find_slice_dir(quest_dir, state_info.current_slice)
        if sd is not None:
            sst = quest_fs.read_slice_state(sd)
            slice_state_payload = {
                "state": sst.state.value,
                "updated_at": sst.updated_at,
            }
            slice_meta = {
                "slice_number": state_info.current_slice,
                "directory_name": sd.name,
            }
            slice_issues = quest_fs.read_issues(sd / "polishing_issues.md")
            sc = issue_status_counts(slice_issues)
            slice_open = sc["open"]

    slice_nav: list[dict] = []
    for p in quest_fs.list_slice_dirs(quest_dir):
        idx = slice_index_from_dirname(p.name)
        if idx is None:
            continue
        slice_nav.append({"slice_number": idx, "directory_name": p.name})

    step_history = build_quest_step_history(checkout_root, quest_dir)
    checkout = resolve_dashboard_checkout(source_repo_root, meta)

    return {
        "project": meta.project,
        "quest_type": meta.quest_type,
        "quest_number": meta.quest_number,
        "quest_slug": meta.quest_slug,
        "quest_dir_rel": checkout.quest_dir_rel,
        "checkout_kind": checkout.checkout_kind,
        "checkout_path": checkout.checkout_path,
        "worktree_missing": checkout.worktree_missing,
        "quest": {
            "project": meta.project,
            "type": meta.quest_type,
            "number": meta.quest_number,
            "slug": meta.quest_slug,
            "name": meta.quest_name,
            "path": str(quest_dir),
        },
        "quest_state": state_info.state.value,
        "current_slice": state_info.current_slice,
        "active_slice": slice_meta,
        "active_slice_state": slice_state_payload,
        "updated_at": state_info.updated_at,
        "last_transition": last_transition_from_step_history(step_history),
        "step_history": step_history,
        "has_human_intervention_request": quest_fs.has_human_intervention_request(
            quest_dir
        ),
        "has_paused_until": (quest_dir / "paused_until.md").is_file(),
        "paused_until": paused_until_public(pause),
        "open_issues_quest_level": q_counts["open"],
        "open_issues_active_slice": slice_open,
        "quest_dashboard_url": canonical_quest_dashboard_url(
            base_url=public_base_url,
            project=project,
            quest_type=meta.quest_type,
            quest_number=meta.quest_number,
        ),
        "execution_overlay_status": overlay,
        "slices": slice_nav,
    }


def _iso_from_epoch(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run_status_payload(
    *,
    quest_dir: Path,
    source_repo_root: Path,
    project: str,
    quest_type: str,
    quest_number: int,
    lock: QuestLock,
    run_tracker: ActiveRunTracker,
) -> dict:
    meta = quest_fs.read_quest_meta(quest_dir)
    lock_key = lock_key_for_quest(source_repo_root, meta)
    state_info = quest_fs.read_quest_state(quest_dir)
    pause = read_paused_until_state(quest_dir)
    overlay = execution_overlay_status(
        quest_dir=quest_dir,
        lock_key=lock_key,
        quest_type=quest_type,
        quest_number=quest_number,
        lock=lock,
    )
    slice_state_payload: dict | None = None
    if state_info.state == QuestState.ExecuteSlice and state_info.current_slice is not None:
        sd = find_slice_dir(quest_dir, state_info.current_slice)
        if sd is not None:
            sst = quest_fs.read_slice_state(sd)
            slice_state_payload = {
                "slice_number": state_info.current_slice,
                "state": sst.state.value,
                "updated_at": sst.updated_at,
            }

    active = run_tracker.get_for_quest(lock_key, quest_type, quest_number)
    heartbeat_candidates: list[str] = [state_info.updated_at]
    if slice_state_payload:
        heartbeat_candidates.append(slice_state_payload["updated_at"])
    if active is not None:
        heartbeat_candidates.append(_iso_from_epoch(active.last_heartbeat))
    latest_hb = max(heartbeat_candidates)

    checkout = resolve_dashboard_checkout(source_repo_root, meta)

    return {
        "project": project,
        "quest_type": quest_type,
        "quest_number": quest_number,
        "quest_slug": meta.quest_slug,
        "quest_dir_rel": checkout.quest_dir_rel,
        "checkout_kind": checkout.checkout_kind,
        "checkout_path": checkout.checkout_path,
        "worktree_missing": checkout.worktree_missing,
        "quest_state": state_info.state.value,
        "current_slice": state_info.current_slice,
        "current_slice_state": slice_state_payload,
        "execution_overlay_status": overlay,
        "paused_until": paused_until_public(pause),
        "pause_marker_invalid": pause.kind == "invalid",
        "latest_heartbeat_at": latest_hb,
        "active_run": None
        if active is None
        else {
            "run_id": active.run_id,
            "started_at": _iso_from_epoch(active.started_at),
            "last_heartbeat_at": _iso_from_epoch(active.last_heartbeat),
        },
    }
