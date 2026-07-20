# Master Clock And MIDI Sync Contracts

This document describes the runtime contract implemented by `MasterClock`,
`Engine`, realtime MIDI input, `MidiSender`, and the JUCE and browser adapters.
It distinguishes sample/deadline calculation guarantees from host submission
and physical MIDI-device quality.

## Ownership And The Audio-Block Contract

`Engine<App>` owns exactly one JUCE-free, address-stable `MasterClock`. The
engine publishes its address through `AppContext` before `App::Init`; host
prepare later supplies the negotiated output sample rate and block size. The
object remains alive through audio shutdown.

For each non-empty contiguous audio callback, Engine performs this order:

1. apply the latest coherent sync-config request;
2. drain patch input, then due UI and MIDI input;
3. collect clock and transport input in one fixed-capacity timestamp-ordered
   batch and route it to `MasterClock`;
4. commit one immutable affine `ClockBlockPlan` for the half-open output range
   `[block.startSample, block.startSample + block.numFrames)`;
5. analytically enqueue enabled clock crossings; and
6. invoke the optional once-per-block control hook and the application's
   `ProcessBlock` exactly once.

During `ProcessBlock`, `AudioBlock::clockPlan` is the same object returned by
`MasterClock::CurrentPlan()`. It remains valid and immutable for that callback;
the next successful commit replaces the pointed-to plan. Applications must
null-check it and must not retain it as an immutable snapshot across callbacks.

A plan contains start/end samples, lifetime and current-run transport anchors,
one finite-positive quarter-notes-per-output-sample increment, transport state,
transport epoch, and phase generation. A query at output position `s` is the
direct affine calculation

```text
anchor + (s - blockStart) * quarterNotesPerOutputSample
```

There is no clock phase buffer and no runtime per-sample callback. Applications
query integer or fractional output positions inside the half-open range. For an
application running at 4x, internal subframe `k` maps to
`block.startSample + k / 4.0`; the runtime is not told the oversampling factor.
The next ordinary plan starts at the prior plan's exact mathematical endpoint.
A block-boundary tempo change therefore changes only the future slope, while
lifetime time remains continuous and discrete sample queries remain strictly
increasing.

## Lifetime, Transport, And Tempo Authority

Lifetime quarter-note time starts at zero and advances with every committed
plan, including while transport is stopped or armed. Transport time is elapsed
time for the current run, not MIDI song position. Its states are `Stopped`,
`ArmedStart`, `ArmedContinue`, and `Running`:

- Internal Start or Continue with receive-clock disabled activates at the next
  committed block boundary, starts a new current-run phase at zero, and emits
  an explicit time-zero clock when clock send is enabled.
- With receive-clock enabled, Start and Continue arm transport. The first
  accepted external Timing Clock activates the run at its original normalized
  timestamp and is tick zero, not tick one. The next plan projects phase from
  that timestamp to its block start.
- Stop takes effect in the next app-visible plan, returns transport time to
  zero, and does not reset lifetime time.
- Continue remains MIDI `FB` on the wire, but Sheaf starts a new current-run
  phase at zero. Song Position Pointer and retained song-position resume are
  intentionally out of scope.

Manual tempo is stored separately from external authority. The core accepts
finite positive manual BPM; MiniApp exposes the narrower 30--300 BPM control.
When receive-clock is enabled, application tempo requests report rejection and
do not disturb the estimator. Disabling receive-clock restores the last
accepted manual tempo without resetting either accumulator.

## Realtime Input, Gates, And Source Ownership

Every controller chain ends with `RealtimeMidiInProcessor`, after all
profile-specific processors. Exact one-byte `F8`, `FA`, `FB`, and `FC` messages
become Clock, Start, Continue, and Stop `MessageIn` values with ExternalMidi
origin, the original normalized unsigned-microsecond timestamp, and controller
slot. They require no controller mapping. Other MIDI retains its existing
profile/thru behavior.

The four independent gates are:

- send clock;
- receive clock;
- send transport; and
- receive transport.

Receive gates affect only external MIDI. Internal UI transport remains active
when receive-transport is off. Send gates affect bytes leaving the runtime, not
local state changes. While stopped or armed, outgoing clock follows lifetime
phase; while running it follows transport phase. Send plus receive regenerates
clock from the disciplined internal phase instead of echoing incoming jitter.

The first accepted external clock claims its controller slot. An external
Start or Continue may provisionally claim a slot until its first clock. Clocks
and transport from foreign slots are ignored while the owner is healthy. The
owner times out after the larger of 500 ms or four estimated pulse periods;
transport and accumulated time continue, the last tempo free-runs, and the next
valid source may take over without an accumulator jump.

## External Tempo And Phase Recovery

The input estimator is a bounded digital PLL with fixed policy constants:

- the first clock anchors phase while retaining the prior tempo;
- a first positive interval seeds pulse period;
- later deltas infer one through eight elapsed pulses when the normalized
  interval is within 25 percent of the estimate;
- non-positive, duplicate, out-of-order, and implausibly early observations are
  ignored;
- the latest five normalized intervals supply a median observation;
- period follows that median with `1/8` EWMA gain;
- BPM is `60 / (PPQN * periodSeconds)`;
- one quarter of measured phase error, capped at one quarter pulse period,
  may adjust only a future positive plan slope; and
- error beyond two pulse periods or source reacquisition re-seeds target phase
  without rewriting a committed plan or moving its next anchor.

After 64 valid exact 24-PPQN intervals at 120 BPM, deterministic tests require
recovered tempo error no greater than 0.1 BPM. Clock loss changes diagnostics to
FreeRun but does not stop transport or outgoing regenerated clock.

## Timestamp Epochs And Sample-Time Mapping

Core timestamps are unsigned integer microseconds in one host-local monotonic
epoch. Domains are normalized only at host boundaries:

- JUCE Runtime defines engine zero from its `steady_clock` start. A captured
  `RuntimeMidiEpoch` converts JUCE/device callback timestamps into that epoch
  and converts scheduled engine deadlines back to JUCE's millisecond domain.
- Browser engine timestamps are microseconds relative to
  `performance.timeOrigin`. The document and worker time origins are aligned
  before runtime initialization; `performance.now()`, `emscripten_get_now()`,
  Web MIDI `event.timeStamp`, worker records, and engine deadlines then share
  that origin. Conversion to `DOMHighResTimeStamp` milliseconds occurs only at
  `MIDIOutput.send(bytes, dueTimeMicros / 1000)`.

`AudioSampleTimeMapper` maps absolute output samples into that epoch. Its
nominal period is `1,000,000 / sampleRate` microseconds per output sample. Each
callback timestamp is a noisy phase observation, not a replacement event
time. The mapper keeps five phase errors, uses their median, filters the median
with `1/32` EWMA gain, and changes only future slopes, capped at `+-500 ppm`
from nominal. Ordinary segment starts equal the prior mathematical endpoint
exactly.

An observation whose error exceeds output lookahead is a discontinuity. The
mapper clears phase history, invalidates affected future events, increments
late/discontinuity diagnostics, advances the mapping generation, and begins at
`max(observedTimestamp, priorMathematicalEnd)`. It is not hidden as ordinary
callback jitter.

## Crossing And Deadline Calculation

`MasterClock` analytically solves configured-PPQN crossings in each affine
segment. Its owned `Phasor2Tick` is the priming and last-cell authority; it is
fed candidate boundaries, never every audio sample. Half-open ownership means a
crossing at one plan's end belongs only to the following plan.

Start and Continue begin a new phase generation at activation. Generation
invalidation retains old-grid events before the exact cutoff and drops old-grid
events at or after it. Transport is ordered before its equal-deadline time-zero
clock. Stop changes back to lifetime phase, primes at the switch, emits no
immediate extra clock, and resumes at the next lifetime boundary. Delayed
external transitions inside an already-rendered plan leave the app plan
unchanged and use an output-only affine splice from the original event
timestamp.

Base output lookahead is

```text
ceil(max(2 * negotiated output-block duration, 5 ms))
```

A host scheduling horizon is additive before prepare. The browser adds 25 ms
because its main-thread output drain normally runs on a 16 ms cadence. The
extra horizon increases the fixed offset used to calculate deadlines; it does
not allow browser poll time or sender wake time to replace an event's stored
deadline.

For exact fractional crossings and normalized input timestamps, deterministic
calculation tests require:

- crossing-to-integer-deadline error `<= 1 us`;
- inter-tick spacing error `<= 2 us` plus the separately calculated
  contribution of the mapper's `500 ppm` future-slope bound; and
- regenerated fixed-offset error `<= 1 us`.

These are computed-deadline guarantees before host delivery. They are not
claims of one-microsecond thread wake-up, host scheduler, cable, or physical
device accuracy.

## Output Delivery And Fallback Quality

The audio producer writes scheduled events into `MidiSender`'s fixed-capacity
SPSC lane. `TryEnqueue` performs no allocation, mutex acquisition, wait, sleep,
or I/O; overflow drops the newest event and increments a counter. The separate
mutex-backed feedback queue retains controller-specific immediate output.

The sender worker orders scheduled events by deadline, then generation cutoff,
transport, clock, and sequence. For timestamp-capable outputs it snapshots all
currently registered sinks when the event reaches the maximum advertised sink
lead, and submits the same original deadline to each. Offline outputs are
skipped. A reconnect receives only events snapshotted afterward and never a
replay of stale clock.

JUCE advertises a default 1 ms scheduling lead. Scheduled output uses its
background/timestamped `sendBlockOfMessages` path; `sendMessageNow` remains only
for immediate feedback. Browser outputs advertise 25 ms and preserve
`dueTimeMicros` until Web MIDI `send(bytes, timestamp)` on the browser main
thread.

An immediate-only sink is an explicit lower-quality lane. The sender worker,
not the audio thread, waits until the due time and calls immediate `Send`.
Fallback and late counters make that degradation observable. A host-timestamped
submission can still be delivered late by an OS or device; actual lateness is
diagnostic data, separate from deadline calculation.

## Thread Responsibilities

- **Audio callback / browser audio worklet:** drains due control messages,
  applies the audio-safe sync word, commits the plan, enqueues analytical
  crossings, runs application DSP, and publishes lock-free diagnostics. It
  does no MIDI I/O, sleeping, or sender/host locking.
- **JUCE MIDI input callback or browser input bridge:** normalizes timestamp
  epochs and produces bounded `MessageIn` records. It does not mutate
  `MasterClock` directly.
- **UI/message producer:** stages Sync page edits, timestamps internal actions
  from the shared provider, requests one coherent config update, saves runtime
  configuration on Back, and reads only published UI diagnostics.
- **MidiSender worker:** drains the fixed realtime lane, applies cutoffs,
  prioritizes deadlines, snapshots sinks, waits only for fallback deadlines,
  and invokes host output adapters.
- **JUCE MIDI output background thread:** owns JUCE's eventual timestamped
  output delivery after the sender submits a future one-event buffer.
- **Browser main thread:** owns Web MIDI port lifecycle, bounded output drains,
  `MIDIOutput.send`, portable UI rendering/actions, and bridge diagnostics. The
  audio worklet never calls Web MIDI.

The no-lock boundary is specifically the audio producer to `MidiSender` SPSC
lane and the engine's lock-free diagnostic publication. Host adapters and UI
code may lock or allocate only after work has left the audio path.

## Persistence, UI, And Operator Diagnostics

Runtime config schema v2 owns one `sync` object containing the four booleans
and PPQN. Schema-v1 documents supply defaults and are written as v2 on the next
save. Invalid v2 fields reject the whole runtime document without partially
changing MIDI instrument, audio-device, or sync state. Patches exclude sync.

Defaults are all four gates off and PPQN 24. PPQN `1..960` is valid. MIDI
Timing Clock is conventionally 24 PPQN and an `F8` byte carries no resolution,
so any other value is a nonstandard agreement that requires every peer to use
the same pulse density.

The portable Sync page shows current BPM, Internal/Acquiring/Locked/FreeRun
state, active controller name when present, derived output latency, ignored
input, late-event, and dropped-output counts. From these an operator can tell
whether external ownership exists, whether acquisition is stable or free-run,
whether the configured block/horizon is adding latency, and whether input or
output pressure is degrading service. Sender and browser bridge snapshots add
fallback, stale-generation, queue-drop, and host-drain lateness detail for
adapter diagnostics; they do not turn physical delivery into a calculation
guarantee.
