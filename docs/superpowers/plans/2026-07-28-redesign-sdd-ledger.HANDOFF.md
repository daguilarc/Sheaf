# Handoff — execute the SDD ledger v2 redesign

Paste the block below to the next Claude lead agent. Everything it needs is in
the repo; this file exists so the prompt itself stays short enough to read.

---

You are the lead agent for a Superpowers subagent-driven implementation. Read
this whole prompt before doing anything.

## Where you are

Worktree: `/Users/joyo/Sheaf/.claude/worktrees/xagent-controller-usability`
Branch: `worktree-xagent-controller-usability`, rebased on `origin/main`.
Everything below is already committed and green — you are starting clean.

Run all commands from that worktree. Do not `cd` to the main checkout.

## What this is, and why it is unusual

**You are rebuilding xagent's SDD ledger using xagent's SDD facade.** That is
deliberate: this is a bootstrapping and dogfooding exercise as much as a
feature. The system is under construction and parts of it are known bad. When
the tooling misbehaves, that is a finding worth recording, not just an
obstacle — the last session's audit came out of exactly this.

Known broken, do not be surprised by it and do not try to fix it:

- **The task-analyzer estimator is broken.** Its cost predictions for this
  change are nonsense (one task's p80 is $405 billion). The
  `.assignments.yaml` sibling next to the plan records per-task model
  assignments it emitted — **ignore them entirely.** Model choice is given
  below.
- **The decomposition subagent is weak.** Its output was reviewed and
  right-sized by hand; the plan's "Execution guidance" section is the
  authority on what to dispatch, not the raw task count.
- The xagent service itself is mid-repair. Several fixes landed on this branch
  in the previous session; the redesign you are implementing supersedes more.

## The work

Plan: `docs/superpowers/plans/2026-07-28-redesign-sdd-ledger.md`
OpenSpec change: `openspec/changes/redesign-sdd-ledger/` (validates clean)

Read the plan's **Global Constraints** and **Execution guidance** first. The
short version:

- **Nine dispatched tasks**, not eleven. Tasks 7 and 11 are controller
  checkpoints — you run them yourself and record the evidence. Task 8 splits
  into 8a (the irreversible v1 cutover) and 8b (the `xagent_list` v2 shape)
  with a review gate between.
- **Task 4 is the riskiest dispatch** — three deletions across five line ranges
  in `mcp.ts`. Give it the closest review and expect a fix round.
- **Do not restart the xagent service** except where Task 7 and Task 8a say to.
  It is live from this worktree's build; restarting onto a half-landed build
  takes your own tooling down.
- Every task must leave the tree compiling and its tests green. Commit per
  task, never squash.

## Subagents to use

Dispatch everything through xagent's MCP tools. They are attached to this
harness (`xagent_sdd_start`, `xagent_sdd_followup`, `xagent_await`,
`xagent_message`, `xagent_list`, `xagent_close`, `xagent_start_non_sdd`).

- **Implementers: `cursor` harness, model `grok-4.5`, effort `high`.**
- **Reviewers: `claude_code` harness, model `opus`, effort `high`.**

This is the owner's instruction and it overrides both the estimator's
assignments and the workflow skill's default provider rules.

Per the `openspec-superpowers-workflow` skill: run a spec-compliance review
before a code-quality review for each task; keep each task's implementer and
reviewer sessions **open** for fix and re-review rounds; start fresh agents per
task, not per fix round; close nothing until the task passes both verdicts.

Dispatch the full brief as a file and point the implementer at it verbatim.
Do not paraphrase requirements into the dispatch prompt.

Use the `note` field on `xagent_sdd_start` / `xagent_sdd_followup` for anything
the templates have no slot for — in particular **"do not restart the xagent
service"** on every dispatch, and any state a previous cancelled agent left in
the tree.

## Two settled decisions — do not relitigate

- **No migration, with prejudice.** The v1 `sdd.sqlite` is deleted outright.
  No read path, no shim, no best-effort import.
- **Run directories are the system of record.** Reports, prompts, notes, and
  chit-chat live in `<log_root>/<agent_id>/` and nowhere else.

## Verification you own

```bash
cd projects/xagent && npm test          # 367 tests, all passing today
make agents-test                        # 58 + 32, passing
make xagent-plugin-test                 # 29, passing
```

The plugin suite has an asset-drift guard: if you change `projects/xagent/src`,
run `make xagent-plugin-build` and commit the regenerated
`plugins/xagent/assets/**` or that suite fails.

## Stop and ask rather than guess

Stop and report if: an implementer reports BLOCKED you cannot resolve with more
context or a stronger model; implementation reveals the OpenSpec design is
wrong (update the artifacts before continuing, do not paper over it); the
xagent service, OpenSpec, or Superpowers tooling is broken in a way that is not
already listed above.

## Where the previous session left notes

- `docs/superpowers/specs/2026-07-27-xagent-controller-usability-design.md` —
  the incident audit that produced all of this, including three findings that
  were corrected after being got wrong the first time. Worth skimming for how
  the failure modes actually present.
- `openspec/changes/redesign-sdd-ledger/design.md` — section D3a explains why
  there is no lineage column, so it does not get re-added.
