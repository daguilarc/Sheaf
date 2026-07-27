# xagent-supervision Specification

## Purpose

Defines the event-driven supervisor that owns a supervised xagent run: lifecycle
phase, deterministic mechanical health classification, bounded semantic evidence
collection, isolated Haiku watchdog classification, advisory attention delivery,
cursor-based event await, owned-process recovery and stale-run reconciliation, and
sanitized supervision telemetry. The supervisor is service-owned and never
autonomously acts on the worker; remediation is left to the controller.

## Requirements

### Requirement: xas-1 — Lifecycle: supervised run state

WHEN xagent starts a supervised run, THE xagent supervisor SHALL assign a stable run identifier, track the lifecycle phase as `starting`, `running`, `ready`, `completed`, `failed`, `cancelled`, or `abandoned`, maintain attention as an orthogonal durable event queue, and append each externally visible transition or attention event as a sequenced `supervision.*` event.

#### Scenario: Supervised run starts

- **WHEN** a controller starts a supervised run with a valid harness and prompt
- **THEN** xagent returns a stable `run_id`
- **AND** persists `starting` followed by `running` state
- **AND** assigns monotonically increasing event sequences

#### Scenario: Provider becomes ready for follow-up

- **WHEN** the active provider turn completes while its persistent session remains open
- **THEN** the supervisor enters `ready`
- **AND** retains the provider thread identity for a later controller message

#### Scenario: Attention preserves active lifecycle phase

- **WHEN** attention occurs while a worker is running or ready
- **THEN** the attention event records the current lifecycle phase
- **AND** the underlying lifecycle phase remains `running` or `ready`

#### Scenario: Terminal state is durable

- **WHEN** a supervised run reaches `completed`, `failed`, `cancelled`, or `abandoned`
- **THEN** subsequent inspection reports that same terminal state
- **AND** the supervisor does not report the run as healthy or active

### Requirement: xas-2 — Health: deterministic mechanical classification

WHEN a supervised worker stops producing output, exits, completes, fails, requests exposed input or permission, loses its transport, reaches a deadline, or is cancelled, THE xagent supervisor SHALL classify and report that state from process and provider events without invoking a semantic watchdog model.

#### Scenario: Child process crashes

- **WHEN** the owned child process exits unexpectedly
- **THEN** the supervisor records deterministic failure with the exit status or signal
- **AND** no Haiku watchdog invocation occurs

#### Scenario: Provider turn completes

- **WHEN** the provider emits a successful turn-completion event
- **THEN** the supervisor records the final result
- **AND** transitions a persistent session to `ready` or a configured one-shot run to `completed`
- **AND** wakes the controller with the turn-completion event
- **AND** no Haiku watchdog invocation occurs for that transition

#### Scenario: Live process becomes silent

- **WHEN** the child process remains alive but emits no bytes or provider events for the configured silence timeout
- **THEN** the supervisor emits deterministic `attention` with a silence reason
- **AND** does not ask Haiku to determine whether the process is alive

#### Scenario: Provider requests controller input

- **WHEN** an adapter exposes a permission or input-required provider event
- **THEN** the supervisor emits deterministic `attention` containing that normalized reason
- **AND** does not invoke Haiku

### Requirement: xas-3 — Evidence: bounded semantic progress window

WHILE a supervised worker remains alive and continues producing tokens, messages, or tool activity, THE xagent supervisor SHALL maintain a sanitized bounded semantic evidence window containing the original task context subject to an input limit, recent normalized progress, repeated tool/error fingerprints, elapsed time, and the prior watchdog verdict.

#### Scenario: Active progress updates evidence

- **WHEN** the provider emits assistant text or normalized tool lifecycle events
- **THEN** the supervisor updates transport liveness
- **AND** adds bounded sanitized evidence to the semantic window

#### Scenario: Evidence exceeds configured bound

- **WHEN** retained task or progress evidence exceeds the configured watchdog input limit
- **THEN** the supervisor deterministically truncates older or lower-priority evidence
- **AND** records that truncation in the watchdog request metadata

#### Scenario: Secret-looking evidence is present

- **WHEN** provider evidence contains a secret-looking value or an absolute path under the active repository
- **THEN** the watchdog input uses xagent's redacted and relativized representation
- **AND** the unsanitized value is not passed to Haiku

### Requirement: xas-4 — Watchdog: isolated Haiku classification

WHEN semantic classification is eligible, THE xagent supervisor SHALL invoke a fresh Haiku classifier with tools, repository access, MCP servers, and session persistence disabled; SHALL require schema-valid bounded output; and SHALL expose no mechanism for the classifier to perform controller or worker actions.

#### Scenario: Watchdog has no tools

- **WHEN** xagent launches the Haiku watchdog
- **THEN** the invocation has an empty allowed-tool set
- **AND** cannot read files, execute commands, call MCP tools, or message the worker

#### Scenario: Watchdog uses structured output

- **WHEN** Haiku returns a valid classification
- **THEN** xagent parses `verdict`, `confidence`, `reason_code`, and bounded factual `evidence`
- **AND** rejects fields that attempt to encode executable controller actions

#### Scenario: Watchdog output is invalid

- **WHEN** Haiku exits non-zero, exceeds its budget, or returns output that fails the required schema
- **THEN** the supervisor normalizes the result to `uncertain`
- **AND** records the classifier failure without silently treating the worker as healthy

### Requirement: xas-5 — Watchdog: semantic-only eligibility

IF a worker is mechanically failed, complete, blocked, silent, cancelled, or past its hard deadline, THE xagent supervisor SHALL NOT invoke Haiku; WHILE the worker is alive and actively producing semantic evidence, THE supervisor SHALL invoke Haiku only when a configured periodic checkpoint or deterministic semantic-suspicion signal becomes eligible.

#### Scenario: No tokens are arriving

- **WHEN** a live worker has produced no output through the silence timeout
- **THEN** deterministic silence handling runs
- **AND** Haiku is not invoked

#### Scenario: Active checkpoint is reached

- **WHEN** a live worker continues producing progress through the next configured semantic checkpoint
- **THEN** the supervisor invokes one Haiku classification using the current bounded window

#### Scenario: Repeated activity triggers early assessment

- **WHEN** the supervisor observes configured repetition such as identical tool fingerprints or repeated error/retry cycles
- **AND** the minimum semantic-check interval has elapsed
- **THEN** the supervisor invokes Haiku before the next periodic checkpoint
- **AND** the deterministic repetition signal alone does not declare the worker derailed

### Requirement: xas-6 — Watchdog: bounded cadence and budget

WHILE semantic watchdog checks remain enabled for a run, THE xagent supervisor SHALL schedule them with configurable exponential backoff, enforce a default five-minute minimum interval, cap watchdog input at 64 KiB and the classifier verdict output at 2 KiB (applied to the normalized structured output, not the surrounding Claude Code JSON envelope), bound evidence to a count and per-item character length enforced by the JSON Schema and additionally truncate each evidence item to a per-item UTF-8 byte bound so a maximal schema-valid verdict fits within the 2 KiB output cap regardless of encoding, and stop invoking the watchdog after the default maximum of eight calls per run.

#### Scenario: Default cadence backs off

- **WHEN** an active worker receives successive healthy periodic verdicts
- **THEN** default periodic eligibility advances from 10 minutes to 20 minutes and then to intervals no shorter than 40 minutes

#### Scenario: Default suspicion thresholds

- **WHEN** a rolling ten-minute evidence window contains three identical normalized tool fingerprints or two identical failure fingerprints
- **AND** five minutes have elapsed since the prior semantic check
- **THEN** one early semantic check becomes eligible

#### Scenario: New user turn resets cadence

- **WHEN** the controller submits a follow-up turn on a ready supervised session
- **THEN** the periodic watchdog schedule resets for the new turn
- **AND** previous run-level invocation usage remains counted against the hard cap

#### Scenario: Run reaches watchdog maximum

- **WHEN** the configured maximum number of watchdog invocations has been consumed
- **THEN** the supervisor performs no additional Haiku calls
- **AND** continues deterministic supervision and records that semantic coverage is exhausted

#### Scenario: Maximal schema-valid verdict is accepted

- **WHEN** Haiku returns a healthy verdict whose evidence uses the maximum permitted item count and per-item length
- **THEN** the supervisor accepts the verdict as healthy
- **AND** does not normalize it to `uncertain` with `classifier_output_too_large`
- **AND** emits no advisory attention for the bounded output alone

#### Scenario: Maximal schema-valid non-ASCII verdict is accepted

- **WHEN** Haiku returns a healthy verdict whose evidence uses the maximum permitted item count and per-item character length and the evidence is non-ASCII (e.g. CJK, which serializes to multiple UTF-8 bytes per character)
- **THEN** the supervisor truncates each evidence item to the per-item UTF-8 byte bound
- **AND** accepts the verdict as healthy
- **AND** emits no advisory attention for the bounded output alone

### Requirement: xas-7 — Attention: advisory semantic verdicts

WHEN Haiku returns `derailed` or `uncertain`, or returns `healthy` below the default `0.8` confidence floor, THE xagent supervisor SHALL emit one durable advisory `supervision.attention` event; WHEN Haiku returns `healthy` at or above the floor, THE supervisor SHALL remain silent to the controller and continue supervision.

#### Scenario: Healthy active worker stays quiet

- **WHEN** Haiku returns `healthy` at or above the configured confidence floor
- **THEN** xagent records the verdict in supervision telemetry
- **AND** emits no controller-visible progress or attention event

#### Scenario: Derailed verdict wakes controller

- **WHEN** Haiku returns `derailed`
- **THEN** xagent emits one `supervision.attention` event with the bounded verdict evidence
- **AND** leaves remediation to the controller

#### Scenario: Classifier is confused

- **WHEN** Haiku returns `uncertain` or a low-confidence healthy verdict
- **THEN** xagent emits one `supervision.attention` event explaining that semantic health could not be established

#### Scenario: Attention does not act on worker

- **WHEN** any semantic attention event is emitted
- **THEN** xagent does not automatically kill, interrupt, restart, steer, or submit a message to the worker

### Requirement: xas-8 — Await: cursor-based event delivery

WHEN a controller awaits a supervised run after an event sequence, THE xagent supervisor SHALL block without delivering routine progress until a newer completion, failure, attention, cancellation, abandonment, or caller-deadline event exists; SHALL return each durable event at most once for a correctly advanced cursor; and SHALL include the complete sanitized final assistant report directly in a successful turn-completion result.

#### Scenario: Healthy worker produces routine progress

- **WHEN** a controller awaits after the latest event sequence
- **AND** the worker emits only healthy tokens and tool progress
- **THEN** the await remains blocked
- **AND** routine provider output is neither returned to the controller nor persisted on the supervised path; the supervisor persists only lifecycle, attention, and watchdog records

#### Scenario: Completion wakes await

- **WHEN** the provider turn completes after the controller's cursor
- **THEN** the await returns a versioned result containing `turn.completed`, `run_id`, the new event sequence, lifecycle phase, elapsed time, and the complete sanitized final assistant report
- **AND** does not return prior turns, intermediate deltas, tool events, raw provider events, or watchdog evidence

#### Scenario: Completion has no final assistant report

- **WHEN** a provider reports successful turn completion without a final assistant message
- **THEN** the await returns deterministic `missing_final_report` failure
- **AND** does not require the controller to search run logs for a report

#### Scenario: Existing attention is not redelivered

- **WHEN** the controller has already received an attention event and awaits using that event's sequence
- **THEN** the same attention event is not returned again

### Requirement: xas-9 — Recovery: owned process and abandoned-run reconciliation

WHEN the xagent service shuts down orderly, THE xagent supervisor SHALL close its owned provider processes; WHEN persisted metadata claims an active run but a restarted service cannot prove ownership or safely reattach, THE supervisor SHALL reconcile the run to `abandoned` rather than reporting it as running; AND reconciliation SHALL enumerate only runs that carry the service-owned `supervised: true` marker (see xas-11) so an in-flight legacy `xagent run` session that shares the log root is never rewritten or abandoned by a service incarnation that does not own it.

#### Scenario: Orderly close cleans up child

- **WHEN** the controller closes a supervised run or the xagent service shuts down orderly
- **THEN** xagent closes the provider session
- **AND** terminates any child process group still owned by that run

#### Scenario: Service restarts with stale active metadata

- **WHEN** startup discovers metadata marked `starting`, `running`, or `ready`
- **AND** the metadata carries the service-owned `supervised: true` marker
- **AND** no live in-process supervisor can prove ownership and reattachment support
- **THEN** xagent records `abandoned`
- **AND** inspection exposes deterministic attention instead of a healthy status

#### Scenario: Service restart leaves in-flight legacy runs untouched

- **WHEN** startup discovers metadata marked `starting`, `running`, or `ready`
- **AND** the metadata does not carry the `supervised: true` marker (a legacy `xagent run` interactive session)
- **THEN** xagent reconciliation skips the record
- **AND** does not rewrite its `metadata.json` to `abandoned`/`failed`
- **AND** does not append fabricated `stale_run_abandoned` events to its `normalized.jsonl`
- **AND** the legacy process retains sole ownership until its session ends

### Requirement: xas-10 — Telemetry: supervision cost and wake accounting

WHILE a supervised run executes, THE xagent supervisor SHALL persist sanitized telemetry sufficient to count controller-visible wakes, deterministic alerts, watchdog invocations, watchdog usage or cost when reported, verdicts, evidence truncation, and detection latency without duplicating unrestricted prompts.

#### Scenario: Long healthy run completes

- **WHEN** a supervised worker runs with routine progress and then completes
- **THEN** telemetry distinguishes internal progress events from controller-visible wakes
- **AND** records the number of watchdog invocations and final completion wake

#### Scenario: Watchdog attention occurs

- **WHEN** semantic attention is emitted
- **THEN** telemetry records its verdict, confidence, reason code, event sequence, and time since the triggering evidence
- **AND** does not persist secret-looking unredacted evidence

### Requirement: xas-11 — Recovery: supervised-run ownership marker

WHEN the xagent service creates a run, THE xagent supervisor SHALL persist a `supervised: true` ownership marker on the run metadata; WHEN a run is created through the legacy `xagent run` interactive runtime, THE supervisor SHALL NOT set that marker; AND WHEN startup reconciliation enumerates persisted metadata, THE supervisor SHALL skip any active-phase record that does not carry the `supervised: true` marker so in-flight legacy interactive runs that share the log root are never rewritten or abandoned by a service incarnation that does not own them.

#### Scenario: Service-owned run carries the supervised marker

- **WHEN** the xagent service creates a supervised run through `XagentRunManager.create`
- **THEN** the persisted `metadata.json` carries `supervised: true`
- **AND** startup reconciliation enumerates the record as a candidate for stale-run abandonment

#### Scenario: Legacy interactive run omits the supervised marker

- **WHEN** a legacy `xagent run --subagent|--full` session creates a run record
- **THEN** the persisted `metadata.json` omits `supervised` (or carries a non-`true` value)
- **AND** startup reconciliation skips the record even when its phase is `starting`, `running`, or `ready`
- **AND** the legacy process retains sole ownership of its metadata and `normalized.jsonl`

#### Scenario: In-flight legacy run survives service restart

- **WHEN** a legacy `xagent run` session is in flight with `supervision.phase: "starting"`
- **AND** the xagent service starts or restarts against the same log root
- **THEN** reconciliation does not rewrite the legacy run's `metadata.json` to `abandoned`/`failed`
- **AND** no fabricated `stale_run_abandoned` state or attention events are appended to the legacy run's `normalized.jsonl`
- **AND** the legacy process later advances its own metadata to a terminal value when its session ends
