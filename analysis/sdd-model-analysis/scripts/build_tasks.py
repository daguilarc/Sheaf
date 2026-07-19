#!/usr/bin/env python3
"""Join implementer + reviewer sessions into per-task records.

Grouping: change = openspec_change | change_dir | plan | worktree fallback.
Within a change, task = keys.task (e.g. task-3, master-clock-task-2).
Also collects brief/report/diff files from the codex worktrees and computes
mechanical diff stats per task where a review diff package exists.
"""
import json
import glob
import os
import re
import subprocess
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")


def load():
    cx = json.load(open(os.path.join(DATA, "codex_sessions.json")))
    cl = json.load(open(os.path.join(DATA, "claude_sessions.json")))
    return cx + cl


def norm_change(name):
    if not name:
        return None
    name = os.path.basename(name).replace(".md", "")
    return re.sub(r"^\d{4}-\d{2}-\d{2}-", "", name)


def change_of(rec):
    k = rec.get("keys") or {}
    return norm_change(k.get("openspec_change") or k.get("change_dir") or k.get("plan"))


def task_of(rec):
    k = rec.get("keys") or {}
    if k.get("task"):
        return k["task"]
    p = rec.get("prompt") or ""
    m = re.search(r"\.superpowers/sdd/(?:[\w-]+/)?((?:[\w-]+-)?task-\d+)-(?:report|reviewer-prompt|review-package)\.md", p)
    if m:
        return m.group(1)
    m = re.search(r"\bplan[ -](\d+)[, ]+task[ -](\d+)\b", p[:600], re.I)
    if m:
        return f"p{m.group(1)}-task-{m.group(2)}"
    m = re.search(r"\btask group (\d+)\b", p[:600], re.I)
    if m:
        return f"taskgroup-{m.group(1)}"
    m = re.search(r"\btask[ -](\d+)\b", p[:600], re.I)
    if m:
        return f"task-{m.group(1)}"
    return None


def diff_stats(path):
    """files touched, insertions, deletions, new files from a unified diff."""
    st = {"files": 0, "new_files": 0, "insertions": 0, "deletions": 0}
    try:
        with open(path, errors="replace") as fh:
            for line in fh:
                if line.startswith("diff --git"):
                    st["files"] += 1
                elif line.startswith("new file mode"):
                    st["new_files"] += 1
                elif line.startswith("+") and not line.startswith("+++"):
                    st["insertions"] += 1
                elif line.startswith("-") and not line.startswith("---"):
                    st["deletions"] += 1
    except OSError:
        return None
    return st


def find_artifact(worktree, change, task, suffix):
    """Locate task artifact file (brief/report).

    Only the session's own worktree (or the main repo) is trusted; a change-
    scoped subdirectory in any worktree is also acceptable since those names
    are unambiguous.
    """
    bases = []
    if worktree:
        bases.append(f"/Users/joyo/.codex/worktrees/{worktree}/Sheaf/.superpowers/sdd")
        bases.append(f"/Users/joyo/Sheaf/.claude/worktrees/{worktree}/.superpowers/sdd")
    bases.append("/Users/joyo/Sheaf/.superpowers/sdd")
    for base in bases:
        if not os.path.isdir(base):
            continue
        for p in ([os.path.join(base, change, f"{task}-{suffix}.md")] if change else []) + \
                 [os.path.join(base, f"{task}-{suffix}.md")]:
            if os.path.isfile(p):
                return p
    if change:
        for p in glob.glob(f"/Users/joyo/.codex/worktrees/*/Sheaf/.superpowers/sdd/{change}/{task}-{suffix}.md"):
            return p
    return None


def main():
    recs = load()
    sdd = [r for r in recs if r["kind"] in
           ("implementer", "fixer", "reviewer", "reviewer-rereview", "auditor")]
    tasks = defaultdict(lambda: {"implementer_sessions": [], "fixer_sessions": [],
                                 "review_sessions": [], "audit_sessions": []})
    changes = defaultdict(lambda: {"final_review_sessions": [], "sessions": []})

    # first pass: worktree -> most common change (for sessions lacking a change key)
    wt_change = defaultdict(lambda: defaultdict(int))
    for r in sdd:
        k = r.get("keys") or {}
        c = change_of(r)
        if c and k.get("worktree"):
            wt_change[k["worktree"]][c] += 1
    wt_best = {w: max(cs, key=cs.get) for w, cs in wt_change.items()}

    for r in sdd:
        k = r.get("keys") or {}
        wt = k.get("worktree")
        change = change_of(r) or (wt_best.get(wt) if wt else None)
        task = task_of(r)
        sid = f"{r['provider']}:{r['session_id']}"
        entry = {"sid": sid, "file": r["file"], "model": r["model"], "effort": r.get("effort"),
                 "kind": r["kind"], "started_at": r["started_at"],
                 "tokens": (r.get("tokens") or {}).get("total_tokens"),
                 "worktree": wt, "timeline_file": r.get("timeline_file"),
                 "review_traits": r.get("review_traits"),
                 "final_text_file": r.get("final_text_file")}
        ck = change or f"wt:{wt}" or "unknown"
        changes[ck]["sessions"].append(entry)
        traits = r.get("review_traits") or {}
        if task is None and r["kind"].startswith("reviewer") and traits.get("scope") == "final":
            changes[ck]["final_review_sessions"].append(entry)
            continue
        tk = (ck, task or "unmatched", None)
        slot = tasks[tk]
        if r["kind"] == "implementer":
            slot["implementer_sessions"].append(entry)
        elif r["kind"] == "fixer":
            slot["fixer_sessions"].append(entry)
        elif r["kind"] == "auditor":
            slot["audit_sessions"].append(entry)
        else:
            slot["review_sessions"].append(entry)

    out = []
    for (change, task, wtfall), slot in sorted(tasks.items()):
        wt = None
        for lst in slot.values():
            for s in lst:
                wt = wt or s.get("worktree")
        brief = find_artifact(wt, change if change and not change.startswith("wt:") else None, task, "brief") if task != "unmatched" else None
        report = find_artifact(wt, change if change and not change.startswith("wt:") else None, task, "report") if task != "unmatched" else None
        rec = {"change": change, "task": task, "worktree": wt,
               "brief_file": brief, "report_file": report,
               "brief_bytes": os.path.getsize(brief) if brief else None,
               **{k2: sorted(v, key=lambda s: s["started_at"] or "") for k2, v in slot.items()}}
        out.append(rec)

    with open(os.path.join(DATA, "tasks.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    with open(os.path.join(DATA, "changes.json"), "w") as fh:
        json.dump({k: v for k, v in changes.items()}, fh, indent=1)

    n_ok = sum(1 for t in out if t["task"] != "unmatched" and t["implementer_sessions"])
    print(f"{len(out)} task rows; {n_ok} with task id + implementer; "
          f"{sum(1 for t in out if t['brief_file'])} with brief file; {len(changes)} changes")
    for t in out:
        if t["task"] == "unmatched" and (t["implementer_sessions"] or t["fixer_sessions"]):
            print("UNMATCHED impl:", t["change"], t["worktree"],
                  [s["sid"][:14] for s in t["implementer_sessions"] + t["fixer_sessions"]])


if __name__ == "__main__":
    main()
