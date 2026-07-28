## MODIFIED Requirements

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

### Requirement: xsvc-5 — MCP: long blocking request bounds

WHEN serving `xagent_await`, THE xagent service SHALL support a 7200-second HTTP/MCP request lifetime, default the application await deadline to 7000 seconds, reject larger deadlines, and release request-local resources when the caller cancels without cancelling the supervised run; `xagent_await` SHALL be the only await tool and SHALL serve SDD-owned and generic runs identically.

#### Scenario: Ninety-minute healthy run

- **WHEN** a controller starts one await with the default deadline and the worker remains healthy for 90 minutes before completing
- **THEN** the same await remains pending through routine progress
- **AND** returns the completion event without an intermediate deadline wake

#### Scenario: Maximum deadline exceeded

- **WHEN** a controller requests an await deadline above 7000 seconds
- **THEN** the service rejects the request before registering a waiter

#### Scenario: Request reaches deadline

- **WHEN** no deliverable event exists by the accepted await deadline
- **THEN** the service returns one compact deadline result with the current cursor
- **AND** leaves the supervised run active

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

## ADDED Requirements

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

WHEN `xagent_sdd_start` is called, THE xagent service SHALL accept exactly the roles `implementer`, `reviewer`, `fixer`, and `re-reviewer` as a discriminated union over strict objects that all share the v1 assignment fields (`note?`, `cwd`, `plan`, `agent`, `harness`, `effort`, `policy?`) and additionally require: for `implementer` — `task`, `name`, `brief`, `report`, `context?` (unchanged from v1); for `reviewer` — `brief` (unifying v1 `brief` and `review_brief`), `base`, `head`, and an optional `task` that when present requires `report` and permits `constraints?`/`diff?`, and when absent requires `description` and forbids `report`/`constraints`/`diff`; for `fixer` — `task`, the original `brief`, `findings`, `findings_text`, `tests`, and `report`, with no `name`, `context`, or `round` field; for `re-reviewer` — `task`, the original review `brief`, `findings`, `report`, `base`, `head`, `diff?`, with no `round` field; `reviewer` with a `task` SHALL render the task-review template and `reviewer` without a `task` SHALL render the whole-branch review template; `fixer` SHALL render a fix template rather than encoding the fix round into an assignment name; every dispatch SHALL therefore carry a brief, read at dispatch time into `brief_text`.

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

### Requirement: xsvc-12 — SDD continuation: demoted `xagent_sdd_followup`

WHEN `xagent_sdd_followup` is called with kind `fix` or `re-review`, THE xagent service SHALL accept as input for `fix`: `agent_id`, `round`, `findings`, `findings_text`, `tests`, `report`, `note?`, and for `re-review`: `agent_id`, `round`, `findings`, `report`, `base`, `head`, `diff?`, `note?` — where `report` is a required tool input (the v2 ledger stores no report path), the brief is sourced from the target agent's own `sdd_agents` row and never from input, and `round` parameterizes only the rendered text, recorded nowhere but the resulting `turn.submitted` event; THE service SHALL render the continuation template and submit it to the same live agent without writing the ledger, returning `{ agent_id, sequence }` with no v1 `turn_number` field, validating only that an `sdd_agents` row exists (else `unknown_sdd_agent`), that the run is live in the run manager, and that the kind matches the agent's immutable start role (`fix` for `implementer` or `fixer`; `re-review` for `reviewer` or `re-reviewer`, else `sdd_followup_role_mismatch`); WHEN the run is not live, THE service SHALL return a structured `sdd_agent_not_live` error — replacing v1's `sdd_session_terminal` — whose details name the fresh-agent recovery: the role to dispatch for the same `plan_path` and `task`.

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

WHILE an `sdd_agents` row references a run directory, THE xagent service SHALL treat `<log_root>/<agent_id>/` as the durable system of record for that agent's reports and submitted prompts: THE service SHALL NOT prune, truncate, or rotate `normalized.jsonl` for ledger-referenced runs, and service documentation SHALL state that deleting a ledger-referenced run directory deletes the only copy of that agent's reports and prompts.

#### Scenario: Report recovery long after completion

- **WHEN** a controller (or a human) needs an SDD report weeks after the agent completed and the service has restarted many times
- **THEN** the report text is readable from the `turn.completed` event in that run's `normalized.jsonl`
- **AND** no ledger column was expected to hold it

#### Scenario: Cleanup tooling is constrained

- **WHEN** log-root cleanup or garbage collection considers a run directory whose `agent_id` appears in `sdd_agents`
- **THEN** the documented policy forbids silent deletion
- **AND** any future archival step must preserve the `turn.submitted` and `turn.completed` events before removal
