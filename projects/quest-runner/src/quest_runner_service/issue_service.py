"""Issue scope resolution, validation, and markdown-backed mutations."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from . import quest_fs
from .dashboard_data import (
    DashboardBadRequest,
    DashboardCheckout,
    DashboardNotFound,
    find_slice_dir,
    lock_key_for_checkout,
    resolve_dashboard_checkout,
    resolve_quest_dir,
)
from .quest_types import IssueEntry, IssueResponseEntry, utc_now_iso

_ISSUE_ID_RE = re.compile(r"^(QP|PL)-\d{4}$")
_VALID_STATUSES = frozenset({"open", "completed"})
_VALID_OUTCOMES = frozenset({"Fixed", "NotFixed"})


class IssueScope(str, Enum):
    PhysicalPlan = "physicalplan"
    Polishing = "polishing"


class IssueNotFound(Exception):
    def __init__(self, issue_id: str) -> None:
        self.issue_id = issue_id
        super().__init__(f"Issue not found: {issue_id}")


@dataclass
class IssueContext:
    source_root: Path
    project: str
    quest_type: str
    quest_number: int
    scope: IssueScope
    slice_number: int | None
    checkout_root: Path
    quest_dir: Path
    slice_dir: Path | None
    issues_path: Path
    responses_path: Path
    id_prefix: str
    owner_role: str
    lock_key: str | None


def parse_scope(raw: object | None) -> IssueScope:
    if raw is None or not str(raw).strip():
        raise DashboardBadRequest(
            "Missing required parameter: scope",
            fields={"scope": "required"},
        )
    value = str(raw).strip().lower()
    if value == IssueScope.PhysicalPlan.value:
        return IssueScope.PhysicalPlan
    if value == IssueScope.Polishing.value:
        return IssueScope.Polishing
    raise DashboardBadRequest(
        "scope must be 'physicalplan' or 'polishing'",
        fields={"scope": "invalid"},
    )


def parse_optional_slice(raw: object | None) -> int | None:
    if raw is None:
        return None
    if isinstance(raw, str) and not raw.strip():
        return None
    if isinstance(raw, bool):
        raise DashboardBadRequest(
            "slice must be an integer",
            fields={"slice": "invalid"},
        )
    if isinstance(raw, int):
        n = raw
    else:
        try:
            n = int(str(raw).strip(), 10)
        except (TypeError, ValueError) as e:
            raise DashboardBadRequest(
                "slice must be an integer",
                fields={"slice": "invalid"},
            ) from e
    if n < 0:
        raise DashboardBadRequest(
            "slice must be non-negative",
            fields={"slice": "invalid"},
        )
    return n


def parse_status_filter(raw: str | None) -> str:
    if raw is None or not str(raw).strip():
        return "all"
    value = str(raw).strip().lower()
    if value in ("open", "completed", "all"):
        return value
    raise DashboardBadRequest(
        "status must be 'open', 'completed', or 'all'",
        fields={"status": "invalid"},
    )


def validate_issue_id(issue_id: str, *, id_prefix: str) -> None:
    if not _ISSUE_ID_RE.match(issue_id):
        raise DashboardBadRequest(
            f"issue_id must match {id_prefix}-NNNN",
            fields={"issue_id": "invalid"},
        )
    if not issue_id.startswith(f"{id_prefix}-"):
        raise DashboardBadRequest(
            f"issue_id must use prefix {id_prefix}",
            fields={"issue_id": "invalid"},
        )


def resolve_issue_context(
    source_root: Path,
    *,
    project: str,
    quest_type: str,
    quest_number: int,
    scope: IssueScope,
    slice_number: int | None,
    experiment_id: str | None = None,
    checkout: DashboardCheckout | None = None,
) -> IssueContext:
    if scope == IssueScope.PhysicalPlan and slice_number is not None:
        raise DashboardBadRequest(
            "slice must not be provided for scope=physicalplan",
            fields={"slice": "unexpected"},
        )
    if scope == IssueScope.Polishing and slice_number is None:
        raise DashboardBadRequest(
            "slice is required for scope=polishing",
            fields={"slice": "required"},
        )

    if checkout is None:
        source_qdir = resolve_quest_dir(
            source_root, project, quest_type, quest_number
        )
        meta = quest_fs.read_quest_meta(source_qdir)
        checkout = resolve_dashboard_checkout(
            source_root,
            meta,
            experiment_id=experiment_id,
        )
    else:
        meta = quest_fs.read_quest_meta(checkout.quest_dir)

    slice_dir: Path | None = None
    if scope == IssueScope.PhysicalPlan:
        issues_path = checkout.quest_dir / "physicalplan_issues.md"
        responses_path = checkout.quest_dir / "physicalplan_issue_responses.md"
        id_prefix = "QP"
        owner_role = "physical_plan_reviewer"
    else:
        assert slice_number is not None
        slice_dir = find_slice_dir(checkout.quest_dir, slice_number)
        if slice_dir is None:
            raise DashboardNotFound(
                f"No slice directory for slice={slice_number} in quest"
            )
        issues_path = slice_dir / "polishing_issues.md"
        responses_path = slice_dir / "polishing_issue_responses.md"
        id_prefix = "PL"
        owner_role = "polisher_reviewer"

    lock_key: str | None = None
    if not checkout.worktree_missing:
        lock_key = lock_key_for_checkout(source_root, meta, checkout)

    return IssueContext(
        source_root=source_root.resolve(),
        project=project,
        quest_type=quest_type,
        quest_number=quest_number,
        scope=scope,
        slice_number=slice_number,
        checkout_root=checkout.checkout_root,
        quest_dir=checkout.quest_dir,
        slice_dir=slice_dir,
        issues_path=issues_path,
        responses_path=responses_path,
        id_prefix=id_prefix,
        owner_role=owner_role,
        lock_key=lock_key,
    )


def issue_to_json(issue: IssueEntry) -> dict:
    return {
        "issue_id": issue.issue_id,
        "status": issue.status,
        "owner_role": issue.owner_role,
        "created_at": issue.created_at,
        "updated_at": issue.updated_at,
        "title": issue.title,
        "body": issue.details,
        "details": issue.details,
        "resolution_notes": issue.resolution_notes,
    }


def response_to_json(response: IssueResponseEntry) -> dict:
    return {
        "issue_id": response.issue_id,
        "response_timestamp": response.response_timestamp,
        "outcome": response.outcome,
        "explanation": response.explanation,
    }


def _read_issues(ctx: IssueContext) -> list[IssueEntry]:
    return quest_fs.read_issues(ctx.issues_path)


def _find_issue(ctx: IssueContext, issue_id: str) -> IssueEntry:
    validate_issue_id(issue_id, id_prefix=ctx.id_prefix)
    for issue in _read_issues(ctx):
        if issue.issue_id == issue_id:
            return issue
    raise IssueNotFound(issue_id)


def _next_issue_id(issues: list[IssueEntry], prefix: str) -> str:
    max_num = 0
    for issue in issues:
        m = re.match(rf"^{re.escape(prefix)}-(\d+)$", issue.issue_id)
        if m:
            max_num = max(max_num, int(m.group(1)))
    return f"{prefix}-{max_num + 1:04d}"


def _filter_by_status(issues: list[IssueEntry], status_filter: str) -> list[IssueEntry]:
    if status_filter == "all":
        return issues
    return [i for i in issues if i.status == status_filter]


def list_issues(ctx: IssueContext, *, status_filter: str = "all") -> list[dict]:
    issues = _filter_by_status(_read_issues(ctx), status_filter)
    return [issue_to_json(i) for i in issues]


def get_issue(ctx: IssueContext, issue_id: str) -> dict:
    issue = _find_issue(ctx, issue_id)
    responses = [
        response_to_json(r)
        for r in quest_fs.read_issue_responses(ctx.responses_path)
        if r.issue_id == issue_id
    ]
    payload = issue_to_json(issue)
    payload["responses"] = responses
    return payload


def create_issue(
    ctx: IssueContext,
    *,
    title: str,
    body: str,
    status: str = "open",
) -> dict:
    title = (title or "").strip()
    body = (body or "").strip()
    if not title:
        raise DashboardBadRequest(
            "title must be non-empty",
            fields={"title": "required"},
        )
    if not body:
        raise DashboardBadRequest(
            "body must be non-empty",
            fields={"body": "required"},
        )
    if status not in _VALID_STATUSES:
        raise DashboardBadRequest(
            "status must be 'open' or 'completed'",
            fields={"status": "invalid"},
        )

    issues = _read_issues(ctx)
    now = utc_now_iso()
    issue = IssueEntry(
        issue_id=_next_issue_id(issues, ctx.id_prefix),
        status=status,
        owner_role=ctx.owner_role,
        created_at=now,
        updated_at=now,
        title=title,
        details=body,
    )
    issues.append(issue)
    quest_fs.write_issues(ctx.issues_path, issues)
    return issue_to_json(issue)


def edit_issue(
    ctx: IssueContext,
    issue_id: str,
    *,
    status: str | None = None,
    title: str | None = None,
    body: str | None = None,
) -> dict:
    issues = _read_issues(ctx)
    idx = None
    validate_issue_id(issue_id, id_prefix=ctx.id_prefix)
    for i, issue in enumerate(issues):
        if issue.issue_id == issue_id:
            idx = i
            break
    if idx is None:
        raise IssueNotFound(issue_id)

    current = issues[idx]
    if status is not None:
        if status not in _VALID_STATUSES:
            raise DashboardBadRequest(
                "status must be 'open' or 'completed'",
                fields={"status": "invalid"},
            )
        current.status = status
    if title is not None:
        title = title.strip()
        if not title:
            raise DashboardBadRequest(
                "title must be non-empty",
                fields={"title": "required"},
            )
        current.title = title
    if body is not None:
        body = body.strip()
        if not body:
            raise DashboardBadRequest(
                "body must be non-empty",
                fields={"body": "required"},
            )
        current.details = body

    current.updated_at = utc_now_iso()
    issues[idx] = current
    quest_fs.write_issues(ctx.issues_path, issues)
    return issue_to_json(current)


def respond_to_issue(
    ctx: IssueContext,
    issue_id: str,
    *,
    outcome: str,
    explanation: str,
) -> dict:
    _find_issue(ctx, issue_id)
    if outcome not in _VALID_OUTCOMES:
        raise DashboardBadRequest(
            "outcome must be 'Fixed' or 'NotFixed'",
            fields={"outcome": "invalid"},
        )
    explanation = (explanation or "").strip()
    if not explanation:
        raise DashboardBadRequest(
            "explanation must be non-empty",
            fields={"explanation": "required"},
        )

    entry = IssueResponseEntry(
        issue_id=issue_id,
        response_timestamp=utc_now_iso(),
        outcome=outcome,
        explanation=explanation,
    )
    quest_fs.append_issue_response(ctx.responses_path, entry)
    return {
        "response": response_to_json(entry),
        "issue": issue_to_json(_find_issue(ctx, issue_id)),
    }


def list_responses(ctx: IssueContext, issue_id: str) -> list[dict]:
    _find_issue(ctx, issue_id)
    return [
        response_to_json(r)
        for r in quest_fs.read_issue_responses(ctx.responses_path)
        if r.issue_id == issue_id
    ]
