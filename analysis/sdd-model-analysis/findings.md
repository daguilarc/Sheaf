# SDD/TDD Implementer Study — Findings (2026-07-19)

Corpus: 203 implementer sessions (155 task rows across ~30 changes), 437
captured review texts. 200 sessions phase-labeled (haiku), 143 tasks
complexity-scored (sonnet, rubric C1–C7), 117 tasks graded from reviewer output
only (sonnet, rubric G1–G5 + letter). All raw per-item JSON lives under
`data/`; the flat join is `data/analysis_tasks.{json,csv}`.

## Headline numbers

### Grades by implementer model (letter counts; mean rounds-to-accept; first-pass rate)

| model / effort | n | A | B | C | D | F | rounds | first-pass |
|---|---|---|---|---|---|---|---|---|
| gpt-5.5 / high | 31 | 20 | 8 | 2 | – | 1 | 1.16 | 84% |
| gpt-5.6-sol / high | 21 | 7 | 7 | 5 | – | 2 | 1.50 | 60% |
| gpt-5.6-sol / xhigh | 3 | – | 3 | – | – | – | 1.00 | 100% |
| gpt-5.6-terra / high | 8 | 4 | 1 | 2 | – | 1 | 1.38 | 62% |
| gpt-5.6-terra / medium | 6 | 3 | 1 | 2 | – | – | 1.50 | 50% |
| gpt-5.6-luna / medium | 3 | 2 | 1 | – | – | – | 1.33 | 67% |
| gpt-5.4 (hi+med) | 4 | 3 | – | 1 | – | – | 1.25 | 75% |
| claude-sonnet-5 (subagent) | 35 | 10 | 3 | 7 | 2 | 13 | 1.89 | 37% |
| claude-haiku-4.5 (subagent) | 3 | 3 | – | – | – | – | 1.00 | 100% |

**Confound warning (do not read the table naively):**
- Model was not randomized over tasks. sonnet-5 was assigned the hardest cohort
  (midi-config-blocks, synth-app-runtime: audio-thread concurrency, mean
  complexity 3.26, median 31M tokens at complexity-4) and its reviewers were
  codex gpt-5.5; the codex implementers were graded by Claude opus/sonnet
  reviewers. Reviewer strictness is therefore entangled with implementer model.
- Controlling to the mid complexity band (2.5–3.8) shrinks but does not erase
  the gap: mean grade gpt-5.6-terra 3.38, gpt-5.5 3.25, gpt-5.6-sol 3.00,
  sonnet-5 2.05 (A=4 scale).
- The sonnet F's are genuine criticals (data races, use-after-free, ordering
  bugs) — but nearly all were caught and fixed within 2–3 review rounds. The
  rubric grades "critical found" as F even when the gate worked as designed.

### What actually predicts quality (bigger effects than model choice)

| factor | mean grade (A=4) |
|---|---|
| complexity ≈2 | 3.46 (n=28) |
| complexity ≈3 | 2.80 (n=40) |
| complexity ≈4 | 2.26 (n=38) |
| brief prescriptiveness C7=1 (exact code/tests given) | 3.45 (n=29) |
| C7=2 (interfaces + tests given) | 2.78 (n=51) |
| C7=3 (requirements only) | 2.05 (n=22) |
| peak context ≤120k | 3.24 (n=62) |
| peak context >120k | 2.35 (n=55) |

Composite complexity, brief prescriptiveness, and peak context each separate
grades by ~a full letter — considerably more than any model swap within the
codex family. Compactions were rare (12/155 tasks) and concentrated in the
worst-performing mega-tasks.

### Token economics

- Median implementer cost grows super-linearly with complexity for the
  expensive models: gpt-5.5 goes 1.7M → 2.1M → 3.2M (complexity 2→3→4), while
  gpt-5.6-sol goes 9.7M → 8.9M → 16.5M and sonnet-5 3.4M → 7.9M → 31.6M.
- **gpt-5.6-sol/high costs 4–8× more tokens than gpt-5.5/high on comparable
  tasks and grades worse.** On this corpus it is dominated: same-or-worse
  quality at much higher cost. (sol/xhigh went 3/3 first-pass B — tiny sample.)
- gpt-5.6-terra/medium ≈ terra/high in grade at roughly half the token cost —
  medium effort looks sufficient below complexity ~3.5.
- Phase split (output tokens, all sessions): green 21%, explore 20%, red 13%,
  verify 9%, report 9%, debug 8%, selfcheck 6%, orient 6%, refactor 1%.
  Codex spends much more on red (19% vs sonnet's low single digits) and less on
  green (12% vs 34%) — codex is markedly more test-first; sonnet's
  implementation-forward style coincides with its higher critical-bug rate in
  concurrent code (suggestive, not causal).
- Fixed overhead per task (orient + explore + report ≈ 35%) is the cost that
  fine-grained decomposition multiplies: N small tasks pay it N times.

## Answers to the two driving questions

**How much decomposition is useful?** The data supports decomposing until each
task sits at complexity ≤3 with peak context under ~120k — beyond that, grades
drop a full letter and rework rounds double. But decomposition below
complexity ~2 wastes the ~35% per-task fixed overhead for no measurable grade
gain (complexity-2 tasks already grade 3.46). The sweet spot on this corpus:
briefs at complexity 2–3, C7 ≤ 2 (interfaces and test cases specified, bodies
left open). C7=1 (paste-ready code in the brief) grades best of all but moves
the real work into planning — it measures where the intelligence was spent,
not a saving.

**When can we downgrade models?** Two supported moves today:
1. gpt-5.5/high over gpt-5.6-sol/high everywhere — better grades, ~5× cheaper
   on this corpus. (If sol has other virtues, they don't show up here.)
2. Effort high → medium for complexity ≤3 tasks (terra evidence; luna/medium
   and gpt-5.4 also performed fine on easy tasks, n small).
Haiku went 3/3 first-pass on complexity ~1.6 tasks — trivial tasks don't need
a frontier implementer at all. Not yet supported: downgrading anything on
complexity ≥4 concurrency work; that's where every model's grade collapses and
the fix should be decomposition, not model choice.

## For the future optimization loop

- Predict final grade from: composite complexity, C7, peak-context estimate
  (brief size + file count is a usable proxy), and model/effort arm. The
  rubric G-scores are consistent enough to serve as the reward signal;
  `rounds_to_accept` is the best single scalar (it monetizes review cost too).
- Reward shaping caveat: grade F-on-caught-critical punishes the gate working;
  for bandit reward prefer `rounds_to_accept` + severity-weighted finding
  counts over the letter.
- Data gaps recorded honestly: 6 dresden + 3 juce-backend tasks have no
  complexity score (briefs deleted from disk before capture — archive
  `.superpowers/sdd/` per change if this matters going forward); ~5 tasks had
  all reviews mis-joined (shared report/brief filenames overwritten across
  changes — namespace SDD artifact files per change to fix at the source).

## Reproduction

`scripts/extract_codex.py && scripts/extract_claude.py && scripts/build_tasks.py
&& scripts/make_manifests.py` → dispatch labeling batches (prompts in
RESUME.md) → `scripts/aggregate.py`. Everything is idempotent per item.

## Addendum: failure-mode taxonomy, gpt-5.5 vs gpt-5.6-sol vs gpt-5.6-terra (2026-07-19)

All reviewer findings on the 70 graded codex tasks classified into a fixed
taxonomy (per-item records in `data/failure_modes/`, behavioral reads in
`data/failure_modes/_behavior_*.md`). Serious = critical+important, per task.
Mean task complexity differs (5.5: 2.95, terra: 3.09, sol: 3.44) — rates are
not complexity-normalized.

| per task | 5.5 (n=32) | sol (n=24) | terra (n=14) |
|---|---|---|---|
| serious findings | 0.38 | 0.83 | 0.93 |
| test-boundary (all sev) | 0.22 | **0.58** | 0.14 |
| test-gap | 0.09 | **0.54** | 0.21 |
| report-inaccuracy | 0.03 | **0.25** | 0.14 |
| concurrency | 0.03 | 0.46 | 0.07 |
| integration | 0.09 | 0.17 | **0.36** |
| logic-bug | 0.38 | 0.38 | 0.36 |
| scope-drift | 0.00 | 0.17 | 0.00 |
| quality-style (minors) | 0.94 | 1.12 | 1.29 |

**Signatures:**
- **gpt-5.5** — fails "cleanly": occasional logic-bug importants plus style
  minors; near-zero test-quality or report-honesty findings. Behaviorally:
  genuine red before green in all sampled sessions, compulsive re-verification,
  honest DONE_WITH_CONCERNS reporting.
- **gpt-5.6-sol** — *test theater*: writes ~2× the test tokens (24.5% of
  output in red) yet leads in tests-that-measure-the-wrong-thing (0.58/task)
  and missing coverage (0.54/task), and overstates results (report-inaccuracy
  0.17 important/task vs 5.5's 0.03). Verification spend does not convert into
  verification. Process waste corroborates: dead polling turns (half of one
  F session was `wait` calls), 136k dragged context, scope-drift.
- **gpt-5.6-terra** — disciplined red-first loop with pre-commit self-review;
  its distinct weakness is **environment/target mismatch**: verifying
  WASM-target code with native clang++ (no em++ in sandbox) — source of its F
  (std::thread shipped into a pthread-less WASM build) — and silently working
  around broken environments instead of escalating. Fails on integration
  boundaries, not test quality.

Implications: sol's failure mode (untrustworthy tests + optimistic reports) is
the expensive kind — it defeats the SDD gate's assumptions and forces reviewer
rounds. Terra's failure mode is addressable by harness/brief changes (provide
target-toolchain verification or an explicit "cannot verify target X" escape
hatch) rather than model choice.
