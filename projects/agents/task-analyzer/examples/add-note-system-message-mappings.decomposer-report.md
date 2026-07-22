# Decomposer report: add-note-system-message-mappings

Change: `openspec/changes/archive/2026-07-17-add-note-system-message-mappings/`
Database: `data/agents/task-analyzer.sqlite` (estimator_id 1, `python3 projects/agents/task-analyzer/estimate.py --quantile 0.8`)

This change is already implemented and archived; its real commits
(`514fdee2`, `8fb482a6`, `b24c24aa`, `d9cc2c28`, `57bfa907`) were used only to
ground touch-surface (C1) counts in real diff stats, not to determine task
boundaries — the five candidates below are independent decompositions
generated from `proposal.md`/`design.md`/the three `specs/*/spec.md` files.

## Data-sparsity caveat

Of the estimator's 10 known `(model, effort)` arms, only two —
`gpt-5.5/high` and `gpt-5.6-sol/high` — have posterior coverage for every
category on every task in this change; the other 8 are `unscorable`
(missing categories such as `followup_fix`, `refactor`, `review`). Between
the two scorable arms, `gpt-5.5/high` wins by roughly two orders of
magnitude on both `expected_total_usd` and `pq_total_usd`, so it is the
`selected` arm for every task in every candidate below. This is a property
of the current training data's sparsity, not of any candidate's shape.

## Candidates

| Candidate | Tasks | Grouping axis | expected_total_usd | pq_total_usd (p80) | Guardrail status |
|---|---|---|---|---|---|
| A — checklist-order (fine) | 11 | Brackets `tasks.md`'s own 1.1–3.2 order, test-writing folded into each item as tasks.md phrases it | 115.98 | 957.56 | Qualified (max composite 3.0, task-8) |
| B — checklist-order (coarse) | 3 | One task per `tasks.md` *section* (Typed Button Addresses / Controllers Page Editing / Verification) | 61.16 | 344.18 | **Disqualified** — task-1 and task-2 both composite 3.7 |
| B-split — checklist-order, guardrail split | 5 | B with its two over-3.5 tasks each split in two (backend: address+matching vs. persistence+validation+feedback; UI: blocks vs. view-model+UI wiring) | **71.03** | 388.93 | Qualified (max composite 3.2, task-4) |
| C — subsystem regroup (medium) | 7 | Regrouped by subsystem/build-test target: address model, persistence, validation, output-feedback, blocks+view-model, UI wiring, verification — independent of `tasks.md`'s own order | 88.35 | 450.64 | Qualified (max composite 3.2, task-5) |
| D — subsystem regroup (fine) | 9 | Further subsystem split: address model and press/release classification separated, blocks/view-model/UI wiring each standalone | 81.06 | **380.22** | Qualified (max composite 2.7) |

## Guardrail application

- **Composite ≤ 3.5**: Candidate B is disqualified as generated — bundling
  "address model + matching + persistence + validation + output-feedback" (4
  files, 156-line core diff in the real implementation) into one task scores
  C2=4/C3=4/C4=4 and lands at composite 3.7; the same is true of bundling
  "blocks + view-model + UI wiring" (8 files) into one task. Per the search
  protocol, both were split rather than discarding B outright — B-split is
  that split, generated as its own candidate, and both disqualified B tasks
  drop to composite ≤ 3.2 once separated.
- **Prescriptiveness (C7 ≤ 2)**: every task in every qualifying candidate
  (A, B-split, C, D) already scores C7 ≤ 2 — each task's brief traces
  directly to an explicit design.md decision (D1–D5) or spec scenario
  (`spm-80`/`smi-9`/`sru-27`), so this guardrail didn't need to break any
  ties here.
- **Dependency order**: all four qualifying candidates number tasks so the
  address-model/type-enum work precedes persistence, validation, and
  output-feedback (all of which read the type field), and blocks/view-model
  precede UI wiring; verification is last in every candidate. No forward
  dependencies were introduced.

## Selected: B-split

B-split has the lowest `expected_total_usd` (71.03) of every *qualifying*
candidate — 14% cheaper than the next-best (D, 81.06), and disqualified
B is cheaper still but ineligible. B-split's `pq_total_usd` (388.93) is
within ~2% of D's (380.22, the best tail-risk figure among qualifying
candidates), so the tail-risk guard doesn't flip the pick: choosing on
`expected_total_usd` doesn't trade away meaningful tail safety here. B-split
is selected as the candidate to emit.

Rationale: B-split is the direct guardrail-driven refinement of the
checklist's own natural section boundaries (B) — it keeps B's grouping
intent (typed-address backend work as one lump, Controllers-page editing as
another) but stops short of the point where either lump's composite crosses
3.5. It beats both the finer checklist-order candidate (A, which pays for
11 separate task overheads) and the subsystem regroupings (C, D) on
expected cost, while every task still respects the C7 ≤ 2 prescriptiveness
preference and the dependency-order guardrail.

Emitted: `examples/add-note-system-message-mappings.assignments.yaml`
(5 tasks, all `gpt-5.5/high`, composites 1.5–3.2).
