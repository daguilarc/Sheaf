---
version: 1
kind: complexity
---

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
