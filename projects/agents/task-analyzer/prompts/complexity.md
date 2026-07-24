---
version: 1
uses_rubric: rubrics/complexity.md
model_hint: sonnet
---

# Task complexity scoring prompt

You are scoring SDD task complexity using the rubric at `{{RUBRIC_PATH}}`.

## Input

Read the batch manifest at `{{ITEMS_JSON_PATH}}`. It lists one entry per item,
each with a `task_key` and a brief/prompt reference (`brief_file`, or a
`prompt_fallback` string when no brief file exists) containing the task text
to score. Read each referenced brief in full before scoring it.

## Scoring

For each item, score dimensions C1 through C7 against the anchors in the
rubric. When uncertain between two adjacent anchor levels, choose the lower
(more conservative) level — never guess high.

Compute `composite` = mean(C1..C6), rounded to one decimal place. C7
(prescriptiveness) measures decomposition style, not difficulty; report it
separately and never fold it into the composite.

## Output

For every item, write one JSON file to `{{OUTPUT_DIR}}/<task_key>.json` with
exactly these keys:

Create each output file with the harness's file-write tool (Write), not with bash/heredocs/python scripts -- shell file writes may be sandboxed in the dispatch context and will silently fail the item.

```json
{
  "task_key": "...",
  "C1": 1,
  "C2": 1,
  "C3": 1,
  "C4": 1,
  "C5": 1,
  "C6": 1,
  "C7": 1,
  "composite": 0.0,
  "rationale": {
    "C1": "one line",
    "C2": "one line",
    "C3": "one line",
    "C4": "one line",
    "C5": "one line",
    "C6": "one line",
    "C7": "one line"
  }
}
```

Score every item in the batch. Output is idempotent — one file per item;
re-running the batch just overwrites it.
