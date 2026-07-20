# Synth Master Clock/MIDI Sync — Task 5 Implementer Report

## Summary and Commit Range

Implemented the browser MIDI-clock delivery boundary from exact base:

- base: `393c989fb9275f2bfab120e6d626552da1f54fe1`
- implementation head: `3b02f32faed811d7b0b7e694b89789838e64e5ee`
- implementation commit: `feat(synth): preserve browser MIDI deadlines`
- task head: the metadata-only commit containing this report (its hash cannot
  be embedded in its own contents without changing that hash)

The browser runtime now carries scheduled transport/clock deadlines unchanged
from the C++ sender through a fixed Wasm ABI record and submits them through the
timestamped Web MIDI overload. Immediate controller feedback retains the
timestamp-less path. The bridge has independent bounded scheduled/immediate
availability lanes, scheduled priority, newest-drop policy, disconnect purge,
and ABI-visible diagnostics.

The reviewed implementation also adds the required cross-thread timing budget:
browser sinks request a 25,000 us host scheduling lead, `MidiSender` wakes and
snapshots at the maximum live host-capable sink lead, and browser
`MasterClock::Prepare` adds that horizon after the complete existing base
latency. At 48 kHz/128 frames the result is 30,334 us:

```text
ceil(max(2 * 128 / 48000 seconds, 5 ms)) + 25 ms = 30,334 us
```

Dedicated-worker and document `performance.timeOrigin` values are explicitly
aligned before runtime initialization and before the AudioWorklet starts.
Disconnect, replacement, stop, disconnected-state checks, and Web MIDI
`send()`/`clear()` exceptions are contained in the browser host.

No JUCE adapter behavior changed; its default 1,000 us host lead remains source
compatible.

## Paths

Implementation and tests commit (`3b02f32f`):

- `projects/synth/browser/Makefile`
- `projects/synth/browser/cpp/BrowserRuntimeAbi.cpp`
- `projects/synth/browser/src/main.ts`
- `projects/synth/browser/src/midi.ts`
- `projects/synth/browser/src/protocol.ts`
- `projects/synth/browser/src/worker.ts`
- `projects/synth/browser/tests/midi-flow.spec.ts`
- `projects/synth/browser/tests/midi-timing.test.mjs`
- `projects/synth/browser/tests/runtime-core.spec.ts`
- `projects/synth/include/synth/MasterClock.hpp`
- `projects/synth/include/synth/MidiController.hpp`
- `projects/synth/include/synth/browser/BrowserMidiBridge.hpp`
- `projects/synth/include/synth/browser/BrowserRuntime.hpp`
- `projects/synth/src/MasterClock.cpp`
- `projects/synth/src/MidiController.cpp`
- `projects/synth/tests/browser_midi_bridge_tests.cpp`
- `projects/synth/tests/browser_runtime_contract_tests.cpp`
- `projects/synth/tests/master_clock_tests.cpp`
- `projects/synth/tests/midi_sender_tests.cpp`

This metadata-only follow-up contains only:

- `.superpowers/sdd/master-clock-task-5-report.md`

The parent-owned progress ledger and untracked Task 5 brief, browser lockfile,
and `projects/synth/miniapp/` tree were not edited or staged.

## Semantics Checkpoint

The accepted review-fix design was:

- browser scheduling horizon: 25,000 us, exceeding the 16 ms drain cadence by
  9 ms while remaining close to the physical deadline;
- backward-compatible `IMidiOutputSink::SchedulingLeadMicros()`, defaulting to
  1,000 us, with the browser sink overriding 25,000 us;
- one maximum lead across live host-timestamped sinks; all production sinks in
  one runtime share one host epoch;
- sender consumption of the complete realtime lane, including generation
  cutoffs, before any horizon-ready sink snapshot;
- additive latency `max(2 * block duration, 5 ms) + host horizon`, never a
  replacement of the two-block transition/cutoff margin;
- Web MIDI `clear()` on close, replacement, and stop, plus a connected-state
  check immediately before submission and contained host exceptions;
- fixed 24-byte diagnostics ABI exposing both bridge-lane drops and bridge
  late availability; browser diagnostics additionally expose timer lateness and
  send/clear failures;
- signed worker-to-document time-origin offset established at create time and
  applied to the initial AudioWorklet timestamp; direct-window operation uses
  zero offset.

## RED Evidence

The initial browser tests were introduced before the first production changes.
The focused native/browser build failed on the absent scheduled delivery and
deadline contracts, while the browser timing tests failed because output used
only immediate `send(bytes)` and no normalized absolute deadline was available.

Independent review then identified four missing architectural seams: the
Task 4 sender's 1 ms lead could not cross a 16 ms browser drain cadence, worker
and document time origins could differ, already-submitted Web MIDI events were
not canceled on disconnect, and bridge diagnostics stopped at the C++ boundary.
Strict tests for those findings were added before their fixes.

Sender/clock review RED:

```text
make -C projects/synth -B build/midi_sender_tests build/master_clock_tests
```

Exited nonzero. `RecordingSink::SchedulingLeadMicros() ... override` failed
because the base interface had no virtual lead contract. An isolated master
clock build failed because `MasterClock` had no output-scheduling-horizon setter
or accessor.

Browser review RED:

```text
cd projects/synth/browser
npm run build
node --test dist/tests/midi-timing.test.mjs
```

TypeScript built, then Node reported 1 pass and 4 failures:

- diagnostics returned only `{ lateScheduledOutputCount: 2 }` instead of the
  combined bridge/JavaScript record;
- disconnect expected one Web MIDI `clear()` call and observed zero;
- `emscriptenRuntimeFacade(...).midiDiagnostics` did not exist;
- a 250,000 us worker/document epoch difference produced no runtime offset.

These were missing product behaviors; no expectation was weakened to obtain
GREEN.

## GREEN and Verification Evidence

Focused forced native build and run:

```text
make -C projects/synth -B \
  build/midi_sender_tests build/master_clock_tests \
  build/browser_midi_bridge_tests build/browser_runtime_contract_tests
projects/synth/build/midi_sender_tests
projects/synth/build/master_clock_tests
projects/synth/build/browser_midi_bridge_tests
projects/synth/build/browser_runtime_contract_tests
```

Exit `0`, warning-free under C++20 `-Wall -Wextra -Wpedantic`. Coverage includes
mixed/max sink lead, registration wake, cutoff-before-snapshot, additive
30,334 us latency and overflow rejection, browser runtime horizon wiring,
stopped-clock scheduled output, bounded lanes, reconnect purge, diagnostics
layout, and signed epoch-offset retention.

Browser unit and generic-runtime gates:

```text
cd projects/synth/browser
npm run build
node --test dist/tests/*.test.mjs
npm run check:generic-runtime
```

Exit `0`; all 12 Node tests passed. The timing suite proves relative, legacy
absolute, and invalid input timestamp normalization; stored Web MIDI deadlines;
immediate compatibility; disconnect clearing; contained send/clear failures;
24-byte output and diagnostics decoding; and a 250,000 us worker-origin offset.

Both real Wasm applications rebuilt with the new exports:

```text
make -C projects/synth/browser browser-fake-app browser-miniapp
```

Exit `0`. The builds include `_synth_browser_set_timestamp_epoch_offset` and
`_synth_browser_midi_diagnostics` alongside the scheduled-output descriptor.

Full core regression:

```text
make -C projects/synth test
```

Exit `0`; the entire synth core suite passed, including all five Braid deadline
cases and all new sender/clock tests.

Full browser regression used current-worktree assets on isolated alternate
ports because PID 79179 from another worktree already owned canonical ports
4173/4174 and was deliberately not disturbed. A local HTTP/CONNECT proxy kept
the tests' canonical URLs unchanged. After correcting the temporary server to
match the repository server's isolation and permissions headers:

```text
npx playwright test --config=/private/tmp/sheaf-clock-playwright.config.mjs
```

Exit `0`; all 67 Playwright tests passed in 6.1 seconds. This includes real
fake-app and miniapp Wasm, runtime-owned AudioWorklet tests, worker-origin
alignment, timestamped Web MIDI scheduling, multi-controller reconnect, and the
complete generic browser regression. The first isolated attempt's two failures
were solely missing headers in that temporary test server; the affected tests
and then the complete suite passed after the fixture matched production.
Playwright-generated tracked screenshot changes were restored afterward.

Specification and scope checks:

```text
openspec validate add-synth-master-clock-midi-sync --strict
git diff --check
git diff --cached --check
git diff --name-status 393c989f..3b02f32f
```

All exited `0`. OpenSpec reported the change valid, and the exact-base audit
contained exactly the 19 implementation/test paths listed above.

## Requirement Evidence

### Deadline-preserving browser output

`BrowserMidiBridge` records controller index, bytes, immediate/scheduled
delivery, and the original absolute due time. Its independent 256-entry queues
give scheduled traffic dequeue priority without allowing feedback bursts to
consume clock availability. Each lane drops newest on overflow and reports the
drop. `MidiOutputDescriptor` remains a fixed Wasm32 24-byte record, and the
TypeScript facade rejects invalid delivery tags or deadlines outside the safe
integer range.

`BrowserMidiManager` calls `MIDIOutput.send(bytes, dueTimeMicros / 1000)` for
scheduled records and `send(bytes)` for feedback. It drains at most 256 records
per pass, coalesces overlapping drain requests, and separately counts browser
timer lateness.

### Scheduling margin and invalidation

The sender caches each registered sink's scheduling capability and requested
lead outside its realtime producer. Its worker uses the maximum live
host-timestamped lead and is explicitly awakened when sink registration changes.
It always drains the whole SPSC realtime lane before selecting the pending
front, so a cutoff published with a horizon-ready old-generation event removes
that event before any sink generation is captured.

The browser clock horizon is added only after the complete base handoff margin.
Because the base is at least two blocks, transition/cutoff production can consume
one worst-case block and still leave one complete block before the sender's
browser snapshot boundary. Overflow in the additive integer calculation rejects
`Prepare` transactionally.

### Epoch alignment

The document sends `performance.timeOrigin` with the create command. The worker
uses an injected provider for its own origin, validates the values and signed
microsecond difference, and passes that difference through a BigInt C ABI before
runtime initialization. C++ applies the signed offset with saturating arithmetic
to the initial `emscripten_get_now()` AudioWorklet timestamp. All later callback
timestamps advance from that aligned value. Direct-window execution naturally
supplies a zero difference.

### Disconnect and diagnostics

The C++ bridge clears both availability lanes for a closed controller and the
sender invalidates the old sink registration generation. The browser host also
calls Web MIDI `clear()` for close, replacement, and stop, preventing events
already submitted to the browser scheduler from firing after disconnect. A port
whose state changed to disconnected between reconciliation and send is skipped;
`send()` and `clear()` exceptions do not escape the manager.

`MidiDiagnosticsDescriptor` is a fixed 24-byte C ABI record for immediate drops,
scheduled drops, and bridge late availability. The worker command/facade exposes
it to the manager, whose snapshot combines those values with JavaScript timer
lateness and send/clear errors.

## Realtime and Concurrency Analysis

- The audio-side `MidiSender::TryEnqueue` path is unchanged: fixed SPSC storage,
  no mutex, allocation, wait, sleep, host call, or throw.
- Sink capability/lead discovery happens during registration, outside the sender
  mutex; the worker reads cached scalar values under the existing mutex.
- Set/clear increments a mutex-protected wake generation. This makes condition-
  variable notification observable even when no new queue record arrives, so a
  newly registered long-lead sink cannot remain asleep until the old deadline.
- The worker owns the fixed pending array and drains every newly published event
  and cutoff before snapshotting. Sink sends still execute outside the mutex and
  retain per-slot in-flight destruction synchronization.
- Browser output queues are bounded independently and protected by their bridge
  mutex. Web MIDI calls occur only in JavaScript, never on the audio thread or
  C++ sender worker.

## Risks and Deliberate Limits

- A 25 ms submission horizon covers the normal 16 ms drain cadence plus 9 ms of
  task jitter; a severely throttled/background browser can still miss it. Both
  bridge and browser lateness are observable rather than silently rewritten.
- Web MIDI `clear()` is best-effort at the host API boundary. Exceptions are
  contained and counted; the C++ availability and registration generations are
  still purged deterministically.
- JavaScript numbers cannot exactly represent the full `uint64_t` domain. ABI
  decoding rejects unsafe deadlines/counters instead of silently rounding them.
