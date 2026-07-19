# Synth Master Clock and MIDI Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Sheaf synth runtime own a sample-accurate master clock with MIDI clock/transport receive and scheduled send, expose affine per-block clock queries to applications, add portable sync configuration, and demonstrate the contract with MiniApp's clocked ADSR.

**Architecture:** `Engine` owns one JUCE-free `MasterClock`. At each output callback it drains and deterministically orders timestamped control messages, commits one immutable half-open affine `ClockBlockPlan`, publishes that exact plan through `AudioBlock`, analytically enumerates outgoing crossings, and calls the application exactly once. Applications query integer or fractional output-sample positions; oversampled applications convert internal positions to fractional output positions. Incoming clock disciplines future affine plans through an isolated PLL. Outgoing realtime MIDI uses a dedicated fixed-capacity lane and host-scheduled absolute deadlines, while existing controller feedback stays on its mutex-backed lane.

**Tech Stack:** C++20, JUCE, Emscripten, TypeScript, Web MIDI, portable Sheaf UI, Make, Node/Playwright, OpenSpec change `add-synth-master-clock-midi-sync`, native Codex Sol/Terra implementers, persistent Claude Opus xagent review.

## Global Constraints

- Treat the accepted OpenSpec proposal, design, delta specs, and `tasks.md` under `openspec/changes/add-synth-master-clock-midi-sync/` as normative. If this plan and OpenSpec disagree, stop and reconcile the artifacts rather than guessing.
- Preserve the application contract: one `ProcessBlock(AudioBlock&)` call per output block. Do not add a runtime-per-sample callback or a clock sample buffer.
- Clock plans are immutable, half-open `[startSample, endSample)`, and queryable at fractional output-sample positions. Ordinary adjacent plans share an exact mathematical endpoint; a future slope change starts from that anchor, so lifetime phase is strictly monotonic for every finite positive tempo.
- `AudioBlock::clockPlan` is the same object as `MasterClock::CurrentPlan()` and remains valid throughout the callback. Braid 4 internal sample `k` queries at `block.startSample + k / 4.0`.
- The audio path performs no allocation, mutex acquisition, I/O, sleeping, or unbounded work. Use fixed-capacity storage, atomics, preallocation, bounded histories, and analytic crossing enumeration.
- Shared timestamps are unsigned integer microseconds in one host-local monotonic epoch. JUCE normalizes callback/device timestamps to the runtime `steady_clock` epoch; browser code uses `performance.timeOrigin`-relative microseconds and converts to Web MIDI milliseconds only at the API boundary.
- `AudioSampleTimeMapper` uses nominal `1'000'000 / sampleRate`, the median of five phase errors, a `1/32` EWMA, and a `±500 ppm` cap on future slope adjustment. Ordinary blocks maintain exact endpoint continuity. A host discontinuity resets from `max(observedTimestamp, priorMathematicalEnd)` and records late/discontinuity diagnostics.
- Computed crossing deadline error is at most `1 µs`; computed spacing error is at most `2 µs` plus the mapper's bounded `500 ppm` contribution; regenerated send+receive fixed-offset error is at most `1 µs`. These are calculation guarantees, not physical-device delivery guarantees.
- `SyncConfig` defaults all four flags off, PPQN `24`, valid range `1..960`. Receive-clock authority rejects app tempo changes; the saved manual BPM is restored when receive clock is disabled.
- External acquisition uses the exact constants in the design: five-interval median; period EWMA `1/8`; feed one quarter of measured phase error, capped at one quarter of a pulse period, into future-plan slope correction; hard reacquire when phase error exceeds two pulse periods; reject duplicates/out-of-order input; infer missed pulses for integer multiples `2..8`; and free-run on dropout. Pulse-relative limits scale with configured PPQN. Exact 120 BPM/24 PPQN recovers to within `0.1 BPM` after 64 valid intervals.
- Realtime input batching is fixed-capacity and timestamp ordered. Equal timestamps order `Internal` before `ExternalMidi`, then controller slot ascending. One terminal processor per controller emits otherwise-unmapped `F8/FA/FB/FC` with the original normalized timestamp and slot.
- MIDI Start and Continue enter armed states; the activating first accepted clock is tick zero at its original timestamp. Stop zeroes transport in the next committed epoch. Stopped clocks continue from lifetime phase. Song Position Pointer and retained song position are out of scope.
- Outgoing clock enumeration uses lifetime phase while stopped and transport phase while running. `Phasor2Tick` is the authoritative priming/dedup guard around analytically found candidates; it is never run once per audio sample. Phase-generation cutoffs preserve old-grid events strictly before a transition and discard old-grid events at or after it.
- Output latency is `max(2 * current block duration, 5 ms)`. Transport and clock share it. At equal due times, transport precedes the time-zero clock. Broadcast resolves currently open sinks at send time; reconnects receive future events without replay.
- Keep controller feedback behavior compatible. Realtime clock gets an independent fixed-capacity SPSC lane whose overflow drops newest and increments a diagnostic.
- Browser draining is availability transport, not timing authority: `dueTimeMicros` survives to `MIDIPort.send(bytes, timestamp)`.
- Runtime config v2 owns sync state; v1 loads with defaults; invalid v2 input is rejected atomically. Patches never contain sync policy.
- MiniApp owns a stable two-float ADSR mirror at application modulation source index `7`; copy current ADSR outputs before `UpdateModValues`. The shared gate is high iff transport is running and phase modulo one is in `[0, 0.5)`.
- Use strict TDD for each task: demonstrate a focused failure, implement minimally, run focused tests, then run the task's regression set. Do not weaken assertions to obtain green tests.
- Do not edit or stage the unrelated untracked `projects/synth/miniapp/` directory or `projects/synth/browser/package-lock.json` unless a task proves a deliberate tracked-source dependency change is required and the root agent approves it.
- After each implementation task, write the SDD implementer report, generate a review package, obtain a clean review from the persistent Opus reviewer, apply small feedback with the same implementer, re-review with the same reviewer, run verification, then mark only the covered OpenSpec checkboxes complete.

---

## Task 1: Clock Primitives, Affine Plans, and Time Mapping (Sol)

**OpenSpec Tasks Covered:** 1.1–1.3, 2.1–2.2, mapper portion of 7.5

**Primary Files:**

- Create `projects/synth/include/synth/DspPhasor2Tick.hpp`.
- Create `projects/synth/include/synth/MasterClock.hpp` and `projects/synth/src/MasterClock.cpp` (or keep small value types header-only when justified).
- Modify `projects/synth/Makefile` for library objects and focused tests.
- Modify `projects/synth/tests/dsp_tests.cpp`.
- Create `projects/synth/tests/master_clock_tests.cpp`.

**Required interfaces and behavior:**

- [x] Add failing `Phasor2Tick` tests for silent priming, cell-boundary tick, same-cell silence, backward time, jumps, invalid multiplier/time, `noexcept`, and allocation-free processing.
- [x] Implement a double-time/integer-multiplier processor whose tick is true exactly when `floor(multiplier * time)` differs from the primed previous cell. Define safe invalid-input behavior explicitly and test it.
- [x] Define `SyncConfig`, transport/acquisition/source enums, coherent diagnostics snapshot, immutable `ClockBlockPlan`, compact bounded plan history descriptors, and `MasterClock` query/prepare/config API without JUCE types.
- [x] Make a plan expose lifetime and transport quarter-note phase at integer and fractional output positions by affine evaluation, plus exact start/end anchors and range metadata. No per-sample storage is permitted.
- [x] Add an isolated `AudioSampleTimeMapper` implementing the five-error median, `1/32` EWMA, `±500 ppm` future slew, exact ordinary continuity, discontinuity reset rule, epoch mapping, and observable diagnostics.
- [x] Test default/prepare state, BPM-to-slope conversion, invalid tempo, receive-authority rejection, manual restoration, stopped/running queries, half-open endpoints, exact adjacent anchors, immutable current plan, bounded timestamp/history queries, future-only slope changes, discontinuity handling, and long-run finite monotonic behavior.
- [x] Run `make -C projects/synth dsp_tests master_clock_tests` (add named phony targets if the Makefile convention requires them) and the existing contract/engine compile tests affected by the new types.
- [x] Commit only the task files after review and verification.

## Task 2: Transport State, External PLL, Source Arbitration, and Crossing Production (Sol)

**OpenSpec Tasks Covered:** 2.3–2.6, 3.1–3.4, remaining clock-side portion of 7.5

**Primary Files:**

- Modify `projects/synth/include/synth/MasterClock.hpp` and `projects/synth/src/MasterClock.cpp`.
- Modify `projects/synth/tests/master_clock_tests.cpp`.
- Add a dedicated PLL test/source file if separation makes the policy easier to test without broadening public API.

**Required behavior:**

- [ ] Add failing transition tests for internal/external Start, Continue, Stop, armed activation, timestamped tick zero, first-plan phase projection, repeated commands, output-only transition splices, source switching, and current-run rather than song-position semantics.
- [ ] Implement `Stopped`, `ArmedStart`, `ArmedContinue`, and `Running`; gate external commands with receive policy and source ownership; apply internal commands at the next plan boundary and external commands at normalized timestamps.
- [ ] Add exact and jittered timestamp-trace tests for PLL acquisition, median/EWMA values, duplicate and out-of-order rejection, inferred missed pulses `2..8`, bounded phase correction, hard reacquisition, free-run dropout, and 120-BPM accuracy after 64 intervals.
- [ ] Add multi-controller tests for provisional transport ownership, deterministic first-source lock, foreign rejection, timeout `max(500 ms, four periods)`, takeover, and continuous phase/BPM diagnostics.
- [ ] Implement source arbitration and the isolated estimator without locks or allocation, retaining manual tempo for later restoration.
- [ ] Add analytical crossing tests for stopped lifetime ticks, running transport ticks, fractional deadlines, half-open ownership, Start/Continue splice ordering, tick-zero dedup, Stop switch priming, PPQN phase safety, generation/cutoff publication, and send+receive regenerated phase.
- [ ] Use the owned `Phasor2Tick` as the priming/last-cell authority for candidate crossings. Verify no O(block-size) per-sample loop exists.
- [ ] Define the JUCE-free producer boundary used by later integration: a `ScheduledMidiEvent` value plus a non-owning `IScheduledMidiEventSink::TryEnqueue(const ScheduledMidiEvent&) noexcept`-style contract. The event carries due time, sequence, broadcast/transport ordering intent, phase generation, and cutoff data. The contract requires fixed-capacity, newest-drop, allocation-free, mutex-free producer semantics and observable overflow; Task 3 uses a fixed-capacity test double, while Task 4 makes `MidiSender` the production implementation and owns worker consumption.
- [ ] Run focused clock tests plus `make -C projects/synth test` before review.
- [ ] Commit only the task files after review and verification.

## Task 3: MIDI Ingress, Engine/App Contracts, SynthRig, and Runtime Config v2 (Sol)

**OpenSpec Tasks Covered:** 4.1–4.4, 5.1–5.4, 6.1–6.3

**Primary Files:**

- Modify `projects/synth/include/synth/ParameterModulation.hpp`, `projects/synth/src/ParameterModulation.cpp`, `projects/synth/include/synth/MidiController.hpp`, and `projects/synth/src/MidiController.cpp`.
- Modify `projects/synth/include/synth/AppContext.hpp`, `projects/synth/include/synth/Engine.hpp`, and `projects/synth/tests/support/SynthRig.hpp`.
- Modify `projects/synth/include/synth/PatchPersistence.hpp`, `projects/synth/src/PatchPersistence.cpp`, and Engine/runtime persistence call sites.
- Modify relevant contract, instrument, controller, engine, rig, and persistence tests plus `projects/synth/Makefile` dependencies.

**Required behavior:**

- [ ] Extend `MessageIn` with Continue, origin, and external slot identity while preserving Internal defaults for existing UI factories. Update equality, factories, catalogs, serialization/config helpers, exhaustive switches, and tests.
- [ ] Add a terminal realtime processor to every controller profile/rebuild chain so otherwise-unmapped `F8/FA/FB/FC` becomes distinct ExternalMidi input with original normalized timestamp and slot; unrelated bytes remain unchanged.
- [ ] Replace separate discard-oriented UI/MIDI drains for realtime clock/transport with one fixed-capacity sorted batch and the required deterministic tie order. Route accepted messages through `MasterClock`; retain normal parameter/grid behavior.
- [ ] Make `Engine` own and prepare `MasterClock`, expose one stable pointer through `AppContext`, publish the exact current plan through `AudioBlock`, and order each block as message drain → plan commit/crossing enqueue → optional frame hook → exactly one app block call.
- [ ] Inject the Task 2 scheduled-event sink boundary into Engine. Prove enqueue ordering and realtime safety with the fixed-capacity test sink in this task; do not forward-reference Task 4's concrete `MidiSender` realtime lane.
- [ ] Preserve `startSample` semantics and application ownership of per-sample DSP. Verify Braid 4's `internal / 4.0` query convention without adding callbacks.
- [ ] Extend SynthRig with deterministic injection, timestamps, clock queries, outgoing-event inspection, block-size/oversampling/long-run tests, and no-NaN/no-hang checks.
- [ ] Prove plan commit, direct query, crossing enumeration, and realtime enqueue are allocation- and mutex-free on the steady-state audio path.
- [ ] Upgrade runtime config to schema v2 with atomic instrument/audio/sync load; accept v1 with default sync; reject every invalid sync type/value with no partial mutation; keep patches unchanged.
- [ ] Verify startup order installs loaded sync before prepare, MIDI reconcile/processing, and the first block.
- [ ] Structure the implementer report and Opus review evidence in three explicit subsections—MIDI ingress, Engine/AppContext/SynthRig, and runtime config/startup—so this intentionally coarse task remains independently auditable.
- [ ] Run focused `contract_tests`, `instrument_tests`, `engine_tests`, `rig_tests`, persistence tests, and then `make -C projects/synth test`.
- [ ] Commit only the task files after review and verification.

## Task 4: Scheduled MIDI Sender and JUCE Delivery (Sol)

**OpenSpec Tasks Covered:** 7.1–7.5 (integration and host-output portions)

**Primary Files:**

- Modify `projects/synth/include/synth/MidiController.hpp` and `projects/synth/src/MidiController.cpp`.
- Modify `projects/synth/runtime/MidiConnectionManager.hpp`, `projects/synth/runtime/Runtime.hpp`, and JUCE MIDI adapter files under `projects/synth/juce/` / `projects/synth/runtime/`.
- Modify `projects/synth/tests/midi_sender_tests.cpp` and add JUCE adapter/runtime tests where the existing seams live.

**Required behavior:**

- [ ] Add deterministic tests for the independent fixed-capacity SPSC realtime lane, broadcast snapshots, deadline priority, feedback isolation, transport-before-clock ties, phase-generation cutoffs, offline/reconnected sinks, newest-drop overflow counters, late counters, and clean shutdown.
- [ ] Preserve the current mutex feedback lane and `ClearSinkSync` safety contract while adding realtime worker arbitration that never blocks the producer.
- [ ] Implement the Task 2 `IScheduledMidiEventSink` producer contract with `MidiSender`'s dedicated fixed-capacity SPSC lane and retain its newest-drop/overflow semantics through worker consumption.
- [ ] Extend `IMidiOutputSink` with scheduled delivery and explicit epoch conversion. Immediate controller feedback must remain compatible.
- [ ] Submit future timestamps using JUCE's timestamp/background MIDI output facility; do not use `sendMessageNow` for scheduled clock. Implement a documented worker-wait fallback only for sinks without future scheduling.
- [ ] Integrate mapper-derived deadlines and latency `max(2 * block duration, 5 ms)`, including transition cutoffs and current-sink broadcast at send time.
- [ ] Prove the numeric deadline/spacing/fixed-offset tolerances and distinguish calculated deadline accuracy from observable physical lateness.
- [ ] Verify sender lifecycle begins before audio/MIDI ingress and ends only after producers stop; retain reconnect-safe teardown.
- [ ] Run focused sender, reconcile, poller, JUCE runtime/shell/component tests, then core regression tests.
- [ ] Commit only the task files after review and verification.

## Task 5: Browser Timestamped MIDI End to End (Sol)

**OpenSpec Tasks Covered:** 8.1–8.4

**Primary Files:**

- Modify `projects/synth/include/synth/browser/BrowserMidiBridge.hpp`, `BrowserRuntime.hpp`, and `BrowserRuntimeMainServices.hpp`.
- Modify `projects/synth/browser/cpp/BrowserRuntimeAbi.cpp`.
- Modify `projects/synth/browser/src/protocol.ts`, `worker.ts`, `midi.ts`, `audio.ts`, and tests under `projects/synth/browser/tests/`.
- Modify browser C++ bridge/contract tests under `projects/synth/tests/`.

**Required behavior:**

- [ ] Extend C++/worker/TypeScript outbound records with `dueTimeMicros` while keeping immediate feedback valid and bounded drains ordered.
- [ ] Normalize external Web MIDI input timestamps into the shared time-origin-relative microsecond epoch before C++ delivery; preserve Start-plus-first-clock order and source identity.
- [ ] Carry deadlines and generation/cutoff behavior through the browser bridge without allowing its bounded availability queue to starve clock events.
- [ ] Convert microseconds to the correct `DOMHighResTimeStamp` at `port.send(bytes, timestamp)`. Drain/wake time must never replace the due time.
- [ ] Test stopped continuous clock, input clock/transport, output reconnect without replay, late/timer-throttling diagnostics, and immediate events.
- [ ] Run C++ browser bridge/contract targets, browser Node tests, then Playwright with the existing build/static-server workflow. If browser process sandboxing blocks Chromium, rerun the same command through the approved escalated path; do not reinterpret an infrastructure error as a product failure.
- [ ] Commit only the task files after review and verification.

## Task 6: Portable Sync Page and Host Persistence Parity (Terra)

**OpenSpec Tasks Covered:** 9.1–9.4

**Primary Files:**

- Modify `projects/synth/include/synth/RuntimePages.hpp`, `RuntimePagePolicy.hpp`, `RuntimeMainComponent.hpp`, and portable UI builders as needed.
- Modify `projects/synth/runtime/JuceRuntimeMainServices.hpp` and JUCE runtime-page adapters/tests.
- Modify `projects/synth/include/synth/browser/BrowserRuntimeMainServices.hpp`, browser UI/command-buffer adapters, and browser tests.
- Modify runtime-page, main-component, portable UI, and persistence parity tests.

**Required behavior:**

- [ ] Add a runtime-owned Sync sidebar action and portable `SyncPageSurface` with four staged toggles, integer PPQN validation (`1..960`), non-24 warning, read-only BPM/source/lock/latency/late-drop diagnostics, and Back.
- [ ] Commit config and save runtime state only on Sync Back. Preserve File Back's existing non-save behavior.
- [ ] Route coherent Engine snapshots and audio-safe sync updates through generic host-service callbacks; resolve active controller name outside the audio path.
- [ ] Maintain configured app bounds and usable narrow layout in JUCE and browser.
- [ ] Add JUCE-free tree/view-model tests plus JUCE component and browser command-buffer/Playwright parity for open/edit/save/reopen and diagnostics refresh.
- [ ] Run portable UI, runtime main component, JUCE page, browser command-buffer, and focused Playwright tests.
- [ ] Commit only the task files after review and verification.

## Task 7: MiniApp Clocked ADSR, Tempo, and Oversampling Contract (Terra)

**OpenSpec Tasks Covered:** 10.1–10.5 and the application-consumer portions of 5.3

**Primary Files:**

- Modify `projects/synth/apps/miniapp/MiniAppCore.hpp`, MiniApp portable UI/model/draw files, and `README.md`.
- Modify `projects/synth/tests/miniapp_system_tests.cpp` and portable UI snapshots/tests.
- Modify `projects/synth/apps/braid-4/Braid4Core.hpp` and Braid system/deadline tests only to enforce fractional clock-query behavior; do not alter Braid DSP topology.

**Required behavior:**

- [ ] Register Attack/Decay/Sustain/Release and Tempo after the existing five LFO controls in both page and bank ordering; Tempo maps linearly `30..300 BPM`, defaults to `120`, and storage/topology expectations remain exact.
- [ ] Integrate `AdsrModule<2>` and an app-owned stable two-float mirror at application modulation source index `7`; do not add mutable module output access.
- [ ] For each output frame, derive the shared gate from the committed transport phase: high on `[0, 0.5)`, low on `[0.5, 1)`, only while Running. Test quarter retrigger, eighth-note falling edge, arbitrary block boundaries, and next-plan Stop-low.
- [ ] Process ADSR, copy `Outputs()` into the mirror, then call `UpdateModValues`, proving current-sample visibility for both voices.
- [ ] Call `SetTempoBpm` only when effective Tempo changes; verify receive authority ignores it and disabling receive restores manual tempo.
- [ ] In Braid 4 tests, prove every 4x internal sample queries fractional output position and that the last prior-block internal sample precedes the next block's first sample under tempo changes.
- [ ] Update UI/system expectations and MiniApp docs without regressing VCO/filter/audio/ratio-grid behavior.
- [ ] Run MiniApp system/UI tests, Braid system/deadline tests, and the full core suite.
- [ ] Commit only the task files after review and verification.

## Task 8: Timing Traces, Documentation, and Whole-System Hardening (Sol)

**OpenSpec Tasks Covered:** 11.1–11.4 and any cross-cutting acceptance gap left by Tasks 1–7

**Primary Files:**

- Modify `projects/synth/README.md`, `projects/synth/docs/coverage.md`, and focused architecture/contracts documentation.
- Add deterministic trace fixtures/tests under `projects/synth/tests/` and browser tests rather than ad-hoc scripts when practical.
- Modify production code only for genuine acceptance failures; route substantive failures back to the owning implementer context when feasible.

**Required behavior:**

- [ ] Audit every OpenSpec scenario and task against tests and implementation. Add missing deterministic traces for internal clock, exact/jittered external clock, callback jitter, missed/dropout clocks, block-boundary tempo changes, fractional crossings, all transport transitions, send+receive regeneration, multi-output broadcast/reconnect, and source takeover.
- [ ] Assert deadline error `≤1 µs`, spacing error `≤2 µs` plus the `500 ppm` slew allowance, fixed-offset error `≤1 µs`, and 120-BPM recovery error `≤0.1 BPM` after 64 stable intervals.
- [ ] Document ownership, once-per-block/fractional-query contract, oversampling conversion, thread roles, mapper and timestamp epochs, runtime config v2 migration, output latency, PPQN compatibility warning, transport/Continue limitations, diagnostics, and fallback quality.
- [ ] Run all focused C++ tests, `make -C projects/synth test`, application/JUCE build-and-test targets, browser Node and Playwright suites, UI-boundary checks, strict OpenSpec validation, and requirement-ID checks.
- [ ] Obtain a final whole-branch Opus review in addition to the task review. Fix and re-review until both spec compliance and code quality are clean.
- [ ] Mark every verified OpenSpec task complete and leave the change ready for archive; do not archive or land unless the user separately requests it.
- [ ] Commit only final trace/documentation/fix files after review and verification.

---

## OpenSpec Coverage Map

| OpenSpec section | Implementation task |
|---|---|
| 1.1–1.3, 2.1–2.2 | Task 1 |
| 2.3–2.6, 3.1–3.4 | Task 2 |
| 4.1–4.4, 5.1–5.4, 6.1–6.3 | Task 3 |
| 7.1–7.4 | Task 4 |
| 7.5 | Tasks 1, 2, and 4 |
| 8.1–8.4 | Task 5 |
| 9.1–9.4 | Task 6 |
| 10.1–10.5 | Task 7 |
| 11.1–11.4 | Task 8 |

## Review and Progress Protocol

- `.superpowers/sdd/progress.md` is the durable task ledger. Before dispatch, create the task brief with the SDD helper and include the exact OpenSpec context paths, plan task, base commit, writable scope, focused tests, and report path.
- Dispatch exactly one implementation task at a time. Use native Codex `gpt-5.6-sol` with high/xhigh reasoning for Tasks 1–5 and 8; use `gpt-5.6-terra` with high reasoning for Tasks 6–7 unless discovered coupling warrants Sol.
- Keep native implementer agents available after their task. Small review fixes return to that implementer with the existing context. A review finding showing the approach is fundamentally wrong may use a fresh implementer/reviewer context after the root records why.
- Keep the persistent Claude Opus xagent reviewer session alive through all task reviews and the final whole-branch review. Each re-review receives the prior findings, fix summary, updated report/review package, and current commit range.
- Do not mark an OpenSpec checkbox from an implementer claim. The root verifies the diff, report, review verdict, and fresh command output first.
