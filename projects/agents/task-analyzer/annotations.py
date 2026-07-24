"""Sibling annotation file format for SDD plans (design.md D1;
specs/task-analyzer-sdd-annotations/spec.md).

An annotation doc is a plain ``dict`` shaped like::

    {
      "format": 1,
      "change": "<openspec-change-name>",
      "estimator_id": <int or None>,
      "tasks": [
        {
          "task": "task-1", "title": "...",
          "model": "gpt-5.5", "effort": "high",
          "complexity": {"C1": 2, ..., "C7": 2, "composite": 2.7},
          "predicted": {"p20_usd": 0.29, "p50_usd": 0.42, "p80_usd": 0.71},
        },
        ...
      ],
    }

Two things live here: a restricted, dependency-free YAML *subset*
parser/writer (the persisted sibling file is
``docs/superpowers/plans/<name>.assignments.yaml``, and pulling in a real
YAML library would violate the stdlib+numpy constraint) and the validator
required by the spec (``validate``), also invocable as a script per spec.md
"Annotation validation" (``python3 annotations.py FILE (--plan PLAN.md |
--tasks task-1,task-2) [--db PATH] [--estimator-id N]``; prints every error
and exits nonzero if any). ``estimate.py`` (Task 10's other file) both
consumes this module to read a candidate decomposition and calls ``write``
to persist a scored one.

The YAML subset is deliberately narrow -- it round-trips exactly the shape
above (two levels: top-level scalars + one list-valued key whose items are
flat mappings, values may be inline ``{k: v, ...}`` flow maps) and nothing
more general: no multi-line scalars, no block sequences of scalars nested
more than two levels, no commas inside a flow-map scalar (the flow-map
splitter is a naive ``str.split(",")``), no anchors/tags. Quoted scalars
*may* contain colons (each line is split on its first ``:`` only, so
``title: "Fix: bug"`` parses correctly) -- just not commas if the value is
inside a ``{...}`` flow map. JSON is the canonical, fully-general
alternative (``--decomposition file.json`` on ``estimate.py``); this parser
exists only so the actual persisted ``.assignments.yaml`` sibling file
(which humans read and diff) doesn't require a new dependency.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence, Tuple

import db

FORMAT_VERSION = 1
_COMPLEXITY_FIELDS = ("C1", "C2", "C3", "C4", "C5", "C6", "C7")
_COMPOSITE_FIELDS = ("C1", "C2", "C3", "C4", "C5", "C6")


# ---------------------------------------------------------------------------
# YAML subset: parser
# ---------------------------------------------------------------------------


def _parse_scalar(v: str) -> Any:
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    if v in ("null", "~", ""):
        return None
    if v == "true":
        return True
    if v == "false":
        return False
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        return v


def _parse_value(v: str) -> Any:
    if v.startswith("{") and v.endswith("}"):
        out: dict = {}
        inner = v[1:-1].strip()
        if inner:
            for part in inner.split(","):
                k, _, val = part.partition(":")
                out[k.strip()] = _parse_scalar(val.strip())
        return out
    return _parse_scalar(v)


def parse_yaml_subset(text: str) -> dict:
    """Parse the restricted YAML subset described in the module docstring.
    Not a general YAML parser -- see the docstring for exactly what's
    supported. Raises no custom exception type; malformed input either
    parses "best effort" (unrecognized lines are silently skipped) or
    raises the underlying ``ValueError``/``IndexError`` from a malformed
    scalar -- this is a tool-internal format, not a public interchange
    format, so that's an acceptable tradeoff for the ~40-line budget.
    """
    doc: dict = {}
    current_list_key: Optional[str] = None
    current_item: Optional[dict] = None
    for raw in text.splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        if stripped.startswith("- "):
            current_item = {}
            doc.setdefault(current_list_key, []).append(current_item)
            key, _, val = stripped[2:].strip().partition(":")
            current_item[key.strip()] = _parse_value(val.strip())
            continue
        key, sep, val = stripped.partition(":")
        if not sep:
            continue
        key, val = key.strip(), val.strip()
        if indent == 0:
            current_list_key, current_item = key, None
            doc[key] = _parse_value(val) if val else []
        elif current_item is not None:
            current_item[key] = _parse_value(val)
    return doc


# ---------------------------------------------------------------------------
# YAML subset: writer
# ---------------------------------------------------------------------------


def _scalar_to_yaml(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v)
    if s and all(c.isalnum() or c in "-_./" for c in s):
        return s
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _flow_map_to_yaml(d: dict) -> str:
    return "{" + ", ".join(f"{k}: {_scalar_to_yaml(v)}" for k, v in d.items()) + "}"


def dump_yaml_subset(doc: dict) -> str:
    """Inverse of ``parse_yaml_subset`` for docs shaped per the module
    docstring; round-trips exactly (verified in tests). Key order follows
    ``doc``'s own iteration order (Python dicts preserve insertion order),
    so callers control field order by how they build the dict."""
    lines = []
    for key, value in doc.items():
        if key == "tasks":
            continue
        lines.append(f"{key}: {_scalar_to_yaml(value)}")
    lines.append("tasks:")
    for task in doc.get("tasks", []):
        prefix = "  - "
        for key, value in task.items():
            rendered = _flow_map_to_yaml(value) if isinstance(value, dict) else _scalar_to_yaml(value)
            lines.append(f"{prefix}{key}: {rendered}")
            prefix = "    "
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Load / write
# ---------------------------------------------------------------------------


def load(path) -> dict:
    """Read an annotation/decomposition doc from ``path``. Dispatches on
    suffix (``.json`` -> ``json.loads``, ``.yaml``/``.yml`` -> the subset
    parser above); any other suffix sniffs the first non-whitespace
    character (``{`` -> JSON, else the YAML subset)."""
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    suffix = path.suffix.lower()
    if suffix == ".json":
        return json.loads(text)
    if suffix in (".yaml", ".yml"):
        return parse_yaml_subset(text)
    return json.loads(text) if text.lstrip().startswith("{") else parse_yaml_subset(text)


def write(doc: dict, path) -> None:
    """Write ``doc`` to ``path``. ``.json`` paths get canonical
    ``json.dumps``; everything else (in particular the real sibling-file
    suffix, ``.assignments.yaml``) gets the YAML subset writer, since that's
    the format design.md D1 actually specifies for the persisted file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == ".json":
        # Canonical: sorted keys + stable separators, so two writes of
        # equivalent content (regardless of dict insertion order) are
        # byte-identical -- verified in tests.
        path.write_text(
            json.dumps(doc, indent=2, sort_keys=True, separators=(",", ": ")) + "\n", encoding="utf-8"
        )
    else:
        path.write_text(dump_yaml_subset(doc), encoding="utf-8")


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _composite_error(label: str, complexity: dict, c_values: dict) -> Optional[str]:
    if len(c_values) != len(_COMPOSITE_FIELDS) or "composite" not in complexity:
        return None
    supplied = complexity["composite"]
    if supplied is None:
        return None
    computed = round(sum(c_values[f] for f in _COMPOSITE_FIELDS) / 6.0, 1)
    try:
        disagrees = abs(float(supplied) - computed) > 1e-9
    except (TypeError, ValueError):
        return f"{label}: composite {supplied!r} is not numeric"
    if disagrees:
        return f"{label}: composite {supplied!r} disagrees with mean(C1..C6) = {computed}"
    return None


def validate(
    doc: dict, plan_tasks: Sequence[str], known_arms: Optional[Iterable[Tuple[str, str]]]
) -> list:
    """Validate an annotation doc per specs/task-analyzer-sdd-annotations/
    spec.md: known ``format``, task keys matching ``plan_tasks`` as a
    *multiset* (every plan task must be annotated exactly once -- an
    annotated task not in the plan is an "unknown task key" error, a plan
    task with no annotation at all is a "missing from annotation" error,
    and a task key annotated more than once is a "duplicate annotation"
    error), complexity integers in 1..5 for C1..C7, ``composite`` equal to
    mean(C1..C6) rounded to one decimal when supplied (omitted is fine --
    callers compute it), and a ``(model, effort)`` pair present in
    ``known_arms``. Returns a list of human-readable error strings; empty
    means valid. Never raises on malformed input -- unexpected shapes turn
    into error strings instead.

    ``known_arms=None`` means "arm identities are unknown -- skip the arm
    check entirely" (the CLI's ``--db``-omitted case: everything else still
    validates, but there is no database to confirm arm names against, so
    treating that as "every arm is unknown" would be a false positive, not
    a real finding). This is distinct from an *empty* ``known_arms``
    iterable (e.g. a real database with a trained estimator whose
    ``config_json["arms"]`` happens to be ``[]``, or no estimator trained
    yet at all) -- that's a real "nothing is known" state and every arm
    correctly fails the check."""
    errors: list = []
    fmt = doc.get("format")
    if fmt != FORMAT_VERSION:
        errors.append(f"unknown format version: {fmt!r} (expected {FORMAT_VERSION})")

    plan_task_set = set(plan_tasks)
    known_arm_set = {tuple(a) for a in known_arms} if known_arms is not None else None
    task_key_counts: Counter = Counter()

    for entry in doc.get("tasks", []):
        task_key = entry.get("task")
        label = task_key if task_key is not None else "<missing task key>"
        task_key_counts[task_key] += 1

        if task_key not in plan_task_set:
            errors.append(f"{label}: unknown task key (not in plan)")

        complexity = entry.get("complexity") or {}
        c_values: dict = {}
        for field in _COMPLEXITY_FIELDS:
            v = complexity.get(field)
            is_valid_int = isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 5
            if not is_valid_int:
                errors.append(f"{label}: {field} must be an integer in 1..5, got {v!r}")
            elif field in _COMPOSITE_FIELDS:
                c_values[field] = v
        composite_error = _composite_error(label, complexity, c_values)
        if composite_error:
            errors.append(composite_error)

        arm = (entry.get("model"), entry.get("effort"))
        if known_arm_set is not None and arm not in known_arm_set:
            errors.append(f"{label}: unknown arm (model={arm[0]!r}, effort={arm[1]!r})")

    for task_key, count in sorted(task_key_counts.items(), key=lambda kv: (kv[0] is None, kv[0])):
        if count > 1:
            errors.append(f"{task_key}: duplicate annotation ({count} entries)")

    for task_key in sorted(plan_task_set - set(task_key_counts)):
        errors.append(f"{task_key}: missing from annotation (required by plan)")

    return errors


# ---------------------------------------------------------------------------
# CLI: invoke the validator as a script
# ---------------------------------------------------------------------------


def _extract_plan_task_keys(text: str) -> list:
    """Extract ``task-N`` keys from a Superpowers plan's ``### Task N:
    ...`` headers (see e.g. docs/superpowers/plans/*.md) -- the convention
    schema.sql documents for ``tasks.task_key`` (``task-3``, ``p2-task-4``,
    ...). Only the plain ``task-N`` numbering is derived here; phased plans
    with ``pN-task-M`` keys should pass ``--tasks`` explicitly instead."""
    return [f"task-{m.group(1)}" for m in re.finditer(r"^### Task (\d+):", text, re.M)]


def _load_known_arms(db_path, estimator_id: Optional[int] = None) -> list:
    """Known ``(model, effort)`` arms from ``config_json["arms"]`` of the
    given (or latest) estimator generation in the database at ``db_path``.
    Returns ``[]`` if there's no trained estimator yet -- the CLI still
    validates everything else, it just can't confirm arm identities.

    Opens ``db_path`` read-only (``db.connect_readonly``): this CLI only
    ever reads arm identities from what is typically the shared main-branch
    database, and must not apply schema.sql or enable WAL against it (see
    ``db.connect_readonly``'s docstring). Propagates ``sqlite3.Error``
    (e.g. a missing/invalid ``--db`` path) to the caller rather than
    swallowing it -- unlike "no trained estimator yet", "the given database
    doesn't exist" is a caller mistake worth surfacing, not something to
    silently treat as "no known arms"."""
    conn = db.connect_readonly(db_path)
    try:
        if estimator_id is None:
            row = conn.execute("SELECT MAX(estimator_id) AS id FROM estimators").fetchone()
            estimator_id = row["id"] if row else None
        if estimator_id is None:
            return []
        row = conn.execute(
            "SELECT config_json FROM estimators WHERE estimator_id = ?", (estimator_id,)
        ).fetchone()
        if row is None:
            return []
        config = json.loads(row["config_json"])
        return [tuple(a) for a in config.get("arms", [])]
    finally:
        conn.close()


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Validate an SDD annotation sibling file.")
    p.add_argument("annotation", help="path to the annotation file (.assignments.yaml or .json)")
    p.add_argument("--plan", help="path to the sibling Superpowers plan .md (task keys parsed from '### Task N:' headers)")
    p.add_argument("--tasks", help="comma-separated explicit task key list (alternative to --plan)")
    p.add_argument(
        "--db", default=None,
        help="path to the task-analyzer sqlite database (for known-arm validation; "
             "omit to skip arm validation entirely -- everything else is still checked)",
    )
    p.add_argument("--estimator-id", type=int, default=None)
    return p


def main(argv=None) -> int:
    args = _build_arg_parser().parse_args(argv)
    if not args.plan and not args.tasks:
        print("error: --plan or --tasks is required", file=sys.stderr)
        return 2

    plan_tasks = (
        [t.strip() for t in args.tasks.split(",") if t.strip()]
        if args.tasks
        else _extract_plan_task_keys(Path(args.plan).read_text(encoding="utf-8"))
    )
    # known_arms=None (--db omitted) skips the arm check entirely (see
    # validate()'s docstring) -- everything else still validates.
    if args.db:
        try:
            known_arms = _load_known_arms(args.db, args.estimator_id)
        except sqlite3.Error as exc:
            print(f"error: cannot open database at {args.db!r}: {exc}", file=sys.stderr)
            return 1
    else:
        known_arms = None

    doc = load(args.annotation)
    errors = validate(doc, plan_tasks, known_arms)

    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        print(f"{len(errors)} error(s)", file=sys.stderr)
        return 1
    print("valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
