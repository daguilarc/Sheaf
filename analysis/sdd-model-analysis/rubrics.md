# SDD/TDD Analysis Rubrics

Purpose: score every SDD task for **complexity** (from the task brief/prompt +
mechanical diff stats) and every implementer run for **quality** (from reviewer
output only). Scores feed a later optimization loop over task decomposition and
model selection, so every dimension has objective anchors; when a grader is
uncertain between two levels it must choose the lower-information option (the
midpoint) rather than guessing high or low.

## 1. TDD phase categories (token attribution)

Each implementer-session turn is labeled with the single dominant activity.
Aggregation then sums per-turn token deltas per category.

| key | category | what counts |
|-----|----------|-------------|
| `orient` | Orientation | Reading the brief/plan/spec, restating the task, planning the approach |
| `explore` | Exploration | Reading existing source/tests/build files, grepping, tracing interfaces beyond the brief |
| `red` | Red | Writing or modifying tests before/for the change; running them expecting failure |
| `green` | Green | Writing production code to make tests pass; the first passing run of the targeted tests |
| `refactor` | Refactor | Restructuring after green with tests kept passing |
| `verify` | Verification | Full builds, whole-suite runs, warnings checks, linters, `openspec validate`, smoke tests |
| `debug` | Debugging | Diagnosing unexpected failures: re-running with instrumentation, bisecting, fixing regressions |
| `selfcheck` | Self-check | Re-reading own diff, self-review, checking against brief requirements |
| `report` | Reporting | Writing the task report, progress ledger, commit messages, final status message |
| `other` | Other | Compaction overhead, retries, anything not above |

Rules: a turn that both writes a test and its implementation is labeled by the
majority of its output; a test run is `red`/`green` by intent (first
fail-expected run = `red`), `verify` when it is suite-wide or after completion;
fixing a bug the suite caught after green is `debug`, not `green`.

## 2. Task complexity rubric

Score each dimension 1–5 from the task brief (or inline prompt) plus, when
available, mechanical diff stats. Anchors are written so two graders agree.

**C1. Touch surface** — number of files the brief requires creating/modifying
(count the brief's file list; fall back to diff stats).
1: 1 file · 2: 2–3 · 3: 4–6 · 4: 7–10 · 5: >10

**C2. Modification depth** — how much of the work lands inside existing code.
1: only new files · 2: new files + trivial registration edits (≤10 lines in
existing files) · 3: meaningful edits to 1–2 existing files · 4: interleaved
edits across several existing files · 5: restructuring of existing dense logic
(signatures change, callers updated)

**C3. Logic trickiness** — hardest single piece of logic required.
1: plumbing/boilerplate · 2: simple branching or data mapping · 3: nontrivial
algorithm or state machine with edge cases · 4: numeric/DSP math, timing,
concurrency, or protocol logic with correctness bounds · 5: subtle math or
real-time constraints where naive code is silently wrong (filters, PLLs,
resampling, lock-free structures)

**C4. Integration altitude** — how many existing subsystems/interfaces must be
understood and composed correctly.
1: self-contained leaf · 2: implements one existing interface · 3: touches 2–3
subsystems (e.g. engine + tests + build) · 4: crosses module boundaries with
ownership/lifecycle concerns · 5: cross-cutting through build system, runtime,
UI, and external ABI simultaneously

**C5. Testing difficulty** — how hard it is to write a deterministic failing
test for the behavior.
1: pure function assertions · 2: standard fixtures · 3: harness/fake needed
(fake clock, fake device, golden files) · 4: async/threaded/timing-sensitive
assertions or performance budgets · 5: end-to-end environments (browser/WASM,
audio devices, GUI) where automation is partial and smoke checks substitute

**C6. Required context** — how much material beyond the brief must be absorbed.
1: brief is self-contained · 2: skim 1–2 named files · 3: read several files or
one spec document · 4: multiple specs/subsystems, or conventions inferred from
the codebase · 5: broad codebase familiarity effectively assumed

**C7. Prescriptiveness of the brief** (design freedom left to the implementer —
this measures the decomposition style, not difficulty; do not fold into the
composite).
1: brief contains the exact code/tests to write · 2: exact interfaces + test
cases given, bodies open · 3: clear requirements, design open · 4: goals plus
constraints only · 5: outcome statement only

**Composite complexity** = mean of C1–C6, reported to one decimal. Report C7
separately.

## 3. Implementer grading rubric (from reviews only)

Graded per task from reviewer outputs (all rounds), never from the
implementer's own report. Where reviewers disagree, weight the later/stricter
round. Count only findings attributed to the implementation under review (not
pre-existing issues the reviewer notes in passing).

Severity mapping used for counts:
- **critical** — wrong behavior/spec violation that would ship broken (or a
  false claim of testing/verification)
- **important** — real defect or spec gap requiring a fix wave before accept
- **minor** — nits, style, docs, optional improvements, "advisories"

**G1. Spec compliance** — 5: fully compliant first review · 4: compliant,
reviewer notes only interpretation nits · 3: one narrow spec gap fixed in one
round · 2: important requirement missed or misread · 1: implemented the wrong
thing

**G2. Correctness** — 5: no correctness findings · 4: only theoretical/edge
nits · 3: exactly one important correctness bug · 2: multiple important bugs ·
1: any critical bug

**G3. Code quality** — 5: no quality findings · 4: 1–2 minors · 3: several
minors or one structural comment · 2: pattern of quality findings · 1: reviewer
calls structure unacceptable

**G4. Test quality** — 5: reviewer verifies tests genuinely cover behavior incl.
edge cases · 4: solid with small gaps noted · 3: coverage gaps called out ·
2: tests miss the load-bearing boundary (test passes but wrong thing measured) ·
1: missing/vacuous tests

**G5. Process fidelity** — report accuracy, scope discipline, claimed-green
truthfulness. 5: report fully accurate, scope respected · 4: minor overclaim or
scope drift noted · 3: report omissions the reviewer had to correct ·
2: misleading claims or scope violation · 1: false verification claims

**Rounds-to-accept** — number of review rounds until PASS/accept (1 = first
pass). Record verdict sequence (e.g. REVISE→PASS).

**Final grade** (letter, derived):
- **A**: first-round PASS; no critical/important findings; G-scores ≥4
- **B**: PASS after one fix round of minors, or ≤1 important finding overall
- **C**: one rework round driven by important findings, or 2–3 importants
- **D**: multiple rework rounds, a spec misunderstanding, or ≥4 importants
- **F**: critical finding, false verification claim, or abandoned task

When the grade from the letter definition and the G-scores disagree, the letter
definition wins (it is closer to raw reviewer evidence).
