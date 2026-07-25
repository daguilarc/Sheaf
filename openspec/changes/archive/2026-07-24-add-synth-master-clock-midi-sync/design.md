## Context

The synth core already represents MIDI Timing Clock (`F8`) and transport bytes (`FA`/`FB`/`FC`) as `BasicMidi`, and `MessageIn` has Start, Stop, and Clock variants. Those messages are currently incomplete infrastructure: there is no Continue `MessageIn`, no terminal realtime processor in a controller input chain, and `MessageInBus::Apply` discards Start/Stop/Clock. Output is also immediate-only: `MidiSender` drains a mutex-protected queue on a worker and JUCE calls `sendMessageNow`; the browser polls output at roughly 16 ms and calls Web MIDI `send` without a timestamp. That path is suitable for control feedback, but not for a low-jitter master clock.

The engine owns block timing and drains UI/MIDI input on the audio thread before calling the application's block processor. Applications own their per-sample DSP loops; Braid 4 currently runs a private 4x internal loop and decimator, while MiniApp runs at output rate. MessageIn consumption is block-boundary today: callback timestamps gate which messages drain, but the runtime does not apply messages at sample offsets inside an opaque application block. The clock therefore has to preserve precise timestamp observations and sample-accurate steady-state time without moving application DSP into the runtime or pretending block-boundary message application is already sample-interleaved.

MIDI 1.0 Timing Clock is 24 pulses per quarter note by default. Start and Continue prepare a receiver, and sequencing begins on the next Timing Clock; that first clock is musical tick zero. Clock normally continues while stopped so a receiver can estimate tempo before transport starts. The requested configurable PPQN is retained, but values other than 24 are an explicit non-standard peer agreement because an `F8` byte does not carry its resolution.

## Goals / Non-Goals

**Goals:**

- Give every engine exactly one JUCE-free `MasterClock`, prepared from the negotiated output sample rate and represented as immutable committed block timeline segments.
- Expose stable lifetime-quarter-note time, current-run transport time, transport state, current increment, BPM, and integer-or-fractional output-sample queries to applications.
- Preserve sample-accurate steady-state app use through direct affine calculation while retaining the existing once-per-block application contract and application-owned oversampling loops.
- Accept clock and transport from any controller chain with provenance and deterministic multi-source arbitration.
- Recover a smooth tempo and phase from jittery, missing, duplicated, or restarting external clocks without making the audio thread lock or allocate.
- Generate continuous stopped clock, correctly rephase on Start/Continue, and regenerate received clock when send and receive are both enabled.
- Use a continuous slew-limited audio-sample/monotonic-time map, fixed lookahead, and host timestamp scheduling so emitted clock timing reflects the disciplined sample timeline rather than raw callback, message-thread, browser-poll, or worker wake-up jitter.
- Persist global sync policy and expose it in the shared portable runtime sidebar.
- Demonstrate app consumption with MiniApp's quarter-note/eighth-note gate, ADSR source, and manual tempo parameter.

**Non-Goals:**

- Song Position Pointer, MIDI Time Code, Ableton Link, MIDI 2.0 JR timestamps, time signatures, bars, swing, tap tempo, or a sequencer song-position model.
- Multiple simultaneous clock masters, automatic loop detection, per-port send/receive policy, or clock-source selection UI in this change.
- Runtime-owned oversampling, per-internal-sample runtime callbacks, or moving `ProcessLite`, modulators, module DSP, and decimation out of applications.
- Mid-block tempo-slope changes. New observations affect the next uncommitted block; already committed segments are immutable.
- Making non-24 PPQN MIDI-standard-compliant. It is supported only for peers configured to the same pulse density.
- Driving MiniApp amplitude directly from the ADSR. The envelope is a registered modulation source.

## Decisions

### 1. MasterClock lives in Engine and AppContext

`Engine<App>` owns `MasterClock` beside its sample counter and publishes an address-stable pointer in `AppContext`. `Prepare(sampleRate, blockSize)` prepares the clock after host negotiation and computes its output lookahead. The clock's public application surface includes:

- `LifetimeQuarterNotes()` and `TransportQuarterNotes()`;
- `TransportState()` / `IsTransportRunning()`;
- `QuarterNotesPerSample()` and `TempoBpm()`;
- `SetTempoBpm(double)`, returning whether the manual value was accepted;
- immutable sync-config inspection; and
- the current `ClockBlockPlan`, with absolute integer-or-fractional output-sample queries and analytically enumerated PPQN crossings for the block being rendered.

`AudioBlock::clockPlan` is a non-owning pointer to that exact current plan. During `App::ProcessBlock`, it equals `context->masterClock->CurrentPlan()`; it remains valid and immutable through the callback and is replaced only when the next block is committed. There are not two independently computed clock views.

The manual increment is `bpm / (60 * sampleRate)`. The default is 120 BPM. MiniApp's control range is 30–300 BPM; the core rejects non-finite or non-positive values rather than silently creating invalid time. When receive-clock is enabled, `SetTempoBpm` returns false and changes neither the active increment nor the external estimator. The last manual BPM remains stored so disabling receive-clock has a deterministic value to restore.

Alternative: let each application own a clock. Rejected because MIDI routing, transport policy, persistence, and output timing would be duplicated and applications could drift from one another or the runtime UI.

### 2. Engine commits one affine clock plan per output block

The engine order becomes: drain patch/UI/MIDI messages; apply accepted timestamp observations and transport commands to `MasterClock`; commit a `ClockBlockPlan` for `[block.startSample, block.startSample + block.numFrames)`; analytically publish that plan's clock crossings; then call `App::ProcessBlock` exactly once. The plan contains output-sample start and end, lifetime and transport anchors, one committed quarter-notes-per-output-sample increment, transport-epoch/state information, and no per-sample clock buffer. MasterClock retains only a bounded history of these compact affine descriptors long enough to map delayed input timestamps and construct output lookahead; it does not retain one value per audio or oversampled sample.

For a finite absolute output-sample position `s` inside the committed interval, steady-state lifetime time is calculated directly as `lifetimeStart + (s - blockStart) * increment`; running transport uses the corresponding transport anchor. Queries accept doubles, so a 4x application can map internal index `i` to output-sample position `i / 4.0` and obtain the correct fractional clock position without MasterClock knowing the oversampling factor. MiniApp uses integer positions. Applications that do not consume musical time require no changes.

Plans use half-open intervals. The next plan's start anchor is exactly the preceding plan's mathematical value at its end. A tempo observation may change the next plan's positive slope but never its starting anchor. Consequently lifetime time is continuous and strictly increasing across ordinary block boundaries, and transport is continuous and strictly increasing within a transport epoch; explicit Start/Continue/Stop reset semantics are the only transport discontinuities. Already committed positions never change.

Alternative: call a runtime method at every internal DSP sample. Rejected because it makes the runtime oversampling-aware, adds queue/clock work at 1x versus 4x application-dependent rates, and requires both current applications to cooperate correctly. Alternative: run a runtime output-rate prepass. Rejected because repeated additions provide no extra information over one affine segment and still need a query surface for oversampled consumers. The committed plan provides the same steady-state positions with less realtime work and a stronger continuity contract.

### 3. Accumulators and transport transitions are deliberately distinct from song position

Lifetime time starts at zero when Engine initializes, never resets, and advances through each committed plan at its disciplined positive increment. Transport time describes the current run, not MIDI song position: Stop sets it to zero and it remains zero while stopped; Start and Continue both arm a new run whose first accepted clock is time zero; while Running it advances through the same committed timeline slope.

The transport state machine is `Stopped`, `ArmedStart`, `ArmedContinue`, and `Running`. State changes become app-visible only in committed plans; original timestamps still define external wire phase:

- internal Start/Continue with receive-clock disabled synthesizes the time-zero clock at the next plan boundary after the command is consumed and enters Running for that plan;
- Start/Continue with receive-clock enabled arms transport and waits for the next accepted external `F8`;
- that first `F8` defines transport time zero at its original normalized timestamp and is tick zero rather than tick one; the first Running plan projects forward from that timestamp to its block-start anchor instead of quantizing phase to the drain time;
- Stop takes effect at the next plan boundary after it is consumed, invalidates future running-clock output, sets transport time to zero, and returns to Stopped; and
- repeated Start/Continue re-arms from zero, while repeated Stop is idempotent except for an optionally emitted transport byte for the accepted command.

An accepted external transport byte is scheduled at its original normalized timestamp plus output latency. An internal transport command is scheduled at the plan boundary where it takes effect plus output latency. While Armed, clock output remains on the lifetime grid until the time-zero `F8` activates the transport grid. If an external activation or Stop timestamp lies inside an already rendered plan, MasterClock leaves that app-visible plan immutable but creates an output-only affine splice at the original timestamp: it cancels the replaced grid only from that delayed cutoff onward and analytically fills the new grid from the splice through the next plan boundary. Because the fixed latency is at least two negotiated block durations, a normally handed-off event still has scheduling horizon when consumed. This preserves fixed-offset MIDI output without claiming that the opaque application block reacted midway through rendering.

This follows the requested zero-on-Stop accumulator while acknowledging that Continue cannot restore a Sheaf song position. It still emits/accepts `FB` distinctly so external sequencers may resume their own positions. Song Position Pointer is required before Sheaf itself can expose resume-position semantics.

### 4. Message provenance is explicit and realtime bytes terminate every input chain

`MessageIn` gains Continue plus `Origin { Internal, ExternalMidi }` and the originating controller slot for external messages. Existing UI factories default to Internal. A terminal `RealtimeMidiInProcessor` is appended after profile-specific processors for every controller; it converts `F8`/`FA`/`FB`/`FC` into timestamped ExternalMidi messages and discards no supported realtime byte merely because the controller profile has no mapping for it. This is separate from configurable controller system-button associations.

The master clock, rather than `ParameterManager`, handles these four message types during the audio-thread bus drain. Clock/transport messages drained from the UI and MIDI buses are first copied into one fixed-capacity realtime batch and applied in ascending normalized timestamp order; equal timestamps use Internal before ExternalMidi and then ascending controller slot as the deterministic tie-break. External clock is discarded when receive-clock is false. External transport is discarded when receive-transport is false. Internal transport is never filtered by receive-transport. Send flags affect only output and do not suppress local state changes. Non-clock parameter-message behavior retains the existing bus processing order.

All core timestamps are unsigned integer microseconds in one host-local monotonic epoch. JUCE defines that epoch as microseconds since the Runtime's `steady_clock` start and converts device/JUCE MIDI timestamps into it at the callback boundary. Browser defines it as `performance.timeOrigin`-relative microseconds: `performance.now()`, `emscripten_get_now()`, Web MIDI `event.timeStamp`, worker messages, and output deadlines are converted to that same origin, with Web MIDI milliseconds obtained by dividing engine microseconds by 1000. JUCE and browser adapters must not mix device, DOM, and engine epochs. The original normalized event timestamp is preserved through `MessageIn` so interval measurement uses arrival time rather than the later block-drain time.

### 5. One external source is locked at a time

Mixing `F8` streams from multiple controllers would multiply the inferred tempo. The first valid external clock after receive-clock is enabled claims an active source slot. Clocks from other slots are ignored while that source is healthy. A source is released after the larger of 500 ms or four estimated pulse periods without an accepted clock; the next valid clock may then claim it. When a source is locked, external transport from other slots is ignored; without a clock source, the first accepted external Start/Continue may provisionally claim a source until the first clock or timeout.

The Sync page reports the active source name and lock state read-only when available, but source selection remains automatic.

Alternative: merge all inputs. Rejected because two healthy 24-PPQN sources appear as a 48-PPQN source. Alternative: add source selection now. Deferred to keep the first UI small.

### 6. External recovery uses a bounded digital PLL

Each active-source `F8` is assigned a monotonically increasing input tick index. The first clock establishes a phase anchor but retains the prior tempo. The first positive interval seeds a pulse-period estimate. Thereafter:

1. Compute the raw timestamp delta.
2. Infer `k = round(delta / estimatedPeriod)`, clamped to `1..8`; if `delta/k` is within 25% of the estimate, treat it as `k` elapsed pulses (missed callbacks) and use the normalized interval. Non-positive deltas and implausibly early duplicates are ignored.
3. Keep the latest five normalized intervals, use their median as the jitter-resistant observation, and update period with an EWMA gain of `1/8`.
4. Convert tempo as `60 / (ppqn * periodSeconds)` and increment as BPM over sample rate.
5. Map the original arrival timestamp into fractional output-sample position, compare the observed input tick phase with the phase predicted by the committed timeline, and feed one quarter of phase error, capped at one quarter of a pulse period, into the slope-correction policy for future uncommitted plans. Positive and negative error may temporarily speed or slow the next slope, but every committed increment remains finite and positive; a correction never rewrites a committed plan or changes the next plan's continuity anchor. If error exceeds two pulse periods or the source timed out, re-seed the estimator's target phase and converge from the next continuous plan anchor rather than snapping either accumulator.

The exact constants are named/tested policy constants, not UI settings. They favor a stable outgoing grid over mirroring individual input jitter. A clock dropout free-runs on the last estimate; source timeout makes the lock available but does not stop transport or snap tempo. Acquisition status remains `Acquiring` until two valid intervals, then `Locked`; ignored outliers increment diagnostics counters.

Changing PPQN or toggling receive-clock clears interval history and source lock but preserves the current continuous lifetime value. Disabling receive-clock restores the stored manual BPM without resetting either accumulator.

Alternative: set BPM from each single interval. Rejected because USB/callback jitter becomes audible. Alternative: forward received `F8` directly. Rejected because it cannot make send+receive output steadier than input and cannot use lookahead effectively.

### 7. Phasor2Tick and the running/stopped source switch

`Phasor2Tick` is a JUCE-free DSP processor with double `time`, positive integer `multiplier`, previous floored product, and boolean `tick`. Each call computes `floor(multiplier * time)` and sets tick when that integer differs from the previous value. It supports priming/reset at an arbitrary time without emitting a tick. Invalid time or multiplier is rejected outside its realtime process path.

MasterClock does not call it once per output sample. Analytic enumeration finds every candidate integer grid cell crossed by a committed plan or output-only splice; the owned `Phasor2Tick` is the authoritative priming and last-emitted-cell guard. MasterClock feeds each candidate boundary to it in order and enqueues only when `tick` is true, preventing duplicates across half-open segment boundaries and source switches. Thus enumeration locates potentially multiple crossings while `Phasor2Tick` owns detector state; work scales with emitted ticks rather than audio or oversampled DSP rate.

MasterClock owns one detector configured from PPQN:

- while Stopped or Armed it observes lifetime time, so outgoing clock continues before playback and while waiting for an external time-zero clock;
- while Running it observes transport time, so pulses are phase-aligned to the transport downbeat;
- on Start/Continue activation, the detector is primed at transport zero, an explicit time-zero `F8` is emitted after `FA`/`FB`, and the next detector pulse is at `1/PPQN`—there is no double pulse at zero;
- on Stop, the detector switches back to lifetime and is primed at the current lifetime value, so the switch itself emits no extra pulse; the next lifetime boundary resumes stopped clock; and
- on PPQN change, the detector is reconfigured and primed on the currently selected accumulator, so the setting change emits no synthetic pulse.

The interval from the last stopped pulse to a Start downbeat, and from the last running pulse to the first resumed stopped pulse, can be shorter or longer than one normal pulse interval because Start deliberately rephases transport and Stop deliberately returns to the independent lifetime grid. Once each transition completes, pulses are uniform on the selected grid.

### 8. Output is regenerated through a scheduled realtime lane

When send-clock is enabled, the master clock emits continuous tick events to every currently connected output sink. When send-transport is enabled, accepted local state transitions emit their corresponding realtime byte even if send-clock is off. Incoming realtime is never blindly echoed: send+receive regenerates bytes from the disciplined internal phase.

The runtime owns an `AudioSampleTimeMapper` between absolute output-sample position and the shared monotonic-microsecond epoch. Its first prepared callback anchors the first output sample to that callback's timestamp. Each later callback contributes `(blockStartSample, callbackTimestampMicros)` as a noisy phase observation. The mapper keeps the latest five phase errors, takes their median, filters it with EWMA gain `1/32`, and corrects only future segments by slewing their finite-positive microseconds-per-sample slope around the nominal `1,000,000 / sampleRate`, capped at `±500 ppm`. Ordinary segment start timestamps equal the prior segment's mathematical end, so callback jitter can neither jump time nor perturb already scheduled deadlines. A host discontinuity larger than the output lookahead is an explicit exception: it clears phase history, invalidates affected future events, starts a new mapper generation anchored to `max(observedTimestamp, priorMathematicalEnd)`, and increments the late-event diagnostic. This is a sample-clock DLL distinct from the musical MIDI-clock PLL.

The engine computes a synchronization/output latency once prepared: `max(2 * negotiatedBlockDuration, 5 ms)`. This budgets one worst-case input-to-audio-block handoff plus one scheduling block while remaining small at normal block sizes. Original input timestamps discipline future uncommitted plans and timestamped transition splices; every analytically enumerated clock/transport event receives an absolute engine-monotonic due time derived from its fractional output-sample crossing through `AudioSampleTimeMapper` plus the fixed latency. The raw callback timestamp, browser poll, and sender wake time are never substituted for that deadline. An event received too late to meet its fixed deadline is sent as soon as possible, increments the late-event diagnostic, and does not silently move the phase origin to the drain time.

Deterministic acceptance constants are part of the contract: converting an exact fractional crossing to the integer-microsecond event deadline has at most `1 µs` absolute error; two computed tick deadlines have spacing error at most `2 µs` plus the mapper's `500 ppm` maximum slew contribution; and regenerated send+receive events preserve `dueTime - idealDisciplinedPhaseTime == outputLatency` within `1 µs`. `idealDisciplinedPhaseTime` is the PLL-smoothed internal crossing time, not each jittery raw input-clock timestamp; accepted external transport and the activating time-zero clock remain the explicit original-timestamp exceptions. On an exact 120-BPM/24-PPQN input trace, recovered tempo is within `0.1 BPM` after 64 valid intervals. These are computation/deadline tolerances, not a claim that an OS or physical MIDI device delivers within one microsecond; timestamp-capable adapters must preserve the deadline to their host API's resolution, while actual lateness is reported separately.

Audio-thread events enter a fixed-capacity SPSC realtime lane owned by `MidiSender`; the existing mutex feedback lane remains for message-thread controller output. Events contain a sequence number, due timestamp, broadcast intent, and a phase-generation token. A phase transition publishes the old generation's exact due-time cutoff: already-looked-ahead old-grid events before the cutoff remain valid, while old-grid events at or after it are discarded. Start/Continue switches generations at the activating time-zero `F8`; Stop switches at its effective external timestamp or internal plan boundary. This avoids both a stale post-transition pulse and a hole caused by canceling legitimate pre-transition pulses. Queue overflow drops newest realtime events, increments an atomic diagnostic, and never blocks audio.

The sender worker prioritizes realtime deadlines and submits them early to timestamp-capable sinks. `IMidiOutputSink` gains scheduled-send capability. JUCE uses its timestamped/background MIDI output facility; Web MIDI output records carry `dueTimeMicros`, the browser converts the shared epoch to `DOMHighResTimeStamp`, and calls `port.send(bytes, timestamp)`. Browser draining becomes wake/availability transport, not the timing authority. A host without future scheduling waits on the sender worker until the due time as a documented lower-quality fallback.

At equal due times, transport is ordered before the time-zero clock. Broadcast snapshots current open sinks at send time, so offline outputs drop and reconnects join future pulses without replaying stale clock.

Alternative: sleep and call `sendMessageNow` for every pulse. Rejected because OS wake jitter defeats the latency goal. Alternative: enqueue on the message-thread UI tick. Rejected because its cadence is slower than MIDI clock at ordinary tempos.

### 9. Sync policy is runtime configuration, not patch state

`SyncConfig` contains send-clock, receive-clock, send-transport, receive-transport (all false by default), and integer PPQN (default 24, valid range 1–960). It is owned by Engine, copied into MasterClock through an audio-safe command handoff, exposed to runtime host services, and serialized under `sync` in runtime `config.json`. Runtime config schema v2 loads v1 documents by supplying defaults and always writes v2. Invalid sync fields reject the document without partially mutating instrument/audio/sync state. Patches never carry sync policy.

The shared portable Sync page has four toggles, an integer PPQN control, current BPM/source/lock readouts, and Back. Back commits through Engine, applies the audio-safe update, and saves runtime configuration. The page is available identically in JUCE and browser hosts.

### 10. MiniApp uses the clock as an application consumer

MiniApp adds `AdsrModule<2>` plus an application-owned stable two-float mirror buffer registered as application modulation source index 7, and registers Attack/Decay/Sustain/Release plus a Tempo parameter. After each ADSR process call, MiniApp copies `AdsrModule::Outputs()` into that mirror before `UpdateModValues`; no mutable ADSR-module output accessor is added. The LFO page/bank order becomes LFO's five controls, ADSR's four controls, then Tempo. Tempo maps linearly from 30 to 300 BPM, defaults to 120, and calls `MasterClock::SetTempoBpm` only when the effective value changes; a rejected call during receive-clock leaves the external tempo in authority.

For each audio frame, MiniApp queries the committed plan at the absolute output-sample position for that frame. The shared gate is high exactly when transport is Running and the queried transport quarter-note phase is in `[0, 0.5)` modulo one. Thus every integer quarter-note boundary creates a rising edge, the gate remains high for one eighth note, and the half-quarter boundary creates the falling edge. Both ADSR voices receive the same gate but keep independent processor state. Stop makes the next committed transport epoch low. The envelope is processed before `UpdateModValues`, so its current sample is visible to parameter modulation in the same application frame under the existing modulation ordering.

## Risks / Trade-offs

- [A fixed latency makes transport response intentionally late at MIDI output] → Keep it derived from negotiated block size, expose it in diagnostics, and delay transport and clock by the same amount so phase remains correct.
- [Large audio blocks produce conspicuous latency] → Document the relationship on Sync status and recommend smaller blocks for master-clock use; correctness takes priority over pretending an unschedulable event is on time.
- [A browser tab can be throttled] → Schedule through Web MIDI timestamps ahead of time and report late/drop counters; no browser API can guarantee timing after suspension.
- [Non-24 PPQN can confuse ordinary MIDI devices] → Default to 24, label the field PPQN, and state in UI/help that other values require matching peers.
- [Double affine queries eventually lose fractional precision at huge absolute sample indexes] → Keep plan-local offsets small, retain accumulated quarter-note anchors separately, and add long-run/oversampled fractional-query tests; a future epoch-rebasing scheme can preserve the externally visible total if multi-year continuous runtimes prove problematic.
- [PLL constants may feel too stiff or loose for particular hardware] → Name constants, test acquisition/jitter/dropout traces, and keep estimator policy isolated from MasterClock state transitions.
- [Sustained queue overflow breaks clock continuity] → Reserve an independent high-priority lane sized for the configured maximum rate/lookahead and publish counters; never let controller feedback starve realtime clock.
- [Automatic source locking may pick the wrong device] → Deterministic first-source locking prevents merged clocks; explicit source selection is a later UI extension.
- [Start/Continue semantics differ from full sequencer resume] → Document transport time as current-run elapsed time and keep Song Position Pointer/song position out of scope.

## Migration Plan

1. Add the low-level processor, clock/config types, deterministic clock tests, and v1→v2 runtime-config loader before wiring hosts.
2. Add Engine/AppContext ownership and committed-plan construction with fake-app, fractional-query, continuity, and SynthRig tests; keep all sync flags false so behavior is inert by default.
3. Add terminal realtime input processors and provenance, then source arbitration/PLL tests using injected timestamps.
4. Add the scheduled sender lane and host-specific timestamp adapters; retain the immediate feedback lane and its existing tests.
5. Add the portable Sync page and persistence round trips in both host contract suites.
6. Add MiniApp ADSR/tempo integration and headless musical-boundary tests.

Rollback can disable all four sync flags without changing patches or app topology. Code rollback reads existing v1 config; after a v2 file has been written, rollback requires removing the `sync` field and changing its schema version back to v1, so deployment should retain a backup of the prior runtime config during the schema migration.

## Open Questions

- Whether the first release should expose output latency as an advanced control or keep the derived value read-only. This design keeps it read-only to avoid configurations smaller than the required handoff horizon.
- Whether transport from a non-clock controller should be accepted while a clock source is locked. This design rejects it for deterministic single-master behavior; a later per-port policy could separate clock and transport leaders.
