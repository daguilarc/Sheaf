#!/usr/bin/env python3
"""Rank raw Dictator transcripts for interesting, locally repairable awkwardness."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import threading
from pathlib import Path
from typing import Any

import benchmark


RANKING_INSTRUCTIONS = """
You are finding useful human-review examples for a conservative voice-transcription refiner.
You receive raw Whisper transcripts only. You do not see any historical or candidate refinement.

For every supplied transcript, score whether a local rewrite is genuinely warranted:
- 5: unmistakable and interesting repair opportunity; the intended wording is strongly recoverable
- 4: clear repair opportunity, but ordinary or slightly uncertain
- 3: plausible issue that deserves human inspection
- 2: awkward but probably intentional, or the repair would require guessing
- 1: only punctuation/capitalization, ordinary casual speech, or merely verbose
- 0: fluent enough, executable Blark/Borg syntax, or unsuitable for this review

High-value categories:
- stutter: accidental immediate repetition or a speech-production stumble
- abandoned_start: an incomplete fragment clearly superseded by a restart
- self_correction: explicit correction whose final intended version is recoverable
- likely_asr: a likely Whisper mishearing strongly resolved by technical or sentence context
- tangled_syntax: spoken syntax became locally malformed, but a minimal repair is clear
- repetition_loop: an accidental repeated clause or sentence

Do not reward polishing, concision, formality, grammar normalization, removal of hedges, or changing unusual-but-plausible wording. Repetition for emphasis is not a stutter. A high-scoring example must be repairable while preserving the speaker's voice and the rest of the passage.

Return only JSON:
{"items":[{"id":"same id","score":5,"categories":["stutter"],"focus_excerpt":"exact short excerpt copied from the transcript","reason":"brief explanation of the likely repair"}]}

Return exactly one item for every supplied id. The focus excerpt must be copied verbatim and should include enough local context to understand the problem.
""".strip()


def make_batches(rows: list[dict[str, Any]], max_records: int, max_chars: int) -> list[list[dict[str, Any]]]:
    batches: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_chars = 0
    for row in rows:
        size = len(row["raw"])
        if current and (len(current) >= max_records or current_chars + size > max_chars):
            batches.append(current)
            current = []
            current_chars = 0
        current.append(row)
        current_chars += size
    if current:
        batches.append(current)
    return batches


def rank_batch(
    rows: list[dict[str, Any]],
    *,
    api_key: str,
    model: str,
    reasoning: str,
) -> list[dict[str, Any]]:
    request_items = [{"id": row["id"], "transcript": row["raw"]} for row in rows]
    response = benchmark.post_response(
        api_key,
        {
            "model": model,
            "instructions": RANKING_INSTRUCTIONS,
            "input": json.dumps({"transcripts": request_items}, ensure_ascii=False),
            "reasoning": {"effort": reasoning},
            "max_output_tokens": 4096,
            "store": False,
        },
    )
    parsed = benchmark.parse_json_object(benchmark.extract_output_text(response))
    items = parsed.get("items")
    if not isinstance(items, list):
        raise RuntimeError("Ranking response omitted items array")
    by_id = {str(item.get("id")): item for item in items if isinstance(item, dict)}
    expected = {row["id"] for row in rows}
    if set(by_id) != expected:
        raise RuntimeError(f"Ranking ids differ: expected={sorted(expected)} got={sorted(by_id)}")

    ranked: list[dict[str, Any]] = []
    for row in rows:
        item = by_id[row["id"]]
        excerpt = str(item.get("focus_excerpt") or "").strip()
        ranked.append(
            {
                "id": row["id"],
                "raw": row["raw"],
                "score": max(0, min(5, int(item.get("score", 0)))),
                "categories": [str(value) for value in item.get("categories") or []],
                "focus_excerpt": excerpt,
                "excerpt_is_verbatim": bool(excerpt) and excerpt in row["raw"],
                "reason": str(item.get("reason") or "").strip(),
                "ranker_model": response.get("model"),
                "ranker_reasoning": reasoning,
                "usage": response.get("usage") or {},
            }
        )
    return ranked


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", default="gpt-5.6-terra")
    parser.add_argument("--reasoning", default="low", choices=["none", "low", "medium", "high"])
    parser.add_argument("--api-keys", type=Path, default=benchmark.DEFAULT_API_KEYS)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--batch-chars", type=int, default=16000)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    rows = benchmark.read_jsonl(args.dataset)
    existing: dict[str, dict[str, Any]] = {}
    if args.output.exists() and not args.force:
        existing = {row["id"]: row for row in benchmark.read_jsonl(args.output) if not row.get("error")}

    marker_rows = [row for row in rows if row.get("has_marker_word") and row["id"] not in existing]
    pending = [row for row in rows if not row.get("has_marker_word") and row["id"] not in existing]
    batches = make_batches(pending, args.batch_size, args.batch_chars)
    api_key = benchmark.get_api_key(args.api_keys)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    mode = "w" if args.force or not args.output.exists() else "a"
    lock = threading.Lock()
    completed = errors = 0

    with args.output.open(mode, encoding="utf-8") as stream:
        for row in marker_rows:
            stream.write(
                json.dumps(
                    {
                        "id": row["id"],
                        "raw": row["raw"],
                        "score": 0,
                        "categories": ["marker"],
                        "focus_excerpt": "",
                        "excerpt_is_verbatim": False,
                        "reason": "Excluded executable or discussed Blark/Borg syntax from the linguistic review.",
                        "ranker_model": None,
                        "ranker_reasoning": args.reasoning,
                        "usage": {},
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                )
                + "\n"
            )
            completed += 1
        stream.flush()

        def work(batch: list[dict[str, Any]]) -> list[dict[str, Any]]:
            return rank_batch(batch, api_key=api_key, model=args.model, reasoning=args.reasoning)

        with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
            future_map = {executor.submit(work, batch): batch for batch in batches}
            for future in concurrent.futures.as_completed(future_map):
                batch = future_map[future]
                try:
                    results = future.result()
                except Exception as error:
                    errors += len(batch)
                    results = [{"id": row["id"], "raw": row["raw"], "error": str(error)} for row in batch]
                else:
                    completed += len(results)
                with lock:
                    for result in results:
                        stream.write(json.dumps(result, ensure_ascii=False, sort_keys=True) + "\n")
                    stream.flush()
                finished = completed + errors
                if finished % 50 < len(batch) or finished == len(rows):
                    print(f"ranked: {finished}/{len(rows)} complete, errors={errors}", flush=True)

    print(
        json.dumps(
            {
                "records": len(rows),
                "cached": len(existing),
                "completed": completed,
                "errors": errors,
                "batches": len(batches),
                "output": str(args.output),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
