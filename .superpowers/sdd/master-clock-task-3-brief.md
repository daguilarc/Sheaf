# Synth Master Clock/MIDI Sync — Task 3 Brief

## Assignment

Implement plan Task 3, **MIDI Ingress, Engine/App Contracts, SynthRig, and Runtime Config v2**, from base commit `7a5383f5`.

Covered OpenSpec tasks: **4.1–4.4, 5.1–5.4, 6.1–6.3**.

This is intentionally one coarse Sol task. Keep its three evidence areas separately auditable in the report:

1. MIDI ingress and deterministic dispatch;
2. Engine/AppContext/AudioBlock/SynthRig integration;
3. runtime configuration v2 and startup ordering.

Read completely before editing:

- `openspec/changes/add-synth-master-clock-midi-sync/proposal.md`
- `openspec/changes/add-synth-master-clock-midi-sync/design.md`
- every delta spec under `openspec/changes/add-synth-master-clock-midi-sync/specs/`
- `openspec/changes/add-synth-master-clock-midi-sync/tasks.md`
- `docs/superpowers/plans/2026-07-19-synth-master-clock-midi-sync.md`
- `.superpowers/sdd/master-clock-task-1-report.md`
- `.superpowers/sdd/master-clock-task-2-report.md`
- current `MasterClock.hpp/.cpp` and their tests

Use repository `about-me`, `software-principles`, `git-workflow`, and Superpowers TDD/verification instructions. Do not modify the OpenSpec checkboxes, plan checkboxes, progress ledger, this brief, or unrelated user files.

## Required RED/GREEN behavior

### MIDI ingress

- Extend `MessageIn` with Continue, explicit `Origin { Internal, ExternalMidi }`, and external controller slot identity. Preserve Internal defaults for all existing UI/system factories and compatibility for unrelated message kinds.
- Update equality, factories, catalogs, sort/JSON/config helpers, exhaustive switches, and focused tests.
- Add a terminal realtime MIDI input processor to every controller profile and every rebuild path. Otherwise-unmapped `F8/FA/FB/FC` must become distinct external Clock/Start/Continue/Stop messages carrying the original normalized integer-microsecond timestamp and source slot. Unrelated bytes and profile mappings must remain unchanged.
- Replace separate discard-oriented realtime drains with one fixed-capacity batch spanning UI and MIDI buses. Sort by timestamp, then the spec's deterministic equal-time tie rules. Route clock/transport to `MasterClock`; retain ordinary parameter/grid behavior. Bus drain order must never override timestamp order.
- External receive gating/source ownership remains MasterClock policy; internal transport bypasses external receive gating.

### Engine, application contracts, and SynthRig

- `Engine<App>` owns exactly one address-stable `MasterClock`, prepares it from negotiated **output** sample rate/block size, exposes its stable pointer through `AppContext`, and publishes a non-owning pointer to the exact `CurrentPlan()` in `AudioBlock`.
- Per block, enforce: drain due inputs and route clock observations/transport → commit one plan and enqueue analytical crossings → optional frame hook → exactly one `App::ProcessBlock` call.
- Inject the Task 2 `IScheduledMidiEventSink` boundary into Engine. Use a fixed-capacity, allocation-free test sink here; Task 4 owns concrete `MidiSender` worker consumption.
- Preserve existing `AudioBlock::startSample`, once-per-block app contract, and application-owned per-sample DSP. Add no runtime per-sample callback and no runtime oversampling state.
- Prove Braid 4 queries clock at `block.startSample + internalIndex / 4.0`; MiniApp/output-rate use can query integer positions. If the current applications do not yet consume clock in this task, prove the contract through Engine/SynthRig/fixture tests without prematurely implementing Task 7 ADSR behavior.
- Extend `SynthRig` with deterministic timestamped clock/transport injection, current-plan/direct-query helpers, and scheduled-output inspection. Cover internal/external transitions, block-size independence, fractional 4x queries, long-run finite monotonic precision, and no-NaN/no-hang behavior.
- Instrument steady-state audio work: plan commit, direct queries, analytical crossings, and sink enqueue must allocate no memory and acquire no mutex.

### Runtime config v2 and startup

- Runtime `config.json` schema v2 contains `sync` with four booleans and integer PPQN `1..960`. Schema v1 loads with default sync and saves as v2.
- Valid instrument/audio/sync state loads atomically. Every invalid sync field type/value, missing/invalid v2 shape required by the spec, and invalid PPQN must reject without partial mutation of any live instrument, audio, or sync field.
- Patch documents remain unchanged and never contain sync policy.
- Startup must install loaded sync policy before clock prepare, MIDI reconcile/processing, and first audio block. Add explicit order tests at existing seams rather than relying only on final state.

## Integration invariants

- All core timestamps are unsigned integer microseconds in the existing host-local monotonic epoch. Preserve the original normalized input timestamp through `MessageIn`; block drain time is not a substitute.
- The committed clock plan is immutable for the app callback and identical by address/value to `MasterClock::CurrentPlan()`.
- No audio-thread locks, allocation, I/O, sleeps, or per-audio-frame runtime loop.
- Fixed-capacity overflow is observable and newest input/output is dropped rather than blocking.
- Do not implement the concrete scheduled `MidiSender` lane, JUCE delivery, browser timestamped output, Sync page, or MiniApp ADSR/tempo UI in this task.
- Do not check composite OpenSpec 7.5; Task 4 owns end-to-end sender integration.

## Likely files

- `projects/synth/include/synth/ParameterModulation.hpp`
- `projects/synth/src/ParameterModulation.cpp`
- `projects/synth/include/synth/MidiController.hpp`
- `projects/synth/src/MidiController.cpp`
- `projects/synth/include/synth/AppContext.hpp`
- `projects/synth/include/synth/Engine.hpp`
- `projects/synth/tests/support/SynthRig.hpp`
- `projects/synth/include/synth/PatchPersistence.hpp`
- `projects/synth/src/PatchPersistence.cpp`
- existing runtime config/startup call sites and focused tests/Makefile dependencies

Follow discovered repository seams; report any necessary additional path and why it belongs to this task.

## Verification and commits

Observe genuine missing-contract RED tests before production implementation. Then run focused contract, instrument/controller, Engine, SynthRig, and persistence/config/startup tests; warning-free affected rebuilds; direct ASan/UBSan where practical; `make -C projects/synth test`; strict OpenSpec validation; and diff/scope checks.

Create exactly two commits:

1. implementation and tests;
2. metadata-only `.superpowers/sdd/master-clock-task-3-report.md`.

The report must list base/head commits, exact paths, RED/GREEN commands and results, realtime evidence, config/startup atomicity evidence, deviations, and three explicit evidence subsections matching this brief. Stay available after completion for same-context Opus review fixes.
