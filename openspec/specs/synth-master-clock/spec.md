# Synth Master Clock Specification

## Purpose
Define the runtime-owned musical clock, transport, MIDI synchronization, scheduled output, persistence, and diagnostics contracts.

## Requirements

### Requirement: smc-1 — Ownership: runtime master clock and application API
WHEN a synth Engine is initialized, THE synth runtime SHALL own exactly one JUCE-free, address-stable `MasterClock` whose lifetime spans application initialization through audio shutdown and SHALL expose it to the application through `AppContext`; after prepare, the clock SHALL expose lifetime quarter notes, current-run transport quarter notes, transport state, quarter notes per output sample, BPM, sync configuration, and the immutable `ClockBlockPlan` committed for the current output block, including integer-or-fractional absolute output-sample queries.

#### Scenario: Application observes one stable clock
- **WHEN** an application stores `context->masterClock` during `Init` and reads it in later audio blocks
- **THEN** the pointer names the same runtime-owned object for the application lifetime
- **AND** its time values are expressed in quarter notes as doubles

#### Scenario: AudioBlock and MasterClock expose one plan
- **WHEN** an application receives an `AudioBlock` during `ProcessBlock`
- **THEN** `block.clockPlan` and `context->masterClock->CurrentPlan()` identify the same immutable plan
- **AND** that plan remains valid through the application callback

#### Scenario: Initial state is deterministic
- **WHEN** an Engine initializes and prepares its clock before processing audio
- **THEN** lifetime time and transport time are zero, transport is Stopped, tempo is 120 BPM, and the increment is `120 / (60 * sampleRate)`

### Requirement: smc-2 — Processing: committed affine output-block timeline
WHILE audio is running, THE synth runtime SHALL commit exactly one immutable `ClockBlockPlan` after draining due input and before delegating each output-device block; the plan SHALL cover the half-open absolute output-sample interval `[blockStart, blockEnd)`, contain lifetime and transport anchors plus one finite-positive quarter-notes-per-output-sample increment, compute a queried time directly as `anchor + (position - blockStart) * increment`, accept finite integer or fractional output-sample positions inside that interval, and require neither a stored per-sample clock buffer nor an application call that advances runtime time. Lifetime SHALL use the affine result in every state, transport SHALL use it only while Running and otherwise report zero, and the next plan's start anchors SHALL equal the preceding plan's mathematical values at `blockEnd` except for the specified transport reset transitions. MasterClock MAY retain a bounded history of compact committed-plan descriptors sufficient for input timestamp mapping and output lookahead but SHALL NOT retain per-sample clock values.

#### Scenario: Stopped plan advances lifetime only
- **WHEN** a stopped plan starts at lifetime value `L`, has increment `I`, and covers `N` output frames
- **THEN** its lifetime query at position `blockStart + x` is `L + x * I` for every finite `x` in `[0, N)`
- **AND** every transport query in the plan is zero

#### Scenario: Running plan advances both timelines
- **WHEN** a running plan starts at lifetime value `L` and transport value `T` with increment `I`
- **THEN** queries at position `blockStart + x` return lifetime `L + x * I` and transport `T + x * I`

#### Scenario: Consecutive plans are continuous and discrete samples increase
- **WHEN** one ordinary plan ends at output-sample boundary `E` and the next plan begins at `E`
- **THEN** the next plan's lifetime start anchor equals the prior plan's mathematical lifetime value at `E`
- **AND** its transport start anchor equals the prior mathematical transport value at `E` within the same running epoch
- **AND** because each committed increment is positive, the value at the last integer sample of the prior block is strictly lower than the value at the first integer sample of the next block

#### Scenario: Oversampled application uses a fractional output position
- **WHEN** an application processes internal sample index 6 at 4x oversampling for a block that begins at output sample `S`
- **THEN** it queries the plan at absolute output-sample position `S + 6 / 4.0`
- **AND** receives the same affine clock value independent of the application's internal oversampling implementation

#### Scenario: A committed plan does not change
- **WHEN** a tempo request or external clock observation arrives after a plan has been committed
- **THEN** every query in that plan retains its original anchors and increment
- **AND** the observation can affect only a later uncommitted plan

#### Scenario: Delayed input maps through compact plan history
- **WHEN** an input observation is drained after the block containing its normalized timestamp was rendered
- **THEN** MasterClock maps the timestamp to the matching recent affine descriptor rather than to the drain boundary
- **AND** no array of historical sample-by-sample clock values is required

### Requirement: smc-3 — Tempo: increment conversion and source authority
WHEN MasterClock is prepared or its accepted tempo changes, THE clock SHALL compute quarter notes per output sample as `BPM / (60 * sampleRate)` using the negotiated finite-positive output sample rate; WHEN receive-clock is disabled, a finite-positive application tempo request SHALL update the stored manual BPM and the increment selected for the next uncommitted plan, while WHEN receive-clock is enabled, the same request SHALL report that it was ignored and SHALL leave the externally disciplined tempo, pending increment, and estimator unchanged; no tempo change SHALL alter an already committed plan or its successor's continuity anchor.

#### Scenario: Manual tempo converts to increment
- **WHEN** an application sets 120 BPM at 48,000 Hz with receive-clock disabled
- **THEN** the active increment is `120 / (60 * 48000)` quarter notes per sample

#### Scenario: External authority rejects manual change
- **WHEN** receive-clock is enabled at an externally recovered tempo and the application requests 90 BPM
- **THEN** the request reports not accepted
- **AND** active BPM, increment, and estimator state remain unchanged

#### Scenario: Manual tempo returns after external mode
- **WHEN** receive-clock is disabled after external synchronization
- **THEN** the clock restores its last accepted manual BPM without resetting either accumulator

### Requirement: smc-4 — Transport: Start, Continue, Stop, and first-clock semantics
WHEN MasterClock handles transport, THE clock SHALL implement states Stopped, ArmedStart, ArmedContinue, and Running; accepted commands SHALL affect application-visible state in the next uncommitted plan after their block-boundary consumption; Start and Continue SHALL reset current-run transport time to zero and, under external clock authority, SHALL enter their armed state until the next accepted Timing Clock; that first Timing Clock SHALL be musical tick zero at its original normalized timestamp, SHALL make the next uncommitted plan Running without adding `1/PPQN` for the tick itself, and SHALL set that plan's transport start anchor by disciplined projection from timestamped tick zero to `blockStart`; Stop SHALL make the next uncommitted plan Stopped with current-run transport time zero.

#### Scenario: External Start waits for its first clock
- **WHEN** an accepted external Start arrives while receive-clock is enabled
- **THEN** transport becomes ArmedStart with transport time zero
- **WHEN** the next accepted external Timing Clock arrives
- **THEN** that clock is transport time zero at its original normalized timestamp rather than tick one
- **AND** the next committed plan becomes Running with the transport phase projected from that timestamp to its `blockStart`

#### Scenario: Internal Start synthesizes tick zero
- **WHEN** an internal Start arrives while receive-clock is disabled
- **THEN** the clock applies a time-zero clock at the next committed plan boundary and enters Running for that plan
- **AND** the next transport tick boundary is `1/PPQN` quarter notes later

#### Scenario: Continue retains distinct wire intent but starts a current run
- **WHEN** Continue is accepted after Stop
- **THEN** it follows the same armed-or-immediate activation rule as Start and current-run transport time begins at zero
- **AND** an enabled transport output uses MIDI Continue rather than MIDI Start

#### Scenario: Stop zeroes transport only
- **WHEN** Stop is accepted while Running
- **THEN** transport becomes Stopped and transport time becomes zero in the next committed plan
- **AND** lifetime time is not reset

### Requirement: smc-5 — Configuration: receive/send gating, PPQN, and provenance
WHEN realtime input or output is configured, THE master-clock system SHALL provide independent boolean send-clock, receive-clock, send-transport, and receive-transport settings plus integer PPQN in `1..960` defaulting to 24; external Timing Clock SHALL affect the clock only when receive-clock is enabled, external transport SHALL affect it only when receive-transport is enabled, internal transport SHALL remain effective regardless of receive-transport, and send settings SHALL control only corresponding output bytes rather than local state changes.

#### Scenario: Disabled external input is inert
- **WHEN** external Timing Clock and Start messages arrive with both receive settings disabled
- **THEN** tempo, phase, and transport state are unchanged

#### Scenario: Internal transport bypasses receive gating
- **WHEN** receive-transport is disabled and the UI sends an Internal Start
- **THEN** local transport starts according to the active clock-source rule

#### Scenario: Clock and transport output are independent
- **WHEN** send-clock is disabled and send-transport is enabled
- **THEN** accepted transport changes emit enabled transport bytes
- **AND** no Timing Clock bytes are emitted

#### Scenario: PPQN change is phase-safe
- **WHEN** PPQN changes while clock output is enabled
- **THEN** input interval history and source lock are cleared, the output detector is primed on its current time source, and the setting change itself emits no tick

### Requirement: smc-6 — Input: source locking and timestamp-domain acquisition
WHEN receive-clock is enabled and realtime bytes can arrive from multiple controller slots, THE master-clock system SHALL represent every normalized input timestamp as unsigned integer microseconds in the same host-local monotonic epoch used by Engine, lock to the first valid source slot, ignore clocks and transport from other slots while that source is healthy, and release the source after no accepted source clock for the larger of 500 milliseconds or four estimated pulse periods; the source timeout SHALL NOT stop transport, reset time, or discard the last tempo estimate. Realtime clock/transport messages drained from both input buses in one block SHALL be applied in ascending normalized timestamp order, with equal timestamps ordered by Internal before ExternalMidi and then ascending controller slot.

#### Scenario: Two clock streams do not merge
- **WHEN** source slot 0 is locked and source slot 1 also sends Timing Clock
- **THEN** slot 1 clocks do not advance input tick count or alter recovered tempo

#### Scenario: Timed-out source can be replaced
- **WHEN** the active source is silent beyond its timeout and another slot sends a valid clock
- **THEN** the stale lock is released and the new slot can acquire clock authority
- **AND** accumulator values remain continuous

#### Scenario: Drain delay does not become clock interval
- **WHEN** two input callbacks carry timestamps one pulse period apart but are consumed in the same later audio block
- **THEN** tempo recovery uses their callback timestamps rather than their common block-consumption time

#### Scenario: Bus drain order does not override event time
- **WHEN** internal and external transport messages with different normalized timestamps are drained from separate buses in the same block
- **THEN** MasterClock applies them in timestamp order rather than UI-bus-then-MIDI-bus order

### Requirement: smc-7 — Recovery: stable tempo, missed pulses, outliers, and dropout
WHILE an external source is active, THE master-clock system SHALL derive pulse period from positive accepted original-timestamp intervals, normalize intervals representing up to eight missed pulses when their divided period is within 25 percent of the estimate, reject implausibly early duplicates, filter normalized intervals through a five-value median and `1/8` EWMA, compute BPM as `60 / (PPQN * periodSeconds)`, map each observation timestamp to fractional output-sample position, and apply bounded phase error as a finite-positive slope correction only to future uncommitted plans; a phase error beyond two pulse periods or a source reacquisition SHALL re-seed the estimator's target phase without changing the continuous next-plan anchor, and clock loss SHALL free-run at the last valid estimate.

#### Scenario: Steady 24 PPQN recovers tempo
- **WHEN** an active source supplies clocks every `60 / (120 * 24)` seconds
- **THEN** acquisition reaches Locked and, after 64 valid intervals, recovered tempo is within `0.1 BPM` of 120 BPM

#### Scenario: Jitter is smoothed
- **WHEN** clock intervals alternate slightly early and late around one stable mean
- **THEN** the outgoing disciplined period follows the filtered mean rather than copying each raw interval

#### Scenario: Missed callback preserves tempo
- **WHEN** one observed delta is approximately three times the current period
- **THEN** the receiver accounts for three elapsed pulses and feeds the estimator the delta divided by three

#### Scenario: Dropout free-runs
- **WHEN** accepted input clocks cease after lock
- **THEN** both active accumulators continue with the last valid increment
- **AND** enabled outgoing clock continues rather than waiting for a new input byte

#### Scenario: Phase correction preserves committed continuity
- **WHEN** an accepted input clock says the disciplined phase is early or late relative to its original timestamp
- **THEN** the current plan remains unchanged and a bounded speed-up or slow-down can affect the next plan's positive increment
- **AND** the next lifetime anchor remains exactly the prior plan's mathematical end value

### Requirement: smc-8 — Output phase: continuous stopped clock and transport switching
WHILE send-clock is enabled, THE master-clock system SHALL analytically enumerate every candidate configured-PPQN boundary crossed by each half-open committed plan or timestamped output-only transition splice, feed those candidates in order through its owned `Phasor2Tick` as the authoritative priming and last-emitted-cell guard, enqueue only candidates for which `tick` is true, and derive candidates from lifetime time while Stopped or Armed and transport time while Running; it SHALL NOT process the detector once per audio sample. An accepted Start or Continue SHALL schedule the enabled transport byte at its command deadline; activation on time-zero SHALL invalidate old-grid looked-ahead ticks only at or after the activation cutoff, emit one explicit time-zero Timing Clock when send-clock is enabled, prime detection at transport zero, and next emit at `1/PPQN`. Stop SHALL invalidate old-grid looked-ahead ticks only at or after the Stop cutoff, emit enabled Stop, switch to and prime lifetime time without an immediate extra clock, and resume at the next lifetime tick boundary. A crossing exactly at a plan or splice end SHALL belong only to the following segment.

#### Scenario: Clock continues before transport
- **WHEN** send-clock is enabled while transport remains Stopped
- **THEN** Timing Clock is emitted at each lifetime `1/PPQN` boundary

#### Scenario: Internal Start has one downbeat clock
- **WHEN** an internal Start activates transport with send-clock and send-transport enabled
- **THEN** MIDI Start precedes exactly one Timing Clock at the same due time
- **AND** no second clock is produced at transport time zero

#### Scenario: External Start preserves command-to-clock spacing
- **WHEN** accepted external Start is followed by its activating Timing Clock at a later normalized timestamp
- **THEN** regenerated Start and the time-zero clock retain that separation after the same fixed latency is added to both

#### Scenario: Stop does not duplicate a pulse
- **WHEN** Stop switches output from transport time to lifetime time
- **THEN** the switch itself emits no Timing Clock
- **AND** stopped output resumes at the next lifetime boundary

#### Scenario: Delayed transition uses an output-only splice
- **WHEN** an accepted external activation or Stop timestamp lies inside an already rendered committed plan but remains schedulable after fixed latency
- **THEN** the app-visible plan is unchanged
- **AND** output invalidation and new-grid crossings use an affine splice beginning at the original event timestamp

#### Scenario: Send and receive regenerates phase
- **WHEN** send-clock and receive-clock are both enabled
- **THEN** output ticks are generated from the disciplined internal phase
- **AND** incoming bytes are not directly echoed with their arrival jitter

### Requirement: smc-9 — Output timing: fixed lookahead and ordered scheduled delivery
WHEN MasterClock is prepared for output, THE runtime SHALL maintain an `AudioSampleTimeMapper` whose segments map absolute output-sample position to unsigned integer microseconds in the shared host-local monotonic epoch, start with nominal slope `1,000,000 / sampleRate`, use each block callback timestamp only as a noisy phase observation filtered by a five-error median and `1/32` EWMA, apply correction only through future finite-positive segment slopes capped at `±500 ppm`, and preserve exact mathematical endpoint continuity during ordinary processing; a host timestamp discontinuity larger than output lookahead SHALL clear mapper phase history, invalidate affected future events, begin a new generation at `max(observedTimestamp, priorMathematicalEnd)`, and increment late-event diagnostics. THE runtime SHALL set fixed output latency to at least `max(2 * negotiatedBlockDuration, 5 milliseconds)`, solve each plan crossing at its fractional output-sample position, convert that position through this mapper, and assign an absolute due timestamp equal to that ideal time plus the fixed latency. Accepted external transport and its activating time-zero clock SHALL use their original normalized timestamps plus the same latency, while internal transport SHALL use its effective plan-boundary time plus that latency. Events SHALL pass through a fixed-capacity audio-to-sender realtime lane without audio-thread locks or allocation and through timestamp-capable host output APIs; raw callback timestamps, block-drain times, browser polling, and worker wake time SHALL NOT replace event deadlines, equal-time transport SHALL be ordered before its time-zero clock, an invalidated phase generation SHALL be dropped only for due times at or after its transition cutoff, and queue overflow SHALL drop rather than block while incrementing an observable diagnostic counter. Deadline conversion error SHALL be at most `1 µs`; deterministic inter-tick spacing error SHALL be at most `2 µs` plus the mapper's bounded `500 ppm` slew contribution; and regenerated send+receive fixed-offset error SHALL be at most `1 µs`, all measured on computed deadlines before host delivery.

#### Scenario: Audio block timing does not quantize output
- **WHEN** multiple clock boundaries fall at different fractional output-sample positions inside one audio block
- **THEN** their output due timestamps retain those distinct analytically derived offsets rather than sharing or rounding to the block callback time

#### Scenario: Callback jitter is filtered and slew bounded
- **WHEN** block callback timestamps contain early and late scheduling jitter around a stable sample timeline
- **THEN** the mapper preserves continuous segment endpoints and filters phase error through its five-error median and `1/32` EWMA
- **AND** no future segment slope differs from nominal by more than `500 ppm`

#### Scenario: Host suspension starts a new mapping generation
- **WHEN** a callback observation differs from the predicted sample time by more than output lookahead
- **THEN** pending affected deadlines are invalidated, mapper phase history resets, and the new generation starts no earlier than both the observation and the prior mathematical end
- **AND** the discontinuity is reflected in late-event diagnostics rather than hidden as ordinary callback jitter

#### Scenario: Deterministic deadline tolerances are measurable
- **WHEN** exact fractional crossings and exact normalized input timestamps are exercised in a deterministic test
- **THEN** crossing-to-deadline error is at most `1 µs`, spacing error is at most `2 µs` plus bounded mapper slew, and fixed-offset regeneration error is at most `1 µs`
- **AND** host/device delivery lateness is measured separately rather than attributed to deadline computation

#### Scenario: Half-open blocks emit a boundary once
- **WHEN** a clock crossing falls exactly at one plan's `blockEnd`
- **THEN** that plan does not enqueue it and the next plan enqueues it at its `blockStart`

#### Scenario: Lookahead absorbs input handoff
- **WHEN** an external clock arrives just after an audio block begins and is consumed at the next block boundary
- **THEN** its corresponding disciplined output remains scheduled at the fixed delayed phase without adding a variable extra block of output delay

#### Scenario: Rephase cancels stale future events
- **WHEN** Start, Continue, or Stop changes the selected phase at cutoff time `C` after old-grid ticks were queued
- **THEN** the sender retains old-generation ticks due before `C`
- **AND** discards old-generation ticks due at or after `C`

#### Scenario: External timestamps produce a fixed offset
- **WHEN** accepted external transport and Timing Clock are drained later than their normalized input timestamps
- **THEN** their regenerated wire deadlines remain their original timestamps plus the fixed output latency
- **AND** do not gain a variable block-drain or sender-wakeup offset

#### Scenario: Late input is visible rather than retimed
- **WHEN** an accepted event is consumed after its fixed-latency deadline can be met
- **THEN** it is submitted as soon as possible and increments the late-event diagnostic
- **AND** its phase origin is not silently replaced with the block-drain time

#### Scenario: Offline outputs do not stall broadcast
- **WHEN** one controller output is offline and another is connected
- **THEN** scheduled clock reaches the connected sink and the offline sink is skipped without blocking

### Requirement: smc-10 — Persistence: sync policy is runtime configuration
WHEN runtime configuration is saved, THE synth runtime SHALL serialize a `sync` object containing the four booleans and PPQN, SHALL load valid values before MIDI processors and audio start, SHALL load schema-v1 runtime documents with default sync values and write schema v2 thereafter, and SHALL reject invalid sync values without partially mutating MIDI instrument, audio device, or sync state; patch documents SHALL NOT contain sync policy.

#### Scenario: Existing configuration migrates with safe defaults
- **WHEN** a valid schema-v1 runtime configuration has no sync object
- **THEN** it loads with all send/receive flags false and PPQN 24

#### Scenario: Sync round-trips independently of patches
- **WHEN** non-default sync settings are saved and reloaded
- **THEN** every setting round-trips through runtime configuration
- **AND** saved patch JSON contains no sync object

#### Scenario: Invalid PPQN rejects atomically
- **WHEN** runtime configuration contains PPQN zero or greater than 960
- **THEN** loading reports invalid and no live runtime configuration field changes

### Requirement: smc-11 — Diagnostics: acquisition and timing visibility
WHILE clock synchronization is active, THE master-clock system SHALL publish lock state (`Internal`, `Acquiring`, `Locked`, or `FreeRun`), active external source when any, current BPM, derived output latency, ignored-input count, late-event count, and dropped-output count through lock-free coherent UI state suitable for the runtime Sync page.

#### Scenario: Sync page can explain free-run
- **WHEN** a previously locked external source times out while receive-clock remains enabled
- **THEN** diagnostics report FreeRun, retain the last BPM, and no longer report a healthy locked source

#### Scenario: Realtime diagnostics are non-blocking
- **WHEN** the audio and sender threads update counters while the UI reads them
- **THEN** updates and reads require no audio-thread allocation or mutex acquisition
