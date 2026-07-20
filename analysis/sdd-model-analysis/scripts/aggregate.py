#!/usr/bin/env python3
"""Merge mechanical stats + phase labels + complexity + grades into one flat table.

Outputs:
  data/analysis_sessions.json  — one row per implementer session with phase token breakdown
  data/analysis_tasks.json     — one row per task: implementer stats + complexity + grade
  data/analysis_tasks.csv      — same, flattened for spreadsheets
"""
import csv
import json
import os
import re
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")

PHASES = ["orient", "explore", "red", "green", "refactor", "verify",
          "debug", "selfcheck", "report", "other"]


def load_json(name):
    p = os.path.join(DATA, name)
    return json.load(open(p)) if os.path.isfile(p) else None


def turn_costs_from_timeline(tl_path):
    """Recover per-turn token deltas from a timeline markdown header lines."""
    costs = {}
    if not os.path.isfile(tl_path):
        return costs
    pat = re.compile(r"^## Turn (\d+)\s+\((.*)\)")
    for line in open(tl_path):
        m = pat.match(line)
        if not m:
            continue
        turn = m.group(1)
        fields = {}
        for kv in m.group(2).split(","):
            kv = kv.strip()
            if "=" in kv:
                k, v = kv.split("=", 1)
                try:
                    fields[k.strip()] = int(v)
                except ValueError:
                    fields[k.strip()] = 0
        costs[turn] = fields
    return costs


def phase_breakdown(rec):
    """Token cost per phase for one session, using its label file + timeline."""
    key = f"{rec['provider']}-{rec['session_id']}"
    lbl_path = os.path.join(DATA, "phase_labels", f"{key}.json")
    if not os.path.isfile(lbl_path):
        return None
    try:
        labels = json.load(open(lbl_path)).get("labels") or {}
    except json.JSONDecodeError:
        return None
    tl = os.path.join(DATA, rec.get("timeline_file") or "")
    costs = turn_costs_from_timeline(tl)
    out = {p: {"output_tokens": 0, "turns": 0} for p in PHASES}
    for turn, fields in costs.items():
        phase = labels.get(turn, "other")
        if phase not in out:
            phase = "other"
        # output tokens are the model's own work; input reflects context size
        out[phase]["output_tokens"] += fields.get("output_tokens", 0) or 0
        out[phase]["turns"] += 1
    return out


def main():
    cx = load_json("codex_sessions.json") or []
    cl = load_json("claude_sessions.json") or []
    tasks = load_json("tasks.json") or []
    allrecs = {f"{r['provider']}:{r['session_id']}": r for r in cx + cl}

    sess_rows = []
    for r in cx + cl:
        if r["kind"] not in ("implementer", "fixer"):
            continue
        pb = phase_breakdown(r)
        toks = r.get("tokens") or {}
        sess_rows.append({
            "sid": f"{r['provider']}:{r['session_id']}",
            "provider": r["provider"], "kind": r["kind"], "entry": r.get("entry"),
            "model": r["model"], "effort": r.get("effort"),
            "started_at": r["started_at"], "ended_at": r["ended_at"],
            "total_tokens": toks.get("total_tokens"),
            "output_tokens": toks.get("output_tokens"),
            "cached_input_tokens": toks.get("cached_input_tokens"),
            "peak_context": r.get("peak_context"),
            "context_window": r.get("context_window"),
            "n_compactions": r.get("n_compactions"),
            "n_tool_calls": r.get("n_tool_calls"),
            "n_turns": r.get("n_turns") or r.get("n_labeled_turns"),
            "phase_breakdown": pb,
        })
    with open(os.path.join(DATA, "analysis_sessions.json"), "w") as fh:
        json.dump(sess_rows, fh, indent=1)
    sess_by_sid = {s["sid"]: s for s in sess_rows}

    task_rows = []
    for t in tasks:
        impls = t["implementer_sessions"] + t["fixer_sessions"]
        if not impls:
            continue
        key = f"{t['change']}__{t['task']}"
        comp = load_json(os.path.join("complexity", f"{key}.json"))
        grade = load_json(os.path.join("grades", f"{key}.json"))
        srows = [sess_by_sid.get(s["sid"]) for s in impls]
        srows = [s for s in srows if s]
        main_impl = srows[0] if srows else None
        combined_phase = defaultdict(int)
        for s in srows:
            for p, v in (s.get("phase_breakdown") or {}).items():
                combined_phase[p] += v["output_tokens"]
        row = {
            "task_key": key, "change": t["change"], "task": t["task"],
            "worktree": t["worktree"], "brief_file": t["brief_file"],
            "brief_bytes": t.get("brief_bytes"),
            "impl_model": main_impl["model"] if main_impl else None,
            "impl_effort": main_impl["effort"] if main_impl else None,
            "impl_provider": main_impl["provider"] if main_impl else None,
            "n_impl_sessions": len(impls),
            "impl_total_tokens": sum(s["total_tokens"] or 0 for s in srows) or None,
            "impl_output_tokens": sum(s["output_tokens"] or 0 for s in srows) or None,
            "peak_context": max((s["peak_context"] or 0 for s in srows), default=None),
            "n_compactions": sum(s["n_compactions"] or 0 for s in srows),
            "n_tool_calls": sum(s["n_tool_calls"] or 0 for s in srows),
            "phase_output_tokens": dict(combined_phase) or None,
            "n_reviews": len(t["review_sessions"]),
            "complexity": comp, "grade": grade,
        }
        task_rows.append(row)
    with open(os.path.join(DATA, "analysis_tasks.json"), "w") as fh:
        json.dump(task_rows, fh, indent=1)

    # flat CSV
    cols = ["task_key", "change", "task", "impl_provider", "impl_model", "impl_effort",
            "n_impl_sessions", "impl_total_tokens", "impl_output_tokens",
            "peak_context", "n_compactions", "n_tool_calls", "brief_bytes", "n_reviews"]
    ccols = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "composite"]
    gcols = ["G1", "G2", "G3", "G4", "G5", "n_critical", "n_important", "n_minor",
             "rounds_to_accept", "final_grade"]
    with open(os.path.join(DATA, "analysis_tasks.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols + ccols + gcols + [f"ph_{p}" for p in PHASES])
        for r in task_rows:
            comp = r.get("complexity") or {}
            gr = r.get("grade") or {}
            ph = r.get("phase_output_tokens") or {}
            w.writerow([r.get(c) for c in cols]
                       + [comp.get(c) for c in ccols]
                       + [gr.get(c) for c in gcols]
                       + [ph.get(p, 0) for p in PHASES])

    n_pb = sum(1 for s in sess_rows if s["phase_breakdown"])
    n_c = sum(1 for r in task_rows if r["complexity"])
    n_g = sum(1 for r in task_rows if r["grade"])
    print(f"{len(sess_rows)} implementer sessions ({n_pb} phase-labeled); "
          f"{len(task_rows)} tasks ({n_c} complexity-scored, {n_g} graded)")


if __name__ == "__main__":
    main()
