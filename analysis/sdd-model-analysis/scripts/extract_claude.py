#!/usr/bin/env python3
"""Mechanical extraction for Claude Code SDD sessions (implementers, reviewers, auditors).

Scans ~/.claude/projects/*Sheaf*/*.jsonl for transcripts mentioning .superpowers/sdd,
emits data/claude_sessions.json and condensed timelines for implementer-like sessions.
"""
import json
import glob
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
TL = os.path.join(DATA, "timelines")
os.makedirs(TL, exist_ok=True)

SELF_SESSION = "824369f4-0bf1-4dcd-9e27-4f205842b1cc"  # this analysis session


def find_files():
    files = glob.glob(os.path.expanduser("~/.claude/projects/*Sheaf*/*.jsonl"))
    files += glob.glob(os.path.expanduser("~/.claude/projects/*Sheaf*/*/subagents/agent-*.jsonl"))
    out = []
    for f in sorted(files):
        if SELF_SESSION in f:
            continue
        try:
            with open(f, "rb") as fh:
                data = fh.read()
        except OSError:
            continue
        if b".superpowers/sdd" in data or b"superpowers/sdd" in data:
            out.append(f)
    return out


def classify(prompt):
    p = prompt.lower()
    if not p.strip():
        return "empty"
    head = p[:400]
    if re.search(r"re-review|final whole-branch review|final re-review", head):
        return "reviewer-rereview"
    if head.startswith("review") or re.search(r"read-only.{0,40}review|you are reviewing|whole-branch review", head):
        return "reviewer"
    if "audit" in head[:200]:
        return "auditor"
    if re.search(r"^implement task|you are (the |an? )?implement|implementation subagent|carry it out", head):
        return "implementer"
    if re.search(r"fix", head[:80]) and "task" in head:
        return "fixer"
    if re.search(r"review", head):
        return "reviewer"
    return "other"


def review_traits(prompt):
    """Scope and focus of a review prompt."""
    p = prompt.lower()[:600]
    scope = None
    if re.search(r"final|whole-branch|whole-change|holistic|cumulative", p):
        scope = "final"
    elif re.search(r"task[- ]?\d|task-scoped|task brief", p):
        scope = "task"
    focus = "general"
    spec = bool(re.search(r"spec[- ]compliance|spec compliance|specification-compliance", p))
    qual = bool(re.search(r"code[- ]quality|quality review", p))
    if spec and not qual:
        focus = "spec"
    elif qual and not spec:
        focus = "quality"
    elif spec and qual:
        focus = "spec+quality"
    return {"scope": scope, "focus": focus}


def task_keys(prompt, cwd):
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


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(x.get("text", "") for x in content if isinstance(x, dict) and x.get("type") == "text")
    return ""


def extract(path):
    rec = {
        "provider": "claude", "file": path, "session_id": None,
        "started_at": None, "ended_at": None, "cwd": None,
        "model": None, "effort": None, "context_window": None,
        "prompt": None, "tokens": {"input_tokens": 0, "cached_input_tokens": 0,
                                    "cache_creation_tokens": 0, "output_tokens": 0},
        "peak_context": 0, "n_compactions": 0, "n_tool_calls": 0,
        "n_turns": 0, "n_user_msgs": 0, "last_agent_message": None,
        "is_sidechain": False, "n_subagent_spawns": 0,
    }
    if "/subagents/" in path:
        rec["entry"] = "subagent"
        meta_path = path.replace(".jsonl", ".meta.json")
        if os.path.isfile(meta_path):
            try:
                meta = json.load(open(meta_path))
                rec["agent_type"] = meta.get("agentType")
                rec["agent_description"] = meta.get("description")
            except Exception:
                pass
    turns = []
    cur_items = []
    cur_use = {"input_tokens": 0, "cache_read": 0, "cache_creation": 0, "output_tokens": 0}

    def flush():
        nonlocal cur_items, cur_use
        if cur_items:
            turns.append({"items": cur_items, "delta": dict(cur_use)})
            cur_items = []
            cur_use = {"input_tokens": 0, "cache_read": 0, "cache_creation": 0, "output_tokens": 0}

    with open(path) as fh:
        for line in fh:
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            ts = e.get("timestamp")
            if ts:
                rec["ended_at"] = ts
                rec["started_at"] = rec["started_at"] or ts
            rec["session_id"] = rec["session_id"] or e.get("sessionId")
            rec["cwd"] = rec["cwd"] or e.get("cwd")
            if e.get("isSidechain"):
                rec["is_sidechain"] = True
            t = e.get("type")
            if e.get("isCompactSummary") or (isinstance(e.get("content"), str) and "compact" in str(e.get("subtype", ""))):
                rec["n_compactions"] += 1
                cur_items.append({"k": "compaction"})
            if t == "user":
                m = e.get("message") or {}
                txt = text_of(m.get("content"))
                if txt.strip():
                    if e.get("isCompactSummary"):
                        pass
                    elif rec["prompt"] is None:
                        rec["prompt"] = txt
                        rec["n_user_msgs"] += 1
                    else:
                        rec["n_user_msgs"] += 1
                        flush()
                        cur_items.append({"k": "user", "s": txt[:1200]})
                # tool results ride on user lines
                cont = m.get("content")
                if isinstance(cont, list):
                    for x in cont:
                        if isinstance(x, dict) and x.get("type") == "tool_result":
                            s = x.get("content")
                            s = text_of(s) if not isinstance(s, str) else s
                            cur_items.append({"k": "out", "s": str(s)[:200]})
            elif t == "assistant":
                # each assistant line is one API response: close the previous
                # turn so phase labeling gets per-request granularity
                flush()
                m = e.get("message") or {}
                rec["model"] = m.get("model") or rec["model"]
                u = m.get("usage") or {}
                inp = u.get("input_tokens") or 0
                cr = u.get("cache_read_input_tokens") or 0
                cc = u.get("cache_creation_input_tokens") or 0
                out = u.get("output_tokens") or 0
                rec["tokens"]["input_tokens"] += inp + cr + cc
                rec["tokens"]["cached_input_tokens"] += cr
                rec["tokens"]["cache_creation_tokens"] += cc
                rec["tokens"]["output_tokens"] += out
                cur_use["input_tokens"] += inp
                cur_use["cache_read"] += cr
                cur_use["cache_creation"] += cc
                cur_use["output_tokens"] += out
                rec["peak_context"] = max(rec["peak_context"], inp + cr + cc + out)
                cont = m.get("content") or []
                for x in cont:
                    if not isinstance(x, dict):
                        continue
                    xt = x.get("type")
                    if xt == "text" and x.get("text", "").strip():
                        rec["last_agent_message"] = x["text"]
                        cur_items.append({"k": "msg", "s": x["text"][:600]})
                    elif xt == "thinking" and x.get("thinking", "").strip():
                        cur_items.append({"k": "think", "s": x["thinking"][:400]})
                    elif xt == "tool_use":
                        rec["n_tool_calls"] += 1
                        name = x.get("name")
                        if name == "Task" or name == "Agent":
                            rec["n_subagent_spawns"] += 1
                        args = x.get("input") or {}
                        snippet = args.get("command") or args.get("file_path") or args.get("pattern") or json.dumps(args)[:200]
                        cur_items.append({"k": "call", "name": name, "s": str(snippet)[:300]})
    flush()
    if "/subagents/" in path:
        rec["session_id"] = os.path.basename(path).replace(".jsonl", "")
    rec["n_turns"] = len(turns)
    rec["kind"] = classify(rec["prompt"] or "")
    if rec["kind"].startswith("reviewer"):
        rec["review_traits"] = review_traits(rec["prompt"] or "")
    rec["keys"] = task_keys(rec["prompt"] or "", rec["cwd"])
    tot = rec["tokens"]
    tot["total_tokens"] = tot["input_tokens"] + tot["output_tokens"]
    if rec["kind"].startswith("reviewer") or rec["kind"] == "auditor":
        rt_dir = os.path.join(DATA, "review_texts")
        os.makedirs(rt_dir, exist_ok=True)
        sid = rec["session_id"] or os.path.basename(path).replace(".jsonl", "")
        rt = os.path.join(rt_dir, f"claude-{sid}.md")
        with open(rt, "w") as fh2:
            fh2.write(rec["last_agent_message"] or "")
        rec["final_text_file"] = os.path.relpath(rt, DATA)
    rec["last_agent_message"] = (rec["last_agent_message"] or "")[:6000]
    write_timeline(rec, turns)
    rec["prompt"] = (rec["prompt"] or "")[:4000]
    return rec


def write_timeline(rec, turns):
    sid = rec["session_id"] or os.path.basename(rec["file"]).replace(".jsonl", "")
    path = os.path.join(TL, f"claude-{sid}.md")
    lines = [f"# claude session {sid}", f"kind: {rec['kind']}  model: {rec['model']}",
             f"task keys: {json.dumps(rec['keys'])}", "",
             "## Prompt (truncated)", (rec["prompt"] or "")[:2500], ""]
    for i, t in enumerate(turns, 1):
        lines.append(f"## Turn {i}  (output_tokens={t['delta'].get('output_tokens', '?')})")
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
    records = [extract(p) for p in find_files()]
    out = os.path.join(DATA, "claude_sessions.json")
    with open(out, "w") as fh:
        json.dump(records, fh, indent=1)
    import collections
    c = collections.Counter((r["kind"], r["model"]) for r in records)
    print(f"wrote {len(records)} claude records")
    for k, v in c.most_common(30):
        print(v, k)


if __name__ == "__main__":
    main()
