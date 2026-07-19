## 1. Timing DSP and Clock Contracts

- [ ] 1.1 Add failing JUCE-free DSP tests for `Phasor2Tick` boundary changes, silent same-cell processing, silent priming, backward/jumped time, invalid setup, and allocation-free/noexcept processing.
- [ ] 1.2 Implement `Phasor2Tick` in the synth DSP headers and update focused build dependencies until the new DSP tests pass.
- [ ] 1.3 Define JUCE-free `SyncConfig`, transport/acquisition enums, immutable `ClockBlockPlan`, diagnostics snapshot, and `MasterClock` public API with compile-time contract tests.

## 2. Master Clock Core

- [ ] 2.1 Add deterministic tests for prepare/default state, BPM-to-output-sample-increment conversion, rejected invalid tempo, external-authority rejection, manual-tempo restoration, stopped/running affine queries, half-open endpoints, exact inter-block anchor continuity, immutable current-plan behavior, and timestamp mapping through bounded plan history.
- [ ] 2.2 Implement MasterClock preparation, manual tempo authority, one affine `ClockBlockPlan` commit per output block, a bounded compact plan-descriptor history, direct integer/fractional output-sample queries with no sample buffer, and finite-positive slope changes that apply only to future plans.
- [ ] 2.3 Add transition tests for internal and external Start/Continue, timestamped time-zero first clock and first-plan phase projection, next-plan Stop/zeroing, repeated commands, and the distinction between current-run time and MIDI song position.
- [ ] 2.4 Implement the Stopped/ArmedStart/ArmedContinue/Running state machine and first-clock-after-transport semantics.
- [ ] 2.5 Add tests for analytically enumerated stopped lifetime ticks and running transport ticks, fractional crossing positions, half-open endpoint ownership, internal and timestamp-separated external Start/Continue ordering, output-only transition splices, no duplicate zero tick, Stop switch priming, and phase-safe PPQN changes.
- [ ] 2.6 Implement MasterClock's owned `Phasor2Tick`, crossing-count-rate detector advancement, lifetime/transport source switching, timestamped output-only transition splices, cutoff-aware phase-generation invalidation, and scheduled-event production seam.

## 3. External Clock Recovery

- [ ] 3.1 Add timestamp-trace tests for 24-PPQN tempo acquisition within `0.1 BPM` after 64 exact stable intervals, five-interval median plus `1/8` EWMA, alternating jitter, duplicate/out-of-order input, one-to-eight missed pulses, bounded phase correction, hard reacquisition, and free-run dropout.
- [ ] 3.2 Implement the isolated external-clock estimator/PLL policy and wire its disciplined period, phase correction, lock state, and counters into MasterClock without audio-thread allocation or locks.
- [ ] 3.3 Add multi-controller tests for first-source acquisition, foreign-source rejection, provisional transport ownership, timeout `max(500 ms, four periods)`, takeover, and continuity across source changes.
- [ ] 3.4 Implement controller-slot source arbitration and coherent lock/source/BPM diagnostics publication.

## 4. Realtime MIDI Input and Message Dispatch

- [ ] 4.1 Extend `MessageIn` with Continue, Internal/ExternalMidi origin, and external controller-slot identity; update equality, factories, catalogs, sort/JSON/config helpers, and exhaustive switch tests without changing existing UI factory defaults.
- [ ] 4.2 Add failing processor-chain tests proving unmapped `F8`/`FA`/`FB`/`FC` from every profile become distinct external messages with original normalized timestamps and slot identity while unrelated bytes remain unchanged.
- [ ] 4.3 Implement the terminal realtime MIDI input processor and append it to every controller profile chain, including rebuild paths and browser delivery.
- [ ] 4.4 Route clock/transport messages from both UI and MIDI bus drains through one fixed-capacity timestamp-ordered batch to MasterClock on the audio thread, apply deterministic equal-time ties plus receive gating/provenance/source rules, and remove the existing discard-only Start/Stop/Clock handling.

## 5. Engine, AppContext, and SynthRig Integration

- [ ] 5.1 Add fake-app Engine tests for one stable context clock pointer, prepare ordering, message-drain-before-plan order, one app block call, `AudioBlock::clockPlan == MasterClock::CurrentPlan()`, immutable plan lifetime, exact consecutive anchors/sample ranges, and tick enqueue before delegation.
- [ ] 5.2 Make Engine own MasterClock, expose it through `AppContext`/`AudioBlock`, prepare it from negotiated values, commit and publish one plan per output block, and enumerate clock crossings without moving parameter or module DSP into Engine.
- [ ] 5.3 Extend SynthRig with deterministic clock/transport injection and inspection helpers, then cover internal/external transitions, block-size independence, 4x internal-index-to-fractional-output-position queries, long-run double precision, and no-NaN/no-hang invariants.
- [ ] 5.4 Add audio-thread instrumentation tests proving plan commit, direct clock query, analytical crossing enumeration, and scheduled-event enqueue perform no allocation or mutex acquisition.

## 6. Runtime Configuration Persistence

- [ ] 6.1 Add JSON tests for `SyncConfig` defaults, valid round trips, every invalid boolean/type/PPQN case, atomic rejection, schema-v1 default migration, schema-v2 output, and patch exclusion.
- [ ] 6.2 Extend runtime configuration serialization/loading APIs to include sync state, accept schema v1 with defaults, write schema v2, and update Engine startup/save call sites atomically with instrument and audio state.
- [ ] 6.3 Add startup-order tests proving loaded sync policy is installed before clock prepare, MIDI processing, reconciliation, and the first audio block.

## 7. Scheduled MIDI Sender and JUCE Output

- [ ] 7.1 Add deterministic `MidiSender` tests for fixed-capacity SPSC realtime enqueue, broadcast to all open sinks, feedback-lane isolation, deadline priority, equal-time ordering, cutoff-aware generation invalidation that preserves earlier events, offline sinks, overflow counters, and clean shutdown.
- [ ] 7.2 Implement the scheduled realtime lane and worker arbitration while preserving existing mutex-backed per-controller feedback behavior and reconnect-safe sink clearing.
- [ ] 7.3 Extend the sink contract with scheduled delivery and epoch conversion; add JUCE adapter tests/seams for future-timestamp submission, immediate-feedback compatibility, late-event accounting, and unsupported-host fallback.
- [ ] 7.4 Implement JUCE timestamped/background delivery, worker fallback waiting, and lifecycle start/stop ordering without `sendMessageNow` on scheduled clock events.
- [ ] 7.5 Implement the continuous five-error-median/`1/32`-EWMA `AudioSampleTimeMapper` with `±500 ppm` future-slope slew, integrate MasterClock output latency `max(2 * block duration, 5 ms)`, and add fractional-crossing tests proving `≤1 µs` deadline error, `≤2 µs` spacing error plus bounded slew, `≤1 µs` fixed-offset regeneration error, exact half-open ownership, transition handoff without a clock hole, discontinuity handling, and observable late-event fallback.

## 8. Browser Scheduled MIDI

- [ ] 8.1 Extend browser C++/worker/TypeScript protocol tests so outbound MIDI carries `dueTimeMicros`, controller feedback remains valid, and bounded drains preserve event ordering.
- [ ] 8.2 Update the browser MIDI bridge and output sink to retain scheduled deadlines and generation behavior without allowing its bounded queue to starve realtime clock.
- [ ] 8.3 Update Web MIDI types and manager logic to convert the engine epoch to `DOMHighResTimeStamp` and call `port.send(bytes, timestamp)`; test that drain time never replaces due time and that immediate events still send correctly.
- [ ] 8.4 Add browser integration coverage for external input timestamp normalization, Start-plus-first-clock order, continuous stopped clock, output reconnect, and timer-throttling/late diagnostics.

## 9. Portable Sync Page

- [ ] 9.1 Add JUCE-free view-model/tree tests for the Sync sidebar action, four toggles, PPQN validation and nonstandard warning, read-only diagnostics, staged edits, Back commit/save, and File Back non-save behavior.
- [ ] 9.2 Implement portable sidebar layout changes and `SyncPageSurface`, extend runtime main-page routing/policy and generic host-service callbacks, and preserve configured app bounds in both hosts.
- [ ] 9.3 Wire Engine sync snapshots and audio-safe config commit into JUCE and browser main services, including active controller-name resolution and coherent UI refresh.
- [ ] 9.4 Add JUCE component and browser command-buffer/Playwright parity tests for opening, editing, saving, reopening, narrow layout, and diagnostics rendering.

## 10. MiniApp Clocked ADSR and Tempo

- [ ] 10.1 Add MiniApp system tests for ADSR/Tempo parameter registration and LFO page/bank order, 30–300 BPM mapping/default, application modulator index ownership, storage capacity, and existing topology parity.
- [ ] 10.2 Integrate `AdsrModule<2>`, its application-owned stable two-float modulation mirror at index 7, and the Tempo parameter into MiniApp initialization, bank/page registration, sample-rate preparation, parameter storage sizing, and modulation-source registration.
- [ ] 10.3 Add committed-plan query tests proving gate high on transport phase `[0, 0.5)`, low on `[0.5, 1)`, quarter-note retrigger, next-plan Stop-low behavior, same-frame ADSR mirror publication at index 7, and correct behavior across arbitrary block boundaries.
- [ ] 10.4 Process the clock-derived ADSR gate, copy `AdsrModule::Outputs()` into the registered mirror, then call `UpdateModValues` in the same frame; call the master tempo API only when MiniApp's effective Tempo value changes, including ignored external-authority calls and manual restoration.
- [ ] 10.5 Update MiniApp portable UI/system snapshots and focused documentation for the expanded LFO page while preserving existing VCO/filter/audio/ratio-grid behavior.

## 11. Verification and Documentation

- [ ] 11.1 Run the focused DSP, clock, MIDI sender, persistence, Engine/SynthRig, MiniApp, JUCE runtime-page, browser unit, and browser integration suites; fix every regression without weakening timing assertions.
- [ ] 11.2 Run the complete synth core, JUCE, MiniApp, and browser test targets and the OpenSpec requirement-ID/validation checks.
- [ ] 11.3 Update synth architecture/coverage/contracts documentation with master-clock ownership, thread roles, runtime-config schema v2, MIDI timestamp epochs, output-latency formula, non-24 PPQN warning, Continue limitation, diagnostics, and host fallback guarantees.
- [ ] 11.4 Capture deterministic internal, jittered-external, callback-jitter, missed-clock, dropout, block-boundary tempo-change, fractional-crossing, Start/Stop/Continue, send+receive, and multi-output timing traces and verify computed deadline error `≤1 µs`, spacing error `≤2 µs` plus the `500 ppm` slew bound, fixed-offset error `≤1 µs`, and recovered 120-BPM error `≤0.1 BPM` after 64 stable intervals.
