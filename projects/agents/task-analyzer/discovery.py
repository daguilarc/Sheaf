"""Discovery, joining, and role/round classification for the SDD
task-analyzer pipeline.

Four independent responsibilities, per design D3/D4/D5
(``openspec/changes/add-sdd-task-analyzer/design.md``):

- ``landed_changes``: which openspec changes have landed, read purely from a
  git ref (never the working tree) via ``git ls-tree``.
- ``classify_role`` / ``task_keys``: mechanical (regex-only) classification
  of a session's role and change/task identity from its prompt text. This is
  a clean-room port of the *final* (bug-fixed) regex set in
  ``analysis/sdd-model-analysis/scripts/extract_codex.py``
  (``classify``/``task_keys``) and ``build_tasks.py`` (``task_of``), folded
  into the smaller 5-role enum this pipeline uses. Read for reference; not
  imported.
- ``assign_review_rounds`` / ``canonical_arm``: the deterministic
  review-round mechanics of design D5, operating over a task's joined
  sessions (each a mapping or object exposing ``session_id``, ``role``,
  ``started_at``, ``ended_at``, and -- for ``canonical_arm`` -- ``model``,
  ``effort``, ``output_tokens``).
- ``Quarantine``: the record shape for a session whose task-key join was
  ambiguous (matches more than one task, or a brief-hash conflict). Building
  the actual join across a change's tasks is Task 5's (``ingest.py``)
  responsibility; this module only defines the shape ambiguous joins are
  reported in, and the mechanical role/key primitives that join consumes.

Stdlib only.
"""
from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, NamedTuple, Optional, Tuple, Union

SessionLike = Union[Mapping[str, Any], Any]

# The earliest possible sortable value (fix-round-1 review, finding 3): used
# for missing/empty/unparseable timestamps so they sort as "earliest ever"
# rather than crashing a comparison.
_MIN_DATETIME = datetime.min.replace(tzinfo=timezone.utc)


def parse_timestamp(ts: Optional[str]) -> datetime:
    """Parse an ISO-8601 session/turn timestamp into a timezone-aware UTC
    ``datetime`` for sortable/comparable use (fix-round-1 review, finding
    3). Comparing/sorting the raw timestamp STRINGS is unsafe: providers
    format timestamps differently (``Z`` suffix vs explicit ``+00:00``
    offset) and even within one provider, two events at the same whole
    second may differ in whether they carry a fractional-second component
    at all -- ``"...T00:00:08Z"`` sorts AFTER ``"...T00:00:08.123Z"`` under
    plain string comparison (``'.'`` (0x2E) < ``'Z'`` (0x5A)), which is
    backwards (the first has strictly *more* elapsed time in that second,
    zero vs 123ms). Every boundary/timestamp comparison in
    ``review_boundaries``/``assign_review_rounds`` (this module) and the
    spanning-session split (``costs.py``) MUST go through this function,
    never compare the raw strings directly.

    Missing, empty, or unparseable input returns ``datetime.min`` (UTC) --
    sorts as the earliest possible boundary, never raises -- covering an
    aborted session with no ``ended_at`` (falls back to ``started_at``,
    which itself may be empty) and any genuinely malformed data.
    """
    if not ts:
        return _MIN_DATETIME
    normalized = ts[:-1] + "+00:00" if ts.endswith("Z") else ts
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        return _MIN_DATETIME
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


class LandedChange(NamedTuple):
    name: str
    archive_path: str
    plan_path: Optional[str]


@dataclass
class Quarantine:
    """Record of an ambiguous session->task join.

    ``reason`` is a short human-readable explanation (e.g. "task key matches
    >1 task" or "brief hash conflict"); ``candidates`` lists the conflicting
    task identifiers. Quarantined sessions get ``task_id`` NULL in the
    database -- never a guessed join.
    """

    session_id: str
    reason: str
    candidates: List[str]


# --------------------------------------------------------------------------
# landed_changes
# --------------------------------------------------------------------------

_DATE_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-")


def _strip_date_prefix(name: str) -> str:
    return _DATE_PREFIX_RE.sub("", name)


def _git(repo_root, args: List[str]) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo_root)] + args,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def _ls_tree(repo_root, ref: str, path: str) -> List[Tuple[str, str]]:
    """Non-recursive `git ls-tree <ref> -- <path>`, parsed to (type, name)
    pairs. Returns [] if the path doesn't exist at that ref (git ls-tree
    exits 0 with empty output in that case, not an error)."""
    out = _git(repo_root, ["ls-tree", ref, "--", path])
    entries = []
    for line in out.splitlines():
        if not line.strip():
            continue
        meta, _, name = line.partition("\t")
        parts = meta.split()
        if len(parts) != 3:
            continue
        _mode, typ, _sha = parts
        entries.append((typ, name))
    return entries


def landed_changes(
    repo_root, archive_ref: str = "refs/heads/main"
) -> Tuple[List[LandedChange], str]:
    """Landed openspec changes as of ``archive_ref``, read purely via
    ``git ls-tree`` -- never the working tree.

    A change qualifies as landed when its directory appears directly under
    ``openspec/changes/archive/`` at that ref. Its ``plan_path`` is the
    sibling plan file under ``docs/superpowers/plans/`` whose basename
    (date-prefix stripped) matches the archive dir's (date-prefix stripped)
    name -- the two are typically archived/planned on different dates, so
    only the stripped name is matched, not the literal date prefix.

    Returns the landed changes plus the resolved commit SHA of
    ``archive_ref`` (for ``ingest_log``).
    """
    sha = _git(repo_root, ["rev-parse", archive_ref]).strip()

    archive_entries = _ls_tree(repo_root, archive_ref, "openspec/changes/archive/")
    plan_entries = _ls_tree(repo_root, archive_ref, "docs/superpowers/plans/")

    plan_by_name: Dict[str, str] = {}
    for typ, path in plan_entries:
        if typ != "blob" or not path.endswith(".md"):
            continue
        base = os.path.basename(path)[: -len(".md")]
        plan_by_name.setdefault(_strip_date_prefix(base), path)

    changes: List[LandedChange] = []
    for typ, path in sorted(archive_entries, key=lambda e: e[1]):
        if typ != "tree":
            continue
        base = os.path.basename(path.rstrip("/"))
        name = _strip_date_prefix(base)
        changes.append(
            LandedChange(name=name, archive_path=path, plan_path=plan_by_name.get(name))
        )

    return changes, sha


# --------------------------------------------------------------------------
# classify_role
# --------------------------------------------------------------------------

_SPAWN_TASK_RE = re.compile(r"task[_-]?(\d+)")

_REREVIEW_RE = re.compile(r"re-review|final whole-branch review|final re-review")
_REVIEWER_PROMPT_FILE_RE = re.compile(r"review-prompt\.md")
_REVIEWER_RE = re.compile(
    r"read-only[^\n]{0,40}review|you are reviewing|spec reviewer|"
    r"review the uncommitted|task reviewer|plan reviewer"
)
_IMPLEMENTER_BRIEF_RE = re.compile(r"task-\d+[^\n]*brief\.md")


def _classify_core(p: str) -> str:
    """Mechanical role classification of a lower-cased prompt, ignoring
    spawn_path. Ported from extract_codex.py::classify's final (bug-fixed)
    ordering -- reviewer patterns are checked before the brief-reference
    (implementer) pattern, which is the fix for the historical ordering bug
    where a reviewer prompt that also referenced a task-N-brief.md path
    would misclassify as implementer. Folded to this pipeline's 5-role enum
    (quest-*/smoke/empty variants collapse to "other"; reviewer-rereview
    collapses to "reviewer"); the "auditor" check (ported from
    extract_claude.py::classify) is inserted in the same relative position
    extract_claude.py uses: after the reviewer checks, before the
    implementer check.
    """
    if not p.strip():
        return "other"
    if "final-review verification" in p[:120]:
        return "reviewer"
    if _REVIEWER_PROMPT_FILE_RE.search(p[:300]):
        return "reviewer"
    if "final-fix-prompt" in p[:300]:
        return "fixer"
    if _REREVIEW_RE.search(p[:200]):
        return "reviewer"
    if _REVIEWER_RE.search(p[:300]):
        return "reviewer"
    if "audit" in p[:200]:
        return "auditor"
    if (
        "implementer-prompt" in p
        or "implementation subagent" in p
        or p.startswith("implement task")
        or "codex implementer" in p[:200]
        or _IMPLEMENTER_BRIEF_RE.search(p)
    ):
        return "implementer"
    if (
        "follow-up fix" in p[:120]
        or "spec-review fix" in p[:120]
        or "fix the final verification" in p[:120]
    ):
        return "fixer"
    return "other"


def classify_role(prompt: Optional[str], spawn_path: Optional[str] = None) -> str:
    """implementer | reviewer | fixer | auditor | other."""
    p = (prompt or "").lower()
    role = _classify_core(p)
    if role == "other" and spawn_path and _SPAWN_TASK_RE.search(spawn_path):
        role = "implementer"
    return role


# --------------------------------------------------------------------------
# task_keys
# --------------------------------------------------------------------------

_STOPWORDS = {"at", "in", "the", "for", "owns", "is", "to", "and", "that", "this"}

_BRIEF_PATH_RE = re.compile(
    r"\.superpowers/sdd/(?:([\w-]+)/)?((?:[\w-]+-)?task-\d+)-(?:brief|implementer-prompt)\.md"
)
_OPENSPEC_PATH_RE = re.compile(r"openspec/changes/([\w-]+)\b")
_OPENSPEC_QUOTED_RE = re.compile(r"OpenSpec change [`'\"]?([\w-]+)")
_PLAN_FILE_RE = re.compile(r"(?:docs/superpowers/)?plans/([\w-][\w./-]*\.md)")
_SHEAF_TMP_RE = re.compile(r"/(?:private/)?tmp/(sheaf-[\w-]+)")
_CODEX_WORKTREE_RE = re.compile(r"/\.codex/worktrees/([^/]+)/")
_CLAUDE_WORKTREE_RE = re.compile(r"/\.claude/worktrees/([\w.-]+)")

# task_of's fallbacks (only consulted when the brief-path regex above didn't
# already set "task"), most-specific first.
_REPORT_PATH_RE = re.compile(
    r"\.superpowers/sdd/(?:[\w-]+/)?((?:[\w-]+-)?task-\d+)-"
    r"(?:report|reviewer-prompt|review-package)\.md"
)
_PLAN_TASK_RE = re.compile(r"\bplan[ -](\d+)[, ]+task[ -](\d+)\b", re.I)
_TASK_GROUP_RE = re.compile(r"\btask group (\d+)\b", re.I)
_TASK_N_RE = re.compile(r"\btask[ -](\d+)\b", re.I)


def task_keys(prompt: Optional[str], cwd: Optional[str] = None) -> Dict[str, str]:
    """Extract change/task/worktree identifiers from a prompt (+ cwd).

    Ports ``extract_codex.py``/``extract_claude.py``'s ``task_keys`` (both
    identical) plus ``build_tasks.py``'s ``task_of`` fallbacks for the
    "task" key (``Plan N Task M`` -> ``pN-task-M``, ``task group N`` ->
    ``taskgroup-N``, bare ``task N`` -> ``task-N``), so callers get a single
    dict of everything discoverable from a prompt.
    """
    keys: Dict[str, str] = {}
    p = prompt or ""
    c = cwd or ""

    m = _BRIEF_PATH_RE.search(p)
    if m:
        keys["change_dir"] = m.group(1)
        keys["task"] = m.group(2)

    m = _OPENSPEC_PATH_RE.search(p) or _OPENSPEC_QUOTED_RE.search(p)
    if m and m.group(1) not in _STOPWORDS:
        keys["openspec_change"] = m.group(1)

    m = _PLAN_FILE_RE.search(p)
    if m:
        keys["plan"] = m.group(1)

    m = _SHEAF_TMP_RE.search(p)
    if m and "openspec_change" not in keys:
        keys["openspec_change"] = re.sub(r"^sheaf-", "", m.group(1))

    m = _CODEX_WORKTREE_RE.search(c + " " + p) or _CLAUDE_WORKTREE_RE.search(c + " " + p)
    if m:
        keys["worktree"] = m.group(1)

    if not keys.get("task"):
        m = _REPORT_PATH_RE.search(p)
        if m:
            keys["task"] = m.group(1)
    if not keys.get("task"):
        m = _PLAN_TASK_RE.search(p[:600])
        if m:
            keys["task"] = f"p{m.group(1)}-task-{m.group(2)}"
    if not keys.get("task"):
        m = _TASK_GROUP_RE.search(p[:600])
        if m:
            keys["task"] = f"taskgroup-{m.group(1)}"
    if not keys.get("task"):
        m = _TASK_N_RE.search(p[:600])
        if m:
            keys["task"] = f"task-{m.group(1)}"

    return keys


# --------------------------------------------------------------------------
# assign_review_rounds / canonical_arm
# --------------------------------------------------------------------------


def _get(s: SessionLike, key: str):
    if isinstance(s, Mapping):
        return s.get(key)
    return getattr(s, key, None)


def _output_tokens(s: SessionLike) -> int:
    """``output_tokens`` for a session, however it's shaped.

    ``extractors.SessionRecord`` (and the ``db``/``ingest`` rows built from
    it) carry token counts nested under ``tokens`` (a ``TokenTotals``, or a
    dict once round-tripped through JSON) rather than as a top-level field;
    lightweight test fixtures and joined-session dicts may instead carry a
    flat ``output_tokens``. Check the nested form first, then fall back to
    the flat one, so both shapes work.
    """
    tokens = _get(s, "tokens")
    if tokens is not None:
        if isinstance(tokens, Mapping):
            v = tokens.get("output_tokens")
        else:
            v = getattr(tokens, "output_tokens", None)
        if v is not None:
            return v
    return _get(s, "output_tokens") or 0


def _reviewer_boundaries(s: SessionLike) -> List[str]:
    """All review boundaries one reviewer session contributes.

    followup-4 (design.md D5 amendment): the workflow now deliberately keeps
    reviewer sessions open across review + re-review, so a single session
    can carry more than one verdict. If ``s`` exposes a non-empty
    ``verdict_boundaries`` (a list of ISO timestamps -- one per detected
    verdict turn, see ``extractors.Turn.is_verdict``), every one of them is
    a boundary. Otherwise -- a session with no recoverable turn/verdict
    data, or a genuinely single-verdict session -- this falls back to the
    session's own ``ended_at`` (or ``started_at`` if aborted), exactly the
    single-boundary-per-session behavior this replaces. Callers needing
    only the parsed value (not the DB's raw ``verdict_boundaries_json``
    column) are responsible for parsing it first -- see
    ``costs.py``'s session-dict transform."""
    vb = _get(s, "verdict_boundaries")
    if vb:
        return list(vb)
    return [_get(s, "ended_at") or _get(s, "started_at") or ""]


def review_boundaries(sessions: List[SessionLike]) -> List[str]:
    """Every review boundary for a task's sessions, sorted ascending -- the
    union of each ``reviewer`` session's own boundaries (see
    ``_reviewer_boundaries``). Used both by ``assign_review_rounds`` (to
    number non-reviewer sessions) and by ``costs.py`` (to split a spanning
    round-0 implementer session's turns at the first boundary -- design.md
    D5 amendment, followup-4). Sorted by parsed timestamp value
    (``parse_timestamp``), never raw string order (fix-round-1 review,
    finding 3) -- the returned list is still plain ISO strings, just in the
    correct chronological order."""
    return sorted(
        (
            b
            for s in sessions
            if _get(s, "role") == "reviewer"
            for b in _reviewer_boundaries(s)
        ),
        key=parse_timestamp,
    )


def assign_review_rounds(sessions: List[SessionLike]) -> Dict[str, int]:
    """Per design D5 (amended followup-4): a review boundary is either a
    reviewer session's detected per-verdict timestamp(s) or, absent those,
    its ``ended_at`` -- see ``review_boundaries``/``_reviewer_boundaries``.
    Implementer/fixer (and any other non-reviewer) sessions get
    ``review_round`` = the count of boundaries strictly before their
    ``started_at`` (so sessions starting before the first review are round
    0, the first follow-up is round 1, ...). A reviewer session itself gets
    the round its own (last) boundary opens -- the count of ALL boundaries
    at or before its own ``ended_at`` (so the first reviewer opens round 1,
    the second round 2, ...; a persistent reviewer producing verdicts for
    rounds 1 and 2 in one session is counted at round 2, its own final
    state). Sessions with no ``ended_at`` (aborted) still get numbered,
    using ``started_at`` as their boundary contribution. Sessions without
    turn/verdict data behave exactly as before this amendment (single
    boundary per reviewer session) -- this is a strict generalization, not
    a behavior change, for that case.
    """
    boundaries = review_boundaries(sessions)
    boundary_dts = [parse_timestamp(b) for b in boundaries]

    rounds: Dict[str, int] = {}
    for s in sessions:
        sid = _get(s, "session_id")
        started = parse_timestamp(_get(s, "started_at"))
        if _get(s, "role") == "reviewer":
            ended = parse_timestamp(_get(s, "ended_at")) if _get(s, "ended_at") else started
            rounds[sid] = sum(1 for b in boundary_dts if b <= ended)
        else:
            rounds[sid] = sum(1 for b in boundary_dts if b < started)
    return rounds


def canonical_arm(
    sessions: List[SessionLike],
) -> Tuple[Optional[str], Optional[str], Dict[str, Any]]:
    """The canonical (model, effort) arm for a task: the round-0 implementer
    session with the greatest ``output_tokens`` (read via ``_output_tokens``,
    so both a flat ``output_tokens`` field and a real
    ``extractors.SessionRecord``'s nested ``tokens.output_tokens`` work).
    Other round-0 implementer sessions (if any) are recorded as alternates in
    ``basis``.
    """
    rounds = assign_review_rounds(sessions)
    round0_impl = [
        s
        for s in sessions
        if _get(s, "role") == "implementer" and rounds.get(_get(s, "session_id")) == 0
    ]
    if not round0_impl:
        return None, None, {"session_id": None, "output_tokens": None, "alternates": []}

    round0_impl.sort(key=_output_tokens, reverse=True)
    chosen, *rest = round0_impl

    basis = {
        "session_id": _get(chosen, "session_id"),
        "output_tokens": _output_tokens(chosen),
        "alternates": [
            {
                "session_id": _get(s, "session_id"),
                "model": _get(s, "model"),
                "effort": _get(s, "effort"),
                "output_tokens": _output_tokens(s),
            }
            for s in rest
        ],
    }
    return _get(chosen, "model"), _get(chosen, "effort"), basis
