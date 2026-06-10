"""Slice-level dashboard payloads: physical plan, issues, and step logs."""

from __future__ import annotations

import html
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
from .quest_types import IssueResponseEntry

_STEP_LOG_RE = re.compile(r"^step_(\d+)_(.+)\.jsonl$")

VALID_SUBPAGES = frozenset({"physicalplan", "issues"})
_INLINE_CODE_RE = re.compile(r"`([^`]+)`")
_BOLD_RE = re.compile(r"\*\*([^*]+)\*\*")
_ITALIC_RE = re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)")
_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


@dataclass(frozen=True)
class AgentStepLog:
    step: int
    role: str
    path: Path


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


PolishingResponseEntry = IssueResponseEntry


def read_polishing_issue_responses(slice_dir: Path) -> list[IssueResponseEntry]:
    return quest_fs.read_issue_responses(slice_dir / "polishing_issue_responses.md")


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


def _step_log_updated_at(path: Path) -> str:
    st = path.stat()
    return datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


def collect_agent_step_logs(quest_dir: Path) -> list[AgentStepLog]:
    logs_dir = quest_dir / "logs"
    if not logs_dir.is_dir():
        return []
    found: list[AgentStepLog] = []
    for p in logs_dir.iterdir():
        if not p.is_file():
            continue
        m = _STEP_LOG_RE.match(p.name)
        if m is None:
            continue
        step_n = int(m.group(1))
        role_part = m.group(2)
        found.append(AgentStepLog(step=step_n, role=role_part, path=p))
    found.sort(key=lambda t: t.step, reverse=True)
    return found


def _agent_step_log_payload(
    quest_dir: Path,
    log: AgentStepLog,
    *,
    is_current: bool = False,
) -> dict:
    return {
        "step": log.step,
        "role": log.role,
        "filename": log.path.name,
        "relative_path": _relative_under_quest(quest_dir, log.path),
        "updated_at": _step_log_updated_at(log.path),
        "is_current": is_current,
    }


def agent_steps_payload(quest_dir: Path) -> dict:
    logs = collect_agent_step_logs(quest_dir)
    default_step = logs[0].step if logs else None
    return {
        "default_step": default_step,
        "steps": [
            _agent_step_log_payload(
                quest_dir,
                log,
                is_current=log.step == default_step,
            )
            for log in logs
        ],
    }


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
        slice_state = quest_fs.read_slice_file_state(slice_dir)
        slice_state_payload = {
            "state": slice_state.state,
            "updated_at": slice_state.updated_at,
        }
    except FileNotFoundError:
        slice_state_payload = None

    if subpage == "physicalplan":
        sub = physicalplan_subpage_payload(quest_dir, slice_dir)
    else:
        sub = issues_subpage_payload(quest_dir, slice_dir)

    return {
        "slice": slice_meta,
        "slice_state": slice_state_payload,
        "subpage": subpage,
        "payload": sub,
    }


def resolve_agent_log_path(
    *,
    quest_dir: Path,
    step: int | None,
) -> tuple[int, Path]:
    logs = collect_agent_step_logs(quest_dir)
    if not logs:
        raise DashboardNotFound("No agent step logs for this quest")

    if step is not None:
        selected = next((log.path for log in logs if log.step == step), None)
        if selected is None:
            raise DashboardNotFound(f"No agent step log with step={step}")
        return step, selected
    latest = logs[0]
    return latest.step, latest.path


def agent_log_payload(
    *,
    quest_dir: Path,
    step: int | None,
) -> dict:
    current_step, path = resolve_agent_log_path(
        quest_dir=quest_dir,
        step=step,
    )
    logs = collect_agent_step_logs(quest_dir)
    current_log = next((log for log in logs if log.step == current_step), None)
    if current_log is None:
        raise DashboardNotFound(f"No agent step log with step={current_step}")

    raw = path.read_text(encoding="utf-8")
    steps = [
        _agent_step_log_payload(
            quest_dir,
            log,
            is_current=log.step == current_step,
        )
        for log in logs
    ]

    return {
        "step": current_step,
        "role": current_log.role,
        "jsonl_raw": raw,
        "metadata": {
            "relative_path": _relative_under_quest(quest_dir, path),
            "step": current_step,
            "filename": path.name,
            "role": current_log.role,
            "updated_at": _step_log_updated_at(path),
        },
        "log_steps": steps,
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
