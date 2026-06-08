"""Quest runner loop: state machine, harness dispatch, git commits."""

from __future__ import annotations

import shutil
import subprocess
import time
import re
import json
from fnmatch import fnmatchcase
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from collections.abc import Callable
from typing import NoReturn

from . import quest_fs
from .harness import (
    Harness,
    HarnessJsonlLogSink,
    HarnessMessageError,
    HarnessResponse,
    create_harness,
)
from .quest_service import FatalInvariantError
from .quest_thread import (
    QuestThread,
    build_role_prompt,
    build_runtime_context,
    create_thread,
    load_thread,
    persist_thread_last_used,
    persist_thread_round_count,
    persist_thread_provider_id,
)
from .quest_types import (
    ExecutionProfile,
    QuestMeta,
    QuestState,
    QuestStateInfo,
    SliceState,
    SliceStateInfo,
    slice_index_from_dirname,
    utc_now_iso,
)

_IMPLEMENTATION_DONE_FILE = "implementation_done.md"
_PHYSICAL_PLAN_ACCEPTED_FILE = "physicalplan_accepted.md"
_IMPLEMENTATION_ACCEPTED_FILE = "implementation_accepted.md"
_STEP_LOG_RE = re.compile(r"^step_(\d+)_.*\.jsonl$")


def runtime_quest_docs_dir() -> Path:
    return (Path(__file__).resolve().parent / "quest_docs").resolve()


_ROLE_MAP: dict[tuple[QuestState, SliceState | None], str] = {
    (QuestState.PhysicalPlanning, None): "physical_planner",
    (QuestState.ReviewPhysicalPlan, None): "physical_plan_reviewer",
    (QuestState.ExecuteSlice, SliceState.Implementing): "implementer",
    (QuestState.ExecuteSlice, SliceState.PolishingReview): "polisher_reviewer",
    (QuestState.ExecuteSlice, SliceState.PolishingFix): "polisher",
    (QuestState.QuestDocumenting, None): "documenter",
}


def perform_role_harness_sequence(
    *,
    repo_path: Path,
    quest_dir: Path,
    conductor_repo_path: Path,
    meta: QuestMeta,
    quest_docs_dir: Path,
    quest_state_info: QuestStateInfo,
    slice_dir: Path | None,
    slice_state: SliceState | None,
    profile: ExecutionProfile,
    harness: Harness,
    role_name: str,
    thread_key: str,
    quest_rel: str,
    slice_rel: str | None,
    step_base_commit: str,
    thread_box: list[QuestThread | None],
    role_step_seq: list[int],
    captured_outputs: list[dict],
    create_thread_if_missing: Callable[[], QuestThread],
) -> HarnessResponse:
    """Run primary (and optional follow-up) harness sends for one role step.

    Mutates ``thread_box[0]`` and ``role_step_seq[0]`` like the legacy runner loop.
    """

    current_project_rel = current_project_rel_for_quest(meta, quest_rel)
    project_docs_rel = f"{current_project_rel}/docs" if current_project_rel else "docs"
    task_instruction = build_task_instruction(
        quest_state_info.state,
        slice_state,
        quest_dir,
        slice_dir,
        project_docs_rel,
    )
    task_instruction += reviewer_commit_context(
        repo_path=repo_path,
        quest_dir=quest_dir,
        role_name=role_name,
        thread_key=thread_key,
        slice_dir=slice_dir,
    )
    runtime_context = build_runtime_context(
        role_name=role_name,
        meta=meta,
        quest_dir=quest_dir,
        slice_dir=slice_dir,
        quest_docs_dir=quest_docs_dir,
        repo_path=repo_path,
    )
    message_body = f"{runtime_context}\n\nTask:\n{task_instruction}"
    thread = thread_box[0]
    is_first_message = thread is None or thread.round_count == 0
    if is_first_message:
        message = build_role_prompt(
            role_name, message_body, conductor_repo_path
        )
    else:
        message = message_body

    def _begin_harness_round(
        active_thread: QuestThread,
        body: str,
    ) -> tuple[Path, HarnessJsonlLogSink]:
        role_step_seq[0] += 1
        log_p = agent_log_path(quest_dir, role_step_seq[0], role_name)
        sink = HarnessJsonlLogSink(
            path=log_p,
            step=role_step_seq[0],
            role=role_name,
            thread=active_thread.thread_name,
            harness=profile.harness.value,
            provider_thread_id=active_thread.provider_thread_id,
        )
        sink.write_control(
            "sheaf.run_started",
            model=profile.model,
            reasoning_effort=profile.reasoning_effort,
            stream=True,
            thread_key=thread_key,
            quest_rel=quest_rel,
            slice_rel=slice_rel,
        )
        sink.write_control(
            "sheaf.prompt",
            text=body,
        )
        captured_outputs.append(
            {
                "step": role_step_seq[0],
                "role": role_name,
                "thread": active_thread.thread_name,
                "path": str(log_p),
            }
        )
        return log_p, sink

    def _sync_thread_id(res: HarnessResponse) -> None:
        assert thread_box[0] is not None
        actual = res.provider_thread_id
        if actual != thread_box[0].provider_thread_id:
            thread_box[0].provider_thread_id = actual
            persist_thread_provider_id(quest_dir, thread_key, actual)

    def _bump_round() -> None:
        assert thread_box[0] is not None
        thread_box[0].round_count += 1
        persist_thread_round_count(quest_dir, thread_key, thread_box[0].round_count)

    def _ensure_thread() -> QuestThread:
        if thread_box[0] is None:
            thread_box[0] = create_thread_if_missing()
        return thread_box[0]

    def _one_send_with_enforcement(
        body: str,
        require_fully_clean: bool,
    ) -> HarnessResponse:
        current_body = body
        fully_clean = require_fully_clean
        for _ in range(40):
            _validate_pre_harness_workspace(
                repo_path,
                profile,
                quest_rel,
                slice_rel,
                current_project_rel,
                step_base_commit,
                fully_clean,
            )
            snapshot = git_rev_parse_head(repo_path)
            active_thread = _ensure_thread()
            log_p, sink = _begin_harness_round(active_thread, current_body)
            res = send_with_retry(
                harness,
                active_thread,
                current_body,
                profile,
                log_sink=sink,
            )
            _sync_thread_id(res)
            _bump_round()
            persist_thread_last_used(quest_dir, thread_key)
            illegal = enforce_profile_modify_rules_after_harness(
                repo_path,
                snapshot,
                profile,
                quest_rel,
                slice_rel,
                current_project_rel,
                role_name,
                log_p,
            )
            if not illegal:
                return res
            _write_human_intervention_for_illegal_reverts(
                quest_dir, role_name, illegal
            )
            current_body = _build_enforcement_followup_message(illegal)
            fully_clean = False
        fatal_invariant("path enforcement follow-up limit exceeded")

    result = _one_send_with_enforcement(message, True)
    if role_name == "implementer":
        assert slice_dir is not None
    return result


def fatal_invariant(msg: str) -> NoReturn:
    raise FatalInvariantError(msg)


class DirtyWorkspaceError(Exception):
    """Target repo working tree is not acceptable for a harness invocation."""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class QuestHarnessError(Exception):
    """Structured harness error plus partial run context."""

    def __init__(
        self,
        *,
        detail: str,
        raw_output: str,
        steps_executed: int,
        last_commit: str | None,
        captured_outputs: list[dict],
    ) -> None:
        self.detail = detail
        self.raw_output = raw_output
        self.steps_executed = steps_executed
        self.last_commit = last_commit
        self.captured_outputs = captured_outputs
        super().__init__(detail)


def _normalize_repo_relative_path(path: str) -> str:
    p = path.replace("\\", "/").strip()
    while p.startswith("./"):
        p = p[2:]
    while p.startswith("/"):
        p = p[1:]
    while "//" in p:
        p = p.replace("//", "/")
    return p


def _glob_pattern_segments(pattern: str) -> list[str]:
    return [s for s in _normalize_repo_relative_path(pattern).split("/") if s]


def _segment_matches_glob(pattern_segment: str, path_segment: str) -> bool:
    return bool(path_segment) and fnmatchcase(path_segment, pattern_segment)


def _glob_match_segments(path_segments: list[str], pat_segments: list[str]) -> bool:
    pi = 0
    pj = 0
    while pj < len(pat_segments):
        seg = pat_segments[pj]
        if seg == "**":
            rest_pat = pat_segments[pj + 1 :]
            if not rest_pat:
                return True
            for k in range(pi, len(path_segments) + 1):
                if _glob_match_segments(path_segments[k:], rest_pat):
                    return True
            return False
        if pi >= len(path_segments):
            return False
        if _segment_matches_glob(seg, path_segments[pi]):
            pi += 1
            pj += 1
            continue
        return False
    return pi == len(path_segments)


def path_matches_glob(pattern: str, path: str) -> bool:
    """True if repo-relative path matches glob (segment * and ** per quest spec)."""
    path_segs = _glob_pattern_segments(path)
    pat_segs = _glob_pattern_segments(pattern)
    if not pat_segs:
        return not path_segs
    return _glob_match_segments(path_segs, pat_segs)


def expand_modify_allow_patterns(
    patterns: list[str],
    quest_rel: str,
    slice_rel: str | None,
    current_project_rel: str | None = None,
) -> list[str]:
    return expand_modify_path_patterns(
        patterns, quest_rel, slice_rel, current_project_rel
    )


def expand_modify_path_patterns(
    patterns: list[str],
    quest_rel: str,
    slice_rel: str | None,
    current_project_rel: str | None = None,
) -> list[str]:
    out: list[str] = []
    for raw in patterns:
        if slice_rel is None and "$currentSlice" in raw:
            continue
        if current_project_rel is None and "$currentProject" in raw:
            continue
        exp = raw.replace("$currentQuest", quest_rel)
        exp = exp.replace("$currentSlice", slice_rel if slice_rel is not None else "")
        exp = exp.replace(
            "$currentProject",
            current_project_rel if current_project_rel is not None else "",
        )
        if "$" in exp:
            continue
        out.append(_normalize_repo_relative_path(exp))
    return out


def current_project_rel_for_quest(meta: QuestMeta, quest_rel: str) -> str:
    marker = "/quests/"
    if marker in quest_rel:
        return _normalize_repo_relative_path(quest_rel.split(marker, 1)[0])
    if meta.project:
        return _normalize_repo_relative_path(f"projects/{meta.project}")
    return ""


def path_is_legal_under_profile(
    path: str,
    profile: ExecutionProfile,
    expanded_allows: list[str],
    expanded_blocks: list[str],
) -> bool:
    if profile.config_version == 1:
        return True
    norm = _normalize_repo_relative_path(path)
    has_allow = bool(profile.modify_allow)
    has_block = bool(profile.modify_block)
    allow_hit = any(path_matches_glob(p, norm) for p in expanded_allows)
    block_hit = any(path_matches_glob(p, norm) for p in expanded_blocks)
    if has_allow and has_block:
        if allow_hit:
            return True
        if block_hit:
            return False
        return True
    if has_allow and not has_block:
        return allow_hit
    if not has_allow and has_block:
        return not block_hit
    return True


def git_status_porcelain_empty(repo_path: Path) -> bool:
    r = subprocess.run(
        ["git", "-C", str(repo_path), "status", "--porcelain"],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        fatal_invariant(f"git status --porcelain failed: {r.stderr}")
    return not (r.stdout or "").strip()


def _git_diff_name_status_against_base(
    repo_path: Path, base_commit: str, cached: bool
) -> set[str]:
    cmd = ["git", "-C", str(repo_path), "diff", "--name-status", "--find-renames"]
    if cached:
        cmd.append("--cached")
    cmd.append(base_commit)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        fatal_invariant(f"git diff --name-status failed: {r.stderr}")
    paths: set[str] = set()
    for line in (r.stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        status = parts[0]
        if len(status) == 0:
            continue
        if status[0] in ("R", "C") and len(parts) >= 3:
            paths.add(_normalize_repo_relative_path(parts[1]))
            paths.add(_normalize_repo_relative_path(parts[2]))
        elif status.startswith("D") and len(parts) >= 2:
            paths.add(_normalize_repo_relative_path(parts[1]))
        elif len(parts) >= 2:
            paths.add(_normalize_repo_relative_path(parts[-1]))
    return paths


def collect_changed_paths_since(repo_path: Path, base_commit: str) -> set[str]:
    paths: set[str] = set()
    paths |= _git_diff_name_status_against_base(repo_path, base_commit, cached=False)
    paths |= _git_diff_name_status_against_base(repo_path, base_commit, cached=True)
    r2 = subprocess.run(
        ["git", "-C", str(repo_path), "ls-files", "-z", "--others", "--exclude-standard"],
        capture_output=True,
    )
    if r2.returncode != 0:
        fatal_invariant(f"git ls-files --others failed: {r2.stderr.decode()}")
    for p in r2.stdout.split(b"\0"):
        if not p:
            continue
        paths.add(_normalize_repo_relative_path(p.decode(errors="replace")))
    return paths


collect_paths_changed_since_snapshot = collect_changed_paths_since


def _runner_managed_patterns(quest_rel: str) -> tuple[str, ...]:
    return (
        f"{quest_rel}/thread_registry.json",
        f"{quest_rel}/logs/**",
    )


def _without_runner_managed_paths(paths: set[str], quest_rel: str) -> set[str]:
    patterns = _runner_managed_patterns(quest_rel)
    return {
        p
        for p in paths
        if not any(path_matches_glob(pattern, p) for pattern in patterns)
    }


def _validate_pre_harness_workspace(
    repo_path: Path,
    profile: ExecutionProfile,
    quest_rel: str,
    slice_rel: str | None,
    current_project_rel: str,
    step_base_commit: str,
    require_fully_clean: bool,
) -> None:
    if require_fully_clean or profile.config_version == 1:
        changed = collect_changed_paths_since(repo_path, step_base_commit)
        illegal_pending = _without_runner_managed_paths(changed, quest_rel)
        if illegal_pending:
            raise DirtyWorkspaceError(
                "Target repository working tree must be clean before invoking the "
                "harness (no staged/unstaged changes and no untracked non-ignored "
                "files). Fix or commit changes in the target repo, then retry."
            )
        return
    changed = _without_runner_managed_paths(
        collect_changed_paths_since(repo_path, step_base_commit), quest_rel
    )
    expanded = expand_modify_allow_patterns(
        profile.modify_allow, quest_rel, slice_rel, current_project_rel
    )
    expanded_blocks = expand_modify_path_patterns(
        profile.modify_block, quest_rel, slice_rel, current_project_rel
    )
    for p in changed:
        if not path_is_legal_under_profile(p, profile, expanded, expanded_blocks):
            raise DirtyWorkspaceError(
                f"Working tree has disallowed pending changes before harness "
                f"(path {p!r} is outside this role's path rules)."
            )


def _append_enforcement_note(
    log_path: Path,
    role_name: str,
    snapshot_sha: str,
    reverted_paths: list[str],
) -> None:
    existing = (
        log_path.read_text(encoding="utf-8").splitlines()
        if log_path.exists()
        else []
    )
    match = re.match(r"^step_(\d+)_(.+)\.jsonl$", log_path.name)
    step = int(match.group(1)) if match else 0
    role = match.group(2) if match else role_name
    event = {
        "schema_version": 1,
        "timestamp": utc_now_iso(),
        "sequence": len(existing) + 1,
        "step": step,
        "role": role,
        "thread": "",
        "harness": "",
        "provider_thread_id": "",
        "event_kind": "sheaf.path_enforcement",
        "snapshot": snapshot_sha,
        "reverted_paths": reverted_paths,
        "followup_sent": True,
    }
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, sort_keys=True, ensure_ascii=False))
        fh.write("\n")


def _build_enforcement_followup_message(reverted_paths: list[str]) -> str:
    lines = "\n".join(f"- `{p}`" for p in sorted(set(reverted_paths)))
    return (
        "Some edits violated this role's path permissions and were reverted:\n"
        f"{lines}\n\n"
        "Follow your role instructions and continue: make only allowed changes. "
        "Illegal modifications have been reverted; finish your turn."
    )


def _write_human_intervention_for_illegal_reverts(
    quest_dir: Path,
    role_name: str,
    reverted_paths: list[str],
) -> None:
    # Temporary brake: we currently stop the run after illegal edits are reverted so
    # automation slows down instead of cascading into stranger states. Remove this
    # human-intervention escalation once the recovery path is trusted.
    lines = "\n".join(f"- `{p}`" for p in sorted(set(reverted_paths)))
    _write_human_intervention(
        quest_dir,
        "illegal edits reverted",
        (
            f"Role `{role_name}` modified disallowed paths and the runner reverted them.\n\n"
            f"Reverted paths:\n{lines}\n\n"
            "Review the role permissions, the harness behavior, and the intended "
            "write surface before continuing."
        ),
    )


def _path_in_snapshot_tree(repo_path: Path, snapshot_sha: str, rel: str) -> bool:
    r = subprocess.run(
        ["git", "-C", str(repo_path), "ls-tree", snapshot_sha, "--", rel],
        capture_output=True,
        text=True,
    )
    return r.returncode == 0 and bool((r.stdout or "").strip())


def revert_paths_to_snapshot(repo_path: Path, snapshot_sha: str, paths: list[str]) -> None:
    for p in sorted(set(paths), key=lambda x: (-x.count("/"), -len(x))):
        in_snap = _path_in_snapshot_tree(repo_path, snapshot_sha, p)
        if in_snap:
            rr = subprocess.run(
                [
                    "git",
                    "-C",
                    str(repo_path),
                    "restore",
                    f"--source={snapshot_sha}",
                    "--worktree",
                    "--staged",
                    "--",
                    p,
                ],
                capture_output=True,
                text=True,
            )
            if rr.returncode != 0:
                fatal_invariant(f"git restore failed for {p!r}: {rr.stderr}")
        else:
            full = repo_path / p
            if full.is_dir():
                shutil.rmtree(full, ignore_errors=True)
            elif full.exists():
                full.unlink(missing_ok=True)


def enforce_profile_modify_rules_after_harness(
    repo_path: Path,
    snapshot_sha: str,
    profile: ExecutionProfile,
    quest_rel: str,
    slice_rel: str | None,
    current_project_rel: str,
    role_name: str,
    step_log_path: Path | None,
) -> list[str]:
    """Revert illegal tree changes since snapshot_sha; return sorted reverted paths."""
    if profile.config_version == 1:
        return []
    changed = _without_runner_managed_paths(
        collect_changed_paths_since(repo_path, snapshot_sha), quest_rel
    )
    expanded = expand_modify_allow_patterns(
        profile.modify_allow, quest_rel, slice_rel, current_project_rel
    )
    expanded_blocks = expand_modify_path_patterns(
        profile.modify_block, quest_rel, slice_rel, current_project_rel
    )
    illegal = sorted(
        {
            p
            for p in changed
            if not path_is_legal_under_profile(p, profile, expanded, expanded_blocks)
        }
    )
    if not illegal:
        return []
    revert_paths_to_snapshot(repo_path, snapshot_sha, illegal)
    if step_log_path is not None:
        _append_enforcement_note(step_log_path, role_name, snapshot_sha, illegal)
    return illegal


def resolve_role(quest_state: QuestState, slice_state: SliceState | None) -> str:
    if quest_state == QuestState.ExecuteSlice:
        if slice_state is None:
            fatal_invariant("ExecuteSlice requires a slice_state for role resolution")
        key: tuple[QuestState, SliceState | None] = (quest_state, slice_state)
    else:
        key = (quest_state, None)
    role = _ROLE_MAP.get(key)
    if role is None:
        fatal_invariant(
            f"No role mapping for quest_state={quest_state!r} slice_state={slice_state!r}"
        )
    return role


def _quest_key(meta: QuestMeta) -> str:
    return f"{meta.quest_type}/{meta.quest_number:04d}_{meta.quest_slug}"


def quest_has_open_physicalplan_issues(quest_dir: Path) -> bool:
    issues = quest_fs.read_issues(quest_dir / "physicalplan_issues.md")
    return any(i.status.strip().lower() == "open" for i in issues)


def slice_has_open_polishing_issues(slice_dir: Path) -> bool:
    issues = quest_fs.read_issues(slice_dir / "polishing_issues.md")
    return any(i.status.strip().lower() == "open" for i in issues)


def all_required_slice_plan_files_exist(quest_dir: Path) -> bool:
    slice_dirs = quest_fs.list_slice_dirs(quest_dir)
    if not slice_dirs:
        return False
    for slice_dir in slice_dirs:
        pp = slice_dir / "physicalplan"
        if not pp.is_dir():
            return False
        md_files = list(pp.glob("*.md"))
        if not md_files:
            return False
        for rel in ("state.md", "state_history.md", "polishing_issues.md"):
            if not (slice_dir / rel).is_file():
                return False
    return True


def implementer_done_signal(slice_dir: Path, repo_path: Path, previous_commit: str) -> bool:
    _ = repo_path, previous_commit
    return (slice_dir / _IMPLEMENTATION_DONE_FILE).is_file()


def physical_plan_review_done_signal(quest_dir: Path) -> bool:
    return not quest_has_open_physicalplan_issues(quest_dir) and (
        quest_dir / _PHYSICAL_PLAN_ACCEPTED_FILE
    ).is_file()


def implementation_review_done_signal(slice_dir: Path) -> bool:
    return not slice_has_open_polishing_issues(slice_dir) and (
        slice_dir / _IMPLEMENTATION_ACCEPTED_FILE
    ).is_file()


def docs_updated_for_quest(repo_path: Path, base_ref: str, project_docs_rel: str) -> bool:
    if not base_ref:
        return False
    docs_rel = _normalize_repo_relative_path(project_docs_rel)
    checks: list[list[str]] = [
        ["diff", "--name-only", base_ref, "HEAD", "--", docs_rel],
        ["diff", "--name-only", base_ref, "--", docs_rel],
        ["ls-files", "--others", "--exclude-standard", "--", docs_rel],
    ]
    for args in checks:
        proc = subprocess.run(
            ["git", "-C", str(repo_path), *args],
            capture_output=True,
            text=True,
        )
        if proc.returncode == 0 and any(x.strip() for x in proc.stdout.splitlines()):
            return True
    return False


def build_task_instruction(
    quest_state: QuestState,
    slice_state: SliceState | None,
    quest_dir: Path,
    slice_dir: Path | None,
    project_docs_rel: str | None = None,
) -> str:
    if quest_state == QuestState.PhysicalPlanning:
        if quest_has_open_physicalplan_issues(quest_dir):
            return (
                "Address the open physical-plan issues. Use "
                "`scripts/quest-runner issues list --scope physicalplan` to read them. "
                "Update the physical plans and related slice scaffolding as needed, then "
                "record per-issue responses with "
                "`scripts/quest-runner issues respond <id> --scope physicalplan "
                "--outcome Fixed|NotFixed --explanation \"...\"`."
            )
        return (
            "Read the specs in `specs/`, decide the full ordered slice list and "
            "slugs, then initialize slice directories with "
            "`scripts/quest-runner slices init --project <project> --type <main|side> "
            "--number <n> --count <count> --slug <slug> ...`. After initialization, "
            "write at least one `.md` plan file under each slice's `physicalplan/` "
            "directory."
        )
    if quest_state == QuestState.ReviewPhysicalPlan:
        return (
            "Review the physical plans in all slices. Use "
            "`scripts/quest-runner issues create` and `issues edit` with "
            "`--scope physicalplan` to report or close issues. Reviewers close resolved "
            "issues with `issues edit <id> --status completed`. "
            "If you finish with no open issues, create `physicalplan_accepted.md` "
            "with a brief acceptance summary."
        )
    if quest_state == QuestState.ExecuteSlice and slice_state == SliceState.Implementing:
        assert slice_dir is not None
        rel = slice_dir.name
        return (
            f"Implement the plan described in `{rel}/physicalplan/`. Keep "
            "working until the full plan is complete. "
            f"When the full plan is complete, create `{_IMPLEMENTATION_DONE_FILE}` "
            "in this slice with a brief completion summary."
        )
    if quest_state == QuestState.ExecuteSlice and slice_state == SliceState.PolishingReview:
        return (
            "Review the implementation in this slice. Use "
            "`scripts/quest-runner issues create` and `issues edit` with "
            "`--scope polishing --slice <n>` to report or close issues. Reviewers close "
            "resolved issues with `issues edit <id> --status completed`. "
            "If you finish with no open issues, create `implementation_accepted.md` "
            "in this slice with a brief acceptance summary."
        )
    if quest_state == QuestState.ExecuteSlice and slice_state == SliceState.PolishingFix:
        return (
            "Fix the open polishing issues for this slice. Use "
            "`scripts/quest-runner issues list --scope polishing --slice <n>` to read them. "
            "Record responses with `scripts/quest-runner issues respond <id> "
            "--scope polishing --slice <n> --outcome Fixed|NotFixed --explanation \"...\"`. "
            "Do not close issues yourself."
        )
    if quest_state == QuestState.QuestDocumenting:
        docs_rel = project_docs_rel or "$currentProject/docs"
        return (
            f"Write documentation in `{docs_rel}/` describing what was built "
            "across the full quest. Do not modify repo-root `docs/` unless it "
            "is the current project's docs directory."
        )
    fatal_invariant(
        f"build_task_instruction: unsupported state {quest_state!r} / {slice_state!r}"
    )


_SLICE_SCOPED_THREAD_ROLES = {"implementer", "polisher", "polisher_reviewer"}


def role_thread_key(role_name: str, slice_dir: Path | None) -> str:
    if role_name in _SLICE_SCOPED_THREAD_ROLES and slice_dir is not None:
        idx = slice_index_from_dirname(slice_dir.name)
        if idx is None:
            fatal_invariant(f"invalid slice directory name for thread key: {slice_dir.name}")
        return f"slice_{idx}_{role_name}"
    return role_name


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def _hashes_for_threads_since(
    repo_path: Path, thread_names: set[str], since_ts: str | None
) -> list[str]:
    if not thread_names:
        return []
    cmd = ["git", "-C", str(repo_path), "log", "--pretty=%H%x09%s"]
    if since_ts:
        cmd.extend(["--since", since_ts])
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return []
    out: list[str] = []
    for line in proc.stdout.splitlines():
        commit, _, subject = line.partition("\t")
        if not commit:
            continue
        for tn in thread_names:
            if f" via {tn}" in subject:
                out.append(commit)
                break
    return out


def reviewer_commit_context(
    *,
    repo_path: Path,
    quest_dir: Path,
    role_name: str,
    thread_key: str,
    slice_dir: Path | None,
) -> str:
    if role_name not in {"physical_plan_reviewer", "polisher_reviewer"}:
        return ""
    registry = quest_fs.read_thread_registry(quest_dir)
    reviewer_entry = registry.get(thread_key)
    reviewer_last_used = None
    reviewer_round_count = 0
    if isinstance(reviewer_entry, dict):
        reviewer_last_used = str(reviewer_entry.get("last_used_at") or "").strip() or None
        try:
            reviewer_round_count = int(reviewer_entry.get("round_count", 0))
        except (TypeError, ValueError):
            reviewer_round_count = 0
    source_keys: list[str]
    if role_name == "physical_plan_reviewer":
        source_keys = ["physical_planner"]
    else:
        if reviewer_round_count <= 0:
            source_keys = [role_thread_key("implementer", slice_dir)]
        else:
            source_keys = [role_thread_key("polisher", slice_dir)]

    thread_names: set[str] = set()
    for k in source_keys:
        entry = registry.get(k)
        if isinstance(entry, dict):
            tn = str(entry.get("thread_name") or "").strip()
            if tn:
                thread_names.add(tn)
    hashes = _hashes_for_threads_since(repo_path, thread_names, reviewer_last_used)
    if hashes:
        lines = "\n".join(f"- `{h}`" for h in hashes)
    else:
        lines = "- (none found)"
    return f"\n\nRelevant commit hashes for this review:\n{lines}"


@dataclass
class TransitionPlan:
    """Describes all state changes for a single runner step."""

    quest_prev: QuestState | None = None
    quest_next: QuestState | None = None
    slice_dir: Path | None = None
    slice_prev: SliceState | None = None
    slice_next: SliceState | None = None
    new_current_slice: int | None = None
    scaffold_slice: bool = False

    @property
    def has_quest_transition(self) -> bool:
        return self.quest_prev is not None and self.quest_next is not None

    @property
    def has_slice_transition(self) -> bool:
        return self.slice_prev is not None and self.slice_next is not None

    @property
    def is_noop(self) -> bool:
        return not self.has_quest_transition and not self.has_slice_transition


def _get_slice_dir(quest_dir: Path, index: int) -> Path:
    prefix = f"{index:04d}_"
    for p in quest_fs.list_slice_dirs(quest_dir):
        if p.name.startswith(prefix):
            return p
    fatal_invariant(f"No slice directory for index {index} under {quest_dir}")


def _slice_path_for_quest(quest_dir: Path, q: QuestStateInfo) -> Path | None:
    if q.state != QuestState.ExecuteSlice or q.current_slice is None:
        return None
    return _get_slice_dir(quest_dir, q.current_slice)


def build_v2_transition_plan(
    quest_dir: Path,
    bq: QuestStateInfo,
    aq: QuestStateInfo,
    bsi: SliceStateInfo | None,
    asi: SliceStateInfo | None,
) -> TransitionPlan:
    """Diff before/after quest reads into a :class:`TransitionPlan` (v2 runner)."""
    plan = TransitionPlan()
    if (
        bq.state != aq.state
        or bq.current_slice != aq.current_slice
        or (bq.active_slice or "") != (aq.active_slice or "")
    ):
        plan.quest_prev = bq.state
        plan.quest_next = aq.state
        plan.new_current_slice = aq.current_slice
    bsp = _slice_path_for_quest(quest_dir, bq)
    asp = _slice_path_for_quest(quest_dir, aq)
    if bsi is not None and asi is not None:
        if bsi.state != asi.state:
            sd = asp or bsp
            if sd is not None:
                plan.slice_dir = sd
                plan.slice_prev = bsi.state
                plan.slice_next = asi.state
    if plan.has_slice_transition:
        if (
            plan.slice_prev == SliceState.NotStarted
            and plan.slice_next == SliceState.Implementing
        ):
            plan.scaffold_slice = True
    return plan


def find_next_slice(quest_dir: Path, current_slice: int) -> int | None:
    indices: list[int] = []
    for p in quest_fs.list_slice_dirs(quest_dir):
        idx = slice_index_from_dirname(p.name)
        if idx is not None:
            indices.append(idx)
    indices.sort()
    larger = [i for i in indices if i > current_slice]
    return larger[0] if larger else None


def scaffold_slice_dir(slice_dir: Path) -> None:
    state_path = slice_dir / "state.md"
    if not state_path.exists():
        quest_fs.write_slice_state(
            slice_dir,
            SliceStateInfo(state=SliceState.NotStarted, updated_at=utc_now_iso()),
        )
    history_path = slice_dir / "state_history.md"
    if not history_path.exists():
        history_path.write_text("# State Transition History\n", encoding="utf-8")
    issues_path = slice_dir / "polishing_issues.md"
    if not issues_path.exists():
        issues_path.write_text("# Issues\n", encoding="utf-8")
    (slice_dir / "notes").mkdir(exist_ok=True)


def _write_human_intervention(quest_dir: Path, reason: str, detail: str = "") -> None:
    p = quest_dir / "human_intervention_request.md"
    p.write_text(
        f"# Human intervention requested\n\n**Reason:** {reason}\n\n{detail}\n",
        encoding="utf-8",
    )


def _remove_file_if_exists(path: Path) -> None:
    if path.exists():
        path.unlink()


def git_rev_parse_head(repo_path: Path) -> str:
    r = subprocess.run(
        ["git", "-C", str(repo_path), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        fatal_invariant(f"git rev-parse HEAD failed: {r.stderr}")
    return r.stdout.strip()


def apply_transition_filesystem_side_effects(
    quest_dir: Path,
    plan: TransitionPlan,
) -> None:
    """Scaffold/removals for v2 single-commit steps (``execute_v2_top_level_step``)."""
    if plan.scaffold_slice and plan.slice_dir is not None:
        scaffold_slice_dir(plan.slice_dir)
    if (
        plan.has_quest_transition
        and plan.quest_prev == QuestState.ReviewPhysicalPlan
        and plan.quest_next == QuestState.PhysicalPlanning
    ):
        _remove_file_if_exists(quest_dir / _PHYSICAL_PLAN_ACCEPTED_FILE)
    if (
        plan.has_slice_transition
        and plan.slice_dir is not None
        and plan.slice_prev == SliceState.PolishingReview
        and plan.slice_next == SliceState.PolishingFix
    ):
        _remove_file_if_exists(plan.slice_dir / _IMPLEMENTATION_ACCEPTED_FILE)


def send_with_retry(
    harness: Harness,
    thread: QuestThread,
    message: str,
    profile: ExecutionProfile,
    max_retries: int = 3,
    log_sink: HarnessJsonlLogSink | None = None,
) -> HarnessResponse:
    delay = 1.0
    last_exc: BaseException | None = None
    for attempt in range(max_retries):
        try:
            return harness.send_message(
                provider_thread_id=thread.provider_thread_id,
                quest_dir=thread.quest_path,
                repo_path=thread.repo_path,
                message=message,
                idle_timeout_seconds=profile.idle_timeout_seconds,
                model=profile.model,
                reasoning_effort=profile.reasoning_effort,
                stream=True,
                log_sink=log_sink,
            )
        except HarnessMessageError:
            raise
        except (OSError, TimeoutError) as e:
            last_exc = e
            if log_sink is not None:
                log_sink.write_control(
                    "sheaf.run_failed",
                    reason="exception",
                    detail=repr(e),
                    attempt=attempt + 1,
                )
            if attempt + 1 < max_retries:
                time.sleep(delay)
                delay *= 2.0
    detail = repr(last_exc) if last_exc else "unknown"
    _write_human_intervention(
        thread.quest_path,
        "harness retries exhausted",
        detail,
    )
    raise FatalInvariantError(f"harness send failed after retries: {detail}")


def agent_log_path(quest_dir: Path, step: int, role_name: str) -> Path:
    logs = quest_dir / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    return logs / f"step_{step:04d}_{role_name}.jsonl"


def next_log_step_number(quest_dir: Path) -> int:
    logs_dir = quest_dir / "logs"
    if not logs_dir.is_dir():
        return 1
    highest = 0
    for path in logs_dir.iterdir():
        if not path.is_file():
            continue
        match = _STEP_LOG_RE.match(path.name)
        if match is None:
            continue
        highest = max(highest, int(match.group(1)))
    return highest + 1


def run_quest(
    repo_path: Path,
    quest_dir: Path,
    conductor_repo_path: Path,
    max_steps: int = 500,
) -> HarnessResponse:
    from . import quest_runner_v2
    return quest_runner_v2.run_quest_v2(
        repo_path, quest_dir, conductor_repo_path, max_steps
    )
