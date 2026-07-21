"""Idempotent ingest driver for the SDD task-analyzer pipeline (design.md D3).

Owns the join algorithm discovery.py deliberately left out: given a set of
landed changes (discovery.landed_changes), find their SDD task briefs and
match session transcripts to tasks, quarantining ambiguous joins rather than
guessing (discovery.Quarantine). Two public entry points:

- ``plan_work(conn, repo_root) -> WorkPlan``: a pure, read-only survey of
  what a real run would do -- new changes/tasks/sessions to ingest, and
  agentic gaps (missing complexity/grades/phase-label rows), each carrying
  the cache-key reason it's a gap and whether a staged file already
  satisfies it.
- ``run(conn, repo_root, *, dry_run, no_agents, rescore, agent_runner) ->
  RunReport``: executes the plan. Each task's mechanical rows (task row +
  its sessions) and agentic rows are written in one SQLite transaction --
  a crash rolls the whole task back, and the next run resumes from
  whatever was already staged to disk (D3's crash-resume contract).

Directory conventions owned by this module (not fixed elsewhere):

- Task briefs for a landed change ``<name>`` live at
  ``.superpowers/sdd/<name>/<task_key>-brief.md``, read via
  ``git ls-tree -r``/``git show`` at the *resolved commit SHA* of the
  archive ref (never the filesystem/working tree -- D3 requires discovery
  to be a pure diff against a landed git ref, and that applies to brief
  content too, not just which changes/tasks exist: a brief edited or added
  only in the working tree must not affect ingestion). ``<task_key>`` is
  whatever precedes ``-brief.md`` and looks like a task key (``task-N``,
  ``pM-task-N``, ...); files like ``task-N-review-brief.md`` are not task
  briefs and are skipped. This assumes the SDD directory name equals the
  openspec change name -- a simplifying assumption for new changes going
  forward; the historical corpus (differently-named SDD dirs, e.g. this
  very change's own ``.superpowers/sdd/task-analyzer/``) is Task 8's
  migration script's problem, not this one's.
- Session transcripts are discovered from two corpora, independent of
  ``repo_root`` (a change's sessions accumulate across every worktree
  checkout, never just whichever one happens to be on disk right now):
  codex rollouts under ``codex_sessions_root`` (default
  ``~/.codex/sessions``, glob ``**/rollout-*.jsonl``) and claude project
  transcripts under ``claude_projects_root`` (default
  ``~/.claude/projects``, glob ``**/*.jsonl``). Both roots are overridable
  keyword arguments (tests point them at fixture directories).
- A session joins a task when ``discovery.task_keys(session.prompt)``
  yields a ``task`` key matching exactly one brief's task_key among the
  briefs whose ``change_dir`` (or ``openspec_change``) equals a change
  being processed this run; sessions whose task key matches more than one
  candidate are quarantined (``task_id`` left NULL, never guessed);
  sessions with no task key at all are not part of any task and are
  skipped (not stored) -- they're irrelevant chatter, not ambiguous joins.

Agentic dispatch contract (for Task 7's real ``agent_runner``): ``kind`` is
one of ``complexity`` / ``grading`` / ``phase_labeling`` (matching the
prompt asset basenames, hyphen for phase-labeling: ``prompts/complexity.md``,
``prompts/grading.md``, ``prompts/phase-labeling.md``). ``agent_runner`` is
called as ``agent_runner(kind, items, staging_dir)`` where ``items`` is a
list of plain dicts, one per gap needing dispatch (already filtered to
exclude gaps already satisfied by a valid staged file). ``task_key``/
``session_key`` below is the *qualified* cache-key entity (``"<change>--
<task_key>"`` for complexity/grading, the full ``provider:native-id`` for
phase_labeling) -- i.e. exactly ``GapItem.entity_key`` -- not the bare task
key, since staging filenames must be unique across changes that reuse the
same task numbering:

- complexity: ``{"task_key", "version", "input_sha256", "brief_text"}``
- grading:    ``{"task_key", "version", "input_sha256", "review_text"}``
- phase_labeling: ``{"session_key", "version", "input_sha256", "timeline"}``

The callable is expected to write valid staged JSON files (design.md D3's
``staging/<kind>/<entity_key>__v<version>__<sha256[:12]>.json``, atomic
tmp+rename) for whichever items it manages to score, and return the list of
paths it wrote; ``ingest.py`` re-reads staging afterwards rather than
trusting the return value's completeness, so partial batches (a crash
partway through) still get picked up correctly.

Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import assets
import db
import discovery
import extractors

_ROOT = Path(__file__).resolve().parent
DEFAULT_STAGING_DIR = _ROOT / "staging"
DEFAULT_CODEX_SESSIONS_ROOT = Path("~/.codex/sessions").expanduser()
DEFAULT_CLAUDE_PROJECTS_ROOT = Path("~/.claude/projects").expanduser()

# kind (agent-dispatch vocabulary, Task 7) -> table name
KIND_TABLE = {"complexity": "complexity", "grading": "grades", "phase_labeling": "phase_tokens"}
# kind -> rubric/taxonomy asset path (current-version source of truth)
KIND_RUBRIC_PATH = {
    "complexity": _ROOT / "rubrics" / "complexity.md",
    "grading": _ROOT / "rubrics" / "grading.md",
    "phase_labeling": _ROOT / "rubrics" / "phase-taxonomy.md",
}
# kind -> the version column name in that kind's table
KIND_VERSION_COLUMN = {
    "complexity": "rubric_version",
    "grading": "rubric_version",
    "phase_labeling": "taxonomy_version",
}
# kind -> prompt asset basename (note the hyphen for phase-labeling, unlike
# the underscore "kind" vocabulary itself).
KIND_PROMPT_NAME = {"complexity": "complexity", "grading": "grading", "phase_labeling": "phase-labeling"}
# kind -> required top-level keys of a valid staged JSON file for that kind.
KIND_REQUIRED_KEYS = {
    "complexity": {"task_key", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "composite", "rationale"},
    "grading": {
        "task_key", "G1", "G2", "G3", "G4", "G5", "n_critical", "n_important", "n_minor",
        "verdict_sequence", "rounds_to_accept", "final_grade", "evidence",
        "reviewer_models", "excluded_reviews",
    },
    "phase_labeling": {"session_key", "labels"},
}

REASON_MISSING = "missing"
REASON_INPUT_CHANGED = "input_changed"
REASON_STALE_VERSION = "stale_version"


# --------------------------------------------------------------------------
# Public data shapes
# --------------------------------------------------------------------------


@dataclass
class GapItem:
    """One agentic cache-miss: entity ``entity_key`` (a task_key-qualified
    string for complexity/grading, or a full ``provider:native-id`` session
    id for phase_labeling) needs (re-)scoring at ``version`` because
    ``reason`` (one of the ``REASON_*`` constants). ``staged_path`` is set
    when a valid staged file already satisfies this exact cache key --
    ``run`` will use it instead of dispatching."""

    entity_key: str
    kind: str
    version: str
    input_sha256: str
    reason: str
    stale_versions: List[str] = field(default_factory=list)
    staged_path: Optional[str] = None

    @property
    def staging_satisfied(self) -> bool:
        return self.staged_path is not None


@dataclass
class WorkPlan:
    """Pure survey of what a real run would do. See module docstring."""

    ref_sha: str
    new_changes: List[str] = field(default_factory=list)
    new_tasks: List[str] = field(default_factory=list)  # "<change>/<task_key>"
    new_sessions: List[str] = field(default_factory=list)  # "provider:native-id"
    missing_complexity: List[GapItem] = field(default_factory=list)
    missing_grades: List[GapItem] = field(default_factory=list)
    missing_phase_labels: List[GapItem] = field(default_factory=list)
    quarantined: List[Any] = field(default_factory=list)  # discovery.Quarantine
    unlanded: List[str] = field(default_factory=list)

    def is_empty(self) -> bool:
        return not (
            self.new_changes
            or self.new_tasks
            or self.new_sessions
            or self.missing_complexity
            or self.missing_grades
            or self.missing_phase_labels
            or self.quarantined
        )


@dataclass
class RunReport:
    ref_sha: str
    dry_run: bool
    changes_written: int = 0
    tasks_written: int = 0
    sessions_written: int = 0
    rows_written: Dict[str, int] = field(default_factory=dict)  # kind -> upserted count
    dispatched: Dict[str, int] = field(default_factory=dict)  # kind -> agent_runner calls
    staged_used: Dict[str, int] = field(default_factory=dict)  # kind -> satisfied from staging
    stale: Dict[str, int] = field(default_factory=dict)  # kind -> stale, not rescored this run
    quarantined: List[Any] = field(default_factory=list)
    unlanded: List[str] = field(default_factory=list)
    plan: Optional[WorkPlan] = None

    @property
    def total_writes(self) -> int:
        return (
            self.changes_written
            + self.tasks_written
            + self.sessions_written
            + sum(self.rows_written.values())
        )


# --------------------------------------------------------------------------
# Internal discovery/join (shared by plan_work and run)
# --------------------------------------------------------------------------


@dataclass
class _JoinedSession:
    rec: Any  # extractors.SessionRecord
    provider: str
    role: str
    change_name: str
    task_key: str
    review_round: int = 0

    @property
    def session_id(self) -> str:
        return f"{self.provider}:{self.rec.session_id}"


@dataclass
class _Discovery:
    ref_sha: str
    repo_root: Any
    changes: List[Any]  # discovery.LandedChange, in scope for this run
    unlanded: List[str]
    briefs: Dict[Tuple[str, str], str]  # (change_name, task_key) -> git-relative brief path
    joined: Dict[Tuple[str, str], List[_JoinedSession]]  # (change_name, task_key) -> sessions
    quarantined: List[Any]  # discovery.Quarantine, same order as quarantined_sessions
    quarantined_sessions: List[_JoinedSession]  # task_key/change_name are "" (unjoined)


_TASK_KEY_RE = re.compile(r"(?:[a-z0-9]+-)?task-\d+$")


def _brief_task_key(stem: str) -> Optional[str]:
    """``stem`` is a brief filename with ``-brief.md``/``-implementer-prompt.md``
    already stripped. Returns the task key if ``stem`` looks like one
    (``task-N`` or ``<prefix>-task-N``), else None (filters out siblings
    like ``task-1-review-brief.md`` whose stem is ``task-1-review``)."""
    if _TASK_KEY_RE.fullmatch(stem):
        return stem
    return None


def _git(repo_root, args: List[str]) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo_root)] + args, capture_output=True, text=True, check=True,
    )
    return result.stdout


def _git_ls_tree_r(repo_root, sha: str, path: str) -> List[str]:
    """Recursive `git ls-tree -r <sha> -- <path>`, blob paths only (full
    repo-relative paths, since -r already expands directories). Empty list
    if the path doesn't exist at that ref (git exits 0 with empty output,
    not an error) -- same convention as discovery._ls_tree."""
    out = _git(repo_root, ["ls-tree", "-r", sha, "--", path])
    paths = []
    for line in out.splitlines():
        if not line.strip():
            continue
        meta, _, name = line.partition("\t")
        parts = meta.split()
        if len(parts) != 3:
            continue
        _mode, typ, _blob_sha = parts
        if typ == "blob":
            paths.append(name)
    return paths


def _git_show(repo_root, sha: str, path: str) -> str:
    """Read a file's content at a specific commit -- never the working
    tree (D3: discovery, including brief content, is a pure diff against a
    landed git ref)."""
    return _git(repo_root, ["show", f"{sha}:{path}"])


def _iter_briefs(repo_root, ref_sha: str, change_name: str) -> List[Tuple[str, str]]:
    """Task briefs for `change_name`, read via git ls-tree at `ref_sha` --
    never the filesystem, so a brief added or edited only in the working
    tree (not committed/landed) is invisible here."""
    prefix = f".superpowers/sdd/{change_name}/"
    out = []
    for path in sorted(_git_ls_tree_r(repo_root, ref_sha, prefix)):
        name = Path(path).name
        for suffix in ("-brief.md", "-implementer-prompt.md"):
            if name.endswith(suffix):
                stem = name[: -len(suffix)]
                task_key = _brief_task_key(stem)
                if task_key:
                    out.append((task_key, path))
                break
    return out


def _iter_session_files(codex_root, claude_root) -> List[Tuple[str, Path]]:
    files: List[Tuple[str, Path]] = []
    if codex_root and Path(codex_root).is_dir():
        for p in sorted(Path(codex_root).glob("**/rollout-*.jsonl")):
            files.append(("codex", p))
    if claude_root and Path(claude_root).is_dir():
        for p in sorted(Path(claude_root).glob("**/*.jsonl")):
            files.append(("claude", p))
    return files


def _extract(provider: str, path: Path):
    if provider == "codex":
        return extractors.extract_codex(path)
    return extractors.extract_claude(path)


def _discover(
    conn,
    repo_root,
    *,
    archive_ref: str = "refs/heads/main",
    change: Optional[str] = None,
    codex_sessions_root=None,
    claude_projects_root=None,
) -> _Discovery:
    landed, ref_sha = discovery.landed_changes(repo_root, archive_ref=archive_ref)
    landed_by_name = {c.name: c for c in landed}

    unlanded: List[str] = []
    if change is not None:
        if change not in landed_by_name:
            unlanded.append(change)
            changes_in_scope = []
        else:
            changes_in_scope = [landed_by_name[change]]
    else:
        changes_in_scope = list(landed)

    briefs: Dict[Tuple[str, str], str] = {}
    brief_index: Dict[str, List[str]] = {}  # task_key -> [change_name, ...]
    for c in changes_in_scope:
        for task_key, path in _iter_briefs(repo_root, ref_sha, c.name):
            briefs[(c.name, task_key)] = path
            brief_index.setdefault(task_key, []).append(c.name)

    codex_root = codex_sessions_root if codex_sessions_root is not None else DEFAULT_CODEX_SESSIONS_ROOT
    claude_root = claude_projects_root if claude_projects_root is not None else DEFAULT_CLAUDE_PROJECTS_ROOT

    joined: Dict[Tuple[str, str], List[_JoinedSession]] = {}
    quarantined: List[Any] = []
    quarantined_sessions: List[_JoinedSession] = []

    for provider, path in _iter_session_files(codex_root, claude_root):
        try:
            rec = _extract(provider, path)
        except Exception:
            continue

        keys = discovery.task_keys(rec.prompt)
        task_key = keys.get("task")
        if not task_key:
            continue  # no task reference at all -- not part of this pipeline

        change_dir = keys.get("change_dir") or keys.get("openspec_change")
        candidates = brief_index.get(task_key, [])
        if change_dir:
            candidates = [c for c in candidates if c == change_dir]

        role = discovery.classify_role(rec.prompt, rec.spawn_path)

        if len(candidates) == 0:
            continue  # no known brief for this key -- irrelevant, not ambiguous
        if len(candidates) > 1:
            quarantined.append(
                discovery.Quarantine(
                    session_id=f"{provider}:{rec.session_id}",
                    reason="task key matches >1 task",
                    candidates=sorted(f"{c}/{task_key}" for c in candidates),
                )
            )
            # Still recorded mechanically -- task_id NULL, never a guessed
            # join (design.md's Quarantine contract).
            quarantined_sessions.append(
                _JoinedSession(rec=rec, provider=provider, role=role, change_name="", task_key="")
            )
            continue

        change_name = candidates[0]
        joined.setdefault((change_name, task_key), []).append(
            _JoinedSession(rec=rec, provider=provider, role=role, change_name=change_name, task_key=task_key)
        )

    # Assign review_round per task group (design D5), mechanical.
    for key, sessions in joined.items():
        round_map = discovery.assign_review_rounds(_with_role(sessions))
        for js in sessions:
            js.review_round = round_map.get(js.rec.session_id, 0)

    return _Discovery(
        ref_sha=ref_sha,
        repo_root=repo_root,
        changes=changes_in_scope,
        unlanded=unlanded,
        briefs=briefs,
        joined=joined,
        quarantined=quarantined,
        quarantined_sessions=quarantined_sessions,
    )


def _with_role(sessions: List[_JoinedSession]):
    """assign_review_rounds reads `.role`/`.started_at`/etc via getattr; bolt
    `role` onto each SessionRecord so it can be passed directly."""
    out = []
    for js in sessions:
        js.rec.role = js.role
        out.append(js)
    return [js.rec for js in out]


def _review_text(rec) -> str:
    if rec.last_message:
        return rec.last_message
    lines = []
    for t in rec.turns:
        for item in t.items:
            if item.startswith("SAY:"):
                lines.append(item[len("SAY:"):].strip())
    return "\n".join(lines)


# --------------------------------------------------------------------------
# Cache-key gap computation (read-only; shared by plan_work and run)
# --------------------------------------------------------------------------


def _existing_task_id(conn, change_name: str, task_key: str) -> Optional[int]:
    row = conn.execute(
        "SELECT t.task_id FROM tasks t JOIN changes c ON c.change_id = t.change_id "
        "WHERE c.name = ? AND t.task_key = ?",
        (change_name, task_key),
    ).fetchone()
    return row[0] if row else None


def _version_int(v: str) -> int:
    """Versions are integer strings, compared numerically (design.md: "the
    row with the numerically greatest version" is current) -- never
    lexicographically (``"10" < "2"`` as strings, but 10 > 2 as versions).
    Non-numeric input sorts as always-oldest rather than raising, since this
    is used for sorting/reporting, not as a hard schema guarantee."""
    try:
        return int(v)
    except (TypeError, ValueError):
        return -1


def _current_and_stale(conn, table: str, version_col: str, id_col: str, id_val, current_version: str):
    rows = conn.execute(
        f'SELECT "{version_col}", input_sha256 FROM "{table}" WHERE "{id_col}" = ?',
        (id_val,),
    ).fetchall()
    current_target = _version_int(current_version)
    current_hash = None
    stale: List[str] = []
    for row in rows:
        v, h = row[0], row[1]
        if _version_int(v) == current_target:
            current_hash = h
        elif v not in stale:
            stale.append(v)
    stale.sort(key=_version_int)
    return current_hash, stale


def _staging_filename(entity_key: str, version: str, input_sha256: str) -> str:
    return f"{entity_key}__v{version}__{input_sha256[:12]}.json"


def _validate_staged(kind: str, data: Any, n_turns: Optional[int] = None) -> bool:
    if not isinstance(data, dict):
        return False
    if not KIND_REQUIRED_KEYS[kind].issubset(data.keys()):
        return False
    if kind == "phase_labeling":
        labels = data.get("labels")
        if not isinstance(labels, dict) or not labels:
            return False
        if n_turns is not None:
            for i in range(1, n_turns + 1):
                if str(i) not in labels:
                    return False
    return True


def _check_staged(staging_dir, kind: str, entity_key: str, version: str, input_sha256: str, n_turns=None):
    """Returns (valid_path_or_None, data_or_None, exists: bool)."""
    fname = _staging_filename(entity_key, version, input_sha256)
    path = Path(staging_dir) / kind / fname
    if not path.exists():
        return None, None, False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None, None, True
    if not _validate_staged(kind, data, n_turns=n_turns):
        return None, None, True
    return path, data, True


def _entity_key(change_name: str, task_key: str) -> str:
    return f"{change_name}--{task_key}"


def _gap_for(conn, kind: str, entity_key: str, id_col: str, id_val, input_text: str) -> Optional[GapItem]:
    version = assets.read_asset_version(KIND_RUBRIC_PATH[kind])
    input_sha256 = db.sha256_text(input_text)
    if id_val is None:
        return GapItem(entity_key=entity_key, kind=kind, version=version, input_sha256=input_sha256, reason=REASON_MISSING)

    current_hash, stale = _current_and_stale(conn, KIND_TABLE[kind], KIND_VERSION_COLUMN[kind], id_col, id_val, version)
    if current_hash == input_sha256:
        return None
    if current_hash is not None:
        return GapItem(entity_key=entity_key, kind=kind, version=version, input_sha256=input_sha256, reason=REASON_INPUT_CHANGED)
    if stale:
        return GapItem(
            entity_key=entity_key, kind=kind, version=version, input_sha256=input_sha256,
            reason=REASON_STALE_VERSION, stale_versions=stale,
        )
    return GapItem(entity_key=entity_key, kind=kind, version=version, input_sha256=input_sha256, reason=REASON_MISSING)


def _compute_gaps(conn, disc: _Discovery, staging_dir):
    """Returns (missing_complexity, missing_grades, missing_phase_labels), each
    a list of GapItem, `staged_path` filled in where a valid staged file
    already satisfies the exact cache key."""
    complexity_gaps: List[GapItem] = []
    grading_gaps: List[GapItem] = []
    phase_gaps: List[GapItem] = []

    for (change_name, task_key), brief_path in disc.briefs.items():
        task_id = _existing_task_id(conn, change_name, task_key)
        brief_text = _git_show(disc.repo_root, disc.ref_sha, brief_path)
        ekey = _entity_key(change_name, task_key)

        gap = _gap_for(conn, "complexity", ekey, "task_id", task_id, brief_text)
        if gap:
            complexity_gaps.append(gap)

        sessions = disc.joined.get((change_name, task_key), [])
        reviewer_sessions = sorted(
            (js for js in sessions if js.role == "reviewer"), key=lambda j: j.rec.started_at or ""
        )
        if reviewer_sessions:
            review_text = "\n\n---\n\n".join(_review_text(js.rec) for js in reviewer_sessions)
            gap = _gap_for(conn, "grading", ekey, "task_id", task_id, review_text)
            if gap:
                grading_gaps.append(gap)

        for js in sessions:
            if js.role != "implementer" or js.review_round != 0:
                continue
            timeline = extractors.render_timeline(js.rec)
            gap = _gap_for(conn, "phase_labeling", js.session_id, "session_id", js.session_id if _session_exists(conn, js.session_id) else None, timeline)
            if gap:
                gap._n_turns = js.rec.n_turns
                phase_gaps.append(gap)

    for gaps, kind in ((complexity_gaps, "complexity"), (grading_gaps, "grading"), (phase_gaps, "phase_labeling")):
        for g in gaps:
            n_turns = getattr(g, "_n_turns", None)
            path, _data, _exists = _check_staged(staging_dir, kind, g.entity_key, g.version, g.input_sha256, n_turns=n_turns)
            g.staged_path = str(path) if path else None

    return complexity_gaps, grading_gaps, phase_gaps


def _session_exists(conn, session_id: str) -> bool:
    row = conn.execute("SELECT 1 FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
    return row is not None


# --------------------------------------------------------------------------
# plan_work
# --------------------------------------------------------------------------


def plan_work(
    conn,
    repo_root,
    *,
    archive_ref: str = "refs/heads/main",
    change: Optional[str] = None,
    staging_dir=None,
    codex_sessions_root=None,
    claude_projects_root=None,
) -> WorkPlan:
    """Pure, read-only survey of what a real run would do. Never writes to
    ``conn`` or the filesystem (a valid-but-invalid staged file is reported
    as a to-dispatch gap, not renamed -- that happens in ``run``)."""
    staging_dir = staging_dir if staging_dir is not None else DEFAULT_STAGING_DIR
    disc = _discover(
        conn, repo_root, archive_ref=archive_ref, change=change,
        codex_sessions_root=codex_sessions_root, claude_projects_root=claude_projects_root,
    )
    return _plan_from_disc(conn, disc, staging_dir)


def _plan_from_disc(conn, disc: _Discovery, staging_dir) -> WorkPlan:
    existing_change_names = {
        r[0] for r in conn.execute("SELECT name FROM changes").fetchall()
    }
    new_changes = [c.name for c in disc.changes if c.name not in existing_change_names]

    new_tasks: List[str] = []
    for (change_name, task_key) in disc.briefs:
        if _existing_task_id(conn, change_name, task_key) is None:
            new_tasks.append(f"{change_name}/{task_key}")

    existing_session_ids = {
        r[0] for r in conn.execute("SELECT session_id FROM sessions").fetchall()
    }
    new_sessions = [
        js.session_id
        for sessions in disc.joined.values()
        for js in sessions
        if js.session_id not in existing_session_ids
    ] + [
        js.session_id for js in disc.quarantined_sessions if js.session_id not in existing_session_ids
    ]

    complexity_gaps, grading_gaps, phase_gaps = _compute_gaps(conn, disc, staging_dir)

    return WorkPlan(
        ref_sha=disc.ref_sha,
        new_changes=sorted(new_changes),
        new_tasks=sorted(new_tasks),
        new_sessions=sorted(new_sessions),
        missing_complexity=complexity_gaps,
        missing_grades=grading_gaps,
        missing_phase_labels=phase_gaps,
        quarantined=disc.quarantined,
        unlanded=disc.unlanded,
    )


# --------------------------------------------------------------------------
# run
# --------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


_TABLE_TO_KIND = {table: kind for kind, table in KIND_TABLE.items()}


def _normalize_rescore(rescore) -> Set[str]:
    """``--rescore`` takes real table names (``complexity``/``grades``/
    ``phase_tokens``, per the CLI contract); translate to the internal
    ``kind`` vocabulary (``complexity``/``grading``/``phase_labeling``) that
    gap-processing compares against. Also accepts a bare ``kind`` string
    directly, so callers (and tests) can use either spelling."""
    if not rescore:
        return set()
    values = {rescore} if isinstance(rescore, str) else set(rescore)
    return {_TABLE_TO_KIND.get(v, v) for v in values}


def _upsert_change(conn, name: str):
    db.upsert(conn, "changes", {"name": name, "ingested_at": _now_iso()}, ["name"])


def _get_change_id(conn, name: str) -> int:
    return conn.execute("SELECT change_id FROM changes WHERE name = ?", (name,)).fetchone()[0]


def _upsert_task(conn, change_id: int, task_key: str, brief_path: str, brief_text: str) -> int:
    row = {
        "change_id": change_id,
        "task_key": task_key,
        "brief_path": str(brief_path),
        "brief_sha256": db.sha256_text(brief_text),
        "brief_bytes": len(brief_text.encode("utf-8")),
        "brief_text": brief_text,
    }
    db.upsert(conn, "tasks", row, ["change_id", "task_key"])
    return conn.execute(
        "SELECT task_id FROM tasks WHERE change_id = ? AND task_key = ?", (change_id, task_key)
    ).fetchone()[0]


def _upsert_session(conn, task_id: Optional[int], js: _JoinedSession):
    rec = js.rec
    row = {
        "session_id": js.session_id,
        "task_id": task_id,
        "provider": rec.provider,
        "harness_entry": rec.harness_entry,
        "role": js.role,
        "model": rec.model,
        "effort": rec.effort,
        "started_at": rec.started_at,
        "ended_at": rec.ended_at,
        "transcript_path": None,
        "input_tokens": rec.tokens.input_tokens,
        "cached_tokens": rec.tokens.cached_tokens,
        "output_tokens": rec.tokens.output_tokens,
        "reasoning_tokens": rec.tokens.reasoning_tokens,
        "peak_context": rec.peak_context,
        "n_compactions": rec.n_compactions,
        "n_turns": rec.n_turns,
        "n_tool_calls": rec.n_tool_calls,
        "review_round": js.review_round,
    }
    db.upsert(conn, "sessions", row, ["session_id"])


def _upsert_complexity(conn, task_id: int, gap: GapItem, data: dict, scored_by: str):
    row = {
        "task_id": task_id,
        "c1": data["C1"], "c2": data["C2"], "c3": data["C3"], "c4": data["C4"],
        "c5": data["C5"], "c6": data["C6"], "c7": data["C7"],
        "composite": data["composite"],
        "rationale_json": json.dumps(data.get("rationale", {}), sort_keys=True),
        "rubric_version": gap.version,
        "input_sha256": gap.input_sha256,
        "scored_by": scored_by,
    }
    db.upsert(conn, "complexity", row, ["task_id", "rubric_version"])


def _upsert_grade(conn, task_id: int, gap: GapItem, data: dict, review_text: str, scored_by: str):
    row = {
        "task_id": task_id,
        "g1": data["G1"], "g2": data["G2"], "g3": data["G3"], "g4": data["G4"], "g5": data["G5"],
        "n_critical": data["n_critical"], "n_important": data["n_important"], "n_minor": data["n_minor"],
        "rounds_to_accept": data["rounds_to_accept"],
        "verdict_sequence_json": json.dumps(data.get("verdict_sequence")),
        "final_grade": data["final_grade"],
        "evidence_json": json.dumps(data.get("evidence")),
        "excluded_reviews_json": json.dumps(data.get("excluded_reviews", [])),
        "review_text": review_text,
        "rubric_version": gap.version,
        "input_sha256": gap.input_sha256,
        "scored_by": scored_by,
    }
    db.upsert(conn, "grades", row, ["task_id", "rubric_version"])


def _upsert_phase_tokens(conn, session_id: str, rec, gap: GapItem, data: dict, scored_by: str):
    labels: Dict[str, str] = data["labels"]
    agg: Dict[str, Dict[str, int]] = {}
    for turn in rec.turns:
        phase = labels.get(str(turn.index), "other")
        bucket = agg.setdefault(phase, {"output_tokens": 0, "turns": 0})
        bucket["output_tokens"] += turn.output_tokens
        bucket["turns"] += 1
    for phase, totals in agg.items():
        row = {
            "session_id": session_id,
            "phase": phase,
            "output_tokens": totals["output_tokens"],
            "turns": totals["turns"],
            "taxonomy_version": gap.version,
            "input_sha256": gap.input_sha256,
            "scored_by": scored_by,
        }
        db.upsert(conn, "phase_tokens", row, ["session_id", "phase", "taxonomy_version"])


def _scored_by_for(kind: str) -> str:
    try:
        _text, _version, model_hint = assets.load_prompt(KIND_PROMPT_NAME[kind])
        return model_hint
    except (OSError, ValueError):
        return "unknown"


def _resolve_gap(conn, staging_dir, kind: str, gap: GapItem, agent_runner, no_agents: bool, rescore_set: Set[str], report: RunReport, item_builder) -> bool:
    """Ensure `gap` is satisfied (dispatching if needed), returning True if a
    row was upserted for it this call. Mutates `report`'s dispatched/staged_used/
    stale counters. Does not commit -- caller owns the transaction."""
    if gap.reason == REASON_STALE_VERSION and kind not in rescore_set:
        report.stale[kind] = report.stale.get(kind, 0) + 1
        return False

    if no_agents:
        return False

    n_turns = getattr(gap, "_n_turns", None)
    path, data, exists = _check_staged(staging_dir, kind, gap.entity_key, gap.version, gap.input_sha256, n_turns=n_turns)

    if path is None and exists:
        # Invalid staged file for this exact cache key -- quarantine it and
        # fall through to dispatch.
        bad = Path(staging_dir) / kind / _staging_filename(gap.entity_key, gap.version, gap.input_sha256)
        bad.rename(bad.with_name(bad.name + ".err"))

    if path is None:
        if agent_runner is None:
            raise RuntimeError(f"agentic gap for {kind}/{gap.entity_key} but no agent_runner was provided")
        item = item_builder()
        agent_runner(kind, [item], Path(staging_dir))
        report.dispatched[kind] = report.dispatched.get(kind, 0) + 1
        path, data, exists = _check_staged(staging_dir, kind, gap.entity_key, gap.version, gap.input_sha256, n_turns=n_turns)
        if path is None:
            raise RuntimeError(f"agent_runner did not produce a valid staged file for {kind}/{gap.entity_key}")
    else:
        report.staged_used[kind] = report.staged_used.get(kind, 0) + 1

    scored_by = _scored_by_for(kind)
    if kind == "complexity":
        # entity_key is "<change>--<task_key>"; resolve via change name join.
        change_name, task_key = gap.entity_key.split("--", 1)
        task_id = _existing_task_id(conn, change_name, task_key)
        _upsert_complexity(conn, task_id, gap, data, scored_by)
    elif kind == "grading":
        change_name, task_key = gap.entity_key.split("--", 1)
        task_id = _existing_task_id(conn, change_name, task_key)
        _upsert_grade(conn, task_id, gap, data, item_builder.review_text if hasattr(item_builder, "review_text") else "", scored_by)
    else:
        rec = item_builder.rec
        _upsert_phase_tokens(conn, gap.entity_key, rec, gap, data, scored_by)

    report.rows_written[kind] = report.rows_written.get(kind, 0) + 1
    return True


def run(
    conn,
    repo_root,
    *,
    dry_run: bool = False,
    no_agents: bool = False,
    rescore=None,
    agent_runner=None,
    archive_ref: str = "refs/heads/main",
    change: Optional[str] = None,
    staging_dir=None,
    codex_sessions_root=None,
    claude_projects_root=None,
) -> RunReport:
    staging_dir = Path(staging_dir) if staging_dir is not None else DEFAULT_STAGING_DIR
    rescore_set = _normalize_rescore(rescore)

    disc = _discover(
        conn, repo_root, archive_ref=archive_ref, change=change,
        codex_sessions_root=codex_sessions_root, claude_projects_root=claude_projects_root,
    )
    plan = _plan_from_disc(conn, disc, staging_dir)

    report = RunReport(
        ref_sha=disc.ref_sha, dry_run=dry_run, plan=plan,
        quarantined=disc.quarantined, unlanded=disc.unlanded,
    )

    if dry_run:
        return report

    for staging_kind_dir in KIND_TABLE:
        (staging_dir / staging_kind_dir).mkdir(parents=True, exist_ok=True)

    for change_name in plan.new_changes:
        _upsert_change(conn, change_name)
        conn.commit()
        report.changes_written += 1

    gaps_by_task: Dict[Tuple[str, str], Dict[str, GapItem]] = {}
    for gap in plan.missing_complexity:
        gaps_by_task.setdefault(tuple(gap.entity_key.split("--", 1)), {})["complexity"] = gap
    for gap in plan.missing_grades:
        gaps_by_task.setdefault(tuple(gap.entity_key.split("--", 1)), {})["grading"] = gap

    # phase_labeling gaps are recomputed per-session below (they don't key
    # by task), rather than reused from `plan` -- reusing them would race
    # against sessions written earlier in this same loop.

    for (change_name, task_key), brief_path in sorted(disc.briefs.items()):
        try:
            change_id = _get_change_id(conn, change_name)
            existing_task_id = _existing_task_id(conn, change_name, task_key)
            # Brief content always comes from the landed ref (D3), never the
            # working tree -- needed both for the task row and, below, for
            # a complexity dispatch, so fetch it once per task per run.
            brief_text = _git_show(disc.repo_root, disc.ref_sha, brief_path)
            if existing_task_id is None:
                task_id = _upsert_task(conn, change_id, task_key, brief_path, brief_text)
                report.tasks_written += 1
            else:
                task_id = existing_task_id

            sessions = disc.joined.get((change_name, task_key), [])
            for js in sessions:
                if not _session_exists(conn, js.session_id):
                    _upsert_session(conn, task_id, js)
                    report.sessions_written += 1

            task_gaps = gaps_by_task.get((change_name, task_key), {})

            if "complexity" in task_gaps:
                gap = task_gaps["complexity"]

                class _Item:
                    def __call__(self):
                        return {
                            "task_key": gap.entity_key, "version": gap.version,
                            "input_sha256": gap.input_sha256, "brief_text": brief_text,
                        }

                _resolve_gap(conn, staging_dir, "complexity", gap, agent_runner, no_agents, rescore_set, report, _Item())

            if "grading" in task_gaps:
                gap = task_gaps["grading"]
                reviewer_sessions = sorted(
                    (js for js in sessions if js.role == "reviewer"), key=lambda j: j.rec.started_at or ""
                )
                review_text = "\n\n---\n\n".join(_review_text(js.rec) for js in reviewer_sessions)

                class _GradeItem:
                    review_text = None

                    def __call__(self):
                        return {
                            "task_key": gap.entity_key, "version": gap.version,
                            "input_sha256": gap.input_sha256, "review_text": review_text,
                        }

                gi = _GradeItem()
                gi.review_text = review_text
                _resolve_gap(conn, staging_dir, "grading", gap, agent_runner, no_agents, rescore_set, report, gi)

            for js in sessions:
                if js.role != "implementer" or js.review_round != 0:
                    continue
                session_id = js.session_id
                timeline = extractors.render_timeline(js.rec)
                version = assets.read_asset_version(KIND_RUBRIC_PATH["phase_labeling"])
                input_sha256 = db.sha256_text(timeline)
                current_hash, stale = _current_and_stale(
                    conn, "phase_tokens", "taxonomy_version", "session_id", session_id, version
                )
                if current_hash == input_sha256:
                    continue
                if current_hash is not None:
                    reason = REASON_INPUT_CHANGED
                elif stale:
                    reason = REASON_STALE_VERSION
                else:
                    reason = REASON_MISSING
                gap = GapItem(
                    entity_key=session_id, kind="phase_labeling", version=version,
                    input_sha256=input_sha256, reason=reason, stale_versions=stale,
                )
                gap._n_turns = js.rec.n_turns

                class _PhaseItem:
                    rec = js.rec

                    def __call__(self):
                        return {
                            "session_key": session_id, "version": version,
                            "input_sha256": input_sha256, "timeline": timeline,
                        }

                pi = _PhaseItem()
                _resolve_gap(conn, staging_dir, "phase_labeling", gap, agent_runner, no_agents, rescore_set, report, pi)

            conn.commit()
        except Exception:
            conn.rollback()
            raise

    new_quarantined = [js for js in disc.quarantined_sessions if not _session_exists(conn, js.session_id)]
    if new_quarantined:
        try:
            for js in new_quarantined:
                _upsert_session(conn, None, js)
                report.sessions_written += 1
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    # Only append an ingest_log row when the run actually did something --
    # a true no-op re-run (zero writes, zero dispatches) is reported via the
    # returned RunReport/stdout only, not persisted to the audit trail, so
    # repeated no-op runs don't bloat ingest_log. (dump_jsonl also excludes
    # ingest_log entirely, belt-and-suspenders for dump byte-stability.)
    if report.total_writes > 0:
        started_at = _now_iso()
        finished_at = started_at
        actions = {
            "archive_ref": archive_ref,
            "rows_written": report.rows_written,
            "dispatched": report.dispatched,
            "staged_used": report.staged_used,
            "stale": report.stale,
            "quarantined": [q.session_id for q in report.quarantined],
            "unlanded": report.unlanded,
            "new_changes": plan.new_changes,
            "new_tasks": plan.new_tasks,
        }
        conn.execute(
            "INSERT INTO ingest_log(started_at, finished_at, git_sha, actions_json) VALUES (?, ?, ?, ?)",
            (started_at, finished_at, report.ref_sha, json.dumps(actions, sort_keys=True)),
        )
        conn.commit()

    dump_path = _dump_path_for(conn)
    if dump_path is not None:
        db.dump_jsonl(conn, dump_path)

    return report


def _dump_path_for(conn) -> Optional[Path]:
    for _seq, name, file in conn.execute("PRAGMA database_list").fetchall():
        if name == "main" and file:
            p = Path(file)
            return p.parent / (p.stem + ".dump.jsonl")
    return None


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Idempotent ingest driver for the task-analyzer pipeline.")
    p.add_argument("--db", default=str(Path("data/agents/task-analyzer.sqlite")))
    p.add_argument("--repo", default=".")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--no-agents", action="store_true")
    p.add_argument("--rescore", default=None, help="table name to opt in to rescoring (complexity|grades|phase_tokens)")
    p.add_argument("--change", default=None)
    return p


def _connect_for_cli(db_path, dry_run: bool):
    """Open the target database -- except for ``--dry-run`` against a
    database that doesn't exist yet, which must not create/touch it (a
    plan-only command shouldn't have any filesystem side effect): plan
    against a throwaway in-memory database with the same (empty) schema
    instead."""
    if dry_run and not Path(db_path).exists():
        return db.connect(":memory:")
    return db.connect(db_path)


def main(argv=None) -> int:
    args = _build_arg_parser().parse_args(argv)
    conn = _connect_for_cli(args.db, args.dry_run)

    agent_runner = None
    if not args.dry_run and not args.no_agents:
        try:
            import agents  # Task 7's real dispatcher

            agent_runner = agents.xagent_runner
        except ImportError:
            agent_runner = None

    try:
        report = run(
            conn, args.repo,
            dry_run=args.dry_run, no_agents=args.no_agents,
            rescore=args.rescore, agent_runner=agent_runner, change=args.change,
        )
    finally:
        conn.close()

    print(json.dumps({
        "ref_sha": report.ref_sha, "dry_run": report.dry_run,
        "changes_written": report.changes_written, "tasks_written": report.tasks_written,
        "sessions_written": report.sessions_written, "rows_written": report.rows_written,
        "dispatched": report.dispatched, "staged_used": report.staged_used,
        "stale": report.stale, "quarantined": len(report.quarantined),
        "unlanded": report.unlanded,
        "total_writes": report.total_writes,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
