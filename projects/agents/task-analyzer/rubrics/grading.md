---
version: 1
kind: grading
---

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
