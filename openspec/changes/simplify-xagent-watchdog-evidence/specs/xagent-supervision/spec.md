## MODIFIED Requirements

### Requirement: xas-3 — Evidence: bounded semantic progress window

WHILE a supervised worker remains alive and emits provider JSON, THE xagent supervisor SHALL maintain a bounded watchdog request with fields `original_prompt`, `harness`, `recent_provider_json`, `elapsed_ms`, `truncated`, and `input_bytes`, containing recent `raw.provider` payloads with only strings longer than 16 KiB UTF-8 and the total 64 KiB request truncated to configured bounds.

#### Scenario: Provider JSON updates evidence

- **WHEN** the provider emits a JSON record during an active turn
- **THEN** the supervisor updates transport liveness
- **AND** retains that provider JSON record for the watchdog without semantic normalization, fingerprinting, redaction, or path rewriting
- **AND** does not change the health monitor's existing semantic activity classification or exposed-wait deduplication

#### Scenario: A provider field exceeds its bound

- **WHEN** a string field in a provider JSON record exceeds 16 KiB UTF-8
- **THEN** the supervisor truncates the field with the marker `[xagent: truncated]`
- **AND** preserves the surrounding JSON field names, values, and nesting

#### Scenario: Evidence exceeds the total input bound

- **WHEN** retained task context and provider JSON exceed the configured watchdog input limit
- **THEN** the supervisor retains the newest complete bounded records that fit
- **AND** sets `truncated` in the watchdog request
- **AND** reports the exact serialized request size in `input_bytes`

#### Scenario: One provider record still exceeds the total bound

- **WHEN** a provider JSON record exceeds the total watchdog input limit after recursive string truncation
- **THEN** the supervisor omits that record as a whole rather than summarizing or structurally rewriting it
- **AND** sets `truncated`
- **AND** retains other newest complete records that fit

#### Scenario: Provider JSON contains sensitive content

- **WHEN** provider JSON contains a secret-looking value or absolute repository path
- **THEN** the watchdog input retains that value subject only to the same string and total-input bounds
- **AND** the supervisor does not persist the watchdog input in supervision telemetry

#### Scenario: Task context contains sensitive content

- **WHEN** the task prompt contains a secret-looking value or absolute repository path
- **THEN** the watchdog input retains that value subject only to the same string and total-input bounds
- **AND** the supervisor does not persist the watchdog input in supervision telemetry

### Requirement: xas-5 — Watchdog: semantic-only eligibility

IF a worker is mechanically failed, complete, blocked, silent, cancelled, or past its hard deadline, THE xagent supervisor SHALL NOT invoke Haiku; WHILE the worker remains alive and provider JSON continues flowing, THE supervisor SHALL invoke Haiku only at configured periodic active-work checkpoints.

#### Scenario: No provider output is arriving

- **WHEN** a live worker produces no bytes or provider events through the silence timeout
- **THEN** deterministic silence handling runs
- **AND** Haiku is not invoked

#### Scenario: Active checkpoint is reached

- **WHEN** a live worker continues emitting provider JSON through the next configured semantic checkpoint
- **THEN** the supervisor invokes one Haiku classification using the current bounded provider JSON window
- **AND** eligibility is advanced by `raw.provider` records independently of normalized semantic adapter events

#### Scenario: Tool activity repeats

- **WHEN** provider JSON contains repeated tool calls, failures, retries, or other activity
- **THEN** the supervisor does not fingerprint, count, classify, or create an early semantic checkpoint from that repetition
- **AND** Haiku evaluates the activity at the next periodic checkpoint

### Requirement: xas-6 — Watchdog: bounded cadence and budget

WHILE semantic watchdog checks remain enabled for a run, THE xagent supervisor SHALL schedule periodic active-work checks with configurable exponential backoff, enforce the existing five-minute minimum interval, cap watchdog input at 64 KiB and the classifier verdict output at 2 KiB, bound long provider JSON strings before enforcing the total input cap, bound verdict evidence to the schema item count and character length plus the existing per-item UTF-8 byte limit, and stop invoking the watchdog after the default maximum of eight calls per run.

#### Scenario: Default cadence backs off

- **WHEN** an active worker receives successive healthy periodic verdicts
- **THEN** default periodic eligibility advances from 10 minutes to 20 minutes and then to intervals no shorter than 40 minutes

#### Scenario: Repetition does not change cadence

- **WHEN** provider JSON contains repeated tool calls, failures, retries, or other semantically ambiguous activity before the next periodic checkpoint
- **THEN** the supervisor does not invoke Haiku early
- **AND** the configured periodic cadence remains authoritative

#### Scenario: Deterministic exposed wait remains deduplicated

- **WHEN** an exposed input or permission wait has emitted deterministic attention
- **AND** provider JSON continues flowing
- **THEN** the supervisor does not invoke Haiku while the exposed wait remains active
- **AND** raw provider activity alone does not re-arm duplicate deterministic wait attention

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

- **WHEN** Haiku returns a healthy verdict whose evidence uses the maximum permitted item count and per-item character length and the evidence is non-ASCII
- **THEN** the supervisor truncates each evidence item to the per-item UTF-8 byte bound
- **AND** accepts the verdict as healthy
- **AND** emits no advisory attention for the bounded output alone
