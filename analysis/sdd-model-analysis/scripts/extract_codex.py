#!/usr/bin/env python3
"""Mechanical extraction for codex exec-source SDD sessions.

Outputs data/codex_sessions.json (one record per session) and
data/timelines/codex-<id>.md (condensed per-turn timeline for LLM phase labeling).
"""
import json
import glob
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
TL = os.path.join(DATA, "timelines")
os.makedirs(TL, exist_ok=True)

COMPACT_TYPES = {"compacted", "compaction", "context_compacted"}


def find_exec_sessions():
    roots = [os.path.expanduser("~/.codex/sessions"),
             os.path.expanduser("~/.codex/archived_sessions")]
    files = []
    for root in roots:
        files.extend(glob.glob(os.path.join(root, "**", "rollout-*.jsonl"), recursive=True))
    out = []
    for path in sorted(files):
        try:
            with open(path) as fh:
                first = fh.readline()
        except OSError:
            continue
        if '"source":"exec"' in first or '"source": "exec"' in first:
            out.append((path, "exec", None, None))
        elif "thread_spawn" in first:
            try:
                meta = json.loads(first)["payload"]
                ts = meta["source"]["subagent"]["thread_spawn"]
                out.append((path, "thread_spawn", ts.get("agent_path"), ts.get("agent_role")))
            except Exception:
                out.append((path, "thread_spawn", None, None))
    return out


def classify(prompt):
    p = prompt.lower()
    if not p.strip():
        return "empty"
    if p.startswith("# polisher role"):
        return "quest-polisher"
    if p.startswith("# physical planner role"):
        return "quest-planner"
    if p.startswith("# documenter role"):
        return "quest-documenter"
    if p.startswith("# integration tester"):
        return "quest-tester"
    if p.startswith("# physical plan reviewer role"):
        return "quest-plan-reviewer"
    if p.startswith("# polisher reviewer role"):
        return "quest-polisher-reviewer"
    if "quest runtime context" in p[:100]:
        return "quest-other"
    if "final-review verification" in p[:120]:
        return "reviewer-rereview"
    if re.search(r"review-prompt\.md", p[:300]):
        return "reviewer"
    if "final-fix-prompt" in p[:300]:
        return "fixer"
    if re.search(r"re-review|final whole-branch review|final re-review", p[:200]):
        return "reviewer-rereview"
    if re.search(r"read-only[^\n]{0,40}review|you are reviewing|spec reviewer|review the uncommitted|task reviewer|plan reviewer", p[:300]):
        return "reviewer"
    if ("implementer-prompt" in p or "implementation subagent" in p
            or p.startswith("implement task") or "codex implementer" in p[:200]
            or re.search(r"task-\d+[^\n]*brief\.md", p)):
        return "implementer"
    if "follow-up fix" in p[:120] or "spec-review fix" in p[:120] or "fix the final verification" in p[:120]:
        return "fixer"
    if "reply with exactly" in p[:120] or "smoke test" in p[:80] or "capability check" in p[:80]:
        return "smoke"
    return "other"


def task_keys(prompt, cwd):
    """Extract change/task identifiers from a prompt."""
    keys = {}
    m = re.search(r"\.superpowers/sdd/(?:([\w-]+)/)?((?:[\w-]+-)?task-\d+)-(?:brief|implementer-prompt)\.md", prompt)
    if m:
        keys["change_dir"] = m.group(1)
        keys["task"] = m.group(2)
    m = (re.search(r"openspec/changes/([\w-]+)\b", prompt)
         or re.search(r"OpenSpec change [`'\"]?([\w-]+)", prompt))
    if m and m.group(1) not in ("at", "in", "the", "for", "owns", "is", "to", "and", "that", "this"):
        keys["openspec_change"] = m.group(1)
    m = re.search(r"(?:docs/superpowers/)?plans/([\w-][\w./-]*\.md)", prompt)
    if m:
        keys["plan"] = m.group(1)
    m = re.search(r"/(?:private/)?tmp/(sheaf-[\w-]+)", prompt)
    if m and "openspec_change" not in keys:
        keys["openspec_change"] = re.sub(r"^sheaf-", "", m.group(1))
    m = re.search(r"/\.codex/worktrees/([^/]+)/", (cwd or "") + " " + prompt) \
        or re.search(r"/\.claude/worktrees/([\w.-]+)", (cwd or "") + " " + prompt)
    if m:
        keys["worktree"] = m.group(1)
    return keys


def extract(path, entry="exec", spawn_path=None, spawn_role=None):
    rec = {
        "provider": "codex", "file": path, "session_id": None,
        "entry": entry, "spawn_path": spawn_path, "spawn_role": spawn_role,
        "started_at": None, "ended_at": None, "cwd": None,
        "model": None, "effort": None, "context_window": None,
        "prompt": None, "prompt_file_refs": [],
        "tokens": None, "peak_context": 0, "n_compactions": 0,
        "n_tool_calls": 0, "n_turns": 0, "n_aborts": 0,
        "last_agent_message": None,
    }
    turns = []       # list of {"items": [...], "delta": {...}}
    cur_items = []
    with open(path) as fh:
        for line in fh:
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = e.get("type")
            p = e.get("payload") or {}
            ts = e.get("timestamp")
            if ts:
                rec["ended_at"] = ts
                rec["started_at"] = rec["started_at"] or ts
            if t == "session_meta":
                rec["session_id"] = p.get("id")
                rec["cwd"] = p.get("cwd")
            elif t == "turn_context":
                rec["n_turns"] += 1
                rec["model"] = p.get("model") or rec["model"]
                rec["effort"] = p.get("effort") or rec["effort"]
            elif t == "event_msg":
                pt = p.get("type")
                if pt == "token_count":
                    info = p.get("info") or {}
                    tot = info.get("total_token_usage")
                    last = info.get("last_token_usage") or {}
                    if tot:
                        rec["tokens"] = tot
                    rec["context_window"] = info.get("model_context_window") or rec["context_window"]
                    ctx = (last.get("input_tokens") or 0) + (last.get("output_tokens") or 0)
                    rec["peak_context"] = max(rec["peak_context"], ctx)
                    if cur_items:
                        turns.append({"items": cur_items, "delta": last})
                        cur_items = []
                elif pt == "user_message":
                    msg = p.get("message") or ""
                    if "Session initialization only" in msg:
                        continue
                    if rec["prompt"] is None:
                        rec["prompt"] = msg
                    else:
                        cur_items.append({"k": "user", "s": msg[:1500]})
                    rec["prompt_file_refs"].extend(re.findall(r"/[^\s'\"]+\.md", msg))
                elif pt == "agent_message":
                    rec["last_agent_message"] = p.get("message") or ""
                elif pt == "turn_aborted":
                    rec["n_aborts"] += 1
                elif pt in COMPACT_TYPES:
                    rec["n_compactions"] += 1
                    cur_items.append({"k": "compaction"})
            elif t == "response_item":
                pt = p.get("type")
                if pt == "function_call":
                    rec["n_tool_calls"] += 1
                    name = p.get("name")
                    snippet = ""
                    try:
                        a = json.loads(p.get("arguments") or "{}")
                        cmd = a.get("command")
                        if isinstance(cmd, list):
                            snippet = " ".join(str(c) for c in cmd)
                        elif isinstance(cmd, str):
                            snippet = cmd
                        else:
                            snippet = json.dumps(a)
                    except Exception:
                        snippet = str(p.get("arguments"))[:300]
                    cur_items.append({"k": "call", "name": name, "s": snippet[:300]})
                elif pt == "function_call_output":
                    out = p.get("output")
                    if isinstance(out, dict):
                        out = out.get("content") or ""
                    cur_items.append({"k": "out", "s": str(out)[:200]})
                elif pt == "reasoning":
                    txt = "".join(s.get("text", "") for s in (p.get("summary") or []) if isinstance(s, dict))
                    if txt:
                        cur_items.append({"k": "think", "s": txt[:400]})
                elif pt == "message" and p.get("role") == "assistant":
                    txt = "".join(c.get("text", "") for c in (p.get("content") or []) if isinstance(c, dict))
                    if txt:
                        cur_items.append({"k": "msg", "s": txt[:600]})
            elif t in COMPACT_TYPES:
                rec["n_compactions"] += 1
                cur_items.append({"k": "compaction"})
    if cur_items:
        turns.append({"items": cur_items, "delta": {}})
    rec["kind"] = classify(rec["prompt"] or "")
    if rec["kind"] in ("other", "empty") and spawn_path:
        m = re.search(r"task[_-]?(\d+)", spawn_path)
        if m:
            rec["kind"] = "implementer"
    rec["keys"] = task_keys(rec["prompt"] or "", rec["cwd"])
    if "task" not in rec["keys"] and spawn_path:
        m = re.search(r"task[_-]?(\d+)", spawn_path)
        if m:
            rec["keys"]["task"] = f"task-{m.group(1)}"
    rec["n_labeled_turns"] = len(turns)
    if rec["kind"].startswith("reviewer"):
        rt_dir = os.path.join(DATA, "review_texts")
        os.makedirs(rt_dir, exist_ok=True)
        sid = rec["session_id"] or os.path.basename(path)
        rt = os.path.join(rt_dir, f"codex-{sid}.md")
        with open(rt, "w") as fh2:
            fh2.write(rec["last_agent_message"] or "")
        rec["final_text_file"] = os.path.relpath(rt, DATA)
    rec["last_agent_message"] = (rec["last_agent_message"] or "")[:6000]
    write_timeline(rec, turns)
    rec["prompt"] = (rec["prompt"] or "")[:4000]
    return rec


def write_timeline(rec, turns):
    sid = rec["session_id"] or os.path.basename(rec["file"])
    path = os.path.join(TL, f"codex-{sid}.md")
    lines = [f"# codex session {sid}", f"kind: {rec['kind']}  model: {rec['model']}/{rec['effort']}",
             f"task keys: {json.dumps(rec['keys'])}", "",
             "## Prompt (truncated)", (rec["prompt"] or "")[:2500], ""]
    for i, t in enumerate(turns, 1):
        d = t["delta"]
        lines.append(f"## Turn {i}  (output_tokens={d.get('output_tokens', '?')}, "
                     f"reasoning={d.get('reasoning_output_tokens', '?')}, "
                     f"input={d.get('input_tokens', '?')})")
        for it in t["items"]:
            k = it["k"]
            if k == "call":
                lines.append(f"- CALL {it.get('name')}: {it['s']}")
            elif k == "out":
                lines.append(f"  OUT: {it['s'][:150]}")
            elif k == "think":
                lines.append(f"- THINK: {it['s']}")
            elif k == "msg":
                lines.append(f"- SAY: {it['s']}")
            elif k == "user":
                lines.append(f"- USER: {it['s'][:400]}")
            elif k == "compaction":
                lines.append("- [CONTEXT COMPACTION]")
        lines.append("")
    with open(path, "w") as fh:
        fh.write("\n".join(lines))
    rec["timeline_file"] = os.path.relpath(path, DATA)


def main():
    records = [extract(*args) for args in find_exec_sessions()]
    # dedupe by session id, preferring the non-archived copy
    by_id = {}
    for r in records:
        key = r["session_id"] or r["file"]
        prev = by_id.get(key)
        if prev is None or ("archived_sessions" in prev["file"] and "archived_sessions" not in r["file"]):
            by_id[key] = r
    records = list(by_id.values())
    out = os.path.join(DATA, "codex_sessions.json")
    with open(out, "w") as fh:
        json.dump(records, fh, indent=1)
    import collections
    c = collections.Counter(r["kind"] for r in records)
    print(f"wrote {len(records)} codex records; kinds: {dict(c)}")


if __name__ == "__main__":
    main()
