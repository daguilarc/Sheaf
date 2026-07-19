# Synth Master Clock/MIDI Sync — Task 4 Implementer Report

## Summary and Commit Range

Implemented OpenSpec tasks 7.1–7.5 (concrete sender, host-output, lifecycle,
and concrete delivery-boundary portions) from exact base:

- base: `d36cdfb4f6c6249e87997936ca309cc44ec126da`
- implementation head: `340cf082cb5ec9120d27439f371cdd44995797d2`
- implementation commit: `feat(synth): deliver scheduled MIDI clock events`
- task head: the metadata-only commit containing this report (its hash cannot
  be embedded in its own contents without changing that hash)

`MidiSender` is now the fixed-capacity realtime producer/worker consumer for
`ScheduledMidiEvent`, while the original mutex-backed feedback queue and
immediate sink contract remain compatible. JUCE outputs submit clock/transport
through the background timestamp scheduler in the runtime epoch. Engine owns
the concrete wiring, and Runtime starts the sender before MIDI/audio ingress.

## Paths

Implementation and tests commit (`340cf082`):

- `projects/synth/include/synth/Engine.hpp`
- `projects/synth/include/synth/MidiController.hpp`
- `projects/synth/juce/MidiHandlers.hpp`
- `projects/synth/juce/PortableDrawGeometryTests.cpp`
- `projects/synth/runtime/MidiConnectionManager.hpp`
- `projects/synth/runtime/Runtime.hpp`
- `projects/synth/runtime/juce_build.mk`
- `projects/synth/src/MidiController.cpp`
- `projects/synth/tests/engine_tests.cpp`
- `projects/synth/tests/midi_sender_tests.cpp`

Metadata-only follow-up commit:

- `.superpowers/sdd/master-clock-task-4-report.md`

`runtime/juce_build.mk` is required because JUCE application/test links now
instantiate the concrete Engine clock-to-sender path and therefore need
`MasterClock.cpp`, `MasterClock.hpp`, and `DspPhasor2Tick.hpp`. No browser
protocol source was changed. The parent-owned progress ledger, brief,
OpenSpec/plan checkboxes, prior reports, untracked browser lockfile, and
untracked `projects/synth/miniapp/` were not edited or staged.

## Semantics and Seam Checkpoint

Before edits, the parent received this binding checkpoint:

- one fixed 4,096-entry SPSC scheduled lane, release/acquire publication and
  reclamation, relaxed diagnostic increments, newest-drop overflow;
- one fixed ordered worker pending set, cutoff consumption before delivery,
  and equal-time cutoff/transport/clock/sequence order;
- due realtime outranks feedback; future host-ready realtime alternates with
  FIFO feedback; feedback runs whenever realtime is not ready;
- broadcast snapshots sink registration generations at submission, validates
  each generation immediately before its call, and tracks in-flight work per
  sink so clearing one sink never waits on an unrelated blocked sink;
- immediate-only is the backward-compatible default; host-capable sinks retain
  the original deadline; fallback waits on the worker until due;
- JUCE shares an explicit runtime epoch, uses `startBackgroundThread` plus
  `sendBlockOfMessages`, retains `sendMessageNow` only for immediate feedback,
  and normalizes MIDI input timestamps through the inverse conversion;
- Engine wiring precedes ingress, Runtime starts the worker before device/audio
  producers, and teardown quiesces producers before stopping the sender and
  destroying the connection manager.

## RED Evidence

### Core scheduled sender RED

```text
make -C projects/synth -B build/midi_sender_tests
```

Exited `2` before production edits. The new tests failed to compile on the
missing `MidiSchedulingCapability`, `IScheduledMidiEventSink` inheritance,
`TryEnqueue`, scheduling methods, scheduled event visibility, and sender
diagnostics. This was the expected missing concrete Task 4 contract.

### JUCE scheduled-delivery RED

```text
clang++ -Iprojects/synth/include -Iprojects/synth/apps/miniapp \
  -Iprojects/synth/juce -Iprojects/synth/runtime -I/Users/joyo/JUCE/modules \
  -DNDEBUG -DJUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1 \
  -DJUCE_STANDALONE_APPLICATION=1 -DJUCE_WEB_BROWSER=0 -DJUCE_USE_CURL=0 \
  -std=c++20 -Wall -Wextra -Wpedantic -fsyntax-only \
  projects/synth/juce/PortableDrawGeometryTests.cpp
```

Exited `1` before JUCE implementation. Missing seams were
`MidiOutputHandler::SchedulingCapability`, `RuntimeMidiEpoch`,
`JuceScheduledMidiSubmission`, and `PrepareScheduledMidiSubmission`.

`PortableDrawGeometryTests` is the correct existing JUCE seam: its documented
role already includes MIDI-handler smoke coverage, it compiles and links the
real JUCE adapter without requiring physical MIDI hardware, and it can assert
epoch conversion plus buffer/deadline construction deterministically. The full
JUCE runtime-shell target separately proves lifecycle integration.

No production implementation was added before both REDs were captured.

## GREEN and Verification Evidence

Focused sender build/run:

```text
make -C projects/synth -B build/midi_sender_tests
projects/synth/build/midi_sender_tests
```

Exit `0`; all 18 tests pass. Coverage includes producer and worker overflow,
deadline priority, FIFO feedback isolation, transport/clock ties, cutoff
boundaries, fallback waiting and late observation, scheduled broadcast,
per-sink clear synchronization, reconnect no-replay, clean future-event stop,
exact internal deadlines, and external fixed-offset/no-hole regeneration. The
complete sender binary also passed eight consecutive
runs of its timing-sensitive clear/broadcast races.

Focused adjacent and browser compatibility suites:

```text
make -C projects/synth contract_tests engine_tests
make -C projects/synth build/reconcile_tests \
  build/reconcile_executor_tests build/poller_tests
projects/synth/build/reconcile_tests
projects/synth/build/reconcile_executor_tests
projects/synth/build/poller_tests
make -C projects/synth browser-midi-bridge-test browser-unit-test \
  browser-command-buffer-test browser-audio-device-test
```

Exit `0`; contract, Engine, reconcile/executor/poller, and existing immediate-
only browser sink behavior all pass. Engine's added test proves its owned
`MasterClock` reaches its owned `MidiSender` without test sink reinjection.

JUCE adapter, runtime, and application evidence:

```text
make -C projects/synth/apps/miniapp \
  /Users/joyo/.codex/worktrees/5fc41ca0-491d-48fb-944c-babc0bc62db6/Sheaf/projects/synth/apps/miniapp/build/portable_draw_geometry_tests \
  /Users/joyo/.codex/worktrees/5fc41ca0-491d-48fb-944c-babc0bc62db6/Sheaf/projects/synth/apps/miniapp/build/runtime_shell_session_tests
projects/synth/apps/miniapp/build/portable_draw_geometry_tests
projects/synth/apps/miniapp/build/runtime_shell_session_tests
make -C projects/synth/apps/miniapp all
```

Exit `0`. The real JUCE module-backed adapter test, runtime lifecycle/session
test, and complete `SynthMiniapp.app` build all compile/link warning-free and
pass. CoreMIDI reports its expected no-device host message in the test
environment; tests remain hardware-independent.

`make -C projects/synth/apps/miniapp test` built and linked all changed-path
JUCE targets, then exited `2` in the unchanged
`ControllersPageSimulationTests.cpp` on a missing unrelated
`ControllersTreeRenderer`. Separately invoking the unchanged MiniApp backend
parity binary aborts on its fixture precondition (`MiniApp requires an
initialization-time grid manager`). These are outside Task 4 paths. The changed
adapter and runtime targets above pass, and the full application builds.

Direct sanitizers:

```text
make -C projects/synth BUILD_DIR=/private/tmp/sheaf-task4-asan CXX=clang++ \
  CXXFLAGS='-std=c++20 -Wall -Wextra -Wpedantic -O1 -g \
    -fsanitize=address,undefined -fno-omit-frame-pointer' \
  /private/tmp/sheaf-task4-asan/midi_sender_tests
/private/tmp/sheaf-task4-asan/midi_sender_tests

make -C projects/synth BUILD_DIR=/private/tmp/sheaf-task4-tsan CXX=clang++ \
  CXXFLAGS='-std=c++20 -Wall -Wextra -Wpedantic -O1 -g \
    -fsanitize=thread -fno-omit-frame-pointer' \
  /private/tmp/sheaf-task4-tsan/midi_sender_tests
/private/tmp/sheaf-task4-tsan/midi_sender_tests
```

Both complete sanitized sender suites exit `0`, with no ASan, UBSan, or TSan
diagnostic. ThreadSanitizer was supported on this host; no sanitizer limitation
was needed.

Full regression and specification validation:

```text
make -C projects/synth test
openspec validate add-synth-master-clock-midi-sync --strict
```

Both exit `0`. The complete core suite passes, and OpenSpec reports the change
valid. A final forced C++20 `-Wall -Wextra -Wpedantic -O2` sender/library
rebuild also exits `0` without warnings.

Scope/format evidence:

- `git diff --check`: exit `0`.
- `git diff --cached --check`: exit `0` before the implementation commit.
- staged implementation audit contained exactly the ten paths listed above.
- the only tracked unstaged path remained the parent-owned progress ledger.

## Realtime Lane and Memory Ordering

`TryEnqueue` is a single-producer operation over an inline 4,096-entry array.
It performs no allocation, mutex operation, wait, sleep, or sink/host call and
is compile-time checked `noexcept`. It reads its producer-owned write cursor
relaxed, acquires the worker-published read cursor before deciding capacity,
writes one plain event, then release-publishes the next write cursor. The worker
acquires that cursor before copying entries and release-publishes reclaimed
read capacity; the producer's acquire pairs with that release before reusing a
slot. Overflow retains every older event, drops the newest attempted event, and
increments a relaxed atomic counter because diagnostics do not order payload.

The worker has a separate fixed 4,096-entry ordered pending array. If pending
capacity is exhausted while draining newly published events, that newest
consumed event is dropped and the independent worker-overflow diagnostic
increments. No realtime producer shares the feedback queue or worker pending
storage.

## Worker Arbitration and Ordering

| State | Worker action |
|---|---|
| Cutoff observed while draining SPSC | Apply invalidation immediately; never emit MIDI |
| Realtime deadline due/late | Send/submit before any feedback |
| Future realtime host-ready and feedback queued | Alternate one realtime event and one FIFO feedback entry |
| Future realtime host-ready only | Submit with its original absolute due time |
| Feedback only or realtime not ready | Drain the next FIFO feedback entry |
| Nothing ready | Wait until notification or the next host-lead/due boundary |

The pending comparator is due time, then declared ordering intent, then
sequence: generation cutoff, transport, clock, sequence. All newly published
realtime records are drained before choosing a delivery, so a cutoff already
behind old-generation events in the producer lane invalidates them first.

For cutoff `(invalidated generation 11, due 40,000)`, an old-generation event
at `39,999` is retained while an event at `40,000` is discarded. Transport
events use generation zero and cannot be discarded by phase cutoffs. Stale
drops are counted; cutoff records have no MIDI status delivery.

## Broadcast, Scheduling, and Clear Safety

At host submission/wake, the sender snapshots open sink registration
generations and capabilities once. Each actual call revalidates pointer plus
generation under the sink mutex and increments only that sink's in-flight
counter before releasing the mutex. `ClearSinkSync(ix)` first clears and
advances that registration generation, then waits only for
`inFlightBySink[ix]`. Thus an already-active call completes before destruction,
an old snapshot cannot call a replacement sink, and clearing sink 1 returns
while a deliberately blocked sink 0 call remains active. Offline snapshot
slots drop silently; reconnection receives only subsequently snapshotted
events, never replay.

`IMidiOutputSink` defaults to `ImmediateOnly`; existing implementations need
only `Send`. Host-timestamped sinks advertise `HostTimestamped` and receive
`SendScheduled(midi, originalDueTimeMicros)` at the 1-ms host lead boundary.
The worker never substitutes wake time for due time. Immediate-only sinks stay
pending until due, then use `Send`; fallback sends and lateness are observable.

## JUCE Epoch and Delivery

`RuntimeMidiEpoch` captures the offset between Runtime's `steady_clock` zero
and JUCE's `getMillisecondCounterHiRes` domain. Outgoing engine microseconds
convert to JUCE absolute milliseconds, and incoming JUCE callback seconds use
the inverse conversion to engine microseconds. One captured epoch is copied to
every input/output handler in `MidiConnectionManager`.

`MidiOutputHandler::Open` starts JUCE's background MIDI thread. Scheduled
clock/transport constructs a one-event `MidiBuffer` and calls
`sendBlockOfMessages` with the converted original deadline; this path never
calls `sendMessageNow`. Immediate controller feedback retains
`sendMessageNow`. Close clears queued host messages, stops the background
thread, and releases the device after the sender's per-sink clear barrier.

## Lifecycle Ordering

Engine constructs `MidiSender` with the same timestamp provider used by the
clock/runtime and wires `MasterClock` to it in the Engine constructor. Runtime
initializes Engine, starts the sender, then runs synchronous MIDI reconciliation
and its poller, opens/configures audio, registers the audio callback, and starts
the UI timer. Therefore MIDI input, feedback, and audio clock production never
precede the worker.

Shutdown removes the audio callback and stops the UI timer first, so scheduled
and feedback producers are quiescent. It then stops/joins the sender and resets
the connection manager. Manager destruction stops/joins the device poller,
detaches inputs, calls `ClearSinkSync` for each output, clears host-scheduled
messages, stops JUCE output threads, and destroys handlers. Runtime reconnect
close also uses `ClearSinkSync` rather than an unsynchronized null assignment.

## Timing-Tolerance Evidence

Task 1/2 mapper and PLL arithmetic is unchanged. Existing clock tests continue
to prove exact half-open plan ownership, fractional inverse mapping, exact
adjacent anchors, 500-ppm mapper slew cap, discontinuity generation, transition
splice fill, and analytical crossing limits. Output latency remains exactly
`max(2 * negotiated block duration, 5 ms)`; the 48-kHz/64-frame test remains
exactly `5,000 us`.

The concrete MasterClock-to-MidiSender test delivers internal clock deadlines
at exactly `1,750,000` and `2,000,000 us`: deadline error is `0 us` (within
`<=1 us`) and spacing error is `0 us` (within `<=2 us`, before any bounded
500-ppm mapper contribution). The concrete external regeneration test delivers
Continue then clock at `1,210,000 us`, followed by clock at `1,230,833 us`:
the regenerated offset from the original `1,010,000 us` timestamp is exactly
`200,000 us` (error `0 us`), the next 24-PPQN spacing is `20,833 us`, and there
is no transition clock hole. Sender fallback tests make late delivery
observable while retaining the producer's original due time.

These are deterministic computed-deadline and adapter-boundary assertions, not
claims about physical device jitter.

## Deviations and Remaining Boundary

- The host submission lead is a documented fixed `1,000 us`; Task 1/2's
  minimum `5,000 us` output lookahead leaves the worker time to reach it.
- No Task 1/2 mapper, PLL, crossing, generation, or latency formula changed.
- No Task 5 browser `dueTimeMicros` protocol, Web MIDI timestamp argument, or
  TypeScript worker/audio transport was added. Browser outputs remain
  compatible immediate-only sinks and therefore use the lower-quality
  worker-wait fallback until Task 5.
- No Task 6 Sync page or Task 7 MiniApp/Braid behavior was implemented.
