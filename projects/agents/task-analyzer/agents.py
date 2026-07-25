"""Real xagent dispatch wrapper: ``agents.xagent_runner``, the ``agent_runner``
callable ``ingest.py``'s module docstring documents the contract for (Task 5
landed that contract; this module satisfies it for Task 7).

``xagent_runner(kind, items, staging_dir, *, harness="claude_code", model=None)``
takes the same ``items`` shape ``ingest.py`` passes -- plain dicts, one per
agentic gap, already filtered to exclude gaps a valid staged file already
satisfies (see ``ingest.py``'s "Agentic dispatch contract" docstring section
for the exact per-kind key sets: ``complexity``/``grading`` items carry
``task_key``, ``phase_labeling`` items carry ``session_key``, all three carry
``version``/``input_sha256`` plus one kind-specific text blob). It does not
import ``ingest`` (which Task 6 is concurrently modifying) -- the staging
filename convention and required-key sets are duplicated here deliberately,
as both are part of the stable contract ``ingest.py``'s docstring fixes, not
implementation details of that module.

For each batch of at most ``_MAX_BATCH_SIZE`` items:

1. A scratch work directory is created under
   ``staging_dir/<kind>/_work/<uuid>/``. Each item's text blob
   (``brief_text``/``review_text``/``timeline``) is written to its own file
   there, and ``items.json`` -- the batch manifest the rendered prompt's
   ``{{ITEMS_JSON_PATH}}`` placeholder points at -- lists, per item, its
   entity key and blob file reference, matching the field names the prompt
   text itself names (``brief_file``, ``review_files``, ``timeline_file``).
2. The kind's prompt asset (``assets.load_prompt``) is rendered --
   ``{{RUBRIC_PATH}}``, ``{{ITEMS_JSON_PATH}}``, ``{{OUTPUT_DIR}}``
   substituted -- and written to ``prompt.md`` in the same work dir.
3. xagent is invoked as a subprocess with stdin closed (redirected from
   ``/dev/null`` -- xagent otherwise waits for stdin JSON lines and hangs)
   and stdout redirected to a log file (never piped to a reader that can
   exit early and SIGPIPE the run). The ``--subagent`` argument is a short
   pointer telling the subagent to read the full rendered prompt from
   ``prompt.md`` -- the full prompt (which embeds the rubric) is too large
   and escaping-fragile to pass as a CLI argument directly. The work
   directory is the subprocess's cwd, which is also the seam tests use to
   fake xagent's behavior without ever invoking real node/LLM calls.
4. Each item's expected output file (``{{OUTPUT_DIR}}/<entity_key>.json``)
   is read back and validated against the kind's required-key set. Items
   that are missing, unparsable, or missing required keys are retried
   exactly once, as a second, smaller batch dispatch (fresh work dir). Items
   still invalid after the retry are dropped -- left as an open gap for a
   future run, per ``ingest.py``'s re-read-staging-afterwards contract.
5. Every item that validates (first attempt or retry) is written atomically
   (tmp + rename) to the final staged path,
   ``staging_dir/<kind>/<entity_key>__v<version>__<input_sha256[:12]>.json``
   -- design.md D3's staging filename convention. The list of these final
   paths (never scratch work-dir files) is returned.

Model defaults to the prompt asset's ``model_hint`` frontmatter field
(sonnet/sonnet/haiku for complexity/grading/phase_labeling), overridable via
the ``model`` keyword argument.

The xagent entry point (``node <entry point> run ...``) is resolved, in
order: the ``xagent_main`` keyword argument -> the ``TASK_ANALYZER_XAGENT_MAIN``
environment variable -> the repo-relative default
``projects/xagent/dist/src/main.js``. The resolved path is checked to exist
*before any dispatch*; a missing entry point raises ``RuntimeError`` naming
the resolved path and all three resolution sources, rather than silently
failing every item in the batch (a bare missing-file/misconfigured-checkout
mistake must be loud, not indistinguishable from "the model produced bad
JSON"). Likewise, if the xagent subprocess itself exits nonzero on both the
initial dispatch and its one retry for a batch, ``xagent_runner`` raises
``RuntimeError`` with the exit code and the tail of the captured log --
never silently returning fewer staged files than were dispatched. Nonzero
exit with items still invalid after only one attempt is retried like any
other invalid item; only a *second* nonzero exit for the same items raises.

Stdlib only.
"""
from __future__ import annotations

import json
import os
import subprocess
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import assets

_ROOT = Path(__file__).resolve().parent
_REPO_ROOT = _ROOT.parent.parent.parent
_XAGENT_BIN = _REPO_ROOT / "projects" / "xagent" / "dist" / "src" / "main.js"
_XAGENT_MAIN_ENV_VAR = "TASK_ANALYZER_XAGENT_MAIN"

_MAX_BATCH_SIZE = 12
_LOG_TAIL_CHARS = 4000

# kind -> prompt asset basename (hyphen for phase-labeling, matching
# prompts/phase-labeling.md -- ingest.py's KIND_PROMPT_NAME uses the same
# mapping; duplicated here rather than imported, see module docstring).
_PROMPT_NAME = {"complexity": "complexity", "grading": "grading", "phase_labeling": "phase-labeling"}

# kind -> rubric/taxonomy asset path, substituted into {{RUBRIC_PATH}}.
_RUBRIC_PATH = {
    "complexity": _ROOT / "rubrics" / "complexity.md",
    "grading": _ROOT / "rubrics" / "grading.md",
    "phase_labeling": _ROOT / "rubrics" / "phase-taxonomy.md",
}

# kind -> (entity key field, input-blob field, manifest blob-reference field).
# The manifest field names match how each prompt's own text refers to them
# (complexity: "brief_file"; grading: "review-text file references" -- a
# list, since a task can have multiple review rounds joined into one text;
# phase_labeling: "a reference to that session's turn-by-turn timeline").
_KIND_FIELDS = {
    "complexity": ("task_key", "brief_text", "brief_file"),
    "grading": ("task_key", "review_text", "review_files"),
    "phase_labeling": ("session_key", "timeline", "timeline_file"),
}

# kind -> required top-level keys of a valid produced JSON file for that
# kind. Matches ingest.py's KIND_REQUIRED_KEYS exactly (duplicated
# deliberately -- see module docstring).
#
# followup-7, defect 2: "grading" items have a second valid shape --
# prompts/grading.md's "Ungradeable" contract -- for when every review
# joined to a task turns out to be mis-joined (or grading is otherwise
# impossible) and the agent correctly declines to grade rather than
# fabricating a verdict. That shape carries the SAME required keys (with
# G1-G5/verdict_sequence/rounds_to_accept/final_grade/evidence set to
# `null` rather than real values) plus one additional key, `reason` (a
# non-empty string).
_REQUIRED_KEYS = {
    "complexity": {"task_key", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "composite", "rationale"},
    "grading": {
        "task_key", "G1", "G2", "G3", "G4", "G5", "n_critical", "n_important", "n_minor",
        "verdict_sequence", "rounds_to_accept", "final_grade", "evidence",
        "reviewer_models", "excluded_reviews",
    },
    "phase_labeling": {"session_key", "labels"},
}

# followup-7, fix-round-1 (finding 2): the two valid grading shapes are
# discriminated on SUBSTANCE (whether the G fields are null), never on the
# mere presence of a `reason` key -- an earlier version of this fix used
# `reason`'s presence alone, which would have silently suppressed a real,
# populated grade that happened to also carry a harmless explanatory
# `reason`. Matches ingest.py's identical, deliberately-duplicated copy.
_GRADING_G_FIELDS = ("G1", "G2", "G3", "G4", "G5")


def _grading_shape(data: dict) -> Optional[str]:
    """``"graded"`` when every G field is present and non-null (`reason`,
    if present, is ignored for this classification); ``"ungradeable"``
    when every G field is null AND `reason` is a non-empty string;
    ``None`` (invalid) for anything else -- in particular a half-null
    hybrid (some G fields null, some not)."""
    g_values = [data.get(f) for f in _GRADING_G_FIELDS]
    n_null = sum(1 for v in g_values if v is None)
    if n_null == 0:
        return "graded"
    if n_null == len(g_values):
        reason = data.get("reason")
        if isinstance(reason, str) and reason.strip():
            return "ungradeable"
        return None
    return None  # half-null hybrid -- reject


def _chunks(items: List[dict], size: int) -> List[List[dict]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _validate_output(kind: str, data: Any) -> bool:
    if not isinstance(data, dict):
        return False
    if not _REQUIRED_KEYS[kind].issubset(data.keys()):
        return False
    if kind == "phase_labeling":
        labels = data.get("labels")
        if not isinstance(labels, dict) or not labels:
            return False
    if kind == "grading":
        if _grading_shape(data) is None:
            return False
    return True


def _staging_filename(entity_key: str, version: str, input_sha256: str) -> str:
    return f"{entity_key}__v{version}__{input_sha256[:12]}.json"


def _write_staged(staging_dir: Path, kind: str, entity_key: str, version: str, input_sha256: str, data: dict) -> Path:
    out_dir = Path(staging_dir) / kind
    out_dir.mkdir(parents=True, exist_ok=True)
    fname = _staging_filename(entity_key, version, input_sha256)
    final = out_dir / fname
    tmp = out_dir / (fname + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, final)
    return final


def _resolve_xagent_bin(xagent_main: Optional[str]) -> Path:
    """Resolution order: explicit ``xagent_main`` param -> the
    ``TASK_ANALYZER_XAGENT_MAIN`` env var -> the repo-relative default
    (``_XAGENT_BIN``, read fresh each call so tests can monkeypatch it)."""
    if xagent_main is not None:
        return Path(xagent_main)
    env_val = os.environ.get(_XAGENT_MAIN_ENV_VAR)
    if env_val:
        return Path(env_val)
    return Path(_XAGENT_BIN)


def _require_xagent_bin_exists(resolved: Path) -> None:
    if resolved.exists():
        return
    raise RuntimeError(
        f"xagent entry point not found at {resolved}. Resolved via, in order: "
        f"xagent_main param -> {_XAGENT_MAIN_ENV_VAR} env var -> repo-relative "
        f"default {_XAGENT_BIN}. Refusing to dispatch rather than silently "
        f"produce zero staged files."
    )


def _render_prompt(prompt_text: str, rubric_path: Path, items_json_path: Path, output_dir: Path) -> str:
    return (
        prompt_text.replace("{{RUBRIC_PATH}}", str(rubric_path))
        .replace("{{ITEMS_JSON_PATH}}", str(items_json_path))
        .replace("{{OUTPUT_DIR}}", str(output_dir))
    )


def _invoke_xagent(work_dir: Path, harness: str, model: str, prompt_path: Path, xagent_bin: Path) -> Tuple[int, str]:
    """Runs xagent as a subprocess with stdin closed (``/dev/null`` -- xagent
    otherwise waits for stdin JSON lines and hangs) and stdout redirected to
    a log file inside ``work_dir`` (never piped to a reader that can exit
    early and SIGPIPE the run). The ``--subagent`` value is a short pointer
    at the full rendered prompt file, not the prompt body itself -- the
    rendered prompt (which embeds the rubric) is too large/escaping-fragile
    for a CLI argument. ``cwd=work_dir`` is the seam tests use to locate
    ``items.json``/``prompt.md``/``output/`` without any real dispatch.
    Returns ``(returncode, log_tail)`` -- the tail of the captured
    stdout+stderr log, for a caller to surface if the exit code is nonzero."""
    pointer = f"Read your full task prompt at {prompt_path} and follow it exactly."
    cmd = [
        "node", str(xagent_bin), "run",
        "--harness", harness,
        "--model", model,
        "--subagent", pointer,
    ]
    if harness == "claude_code":
        # Headless scorers must Write their staged output with no human
        # attached to answer an approval prompt; xagent's default
        # ("--permission-mode auto") empirically blocks Write for some
        # models (haiku), stranding the labels in the transcript.
        cmd.extend(["--permission-mode", "acceptEdits"])
    log_path = work_dir / "xagent.log"
    with open(os.devnull, "rb") as devnull, open(log_path, "wb") as log_f:
        result = subprocess.run(cmd, stdin=devnull, stdout=log_f, stderr=subprocess.STDOUT, cwd=str(work_dir), check=False)
    try:
        log_text = log_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        log_text = ""
    return result.returncode, log_text[-_LOG_TAIL_CHARS:]


def _dispatch_batch(
    kind: str, items: List[dict], staging_dir: Path, harness: str, model: str, prompt_text: str, xagent_bin: Path,
) -> Tuple[Dict[str, dict], int, str]:
    """One xagent invocation for at most ``_MAX_BATCH_SIZE`` items. Returns
    ``(results, returncode, log_tail)``: ``results`` maps entity_key ->
    validated output dict for whichever items produced a valid output file
    (items that failed are simply absent); ``returncode``/``log_tail`` are
    the subprocess's exit code and captured log tail, for the caller to
    decide whether a nonzero exit needs to be surfaced."""
    key_field, blob_field, manifest_field = _KIND_FIELDS[kind]

    work_dir = Path(staging_dir) / kind / "_work" / uuid.uuid4().hex
    output_dir = work_dir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest = []
    for i, item in enumerate(items):
        blob_path = work_dir / f"item_{i}.txt"
        blob_path.write_text(item[blob_field], encoding="utf-8")
        entry = {key_field: item[key_field]}
        if manifest_field == "review_files":
            entry[manifest_field] = [str(blob_path)]
        else:
            entry[manifest_field] = str(blob_path)
        manifest.append(entry)

    items_json_path = work_dir / "items.json"
    items_json_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    rendered = _render_prompt(prompt_text, _RUBRIC_PATH[kind], items_json_path, output_dir)
    prompt_path = work_dir / "prompt.md"
    prompt_path.write_text(rendered, encoding="utf-8")

    returncode, log_tail = _invoke_xagent(work_dir, harness, model, prompt_path, xagent_bin)

    results: Dict[str, dict] = {}
    for item in items:
        entity_key = item[key_field]
        out_path = output_dir / f"{entity_key}.json"
        if not out_path.exists():
            continue
        try:
            data = json.loads(out_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if _validate_output(kind, data):
            results[entity_key] = data
    return results, returncode, log_tail


def xagent_runner(
    kind: str,
    items: List[dict],
    staging_dir: Path,
    *,
    harness: str = "claude_code",
    model: Optional[str] = None,
    xagent_main: Optional[str] = None,
) -> List[Path]:
    """Real ``agent_runner`` for ``ingest.py`` (see ``ingest.py``'s module
    docstring for the exact contract this must satisfy). Batches ``items``
    into groups of at most ``_MAX_BATCH_SIZE``, dispatches each batch to
    xagent, validates/retries-once, and returns the final staged paths
    actually written.

    ``xagent_main`` overrides the resolved xagent entry point (see module
    docstring for the full resolution order and the loud-failure guarantees
    around a missing entry point / a subprocess that exits nonzero twice)."""
    if kind not in _KIND_FIELDS:
        raise ValueError(f"unknown kind: {kind!r}")
    if not items:
        return []

    xagent_bin = _resolve_xagent_bin(xagent_main)
    _require_xagent_bin_exists(xagent_bin)

    prompt_text, _prompt_version, model_hint = assets.load_prompt(_PROMPT_NAME[kind])
    resolved_model = model if model is not None else model_hint

    key_field, _blob_field, _manifest_field = _KIND_FIELDS[kind]
    staging_dir = Path(staging_dir)

    written: List[Path] = []
    for batch in _chunks(items, _MAX_BATCH_SIZE):
        results, _rc, _log_tail = _dispatch_batch(kind, batch, staging_dir, harness, resolved_model, prompt_text, xagent_bin)

        invalid = [item for item in batch if item[key_field] not in results]
        if invalid:
            retry_results, retry_rc, retry_log_tail = _dispatch_batch(
                kind, invalid, staging_dir, harness, resolved_model, prompt_text, xagent_bin
            )
            results.update(retry_results)

            still_invalid = [item for item in invalid if item[key_field] not in results]
            if still_invalid and retry_rc != 0:
                keys = ", ".join(item[key_field] for item in still_invalid)
                raise RuntimeError(
                    f"xagent exited {retry_rc} dispatching {kind} batch for [{keys}] "
                    f"(after 1 retry) -- refusing to silently drop these items. "
                    f"Log tail:\n{retry_log_tail}"
                )

        for item in batch:
            entity_key = item[key_field]
            data = results.get(entity_key)
            if data is None:
                continue  # still invalid after retry (non-crash validation failure) -- left as an open gap
            path = _write_staged(staging_dir, kind, entity_key, item["version"], item["input_sha256"], data)
            written.append(path)

    return written
