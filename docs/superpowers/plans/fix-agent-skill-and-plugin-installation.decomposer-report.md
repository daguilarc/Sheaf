# Decomposer report: fix-agent-skill-and-plugin-installation

Change: `openspec/changes/fix-agent-skill-and-plugin-installation/`
Database: `/Users/joyo/Sheaf/data/agents/task-analyzer.sqlite` (estimator_id 7, `python3 projects/agents/task-analyzer/estimate.py --seed 0 --mc-draws 2000`)

Four candidates were generated from `proposal.md`, `design.md`, and both
`specs/*/spec.md` files, varying task count (4-12) and grouping axis
(bracketing `tasks.md`'s own section order vs. regrouping by subsystem/build
target independent of that order). Complexity was scored per task against
`rubrics/complexity.md`, grounded in the repository's actual state:
`projects/agents/scripts/install.py` (512 lines, existing
`build_obsolete_global_outputs`/`OBSOLETE_GLOBAL_SKILL_IDS` pattern to
mirror for repo scope), `plugins/xagent/` (package_xagent.py, the
`xagent-subagents` SKILL.md, no existing global-plugin-install script), and
the `plugin-creator` system skill's four helper scripts
(`read_marketplace_name.py`, `update_plugin_cachebuster.py`,
`create_basic_plugin.py`, `validate_plugin.py`) that the new install helper
must orchestrate.

## Estimator coverage

Unlike an earlier estimator generation with only 2/10 scorable arms, all 10
`(model, effort)` arms were fully scorable (`scorable_arms=10/10`) for every
task in every candidate under `estimator_id=7` — no data-sparsity caveat
applies here. The `selected` arm varies per task (mostly `gpt-5.5/high` or
`gpt-5.6-terra/high`, with `gpt-5.6-sol/high` selected for the two costliest
task archetypes — the xagent global-plugin-installer implementation and the
end-to-end verification sweep — where it has the lowest p20 despite a higher
p80).

## Candidates

| Candidate | Tasks | Grouping axis | p20_total_usd | p50_total_usd | p80_total_usd | Guardrail status |
|---|---|---|---|---|---|---|
| A — checklist-order (coarse) | 4 | One task per `tasks.md` section (1: installer scope/cleanup, 2: xagent plugin installer, 3: single-ownership migration, 4: verification) | **734.64** | 8,157.77 | **306,381.26** | Qualified (max composite 3.2, task-2) |
| B — checklist-order (fine) | 12 | Same section order as `tasks.md`, split into test/implementation/docs sub-tasks per checklist item pairing (e.g. 1.1+1.2, then 1.3, then 1.4+1.5) | 10,144.58 | 112,153.67 | 9,705,850.35 | Qualified (max composite 3.2, task-5) |
| C — subsystem regroup (medium) | 6 | Regrouped by subsystem independent of checklist order: installer tests, installer implementation, xagent plugin installer (whole subsystem), skill migration, regeneration+docs sweep, verification | 933.97 | 9,216.58 | 430,621.26 | Qualified (max composite 3.2, task-3) |
| D — subsystem regroup (fine) | 9 | Further subsystem split: installer tests/implementation/docs separated, xagent plugin installer implementation standalone, migration/regen/docs each standalone | 1,647.70 | 19,324.42 | 1,495,914.89 | Qualified (max composite 3.2, task-5) |

(`p20_total_usd` is the selection statistic `estimate.py` ranks arms/candidates
by; `p50_total_usd`/`p80_total_usd` are shown for context. All figures are
`decomposition_totals` from `examples`-style `<candidate>.result.json`,
seed 0, 2000 Monte Carlo draws. Quantiles of the candidate total do not equal
the sum of each task's own quantiles — the totals above are the seeded MC
estimate of the *sum's* quantile, not an arithmetic sum of the per-task
`selected` figures.)

## Guardrail application

- **Composite ≤ 3.5**: no task in any of the four candidates exceeds
  composite 3.2 (the xagent global-plugin-installer work — orchestrating
  atomic package staging, the `plugin-creator` marketplace/cachebuster
  helpers, and `codex plugin` invocation — is the highest-scoring task
  archetype in every candidate that doesn't split it further, at C3=4/C4=4
  for "protocol logic with correctness bounds" crossing build system,
  external CLI, and filesystem boundaries). No split-and-regenerate round
  was needed.
- **Prescriptiveness (C7 ≤ 2)**: every task scores C7 ≤ 2 except the two
  pure-documentation tasks in each candidate (`tasks.md` 1.5 and 3.5, e.g.
  candidate A's task-3 folds 3.5's docs in at C7=2, while B/C/D's standalone
  docs tasks score C7=3) — the spec leaves the exact prose of the ownership
  matrix and recovery guidance open by design, so this is expected, not a
  guardrail violation; documentation prescriptiveness didn't need to break
  any selection ties here since A wins outright on cost.
- **Dependency order**: every candidate numbers tests before the
  implementation they drive (installer tests before installer
  implementation, xagent-installer tests before its implementation),
  implementation before the migration/regeneration steps that depend on it
  (skill removal and installer regeneration are numbered after both the
  agents-installer and xagent-installer implementation tasks), and
  verification last in every candidate. No forward dependencies were
  introduced by any grouping.

## Selected: A — checklist-order (coarse)

Candidate A has the lowest `p20_total_usd` (734.64) of all four candidates —
21% cheaper than the next-best (C, 933.97), 55% cheaper than D (1,647.70),
and over an order of magnitude cheaper than the finest candidate (B,
10,144.58). A's `p80_total_usd` (306,381.26) is also the lowest of the four
(vs. C's 430,621.26, D's 1,495,914.89, B's 9,705,850.35) — `p80_total_usd` is
reported as budgeting information only (`estimate.py` has no tail-risk
exclusion of its own), but A wins on both the selection statistic and the
tail-risk figure simultaneously here.

Rationale: this change's cost is dominated by two task archetypes regardless
of how finely the checklist is sliced — the xagent global-plugin-installer
work (protocol/build-system orchestration, composite 3.2) and the
cross-cutting end-to-end verification sweep (C4=5/C5=5, touching build
system, runtime, an external repository, and a live Codex plugin
installation). Splitting either of `tasks.md`'s four sections into more
tasks (B, D) does not shrink either archetype's own cost — it only adds more
task-level overhead on top of the same two expensive cores, which is why
finer decompositions cost strictly more here despite lower per-task
composites. Candidate A avoids that overhead by keeping one task per
natural checklist section while staying under the composite-3.5 guardrail on
every task, and it beats the medium subsystem regroup (C) even though C
isolates the same two expensive archetypes similarly, because C still pays
for two extra task boundaries (6 tasks vs. A's 4) that A folds into
cheaper neighboring work instead.

Emitted: `fix-agent-skill-and-plugin-installation.assignments.yaml` (4 tasks;
task-1/task-3/task-4 `gpt-5.5/high`, task-2 `gpt-5.6-sol/high`; composites
2.5-3.2).
