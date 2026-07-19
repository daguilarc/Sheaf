# SDD Model Analysis — status & resume instructions

## State (2026-07-19)

Mechanical extraction is **complete and committed**; the LLM labeling fan-out is
**blocked on the Anthropic monthly spend limit** (all subagents failed with
"You've hit your monthly spend limit"). No phase/complexity/grade files were
written yet (`data/phase_labels/`, `data/complexity/`, `data/grades/` are empty).

## What exists

- `scripts/extract_codex.py` — parses every codex session (`~/.codex/sessions`,
  `~/.codex/archived_sessions`; `exec` + `thread_spawn` entries), classifies
  kind (implementer / fixer / reviewer / reviewer-rereview / quest-* / smoke),
  extracts model, effort, task keys, token totals, peak context, compactions,
  per-turn timelines → `data/codex_sessions.json`, `data/timelines/codex-*.md`,
  full reviewer verdict texts → `data/review_texts/`.
- `scripts/extract_claude.py` — same for Claude transcripts
  (`~/.claude/projects/*Sheaf*/*.jsonl` + `*/subagents/agent-*.jsonl`) →
  `data/claude_sessions.json`, timelines, review texts.
- `scripts/build_tasks.py` — joins sessions into per-task rows
  (change × task; implementer/fixer/review/audit sessions, brief + report
  files) → `data/tasks.json`, `data/changes.json`.
- `scripts/make_manifests.py` — batches for the three LLM stages →
  `data/phase_batches.json` (17×~12 timelines),
  `data/complexity_batches.json` (16×~10 tasks),
  `data/grading_batches.json` (16×~8 tasks).
- `rubrics.md` — TDD phase categories, task-complexity rubric (C1–C7),
  implementer grading rubric (G1–G5 + letter grade).

## Key corpus facts

- Implementers are mostly codex: 152 sessions. Models: gpt-5.6-sol (89 high +
  9 xhigh), gpt-5.5 (65 high, 2 medium), gpt-5.6-terra (11 high, 9 medium),
  gpt-5.6-luna (4 medium), gpt-5.4 (4), gpt-5-codex/gpt-5 (1 each).
- Claude implementers: 45 subagents (41 sonnet-5, 3 haiku-4.5, 1 fable-5) in
  `~/.claude/projects/*Sheaf*/<session>/subagents/`.
- Reviewers: Claude opus-4-8 (137) and sonnet-5 (152) dominate; codex gpt-5.5
  reviews Claude-implemented runs (the cross-provider direction).
- 248 task rows, 153 with task id + implementer, 122 gradeable (≥1 review with
  captured verdict text).
- Compactions are rare (a handful across the whole corpus); peak context for
  the biggest implementer runs is ~150k of a 258k window.

## To resume (after spend limit is raised)

1. Re-run `python3 scripts/make_manifests.py` if extraction is re-run (not
   otherwise needed).
2. Dispatch per batch, cheap models, prompts as designed:
   - Stage A (phase labels, haiku): for `data/phase_batches.json` batch N, read
     each item's timeline and write `data/phase_labels/<session_key>.json` with
     `{"session_key":..., "labels": {"<turn>": "<category>"}}` using the
     categories in `rubrics.md` §1.
   - Stage B (complexity, sonnet): rubric §2 → `data/complexity/<task_key>.json`
     with C1..C7 + composite + one-line rationales, from `brief_file` or
     `prompt_fallback` in `data/complexity_batches.json`.
   - Stage C (grades, sonnet): rubric §3 → `data/grades/<task_key>.json` with
     G1..G5, severity counts, verdict sequence, rounds_to_accept, final letter
     grade, from the `review_text` files in `data/grading_batches.json`.
   All three stages are independent; every item is idempotent (one output file
   per item — re-running a batch just overwrites).
3. Aggregate: join phase labels with per-turn token deltas in the timelines'
   session records (codex turn deltas carry full `last_token_usage`; claude
   deltas carry input/cache_read/cache_creation/output) → per-category token
   costs; then merge sessions + complexity + grades into one flat analysis
   table (script to write: `scripts/aggregate.py`).
4. Synthesize: grade × complexity × model/effort × task size (brief bytes,
   diff stats, tokens) → decomposition/model-choice findings.
