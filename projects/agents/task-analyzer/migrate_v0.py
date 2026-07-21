"""One-time migration of the 2026-07-19 ``analysis/sdd-model-analysis/data``
dataset into the task-analyzer sqlite database (Task 8;
``openspec/changes/add-sdd-task-analyzer/design.md``).

The source dataset is the output of an *earlier*, ad-hoc analysis pipeline
(``analysis/sdd-model-analysis/scripts/``) that predates this project's
schema/ingest machinery. This script is a one-shot, format-translating
importer -- not a general ingest path -- that reads the source's already-
computed judgments (complexity/grades/phase-labels) and session facts
verbatim and writes them into this project's schema, converting only what
differs mechanically between the two token/role vocabularies. It dispatches
no agents.

Source files consumed (all read-only, under ``--source``):

- ``codex_sessions.json`` / ``claude_sessions.json``: one record per raw
  session transcript, keyed by ``f"{provider}:{session_id}"``. Carries the
  full session facts (timestamps, model/effort, token totals, turn/tool-call
  counts) that ``tasks.json``'s per-task session lists don't repeat.
- ``tasks.json``: one row per (change, task_key), each carrying
  ``implementer_sessions``/``fixer_sessions``/``review_sessions``/
  ``audit_sessions`` lists of ``{"sid", "kind", ...}`` -- the join between
  sessions and tasks, and each session's *role in that task* (``kind``,
  which also carries the finer ``reviewer-rereview`` distinction folded to
  this schema's plain ``reviewer`` role).
- ``complexity/<change>__<task_key>.json`` / ``grades/<change>__<task_key>.json``:
  already-scored judgments, imported near-verbatim.
- ``phase_labels/<provider>-<native_id>.json`` + ``timelines/<provider>-<native_id>.md``:
  per-turn phase labels and the rendered timeline whose ``## Turn N
  (output_tokens=..., reasoning=..., input=...)`` headers carry each turn's
  output-token delta; joined by turn index and summed per phase into
  ``phase_tokens`` rows. A turn with no label for its index is left out of
  every phase's sum entirely (not defaulted to any phase) so that
  ``costs.rebuild``'s residual/``unlabeled`` bucketing -- documented in
  costs.py as exactly this "a session can be only partially phase-labeled"
  case -- funds the right category for a partially-labeled session, rather
  than this importer guessing a phase for turns nothing ever judged.

Token semantics: the source's ``tokens.input_tokens`` includes cache reads
(old semantics); this schema's ``input_tokens`` must be full-rate-only
(``extractors.TokenTotals`` semantics). For both providers the source's
``cached_input_tokens`` is exactly the cache-read count, so the same
conversion works for both: ``input_new = input_tokens - cached_input_tokens``,
``cached_new = cached_input_tokens`` (verified against the source claude
records' extra ``cache_creation_tokens`` field: ``input_tokens ==
uncached + cache_read + cache_creation``, so ``input_tokens - cache_read ==
uncached + cache_creation``, which is exactly this schema's
``TokenTotals.input_tokens`` definition for claude).

rubric_version/taxonomy_version are hardcoded ``'1'`` and ``scored_by`` is
hardcoded ``'migrated_v0'`` for every row this script writes (per the task
brief -- these are the versions the source dataset's rubrics/taxonomy
happened to be at; not read from ``assets.py`` since this is a historical
import, not a live scoring run).

Idempotent: every write is a keyed upsert (``db.upsert``) and every value
written is derived purely from the source data (no wall-clock timestamps),
so re-running against the same source and the same DB is a no-op --
``db.dump_jsonl`` output is byte-identical across runs. ``costs.rebuild`` is
invoked at the end with a fixed ``as_of``/``computed_at`` for the same
reason (its own output is otherwise wall-clock-dependent).

Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import costs
import db
import discovery

_ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE = Path("analysis/sdd-model-analysis/data")

RUBRIC_VERSION = "1"
TAXONOMY_VERSION = "1"
SCORED_BY = "migrated_v0"

# Fixed (not wall-clock) values so repeated runs -- and costs.rebuild, which
# is otherwise wall-clock-dependent -- are byte-for-byte reproducible. Dated
# to match the dataset this script migrates (task brief: "2026-07-19").
FIXED_INGESTED_AT = "2026-07-19T00:00:00Z"
FIXED_AS_OF = "2026-07-19"
FIXED_COMPUTED_AT = "2026-07-19T00:00:00Z"

_SESSION_LIST_FIELDS = (
    "implementer_sessions",
    "fixer_sessions",
    "review_sessions",
    "audit_sessions",
)

# turn headers: "## Turn N  (output_tokens=X[, reasoning=Y][, input=Z])"
# (extractors.render_timeline's format); X/Y/Z are sometimes literally "?"
# in the source data (an aborted/incomplete turn) -- treated as 0.
_TURN_RE = re.compile(
    r"^## Turn (\d+)\s+\(output_tokens=([^,)\s]+)(?:,\s*reasoning=([^,)\s]+))?"
    r"(?:,\s*input=([^,)\s]+))?\)",
    re.M,
)


def _load_json(path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _fold_role(kind: str) -> str:
    """Fold the source's finer role vocabulary to this schema's 4-role enum
    (design.md: implementer | reviewer | fixer | auditor). Only
    ``reviewer-rereview`` needs folding -- ``kind`` values found in
    tasks.json's session lists are exactly {implementer, fixer, reviewer,
    reviewer-rereview, auditor}."""
    if kind in ("reviewer", "reviewer-rereview"):
        return "reviewer"
    return kind


def _build_raw_lookup(source_dir: Path) -> Dict[str, dict]:
    """``f"{provider}:{session_id}" -> raw session record`` for every raw
    session in codex_sessions.json/claude_sessions.json (945 in the real
    dataset; most are irrelevant chatter never referenced by tasks.json and
    are simply never looked up)."""
    lookup: Dict[str, dict] = {}
    for fname, provider in (("codex_sessions.json", "codex"), ("claude_sessions.json", "claude")):
        path = source_dir / fname
        if not path.exists():
            continue
        for rec in _load_json(path):
            sid = f"{provider}:{rec['session_id']}"
            lookup[sid] = rec
    return lookup


def _harness_entry(raw: dict) -> str:
    """codex records carry ``entry`` (``exec``/``thread_spawn``) directly,
    matching extractors.py's harness_entry values verbatim. claude records
    don't carry ``entry``; ``is_sidechain`` is the source's equivalent of
    extractors.py's subagent detection (verified 1:1 against
    subagent-shaped ``session_id``s in the real dataset)."""
    if "entry" in raw:
        return raw["entry"]
    return "subagent" if raw.get("is_sidechain") else "main"


def _convert_tokens(raw_tokens: dict) -> Tuple[int, int, int, int]:
    """(input_tokens, cached_tokens, output_tokens, reasoning_tokens) in
    extractors.TokenTotals semantics -- see module docstring for the
    conversion rationale (identical arithmetic for both providers)."""
    inp = raw_tokens.get("input_tokens") or 0
    cached = raw_tokens.get("cached_input_tokens") or 0
    out = raw_tokens.get("output_tokens") or 0
    reasoning = raw_tokens.get("reasoning_output_tokens") or 0
    return inp - cached, cached, out, reasoning


def _int_or_zero(s: Optional[str]) -> int:
    try:
        return int(s)
    except (TypeError, ValueError):
        return 0


def _parse_timeline_turns(text: str) -> List[Tuple[int, int]]:
    """[(turn_index, output_tokens), ...] parsed from a rendered timeline's
    turn headers, in file order."""
    turns = []
    for m in _TURN_RE.finditer(text):
        turns.append((int(m.group(1)), _int_or_zero(m.group(2))))
    return turns


def _session_key_to_sid(stem: str) -> Optional[str]:
    """A phase_labels/timelines file stem is ``f"{provider}-{native_id}"``
    (native_id may itself contain dashes, e.g. subagent ids like
    ``agent-<hash>``) -- convert to the ``f"{provider}:{native_id}"`` sid
    used as this schema's session_id."""
    for provider in ("codex", "claude"):
        prefix = provider + "-"
        if stem.startswith(prefix):
            return f"{provider}:{stem[len(prefix):]}"
    return None


def migrate(conn, source_dir) -> Dict[str, int]:
    """Run the full migration against an already-open ``conn``. Returns a
    dict of row counts written, keyed by table/reconciliation name."""
    source_dir = Path(source_dir)
    tasks_data = _load_json(source_dir / "tasks.json")
    raw_lookup = _build_raw_lookup(source_dir)

    task_id_by_key: Dict[Tuple[str, str], int] = {}
    brief_text_by_task_id: Dict[int, Optional[str]] = {}
    session_role_by_sid: Dict[str, str] = {}
    task_by_key: Dict[Tuple[str, str], dict] = {}

    for t in tasks_data:
        change_name = t["change"]
        task_key = t["task"]
        task_by_key[(change_name, task_key)] = t

        db.upsert(conn, "changes", {"name": change_name, "ingested_at": FIXED_INGESTED_AT}, ["name"])
        change_id = conn.execute(
            "SELECT change_id FROM changes WHERE name = ?", (change_name,)
        ).fetchone()[0]

        joined = []
        for field in _SESSION_LIST_FIELDS:
            for s in t[field]:
                raw = raw_lookup.get(s["sid"])
                if raw is None:
                    continue  # defensive; every sid resolves in the real dataset
                joined.append({"sid": s["sid"], "role": _fold_role(s["kind"]), "raw": raw})

        round_map = discovery.assign_review_rounds([
            {
                "session_id": j["sid"], "role": j["role"],
                "started_at": j["raw"].get("started_at"), "ended_at": j["raw"].get("ended_at"),
            }
            for j in joined
        ])

        # brief_text: the archived brief if it survives on disk, else the
        # earliest round-adjacent implementer session's own prompt (task
        # brief's fallback rule -- many historical worktrees are long gone).
        brief_path = t.get("brief_file")
        brief_text: Optional[str] = None
        if brief_path and Path(brief_path).exists():
            brief_text = Path(brief_path).read_text(encoding="utf-8")
        else:
            impl = sorted(
                (j for j in joined if j["role"] == "implementer"),
                key=lambda j: j["raw"].get("started_at") or "",
            )
            if impl:
                brief_text = impl[0]["raw"].get("prompt")

        brief_sha256 = db.sha256_text(brief_text) if brief_text is not None else None
        brief_bytes = len(brief_text.encode("utf-8")) if brief_text is not None else None

        db.upsert(conn, "tasks", {
            "change_id": change_id, "task_key": task_key,
            "brief_path": brief_path, "brief_sha256": brief_sha256,
            "brief_bytes": brief_bytes, "brief_text": brief_text,
        }, ["change_id", "task_key"])
        task_id = conn.execute(
            "SELECT task_id FROM tasks WHERE change_id = ? AND task_key = ?", (change_id, task_key)
        ).fetchone()[0]
        task_id_by_key[(change_name, task_key)] = task_id
        brief_text_by_task_id[task_id] = brief_text

        for j in joined:
            raw = j["raw"]
            input_tokens, cached_tokens, output_tokens, reasoning_tokens = _convert_tokens(
                raw.get("tokens") or {}
            )
            db.upsert(conn, "sessions", {
                "session_id": j["sid"], "task_id": task_id,
                "provider": raw["provider"], "harness_entry": _harness_entry(raw),
                "role": j["role"], "model": raw.get("model"), "effort": raw.get("effort"),
                "started_at": raw.get("started_at"), "ended_at": raw.get("ended_at"),
                "transcript_path": raw.get("file"),
                "input_tokens": input_tokens, "cached_tokens": cached_tokens,
                "output_tokens": output_tokens, "reasoning_tokens": reasoning_tokens,
                "peak_context": raw.get("peak_context"),
                "n_compactions": raw.get("n_compactions"),
                "n_turns": raw.get("n_turns"),
                "n_tool_calls": raw.get("n_tool_calls"),
                "review_round": round_map.get(j["sid"], 0),
            }, ["session_id"])
            session_role_by_sid[j["sid"]] = j["role"]

    conn.commit()

    complexity_written = 0
    for f in sorted((source_dir / "complexity").glob("*.json")):
        data = _load_json(f)
        change_name, _, task_key = data["task_key"].partition("__")
        task_id = task_id_by_key.get((change_name, task_key))
        if task_id is None:
            continue
        db.upsert(conn, "complexity", {
            "task_id": task_id,
            "c1": data["C1"], "c2": data["C2"], "c3": data["C3"], "c4": data["C4"],
            "c5": data["C5"], "c6": data["C6"], "c7": data["C7"],
            "composite": data["composite"],
            "rationale_json": json.dumps(data.get("rationale", {}), sort_keys=True),
            "rubric_version": RUBRIC_VERSION,
            "input_sha256": db.sha256_text(brief_text_by_task_id.get(task_id) or ""),
            "scored_by": SCORED_BY,
        }, ["task_id", "rubric_version"])
        complexity_written += 1
    conn.commit()

    grades_written = 0
    for f in sorted((source_dir / "grades").glob("*.json")):
        data = _load_json(f)
        change_name, _, task_key = data["task_key"].partition("__")
        task_id = task_id_by_key.get((change_name, task_key))
        if task_id is None:
            continue
        t = task_by_key[(change_name, task_key)]

        reviewer_entries = []
        for s in t["review_sessions"]:
            if _fold_role(s["kind"]) != "reviewer":
                continue
            raw = raw_lookup.get(s["sid"])
            started_at = (raw.get("started_at") if raw else None) or s.get("started_at") or ""
            reviewer_entries.append((started_at, s.get("final_text_file")))
        reviewer_entries.sort(key=lambda x: x[0])

        texts = []
        for _started_at, final_text_file in reviewer_entries:
            if not final_text_file:
                continue
            p = source_dir / final_text_file
            if p.exists():
                texts.append(p.read_text(encoding="utf-8"))
        review_text = "\n\n---\n\n".join(texts)

        db.upsert(conn, "grades", {
            "task_id": task_id,
            "g1": data["G1"], "g2": data["G2"], "g3": data["G3"], "g4": data["G4"], "g5": data["G5"],
            "n_critical": data["n_critical"], "n_important": data["n_important"], "n_minor": data["n_minor"],
            "rounds_to_accept": data["rounds_to_accept"],
            "verdict_sequence_json": json.dumps(data.get("verdict_sequence")),
            "final_grade": data["final_grade"],
            "evidence_json": json.dumps(data.get("evidence")),
            "excluded_reviews_json": json.dumps(data.get("excluded_reviews", [])),
            "review_text": review_text,
            "rubric_version": RUBRIC_VERSION,
            "input_sha256": db.sha256_text(review_text),
            "scored_by": SCORED_BY,
        }, ["task_id", "rubric_version"])
        grades_written += 1
    conn.commit()

    phase_labeled_sessions = 0
    for f in sorted((source_dir / "phase_labels").glob("*.json")):
        data = _load_json(f)
        sid = _session_key_to_sid(data["session_key"])
        if sid is None or sid not in session_role_by_sid:
            continue  # not part of any migrated task

        timeline_path = source_dir / "timelines" / f"{data['session_key']}.md"
        if not timeline_path.exists():
            continue
        text = timeline_path.read_text(encoding="utf-8")
        turns = _parse_timeline_turns(text)
        labels: Dict[str, str] = data.get("labels") or {}

        agg: Dict[str, Dict[str, int]] = {}
        for idx, out_tokens in turns:
            phase = labels.get(str(idx))
            if phase is None:
                # Genuinely unlabeled turn (partial historical labeling
                # coverage) -- left out of every phase's sum so
                # costs.rebuild's residual/`unlabeled` bucketing (costs.py:
                # "a session can be only partially phase-labeled") funds the
                # right category, rather than guessing a phase here.
                continue
            bucket = agg.setdefault(phase, {"output_tokens": 0, "turns": 0})
            bucket["output_tokens"] += out_tokens
            bucket["turns"] += 1

        if not agg:
            continue

        input_sha256 = db.sha256_text(text)
        for phase, totals in agg.items():
            db.upsert(conn, "phase_tokens", {
                "session_id": sid, "phase": phase,
                "output_tokens": totals["output_tokens"], "turns": totals["turns"],
                "taxonomy_version": TAXONOMY_VERSION,
                "input_sha256": input_sha256,
                "scored_by": SCORED_BY,
            }, ["session_id", "phase", "taxonomy_version"])
        phase_labeled_sessions += 1
    conn.commit()

    costs.rebuild(conn, as_of=FIXED_AS_OF, taxonomy_version=TAXONOMY_VERSION, computed_at=FIXED_COMPUTED_AT)

    dump_path = _dump_path_for(conn)
    if dump_path is not None:
        db.dump_jsonl(conn, dump_path)

    implementer_fixer_sessions = conn.execute(
        "SELECT COUNT(*) FROM sessions WHERE role IN ('implementer', 'fixer')"
    ).fetchone()[0]
    complexity_rows = conn.execute("SELECT COUNT(*) FROM complexity").fetchone()[0]
    grades_rows = conn.execute("SELECT COUNT(*) FROM grades").fetchone()[0]
    phase_labeled_session_rows = conn.execute(
        "SELECT COUNT(DISTINCT session_id) FROM phase_tokens"
    ).fetchone()[0]
    task_costs_rows = conn.execute("SELECT COUNT(*) FROM task_costs").fetchone()[0]

    return {
        "changes": len({k[0] for k in task_by_key}),
        "tasks": len(task_id_by_key),
        "sessions": len(session_role_by_sid),
        "complexity_written": complexity_written,
        "grades_written": grades_written,
        "phase_labeled_sessions_written": phase_labeled_sessions,
        "implementer_fixer_sessions": implementer_fixer_sessions,
        "complexity_rows": complexity_rows,
        "grades_rows": grades_rows,
        "phase_labeled_session_rows": phase_labeled_session_rows,
        "task_costs_rows": task_costs_rows,
    }


def _dump_path_for(conn) -> Optional[Path]:
    """Duplicated from ingest.py's helper of the same name (avoids importing
    ingest.py here purely for one private helper)."""
    for _seq, name, file in conn.execute("PRAGMA database_list").fetchall():
        if name == "main" and file:
            p = Path(file)
            return p.parent / (p.stem + ".dump.jsonl")
    return None


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="One-time migration of the 2026-07-19 sdd-model-analysis dataset "
        "into the task-analyzer sqlite database."
    )
    p.add_argument("--db", required=True)
    p.add_argument("--source", default=str(DEFAULT_SOURCE))
    return p


def main(argv=None) -> int:
    args = _build_arg_parser().parse_args(argv)
    db_path = Path(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = db.connect(str(db_path))
    try:
        stats = migrate(conn, args.source)
    finally:
        conn.close()
    print(json.dumps(stats, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
