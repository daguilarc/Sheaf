# xagent-service Specification

## Purpose

Defines the Conductor-managed xagent service: registration with the Sheaf
service registry, standard lifecycle endpoints, service-owned supervision that
survives controller disconnect, Streamable HTTP MCP controller tools, long
blocking await bounds, working-directory validation, and stale-ownership
reconciliation at startup. The service owns supervisor, provider session,
timers, durable events, and child processes independently of any controller
transport or await request.

## Requirements

### Requirement: xsvc-1 — Service: Conductor registration

WHERE Sheaf services are configured, THE repository SHALL register `xagent` in `config/services.json` with loopback host `127.0.0.1`, port `9005`, and command `make xagent-service-run`; THE root and project Makefiles SHALL provide that command from tracked source.

#### Scenario: Conductor discovers xagent

- **WHEN** Conductor loads the repository service registry
- **THEN** it discovers an `xagent` service at `127.0.0.1:9005`
- **AND** can start, stop, restart, health-check, and capture logs for it through the existing Conductor lifecycle

#### Scenario: Shipped listener remains local

- **WHEN** the tracked xagent service configuration is inspected
- **THEN** it binds to loopback rather than `0.0.0.0` or another LAN-reachable interface

### Requirement: xsvc-2 — Service: standard lifecycle endpoints

WHEN the xagent service is running, THE service SHALL expose cheap deterministic `GET /health` and orderly idempotent `POST /exit` endpoints compatible with the Sheaf service contract.

#### Scenario: Healthy service

- **WHEN** a client requests `GET /health`
- **THEN** the service responds 200 with `healthy: true` and numeric `uptime`
- **AND** includes a warning only when supervision is degraded

#### Scenario: Reconciliation degrades health

- **WHEN** startup reconciliation cannot cleanly terminate or account for every stale owned process (e.g. identity mismatch, unproven process group, inspection failure, termination failure, or persistence failure)
- **THEN** the service logs each reconciliation outcome to stderr for operator capture
- **AND** `GET /health` includes a bounded `warning` describing the degraded supervision state
- **AND** omits the warning when every stale run was cleaned up cleanly (`terminated` or `process_not_found`)

#### Scenario: Orderly service exit

- **WHEN** a client requests `POST /exit`
- **THEN** the service acknowledges the request before closing listeners
- **AND** closes owned provider sessions and process groups before exiting successfully

#### Scenario: Repeated service exit

- **WHEN** shutdown is already in progress and another exit request arrives
- **THEN** the service does not start a second shutdown sequence or leave additional owned processes

### Requirement: xsvc-3 — Ownership: service survives controller disconnect

WHILE a supervised run is active, THE xagent service SHALL own its supervisor, provider session, timers, durable events, and child process independently of the Codex thread, plugin connection, MCP session, and individual await request that created it.

#### Scenario: Await request is cancelled

- **WHEN** a controller cancels or disconnects an active `xagent_await` request
- **THEN** the await request ends
- **AND** the supervised worker and its timers continue in the xagent service

#### Scenario: Boss reconnects

- **WHEN** a replacement controller knows the `run_id`
- **THEN** it can inspect the persisted phase and cursor
- **AND** can await a durable completion or attention event without restarting the provider session

#### Scenario: Conductor stops xagent

- **WHEN** Conductor explicitly stops or restarts the xagent service
- **THEN** orderly service shutdown closes the provider sessions and process groups owned by active runs

#### Scenario: SIGTERM or SIGINT triggers orderly shutdown

- **WHEN** the xagent service receives `SIGTERM` (e.g. Conductor's stop fallback when `POST /exit` fails or is unresponsive) or `SIGINT` (a human Ctrl-C)
- **THEN** the service drives the same orderly shutdown as `POST /exit` (close owned provider sessions and process groups, then exit `0`)
- **AND** a repeated signal forces a non-zero exit so a wedged orderly shutdown cannot block escalation to `SIGKILL`

### Requirement: xsvc-4 — MCP: Streamable HTTP controller endpoint

WHEN the xagent service is running, THE service SHALL expose Streamable HTTP MCP at `/mcp` with generic tools `xagent_start_non_sdd`, `xagent_await`, `xagent_inspect`, `xagent_list`, `xagent_message`, `xagent_interrupt`, and `xagent_close` plus SDD dispatch tools `xagent_sdd_start` and `xagent_sdd_followup`, all backed by service-owned supervisors; THE service SHALL NOT expose `xagent_sdd_await` or `xagent_sdd_close`.

#### Scenario: MCP initialization

- **WHEN** a compatible MCP client connects to `http://127.0.0.1:9005/mcp`
- **THEN** it can initialize a Streamable HTTP MCP session
- **AND** discovers all seven generic xagent controller tools
- **AND** discovers exactly two xagent SDD dispatch tools, `xagent_sdd_start` and `xagent_sdd_followup`

#### Scenario: Deleted SDD facade tools are gone

- **WHEN** a controller written against the v1 facade calls `xagent_sdd_await` or `xagent_sdd_close`
- **THEN** the MCP server reports the tool as unknown
- **AND** the equivalent operation is available as `xagent_await` or `xagent_close` with the same input shape apart from the `agent_id`→`run_id` field name

#### Scenario: MCP connection closes

- **WHEN** an MCP transport connection closes while its supervised run remains active
- **THEN** the service retains that run independently of the transport session

#### Scenario: Unsupported route

- **WHEN** a client requests an unrecognized service route
- **THEN** the service returns a bounded 404 response
- **AND** does not change any supervised run

### Requirement: xsvc-5 — MCP: awaits end on news, not on a clock

WHEN serving `xagent_await`, THE xagent service SHALL block until the next durable event after the caller's cursor and SHALL NOT end a vouched-for await on elapsed time; an await ends with a durable event, a supervision verdict, or client cancellation, and cancellation SHALL release request-local resources without cancelling the supervised run. `xagent_await` SHALL be the only await tool and SHALL serve SDD-owned and generic runs identically.

THE service SHALL deliver `xagent_await` responses over SSE, and WHILE the supervisor vouches for the run THE service SHALL emit request-scoped progress notifications on any await carrying a `progressToken`, at a cadence not exceeding 60 seconds. Vouching means the run's phase is live and the supervisor has observed progress within its silence bound; it is not a bare interval timer. WHEN the supervisor stops vouching, THE service SHALL stop emitting notifications, so that a client-side timeout means "the supervisor stopped vouching" rather than "N seconds elapsed".

THE `deadline_seconds` input SHALL NOT be advertised on the agent-facing tool schema. It remains in the parsed schema as internal plumbing for the service-owned client and tests, under the advertised-versus-parsed split established by xsvc-15. An agent SHALL NOT be required to choose a timeout whose only correct value depends on transport behaviour it cannot observe.

**Client cooperation is part of this contract.** A conforming client MUST either reset its request timeout on progress notifications or configure a request timeout at least as long as its intended await. The MCP SDK's 60-second `DEFAULT_REQUEST_TIMEOUT_MSEC` satisfies neither and is the observed default in at least one shipped harness. Remedies are client-side configuration — a per-server `"timeout"` in the MCP registration, or the harness's own idle-timeout setting — never an agent-facing knob. The 7200-second request lifetime and 7270-second headers timeout (`config.ts`) are transport plumbing, not the headline of this contract.

#### Scenario: A healthy long run holds without waking the controller

- **WHEN** a controller issues one await and the worker stays healthy for ninety minutes before completing
- **THEN** progress notifications flow for the duration and the await stays pending
- **AND** it returns the completion event as the controller's first and only wakeup
- **AND** no intermediate deadline result is delivered

#### Scenario: The supervisor stops vouching

- **WHEN** the supervised run wedges, dies, or exceeds its silence bound
- **THEN** the service stops emitting progress notifications
- **AND** the client's own timeout fires, which is a justified wakeup carrying real information

#### Scenario: Deadlines are not the agent's business

- **WHEN** an agent reads the advertised `xagent_await` schema
- **THEN** it sees `run_id` and `after_sequence` and no deadline input
- **AND** a call constructed from that schema alone is valid

#### Scenario: SDD-owned run awaited generically

- **WHEN** a controller awaits an SDD-owned run with `xagent_await`
- **THEN** the await behaves identically to a generic run, delivering `turn.completed` report text from the durable event log
- **AND** performs no ledger write as a side effect of delivery

### Requirement: xsvc-6 — Security: working-directory validation

WHEN `xagent_start_non_sdd` or `xagent_sdd_start` receives a working directory, THE xagent service SHALL require an absolute path to an existing directory, resolve it canonically before process launch, use the resolved directory as the provider and prompt-renderer current working directory, and reject invalid paths without creating run state, an `sdd_agents` row, or a child process.

#### Scenario: Existing worktree

- **WHEN** the controller starts a generic or SDD run with an absolute path to an existing worktree
- **THEN** the provider launches with the canonical worktree path as its current working directory
- **AND** an SDD prompt renderer uses that same canonical path as its working directory
- **AND** an SDD dispatch records that canonical path as the `sdd_agents` row's `cwd`

#### Scenario: Invalid working directory

- **WHEN** the controller supplies a relative, missing, or non-directory path to either start tool
- **THEN** the service returns a structured `invalid_working_directory` error
- **AND** creates no run, `sdd_agents` row, or child process

### Requirement: xsvc-7 — Recovery: stale ownership reconciliation

WHEN the xagent service starts with metadata for a non-terminal run that it cannot safely reattach, THE service SHALL mark the run `abandoned`, emit deterministic attention, and clean up a stale provider process only when persisted PID and process-start identity prove that the process is the one xagent owned. THE service SHALL bind its listener (or otherwise acquire exclusive ownership of the bind port) BEFORE running reconciliation, so a duplicate start against an already-occupied port exits on `EADDRINUSE` without reconciling, signalling, or abandoning runs owned by the running instance. THE service SHALL NOT accept controller work (`/mcp`) or report `healthy: true` on `/health` until startup reconciliation resolves, so a run created in the listen→reconcile window cannot be enumerated by the in-flight reconciliation scan. THE service SHALL skip runs owned by the live `XagentRunManager` of this same instance when reconciling, so a run created after the bind but before reconciliation resolves is not marked `abandoned` or signalled. Reconciliation SHALL only enumerate runs whose persisted `supervision.phase` is non-terminal (`starting`, `running`, or `ready`); runs whose persisted phase is already terminal (`completed`, `failed`, `cancelled`, or `abandoned`) — including legacy `xagent run` records advanced to a terminal phase by their exit-status update — SHALL NOT be reconciled.

#### Scenario: Stale owned process identity matches

- **WHEN** startup finds active metadata and a live process matching both the persisted PID and process-start identity
- **THEN** the service terminates that stale owned process group
- **AND** records the run as `abandoned`

#### Scenario: Process identity cannot be proven

- **WHEN** startup finds active metadata but no live process has the persisted identity
- **THEN** the service records the run as `abandoned`
- **AND** does not signal or terminate an unproven process

#### Scenario: Duplicate start against an occupied port does not reconcile live runs

- **WHEN** a second xagent service start is attempted while the bind port is already occupied by the running service
- **THEN** the second instance exits on `EADDRINUSE` before running reconciliation
- **AND** does not signal, terminate, or abandon any run owned by the running instance
- **AND** leaves every live owned worker process running

#### Scenario: Health gate holds controller work until reconciliation resolves

- **WHEN** the xagent service has bound its listener but startup reconciliation has not yet resolved
- **THEN** `GET /health` responds 200 with `healthy: false` and a `reason` indicating reconciliation in progress
- **AND** `POST /mcp` (controller work) is rejected with 503 until reconciliation resolves
- **AND** `POST /exit` remains available so a wedged startup can still be stopped

#### Scenario: Reconciliation skips runs owned by the live instance

- **WHEN** a run is created through the live `XagentRunManager` after the listener binds but before reconciliation resolves
- **THEN** reconciliation skips that run (it is in the live manager's `listRunIds()`)
- **AND** does not mark it `abandoned`, signal its owned process, or append `stale_run_abandoned` attention events to its log

#### Scenario: Legacy completed run is not reconciled as stale

- **WHEN** startup discovers a run whose `exit_status` is `completed` or `failed` and whose `supervision.phase` was advanced to a terminal value by the legacy `xagent run` exit-status update
- **THEN** reconciliation does not enumerate the run as stale
- **AND** leaves its phase, exit status, and normalized log unchanged

### Requirement: xsvc-8 — Ledger: insert-only per-agent dispatch index

WHEN `xagent_sdd_start` accepts a dispatch, THE xagent service SHALL insert exactly one row into the schema-version-2 `sdd_agents` table (`agent_id`, `plan_path`, `task`, `role`, `brief_path`, `brief_text`, `cwd`, `dispatched_at`) before creating the run; THE service SHALL provision no other SDD table or view at schema version 2 (the v1 `sdd_dispatch_log` view has no v2 replacement), SHALL never update or delete `sdd_agents` rows, SHALL store no turn status, report text, session closure, harness, model, or effort in the ledger, and SHALL refuse to open a ledger database whose `user_version` is not 2 with an actionable error naming the reprovision step.

#### Scenario: Row precedes the run

- **WHEN** an SDD dispatch is accepted
- **THEN** the `sdd_agents` row is inserted before the provider run record is created
- **AND** the row carries the brief file's content as read at dispatch time

#### Scenario: Dispatch failure leaves an immutable tombstone

- **WHEN** run creation, provider start, or the initial submit fails after the row is inserted
- **THEN** the row remains unchanged as a dispatch-failure tombstone
- **AND** no ledger column is mutated to record the failure, whose cause lives in the run record when one exists

#### Scenario: No ledger writes after dispatch

- **WHEN** an SDD-owned run completes a turn, fails, is interrupted, is closed, or is abandoned by startup reconciliation
- **THEN** the `sdd_agents` table is not written
- **AND** the run record alone reflects the change

#### Scenario: Service restart performs no ledger repair

- **WHEN** the xagent service restarts with SDD-owned runs in any phase
- **THEN** startup runs no ledger reconciliation, repair, or abandonment query against `sdd_agents`
- **AND** the ledger's content is byte-identical before and after the restart

#### Scenario: Wrong schema version fails loudly

- **WHEN** the service opens an `sdd.sqlite` whose `user_version` is 1 (or any value other than 2)
- **THEN** it refuses to start the SDD manager with an error naming the file to delete and stating that v1 data is not migrated

### Requirement: xsvc-9 — Events: durable `turn.submitted` submitted-text record

WHEN a supervised run's supervisor accepts text for submission, THE xagent service SHALL append a `turn.submitted` normalized event — `type: "turn.submitted"`, `phase: "running"`, `reason: "turn_submitted"`, payload `{ text, turn_id }` where `text` is the full submitted text (rendered SDD prompts with any appended controller note, and raw `xagent_message` text alike) sanitized identically to every other persisted payload and `turn_id` matches the id carried by the same turn's completion or failure payload — with the next supervision sequence number, durably appended via the event sink after the `running`/`turn_started` state event and before the provider adapter's submit is invoked; `turn.submitted` SHALL be non-deliverable: it SHALL NOT complete a live await, SHALL be excluded by the persisted-await wake filter, and SHALL NOT enter leader context unprompted; WHEN the durable append fails, THE service SHALL fail the submit without handing the text to the provider.

#### Scenario: SDD dispatch text is durable

- **WHEN** `xagent_sdd_start` submits a rendered prompt with a controller `note`
- **THEN** `normalized.jsonl` contains a `turn.submitted` event whose text includes both the rendered prompt and the appended note
- **AND** the event's sequence number precedes the turn's completion events

#### Scenario: Chit-chat is durable

- **WHEN** a controller sends `xagent_message` to an SDD-owned run to answer a worker question
- **THEN** the message text is recorded as a `turn.submitted` event in sequence order
- **AND** no ledger row or classification state is created for it

#### Scenario: Awaits ignore submissions

- **WHEN** a controller is blocked in `xagent_await` and a `turn.submitted` event is appended
- **THEN** the await does not complete on that event
- **AND** the persisted-await wake filter likewise never returns a `turn.submitted` event

#### Scenario: Service death cannot lose submitted text

- **WHEN** the service crashes at any point after the provider adapter's submit was invoked — including mid-stream, before the turn completes
- **THEN** the `turn.submitted` event for that submission is already durable in `normalized.jsonl`
- **AND** its sequence number falls between the turn's `turn_started` state event and every provider-derived event of that turn

### Requirement: xsvc-10 — Ledger: immutable start role and durable brief

WHEN `xagent_sdd_start` accepts a dispatch, THE xagent service SHALL record the role the agent starts as and SHALL never rewrite it when the agent is later reused for another turn kind; THE service SHALL store the brief's content as `brief_text` read at dispatch time, so the assignment remains readable by SQL after the worktree that held the brief file is deleted or the file is edited; THE service SHALL NOT record any lineage link between agents.

#### Scenario: Reuse does not rewrite the role

- **WHEN** an implementer completes its task turn and is then sent a `fix` follow-up on the same agent
- **THEN** its `sdd_agents` row still records role `implementer`
- **AND** no second row is written

#### Scenario: Brief survives its worktree

- **WHEN** an agent is dispatched with a brief inside a worktree
- **AND** the worktree is deleted afterwards
- **THEN** `SELECT brief_text FROM sdd_agents WHERE agent_id = ?` still returns the brief exactly as the agent received it

#### Scenario: Brief drift is detectable

- **WHEN** the brief file at `brief_path` is edited after dispatch
- **THEN** the stored `brief_text` still reflects what was dispatched
- **AND** comparing the file against `brief_text` identifies the drift

#### Scenario: Ordering, not lineage, relates agents

- **WHEN** a task has an implementer, then a fresh `fixer`, then another `fixer`
- **THEN** all three rows share `plan_path` and `task`
- **AND** their relationship is recoverable by ordering on `dispatched_at`, with no controller-supplied link

### Requirement: xsvc-11 — SDD dispatch: four-way start role union

WHEN `xagent_sdd_start` is called, THE xagent service SHALL accept exactly the roles `implementer`, `reviewer`, `fixer`, and `re-reviewer` as a discriminated union over strict objects that all share the assignment fields (`note?`, `cwd`, `plan`, `model`, `harness`, `effort`, `policy?`) and additionally require: for `implementer` — `task`, `name`, `brief`, `report_out`, `context?`; for `reviewer` — `brief` (unifying v1 `brief` and `review_brief`), `base`, `head`, and an optional `task` that when present requires `implementer_report` and permits `constraints?`/`diff?`, and when absent requires `description` and forbids `implementer_report`/`constraints`/`diff`; for `fixer` — `task`, the original `brief`, `findings`, `findings_text`, `tests`, and `report_out`, with no `name` or `context` field; for `re-reviewer` — `task`, the original review `brief`, `findings`, `fixer_report`, `base`, `head`, `diff?`; `fixer` and `re-reviewer` SHALL each accept an optional `round` defaulting to 1, which — exactly as in xsvc-12 — parameterizes only the rendered text and is recorded nowhere but the resulting `turn.submitted` event; what those roles SHALL NOT have is a `name` field encoding the round into an assignment identity; `reviewer` with a `task` SHALL render the task-review template and `reviewer` without a `task` SHALL render the whole-branch review template; `fixer` SHALL render the service-owned fix prompt rather than encoding the fix round into an assignment name; every dispatch SHALL therefore carry a brief, read at dispatch time into `brief_text`.

THE assignment field naming a provider model SHALL be `model`, matching `xagent_start_non_sdd`; the retired name `agent` SHALL NOT be accepted. THE report field SHALL be named for the direction the receiving role applies to it: `report_out` where the dispatched agent writes the file, `implementer_report` and `fixer_report` where it reads an existing one. No compatibility alias for `agent`, `report`, or `agent_id` SHALL be accepted on either dispatch tool.

#### Scenario: Reviewer merge replaces the v1 role split

- **WHEN** a controller dispatches role `reviewer` with `task: 4`
- **THEN** the task-review template renders for task 4
- **AND** dispatching role `reviewer` without a task renders the whole-branch review template with `task` NULL in the ledger row

#### Scenario: Fresh fixer without impersonation

- **WHEN** a controller dispatches role `fixer` for a task whose implementer is dead, passing the original brief, the findings file, and covering tests
- **THEN** the rendered prompt identifies the work as a fix for that plan and task
- **AND** no assignment name of the form "Task N Fix Round M" is required or rendered as the task identity

#### Scenario: Unknown role rejected

- **WHEN** a controller dispatches role `task-reviewer` or `code-reviewer` (the v1 names) or any other unlisted role, or passes the v1 field name `review_brief` to role `reviewer`
- **THEN** input validation rejects the call before any ledger or run state is created

#### Scenario: Re-reviewer carries the original review brief

- **WHEN** a controller dispatches role `re-reviewer` for a reviewed task, passing the brief the original reviewer was dispatched with
- **THEN** the dispatch inserts a row whose `brief_path`/`brief_text` record that brief, satisfying the ledger's unconditional NOT NULL brief columns
- **AND** a `re-reviewer` dispatch without a `brief` is rejected by input validation

#### Scenario: Retired field names are rejected, never ignored

- **WHEN** a controller sends `agent`, `report`, or `agent_id` on `xagent_sdd_start`, alone or alongside the replacing field
- **THEN** the call is rejected with a structured validation error naming the retired field
- **AND** the retired key is not stripped before the union sees it

### Requirement: xsvc-12 — SDD continuation: demoted `xagent_sdd_followup`

WHEN `xagent_sdd_followup` is called with kind `fix` or `re-review`, THE xagent service SHALL accept as input for `fix`: `run_id`, `round`, `findings`, `findings_text`, `tests`, `report_out`, `note?`, and for `re-review`: `run_id`, `round`, `findings`, `fixer_report`, `base`, `head`, `diff?`, `note?` — where the report field is a required tool input (the v2 ledger stores no report path) named for the direction its kind applies to it, the brief is sourced from the target agent's own `sdd_agents` row and never from input, and `round` parameterizes only the rendered text, recorded nowhere but the resulting `turn.submitted` event; THE service SHALL render the continuation and submit it to the same live agent without writing the ledger, returning `{ run_id, sequence }` with no v1 `turn_number` field, validating only that an `sdd_agents` row exists (else `unknown_sdd_agent`), that the run is live in the run manager, and that the kind matches the agent's immutable start role (`fix` for `implementer` or `fixer`; `re-review` for `reviewer` or `re-reviewer`, else `sdd_followup_role_mismatch`); WHEN the run is not live, THE service SHALL return a structured `sdd_agent_not_live` error — replacing v1's `sdd_session_terminal` — whose details name the fresh-agent recovery: the role to dispatch for the same `plan` and `task`, naming the plan as `plan` rather than the internal ledger column name.

WHERE kind `re-review` renders the upstream re-review template, `diff` SHALL be required unless the conventional review-package file is derivable in the plan workspace, on the same terms as a task-scoped `reviewer` start.

THE service SHALL refuse a follow-up in every supervision phase except `ready`, with a structured error rather than a bare provider phase error: terminal phases (`completed`, `failed`, `cancelled`, `abandoned`) SHALL return `sdd_agent_not_live` as above, and every other non-`ready` phase SHALL return `sdd_agent_busy` naming the observed phase and `xagent_await` as the recovery tool. A re-review addressed to a task-less (whole-branch) reviewer SHALL return `sdd_followup_task_required` before any prompt is rendered. Every recovery pointer SHALL name a tool the service actually registers.

#### Scenario: A dead but still-tracked agent gets the signpost

- **WHEN** a controller sends a follow-up to an agent whose supervisor has reached a terminal phase but whose run is still tracked by the run manager
- **THEN** the service returns `sdd_agent_not_live` with the fresh-agent recovery details
- **AND** submits nothing to the provider
- **AND** the controller never receives an unstructured phase error it cannot act on

#### Scenario: A mid-turn agent is told to wait, not stranded

- **WHEN** a controller sends a follow-up to an agent that is starting or already running a turn
- **THEN** the service returns `sdd_agent_busy` naming the observed phase
- **AND** the recovery names `xagent_await`, which the service registers

#### Scenario: Same-agent fix writes no ledger state

- **WHEN** a controller sends kind `fix` to a live implementer
- **THEN** the fix prompt is rendered and submitted, appearing as a `turn.submitted` event
- **AND** the `sdd_agents` table is unchanged

#### Scenario: Dead agent gets a signpost, not a dead end

- **WHEN** a controller sends kind `fix` to an agent whose run is terminal or absent from the run manager
- **THEN** the service returns `sdd_agent_not_live`
- **AND** the error details state that recovery is `xagent_sdd_start` with role `fixer` for the same plan and task

#### Scenario: Kind must match start role

- **WHEN** a controller sends kind `re-review` to an agent whose start role is `implementer`
- **THEN** the service rejects the call with a structured role-mismatch error
- **AND** submits nothing to the provider

#### Scenario: Careless controllers cannot corrupt the ledger

- **WHEN** a controller double-calls `xagent_sdd_followup`, skips it entirely, or calls it after the agent died
- **THEN** no `sdd_agents` row is created, mutated, or orphaned in any of those cases
- **AND** every submitted continuation remains recoverable from `turn.submitted` events

#### Scenario: Re-review without a diff fails at the facade

- **WHEN** a controller sends kind `re-review` with no `diff` and no derivable review-package file in the plan workspace
- **THEN** the service rejects the call naming `diff`
- **AND** submits nothing to the provider

### Requirement: xsvc-13 — Recovery: SDD identity and tombstones in `xagent_list`

WHEN `xagent_list` returns runs, THE xagent service SHALL join `sdd_agents` identity onto SDD-owned rows as an `sdd` block carrying exactly `role`, `plan` (the plan name, `basename(plan_path)` as in v1), `task` (absent when NULL), `cwd`, `brief_path`, and `dispatched_at` — dropping v1's `agent` and `closed` fields — and SHALL additionally return ledger rows that have no run record as tombstone entries of a parallel shape carrying exactly `run_id`, `run_missing: true`, and the `sdd` block, ordered among the results by their `dispatched_at`; `run_missing` SHALL never appear on rows that have a run record.

#### Scenario: Lost start response recovered by identity

- **WHEN** a controller loses an `xagent_sdd_start` response and lists runs
- **THEN** the SDD-owned row identifies itself by role, plan, and task
- **AND** the controller can resume awaiting without guessing among bare run ids

#### Scenario: Dispatch that never became a run is visible

- **WHEN** a dispatch failed between the ledger insert and run-record creation
- **THEN** `xagent_list` returns a tombstone entry for the `agent_id` flagged `run_missing: true` with its `sdd` identity block
- **AND** the entry carries no phase, sequence, or live flag fabricated from a nonexistent run record

#### Scenario: Non-SDD rows unchanged

- **WHEN** `xagent_list` returns a generic supervised run
- **THEN** the row carries no `sdd` block and no `run_missing` flag
- **AND** its shape is unchanged from the pre-v2 contract

### Requirement: xsvc-14 — Retention: run directories are the system of record

WHILE an `sdd_agents` row references a run directory, THE xagent service SHALL treat `<log_root>/<agent_id>/` as the durable system of record for that agent's reports and submitted prompts. THE service SHALL NOT prune, truncate, rotate, compact, or delete `normalized.jsonl` or its containing run directory for any ledger-referenced run, and no retention, cleanup, or garbage-collection feature SHALL be able to do so. Because `sdd_agents` is insert-only and never deletes rows, a referenced run directory stays referenced permanently: there is no age, disk-pressure, or completion condition that makes deleting it legal. Service documentation SHALL state that deleting a ledger-referenced run directory destroys the only copy of that agent's reports and prompts.

#### Scenario: Report recovery long after completion

- **WHEN** a controller (or a human) needs an SDD report weeks after the agent completed and the service has restarted many times
- **THEN** the report text is readable from the `turn.completed` event in that run's `normalized.jsonl`
- **AND** no ledger column was expected to hold it

#### Scenario: Pruning a ledger-referenced run is illegal

- **WHEN** any retention, cleanup, or garbage-collection path is asked to remove or shrink a run directory whose `agent_id` appears in `sdd_agents`
- **THEN** it refuses and leaves the directory byte-for-byte intact
- **AND** it surfaces the refusal rather than skipping the directory silently
- **AND** shipping a build that deletes such a directory violates this requirement regardless of the run's age, phase, or the disk pressure that motivated it

#### Scenario: Unreferenced runs are the only prunable ones

- **WHEN** cleanup considers a run directory whose `agent_id` has no row in `sdd_agents`
- **THEN** removing it is permitted
- **AND** the referenced-versus-unreferenced test is a ledger query, not a filename, mtime, or age heuristic

#### Scenario: Archival is not an exemption

- **WHEN** someone proposes copying a ledger-referenced run elsewhere and then deleting the original
- **THEN** that is a deletion under this requirement and is equally illegal
- **AND** permitting it requires amending this requirement first, not working around it

### Requirement: xsvc-15 — MCP: SDD dispatch tools advertise their input contract

WHEN an MCP client lists tools, THE xagent service SHALL advertise, for `xagent_sdd_start` and `xagent_sdd_followup`, an input schema that names every accepted field and its JSON type — including the discriminating `role` and `kind` fields with their permitted values, and for each variant-specific field a description naming the variants that require it — so that a client which has never seen the service can construct a valid call from discovery alone; THE service SHALL NOT advertise an empty or field-less schema for either tool.

The MCP SDK derives a tool's advertised schema only from an object schema; a Zod discriminated union normalizes to `undefined` and is published as the empty object. Registration SHALL therefore supply an object schema that is a **superset** of the union — the discriminator as an enumeration, the fields shared by every variant as required, and every variant-specific field as optional — while the handler SHALL continue to parse each call against the union itself. The union remains the sole authority for rejection; the advertised schema exists to describe, never to enforce.

THE advertised schema SHALL NOT reject anything the union accepts. Discovery may be more permissive than enforcement, because an over-permissive schema costs a caller one structured validation error, whereas an over-strict one hides a legal call that the service would have served.

BECAUSE the SDK validates call arguments against the registered advertised schema before the handler runs, and a plain object schema strips keys it does not declare, THE advertised schemas for both dispatch tools SHALL preserve unknown keys so the union receives them. A retired or misspelled field that the advertised schema silently removes cannot be rejected by the union, which would convert a loud error into a wrong dispatch.

#### Scenario: A cold client can construct a dispatch

- **WHEN** an MCP client lists tools and reads the `xagent_sdd_start` input schema without prior knowledge of the service
- **THEN** the schema names `role` with its four permitted values, and the assignment and role-specific fields with their types
- **AND** a call constructed from that schema alone passes input validation

#### Scenario: Field-less schemas are a defect

- **WHEN** any advertised SDD dispatch tool schema is inspected
- **THEN** it declares at least the discriminating field and the fields shared by every variant
- **AND** a schema with no properties fails the service's own tool-surface tests

#### Scenario: Discovery never hides a legal call

- **WHEN** a payload that the union accepts is checked against the advertised schema, for every start role and every follow-up kind
- **THEN** the advertised schema accepts it too
- **AND** the tool-surface suite fails if any variant's valid payload is rejected by the advertised schema

#### Scenario: Enforcement stays with the union

- **WHEN** a client sends a payload the advertised superset permits but the union rejects — a `fixer` missing `findings`, or a task-less `reviewer` that sets `implementer_report`
- **THEN** the handler rejects it with the union's own structured validation error
- **AND** the advertised schema is never consulted at runtime

#### Scenario: Unknown keys survive to the union

- **WHEN** a client sends a retired or misspelled field alongside an otherwise valid payload, through the real MCP boundary
- **THEN** the key reaches the union rather than being stripped by the advertised schema
- **AND** the union rejects the call with a structured error naming that field

### Requirement: xsvc-16 — Dispatch tools return when the turn starts, never when it completes

WHEN `xagent_sdd_start` or `xagent_sdd_followup` accepts a dispatch, THE xagent service SHALL return once the turn is **durably started** — the run exists and its `turn_started` event is persisted — and SHALL NOT wait for the turn to complete. Awaiting completion is `xagent_await`'s job and no other tool's.

A submit whose failure surfaces after the tool has returned SHALL still be observable: either as a durable failure event on the run, or through `xagent_inspect`. Detaching the submit SHALL NOT convert a failed dispatch into a silent one.

THE `sequence` a dispatch tool returns SHALL be a cursor the caller can pass directly to `xagent_await` as `after_sequence` without missing the turn's completion or replaying an event it has already seen.

**Why this is stated at all.** `Supervisor.submit` resolves at turn *completion*, not acceptance — it consumes the entire provider event stream. Two call sites awaited it directly, so both dispatch tools blocked for the full duration of a subagent's turn, minutes at a time, and appeared to fail against every client timeout while actually succeeding. A controller that retried on that apparent failure would spawn a duplicate agent. The generic `xagent_start_non_sdd` never had the defect because it detaches the submit and waits only for the turn to reach running; nothing in the spec said the SDD path had to do the same.

#### Scenario: A dispatch returns while its turn runs

- **WHEN** a controller dispatches an agent whose first turn takes minutes
- **THEN** the dispatch tool returns as soon as the turn is durably started
- **AND** the response carries the agent id and a usable await cursor
- **AND** the controller's next action is an await, not a retry

#### Scenario: A late submit failure is not swallowed

- **WHEN** the submit fails after the dispatch tool has already returned
- **THEN** the failure is visible as a durable event on the run or through inspection
- **AND** the controller can distinguish it from a run that is merely still working

#### Scenario: The returned cursor is usable

- **WHEN** a controller passes a dispatch tool's returned `sequence` to `xagent_await` as `after_sequence`
- **THEN** the await delivers that turn's completion
- **AND** does not replay an event the controller has already been given

### Requirement: xsvc-17 — MCP: advertised SDD field descriptions derive from a dispatch field manifest

WHEN an MCP client reads the advertised `xagent_sdd_start` or `xagent_sdd_followup` input schema, THE xagent service SHALL derive every artifact-field description from a **dispatch field manifest** rather than from independently authored prose, and SHALL fail its own tool-surface suite when a description, direction, or required condition disagrees with that manifest.

**The variant registry.** THE service SHALL declare a closed registry naming exactly seven public dispatch variants — `implementer`, `reviewer:task`, `reviewer:branch`, `fixer`, `re-reviewer`, `followup:fix`, and `followup:re-review` — **and, for each, the canonical set of in-scope public fields it accepts**. A bare list of variant names is not a registry: without the per-variant field matrix there is nothing for the manifest to be equal to.

THE suite SHALL assert three independent equalities, because each closes a different seam:

1. The variants the union, the reviewer refinement, and the dispatch router actually recognize SHALL equal the registry's variant keys. Without this, a new route can be added while registry and manifest stay equal to each other and both stay wrong.
2. The public `(variant, field)` pairs the schemas actually accept, **less the operational exclusion set**, SHALL equal the registry matrix. The subtraction is required, not optional: the registry holds in-scope fields only, so comparing it against the unfiltered accepted set can never succeed.
3. The manifest's **caller-input projection** SHALL equal the registry matrix.

**In-scope and operational fields.** An in-scope field is one the caller supplies that reaches a role prompt as a named contract value. THE operational exclusion set SHALL be exactly `role`, `kind`, `cwd`, `model`, `harness`, `effort`, `policy`, `note`, and `run_id`.

Most of those are routing, transport, or supervision inputs no prompt consumes. `note` is excluded for a different reason and SHALL be documented as such: the service appends it verbatim to every rendered prompt regardless of role, so it is a generic post-render annotation rather than part of any role's field contract. It has no per-variant direction, derivation, or required condition to describe, which is precisely what the manifest exists to record.

**Artifact fields.** An artifact field is an in-scope field whose value is a filesystem path: `plan`, `brief`, `report_out`, `implementer_report`, `fixer_report`, `constraints`, `diff`, and `findings`. Non-artifact in-scope fields — `task`, `name`, `context`, `description`, `base`, `head`, `round`, `tests`, `findings_text` — SHALL appear with a null direction, because dpr-10 can name their renderer options in a fault trailer.

**Manifest entries.** Each entry SHALL carry: `variant`; `field`; `source`; `renderer_option` or an explicit service-formatted marker; **`provenance`**; `surface_kind`; `direction`; `transport`; `required_condition`; and `derivation`.

**Provenance.** THE `provenance` SHALL be `caller_input`, `ledger`, or `derived`. Not every renderer argument comes from the caller: a `followup:re-review` sources `--plan`, `--task`, and `--brief` from the target agent's `sdd_agents` row, and the follow-up schema deliberately exposes none of them.

THE manifest SHALL be keyed by `(variant, renderer_option, provenance)`, and SHALL carry one entry for **every reachable provenance** of each option. An option reachable two ways gets two entries: `--diff` and `--constraints` on a task-scoped reviewer are `caller_input` when supplied and `derived` when satisfied from the plan workspace, and both paths must be describable — the first to advertise the field, the second to classify a fault on the derived value. A singular provenance per option cannot express this, and an implementation that recorded only the caller path would misclassify a derived-value fault.

THE **caller-input projection** — the entries whose provenance is `caller_input`, reduced to `(variant, field)` — is what equals the registry matrix. The full manifest is a superset of that projection, covering every renderer and service prompt argument whatever its source. Only `caller_input` entries SHALL carry a surface field; `ledger` and `derived` entries SHALL carry null, so the manifest is simultaneously exactly equal to the public surface under projection and complete over prompt arguments.

**Direction is artifact lifecycle, not who does the reading.** `reads` SHALL mean the supplied path must identify an existing file consumed by the dispatch pipeline — by the renderer, by the agent, or by both. `writes` SHALL mean the path is an agent output destination. Direction SHALL NOT be defined as what the dispatched agent does with the path: for a whole-branch reviewer the renderer inlines `--requirements` and the agent never receives the path at all, so an agent-centred definition would make `reads` untrue for the one field that most needed describing. `transport` carries the orthogonal fact dpr-5 declares on the slot, so `reviewer:branch`'s `brief` records `direction: reads` with `transport: inlined_contents` and both are true. `plan` is `reads` under this definition — it must exist, and the pipeline consumes it to locate the workspace. Fields whose surface value is inline text SHALL carry a null direction.

**Two sources.** The manifest SHALL draw from exactly two sources whose union equals the registry:

1. The renderer's slot table (dpr-11) plus the service's own record of how it adapts each renderer-backed variant — which surface field maps to which renderer option, and where a path surface field is delivered through a text slot. `dispatch-prompt` renders `implementer`, both `reviewer` variants, `re-reviewer`, and `followup:re-review`.
2. A service-owned declaration for the variants the renderer has no template for — `fixer` and `followup:fix`. Superpowers ships no fix template; upstream a fix is a follow-up to a live implementer or a fresh implementer, so `fixer` is a service-local recovery role whose prompt text is the authority for its fields.

**Construction.** THE manifest SHALL be a checked-in artifact generated from `dispatch-prompt --describe-slots` by the repository's packaging step, verified by a `--check` mode that fails when the checked-in copy diverges from the renderer. It SHALL NOT be built by executing the renderer during service startup or MCP registration: the advertised schemas are module-level constants and registration is synchronous, so a startup subprocess would add Python availability, renderer resolution, and schema-version negotiation to the service's boot path for data that changes only when the renderer does. Generation SHALL fail loudly on an unsupported `schema_version` rather than degrade.

#### Scenario: Read-direction paths are advertised as inputs

- **WHEN** a client reads the advertised schema for a variant that reads an existing report — `reviewer:task`, `re-reviewer`, or `followup:re-review`
- **THEN** the field is named for the report it reads rather than the generic `report`
- **AND** its description states that the file must already exist and is read, not written

#### Scenario: Write-direction paths are advertised as outputs

- **WHEN** a client reads the advertised schema for a variant that writes its own report — `implementer`, `fixer`, or `followup:fix`
- **THEN** the field is `report_out`
- **AND** its description states that the agent writes to that path

#### Scenario: Surface direction survives an inlining transport

- **WHEN** the manifest describes `reviewer:branch`'s `brief`, delivered through the renderer's `--requirements` text slot
- **THEN** the entry records direction `reads`, `surface_kind` path, and transport `inlined_contents`
- **AND** the renderer's own slot table still declares no direction for that slot, without the suite reporting a contradiction

#### Scenario: The registry is bound to the routes that actually exist

- **WHEN** the suite enumerates the variants the union, the reviewer refinement, and the dispatch router recognize
- **THEN** that set equals the registry's variant keys
- **AND** a route added without registering it fails the suite, rather than passing because registry and manifest remain equal to each other

#### Scenario: The registry matrix is bound to the accepted fields

- **WHEN** the suite enumerates the `(variant, field)` pairs the schemas actually accept
- **THEN** that set equals the registry matrix
- **AND** the manifest's caller-input pairs equal the registry's in-scope pairs

#### Scenario: A new variant reusing only existing fields cannot slip through

- **WHEN** a variant is introduced that reuses only fields already advertised, and is not added to the registry
- **THEN** the suite fails
- **AND** the failure names the unregistered variant rather than passing because the flat advertised field set was unchanged

#### Scenario: Ledger-sourced renderer arguments carry no surface field

- **WHEN** the manifest describes `followup:re-review`'s `--plan`, `--task`, and `--brief`, which the service reads from the `sdd_agents` row
- **THEN** each entry carries provenance `ledger` and a null surface field
- **AND** those entries are excluded from the registry comparison, so the manifest is complete over renderer arguments without claiming public fields that do not exist

#### Scenario: Conditionally required fields say what satisfies them

- **WHEN** a field is required by its prompt source and a documented derivation can satisfy it
- **THEN** the description states the condition and names the derivation
- **AND** the field is not described as unconditionally optional

#### Scenario: The checked-in manifest cannot silently diverge

- **WHEN** the renderer's slot table changes and the checked-in manifest is not regenerated
- **THEN** the packaging `--check` mode fails
- **AND** the failure names the diverging template and option

#### Scenario: Non-artifact fields need no direction

- **WHEN** the suite inspects `context`, `description`, `findings_text`, `base`, `head`, `task`, or `round`
- **THEN** it requires no direction for them
- **AND** their presence with a null direction is not a failure

### Requirement: xsvc-18 — MCP: renderer argument failures are structured, coded, and named in surface vocabulary

WHEN `dispatch-prompt` exits non-zero having emitted an allowlisted argument-fault trailer (dpr-10) **whose option resolves to a manifest entry with provenance `caller_input`**, THE xagent service SHALL return a structured `sdd_renderer_bad_input` error whose details carry the fixed `reason` code and the **corresponding surface field** for the variant being dispatched, and SHALL continue to withhold raw renderer stderr, which can echo brief and plan body text. Faults on `ledger` and `derived` options are covered separately below and SHALL NOT return this error. THE service SHALL return the opaque `sdd_renderer_failed` for any non-zero exit whose trailer is absent, unparseable, carries a reason outside the allowlist, or names a renderer option the facade never sends.

THE allowlisted reason codes SHALL be exactly: `no_such_file`, `empty_file`, `parent_missing`, `not_accepted`, and `required_missing`.

THE public `details` shape SHALL be exactly `{ reason, field }` for `required_missing` and `not_accepted`, and `{ reason, field, path }` for `no_such_file`, `empty_file`, and `parent_missing`. THE details SHALL NOT carry the renderer template name, the renderer option, or any other renderer-internal vocabulary. `field` names the surface field corresponding to the faulting option for that variant — not necessarily a field the caller sent, since `required_missing` fires precisely when the caller sent nothing.

THE service SHALL translate the renderer option to the surface field through the same dispatch field manifest xsvc-17 describes the schema from. The mapping is variant-aware, because one renderer option serves differently named surface fields: `--report` backs `report_out` for an `implementer`, `implementer_report` for `reviewer:task`, and `fixer_report` for `re-reviewer`. Returning the raw renderer flag SHALL be a defect: it reintroduces the retired ambiguous vocabulary and does not identify the caller's own field. The manifest covers every renderer option the facade sends, including the non-artifact ones dpr-10 can name — `--name`, `--base`, `--head`, `--task`, `--round` — so every trailer arising from caller input has a surface field to report.

**Ledger-sourced faults are not bad caller input.** WHERE the faulting option's manifest entry has provenance `ledger` — a `followup:re-review` whose stored `plan` or `brief` has moved, been deleted, or been emptied since dispatch — THE service SHALL NOT return `sdd_renderer_bad_input`, because the caller supplied no such field and naming one would blame it for a value it never sent. THE service SHALL instead return `sdd_stored_artifact_missing` with details exactly:

`{ run_id, artifact: "plan" | "brief", path, plan, task, recovery: { tool: "xagent_sdd_start", role: "re-reviewer" } }`

— naming the plan as `plan`, never `plan_path`, since the recovery call takes `plan`. An option with provenance `derived` SHALL fall back to `sdd_renderer_failed`: a derived value the caller never chose is a workspace-state fault, not an input the caller can correct by re-sending it.

THE stored-artifact condition SHALL be limited to what the renderer actually validates. `--brief` is a `reads` slot, so a deleted **or empty** stored brief faults. `--plan` is checked for existence only, so a deleted stored plan faults and an empty one does not. Requiring an empty-plan fault would mean adding plan-content validation that no requirement asks for.

An option name and a caller-supplied path are already in the caller's own request, so returning them discloses nothing the caller did not send. Withholding them forced two controllers to reproduce the renderer invocation by hand to learn which flag was wrong, and one escalated on a misdiagnosis.

#### Scenario: A missing input file names the caller's field

- **WHEN** a `reviewer:task` start supplies an `implementer_report` path that does not exist
- **THEN** the service returns `sdd_renderer_bad_input` with details `{ reason: "no_such_file", field: "implementer_report", path }`
- **AND** no renderer stderr, template name, or renderer option appears in the response

#### Scenario: The same renderer option maps per variant

- **WHEN** the identical `no_such_file` trailer for `--report` arises from an `implementer`, a `reviewer:task`, and a `re-reviewer`
- **THEN** the returned field is `report_out`, `implementer_report`, and `fixer_report` respectively

#### Scenario: A deleted ledger-sourced artifact is not blamed on the caller

- **WHEN** a `followup:re-review` renders and the `brief` stored in the agent's `sdd_agents` row has been deleted or emptied since dispatch
- **THEN** the service returns `sdd_stored_artifact_missing`, not `sdd_renderer_bad_input`
- **AND** the details are exactly `{ run_id, artifact, path, plan, task, recovery }` with the plan named `plan`
- **AND** no field the caller never sent is named as bad input
- **AND** a deleted stored plan faults the same way, while an empty stored plan does not, matching what the renderer validates

#### Scenario: Non-artifact options also resolve to a surface field

- **WHEN** the renderer emits `required_missing` or `not_accepted` for a non-artifact option such as `--name`, `--base`, `--head`, `--task`, or `--round`
- **THEN** the service returns `sdd_renderer_bad_input` naming that option's surface field
- **AND** does not fall back to the opaque error merely because the field carries no direction

#### Scenario: Details shape follows the reason

- **WHEN** the reason is `required_missing` or `not_accepted`
- **THEN** details carry exactly `reason` and `field`
- **AND** when the reason is a path fault, details carry exactly `reason`, `field`, and `path`

#### Scenario: Every allowlisted reason classifies for caller input

- **WHEN** the renderer emits each of `no_such_file`, `empty_file`, `parent_missing`, `not_accepted`, and `required_missing` for an option whose manifest entry has provenance `caller_input`
- **THEN** each returns `sdd_renderer_bad_input` carrying that reason code
- **AND** the same reason on a `ledger` option returns `sdd_stored_artifact_missing` instead

#### Scenario: Unrecognized renderer failures stay opaque

- **WHEN** the renderer exits non-zero with no parseable trailer, a reason outside the allowlist, or an option the facade never sends
- **THEN** the service returns `sdd_renderer_failed`
- **AND** discloses no renderer stderr

#### Scenario: Brief and plan text never reach the caller

- **WHEN** a renderer failure occurs whose stderr contains brief or plan body text
- **THEN** the returned error contains no substring of that body text
