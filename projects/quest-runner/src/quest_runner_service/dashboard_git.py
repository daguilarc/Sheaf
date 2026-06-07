"""Git commit history and structured diffs for the dashboard (read-only)."""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .dashboard_data import DashboardBadRequest, DashboardNotFound
from .quest_types import RecursiveSnapshot
from .state_machine.commit_metadata import (
    CommitMetadataValidationError,
    parse_step_commit_message,
    validate_parsed_step_commit,
)

_GIT_TIMEOUT = 45.0
_MAX_COMMIT_PAGE = 200
_MAX_METADATA_LOG_COMMITS = 2500
_MAX_DIFF_LINES = 8000
_EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"


def _run_git(
    repo: Path,
    args: list[str],
    *,
    timeout: float = _GIT_TIMEOUT,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    cmd = ["git", "-C", str(repo), *args]
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=check,
    )


def _sha_ok(raw: str) -> bool:
    s = raw.strip()
    if len(s) < 7 or len(s) > 64:
        return False
    return bool(re.fullmatch(r"[0-9a-fA-F]+", s))


def verify_commit_exists(repo: Path, sha: str) -> str:
    if not _sha_ok(sha):
        raise DashboardBadRequest(
            "commit must be a hexadecimal object id",
            fields={"commit": "invalid"},
        )
    r = _run_git(repo, ["rev-parse", "--verify", f"{sha}^{{commit}}"], check=False)
    if r.returncode != 0:
        raise DashboardNotFound(f"Commit not found in repository: {sha.strip()}")
    return r.stdout.strip()


def resolve_diff_parent(repo: Path, sha: str) -> str | None:
    r = _run_git(repo, ["rev-parse", f"{sha}^"], check=False)
    if r.returncode != 0:
        return None
    p = r.stdout.strip()
    return p or None


def git_commits_payload(repo: Path, *, limit: int, skip: int) -> dict:
    lim = max(1, min(int(limit), _MAX_COMMIT_PAGE))
    sk = max(0, int(skip))
    r = _run_git(
        repo,
        [
            "log",
            "HEAD",
            f"--max-count={lim}",
            f"--skip={sk}",
            "-z",
            "--pretty=format:%H\x01%s\x01%an\x01%at",
        ],
        check=False,
    )
    if r.returncode != 0:
        stderr = r.stderr or ""
        if (
            "does not have any commits yet" in stderr
            or "bad revision" in stderr
            or "ambiguous argument 'HEAD'" in stderr
            or "unknown revision or path not in the working tree" in stderr
        ):
            return {
                "commits": [],
                "limit": lim,
                "skip": sk,
                "has_more": False,
            }
        raise DashboardBadRequest(
            f"git log failed: {(r.stderr or r.stdout or 'unknown').strip()}",
            fields={"git": "log_failed"},
        )
    commits: list[dict] = []
    for chunk in r.stdout.split("\0"):
        if not chunk.strip():
            continue
        parts = chunk.split("\x01")
        if len(parts) < 4:
            continue
        h, subj, author, ts_raw = parts[0], parts[1], parts[2], parts[3]
        try:
            ts = int(ts_raw.strip())
        except ValueError:
            ts = 0
        iso = datetime.fromtimestamp(ts, tz=timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
        commits.append(
            {
                "sha": h,
                "title": subj.split("\n", 1)[0],
                "message": subj,
                "author": author,
                "committed_at": iso,
            }
        )
    has_more = len(commits) == lim
    return {
        "commits": commits,
        "limit": lim,
        "skip": sk,
        "has_more": has_more,
    }


@dataclass
class DiffFileEntry:
    path: str
    path_before: str | None
    change_type: str
    is_binary: bool


def _parse_name_status_line(line: str) -> DiffFileEntry | None:
    line = line.rstrip("\n")
    if not line:
        return None
    parts = line.split("\t")
    if len(parts) < 2:
        return None
    status = parts[0].strip()
    if status.startswith("R") or status.startswith("C"):
        if len(parts) < 3:
            return None
        old_p, new_p = parts[1], parts[2]
        return DiffFileEntry(
            path=new_p,
            path_before=old_p,
            change_type="R" if status.startswith("R") else "C",
            is_binary=False,
        )
    path = parts[1]
    return DiffFileEntry(
        path=path,
        path_before=None,
        change_type=status,
        is_binary=False,
    )


def _load_numstat_binary(repo: Path, parent: str, sha: str) -> set[str]:
    r = _run_git(
        repo,
        ["diff", "--numstat", parent, sha],
        check=False,
    )
    if r.returncode != 0:
        return set()
    binary_paths: set[str] = set()
    for line in r.stdout.splitlines():
        if not line.strip():
            continue
        cols = line.split("\t")
        if len(cols) < 3:
            continue
        a, b, path = cols[0], cols[1], cols[2]
        if a.strip() == "-" and b.strip() == "-":
            binary_paths.add(path)
    return binary_paths


def list_changed_files(repo: Path, parent: str, sha: str) -> list[DiffFileEntry]:
    r = _run_git(
        repo,
        ["diff-tree", "--no-commit-id", "--name-status", "--find-renames", "-r", parent, sha],
        check=False,
    )
    if r.returncode != 0:
        return []
    entries: list[DiffFileEntry] = []
    for line in r.stdout.splitlines():
        ent = _parse_name_status_line(line)
        if ent is not None:
            entries.append(ent)
    binary_set = _load_numstat_binary(repo, parent, sha)
    out: list[DiffFileEntry] = []
    for e in entries:
        is_bin = e.is_binary or e.path in binary_set
        if e.path_before and e.path_before in binary_set:
            is_bin = True
        out.append(
            DiffFileEntry(
                path=e.path,
                path_before=e.path_before,
                change_type=e.change_type,
                is_binary=is_bin,
            )
        )
    return out


def _commit_show_metadata(repo: Path, sha: str) -> dict:
    fmt = "%H%x01%s%x01%an%x01%ae%x01%at"
    r = _run_git(
        repo,
        ["show", "-s", f"--format={fmt}", "--no-patch", sha],
        check=False,
    )
    if r.returncode != 0:
        raise DashboardNotFound(f"Cannot read commit: {sha}")
    raw = r.stdout.strip()
    parts = raw.split("\x01")
    if len(parts) < 5:
        raise DashboardBadRequest("Unexpected git show output", fields={"git": "parse"})
    h, subj, an, ae, ts_raw = parts[0], parts[1], parts[2], parts[3], parts[4]
    try:
        ts = int(ts_raw.strip())
    except ValueError:
        ts = 0
    iso = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "sha": h,
        "title": subj.split("\n", 1)[0],
        "message": subj,
        "author": an,
        "author_email": ae,
        "committed_at": iso,
    }


def git_diff_summary_payload(repo: Path, sha: str) -> dict:
    full_sha = verify_commit_exists(repo, sha)
    meta = _commit_show_metadata(repo, full_sha)
    parent = resolve_diff_parent(repo, full_sha)
    if parent is None:
        parent = _EMPTY_TREE
    files = list_changed_files(repo, parent, full_sha)
    file_order = [f.path for f in files]
    return {
        "commit": meta,
        "parent_sha": None if parent == _EMPTY_TREE else parent,
        "files": [
            {
                "path": f.path,
                "path_before": f.path_before,
                "change_type": f.change_type,
                "is_binary": f.is_binary,
                "hunks_loaded": False,
            }
            for f in files
        ],
        "file_order": file_order,
        "detail_path": None,
    }


def parse_unified_diff_to_rows(diff_text: str) -> tuple[list[dict], bool]:
    rows: list[dict] = []
    old_no = 0
    new_no = 0
    truncated = False
    line_count = 0
    for line in diff_text.splitlines():
        if line_count >= _MAX_DIFF_LINES:
            truncated = True
            break
        line_count += 1
        if line.startswith("+++ ") or line.startswith("--- "):
            continue
        if line.startswith("@@"):
            m = re.match(
                r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@",
                line,
            )
            if m:
                old_no = int(m.group(1))
                new_no = int(m.group(3))
            rows.append({"kind": "hunk_header", "text": line})
            continue
        if not line:
            continue
        tag = line[0]
        rest = line[1:]
        if tag == " ":
            rows.append(
                {
                    "kind": "context",
                    "old": {"line_no": old_no, "text": rest},
                    "new": {"line_no": new_no, "text": rest},
                }
            )
            old_no += 1
            new_no += 1
        elif tag == "-":
            rows.append(
                {
                    "kind": "removal",
                    "old": {"line_no": old_no, "text": rest},
                    "new": None,
                }
            )
            old_no += 1
        elif tag == "+":
            rows.append(
                {
                    "kind": "addition",
                    "old": None,
                    "new": {"line_no": new_no, "text": rest},
                }
            )
            new_no += 1
        else:
            rows.append({"kind": "other", "text": line})
    return rows, truncated


def git_diff_file_payload(repo: Path, sha: str, file_path: str) -> dict:
    full_sha = verify_commit_exists(repo, sha)
    meta = _commit_show_metadata(repo, full_sha)
    parent = resolve_diff_parent(repo, full_sha)
    if parent is None:
        parent = _EMPTY_TREE
    files = list_changed_files(repo, parent, full_sha)
    normalized = file_path.replace("\\", "/").strip("/")
    if not normalized or normalized.startswith("/") or ".." in Path(normalized).parts:
        raise DashboardBadRequest(
            "path must be a relative repository path",
            fields={"path": "invalid"},
        )
    match = next((f for f in files if f.path == normalized), None)
    if match is None:
        raise DashboardNotFound(f"Path not in commit diff: {file_path!r}")
    if match.is_binary:
        return {
            "commit": meta,
            "parent_sha": None if parent == _EMPTY_TREE else parent,
            "path": match.path,
            "path_before": match.path_before,
            "change_type": match.change_type,
            "is_binary": True,
            "rows": [],
            "truncated": False,
            "hunks_loaded": True,
        }
    r = _run_git(
        repo,
        ["diff", parent, full_sha, "--", match.path],
        check=False,
    )
    if r.returncode != 0:
        raise DashboardBadRequest(
            f"git diff failed: {(r.stderr or '').strip()}",
            fields={"git": "diff_failed"},
        )
    rows, truncated = parse_unified_diff_to_rows(r.stdout)
    return {
        "commit": meta,
        "parent_sha": None if parent == _EMPTY_TREE else parent,
        "path": match.path,
        "path_before": match.path_before,
        "change_type": match.change_type,
        "is_binary": False,
        "rows": rows,
        "truncated": truncated,
        "hunks_loaded": True,
    }


def parse_limit(raw: str | None, default: int = 50) -> int:
    if raw is None or not str(raw).strip():
        return default
    try:
        n = int(raw, 10)
    except ValueError as e:
        raise DashboardBadRequest(
            "limit must be an integer",
            fields={"limit": "invalid"},
        ) from e
    if n < 1:
        raise DashboardBadRequest(
            "limit must be positive",
            fields={"limit": "invalid"},
        )
    return n


def parse_skip(raw: str | None) -> int:
    if raw is None or not str(raw).strip():
        return 0
    try:
        n = int(raw, 10)
    except ValueError as e:
        raise DashboardBadRequest(
            "skip must be an integer",
            fields={"skip": "invalid"},
        ) from e
    if n < 0:
        raise DashboardBadRequest(
            "skip must be non-negative",
            fields={"skip": "invalid"},
        )
    return n


def _posix_quest_path(raw: str) -> str:
    p = raw.replace("\\", "/").strip()
    while p.startswith("./"):
        p = p[2:]
    while p.startswith("/"):
        p = p[1:]
    while "//" in p:
        p = p.replace("//", "/")
    return p


def _snapshot_chain_payload(snap: RecursiveSnapshot) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    cur: RecursiveSnapshot | None = snap
    while cur is not None:
        out.append(
            {
                "machine_path": cur.machine_path,
                "machine_name": cur.machine_name,
                "node_name": cur.node_name,
                "state_before": cur.state_before,
                "state_after": cur.state_after,
                "role": cur.role,
                "thread_name": cur.thread_name,
                "tags": dict(cur.tags),
            }
        )
        cur = cur.child
    return out


def scan_quest_metadata_step_commits(repo: Path, quest_machine_path: str) -> list[dict[str, Any]]:
    """Walk recent git commits; return parseable recursive-metadata steps for this quest.

    Skips commits that do not parse or fail soft validation. Order is **newest first**
    (same as ``git log``).
    """
    target = _posix_quest_path(quest_machine_path)
    r = _run_git(
        repo,
        [
            "log",
            "HEAD",
            f"--max-count={_MAX_METADATA_LOG_COMMITS}",
            "-z",
            "--pretty=format:%H\x01%at\x01%B",
        ],
        check=False,
    )
    if r.returncode != 0:
        return []
    out: list[dict[str, Any]] = []
    for chunk in (r.stdout or "").split("\0"):
        if not chunk.strip():
            continue
        parts = chunk.split("\x01", 2)
        if len(parts) < 3:
            continue
        sha, ts_raw, body = parts[0], parts[1], parts[2]
        try:
            ts_epoch = int(ts_raw.strip())
        except ValueError:
            continue
        parsed = parse_step_commit_message(body)
        if parsed is None:
            continue
        root = parsed.metadata.snapshot
        if _posix_quest_path(root.machine_path) != target:
            continue
        try:
            validate_parsed_step_commit(parsed, repo_root=None)
        except CommitMetadataValidationError:
            continue
        committed_iso = datetime.fromtimestamp(ts_epoch, tz=timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
        out.append(
            {
                "sha": sha,
                "committed_epoch": float(ts_epoch),
                "committed_at": committed_iso,
                "global_step": parsed.metadata.global_step,
                "state_before": root.state_before,
                "state_after": root.state_after,
                "node_name": root.node_name,
                "role": root.role,
                "thread_name": root.thread_name,
                "child_chain": _snapshot_chain_payload(root),
            }
        )
    return out
