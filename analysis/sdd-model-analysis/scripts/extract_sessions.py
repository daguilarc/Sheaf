#!/usr/bin/env python3
"""Extract mechanical stats from codex exec-source session jsonl files.

For each session emits one JSON record with model, effort, prompt reference,
token totals, peak context, compaction count, tool-call counts, and a per-turn
timeline (for downstream TDD-phase categorization by cheap models).
"""
import json
import glob
import os
import re
import sys

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "sessions_raw.json")

COMPACT_TYPES = {"compacted", "compaction", "context_compacted"}


def find_exec_sessions():
    roots = [
        os.path.expanduser("~/.codex/sessions"),
        os.path.expanduser("~/.codex/archived_sessions"),
    ]
    files = []
    for root in roots:
        files.extend(glob.glob(os.path.join(root, "**", "rollout-*.jsonl"), recursive=True))
    return sorted(files)


def extract(path):
    rec = {
        "file": path,
        "session_id": None,
        "started_at": None,
        "ended_at": None,
        "cwd": None,
        "source": None,
        "model": None,
        "effort": None,
        "context_window": None,
        "user_messages": [],  # first 3000 chars each
        "prompt_file_refs": [],
        "final_usage": None,
        "peak_turn_input": 0,  # proxy for peak context actually sent
        "n_token_counts": 0,
        "n_compactions": 0,
        "n_function_calls": 0,
        "n_reasoning_items": 0,
        "n_agent_messages": 0,
        "n_turns": 0,
        "turn_aborted": 0,
        "last_agent_message": None,
        "timeline": [],  # per-assistant-step: kind, summary snippet, cumulative tokens
    }
    try:
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
                    if rec["started_at"] is None:
                        rec["started_at"] = ts
                if t == "session_meta":
                    rec["session_id"] = p.get("id")
                    rec["cwd"] = p.get("cwd")
                    src = p.get("source")
                    rec["source"] = src if isinstance(src, str) else json.dumps(src)
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
                            rec["final_usage"] = tot
                        rec["context_window"] = info.get("model_context_window") or rec["context_window"]
                        li = (last.get("input_tokens") or 0) + (last.get("output_tokens") or 0)
                        rec["peak_turn_input"] = max(rec["peak_turn_input"], li)
                        rec["n_token_counts"] += 1
                    elif pt == "user_message":
                        msg = p.get("message") or ""
                        rec["user_messages"].append(msg[:3000])
                        rec["prompt_file_refs"].extend(
                            re.findall(r"/[^\s'\"]+\.md", msg)
                        )
                    elif pt == "agent_message":
                        msg = p.get("message") or ""
                        rec["n_agent_messages"] += 1
                        rec["last_agent_message"] = msg[:2000]
                    elif pt == "turn_aborted":
                        rec["turn_aborted"] += 1
                    elif pt in COMPACT_TYPES:
                        rec["n_compactions"] += 1
                elif t == "response_item":
                    pt = p.get("type")
                    if pt == "function_call":
                        rec["n_function_calls"] += 1
                        name = p.get("name")
                        args = p.get("arguments") or ""
                        snippet = ""
                        try:
                            a = json.loads(args)
                            cmd = a.get("command")
                            if isinstance(cmd, list):
                                snippet = " ".join(str(c) for c in cmd)[:200]
                            elif isinstance(cmd, str):
                                snippet = cmd[:200]
                        except Exception:
                            snippet = str(args)[:200]
                        rec["timeline"].append({"k": "call", "name": name, "s": snippet})
                    elif pt == "reasoning":
                        rec["n_reasoning_items"] += 1
                        summ = p.get("summary") or []
                        txt = ""
                        for s in summ:
                            if isinstance(s, dict):
                                txt += s.get("text", "")
                        if txt:
                            rec["timeline"].append({"k": "think", "s": txt[:300]})
                    elif pt == "message" and p.get("role") == "assistant":
                        content = p.get("content") or []
                        txt = ""
                        for c in content:
                            if isinstance(c, dict):
                                txt += c.get("text", "")
                        rec["timeline"].append({"k": "msg", "s": txt[:400]})
                elif t in COMPACT_TYPES:
                    rec["n_compactions"] += 1
    except OSError as exc:
        rec["error"] = str(exc)
    return rec


def main():
    records = []
    for path in find_exec_sessions():
        # cheap pre-filter: only parse files whose first line says source exec
        try:
            with open(path) as fh:
                first = fh.readline()
        except OSError:
            continue
        if '"source":"exec"' not in first and '"source": "exec"' not in first:
            continue
        records.append(extract(path))
    with open(OUT, "w") as fh:
        json.dump(records, fh, indent=1)
    print(f"wrote {len(records)} records to {OUT}")


if __name__ == "__main__":
    main()
