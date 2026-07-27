# xagent-sdd-workflow Specification

## Purpose

Defines the opinionated xagent MCP facade for Superpowers SDD: start/follow-up/await/close tools, trusted prompt rendering, SQLite session/turn ledger, report-before-return delivery, and supervision-sequence cursors.

## Requirements

### Requirement: xsdd-1 — MCP: opinionated SDD tool surface

WHEN the xagent service exposes its MCP endpoint, THE service SHALL provide `xagent_sdd_start`, `xagent_sdd_followup`, `xagent_sdd_await`, and `xagent_sdd_close` as the supported facade for Superpowers SDD agent turns while retaining the generic xagent tools for non-SDD delegation.

#### Scenario: Controller discovers the SDD facade

- **WHEN** an MCP client initializes against the xagent service
- **THEN** it discovers all four xagent SDD tools
- **AND** each tool publishes a strict structured input schema

#### Scenario: Generic delegation remains available

- **WHEN** a controller delegates work outside a Superpowers SDD task loop
- **THEN** the existing generic xagent start, message, await, inspect, interrupt, and close tools remain available

### Requirement: xsdd-2 — Start: structured assignment and role prompt

WHEN `xagent_sdd_start` receives an absolute existing `cwd`, a plan file, a supported role, a non-empty brief file, task identity where required, a non-empty agent/model, an existing xagent harness, an effort in `low`, `medium`, `high`, or `xhigh`, and role-specific dispatch arguments, THE service SHALL execute `<service repoRoot>/projects/agents/utils/dispatch-prompt` with Python 3 and the canonical `cwd` as its working directory, preserve the renderer's template resolution and validation, start one supervised persistent session, and return its xagent run ID as `agent_id`, the pre-turn supervision `sequence`, and resolved prompt, brief, and report paths when the role requires a report.

#### Scenario: Implementer starts from a brief

- **WHEN** a controller starts an `implementer` with an existing non-empty brief file and valid assignment fields
- **THEN** the worker receives the rendered implementer prompt pointing at that brief path
- **AND** the controller does not need to submit raw prompt prose
- **AND** the result includes the stable `agent_id`, pre-turn sequence, prompt path, brief path, and report path

#### Scenario: Task reviewer starts with review inputs

- **WHEN** a controller starts a `task-reviewer` with a brief, implementer report, constraints, base/head range, and diff
- **THEN** the rendered reviewer prompt includes every required upstream template value
- **AND** prompt-template drift or a missing required input fails before a worker is dispatched

#### Scenario: Whole-branch reviewer has no task number

- **WHEN** a controller starts a `code-reviewer` for a complete SDD branch
- **THEN** the plan and assignment are recorded
- **AND** the task number may be absent
- **AND** the supplied review-brief file contents are inlined as the upstream template's review requirements
- **AND** the ledger retains the review-brief path and exact copy

#### Scenario: Caller worktree cannot select executable code

- **WHEN** the caller's `cwd` contains a different or malicious `projects/agents/utils/dispatch-prompt`
- **THEN** the service executes only the renderer under its own trusted `repoRoot`
- **AND** uses the caller's canonical `cwd` only as the renderer process working directory

#### Scenario: Assignment input is invalid

- **WHEN** the harness or effort is outside the supported enums, or the agent/model is empty
- **THEN** the service rejects the request before creating a session or provider process

### Requirement: xsdd-3 — Follow-up: same-session fix and re-review

WHEN `xagent_sdd_followup` receives a valid SDD `agent_id`, follow-up kind, round, and required new artifacts, THE service SHALL format the prescribed fix or re-review message and submit it to the same persistent provider session without requiring the controller to restate stored plan, assignment, brief, or report-path metadata.

#### Scenario: Fix resumes the implementer

- **WHEN** an implementer session is ready and the controller submits a `fix` follow-up with verbatim findings and covering-test guidance
- **THEN** xagent sends the formatted fix message to that implementer's existing session
- **AND** the message identifies the stored brief and report paths
- **AND** names the covering tests, limits work to open findings, requires those tests to be rerun, requires a fix report to be appended to the existing report file, and requires the short Superpowers status return
- **AND** no new agent ID is created

#### Scenario: Re-review resumes the reviewer

- **WHEN** a task-reviewer session is ready and the controller submits a `re-review` follow-up with a round, findings, base/head range, and scoped diff
- **THEN** xagent renders the upstream re-review prompt
- **AND** sends it to that reviewer's existing session
- **AND** no new agent ID is created

#### Scenario: Raw message cannot bypass SDD policy

- **WHEN** a caller submits generic `xagent_message` for an SDD-owned run
- **THEN** the service rejects it with a structured error naming `xagent_sdd_followup`
- **AND** no untracked provider turn starts

#### Scenario: Incompatible follow-up is rejected

- **WHEN** a caller requests a fix from a reviewer, a re-review from an implementer, a follow-up against a whole-branch `code-reviewer`, or a follow-up while another SDD turn is unresolved
- **THEN** the service rejects the request before submitting provider input

### Requirement: xsdd-4 — Ledger: session and turn schema

WHEN the first SDD dispatch is accepted, THE xagent service SHALL create or open `<service logRoot>/sdd.sqlite` with normalized session and turn records that retain plan name derived from the plan basename, plan path, canonical working directory, task number, agent/model, harness, effort, role, agent ID, turn kind and round, copied brief, copied findings when present, report path, sanitized assistant report delivered through xagent, pre-turn resume and completed supervision sequences, constrained status, and timestamps.

#### Scenario: Initial dispatch creates session and turn

- **WHEN** `xagent_sdd_start` succeeds
- **THEN** the database contains one session keyed by `agent_id`
- **AND** contains an initial turn linked to that session
- **AND** a joined dispatch-log query exposes all required working-directory, assignment, brief, cursor, and report columns

#### Scenario: Follow-up appends history

- **WHEN** an existing SDD session receives successive fix or re-review turns
- **THEN** each turn has a monotonically increasing per-session turn number
- **AND** prior brief, findings, and report records are not overwritten

#### Scenario: Database is local operational state

- **WHEN** the service creates the SDD database and its parent path
- **THEN** they are owner-accessible only
- **AND** the database remains under the xagent service's configured log root rather than an active worktree's tracked files

#### Scenario: Schema version is managed

- **WHEN** the service opens a new SDD database
- **THEN** it creates the version-1 schema and records `PRAGMA user_version = 1`
- **AND** opening a newer unknown schema version fails without modifying that database

#### Scenario: Turn status is constrained

- **WHEN** an SDD turn is inserted or updated
- **THEN** its status is one of `prepared`, `running`, `completed`, `failed`, or `abandoned`

#### Scenario: Report definition is unambiguous

- **WHEN** an implementer turn completes after writing or appending its Superpowers report artifact
- **THEN** the ledger stores the sanitized final assistant report delivered through xagent for that turn
- **AND** stores the mutable report artifact path without copying that file's contents

### Requirement: xsdd-5 — Ledger timing: record before dispatch and delivery

WHEN an SDD turn crosses a provider or controller boundary, THE service SHALL preallocate its agent ID and persist a `prepared` ledger turn before creating or messaging a provider, persist `running` with the pre-turn resume sequence after submission, and commit the successful report and completion sequence before returning that report to the controller.

#### Scenario: Start is reserved before provider creation

- **WHEN** the initial session and prepared-turn transaction cannot commit
- **THEN** xagent does not create a provider run
- **AND** returns a structured persistence error

#### Scenario: Provider start fails after reservation

- **WHEN** provider creation, start, or initial submission fails after the prepared turn commits
- **THEN** xagent marks that turn failed and closes any created run
- **AND** does not return its agent ID as usable

#### Scenario: Follow-up submission fails

- **WHEN** a prepared follow-up cannot be submitted to the provider session
- **THEN** its turn remains recorded with failed status
- **AND** the service does not report that turn as running

#### Scenario: Report is recorded before return

- **WHEN** an SDD await observes a successful turn completion with `report.text`
- **THEN** the service commits that exact sanitized report, completion sequence, and completion timestamp to the matching turn
- **AND** only then returns the report to the controller

#### Scenario: Report commit fails

- **WHEN** the report transaction fails
- **THEN** the service returns a structured persistence error without advancing the caller's cursor
- **AND** retrying from the same cursor can observe and record the same durable completion

#### Scenario: Generic await preserves the ledger invariant

- **WHEN** generic `xagent_await` is called for an SDD-owned run and observes a successful turn completion
- **THEN** it commits the same report and completion transition before returning

#### Scenario: Generic close preserves the ledger invariant

- **WHEN** generic `xagent_close` is called for an SDD-owned run
- **THEN** it records session closure only after the provider session closes

#### Scenario: Restart reconciliation abandons an unresolved turn

- **WHEN** service startup reconciliation leaves an SDD run abandoned, failed, or cancelled without a report
- **THEN** the matching `prepared` or `running` turn becomes `abandoned`
- **AND** later await returns the terminal supervision result
- **AND** follow-up remains prohibited for that terminal session

#### Scenario: Restart reconciliation preserves completed-phase turns

- **WHEN** service startup reconciliation leaves an SDD run at phase `completed` while a ledger turn is still `running` or `prepared`
- **THEN** the turn remains open so a later await can persist the delivered report
- **AND** the turn is not marked `abandoned`

### Requirement: xsdd-6 — Cursor: supervision sequence only

WHEN the SDD ledger records a dispatch or completion position, THE service SHALL store the pre-turn xagent supervision sequence as `resume_sequence`, store the report event as `completed_sequence`, and SHALL NOT synthesize or expose a provider JSONL byte offset, line number, or file position.

#### Scenario: Initial and completion cursors are queryable

- **WHEN** an SDD turn starts and later completes
- **THEN** its ledger row records the cursor snapshot taken immediately before turn submission as `resume_sequence`
- **AND** records the completion supervision sequence
- **AND** awaiting after `resume_sequence` observes that turn's completion

#### Scenario: Provider logs have no public position

- **WHEN** provider JSONL files exist for an xagent run
- **THEN** the SDD MCP result and ledger do not claim a JSONL position
- **AND** session resumption continues to use `agent_id` plus the supervision sequence cursor

### Requirement: xsdd-7 — Prompt data: exact files without controller copies

WHEN the SDD facade accepts a brief or findings file, THE service SHALL validate that it exists and is non-empty, preserve its exact contents in the owner-only ledger, pass the required file path or verbatim findings through the role formatter, and SHALL NOT include copied brief or findings text in MCP results, normalized supervision logs, or service stdout/stderr.

#### Scenario: Missing brief fails before dispatch

- **WHEN** the supplied brief is absent, empty, or not a file
- **THEN** the SDD start fails before creating a provider run
- **AND** the error identifies the invalid input

#### Scenario: Controller submits paths instead of prose

- **WHEN** a controller starts or follows up an SDD agent with valid artifact paths
- **THEN** xagent reads and formats those artifacts itself
- **AND** the controller does not re-emit their contents in its own dispatch message

### Requirement: xsdd-8 — Await and close: supervision-compatible bounds

WHEN a controller calls `xagent_sdd_await` or `xagent_sdd_close`, THE service SHALL use `agent_id` to address the underlying xagent run, SHALL require `after_sequence` for await, SHALL apply the generic await default and maximum deadline bounds, and SHALL preserve generic cancellation and provider-close semantics.

#### Scenario: SDD await uses the generic deadline contract

- **WHEN** a controller omits `deadline_seconds`
- **THEN** `xagent_sdd_await` defaults it to 7000 seconds
- **AND** rejects a value above 7000 before registering a waiter

#### Scenario: SDD await cancellation is request-local

- **WHEN** the controller cancels an active SDD await
- **THEN** the await request ends
- **AND** the SDD run and unresolved ledger turn remain service-owned

#### Scenario: SDD close updates after provider close

- **WHEN** `xagent_sdd_close` is called with an existing SDD `agent_id`
- **THEN** xagent closes the underlying provider session
- **AND** records the session close timestamp only after provider close resolves
