# Delta — `synth-midi-instrument`

smi-11 is modified. Its body narrows the broadcast from every registered sink
to every registered controller-row sink, and states that the app MIDI-out
sink (smi-20) never receives clock or transport; the "Feedback remains
controller-specific" scenario says "every open controller-row sink" where it
said "every open sink". One scenario is added, and the
"Realtime broadcast reaches all online outputs" scenario gains a `Check:` line
naming the existing test that covers it. Every other clause and scenario is
carried forward word for word.

smi-19 and smi-20 are added.

## MODIFIED Requirements

### Requirement: smi-11 — Sender: scheduled broadcast realtime lane
WHEN runtime-owned MIDI clock or transport is emitted from the audio timeline, THE `MidiSender` SHALL accept it through a fixed-capacity single-producer/single-consumer scheduled-realtime lane separate from the existing controller-feedback queue, carry an absolute due timestamp and phase generation, support invalidating an old generation at an exact due-time cutoff, prioritize realtime deadlines, and broadcast a due event to every currently registered/open controller-row sink and never to the app MIDI-out sink (smi-20); this lane's producer SHALL perform no mutex acquisition or allocation, queue overflow SHALL be observable and non-blocking, and existing per-controller feedback routing SHALL retain its slot-specific behavior.

An app's MIDI out port carries only the app's own messages.

#### Scenario: Realtime broadcast reaches all online outputs
- **WHEN** two controller output sinks are open at a scheduled clock deadline
- **THEN** both sinks receive the same Timing Clock event
- Check: `tests/midi_sender_tests.cpp: scheduled_realtime_broadcast_preserves_original_deadline`

#### Scenario: Feedback remains controller-specific
- **WHEN** a controller output processor enqueues encoder feedback for sink 1 while clock broadcast is active
- **THEN** that feedback reaches only sink 1
- **AND** the broadcast clock reaches every open controller-row sink

#### Scenario: Audio producer never waits on feedback queue
- **WHEN** the mutex-protected feedback queue is contended while the audio thread enqueues scheduled clock
- **THEN** scheduled enqueue does not acquire that mutex or wait for feedback work

#### Scenario: Stale generation is suppressed only after its cutoff
- **WHEN** a phase transition invalidates an old generation at due time `C`
- **THEN** the sender preserves old-generation events due before `C`
- **AND** drops old-generation events due at or after `C` before any sink receives them

#### Scenario: Clock and transport skip the app MIDI-out sink
- **WHEN** a controller-row sink and the app MIDI-out sink are both registered and a Timing Clock, Start, Continue or Stop event falls due
- **THEN** the controller-row sink receives it
- **AND** the app MIDI-out sink receives nothing
- Check: none yet. Task 2 adds the test.

## ADDED Requirements

### Requirement: smi-20 — Sender: app channel messages on the realtime lane to one sink
WHEN the audio thread hands the sender an app channel message, THE `MidiSender` SHALL carry it on the same scheduled-realtime lane as clock and transport, as an event that holds its three message bytes, its due time and one target sink, and SHALL deliver it only to the app MIDI-out sink, a sink slot of its own beyond the controller-row slots, so that no controller row gives up an output. The app MIDI-out sink SHALL be registered and cleared only through entry points of its own, never by a controller ordinal.

The event kind is appended after `Stop` and its ordering class after `Clock`, so no existing ordinal moves. An app channel message carries phase generation zero, so a generation cutoff never drops it: `ApplyGenerationCutoff` drops only events whose generation equals the invalidated one, and clock generations are nonzero. The producer side stays allocation-free and mutex-free.

Controller rows are not limited to eight: `MidiInstrumentConfig::AddController` has no count check, and the engine passes each row's ordinal to the sender as its sink index. The MIDI-out slot sits at index `kMaxSinks`, which a ninth row's ordinal also equals, so the sender's controller-slot calls keep rejecting every index at or past `kMaxSinks` as they do today, and the MIDI-out slot has its own registration calls. A ninth row therefore still binds no output, as today, and never becomes the MIDI-out sink.

The producer's cost was measured before this event type grew: R1a (frogg3rs MIDI-out feasibility run, native, caller thread under `THREAD_TIME_CONSTRAINT_POLICY`, 64 frames at 48 kHz, 600 s) gave `max_call_ns=53417`, 4.0% of the 1,333,000 ns block, with 0 of 450,112 calls at or over 10% of the block; R1b (wasm, ordinary pthread worker rather than the AudioWorklet thread, 300 s) gave `max_call_ns=175104`, 13.1% of the block, with 0 calls at or over block time. Task M4 re-measured it on the grown event (three message bytes and a target sink index added to `ScheduledMidiEvent`, built from `62829a4a`), with the same caller policy and period for 600 s, its sender's worker started and draining: of 447,750 timed calls the maximum was 72,959 ns, 5.5% of the 1,333,000 ns block, p99.9 25,375 ns, with 0 calls at or over 10% of the block and 0 at or over the block; the producer-overflow count stayed 0 and the sink received all 450,000 messages enqueued. Its positive control, a 2,000 µs stall inside the timed region on every 200th call, showed all 2,250 of those calls at or over the block time.

`MidiSender::Start()` SHALL run only on the main thread, never lazily from inside the AudioWorklet callback (coordinator ruling, from task M6 in the browser: spawning a pthread from inside the worklet's own thread is not a safe call under `-sPTHREAD_POOL_SIZE=1` and silently stops the callback). By reading the browser path, this already holds: `BrowserMidiBridge::Start()` calls it, and runs from `synth_browser::Runtime::Start()`, which completes before `StartAudioWorklet()`/`Prepare()` creates the worklet's own thread.

#### Scenario: An app message reaches only the MIDI-out sink
- **WHEN** controller-row sinks 0 and 1 and the app MIDI-out sink are registered and an app Control Change is enqueued on the realtime lane
- **THEN** the app MIDI-out sink receives exactly those three bytes at the event's due time
- **AND** neither controller-row sink receives it
- Check: none yet. Task 2 adds the test.

#### Scenario: A generation cutoff never drops an app message
- **WHEN** an app message and an old-generation clock event are pending past a generation cutoff's due time
- **THEN** the clock event is dropped and the app message is delivered
- Check: none yet. Task 2 adds the test.

#### Scenario: Every controller row keeps its output
- **WHEN** eight controller rows each have an open output and the app MIDI-out sink is also registered
- **THEN** all nine sinks are registered at once and each receives only its own traffic
- Check: none yet. Task 2 adds the test.

#### Scenario: Releasing the MIDI-out sink waits for an in-flight send
- **WHEN** `ClearAppMidiOutSinkSync` is called while the worker is delivering to the app MIDI-out sink
- **THEN** it returns only after that delivery ends, and the worker never calls that sink again
- Check: none yet. Task 2 adds the test.

#### Scenario: A ninth controller row never becomes the MIDI-out sink
- **WHEN** a sink is registered through the controller-slot call at index `kMaxSinks`, and an app Control Change falls due with no MIDI-out sink registered
- **THEN** that sink receives nothing, and the registration is ignored as it is today
- Check: none yet. Task 2 adds the test.

#### Scenario: A delivered app message does not hold back the clock
- **WHEN** a host-timestamped app MIDI-out sink and a controller-row sink are registered, an app message is due first and a Timing Clock event is due after it
- **THEN** the MIDI-out sink receives the app message, the controller-row sink receives the clock at its due time, and no pending entry remains
- Check: none yet. Task 2 adds the test.

### Requirement: smi-19 — App catalog: MIDI-out contents
WHEN an app declares a MIDI catalog, THE catalog SHALL be able to list the contents the app can send on its MIDI out, each with a stored id, a label and whether it sends Control Change or notes, and an app whose catalog lists none SHALL show no MIDI-out setting anywhere in the runtime.

Off is the runtime's own entry and is not a catalog content.

#### Scenario: Declared contents are offered after Off
- **WHEN** an app's catalog lists two MIDI-out contents
- **THEN** the MIDI-out "Sends" choice offers Off followed by those two labels in catalog order
- Check: none yet. Task 9 adds the test.

#### Scenario: A catalog with no contents shows no setting
- **WHEN** an app's catalog lists no MIDI-out contents
- **THEN** the Controllers page shows no Audio to MIDI section
- Check: none yet. Task 9 adds the test.
