---
version: 1
kind: phase-taxonomy
---

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
