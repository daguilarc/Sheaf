"""Slice-level dashboard payloads: physical plan, issues, agents, and step logs."""

from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from . import quest_fs
from .dashboard_data import (
    DashboardBadRequest,
    DashboardNotFound,
    find_slice_dir,
    issue_entry_to_card,
    issue_status_counts,
    issues_latest_updated_at,
)
from .quest_runner import role_thread_key

_STEP_LOG_RE = re.compile(r"^step_(\d+)_(.+)\.jsonl$")
_RESPONSE_SECTION_RE = re.compile(
    r"^## Response\s+(\S+)\s+(.+)\s*$",
    re.MULTILINE,
)

SLICE_SCOPED_ROLES: tuple[str, ...] = (
    "implementer",
    "polisher_reviewer",
    "polisher",
)
QUEST_SCOPED_ROLES: tuple[str, ...] = (
    "physical_planner",
    "physical_plan_reviewer",
    "documenter",
)
VALID_SUBPAGES = frozenset({"physicalplan", "issues", "agents"})
_INLINE_CODE_RE = re.compile(r"`([^`]+)`")
_BOLD_RE = re.compile(r"\*\*([^*]+)\*\*")
_ITALIC_RE = re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)")
_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def _render_inline_markdown(text: str) -> str:
    out = html.escape(text)
    out = _LINK_RE.sub(
        lambda m: f'<a href="{html.escape(m.group(2), quote=True)}">{m.group(1)}</a>',
        out,
    )
    out = _INLINE_CODE_RE.sub(lambda m: f"<code>{m.group(1)}</code>", out)
    out = _BOLD_RE.sub(lambda m: f"<strong>{m.group(1)}</strong>", out)
    out = _ITALIC_RE.sub(lambda m: f"<em>{m.group(1)}</em>", out)
    return out


def render_dashboard_markdown(text: str) -> str:
    """XSS-safe lightweight markdown rendering for dashboard previews."""
    if not text:
        return '<div class="dashboard-markdown"></div>'

    lines = text.splitlines()
    blocks: list[str] = []
    paragraph: list[str] = []
    list_items: list[str] = []
    in_code = False
    code_lines: list[str] = []

    def flush_paragraph() -> None:
        nonlocal paragraph
        if paragraph:
            joined = " ".join(line.strip() for line in paragraph if line.strip())
            if joined:
                blocks.append(f"<p>{_render_inline_markdown(joined)}</p>")
            paragraph = []

    def flush_list() -> None:
        nonlocal list_items
        if list_items:
            blocks.append("<ul>" + "".join(list_items) + "</ul>")
            list_items = []

    def flush_code() -> None:
        nonlocal code_lines
        blocks.append("<pre><code>" + html.escape("\n".join(code_lines)) + "</code></pre>")
        code_lines = []

    for raw in lines:
        line = raw.rstrip("\n")
        stripped = line.strip()
        if stripped.startswith("```"):
            flush_paragraph()
            flush_list()
            if in_code:
                flush_code()
                in_code = False
            else:
                in_code = True
            continue
        if in_code:
            code_lines.append(line)
            continue
        if not stripped:
            flush_paragraph()
            flush_list()
            continue
        if stripped.startswith("#"):
            flush_paragraph()
            flush_list()
            level = min(len(stripped) - len(stripped.lstrip("#")), 6)
            content = stripped[level:].strip()
            blocks.append(f"<h{level}>{_render_inline_markdown(content)}</h{level}>")
            continue
        if stripped.startswith(("- ", "* ")):
            flush_paragraph()
            list_items.append(f"<li>{_render_inline_markdown(stripped[2:].strip())}</li>")
            continue
        paragraph.append(line)

    if in_code:
        flush_code()
    flush_paragraph()
    flush_list()
    return '<div class="dashboard-markdown">' + "".join(blocks) + "</div>"


def parse_slice_number(raw: str | None) -> int:
    if raw is None or not str(raw).strip():
        raise DashboardBadRequest(
            "Missing required query parameter: slice_number",
            fields={"slice_number": "required"},
        )
    try:
        n = int(raw, 10)
    except ValueError as e:
        raise DashboardBadRequest(
            "slice_number must be an integer",
            fields={"slice_number": "invalid"},
        ) from e
    if n < 0:
        raise DashboardBadRequest(
            "slice_number must be non-negative",
            fields={"slice_number": "invalid"},
        )
    return n


def parse_subpage(raw: str | None) -> str:
    if raw is None or not str(raw).strip():
        raise DashboardBadRequest(
            "Missing required query parameter: subpage",
            fields={"subpage": "required"},
        )
    s = raw.strip().lower()
    if s not in VALID_SUBPAGES:
        raise DashboardBadRequest(
            f"subpage must be one of: {', '.join(sorted(VALID_SUBPAGES))}",
            fields={"subpage": "invalid"},
        )
    return s


def resolve_slice_dir_or_404(quest_dir: Path, slice_number: int) -> Path:
    sd = find_slice_dir(quest_dir, slice_number)
    if sd is None:
        raise DashboardNotFound(
            f"No slice directory for slice_number={slice_number} in quest"
        )
    return sd


def _relative_under_quest(quest_dir: Path, path: Path) -> str:
    try:
        return str(path.resolve().relative_to(quest_dir.resolve()))
    except ValueError:
        return str(path.name)


def physicalplan_subpage_payload(quest_dir: Path, slice_dir: Path) -> dict:
    plan_dir = slice_dir / "physicalplan"
    files_out: list[dict] = []
    if plan_dir.is_dir():
        md_files = sorted(
            [p for p in plan_dir.iterdir() if p.is_file() and p.suffix.lower() == ".md"],
            key=lambda p: p.name,
        )
        for p in md_files:
            raw = p.read_text(encoding="utf-8")
            st = p.stat()
            updated = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
            files_out.append(
                {
                    "name": p.name,
                    "relative_path": _relative_under_quest(quest_dir, p),
                    "updated_at": updated,
                    "raw_markdown": raw,
                    "rendered_html": render_dashboard_markdown(raw),
                }
            )
    return {"files": files_out}


@dataclass
class PolishingResponseEntry:
    issue_id: str
    response_timestamp: str
    outcome: str
    explanation: str


def read_polishing_issue_responses(slice_dir: Path) -> list[PolishingResponseEntry]:
    path = slice_dir / "polishing_issue_responses.md"
    if not path.is_file():
        return []
    text = path.read_text(encoding="utf-8")
    matches = list(_RESPONSE_SECTION_RE.finditer(text))
    if not matches:
        return []
    out: list[PolishingResponseEntry] = []
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
            PolishingResponseEntry(
                issue_id=fields.get("issue_id", issue_id_heading),
                response_timestamp=ts,
                outcome=fields.get("outcome", ""),
                explanation=expl,
            )
        )
    return out


def issues_subpage_payload(quest_dir: Path, slice_dir: Path) -> dict:
    issues_path = slice_dir / "polishing_issues.md"
    issues = quest_fs.read_issues(issues_path)
    counts = issue_status_counts(issues)
    latest = issues_latest_updated_at(issues)
    resp_path = slice_dir / "polishing_issue_responses.md"
    responses = read_polishing_issue_responses(slice_dir)
    resp_ts = [r.response_timestamp for r in responses]
    latest_resp = max(resp_ts) if resp_ts else None
    summaries = []
    issue_ids = {i.issue_id for i in issues}
    for r in responses:
        if r.issue_id not in issue_ids:
            continue
        summaries.append(
            {
                "issue_id": r.issue_id,
                "response_timestamp": r.response_timestamp,
                "outcome": r.outcome,
                "explanation_preview": r.explanation[:500]
                + ("…" if len(r.explanation) > 500 else ""),
            }
        )
    return {
        "issues_path": _relative_under_quest(quest_dir, issues_path),
        "issues": [issue_entry_to_card(i) for i in issues],
        "open_count": counts["open"],
        "completed_count": counts["completed"],
        "latest_issue_updated_at": latest,
        "polishing_issue_responses": {
            "present": resp_path.is_file(),
            "path": _relative_under_quest(quest_dir, resp_path)
            if resp_path.is_file()
            else "polishing_issue_responses.md",
            "latest_response_updated_at": latest_resp,
            "summaries": summaries,
        },
    }


def collect_step_logs_for_role(quest_dir: Path, role: str) -> list[tuple[int, Path]]:
    logs_dir = quest_dir / "logs"
    if not logs_dir.is_dir():
        return []
    found: list[tuple[int, Path]] = []
    for p in logs_dir.iterdir():
        if not p.is_file():
            continue
        m = _STEP_LOG_RE.match(p.name)
        if m is None:
            continue
        step_n = int(m.group(1))
        role_part = m.group(2)
        if role_part != role:
            continue
        found.append((step_n, p))
    found.sort(key=lambda t: t[0])
    return found


def _registry_ts(entry: dict, key: str) -> str | None:
    raw = entry.get(key)
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def _agent_last_activity(registry_entry: dict | None) -> str | None:
    if not registry_entry or not isinstance(registry_entry, dict):
        return None
    for k in ("last_used_at", "created_at"):
        t = _registry_ts(registry_entry, k)
        if t:
            return t
    return None


def build_agent_key(scope: str, role: str) -> str:
    return f"{scope}:{role}"


def parse_agent_key(raw: str | None) -> tuple[str, str]:
    if raw is None or not str(raw).strip():
        raise DashboardBadRequest(
            "Missing required query parameter: agent_key",
            fields={"agent_key": "required"},
        )
    s = raw.strip()
    scope, sep, role = s.partition(":")
    if not sep or not scope or not role:
        raise DashboardBadRequest(
            "agent_key must be 'slice:<role>' or 'quest:<role>'",
            fields={"agent_key": "invalid"},
        )
    if scope not in ("slice", "quest"):
        raise DashboardBadRequest(
            "agent_key scope must be slice or quest",
            fields={"agent_key": "invalid"},
        )
    return scope, role


def validate_agent_role(scope: str, role: str) -> None:
    if scope == "slice":
        if role not in SLICE_SCOPED_ROLES:
            raise DashboardNotFound(f"Unknown slice-scoped role: {role!r}")
    else:
        if role not in QUEST_SCOPED_ROLES:
            raise DashboardNotFound(f"Unknown quest-scoped role: {role!r}")


def _agent_payload_entries(
    quest_dir: Path,
    *,
    roles: tuple[str, ...],
    scope: str,
    slice_number: int | None = None,
) -> list[dict]:
    try:
        registry = quest_fs.read_thread_registry(quest_dir)
    except (FileNotFoundError, ValueError, json.JSONDecodeError):
        registry = {}
    agents: list[dict] = []
    slice_dir = find_slice_dir(quest_dir, slice_number) if scope == "slice" else None
    for role in roles:
        key = role_thread_key(role, slice_dir) if slice_dir is not None else role
        raw_e = registry.get(key)
        if raw_e is None and key != role:
            raw_e = registry.get(role)
        entry = raw_e if isinstance(raw_e, dict) else None
        logs = collect_step_logs_for_role(quest_dir, role)
        latest = logs[-1] if logs else None
        latest_log = None
        if latest is not None:
            step_n, path = latest
            latest_log = {
                "step": step_n,
                "filename": path.name,
                "relative_path": _relative_under_quest(quest_dir, path),
            }
        agents.append(
            {
                "agent_key": build_agent_key(scope, role),
                "scope": scope,
                "role": role,
                "thread_name": str(entry["thread_name"])
                if entry and entry.get("thread_name")
                else None,
                "last_activity_at": _agent_last_activity(entry),
                "latest_log": latest_log,
            }
        )
    return agents


def quest_agents_payload(quest_dir: Path) -> dict:
    return {
        "agents": _agent_payload_entries(
            quest_dir, roles=QUEST_SCOPED_ROLES, scope="quest"
        )
    }


def agents_subpage_payload(quest_dir: Path, slice_number: int) -> dict:
    agents = _agent_payload_entries(
        quest_dir,
        roles=SLICE_SCOPED_ROLES,
        scope="slice",
        slice_number=slice_number,
    )
    return {"slice_number": slice_number, "agents": agents}


def slice_page_payload(
    *,
    quest_dir: Path,
    slice_number: int,
    subpage: str,
) -> dict:
    slice_dir = resolve_slice_dir_or_404(quest_dir, slice_number)
    slice_meta = {
        "slice_number": slice_number,
        "directory_name": slice_dir.name,
    }
    try:
        slice_state = quest_fs.read_slice_state(slice_dir)
        slice_state_payload = {
            "state": slice_state.state.value,
            "updated_at": slice_state.updated_at,
        }
    except FileNotFoundError:
        slice_state_payload = None

    if subpage == "physicalplan":
        sub = physicalplan_subpage_payload(quest_dir, slice_dir)
    elif subpage == "issues":
        sub = issues_subpage_payload(quest_dir, slice_dir)
    else:
        sub = agents_subpage_payload(quest_dir, slice_number)

    return {
        "slice": slice_meta,
        "slice_state": slice_state_payload,
        "subpage": subpage,
        "payload": sub,
    }


def agent_log_payload(
    *,
    quest_dir: Path,
    agent_key: str,
    step: int | None,
) -> dict:
    scope, role = parse_agent_key(agent_key)
    validate_agent_role(scope, role)
    logs = collect_step_logs_for_role(quest_dir, role)
    if not logs:
        raise DashboardNotFound(f"No log artifacts for role {role!r}")

    if step is not None:
        selected = next((p for sn, p in logs if sn == step), None)
        if selected is None:
            raise DashboardNotFound(f"No log for role {role!r} with step={step}")
        current_step = step
        path = selected
    else:
        current_step, path = logs[-1]

    raw = path.read_text(encoding="utf-8")
    st = path.stat()
    updated = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    try:
        registry = quest_fs.read_thread_registry(quest_dir)
    except (FileNotFoundError, ValueError, json.JSONDecodeError):
        registry = {}
    entry = registry.get(role) if isinstance(registry.get(role), dict) else None
    thread_name = (
        str(entry["thread_name"]) if entry and entry.get("thread_name") else None
    )

    siblings: list[dict] = []
    for step_n, p in sorted(logs, key=lambda t: t[0], reverse=True):
        siblings.append(
            {
                "step": step_n,
                "filename": p.name,
                "relative_path": _relative_under_quest(quest_dir, p),
                "is_current": step_n == current_step,
            }
        )

    return {
        "agent_key": agent_key,
        "scope": scope,
        "role": role,
        "jsonl_raw": raw,
        "metadata": {
            "relative_path": _relative_under_quest(quest_dir, path),
            "step": current_step,
            "filename": path.name,
            "updated_at": updated,
            "thread_name": thread_name,
        },
        "log_siblings": siblings,
    }


def parse_optional_step(raw: str | None) -> int | None:
    if raw is None or not str(raw).strip():
        return None
    try:
        n = int(raw, 10)
    except ValueError as e:
        raise DashboardBadRequest(
            "step must be an integer",
            fields={"step": "invalid"},
        ) from e
    if n < 0:
        raise DashboardBadRequest(
            "step must be non-negative",
            fields={"step": "invalid"},
        )
    return n
