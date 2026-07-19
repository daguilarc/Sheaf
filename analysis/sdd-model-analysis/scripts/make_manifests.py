#!/usr/bin/env python3
"""Produce batch manifests for the three LLM labeling stages."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")


def chunks(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def main():
    cx = json.load(open(os.path.join(DATA, "codex_sessions.json")))
    cl = json.load(open(os.path.join(DATA, "claude_sessions.json")))
    tasks = json.load(open(os.path.join(DATA, "tasks.json")))

    # Stage A: implementer/fixer timelines worth labeling
    sess = [r for r in cx + cl if r["kind"] in ("implementer", "fixer")]
    a_items = []
    for r in sess:
        tl = os.path.join(DATA, r.get("timeline_file") or "")
        if not r.get("timeline_file") or not os.path.isfile(tl):
            continue
        size = os.path.getsize(tl)
        if size < 900:  # empty / aborted sessions
            continue
        a_items.append({"session_key": f"{r['provider']}-{r['session_id']}",
                        "timeline": os.path.abspath(tl), "bytes": size})
    a_items.sort(key=lambda x: x["timeline"])
    a_batches = [{"batch": i, "items": c} for i, c in enumerate(chunks(a_items, 12))]

    # Stage B: complexity per task row with an implementer
    b_items = []
    for t in tasks:
        if not (t["implementer_sessions"] or t["fixer_sessions"]):
            continue
        impl = (t["implementer_sessions"] + t["fixer_sessions"])[0]
        # brief file, else the implementer prompt from session record
        rec = None
        allrecs = {f"{r['provider']}:{r['session_id']}": r for r in cx + cl}
        rec = allrecs.get(impl["sid"])
        b_items.append({
            "task_key": f"{t['change']}__{t['task']}",
            "change": t["change"], "task": t["task"],
            "brief_file": t["brief_file"],
            "report_file": t["report_file"],
            "prompt_fallback": (rec.get("prompt") if rec else None) if not t["brief_file"] else None,
        })
    b_batches = [{"batch": i, "items": c} for i, c in enumerate(chunks(b_items, 10))]

    # Stage C: grading per task row with >=1 review
    c_items = []
    for t in tasks:
        if not (t["implementer_sessions"] or t["fixer_sessions"]):
            continue
        revs = t["review_sessions"] + t["audit_sessions"]
        if not revs:
            continue
        rv = []
        for s in sorted(revs, key=lambda s: s["started_at"] or ""):
            ftf = s.get("final_text_file")
            if not ftf:
                continue
            p = os.path.join(DATA, ftf)
            if os.path.isfile(p) and os.path.getsize(p) > 100:
                rv.append({"sid": s["sid"], "kind": s["kind"], "model": s["model"],
                           "started_at": s["started_at"], "review_text": os.path.abspath(p),
                           "traits": s.get("review_traits")})
        if not rv:
            continue
        c_items.append({"task_key": f"{t['change']}__{t['task']}",
                        "change": t["change"], "task": t["task"],
                        "brief_file": t["brief_file"], "reviews": rv})
    c_batches = [{"batch": i, "items": c} for i, c in enumerate(chunks(c_items, 8))]

    for name, batches in [("phase_batches", a_batches), ("complexity_batches", b_batches),
                          ("grading_batches", c_batches)]:
        with open(os.path.join(DATA, f"{name}.json"), "w") as fh:
            json.dump(batches, fh, indent=1)
        n = sum(len(b["items"]) for b in batches)
        print(f"{name}: {len(batches)} batches, {n} items")

    for d in ("phase_labels", "complexity", "grades"):
        os.makedirs(os.path.join(DATA, d), exist_ok=True)


if __name__ == "__main__":
    main()
