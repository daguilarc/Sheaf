## Why

The v1 SDD ledger records what the controller observed, not what happened.
Turn rows transition only when the controller calls await, so every gap
between the controller and reality — a dead client, a service restart, a
never-issued await — becomes ledger rot. The 2026-07-27 controller-usability
incident and the subsequent architecture review traced four just-landed
mechanisms to this one design gap: the `conversationalAgents` in-process set
(which silently drops the real work report in its own motivating
NEEDS_CONTEXT flow), the `artifactsByAgent` cache, the one-shot startup
repair in `sdd_store.ts`, and the controller `note` that is appended to the
submitted prompt but recorded nowhere durable. The review's verdict was
accepted: the turn model needs a redesign, not more compensating machinery.

## What Changes

- **BREAKING** Delete the v1 SDD ledger (`sdd_sessions`, `sdd_turns`,
  `sdd_dispatch_log`, schema version 1) and reprovision from scratch. There
  is no migration; the existing data is already inconsistent and is
  discarded. The service refuses to open any `sdd.sqlite` whose schema
  version is not 2 and names the reprovision step in the error.
- Replace the turn-based ledger with a single insert-only `sdd_agents`
  table: one immutable row per dispatched agent, written by the service at
  dispatch, never updated, never deleted. The ledger holds identity and
  lineage only — no status, no report text, no closure timestamp.
- Record each agent's start role from the four-way set `implementer`,
  `reviewer`, `fixer`, `re-reviewer`, plus its brief path, a brief content
  content, and its worktree.
  v1's `task-reviewer`/`code-reviewer` split collapses into `reviewer` with
  a nullable task number.
- Add a `turn.submitted` normalized supervision event: the supervisor
  durably appends the full sanitized submitted text — rendered prompts,
  controller notes, and raw `xagent_message` chit-chat alike — before any
  submit returns. This makes the run logs able to answer "what was this
  agent told" and is the precondition for storing no text in the ledger.
- **BREAKING** Run directories become the system of record. Reports live
  only in `turn.completed` events in `normalized.jsonl`; submitted prompts
  live only in `turn.submitted` events. Deleting a ledger-referenced run
  directory deletes the only copy. Retention policy must treat run
  directories as ledger blob storage.
- **BREAKING** Rework `xagent_sdd_start` into a four-way role union. `fixer`
  and `re-reviewer` become first-class fresh-agent dispatches carrying a
  a real fix template, replacing the incident's
  `--name "Task 4 Fix Round 1"` impersonation.
- Demote `xagent_sdd_followup` to a same-agent continuation convenience: it
  renders and submits but writes nothing to the ledger. When the target run
  is not live it fails with `sdd_agent_not_live`, whose details name the
  recovery path (start a fresh `fixer`/`re-reviewer` with this agent as
  same plan and task). The v1 closed-session dead end ceases to exist.
- **BREAKING** Delete `xagent_sdd_await` and `xagent_sdd_close`. With report
  persistence and ledger closure gone they would be byte-for-byte aliases of
  `xagent_await` and `xagent_close`; controllers use the generic tools.
- Delete the v1 machinery this design supersedes, by name:
  `conversationalAgents`, `artifactsByAgent`, `PersistReportBeforeReturn`,
  `CloseAfterProvider`'s ledger write, `ReconcileTerminalRuns`,
  `abandonOpenTurns`, the one-shot startup repair, and the
  `sdd_report_unbound`, `sdd_turn_unresolved`, `sdd_session_closed`,
  `sdd_followup_missing_paths`, and `sdd_report_path_required` error paths.
- Extend `xagent_list` recovery rows: the `sdd` block carries role, plan,
  task, brief path, and dispatch time; ledger rows with no run
  record surface as `run_missing` dispatch-failure tombstones.

## Capabilities

### Modified Capabilities

- `xagent-service`: v2 ledger schema and insert-only write discipline, the
  `turn.submitted` event, the reduced MCP surface (seven generic tools plus
  `xagent_sdd_start` and `xagent_sdd_followup`), lineage validation, and
  run-directory retention obligations.
- `xagent-sdd-workflow`: the v1 turn-ledger, report-before-return, and
  same-session-mandatory requirements are superseded; the spec sync is an
  explicit implementation task in this change rather than a separate delta
  here.
- `agents-skill-distribution`: `SKILL.md` guidance moves from the four-tool
  SDD flow to dispatch-with-`sdd_start`/`sdd_followup`, await/close like any
  run, and fresh-agent fix/re-review recovery.

## Impact

- Affects `projects/xagent/src/service/` (store, manager, MCP surface, tool
  schemas), `projects/xagent/src/supervision/` (submit-time event emission),
  xagent tests, the packaged plugin skill, and plugin packaging assets.
- Operators delete the existing `data/xagent/sdd.sqlite` once; no data is
  carried forward.
- Controllers written against `xagent_sdd_await`/`xagent_sdd_close` must
  switch to `xagent_await`/`xagent_close`; the input shapes are compatible
  apart from the `agent_id`→`run_id` field name.
- Log-root cleanup or GC gains a hard constraint: run directories referenced
  by `sdd_agents` are evidence, not cache.
