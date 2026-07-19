# Synth Master Clock/MIDI Sync — Task 4 Brief

## Assignment

Implement plan Task 4, **Scheduled MIDI Sender and JUCE Delivery**, from base commit `d36cdfb4`.

Covered OpenSpec tasks: **7.1–7.5**, specifically the concrete sender, host-delivery, lifecycle, and end-to-end timing portions. Task 1/2 already implemented the mapper, clock producer values, crossings, splices, and deadline arithmetic; Task 3 connected the abstract scheduled sink to Engine.

Read completely before editing:

- all OpenSpec proposal/design/spec/task artifacts for `add-synth-master-clock-midi-sync`
- `docs/superpowers/plans/2026-07-19-synth-master-clock-midi-sync.md`
- `.superpowers/sdd/master-clock-task-{1,2,3}-report.md`
- `MasterClock.hpp/.cpp`, `MidiController.hpp/.cpp`, `Engine.hpp`
- `runtime/MidiConnectionManager.hpp`, `runtime/Runtime.hpp`, JUCE MIDI adapters, browser sink compatibility code
- current sender/reconcile/runtime/JUCE tests

Use repository `about-me`, `software-principles`, `git-workflow`, and Superpowers TDD/verification instructions. Do not modify parent progress/brief/checklists, prior reports, or unrelated user files.

## Required behavior

### Dedicated realtime lane and worker arbitration

- Make `MidiSender` implement the Task 2 `IScheduledMidiEventSink` producer contract with a dedicated fixed-capacity SPSC lane. `TryEnqueue` is `noexcept`, allocation-free, mutex-free, and never waits; overflow drops the newest realtime event and increments an atomic diagnostic.
- Preserve the existing mutex-backed controller-feedback lane and all immediate-feedback behavior. Realtime deadlines have priority when due/ready, without starving or reordering existing feedback beyond the specified arbitration.
- Preserve `ClearSinkSync`'s destruction guarantee for both immediate and scheduled sends: after it returns, the worker can no longer call that sink. Clearing one sink must not wait on unrelated sinks.
- Broadcast scheduled events to a snapshot of currently open sinks at send/submission time. Offline sinks drop silently; reconnected sinks receive only future events, with no replay.
- At equal due timestamps, order generation cutoff before transport and transport before clock, then sequence number. Apply cutoff-aware phase-generation invalidation: retain old-generation events before cutoff; discard old-generation events at/after cutoff. Cutoff control records are not sent as MIDI bytes.
- Retain newest-drop behavior through producer and worker consumption, expose producer overflow, stale-generation drops, and late-event counters, and prove clean shutdown with pending events.

### Sink contract and scheduled host delivery

- Extend `IMidiOutputSink` compatibly with explicit scheduled-send capability and engine-epoch conversion. Existing immediate `Send(BasicMidi)` implementations and controller feedback remain valid.
- Timestamp-capable sinks receive the original computed absolute `dueTimeMicros`; worker wake time must not replace it. Submit future events early enough for the host scheduling API.
- For sinks without future scheduling, implement a documented lower-quality sender-worker wait-until-due fallback, then immediate send. Never block the audio producer.
- JUCE scheduled clock/transport must use JUCE's timestamped/background MIDI output facility and explicit conversion from the runtime's steady-clock microsecond epoch. It must not call `sendMessageNow` for scheduled clock/transport. Immediate controller feedback may continue using the compatible immediate path.
- Keep JUCE/device callback, runtime steady-clock, and sender deadlines in one documented epoch. Add adapter seams/tests rather than relying on physical device timing.

### Engine/runtime integration and timing

- Wire Engine's scheduled sink to the concrete `MidiSender` before audio/MIDI ingress begins. Sender/connection lifecycle starts before producers and stops only after producers are quiescent; preserve reconnect-safe teardown and manager destruction ordering.
- Keep MasterClock output latency exactly `max(2 * negotiated block duration, 5 ms)` and retain mapper-derived fractional deadlines, external transition original-timestamp exceptions, phase-generation cutoffs, and discontinuity/late fallback behavior.
- Add deterministic integration tests proving computed deadline error `<=1 us`, inter-tick spacing error `<=2 us` plus bounded `500 ppm` slew contribution, regenerated fixed-offset error `<=1 us`, exact half-open ownership, no transition clock hole, and observable late fallback. These are deadline-computation assertions, not physical delivery guarantees.
- Do not duplicate or replace Task 1/2 mapper/PLL math. Test the concrete consumption/delivery boundary against those existing events.

## Scope boundaries

- Do not implement Task 5's browser `dueTimeMicros` protocol/Web MIDI timestamp path beyond preserving compile/runtime compatibility with the extended sink interface.
- Do not implement the Sync page or MiniApp/Braid application behavior.
- Do not weaken fixed-capacity, source-generation, latency, or timestamp tolerances to satisfy tests.
- No audio-thread allocation, mutex, I/O, sleep, wait, or per-sample loop.

## Likely files

- `projects/synth/include/synth/MidiController.hpp`
- `projects/synth/src/MidiController.cpp`
- `projects/synth/runtime/MidiConnectionManager.hpp`
- `projects/synth/runtime/Runtime.hpp`
- JUCE adapter files under `projects/synth/juce/` and runtime seams
- `projects/synth/tests/midi_sender_tests.cpp`
- focused reconcile, runtime, shell/component/JUCE adapter tests and Makefile dependencies

Follow discovered seams and justify any additional path in the report.

## Required RED/GREEN evidence and commits

First record genuine REDs for the missing scheduled producer contract/ordering/cutoff/overflow behavior and the missing JUCE scheduled-delivery seam. Then run focused sender, reconcile, poller, runtime/shell/component/JUCE tests, affected browser compatibility builds, warning-free rebuilds, direct ASan/UBSan and ThreadSanitizer where supported/practical, full `make -C projects/synth test`, strict OpenSpec validation, and exact diff/scope checks.

Create exactly two commits:

1. implementation and tests;
2. metadata-only `.superpowers/sdd/master-clock-task-4-report.md`.

The report must include exact base/head/path scope, RED/GREEN commands/results, lane capacity and memory-ordering rationale, worker arbitration table, cutoff examples, sink scheduling/fallback behavior, lifecycle ordering, timing-tolerance evidence, sanitizer limitations/results, deviations, and remaining Task 5 boundary. Stay available for same-context Opus review fixes.
