#!/usr/bin/env python3
"""Ad hoc Dictator refinement benchmark using only the Python standard library."""

from __future__ import annotations

import argparse
import concurrent.futures
import dataclasses
import datetime as dt
import difflib
import hashlib
import json
import os
import random
import re
import statistics
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_MAIN_ROOT = Path("/Users/joyo/Sheaf")
DEFAULT_CORPUS = DEFAULT_MAIN_ROOT / "data/dictator/interactions"
DEFAULT_API_KEYS = DEFAULT_MAIN_ROOT / "config/api_keys.json"
DEFAULT_OUTPUT_ROOT = Path(
    os.environ.get(
        "DICTATOR_REFINER_BENCHMARK_DATA_ROOT",
        "/Users/joyo/Sheaf/data/dictator/experiments/refiner-benchmark",
    )
)
TOKEN_RE = re.compile(r"[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?")
MARKER_RE = re.compile(r"\b(?:blark|borg)\b", re.IGNORECASE)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as error:
                raise ValueError(f"{path}:{line_number}: {error}") from error
    return rows


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def load_real_records(corpus: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for path in sorted(corpus.glob("*.jsonl")):
        for envelope in read_jsonl(path):
            payload = envelope.get("payload", {})
            raw = (payload.get("whisper_output") or "").strip()
            final = (payload.get("final_output") or "").strip()
            error = payload.get("error_message") or ""
            if payload.get("mode") != "revision" or not raw or not final or error:
                continue
            records.append(
                {
                    "id": payload.get("id") or hashlib.sha256(raw.encode()).hexdigest()[:20],
                    "source": "real",
                    "occurred_at": payload.get("occurred_at") or envelope.get("recorded_at"),
                    "raw": raw,
                    "baseline": final,
                    "optional_context": payload.get("optional_context") or {},
                    "baseline_model": payload.get("model"),
                    "baseline_prompt": payload.get("system_prompt_path"),
                    "has_marker_word": bool(MARKER_RE.search(raw)),
                }
            )
    return records


def normalized_tokens(text: str) -> list[str]:
    return [token.lower().replace("’", "'") for token in TOKEN_RE.findall(text)]


def normalized_space(text: str) -> str:
    return " ".join(text.split())


def similarity(lhs: str, rhs: str) -> float:
    return difflib.SequenceMatcher(None, normalized_tokens(lhs), normalized_tokens(rhs)).ratio()


def edit_metrics(raw: str, output: str) -> dict[str, Any]:
    raw_tokens = normalized_tokens(raw)
    output_tokens = normalized_tokens(output)
    matcher = difflib.SequenceMatcher(None, raw_tokens, output_tokens)
    inserted = deleted = replaced_raw = replaced_output = 0
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "insert":
            inserted += j2 - j1
        elif tag == "delete":
            deleted += i2 - i1
        elif tag == "replace":
            replaced_raw += i2 - i1
            replaced_output += j2 - j1
    raw_count = max(1, len(raw_tokens))
    return {
        "raw_words": len(raw_tokens),
        "output_words": len(output_tokens),
        "word_ratio": len(output_tokens) / raw_count,
        "similarity": matcher.ratio(),
        "edit_fraction": 1.0 - matcher.ratio(),
        "inserted_words": inserted,
        "deleted_words": deleted,
        "replaced_raw_words": replaced_raw,
        "replaced_output_words": replaced_output,
        "same_words_case_punctuation_only": raw_tokens == output_tokens,
        "marker_leaked": bool(MARKER_RE.search(output)),
    }


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def summarize_pairs(rows: list[dict[str, Any]], output_key: str) -> dict[str, Any]:
    measured = [(row, edit_metrics(row["raw"], row[output_key])) for row in rows if row.get(output_key)]
    edits = [metrics["edit_fraction"] for _, metrics in measured]
    word_ratios = [metrics["word_ratio"] for _, metrics in measured]
    return {
        "records": len(measured),
        "unchanged_words_case_or_punctuation_only": sum(
            metrics["same_words_case_punctuation_only"] for _, metrics in measured
        ),
        "shortened_over_20_percent": sum(metrics["word_ratio"] < 0.8 for _, metrics in measured),
        "shortened_over_40_percent": sum(metrics["word_ratio"] < 0.6 for _, metrics in measured),
        "expanded_over_20_percent": sum(metrics["word_ratio"] > 1.2 for _, metrics in measured),
        "edit_fraction": {
            "mean": statistics.fmean(edits) if edits else 0.0,
            "p50": percentile(edits, 0.50),
            "p90": percentile(edits, 0.90),
            "p99": percentile(edits, 0.99),
        },
        "word_ratio": {
            "mean": statistics.fmean(word_ratios) if word_ratios else 0.0,
            "p10": percentile(word_ratios, 0.10),
            "p50": percentile(word_ratios, 0.50),
            "p90": percentile(word_ratios, 0.90),
        },
        "marker_records": sum(row.get("has_marker_word", False) for row, _ in measured),
        "marker_leaks": sum(
            row.get("has_marker_word", False) and metrics["marker_leaked"] for row, metrics in measured
        ),
    }


def stratified_sample(records: list[dict[str, Any]], size: int, seed: int) -> list[dict[str, Any]]:
    if size >= len(records):
        return list(records)
    selected: dict[str, dict[str, Any]] = {}

    def add(rows: Iterable[dict[str, Any]]) -> None:
        for row in rows:
            if len(selected) >= size:
                return
            selected[row["id"]] = row

    marker_rows = [row for row in records if row["has_marker_word"]]
    add(marker_rows)
    ranked = sorted(records, key=lambda row: 1.0 - similarity(row["raw"], row["baseline"]), reverse=True)
    add(ranked[: max(10, size // 5)])

    length_sorted = sorted(records, key=lambda row: len(normalized_tokens(row["raw"])))
    bins = 5
    randomizer = random.Random(seed)
    for bin_index in range(bins):
        start = len(length_sorted) * bin_index // bins
        end = len(length_sorted) * (bin_index + 1) // bins
        bucket = length_sorted[start:end]
        randomizer.shuffle(bucket)
        add(bucket[: max(1, size // bins)])

    remainder = list(records)
    randomizer.shuffle(remainder)
    add(remainder)
    return sorted(selected.values(), key=lambda row: row.get("occurred_at") or row["id"])


def build_production_input(raw: str, context: dict[str, Any]) -> str:
    selected = str(context.get("selected_text") or "").strip()
    if selected:
        return f"Take the following input and modify it based on the following request.\n\nInput text:\n{selected}\n\nRequest:\n{raw}"
    context_lines: list[str] = []
    dictation_context = str(context.get("dictation_context") or "").strip()
    if dictation_context:
        context_lines.append(dictation_context)
    active_app = str(context.get("active_app") or "").strip()
    if active_app:
        context_lines.append(f"Active app: {active_app}")
    active_site = str(context.get("active_site") or "").strip()
    if active_site:
        context_lines.append(f"Active site: {active_site}")
    if not context_lines:
        return raw
    rendered = "\n".join(f"- {line}" for line in context_lines)
    return f"Context:\n{rendered}\n\nTranscript:\n{raw}"


def effective_prompt(base: str, raw: str, blark: str, borg: str) -> str:
    additions: list[str] = []
    if re.search(r"\bblark\b", raw, re.IGNORECASE):
        additions.append("Source: blark rules\nTrigger: blark\n" + blark)
    if re.search(r"\bborg\b", raw, re.IGNORECASE):
        additions.append("Source: borg rules\nTrigger: borg\n" + borg)
    if not additions:
        return base
    return base + "\n\n---\n\nInjectable rules:\n" + "\n\n".join(additions)


def get_api_key(path: Path) -> str:
    from_environment = os.environ.get("OPENAI_API_KEY", "").strip()
    if from_environment:
        return from_environment
    data = json.loads(path.read_text(encoding="utf-8"))
    key = str(data.get("openai_api_key") or "").strip()
    if not key:
        raise RuntimeError(f"No OpenAI API key in environment or {path}")
    return key


def extract_output_text(response: dict[str, Any]) -> str:
    direct = response.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    for item in response.get("output") or []:
        for content in item.get("content") or []:
            text = content.get("text")
            if isinstance(text, str) and text.strip():
                return text.strip()
    raise RuntimeError("Response did not contain output text")


def post_response(api_key: str, payload: dict[str, Any], retries: int = 6) -> dict[str, Any]:
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            if error.code not in {408, 409, 429, 500, 502, 503, 504} or attempt + 1 == retries:
                raise RuntimeError(f"OpenAI HTTP {error.code}: {body[:500]}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt + 1 == retries:
                raise RuntimeError(f"OpenAI request failed: {error}") from error
        time.sleep(min(20.0, (2**attempt) + random.random()))
    raise AssertionError("unreachable")


@dataclasses.dataclass(frozen=True)
class RunConfig:
    name: str
    model: str
    reasoning: str
    base_prompt: Path
    blark_prompt: Path
    borg_prompt: Path


def run_one(row: dict[str, Any], config: RunConfig, api_key: str) -> dict[str, Any]:
    raw = row["raw"]
    base = config.base_prompt.read_text(encoding="utf-8").strip()
    blark = config.blark_prompt.read_text(encoding="utf-8").strip()
    borg = config.borg_prompt.read_text(encoding="utf-8").strip()
    payload: dict[str, Any] = {
        "model": config.model,
        "instructions": effective_prompt(base, raw, blark, borg),
        "input": build_production_input(raw, row.get("optional_context") or {}),
        "max_output_tokens": 8192,
        "store": False,
    }
    if config.reasoning != "omit":
        payload["reasoning"] = {"effort": config.reasoning}
    started = time.monotonic()
    response = post_response(api_key, payload)
    latency_ms = round((time.monotonic() - started) * 1000)
    output = extract_output_text(response)
    result = dict(row)
    result.update(
        {
            "config": config.name,
            "requested_model": config.model,
            "response_model": response.get("model"),
            "reasoning": config.reasoning,
            "output": output,
            "latency_ms": latency_ms,
            "usage": response.get("usage") or {},
            "metrics": edit_metrics(raw, output),
            "recorded_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
    )
    return result


def command_prepare(args: argparse.Namespace) -> None:
    records = load_real_records(args.corpus)
    output = args.output or DEFAULT_OUTPUT_ROOT / "real.jsonl"
    write_jsonl(output, records)
    sample = stratified_sample(records, args.sample_size, args.seed)
    sample_output = output.with_name(f"real-sample-{len(sample)}.jsonl")
    write_jsonl(sample_output, sample)
    marker_output = output.with_name("real-markers.jsonl")
    marker_records = [row for row in records if row["has_marker_word"]]
    write_jsonl(marker_output, marker_records)
    print(
        json.dumps(
            {
                "real_records": len(records),
                "dataset": str(output),
                "sample": str(sample_output),
                "marker_records": len(marker_records),
                "markers": str(marker_output),
            },
            indent=2,
        )
    )


def command_stats(args: argparse.Namespace) -> None:
    rows = read_jsonl(args.dataset)
    output_key = args.output_key
    summary = summarize_pairs(rows, output_key)
    ranked = sorted(
        (row for row in rows if row.get(output_key)),
        key=lambda row: edit_metrics(row["raw"], row[output_key])["edit_fraction"],
        reverse=True,
    )
    summary["largest_edits"] = [
        {
            "id": row["id"],
            "edit_fraction": round(edit_metrics(row["raw"], row[output_key])["edit_fraction"], 4),
            "word_ratio": round(edit_metrics(row["raw"], row[output_key])["word_ratio"], 4),
            "raw": row["raw"],
            "output": row[output_key],
        }
        for row in ranked[: args.examples]
    ]
    rendered = json.dumps(summary, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


def command_run(args: argparse.Namespace) -> None:
    rows = read_jsonl(args.dataset)
    if args.category:
        rows = [row for row in rows if row.get("category") == args.category]
    if args.limit:
        rows = rows[: args.limit]
    config = RunConfig(
        name=args.name,
        model=args.model,
        reasoning=args.reasoning,
        base_prompt=args.base_prompt,
        blark_prompt=args.blark_prompt,
        borg_prompt=args.borg_prompt,
    )
    api_key = get_api_key(args.api_keys)
    output_path = args.output
    existing: dict[str, dict[str, Any]] = {}
    if output_path.exists() and not args.force:
        existing = {row["id"]: row for row in read_jsonl(output_path) if row.get("config") == config.name}
    pending = [row for row in rows if row["id"] not in existing]
    lock = threading.Lock()
    completed = 0
    errors = 0
    output_path.parent.mkdir(parents=True, exist_ok=True)
    mode = "w" if args.force or not output_path.exists() else "a"
    with output_path.open(mode, encoding="utf-8") as output_stream:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
            futures = {executor.submit(run_one, row, config, api_key): row for row in pending}
            for future in concurrent.futures.as_completed(futures):
                row = futures[future]
                try:
                    result = future.result()
                    completed += 1
                except Exception as error:  # keep the study resumable
                    errors += 1
                    result = {
                        **row,
                        "config": config.name,
                        "requested_model": config.model,
                        "reasoning": config.reasoning,
                        "error": str(error),
                        "recorded_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                    }
                with lock:
                    output_stream.write(json.dumps(result, ensure_ascii=False, sort_keys=True) + "\n")
                    output_stream.flush()
                if (completed + errors) % 10 == 0 or completed + errors == len(pending):
                    print(f"{config.name}: {completed + errors}/{len(pending)} complete, errors={errors}", flush=True)
    print(json.dumps({"config": config.name, "cached": len(existing), "completed": completed, "errors": errors, "output": str(output_path)}, indent=2))


def command_score_synthetic(args: argparse.Namespace) -> None:
    rows = [
        row
        for path in args.results
        for row in read_jsonl(path)
        if row.get("output") and not row.get("error")
    ]
    scored: list[dict[str, Any]] = []
    for row in rows:
        expected = row.get("expected", "")
        semantic = expected.startswith("<semantic:")
        exact = normalized_space(row["output"]) == normalized_space(expected) if not semantic else None
        score = similarity(expected, row["output"]) if not semantic else None
        semantic_pass = None
        if semantic and "sonnet" in expected.lower():
            nonempty_lines = [line for line in row["output"].splitlines() if line.strip()]
            semantic_pass = (
                len(nonempty_lines) >= 10
                and "fuego" in row["output"].lower()
                and not bool(MARKER_RE.search(row["output"]))
            )
        scored.append(
            {
                "id": row["id"],
                "category": row.get("category"),
                "exact": exact,
                "similarity": score,
                "semantic_pass": semantic_pass,
                "marker_leaked": bool(MARKER_RE.search(row["output"])) and not bool(MARKER_RE.search(expected)),
            }
        )
    exact_rows = [row for row in scored if row["exact"] is not None]
    categories: dict[str, dict[str, Any]] = {}
    for category in sorted({row["category"] for row in scored}):
        category_rows = [row for row in scored if row["category"] == category]
        exact_category = [row for row in category_rows if row["exact"] is not None]
        categories[category] = {
            "records": len(category_rows),
            "exact": sum(row["exact"] is True for row in exact_category),
            "exact_rate": (sum(row["exact"] is True for row in exact_category) / len(exact_category)) if exact_category else None,
            "mean_similarity": statistics.fmean(row["similarity"] for row in exact_category) if exact_category else None,
            "marker_leaks": sum(row["marker_leaked"] for row in category_rows),
        }
    semantic_rows = [row for row in scored if row["semantic_pass"] is not None]
    passed = sum(row["exact"] is True for row in exact_rows) + sum(row["semantic_pass"] is True for row in semantic_rows)
    summary = {
        "records": len(scored),
        "passed": passed,
        "pass_rate": passed / len(scored) if scored else 0.0,
        "exact": sum(row["exact"] is True for row in exact_rows),
        "exact_rate": (sum(row["exact"] is True for row in exact_rows) / len(exact_rows)) if exact_rows else 0.0,
        "mean_similarity": statistics.fmean(row["similarity"] for row in exact_rows) if exact_rows else 0.0,
        "marker_leaks": sum(row["marker_leaked"] for row in scored),
        "categories": categories,
        "failures": [
            row
            for row in scored
            if row["exact"] is False or row["semantic_pass"] is False or row["marker_leaked"]
        ],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


JUDGE_INSTRUCTIONS = """
You are evaluating a voice-transcription cleanup system. The raw text is Whisper output, not a prose draft.

Desired behavior is conservative:
- preserve the speaker's words, order, tone, informality, hedges, fragments, repetition for emphasis, and level of detail
- execute clear self-corrections and undo/delete/replacement instructions
- fix probable recognition errors when context strongly supports the correction
- remove obvious accidental ASR duplicates or abandoned starts
- add minimal punctuation and capitalization
- execute well-formed Blark/Borg marker spans

Style editing is a defect. Penalize summarizing, reorganizing, shortening for concision, professionalizing, smoothing grammar, synonym substitution, turning prose into an outline, censorship, invented content, or answering a dictated question. Awkward but plausible speech should stay awkward. Do not reward polish.

Score every candidate independently against the raw transcript. Use integers only:
- fidelity: 1 (speaker's voice lost) to 5 (speaker's wording/voice preserved)
- intent: 1 (meaning damaged) to 5 (meaning and details preserved)
- correction: 1 (missed/damaged clear corrections) to 5 (clear ASR/self-corrections handled); use 3 if no correction is evident
- overediting: 0 (none) to 4 (severe rewrite)
- meaning_drift: 0 (none) to 4 (severe)
- overall: 1 (bad) to 5 (ideal conservative refinement)

Allowed failure flags: professionalized, summarized, reorganized, synonymized, deleted_content, added_content, censorship, answered_question, missed_asr, bad_asr_guess, missed_self_correction, bad_self_correction, marker_failure, grammar_overreach, punctuation_only, none.

Return only JSON with exactly this shape:
{"scores":[{"label":"A","fidelity":5,"intent":5,"correction":3,"overediting":0,"meaning_drift":0,"overall":5,"flags":["none"]}],"best":"A","reason":"brief reason"}
Include one score for every supplied label. `best` may be `tie` only when the top candidates are genuinely equivalent.
""".strip()


def parse_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start >= 0 and end > start:
            return json.loads(stripped[start : end + 1])
        raise


def judge_one(
    row: dict[str, Any],
    named_outputs: dict[str, str],
    model: str,
    reasoning: str,
    api_key: str,
) -> dict[str, Any]:
    names = sorted(named_outputs)
    random.Random(str(row["id"])).shuffle(names)
    labels = [chr(ord("A") + index) for index in range(len(names))]
    name_by_label = dict(zip(labels, names))
    candidates = [{"label": label, "text": named_outputs[name]} for label, name in name_by_label.items()]
    judge_input = json.dumps({"raw_transcript": row["raw"], "candidates": candidates}, ensure_ascii=False)
    payload: dict[str, Any] = {
        "model": model,
        "instructions": JUDGE_INSTRUCTIONS,
        "input": judge_input,
        "reasoning": {"effort": reasoning},
        "max_output_tokens": 4096,
        "store": False,
    }
    started = time.monotonic()
    response = post_response(api_key, payload)
    latency_ms = round((time.monotonic() - started) * 1000)
    raw_judgment = parse_json_object(extract_output_text(response))
    scores_by_name: dict[str, Any] = {}
    for score in raw_judgment.get("scores") or []:
        label = score.get("label")
        if label not in name_by_label:
            continue
        score_copy = dict(score)
        score_copy.pop("label", None)
        scores_by_name[name_by_label[label]] = score_copy
    expected_names = set(named_outputs)
    if set(scores_by_name) != expected_names:
        raise RuntimeError(f"Judge omitted candidates: expected={sorted(expected_names)} got={sorted(scores_by_name)}")
    best_label = raw_judgment.get("best")
    best_name = "tie" if best_label == "tie" else name_by_label.get(best_label)
    if best_name is None:
        raise RuntimeError(f"Judge returned invalid best label: {best_label}")
    return {
        "id": row["id"],
        "raw": row["raw"],
        "scores": scores_by_name,
        "best": best_name,
        "reason": raw_judgment.get("reason", ""),
        "label_mapping": name_by_label,
        "judge_model": response.get("model"),
        "judge_reasoning": reasoning,
        "latency_ms": latency_ms,
        "usage": response.get("usage") or {},
        "recorded_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def parse_candidate_spec(spec: str) -> tuple[str, Path]:
    if "=" not in spec:
        raise ValueError(f"Candidate must have NAME=PATH form: {spec}")
    name, raw_path = spec.split("=", 1)
    if not name.strip() or not raw_path.strip():
        raise ValueError(f"Candidate must have NAME=PATH form: {spec}")
    return name.strip(), Path(raw_path)


def command_judge(args: argparse.Namespace) -> None:
    references = read_jsonl(args.dataset)
    result_maps: dict[str, dict[str, dict[str, Any]]] = {}
    for spec in args.candidate:
        name, path = parse_candidate_spec(spec)
        result_maps[name] = {row["id"]: row for row in read_jsonl(path) if row.get("output") and not row.get("error")}
    rows: list[tuple[dict[str, Any], dict[str, str]]] = []
    for reference in references:
        named_outputs = {"baseline": reference["baseline"]}
        missing = False
        for name, result_map in result_maps.items():
            candidate = result_map.get(reference["id"])
            if not candidate:
                missing = True
                break
            named_outputs[name] = candidate["output"]
        if not missing:
            rows.append((reference, named_outputs))
    if args.limit:
        rows = rows[: args.limit]
    api_key = get_api_key(args.api_keys)
    existing: dict[str, dict[str, Any]] = {}
    if args.output.exists() and not args.force:
        existing = {row["id"]: row for row in read_jsonl(args.output) if not row.get("error")}
    pending = [item for item in rows if item[0]["id"] not in existing]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    mode = "w" if args.force or not args.output.exists() else "a"
    completed = errors = 0
    with args.output.open(mode, encoding="utf-8") as output_stream:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
            futures = {
                executor.submit(judge_one, row, named_outputs, args.model, args.reasoning, api_key): row
                for row, named_outputs in pending
            }
            for future in concurrent.futures.as_completed(futures):
                row = futures[future]
                try:
                    result = future.result()
                    completed += 1
                except Exception as error:
                    errors += 1
                    result = {"id": row["id"], "error": str(error), "recorded_at": dt.datetime.now(dt.timezone.utc).isoformat()}
                output_stream.write(json.dumps(result, ensure_ascii=False, sort_keys=True) + "\n")
                output_stream.flush()
                if (completed + errors) % 10 == 0 or completed + errors == len(pending):
                    print(f"judge: {completed + errors}/{len(pending)} complete, errors={errors}", flush=True)
    print(json.dumps({"eligible": len(rows), "cached": len(existing), "completed": completed, "errors": errors, "output": str(args.output)}, indent=2))


def command_summarize_judgments(args: argparse.Namespace) -> None:
    rows = [row for row in read_jsonl(args.results) if row.get("scores") and not row.get("error")]
    names = sorted({name for row in rows for name in row["scores"]})
    summary: dict[str, Any] = {"records": len(rows), "configs": {}}
    for name in names:
        scores = [row["scores"][name] for row in rows if name in row["scores"]]
        flag_counts: dict[str, int] = {}
        for score in scores:
            for flag in score.get("flags") or []:
                flag_counts[flag] = flag_counts.get(flag, 0) + 1
        summary["configs"][name] = {
            "best_votes": sum(row.get("best") == name for row in rows),
            "mean_fidelity": statistics.fmean(float(score["fidelity"]) for score in scores),
            "mean_intent": statistics.fmean(float(score["intent"]) for score in scores),
            "mean_correction": statistics.fmean(float(score["correction"]) for score in scores),
            "mean_overediting": statistics.fmean(float(score["overediting"]) for score in scores),
            "mean_meaning_drift": statistics.fmean(float(score["meaning_drift"]) for score in scores),
            "mean_overall": statistics.fmean(float(score["overall"]) for score in scores),
            "ideal_or_near_ideal": sum(float(score["overall"]) >= 4 and float(score["overediting"]) <= 1 for score in scores),
            "flags": dict(sorted(flag_counts.items(), key=lambda item: (-item[1], item[0]))),
        }
    baseline = "baseline"
    if baseline in names:
        head_to_head: dict[str, Any] = {}
        for name in names:
            if name == baseline:
                continue
            better = worse = equal = 0
            for row in rows:
                candidate = float(row["scores"][name]["overall"])
                current = float(row["scores"][baseline]["overall"])
                if candidate > current:
                    better += 1
                elif candidate < current:
                    worse += 1
                else:
                    equal += 1
            head_to_head[name] = {"better": better, "equal": equal, "worse": worse}
        summary["vs_baseline"] = head_to_head
    summary["tie_votes"] = sum(row.get("best") == "tie" for row in rows)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    subparsers = result.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser("prepare")
    prepare.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    prepare.add_argument("--output", type=Path)
    prepare.add_argument("--sample-size", type=int, default=160)
    prepare.add_argument("--seed", type=int, default=20260713)
    prepare.set_defaults(function=command_prepare)

    stats = subparsers.add_parser("stats")
    stats.add_argument("dataset", type=Path)
    stats.add_argument("--output-key", default="baseline")
    stats.add_argument("--examples", type=int, default=20)
    stats.add_argument("--output", type=Path)
    stats.set_defaults(function=command_stats)

    run = subparsers.add_parser("run")
    run.add_argument("dataset", type=Path)
    run.add_argument("--name", required=True)
    run.add_argument("--model", required=True)
    run.add_argument("--reasoning", choices=["omit", "none", "low", "medium", "high", "xhigh", "max"], default="none")
    run.add_argument("--base-prompt", type=Path, required=True)
    run.add_argument("--blark-prompt", type=Path, required=True)
    run.add_argument("--borg-prompt", type=Path, required=True)
    run.add_argument("--api-keys", type=Path, default=DEFAULT_API_KEYS)
    run.add_argument("--output", type=Path, required=True)
    run.add_argument("--concurrency", type=int, default=8)
    run.add_argument("--limit", type=int)
    run.add_argument("--category")
    run.add_argument("--force", action="store_true")
    run.set_defaults(function=command_run)

    score = subparsers.add_parser("score-synthetic")
    score.add_argument("results", type=Path, nargs="+")
    score.set_defaults(function=command_score_synthetic)

    judge = subparsers.add_parser("judge")
    judge.add_argument("dataset", type=Path)
    judge.add_argument("--candidate", action="append", default=[], help="Candidate as NAME=RESULTS.jsonl")
    judge.add_argument("--model", default="gpt-5.6-terra")
    judge.add_argument("--reasoning", choices=["none", "low", "medium", "high"], default="low")
    judge.add_argument("--api-keys", type=Path, default=DEFAULT_API_KEYS)
    judge.add_argument("--output", type=Path, required=True)
    judge.add_argument("--concurrency", type=int, default=8)
    judge.add_argument("--limit", type=int)
    judge.add_argument("--force", action="store_true")
    judge.set_defaults(function=command_judge)

    summarize = subparsers.add_parser("summarize-judgments")
    summarize.add_argument("results", type=Path)
    summarize.set_defaults(function=command_summarize_judgments)
    return result


def main() -> None:
    args = parser().parse_args()
    args.function(args)


if __name__ == "__main__":
    main()
