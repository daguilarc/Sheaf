## Context

Superpowers SDD currently spans three independently useful layers:

- `projects/agents/utils/dispatch-prompt` renders the upstream Superpowers
  implementer, task-reviewer, re-review, and code-reviewer prompt bodies. It
  validates their required placeholders, writes a role-specific prompt file,
  and deliberately does not dispatch an agent.
- The xagent service exposes generic `start`, `message`, `await`, and `close`
  MCP tools. It owns persistent provider sessions and returns each sanitized
  final assistant report as `report.text`.
- `openspec-superpowers-workflow` tells each controller how to combine those
  pieces, select native versus xagent transport, retain agents for follow-ups,
  and carry reports through the review loop.

That composition is too policy-heavy to repeat in controller prose. In
particular, raw `xagent_message` has no concept of a fix or re-review turn, and
neither xagent nor `dispatch-prompt` records the SDD assignment and brief that
produced a report.

The xagent service already persists supervision sequence numbers. Those are
durable event cursors, but they are not provider JSONL byte or line offsets.

## Goals / Non-Goals

**Goals:**

- Make the correct Superpowers SDD dispatch path a small, structured MCP call.
- Render complete upstream role prompts without copying their prose into
  controller context.
- Keep one implementer or reviewer session across its normal fix or re-review
  rounds.
- Record each initial and follow-up turn in SQLite, including the exact brief
  copy and the sanitized report delivered to the controller.
- Commit the report record before exposing that report to the lead controller.
- Make the canonical workflow and xagent skill require this API during
  Superpowers SDD execution.

**Non-Goals:**

- Replace generic xagent MCP tools for non-SDD delegation.
- Persist intermediate provider output or a full provider transcript.
- Invent a JSONL file position that the provider and MCP contracts do not
  expose.
- Move model assignment or task decomposition into xagent.
- Build a second supervisor or network service.
- Import historical xagent runs into the SDD ledger or define automatic data
  retention in this change.

## Decisions

### D1: Add an SDD facade to the existing xagent MCP service

The service will add four tools:

- `xagent_sdd_start` starts an initial `implementer`, `task-reviewer`, or
  `code-reviewer` turn from structured dispatch arguments.
- `xagent_sdd_followup` sends a `fix` or `re-review` turn to an existing SDD
  session.
- `xagent_sdd_await` awaits the next durable event and performs ledger writes
  before returning it.
- `xagent_sdd_close` closes the provider session and marks the SDD session
  closed.

The facade will call the same run manager used by the generic MCP tools. It will
not create a second session implementation. Generic inspect and interrupt remain
valid for an SDD run. Generic `xagent_message` will reject SDD-owned run IDs with
a structured error directing the caller to `xagent_sdd_followup`; otherwise a
follow-up could bypass prompt formatting and ledger creation. Generic await and
close will use the same SDD-aware persistence hooks, so accidentally using those
generic operations cannot return an unrecorded report or leave stale session
state.

`xagent_sdd_start` uses a role-discriminated input schema. Common fields are:

- absolute `cwd` and plan path
- `plan_name`, derived from the plan file's basename without its final suffix
- optional task number for whole-branch review, otherwise a required positive
  task number
- `agent`, a non-empty assigned model identifier forwarded as xagent `model`
- `harness`, validated against xagent's existing harness enum
- `effort`, validated against `low`, `medium`, `high`, or `xhigh` and forwarded
  as xagent `thinking_level`
- role-specific brief, context, report, constraints, description,
  requirements, base, head, and diff paths
- the existing optional supervision policy

The API requires the assignment fields instead of guessing them. The resulting
`agent_id` is the xagent `run_id`; the API uses the SDD name externally while
retaining `run_id` compatibility in generic supervision internals. A successful
start also returns the pre-turn resume sequence plus the resolved prompt, brief,
and report paths so the controller does not re-derive workspace
conventions. Implementer and task-reviewer starts require a report path;
code-reviewer starts do not use one.

`xagent_sdd_followup` takes `agent_id`, `kind`, `round`, and only the new
role-specific inputs. It reuses the plan, task, assignment, brief, and report
path recorded by the initial turn. A `fix` is valid only for an implementer
session and adds open findings plus covering-test guidance. A `re-review` is
valid only for a `task-reviewer` session and adds findings, a base/head range,
and a scoped diff. A whole-branch `code-reviewer` session is single-turn:
start, await, and close — it has no follow-up kind. The service rejects a
follow-up unless the session is ready and no
prior SDD turn is awaiting a final report.

`xagent_sdd_await` accepts `agent_id`, `after_sequence`, and the same optional
`deadline_seconds` as generic await. It defaults to 7000 seconds, rejects values
above 7000, and cancellation releases only request-local resources.
`xagent_sdd_close` accepts only `agent_id`; it records closure only after the
underlying provider session closes.

*Alternative considered:* add optional SDD metadata to the existing generic
tools. Rejected because raw prompt and text fields would remain an attractive
way to bypass the role contract.

*Alternative considered:* run a separate `xagent-sdd` service. Rejected because
it would duplicate ownership, lifecycle, health, and recovery behavior already
provided by xagent.

### D2: Reuse `dispatch-prompt` rendering semantics

Initial task roles and re-review turns will be rendered with the same template
resolution, placeholder manifest, drift checks, path derivation, and atomic
workspace output used by `projects/agents/utils/dispatch-prompt`. The xagent
service will execute the trusted utility at
`<service repoRoot>/projects/agents/utils/dispatch-prompt`, using Python 3 and
the caller's canonical `cwd` only as the subprocess working directory. It will
never execute a renderer selected from the caller's worktree. The service reads
the utility's single output path and then reads the prompt file. This invocation
is internal to the service; the controller-facing transport remains MCP-only,
and the renderer's CLI contract remains unchanged.

The SDD facade reads and validates the brief before dispatch. The prompt points
the subagent at the brief path, as Superpowers requires, while the ledger stores
an exact copy of the file contents. The controller never needs to inline either
the prompt body or brief. `code-reviewer` is the explicit exception imposed by
its upstream template: the facade reads the supplied review-brief file and
passes its contents through `--requirements @FILE`, so the rendered prompt
inlines the review requirements while the ledger still retains both path and
copy.

Superpowers has no standalone fix template. The facade therefore owns a small,
version-controlled fix follow-up formatter. Its golden contract requires the
round, original brief path, open-findings path and verbatim contents, report
path, named covering tests, instructions to fix only the open findings, rerun
those tests, append a fix report to the existing report file, and return the
short Superpowers status contract. It does not summarize or reinterpret
findings. Golden tests pin these clauses so changes are deliberate. Re-review
continues to use the upstream re-review template and its drift checks.

*Alternative considered:* copy all Superpowers templates into xagent. Rejected
because the copies would drift and lose the renderer's existing fail-loud
checks.

### D3: Model one persistent agent session and many SDD turns

One xagent run corresponds to one SDD session. Each initial dispatch or
follow-up is a distinct turn associated with that session. This preserves the
same-agent rule while retaining every brief/report pair instead of overwriting
one session row after each fix round.

Rounds 1–3 use `xagent_sdd_followup` on the original implementer. If the
Superpowers breaker policy selects a fresh, stronger implementer for rounds
4–5, the controller starts a new SDD session and supplies the same plan/task
identity plus the new assignment. Re-reviews continue on the original reviewer
session unless the workflow's breaker policy explicitly starts a replacement.

### D4: Store a normalized SQLite ledger under the xagent data root

The database path is `<service logRoot>/sdd.sqlite`; with the shipped service
configuration this is `data/xagent/sdd.sqlite` in the service's canonical
checkout. `service_main` passes the same `config.logRoot` to the SDD store and
run manager. The service does not add direct `XAGENT_LOG_ROOT` environment
resolution in this change. The database is service-owned, git-ignored
operational data rather than worktree state.

The TypeScript service will use `better-sqlite3`, added as a runtime dependency,
so the existing Node 20 engine contract does not need to change. Schema creation
is an explicit version-1 migration tracked by `PRAGMA user_version`; startup
rejects a database whose schema version is newer than the service understands.

The proposed schema is:

```sql
CREATE TABLE sdd_sessions
(
    agent_id TEXT PRIMARY KEY,
    plan_name TEXT NOT NULL,
    plan_path TEXT NOT NULL,
    cwd TEXT NOT NULL,
    task_number INTEGER,
    agent TEXT NOT NULL,
    harness TEXT NOT NULL,
    effort TEXT NOT NULL,
    role TEXT NOT NULL,
    started_at TEXT NOT NULL,
    closed_at TEXT,
    CHECK (task_number IS NULL OR task_number > 0)
);

CREATE TABLE sdd_turns
(
    id INTEGER PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES sdd_sessions(agent_id),
    turn_number INTEGER NOT NULL,
    kind TEXT NOT NULL,
    round INTEGER,
    brief_path TEXT NOT NULL,
    brief_text TEXT NOT NULL,
    report_path TEXT,
    findings_path TEXT,
    findings_text TEXT,
    report_text TEXT,
    resume_sequence INTEGER,
    completed_sequence INTEGER,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE (agent_id, turn_number),
    CHECK (kind IN ('initial', 'fix', 're_review')),
    CHECK (round IS NULL OR round > 0),
    CHECK (status IN ('prepared', 'running', 'completed', 'failed', 'abandoned'))
);

CREATE INDEX sdd_turns_agent_status
    ON sdd_turns(agent_id, status);

CREATE VIEW sdd_dispatch_log AS
SELECT
    t.id,
    s.plan_name,
    s.plan_path,
    s.cwd,
    s.task_number,
    s.agent,
    s.harness,
    s.effort,
    s.role,
    s.agent_id,
    t.turn_number,
    t.kind,
    t.round,
    t.brief_path,
    t.brief_text,
    t.report_path,
    t.findings_path,
    t.findings_text,
    t.report_text,
    t.resume_sequence,
    t.completed_sequence,
    t.status,
    t.created_at,
    t.completed_at
FROM sdd_turns AS t
JOIN sdd_sessions AS s ON s.agent_id = t.agent_id;
```

`agent` records the requested model/agent assignment; `agent_id` records the
stable xagent run ID. `brief_text` is the exact file content read for that turn,
and `report_path` is the Superpowers report artifact the role prompt names when
that role uses one. For a fix or re-review, `findings_text` captures the exact
findings sent in addition to the unchanged task brief. `report_text` is the
sanitized final assistant report delivered through xagent for that turn. The
ledger intentionally does not copy the contents of the mutable Superpowers
report artifact; implementer fix rounds append to that file, while every
delivered assistant report remains immutable in its own turn row.

The database uses foreign keys, WAL mode, a bounded busy timeout, and serialized
service writes. The file and any newly created parent directory use owner-only
permissions because briefs may contain sensitive repository context.

*Alternative considered:* one wide row per session. Rejected because successive
fix reports would overwrite history and could not be paired with the follow-up
that produced them.

### D5: Persist at lifecycle boundaries, with report-before-return

The write points are:

1. `xagent_sdd_start` canonicalizes paths, reads the brief, renders the prompt,
   preallocates an xagent run ID, and inserts a session plus `prepared` initial
   turn before creating any provider process. It then creates that exact run,
   starts and submits the turn, and marks the turn `running` with the pre-turn
   resume sequence. Start or submission failure marks the turn `failed` and
   closes the run before returning an error.
2. `xagent_sdd_followup` inserts a `prepared` turn before submitting the
   follow-up. After submission it records the returned pre-turn resume sequence
   and marks the turn `running`. Submission failure marks the turn `failed`.
3. `xagent_sdd_await` updates attention/deadline cursor state when no turn
   report is available. On successful turn completion it writes
   `report_text`, `completed_sequence`, completion time, and `completed` status
   in one transaction. Only after that transaction commits does the MCP tool
   return `report.text`.
4. `xagent_sdd_close` records `closed_at` after the underlying provider session
   closes.
5. After xagent startup reconciliation, the SDD store marks any `prepared` or
   `running` turn `abandoned` when its run was reconciled to an abandoned,
   failed, or cancelled reportless terminal state. Phase `completed` is not
   treated as reportless: the turn stays open so a later await can persist the
   delivered report. Awaiting an abandoned run returns the normal terminal
   supervision result after the ledger transition; no follow-up is accepted for
   the terminal session.

If the report transaction fails, the facade returns a structured persistence
error without advancing the caller's cursor. The durable completion can
therefore be retried and recorded before delivery. Database failures are not
downgraded to warnings because that would violate the audit contract.
Generic `xagent_await` and `xagent_close` call the same SDD-aware hooks whenever
their run ID belongs to an SDD session, preserving report-before-return and
close-after-provider semantics even when a caller uses the generic operation.

### D6: Record supervision cursors, not JSONL positions

`resume_sequence` records the cursor snapshot taken immediately before the
initial or follow-up turn is submitted. `completed_sequence` records the
sequence carrying the final report. Awaiting after `resume_sequence` therefore
observes the turn's own completion and provides the supported retry boundary.

No `jsonl_offset`, byte position, or line number is stored. Provider JSONL files
are implementation details, and their positions are neither exposed by MCP nor
stable enough to serve as an API contract. This can be revisited only if xagent
later exposes a durable transcript-position identifier directly.

### D7: Make SDD routing mandatory in canonical guidance

The canonical `openspec-superpowers-workflow` source will require
`xagent_sdd_start`, `xagent_sdd_followup`, `xagent_sdd_await`, and
`xagent_sdd_close` for Superpowers task implementation, task review, fix,
re-review, and final branch review. It will no longer choose native transport
for those SDD turns or assemble raw prompts. Planning and decomposition tools
that are not Superpowers SDD task turns remain outside this dispatch facade.

The plugin-owned `xagent-subagents` skill will state the same rule when the
delegation is part of Superpowers SDD. Its existing generic MCP guidance remains
the route for non-SDD workers and reviews. Source and installation tests will
assert the tool names and prohibit stale mixed-transport guidance.

## Risks / Trade-offs

- **SQLite write failure after a provider starts** → Close the new run and fail
  the start; the pre-created ledger row remains `failed`, so no provider run is
  untracked.
- **A caller uses raw `xagent_message` on an SDD run** → Reject it and name
  `xagent_sdd_followup` in the structured error.
- **Upstream Superpowers template drift** → Reuse `dispatch-prompt` drift
  validation and fail before agent dispatch; pin the local fix formatter's
  mandatory clauses with golden tests.
- **Central database receives concurrent calls** → Use WAL, a busy timeout, and
  serialized writes in the service process.
- **Brief copies contain sensitive text** → Keep the database under the local
  xagent data root with owner-only permissions and never include brief text in
  MCP results, normalized supervision logs, or service stdout/stderr. Provider
  harness transcript retention is provider-owned and outside this change.
- **The report is complete but its database write fails** → Return a
  persistence error without a new cursor so the same durable completion can be
  retried.
- **An SDD controller depends on native subagents** → This workflow deliberately
  trades native convenience for one enforceable MCP and audit contract.
- **Renderer runtime is unavailable** → Treat missing Python 3, the trusted
  renderer executable, or the installed Superpowers template tree as broken
  SDD infrastructure and fail before creating a session.

## Migration Plan

1. Add the SQLite store and tests for schema creation, permissions, writes,
   startup reconciliation, and restart-safe reads.
2. Add SDD prompt formatting and the four MCP facade tools behind the existing
   xagent service.
3. Add lifecycle integration tests, including start, fix, re-review, report
   persistence, retry after a database failure, and raw-message rejection.
4. Update xagent documentation and the plugin skill, then update the canonical
   OpenSpec Superpowers workflow and installer assertions.
5. Deploy through the normal xagent and agents installers. The database is
   created lazily on the first SDD dispatch.

Rollback restores the previous skills and removes the SDD tool registrations.
The additive SQLite file may be retained for audit or removed manually; generic
xagent runs are unaffected.

## Open Questions

None. The durable supervision sequence is sufficient for this change, and a
provider JSONL position is intentionally deferred until such an identifier is
part of the xagent API.
