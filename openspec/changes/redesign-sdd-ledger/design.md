## Context

The v1 SDD ledger (schema version 1, `sdd_sessions` + `sdd_turns`) models
each dispatched turn as a mutable row driven through
prepared → running → completed/failed/abandoned. The transitions fire from
the MCP request path: `MarkCompleted` runs inside
`PersistReportBeforeReturn`, which runs only when the controller happens to
call await. The supervisor meanwhile maintains its own durable record —
`metadata.json` phase, `normalized.jsonl` events including `turn.completed`
with the final report text, and (post-B2) `raw-provider.jsonl` — regardless
of what the controller does.

Two records of the same lifecycle, synchronized by a fallible controller,
produced exactly the rot the 2026-07-27 incident documented: 6 of 15 turn
rows stuck `running` forever under closed sessions. The branch that landed
before this change compensated with close-time `abandonOpenTurns`, startup
`ReconcileTerminalRuns`, a one-shot repair query in the store constructor,
an in-process `conversationalAgents` set to classify chit-chat replies, and
an `artifactsByAgent` cache with a ledger fallback. The architecture review
identified all of these as symptoms of one gap — the ledger mirrors the
controller's observations instead of the event log — and the repo owner
accepted a from-scratch redesign under five constraints:

1. Ledger correctness must not depend on controller cooperation, ordering,
   or survival.
2. Do not duplicate the JSONL; store only what the run logs cannot answer.
3. One row per agent, not per turn or per round.
4. Record the role the agent starts as (`implementer`, `reviewer`, `fixer`,
   `re-reviewer`) plus the brief. The role identifies the agent, never the
   turn, and never mutates.
5. Same-agent continuation is an optimization, never an invariant: agents
   die, fixes go to fresh agents on different models, and replacements take
   over mid-turn.

## Goals / Non-Goals

Goals:

- A ledger that cannot rot: no mutable state, no repair, no reconciliation.
- SQL answers to "which run was the Task 4 implementer" and "what work is
  still in flight"; log answers to "why did this agent stop" and "what was
  this agent told".
- First-class fresh-agent fix and re-review dispatch with recorded lineage.
- Durable submitted text (prompts, notes, chit-chat) with zero controller
  cooperation.

Non-Goals:

- Migrating v1 data. The database is reprovisioned; existing rows are
  discarded as already inconsistent.
- Per-turn SQL analytics ("how many fix rounds did task 4 take across all
  agents"). That becomes a log read; the trade is accepted under
  constraint 3.
- Provider-thread resume across service restarts (the C1 discussion item).
  This design paves the fresh-agent recovery path instead; resume remains a
  separate decision.

## Decisions

### D1: The ledger is an immutable dispatch index, not a state machine

The review proposed driving turn-row transitions from the supervisor's
event sink. Constraints 1–3 point at a stronger answer: once rows are
per-agent and content lives in the run logs, there is no state left for the
ledger to hold — so it holds none. The v2 ledger is insert-only. A row is
written once, at dispatch, by the service, and never updated or deleted.
There is no `status`, no `closed_at`, no turn table.

This satisfies constraint 1 structurally rather than procedurally: a ledger
with no mutable state cannot disagree with the supervisor, needs no
close-time write-through, no startup repair, and nothing from the
controller — because there is nothing to keep synchronized. Everything that
changes over an agent's life (phase, reports, failures, conversation)
already has a durable, service-written home in the run record, maintained
by the supervisor's sinks whether or not the controller is alive. The
ledger's only job is the thing the run logs structurally cannot answer:
which run is which, and who relates to whom.

### D2: `turn.submitted` — make the JSONL able to answer "what was told"

Constraint 2 assumes the prompts and chit-chat are already in the JSONL.
Today that is only partly true: the raw provider stream echoes input on
some harnesses and not reliably on others, and the controller `note` landed
on this branch appended to the submitted text but recorded nowhere durable
— not in the prompt file at `prompt_path`, not in the ledger.

Rather than store submitted text in the ledger, the supervisor emits a
`turn.submitted` normalized event on every `submit()`, carrying the full
sanitized submitted text — rendered role prompt plus appended note, or a
raw `xagent_message`. It receives the next sequence number, is appended via
the existing `eventSink` before submit returns, and is excluded from await
wakes (`isPersistedAwaitWake` ignores it, like healthy deltas — it must
never complete an await or enter leader context).

This one log-side addition is what permits the ledger to store no text. It
is a hard precondition, not an enhancement: without it, dropping the turn
table loses "what was this agent told" entirely. It also supersedes the
`note` durability gap by construction, and it covers generic (non-SDD) runs
as a bonus.

### D3: Schema v2

```sql
PRAGMA user_version = 2;   -- reprovision: the v1 sdd.sqlite is deleted, no migration

CREATE TABLE sdd_agents
(
    agent_id      TEXT PRIMARY KEY,     -- the xagent run id; joins to <log_root>/<agent_id>/
    plan_path     TEXT NOT NULL,
    task          INTEGER,              -- NULL = whole-branch scope
    role          TEXT NOT NULL CHECK (role IN
                      ('implementer', 'reviewer', 'fixer', 're-reviewer')),
    brief_path    TEXT NOT NULL,
    brief_text    TEXT NOT NULL,        -- the brief as dispatched
    cwd           TEXT NOT NULL,
    dispatched_at TEXT NOT NULL,
    CHECK (task IS NULL OR task > 0)
);

CREATE INDEX sdd_agents_assignment ON sdd_agents(plan_path, task, role);
```

Column-by-column justification against constraint 2:

- `agent_id` — the join key to the run record. Identity itself.
- `plan_path`, `task`, `role` — the assignment. This is the core
  information the run logs cannot answer without opening every run
  directory and parsing prompts: "which run was the Task 4 implementer"
  must be a SQL query, not archaeology. `plan_name` is not a column; it is
  `basename(plan_path)`, derived in queries and the view consumer.
- `brief_path` — which brief file the agent was pointed at (constraint 4).
  Identity only; the content is in `brief_text` below.
- `brief_text` — the brief exactly as dispatched. This is the one place
  constraint 2's premise does not hold: several templates pass `--brief` as a
  *path* rather than inlining it, so for those agents the brief content never
  entered the prompt and is therefore in no `turn.submitted` event. Briefs also
  live in worker-writable worktrees that get edited across fix rounds and
  deleted afterwards. Storing the text is equivalent to writing a copy into the
  run directory — same durability, one SQL query instead of a file hunt — and
  it is one row per agent, so constraint 3 is untouched. It also subsumes drift
  detection: compare the file at `brief_path` against `brief_text`.
- `dispatched_at` — mild duplication of run `created_at`, kept
  deliberately: ordering the rounds of a task must work in SQL without
  opening N metadata files, and it still orders dispatch-failure tombstones
  (D4) that have no run record at all.

No uniqueness constraint on `(plan_path, task, role)`: constraint 5
requires multiple implementers or fixers per task to coexist.

Explicitly not stored, and where it lives instead:

| Dropped from v1 | Lives in |
|---|---|
| turn rows, turn status, `resume_sequence`/`completed_sequence` | `normalized.jsonl`: `turn.submitted` / `turn.completed` / terminal events, already sequence-ordered |
| `report_text` | the `turn.completed` payload in `normalized.jsonl` — already what persisted-await reads; the v1 ledger copy was redundant, so the report is deliberately not recorded in the ledger at all |
| `findings_text`, prompt text, notes, chit-chat | `turn.submitted` events |
| `predecessor_agent_id` lineage | nothing — deliberately dropped; see D3a |
| session `status` / `closed_at` | run `metadata.json` `supervision.phase`, maintained by the supervisor's `metadataSink` |
| `harness`, `agent` (model), `effort` | run `metadata.json`; `xagent_list` already joins it |
| fix/re-review `round` numbers | the `turn.submitted` prompt text and dispatch order within `(plan_path, task)` |

### D3a: Why there is no lineage column

An earlier draft carried `predecessor_agent_id`, required for `fixer` and
`re-reviewer` and optional for takeovers. It is dropped, because the service
cannot determine it — only the controller can, and constraint 1 says the
ledger must be correct no matter what the lead does. A required link fails
closed (a fixer without one is an error), but the *optional* takeover link is
the case that matters most and it would silently go missing whenever the lead
forgot, producing an orphan row indistinguishable from a first dispatch.

What is lost is precision in one case: with two concurrent fixers on one task,
"which fixed which" is no longer recorded. What is kept covers every forensic
question that was actually asked — `(plan_path, task, role)` ordered by
`dispatched_at` yields the sequence implementer → reviewer → fixer →
re-reviewer without the controller supplying anything. Ordering is derived from
data the service writes itself; lineage was derived from data the lead had to
remember. Between an always-correct approximation and a sometimes-missing
exact answer, constraint 1 picks the former.

### D4: Lifecycle without controller cooperation

Dispatch: `xagent_sdd_start` inserts the row before creating the run — the
same position v1's `ReserveInitial` occupies. Then create → start →
submit. If any step fails, the row is left in place as an immutable
dispatch-failure tombstone: a row with no run directory, or whose run is
terminal at sequence ~1, reads as exactly what it is. No cleanup path
exists because none is needed; v1's failure path (which marked turn 1
failed but leaked a never-closed session) has no analogue.

During the turn: nothing touches the ledger. The supervisor's sinks persist
submitted text, events, phase, and the final report regardless of whether
the controller awaits, awaits with a broken client, or dies.

Service dies mid-turn: existing startup reconciliation (xsvc-7) already
terminates the orphaned process and persists the `abandoned` phase plus a
terminal event into the run record. The ledger requires zero
reconciliation. `ReconcileTerminalRuns`, `abandonOpenTurns`, the close-time
transaction in `MarkClosed`, and the one-shot startup repair are deleted,
not rewritten.

Close: `xagent_close` closes the provider session; the supervisor persists
the terminal phase. No ledger write. "Is this agent still usable" is a
runtime fact (live in the run manager, non-terminal phase), never a ledger
fact, so `sdd_session_closed` ceases to exist as a concept.

### D5: Forensic queries

- Which run was the Task 4 implementer:
  `SELECT agent_id, dispatched_at FROM sdd_agents WHERE plan_path = ? AND
  task = 4 AND role = 'implementer' ORDER BY dispatched_at`. Multiple rows
  are takeovers or fresh fixers, ordered by `dispatched_at`.
- Why did this agent stop: `<log_root>/<agent_id>/metadata.json` phase plus
  the terminal event in `normalized.jsonl`, which carries the provider's
  stderr/message (B1). The ledger contributes identity; the run record
  contributes cause; `xagent_list` composes both.
- What was this agent told: the `turn.submitted` events in
  `normalized.jsonl`, in sequence order, notes included; `brief_text` is the
  assignment itself, answerable by SQL alone.
- What work is still in flight: the ledger joined against run metadata —
  rows whose run phase is non-terminal. This is `xagent_list`'s existing
  shape.

### D6: The MCP surface afterwards

`xagent_sdd_start` becomes a four-way role union. Role is the role the agent
*starts* as and is never rewritten (constraint 4):

- `implementer` — as today. A fresh implementer taking over from a dead one is
  simply another `implementer` row for the same `(plan_path, task)`.
- `reviewer` — merges v1's `task-reviewer` and `code-reviewer`: `task` present
  selects the task-review template, absent selects whole-branch.
- `fixer` — new, and it is finding C2 solved properly: `plan`, `task`, the
  original `brief`, `findings`, `tests`, and `report`. It renders a real fix
  template instead of the incident's `--name "Task 4 Fix Round 1"`
  impersonation. Used when the fixing is done by a *fresh* agent — because the
  original died, or because the lead deliberately wants different hands on it.
- `re-reviewer` — likewise, from `findings`, `report`, `base`, and `head`.

Note the symmetry constraint 5 demands: an implementer that fixes its own work
via `xagent_sdd_followup` stays an `implementer` and gets no new row; a fresh
agent doing that fixing is a `fixer` with its own row. Same work, two shapes,
both first-class.

`xagent_sdd_followup` survives, demoted and reframed. Same-agent
continuation is the optimization constraint 5 says it is, and still worth a
tool: it preserves provider context and enforces template discipline over
hand-rolled prose. But it writes nothing to the ledger — the agent's row
exists, and the turn lands in `turn.submitted`. Its guards shrink to two
runtime checks: the run is live, and the kind matches the immutable start
role (`fix` on `implementer`/`fixer`, `re-review` on
`reviewer`/`re-reviewer`). When the run is not live it fails with
`sdd_agent_not_live`, whose details are the recovery path itself: start a
fresh `fixer` or `re-reviewer` for the same plan and task. The v1 dead end
becomes a signpost. Missing a followup,
double-calling it, or calling it after death can no longer corrupt
anything — constraint 1 holds for the tools, not just the ledger.

`xagent_sdd_await` and `xagent_sdd_close` are deleted. The review initially
argued for keeping them as teaching surface; with report persistence and
ledger closure gone they would be byte-for-byte aliases of `xagent_await`
and `xagent_close`, and an alias pair is where the next behavioral
divergence sneaks in. The skill's story gets simpler: dispatch with
`sdd_start`/`sdd_followup`; await, message, and close like any run.

### D7: Superseded v1 machinery, by name

Each of the following landed on this branch and is deliberately replaced,
not forgotten:

- `conversationalAgents` (`sdd_manager.ts`) — deleted. With no turn rows
  and no ledger report persistence, a chit-chat reply needs no
  classification; the message and its reply are ordinary sequenced events.
  The v1 set silently dropped the real work report in its own motivating
  NEEDS_CONTEXT flow.
- `artifactsByAgent` and its `GetLatestTurn` ledger fallback — deleted.
  Followup no longer needs stored artifact paths; fresh-agent dispatch
  takes them as inputs.
- `PersistReportBeforeReturn` and the `sdd_report_unbound` error — deleted.
  Report durability is the supervisor's `turn.completed` event, written
  before any await can return it.
- The one-shot startup repair in `CreateSddStore`, `abandonOpenTurns`, and
  `ReconcileTerminalRuns` — deleted. There is no state to repair.
- The `note` field's missing durability — superseded by `turn.submitted`.
- `sdd_turn_unresolved`, `sdd_session_closed`,
  `sdd_followup_missing_paths`, `sdd_report_path_required` — deleted along
  with the states they guarded.

## Risks / Trade-offs

- **Run directories become the system of record.** Reports and prompts
  exist only in `normalized.jsonl`. Any log-root retention, GC, or manual
  cleanup must treat `<log_root>/<agent_id>/` for ledger-referenced runs as
  the only copy of evidence, not cache. This is the trade the owner must
  sign off on explicitly; it is stated as a requirement (xsvc-14), and
  cleanup tooling gains a hard constraint.
- **Briefs are the one thing deliberately duplicated.** Storing `brief_text`
  is a considered exception to constraint 2, because for path-referencing
  templates the content is in no `turn.submitted` event at all, and briefs live
  in worktrees that get edited and deleted. This closes the "brief content is
  unrecoverable" hole an earlier draft accepted.
- **Per-turn analytics move out of SQL.** Counting fix rounds across a plan
  means reading `turn.submitted` events per agent. Forensics on one agent
  reads one directory; cross-plan analytics are an offline concern.
  Accepted under constraint 3.
- **`xagent_sdd_followup` loses its double-dispatch guard.** v1's open-turn
  check prevented submitting a second turn while one was in flight; v2
  relies on the supervisor's own submit/ready discipline. A careless
  double-followup produces a provider-level rejection or queued turn, both
  visible in the event log, neither able to corrupt the ledger.

## Migration Plan

There is none, deliberately. The operator deletes
`<log_root>/sdd.sqlite` (and its `-wal`/`-shm` siblings) once; the service
creates schema v2 on next start. The service refuses to open a database
whose `user_version` is not 2, with an error naming the deletion step, so a
stale v1 file fails loudly instead of half-working. v1 rows are already
inconsistent (6 of 15 turns stuck `running`) and their forensic content
survives in the run directories they point at.

## Open Questions

- Retention: how long run directories for closed SDD agents are kept, and
  whether a future archiver compacts `normalized.jsonl` into the ledger
  before deletion. Out of scope here; xsvc-14 forbids silent deletion in
  the meantime.
- Provider-thread resume (C1) is untouched by this design: fresh-agent
  recovery is paved, same-provider-context resume after service death
  remains a separate decision.
