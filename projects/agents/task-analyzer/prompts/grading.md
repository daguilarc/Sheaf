---
version: 1
uses_rubric: rubrics/grading.md
model_hint: sonnet
---

# Implementer grading prompt

Grade implementer runs using the rubric at `{{RUBRIC_PATH}}`. Grade from
reviewer output only — never from the implementer's own report.

## Input

Read the batch manifest at `{{ITEMS_JSON_PATH}}`. Each entry has a `task_key`
and one or more review-text file references (all review rounds for that
task). Read every review text in full before grading.

Before grading, identify any review texts that are clearly mis-joined to this
task (e.g. they discuss a different task or brief entirely, most likely an
upstream join error). Exclude those from scoring, list them in
`excluded_reviews`, and do not let them influence severity counts or grades.

## Grading

- Map each finding to a severity per the rubric: critical / important /
  minor. Count only findings attributed to the implementation under review,
  not pre-existing issues a reviewer notes in passing.
- Count `n_critical`, `n_important`, `n_minor` across all non-excluded
  reviews.
- Record the `verdict_sequence` (e.g. `REVISE→PASS`) and `rounds_to_accept`
  (number of review rounds until PASS/accept; 1 = first-round pass).
- Score G1–G5 per the rubric anchors. Where reviewers disagree across rounds,
  weight the later/stricter round.
- Derive `final_grade` (a letter, A–F) from the letter-grade definition in the
  rubric. If the letter definition and the G-scores disagree, the letter
  definition wins — it is closer to raw reviewer evidence.
- Record `reviewer_models` (the model(s) that authored the included reviews)
  and `evidence` (short citations/quotes backing the scores).

## Output

For every item, write one JSON file to `{{OUTPUT_DIR}}/<task_key>.json` with
exactly these keys:

```json
{
  "task_key": "...",
  "G1": 1,
  "G2": 1,
  "G3": 1,
  "G4": 1,
  "G5": 1,
  "n_critical": 0,
  "n_important": 0,
  "n_minor": 0,
  "verdict_sequence": "...",
  "rounds_to_accept": 1,
  "final_grade": "A",
  "evidence": "...",
  "reviewer_models": ["..."],
  "excluded_reviews": ["..."]
}
```

Grade every gradeable item in the batch. Output is idempotent — one file per
item; re-running the batch just overwrites it.
