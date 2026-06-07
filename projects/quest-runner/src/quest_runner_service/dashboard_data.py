"""Dashboard query validation, filesystem reads, and JSON-oriented payloads."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol
from urllib.parse import quote, urlencode

from . import quest_fs
from .dashboard_runs import ActiveRunTracker
from .quest_lock import QuestLock
from .quest_types import IssueEntry, QuestMeta, QuestState, slice_index_from_dirname


class ManagedServiceLister(Protocol):
    def list_managed_services(self) -> list[dict]: ...

_RESPONSE_SECTION_RE = re.compile(
    r"^## Response\s+(\S+)\s+(.+)\s*$",
    re.MULTILINE,
)
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
    repo_path: str,
    quest_type: str,
    quest_number: int,
) -> str:
    q = urlencode(
        {
            "repo_path": repo_path,
            "quest_type": quest_type,
            "quest_number": str(quest_number),
        }
    )
    return f"{base_url.rstrip('/')}/dashboard?{q}"


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
    repo_path_key: str,
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
    info = lock.get_lock_info(repo_path_key)
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


def _normalize_repo_path_arg(raw: str | None) -> Path:
    if raw is None or not str(raw).strip():
        raise DashboardBadRequest(
            "Missing required query parameter: repo_path",
            fields={"repo_path": "required"},
        )
    p = Path(raw).expanduser()
    if not p.is_absolute():
        raise DashboardBadRequest(
            "repo_path must be an absolute path",
            fields={"repo_path": "must_be_absolute"},
        )
    return p.resolve()


def resolve_tracked_repo_path(
    manager: ManagedServiceLister,
    raw_repo_path: str | None,
) -> tuple[Path, dict]:
    path = _normalize_repo_path_arg(raw_repo_path)
    if not path.is_dir():
        raise DashboardNotFound(f"Repository path does not exist: {path}")
    entries = tracked_git_repository_entries(manager)
    resolved_str = str(path)
    for entry in entries:
        if entry["repo_path"] == resolved_str:
            return path, entry
    raise DashboardNotFound(
        f"Repository is not tracked by Conductor: {resolved_str}"
    )


def tracked_git_repository_entries(manager: ManagedServiceLister) -> list[dict]:
    services = manager.list_managed_services()
    by_path: dict[str, dict] = {}
    for svc in services:
        if svc.get("kind") != "service":
            continue
        raw_git = svc.get("git_repo")
        if not raw_git:
            continue
        repo_path = str(Path(raw_git).expanduser().resolve())
        if repo_path in by_path:
            existing = by_path[repo_path]
            names = existing.setdefault("_service_names", [existing["service_name"]])
            if svc["name"] not in names:
                names.append(svc["name"])
            continue
        by_path[repo_path] = {
            "repo_path": repo_path,
            "label": f"{svc['name']} ({Path(repo_path).name})",
            "service_name": svc["name"],
            "tracked_by_conductor": True,
            "_service_names": [svc["name"]],
        }
    out: list[dict] = []
    for row in sorted(by_path.values(), key=lambda r: r["repo_path"]):
        names = row.pop("_service_names", [row["service_name"]])
        if len(names) > 1:
            row["label"] = f"{', '.join(sorted(names))} ({Path(row['repo_path']).name})"
        out.append(row)
    return out


def default_tracked_repository(
    manager: ManagedServiceLister,
    conductor_workspace: Path,
) -> str | None:
    entries = tracked_git_repository_entries(manager)
    if not entries:
        return None
    ws = str(conductor_workspace.resolve())
    for e in entries:
        if e["repo_path"] == ws:
            return e["repo_path"]
    return None


def repositories_payload(
    manager: ManagedServiceLister,
    conductor_workspace: Path,
) -> dict:
    repos = tracked_git_repository_entries(manager)
    default_repo = default_tracked_repository(manager, conductor_workspace)
    return {
        "repositories": repos,
        "default_repository": default_repo,
    }


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


def resolve_quest_dir(
    repo_root: Path,
    quest_type: str,
    quest_number: int,
) -> Path:
    qdir = quest_fs.find_quest_dir(repo_root, quest_type, quest_number)
    if qdir is None:
        raise DashboardNotFound(
            f"No quest found for type={quest_type!r} number={quest_number}"
        )
    return qdir


@dataclass
class PhysicalPlanResponseEntry:
    issue_id: str
    response_timestamp: str
    outcome: str
    explanation: str


def read_physicalplan_issue_responses(quest_dir: Path) -> list[PhysicalPlanResponseEntry]:
    path = quest_dir / "physicalplan_issue_responses.md"
    if not path.is_file():
        return []
    text = path.read_text(encoding="utf-8")
    matches = list(_RESPONSE_SECTION_RE.finditer(text))
    if not matches:
        return []
    out: list[PhysicalPlanResponseEntry] = []
    for i, m in enumerate(matches):
        issue_id_heading = m.group(1)
        ts = m.group(2).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end]
        fields: dict[str, str] = {}
        current: str | None = None
        for raw_line in body.split("\n"):
            line = raw_line.strip()
            if line.startswith("- ") and ":" in line:
                rest = line[2:].strip()
                key, _, val = rest.partition(":")
                key = key.strip()
                val = val.strip()
                current = key
                fields[current] = val
            elif current == "explanation" and line:
                fields[current] = fields.get(current, "") + "\n" + raw_line.rstrip("\n")
            elif current == "explanation" and not line:
                fields[current] = fields.get(current, "") + "\n"
        expl = fields.get("explanation", "").strip()
        out.append(
            PhysicalPlanResponseEntry(
                issue_id=fields.get("issue_id", issue_id_heading),
                response_timestamp=ts,
                outcome=fields.get("outcome", ""),
                explanation=expl,
            )
        )
    return out


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
    responses: list[PhysicalPlanResponseEntry],
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
    repo_path_key: str,
    lock: QuestLock,
    meta: QuestMeta,
) -> dict:
    state_info = quest_fs.read_quest_state(quest_dir)
    pause = read_paused_until_state(quest_dir)
    overlay = execution_overlay_status(
        quest_dir=quest_dir,
        repo_path_key=repo_path_key,
        quest_type=meta.quest_type,
        quest_number=meta.quest_number,
        lock=lock,
    )
    return {
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


def repository_snapshot_payload(
    *,
    manager: ManagedServiceLister,
    repo_path: Path,
    repo_entry: dict,
    lock: QuestLock,
) -> dict:
    key = str(repo_path)
    main_rows: list[dict] = []
    side_rows: list[dict] = []
    for qdir in quest_fs.list_quest_dirs(repo_path, "main"):
        meta = quest_fs.read_quest_meta(qdir)
        main_rows.append(
            quest_summary_row(
                quest_dir=qdir,
                repo_path_key=key,
                lock=lock,
                meta=meta,
            )
        )
    for qdir in quest_fs.list_quest_dirs(repo_path, "side"):
        meta = quest_fs.read_quest_meta(qdir)
        side_rows.append(
            quest_summary_row(
                quest_dir=qdir,
                repo_path_key=key,
                lock=lock,
                meta=meta,
            )
        )
    main_rows.sort(key=lambda r: r["number"], reverse=True)
    side_rows.sort(key=lambda r: r["number"], reverse=True)
    return {
        "repository": {
            "repo_path": repo_entry["repo_path"],
            "label": repo_entry["label"],
            "service_name": repo_entry["service_name"],
            "tracked_by_conductor": True,
        },
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
    repo_root: Path,
    repo_path_key: str,
    lock: QuestLock,
    public_base_url: str,
) -> dict:
    meta = quest_fs.read_quest_meta(quest_dir)
    state_info = quest_fs.read_quest_state(quest_dir)
    pause = read_paused_until_state(quest_dir)
    overlay = execution_overlay_status(
        quest_dir=quest_dir,
        repo_path_key=repo_path_key,
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

    step_history = build_quest_step_history(repo_root, quest_dir)

    return {
        "quest": {
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
            repo_path=repo_path_key,
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
    repo_path_key: str,
    quest_type: str,
    quest_number: int,
    lock: QuestLock,
    run_tracker: ActiveRunTracker,
) -> dict:
    state_info = quest_fs.read_quest_state(quest_dir)
    pause = read_paused_until_state(quest_dir)
    overlay = execution_overlay_status(
        quest_dir=quest_dir,
        repo_path_key=repo_path_key,
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

    active = run_tracker.get_for_quest(repo_path_key, quest_type, quest_number)
    heartbeat_candidates: list[str] = [state_info.updated_at]
    if slice_state_payload:
        heartbeat_candidates.append(slice_state_payload["updated_at"])
    if active is not None:
        heartbeat_candidates.append(_iso_from_epoch(active.last_heartbeat))
    latest_hb = max(heartbeat_candidates)

    return {
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
