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
- First-class fresh-agent fix and re-review dispatch, related by dispatch
  order rather than a recorded lineage link (D3a).
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
which run is which, and which assignment each one was given.

### D2: `turn.submitted` — make the JSONL able to answer "what was told"

Constraint 2 assumes the prompts and chit-chat are already in the JSONL.
Today that is only partly true: the raw provider stream echoes input on
some harnesses and not reliably on others, and the controller `note` landed
on this branch appended to the submitted text but recorded nowhere durable
— not in the prompt file at `prompt_path`, not in the ledger.

Rather than store submitted text in the ledger, the supervisor emits a
`turn.submitted` normalized event on every `submit()`, carrying the full
sanitized submitted text — rendered role prompt plus appended note, or a
raw `xagent_message`. The contract, pinned:

```ts
// supervision/types.ts — the type union gains one member:
//   type: "supervision.state" | "supervision.attention"
//       | "turn.completed" | "turn.submitted";

// Every turn.submitted event has this shape (a SupervisionEvent with
// schema_version 1, run_id, sequence, timestamp as usual):
type TurnSubmittedEvent = SupervisionEvent & {
  type: "turn.submitted";
  phase: "running";              // always — see emission point below
  reason: "turn_submitted";
  payload: {
    text: string;                // the FULL submitted text
    turn_id: string;             // `turn_${inputSequence}`, the same id the
                                 // turn's completion/failure payloads carry
  };
};
```

- **Emission point.** Inside `Supervisor.submit()`'s lifecycle mutation,
  immediately after the `running`/`turn_started` state event and *before*
  `session.submit` hands the text to the provider adapter. Sequence order
  within a turn is therefore: `supervision.state` (`turn_started`, seq N) →
  `turn.submitted` (seq N+1) → provider-derived events. Emitting before the
  adapter sees the text — not merely before the submit Promise resolves —
  means a crash at any later point, including mid-provider-stream, cannot
  lose "what was this agent told". If the event-sink append itself fails,
  the submit fails; text the log cannot prove was sent is not sent.
- **Sanitization.** `payload.text` passes through the same
  `sanitizeValue(text, cwd)` treatment as every other persisted payload.
- **Await behavior.** Published with `deliverable: false`, so it never
  completes a live await and never enters leader context unprompted. The
  persisted-path whitelist in `isPersistedAwaitWake` (which accepts only
  `supervision.attention`, `turn.completed`, and terminal
  `supervision.state`) must continue to exclude it, with a test pinning
  that.

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

This is the entire v2 schema: one table, one index, no views. The v1
`sdd_dispatch_log` view is deleted with the rest of schema v1 and has no v2
replacement — it existed to join sessions onto turns, and with one row per
agent there is nothing left to join; the forensic queries in D5 run
directly against `sdd_agents`.

Every role carries a brief (D6), which is why `brief_path` and `brief_text`
are `NOT NULL` unconditionally: for a `re-reviewer` the brief is the
original review brief the reviewer under re-check was dispatched with,
passed explicitly by the controller.

Column-by-column justification against constraint 2:

- `agent_id` — the join key to the run record. Identity itself.
- `plan_path`, `task`, `role` — the assignment. This is the core
  information the run logs cannot answer without opening every run
  directory and parsing prompts: "which run was the Task 4 implementer"
  must be a SQL query, not archaeology. `plan_name` is not a column; it is
  `basename(plan_path)`, derived in queries and in the `xagent_list` join
  (D8).
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
*starts* as and is never rewritten (constraint 4). The Zod shapes, pinned —
every role shares v1's `SddAssignmentFields` verbatim (`note?`, `cwd`,
`plan`, `agent`, `harness`, `effort`, `policy?`), all objects `.strict()`,
path fields using the existing `SddArtifactPathSchema` and worker-facing
text fields using the existing `WorkerFacingText` run-id guard:

```ts
const ImplementerStartSchema = z.object({
  role: z.literal("implementer"),
  ...SddAssignmentFields,
  task: z.number().int().positive(),
  name: WorkerFacingText("name"),
  brief: SddArtifactPathSchema,
  report: SddArtifactPathSchema,
  context: WorkerFacingText("context").optional(),
});                                    // unchanged from v1

const ReviewerStartSchema = z.object({ // merges task-reviewer + code-reviewer
  role: z.literal("reviewer"),
  ...SddAssignmentFields,
  task: z.number().int().positive().optional(),
  brief: SddArtifactPathSchema,        // v1 task-reviewer `brief` and
                                       // code-reviewer `review_brief`, unified
  base: z.string().min(1),
  head: z.string().min(1),
  report: SddArtifactPathSchema.optional(),       // required with `task`
  constraints: SddArtifactPathSchema.optional(),  // task-scoped only
  diff: SddArtifactPathSchema.optional(),         // task-scoped only
  description: WorkerFacingText("description").optional(), // whole-branch only
});
// superRefine: task present → `report` required, `description` forbidden;
//              task absent  → `description` required, `report`/`constraints`/
//                             `diff` forbidden (whole-branch template has no
//                             slot for them).

const FixerStartSchema = z.object({
  role: z.literal("fixer"),
  ...SddAssignmentFields,
  task: z.number().int().positive(),
  brief: SddArtifactPathSchema,        // the ORIGINAL implementer brief
  findings: SddArtifactPathSchema,
  findings_text: WorkerFacingText("findings_text"),
  tests: z.array(z.string().min(1)).min(1),
  report: SddArtifactPathSchema,       // where the fix report is appended
  // `FormatFixFollowup` and the `re-review` renderer both require a round
  // number, so it is an input rather than something the service invents.
  // It is display-only: a fresh agent's own first turn is round 1, which is
  // the default; a controller that wants the prompt to read "Fix round 3"
  // because two fixers came before passes 3.
  round: z.number().int().positive().default(1),
});
// Deliberately absent: `name` (the impersonation vector this role replaces),
// `context`, and `round` — rounds are conveyed by the submitted text and by
// dispatch order within (plan_path, task), never by identity fields.

const ReReviewerStartSchema = z.object({
  role: z.literal("re-reviewer"),
  ...SddAssignmentFields,
  task: z.number().int().positive(),
  brief: SddArtifactPathSchema,        // the ORIGINAL review brief
  findings: SddArtifactPathSchema,
  report: SddArtifactPathSchema,       // the review report being re-checked
  base: z.string().min(1),
  head: z.string().min(1),
  diff: SddArtifactPathSchema.optional(),
  round: z.number().int().positive().default(1),   // display-only; see fixer
});

const XagentSddStartInputSchema = z.discriminatedUnion("role", [
  ImplementerStartSchema, ReviewerStartSchema,
  FixerStartSchema, ReReviewerStartSchema,
]);
```

v1 field-name disposition, explicitly: the v1 role names `task-reviewer`
and `code-reviewer` are rejected by validation; `review_brief` is renamed
to `brief` (the old name is rejected by `.strict()`); `description`
survives only on the whole-branch `reviewer` shape; `name` and `context`
survive only on `implementer`; everything in `SddAssignmentFields` survives
under its v1 name.

Role semantics:

- `implementer` — as today. A fresh implementer taking over from a dead one is
  simply another `implementer` row for the same `(plan_path, task)`.
- `reviewer` — merges v1's `task-reviewer` and `code-reviewer`: `task` present
  selects the task-review template, absent selects whole-branch.
- `fixer` — new, and it is finding C2 solved properly: it renders a real fix
  template instead of the incident's `--name "Task 4 Fix Round 1"`
  impersonation. Used when the fixing is done by a *fresh* agent — because the
  original died, or because the lead deliberately wants different hands on it.
  The fix template is rendered in TypeScript from the existing
  `FormatFixFollowup` formatter, extended with a plan/task/role header — it
  is *not* a new dispatch-prompt renderer role; golden fixtures pin parity
  between the fresh-fixer prompt and the same-agent fix continuation.
- `re-reviewer` — likewise, a fresh dispatch of the existing re-review
  template (which already consumes brief, findings, report, base, head via
  the dispatch-prompt renderer).

`xagent_sdd_start` returns `{ agent_id, sequence, prompt_path,
renderer_path }`. v1's `brief_path` and `report_path` result fields are
deliberately dropped: both were verbatim echoes of the caller's own inputs;
v2 results carry only service-generated facts.

Note the symmetry constraint 5 demands: an implementer that fixes its own work
via `xagent_sdd_followup` stays an `implementer` and gets no new row; a fresh
agent doing that fixing is a `fixer` with its own row. Same work, two shapes,
both first-class.

`xagent_sdd_followup` survives, demoted and reframed. Same-agent
continuation is the optimization constraint 5 says it is, and still worth a
tool: it preserves provider context and enforces template discipline over
hand-rolled prose. But it writes nothing to the ledger — the agent's row
exists, and the turn lands in `turn.submitted`. The v2 input shapes,
pinned — the material change from v1 is that `report` becomes a tool input
(v1 recovered it from cached turn artifacts; the v2 ledger stores no
`report_path`), while the brief comes from the target agent's own
`sdd_agents` row (`brief_path`/`brief_text`), never from input:

```ts
const FixFollowupSchema = z.object({
  kind: z.literal("fix"),
  agent_id: AgentIdSchema,
  round: z.number().int().positive(),  // render-only: it appears in the
                                       // submitted text and is recorded
                                       // nowhere but the turn.submitted event
  findings: SddArtifactPathSchema,
  findings_text: WorkerFacingText("findings_text"),
  tests: z.array(z.string().min(1)).min(1),
  report: SddArtifactPathSchema,       // NEW in v2 — the report file the fix
                                       // appends to, previously cache-sourced
  note: NoteSchema,
}).strict();

const ReReviewFollowupSchema = z.object({
  kind: z.literal("re-review"),
  agent_id: AgentIdSchema,
  round: z.number().int().positive(),  // render-only, as above
  findings: SddArtifactPathSchema,
  report: SddArtifactPathSchema,       // NEW in v2 — the report under re-review
  base: z.string().min(1),
  head: z.string().min(1),
  diff: SddArtifactPathSchema.optional(),
  note: NoteSchema,
}).strict();
```

The result is `{ agent_id, sequence }` — `sequence` being the supervision
sequence to pass as `after_sequence` to `xagent_await`. v1's `turn_number`
result field is deleted; v2 has no turns to number.

Its guards shrink to the checks that remain meaningful: the agent has an
`sdd_agents` row (else `unknown_sdd_agent`, kept from v1), the run is live,
and the kind matches the immutable start role (`fix` on
`implementer`/`fixer`, `re-review` on `reviewer`/`re-reviewer` — else
`sdd_followup_role_mismatch`, kept from v1). When the run is not live it
fails with `sdd_agent_not_live` — replacing v1's `sdd_session_terminal` —
whose details are the recovery path itself: start a fresh `fixer` or
`re-reviewer` for the same plan and task. The v1 dead end
becomes a signpost. Missing a followup,
double-calling it, or calling it after death can no longer corrupt
anything — constraint 1 holds for the tools, not just the ledger.

v1's `sdd_turn_in_flight` guard on `xagent_message` is deleted along with
open turns: with no report binding to protect, chit-chat during a running
turn is merely a provider-level concern (queued or rejected by the
provider, visible in the event log), and the message is durable in
`turn.submitted` either way. `sdd_followup_required` — v1's insistence that
SDD runs be messaged only through the facade — is deleted with it;
`xagent_message` is legal on SDD runs.

`xagent_sdd_await` and `xagent_sdd_close` are deleted. The review initially
argued for keeping them as teaching surface; with report persistence and
ledger closure gone they would be byte-for-byte aliases of `xagent_await`
and `xagent_close`, and an alias pair is where the next behavioral
divergence sneaks in. The skill's story gets simpler: dispatch with
`sdd_start`/`sdd_followup`; await, message, and close like any run.

### D6a: The union must be advertised, not just enforced

Found while executing this change, by trying to dispatch its own first task.

`McpServer.registerTool` derives a tool's advertised JSON Schema from a
`ZodObject`/`ZodRawShape`. Both SDD tools pass a `z.discriminatedUnion` where
a shape is expected. The SDK cannot derive a shape from a union, so it
advertises `{}`: `tools/list` on the live service reports
`xagent_sdd_start` and `xagent_sdd_followup` with **zero** properties while
all nine other tools — every one of them a `z.object` — report real schemas.

The tools still function for a caller that already knows the shape; runtime
validation against the union is untouched. What is lost is discovery. A
client that reads the advertised schema learns nothing, and a client that
infers argument types from it gets them wrong — the first dispatch attempt in
this change sent `task` as `"1"` instead of `1` and was rejected by the very
union the schema failed to describe.

This is not fixed by the redesign. v2 replaces the union with another union,
so the empty schema survives the cutover untouched. It is also load-bearing
for this change's own test suite: the planned tool-surface test asserts that
`xagent_sdd_start`'s advertised schema mentions `re-reviewer` and not
`task-reviewer`/`code-reviewer`. Against `{}` the two negative assertions
pass vacuously and the positive one fails — the test would have looked like a
v2 regression when it is really this defect.

The obvious fix — hand `registerTool` the union's JSON Schema directly —
does not work either. `normalizeObjectSchema` accepts a raw shape or an
object schema and nothing else; a plain JSON Schema object fails both checks
and falls through to the same empty result. The SDK will only publish what it
can reach through an object schema.

So registration supplies a `ZodObject` that is a deliberate **superset** of
the union: `role` as an enum of the four values, the shared assignment fields
required, every variant-specific field optional and `.describe()`d with the
roles that require it. The handler is untouched — it still parses against the
union, which stays the sole authority for rejection.

The superset is asymmetric on purpose. It can accept a payload the union
rejects (a `fixer` with no `findings`), and that costs the caller exactly one
structured validation error from the union. It must never do the reverse: a
schema that rejects a legal call hides capability the service would have
served, and the caller has no way to discover it was wrong. The tool-surface
suite pins that direction — every role's valid payload must survive the
advertised schema — rather than pretending the two can be made identical.

The requirement is xsvc-15. It is the one part of this change that cannot be
dispatched through the facade it repairs, so the controller implements it
directly and restarts the service onto the fixed build first.

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
- `sdd_turn_in_flight` and the `FollowupRequired` helper /
  `sdd_followup_required` error — deleted; `xagent_message` on an SDD run
  is an ordinary submit, recorded by `turn.submitted` (see D6).

And the error-surface disposition in one place: **kept** —
`unknown_sdd_agent`, `sdd_followup_role_mismatch`, `sdd_persistence_failed`,
and the renderer errors (`sdd_renderer_missing`/`sdd_renderer_failed`/
`sdd_templates_missing`/`sdd_renderer_output_invalid`); **renamed in
substance** — `sdd_session_terminal` becomes `sdd_agent_not_live` (liveness
is now a run-manager fact, not a ledger fact); **deleted** — every error
named in the bullets above. A start failure writes nothing anywhere — v1's
`MarkFailed` has no v2 analogue; the row inserted before the failure stands
as the tombstone (D4).

### D8: `xagent_list` v2 shapes

The `sdd` identity block and the tombstone row are pinned as types, not
prose. `plan` keeps its v1 meaning — the plan *name*,
`basename(plan_path)` without extension — because that is what controllers
match against; `plan_path` stays a SQL-only fact. v1's `agent` field cannot
survive: the v2 ledger stores no model, and a tombstone has no run
metadata to fabricate it from. v1's `closed` flag dies with ledger closure.

```ts
type XagentSddListFields = {
  readonly role: string;           // one of the four start roles
  readonly plan: string;           // basename(plan_path), v1 meaning
  readonly task?: number;          // absent when the ledger column is NULL
  readonly cwd: string;
  readonly brief_path: string;
  readonly dispatched_at: string;
};

// Normal rows: XagentListRow exactly as today, its optional `sdd` block
// switched to the fields above. `run_missing` never appears on them.

// Ledger rows with no run record are a PARALLEL type, not an XagentListRow
// with fabricated fields — no phase, sequence, live, harness, exit_status,
// or timestamps exist to report:
type XagentSddTombstoneRow = {
  readonly run_id: string;         // the agent_id that never became a run
  readonly run_missing: true;
  readonly sdd: XagentSddListFields;
};

type XagentListEntry = XagentListRow | XagentSddTombstoneRow;
// ListRunsResult.runs becomes readonly XagentListEntry[], ordered among
// themselves by dispatched_at where tombstones are interleaved.
```

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
