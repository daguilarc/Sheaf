# Dictator Awkwardness Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a more capable conservative refiner prompt and ten human-reviewable examples of genuinely awkward dictation repaired in full-passage context.

**Architecture:** Preserve the benchmarked v3 prompt and add a v4 prompt that selectively borrows Claude's stronger ASR and self-correction guidance. Use a raw-transcript-only Terra ranking pass to identify repair opportunities without bias from candidate outputs, run Luna-low with v4 on the complete selected passages, and publish the focused before/after transformations with full context.

**Tech Stack:** Markdown prompts and report, Python 3 standard library benchmark utilities, OpenAI Responses API, `gpt-5.6-luna` at reasoning `low`, `gpt-5.6-terra` as the ranking model.

## Global Constraints

- Preserve `conservative_v3.md` and its historical results unchanged.
- Prefer no edit when wording is awkward but plausible.
- Remove unmistakable stutters and abandoned starts while preserving repetition used for emphasis.
- Preserve malformed or unmatched Blark/Borg spans.
- Rank examples from raw transcripts before examining new refined outputs.
- Run the refiner on each complete passage, not an isolated sentence.
- Keep generated API traces under ignored `data/dictator-refiner-benchmark/`.

---

### Task 1: Conservative prompt v4

**Files:**
- Create: `projects/dictator/experiments/refiner-benchmark/prompts/conservative_v4.md`

**Interfaces:**
- Consumes: the edit budget and protected-language contract from `conservative_v3.md`.
- Produces: a standalone base prompt accepted by `benchmark.py run --base-prompt`.

- [ ] **Step 1: Copy the v3 behavioral contract into a new v4 prompt**

Keep every protected prose category and the uncertainty rule intact.

- [ ] **Step 2: Add narrowly scoped repair rules**

Add explicit handling for correction cues, unmistakable word stutters, ASR repetition loops, hallucinated boilerplate, and strongly contextual technical terms. State that discourse uses of “I mean” and emphatic repetition are not errors.

- [ ] **Step 3: Inspect the prompt diff**

Run: `diff -u projects/dictator/experiments/refiner-benchmark/prompts/conservative_v3.md projects/dictator/experiments/refiner-benchmark/prompts/conservative_v4.md`

Expected: only the agreed repair guidance is added or clarified; protected-language and uncertainty rules remain.

### Task 2: Synthetic regression

**Files:**
- Generate: `data/dictator-refiner-benchmark/luna-v4base-low-synthetic*.jsonl`

**Interfaces:**
- Consumes: `synthetic.jsonl`, `conservative_v4.md`, `blark_v3.md`, and `borg_v4.md`.
- Produces: five independent 45-case Luna-low trials.

- [ ] **Step 1: Run five complete trials**

Run `benchmark.py run` five times with unique configuration names and result files.

Expected: 225 result rows and zero API errors.

- [ ] **Step 2: Score all trials together**

Run: `benchmark.py score-synthetic <five result paths>`

Expected gates: fidelity 30/30, no valid marker leaks, and no material regression from the v3 prompt set's 198/225 total.

- [ ] **Step 3: Reject or revise v4 if fidelity regresses**

Inspect every fidelity, malformed-marker, and semantic-Borg failure before using v4 on real passages.

### Task 3: Raw awkwardness ranking

**Files:**
- Create: `projects/dictator/experiments/refiner-benchmark/rank_awkwardness.py`
- Generate: `data/dictator-refiner-benchmark/awkwardness-ranking.jsonl`

**Interfaces:**
- Consumes: the 756-row `real.jsonl` corpus prepared by the benchmark.
- Produces: one ranking record per transcript with `id`, `score`, `categories`, `focus_excerpt`, and `reason`.

- [ ] **Step 1: Implement raw-only batched ranking**

Send batches of transcripts to Terra without baseline or candidate outputs. Ask for high scores only when a local repair is likely warranted: stutter, abandoned start, explicit self-correction, malformed syntax from speech, or strongly supported ASR error.

- [ ] **Step 2: Exclude unsuitable showcase candidates**

Exclude executable marker cases, selected-text transformations, trivial punctuation-only issues, and passages whose repair would require guessing the speaker's intent.

- [ ] **Step 3: Run and validate the ranker**

Run: `python3 projects/dictator/experiments/refiner-benchmark/rank_awkwardness.py ...`

Expected: 756 ranked rows, zero duplicate IDs, and no missing source IDs.

### Task 4: Select and refine ten passages

**Files:**
- Generate: `data/dictator-refiner-benchmark/awkward-top10-input.jsonl`
- Generate: `data/dictator-refiner-benchmark/luna-v4base-low-awkward-top10.jsonl`

**Interfaces:**
- Consumes: Terra's highest-ranked candidates and the original full passages.
- Produces: ten diverse, interesting, locally repairable examples and their complete Luna-low refinements.

- [ ] **Step 1: Manually inspect the high-scoring shortlist**

Choose ten examples spanning stutters, abandoned starts, self-corrections, likely technical mishearings, and tangled spoken syntax. Avoid ten variants of the same error.

- [ ] **Step 2: Run Luna-low with the complete prompt set**

Use v4 plus `blark_v3.md` and `borg_v4.md`; pass each complete original transcript as the refiner input.

Expected: ten outputs, zero errors, and no output containing judge commentary.

- [ ] **Step 3: Identify the focused transformation**

For each passage, isolate the smallest original/refined span that explains the repair while retaining the complete passages for context.

### Task 5: Human review report and verification

**Files:**
- Create: `projects/dictator/docs/experiments/2026-07-13-awkward-dictation-review.md`

**Interfaces:**
- Consumes: the ten source records, Luna outputs, ranking explanations, and focused spans.
- Produces: the requested human-reviewable report.

- [ ] **Step 1: Write the ten-example report**

For every example include: why selected, full original passage, full refined passage, and focused `original → refined` transformation. Do not label an uncertain correction as definitively right.

- [ ] **Step 2: Verify generated artifacts**

Check record counts, duplicate IDs, API errors, prompt hashes, and report coverage of all ten selected IDs.

- [ ] **Step 3: Report results without changing production configuration**

Summarize prompt regressions/improvements and link the v4 prompt, report, and ignored raw traces. Leave runtime configuration unchanged until the user judges the examples.
