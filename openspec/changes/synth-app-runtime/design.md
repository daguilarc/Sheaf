# Design: synth-app-runtime

## Context

The synth library today is four JUCE-free subsystems (parameter/modulation,
MIDI controller IO + profiles, DSP/modules, patch persistence) plus a
JUCE-dependent widget layer (`projects/synth/juce`) and one consumer, the
miniapp. Research findings that drive this design:

- `Main.cpp` is ~815 lines, of which the clear majority is generic harness:
  manager/bus/patch-manager construction, the `processParameterMessages` /
  `processPatchMessages` / `ProcessResponses` drain loops, MIDI device
  combo-box management, `rebuildMidiProcessors()`, `MidiSender` start/stop,
  and an eleven-step 30 Hz timer pump. Only the parameter set, module wiring,
  page/bank layout, LFO math, and widget layout are app content.
- **No audio device is ever opened.** DSP runs synchronously inside the UI
  timer; sample rate is whatever `DualWavetableVcoModule` defaults to
  (48 kHz); "block size" is a local constant. There is no config object for
  sample rate or channel counts anywhere.
- The library was visibly designed for an audio-thread-owned manager even
  though the miniapp never exercises it: `MessageInBus` and the patch buses
  are SPSC rings whose consumer applies to the manager; `ParameterMessageOutBus`
  carries storage-growth requests *from* the hot thread *to* the message
  thread; arena JSON is documented audio-thread-safe with grow-and-retry
  owned by the message thread; `Parameter::Get`/`ProcessLite` are specced as
  the allocation-free audio path (spm-11).
- The sibling project (The All Electric Smart Grid,
  `/Users/joyo/theallelectricsmartgrid`) solves "one core, multiple
  front-ends" with hand-written wrapper structs, not templates, so there is no
  runtime template to copy — but three of its patterns inform this design:
  the JUCE-free-core boundary enforced as a testable invariant, `ThreadId`
  thread-local tagging with a `ScopedThreadId` RAII guard for cheap
  thread-ownership assertions, and the `IoTaskThread` request/ack queue pair
  (noted as future work for patch IO, not adopted now).
- The Smart Grid's async logging system (`private/src/AsyncLogger.hpp`,
  specced there as `thread-aware-async-logging`) is being ported in this
  change. Notably, despite the "logger thread" framing, **it has no dedicated
  thread**: `AsyncLogQueue` is a passive component — one lock-free
  `CircularQueue<LogMessage, 16384>` per `ThreadId`, a producer `Log()` that
  formats via `snprintf` into a fixed 256-byte POD slot on the calling thread
  (no locks, no allocation, no IO; on overflow it drops and bumps an atomic
  per-thread missed counter), and a `DoLog()` drain that the app calls from
  its 60 Hz UI timer, round-robining queues and writing each line to stdout
  and a per-session timestamped log file. The producer side is what makes
  `INFO(...)` audio-thread-safe. Its only dependencies are `CircularQueue`,
  `ThreadId`, and one `SampleTimer::GetSample()` call for sample-accurate
  stamps.
- The synth side has no logging today beyond the miniapp's ad hoc
  `appendPatchLog`, which opens a fresh `std::ofstream` per line on the
  message thread — unusable from the audio thread and to be replaced.
- The Smart Grid's whole-system test harness is
  `private/test/support/SynthRig.hpp` (`synthrig::SynthRig`, API explicitly
  frozen): it constructs the full JUCE-free core plus a real IO worker
  thread, drives time via `RunSamples`/`RunFrames`/`RunSeconds` in a loop
  that **hand-replicates** production's `NonagonWrapper::Process` sequence,
  injects encoder/pad/scene/shift verbs as real `MessageIn` values through
  the production bus/routing layer, captures every output sample with sticky
  NaN/Inf and peak scanning, and orchestrates patch save/load by polling the
  state-interchange across frames. System tests (scenes, gestures, seeded
  18-action fuzzing with env-var soak mode, patch round-trips) all go
  through this single front door, with per-test global reset
  (`GlobalEnv::ResetPerTest` reseeding static RNGs and the sample clock).
- The synth repo has no such harness. Its strongest tests are the
  spm-18/spm-25 randomized simulations in
  `tests/parameter_modulation_tests.cpp`: seeded action streams applied
  twice — once to the real manager, once to a hand-written `SimOracle`
  model — with field-by-field comparison. That oracle style is
  complementary to a rig (it checks the parameter graph against independent
  math; it never advances sample time, produces audio, or exercises bus
  routing). `miniapp/DemoModulationTests.cpp` is a single-shot math smoke
  test. Neither drives an assembled system.
- No preamplifier/gain-stage manager exists in the framework; the context
  object carries the managers that exist today and is designed to grow.

## Goals / Non-Goals

**Goals:**

- An application is one directory containing only code that defines what the
  app does: a struct with `Init(AppContext*)`, `ProcessBlock`, a UI hook, and
  a `RuntimeConfig`; everything else is runtime.
- A `Runtime<App>` template that constructs the app and all framework objects
  in a correct, specced order and runs the whole system: startup patch load,
  audio callback, MIDI devices, patch commands, message pumps, window.
- A real audio device path with a JUCE-free block view, negotiated sample
  rate/block size, and a real-time-safe thread-ownership model.
- One logging interface, `INFO(...)`, safe to call from any project thread
  including the audio thread, ported from the Smart Grid's async logging
  system and integrated into the runtime (directory config, drain, thread
  tagging), replacing all ad hoc logging.
- A headless, JUCE-free system-test harness in the spirit of the Smart
  Grid's `SynthRig` — but executing the *same* engine code the runtime
  ships, so the harness cannot drift from production — able to host an
  application core, drive blocks deterministically, inject messages through
  the real routing layers, and assert output invariants.
- The miniapp ported onto the runtime with behavior parity (all existing
  spm/spp/smod/sdsp miniapp scenarios keep passing) plus audible output.

**Non-Goals:**

- No plugin (AU/VST3) target — standalone JUCE apps only, as today.
- No background IO thread for patch reads/writes (Smart Grid's
  `IoTaskThread`/`StateInterchange` pattern is future work; v1 accepts the
  existing synchronous file IO on the message thread and block-boundary patch
  application on the audio thread).
- No new DSP, module, parameter, MIDI-mapping, or persistence behavior — the
  library contracts are consumed, not changed.
- No multi-window or patch-browser UI beyond the chrome the miniapp already
  has.
- No log severity levels, categories, runtime enable/disable switches, or
  in-session log rotation — the ported logger keeps its single `INFO` level
  with `ThreadId` tagging, matching the source system's scope.
- Nothing else imported from The All Electric Smart Grid codebase beyond the
  logging port (the IO task thread and `StateInterchange` remain future
  work).

## Decisions

### D1 — `Runtime<App>` class template with a compile-time application concept

The runtime is `template <SynthApplication App> class synth_runtime::Runtime`,
not a virtual base class. Two C++20 concepts check the interface:
`SynthApplicationCore` (`Config`, `Init`, `ProcessBlock` — everything
JUCE-free) and `SynthApplication` (core plus the UI-component hook). The
JUCE runtime requires the full concept; the headless engine and test rig
(D11) require only the core, which is what lets an application's core be
hosted and tested without JUCE. Both produce readable errors at the point of
instantiation; optional hooks (e.g. `PrepareToPlay`, `ProcessFrame`) are
detected with `if constexpr` + `requires`, so minimal apps stay minimal. Rationale: matches the requested
"runtime template parameterized on the application type", avoids virtual
dispatch inside the per-block audio path, and lets the runtime hold the app
by value (no heap, no ownership questions). Alternative considered: abstract
`IApplication` base — simpler to document, but forces every optional hook to
be a virtual with a default body and makes the app's concrete type invisible
to the runtime; rejected.

Entry point: a `SYNTH_RUNTIME_MAIN(MiniApp)` macro expands to the JUCE
application/window boilerplate (`START_JUCE_APPLICATION` wrapper) so an app's
`Main.cpp` is a handful of lines.

### D2 — Layout: JUCE-free contract headers, JUCE-dependent runtime, apps directory

- `projects/synth/include/synth/AppContext.hpp` (JUCE-free, namespace
  `synth`): `RuntimeConfig`, `AppContext`, `AudioBlock`. These sit in the core
  library so an application's DSP/parameter logic — and its unit tests — can
  compile without JUCE, same discipline as `DemoModulationTests.cpp` today.
- `projects/synth/runtime/` (JUCE-dependent, namespace `synth_runtime`):
  `Runtime.hpp` plus support headers (audio callback adapter, runtime shell
  component, MIDI device panel). Header-only like the existing `juce/`
  directory.
- `projects/synth/apps/<app>/` for applications; `projects/synth/apps/miniapp`
  is the first. Shared JUCE-module compilation rules move from the old
  miniapp Makefile into `projects/synth/runtime/juce_build.mk`, included by
  each app Makefile; `make miniapp` from `projects/synth` keeps working.

The JUCE-free boundary stays enforced the way the repo already does it:
JUCE-free test binaries compiled without JUCE include paths that `#error` on
`JUCE_MAJOR_VERSION` (Smart Grid enforces the same invariant at spec level;
we adopt the spec scenario, reusing the existing test mechanism).

### D3 — `AppContext`: non-owning pointers to everything the app may touch

```cpp
namespace synth {
struct AppContext {
    ParameterManager* parameterManager;
    PatchManager* patchManager;
    MessageInBus* uiBus;                    // producer: message thread
    MessageInBus* midiBus;                  // producer: MIDI callback thread
    ParameterMessageOutBus* parameterMessageOutBus;
    PatchMessageInBus* patchInputBus;
    MessageOutBus* patchOutputBus;
    MidiSender* midiSender;
    MidiControllerProfileConfig* midiProfileConfig;        // live profile
    const MidiControllerProfileConfig* defaultMidiProfileConfig;
    const RuntimeConfig* config;
    ParameterManager::UIState* uiState;     // null during Init; set before UI/audio start
    // grows as new managers (e.g. a future preamp/input-stage manager) appear
};
}
```

All pointers are non-owning and address-stable for the application's
lifetime; the runtime owns the pointees. `uiState` is the one late-bound
member: `CreateUIState()` must run after topology is final, so it is null
during `Init` and populated before MIDI processors, audio, or UI start.
Alternative considered: passing owning references piecemeal to each hook —
rejected; a single context pointer is the requested shape and gives bespoke
app UI/widgets one thing to hold.

### D4 — `RuntimeConfig` supplied by the app; device negotiation reported back

```cpp
struct RuntimeConfig {
    std::string appName;
    int numAudioInputs = 0;
    int numAudioOutputs = 2;
    double preferredSampleRate = 48000.0;
    int preferredBlockSize = 256;
    std::filesystem::path patchesRoot;      // patch directories live here
    std::filesystem::path logsRoot;         // session log files; empty = stdout only
    int uiWidth = 900, uiHeight = 560;
    int uiFrameHz = 30;
};
```

Apps expose `static RuntimeConfig Config()`; the runtime treats it as a
request and negotiates with the actual JUCE audio device. The negotiated
values are delivered through the app hook
`PrepareToPlay(double sampleRate, int blockSize)` (called before audio starts
and again on device changes), which is where the miniapp forwards the rate to
`DualWavetableVcoModule::SetSampleRate`. Rationale: nothing in the framework
is sample-rate aware except modules, so pushing the negotiated rate through
one app hook keeps the library untouched. Alternative: a global
`SampleTimer`-style singleton as in Smart Grid — explicitly rejected (its
hardcoded-48kHz singleton is the anti-pattern this change removes).

### D5 — Audio: runtime owns the device and the block pump; app owns all processing

The runtime owns a `juce::AudioDeviceManager` + `AudioIODeviceCallback`
configured from `RuntimeConfig`. The pump below is implemented once in the
JUCE-free `synth::Engine<App>` (D11) and invoked from the device callback.
Per device callback the runtime, in order:

1. Drains `patchInputBus` via `ApplyPatchMessage(...)` (block boundary),
   passing an engine-owned, preallocated `PatchSerializationContext` — the
   current library code heap-allocates an arena per serialization when none
   is supplied (`PatchPersistence.cpp:357`), so the engine must supply one;
   arena growth/retry stays on the message thread per spp-1. Patch commands
   remain a bounded, user-initiated non-real-time exception (see Risks).
2. Calls `uiBus->Process(now)` and `midiBus->Process(now)` — applies queued
   UI/MIDI messages to the manager. Ordering is timestamp-gated *within*
   each bus; across buses, application order is drain order within the
   block (merging two SPSC queue heads for global ordering is not
   attempted).
3. Runs control-rate target computation in a way that preserves slewing:
   `ParameterManager::ComputeAllParameters()` is **unsuitable here** — it
   calls `SnapCurrentToTarget()` after each `Compute`
   (`ParameterModulation.cpp:2104`), which would defeat `ProcessLite`
   smoothing every block. The engine uses a compute-targets-only path (a
   small manager addition, e.g. `ComputeAllTargets()`, mirroring the
   miniapp's current per-parameter `Compute()` calls); snapping remains for
   non-steady-state moments (init, patch load, revert).
4. Wraps the device buffers in a JUCE-free `synth::AudioBlock`
   (`const float* const* inputs / float* const* outputs / counts /
   numFrames`) and calls `app.ProcessBlock(block)` **exactly once per block**.
   The application's `ProcessBlock` owns the per-sample loop:
   `ProcessLite`, module `SetInput`/`Process`, modulation-source updates via
   `UpdateModValues`, scope writes, and writing output samples. The runtime
   never calls `Process` on any module.
5. At a throttled control cadence (~every `uiFrameHz`-th of a second, not
   every block), calls `parameterManager->PopulateUIState(*uiState)` and
   publishes scopes — `UIState` is pre-sized atomics, safe from the audio
   thread.

A shared monotonic timestamp provider (steady-clock based, owned by the
runtime) replaces the miniapp's ad hoc `nextTimestamp_` counter and the MIDI
profile's stub `[]{ return 0; }`, so all messages share one timestamp domain
and each bus applies its own messages in timestamp order under spm-23's
gating (cross-bus order is drain order, as above).

### D6 — Thread ownership model

| Thread | Owns / may touch |
| --- | --- |
| Audio thread | `ParameterManager` mutation and reads after start: bus `Process`, `ApplyPatchMessage`, `ComputeAllParameters`, `ProcessLite`/`Get`/`UpdateModValues` (via app), `PopulateUIState` |
| Message (UI) thread | Producer side of `uiBus` and `patchInputBus`; `PatchManager` commands + `ProcessResponses` (file IO); `ParameterMessageOutBus` drain and `AddParameterStorageBatch` replies; MIDI output processors' `Process()`; MIDI device open/close; UI repaint from `UIState` atomics |
| MIDI callback thread | Producer side of `midiBus` (through `MidiInProcessor` chain) |
| `MidiSender` worker | Draining the sender queue into the JUCE output device |

This respects every documented SPSC contract (one producer, one consumer per
bus) and moves nothing onto the audio thread that allocates unboundedly —
with one accepted exception (patch-load parsing, see Risks). Before audio
starts (during construction, `Init`, and startup-patch application) the
message thread legitimately owns the manager; ownership transfers when the
callback is registered. Thread identity uses the ported `synth::ThreadId`
system (D10): the runtime tags the message thread at startup, tags the audio
and MIDI callbacks with `ScopedThreadId` guards, and the `MidiSender` worker
tags itself in its run loop — the same tags route async-log messages, and
debug builds add ownership assertions at those entry points.

The message thread keeps a low-rate timer for its duties (storage-batch
replies, `ProcessResponses`, MIDI output feedback, repaint, and the log drain
`DoLog()` as its final step) — the same 30 Hz cadence the miniapp uses today,
now containing only message-thread-legal work.

### D7 — Patch and profile orchestration is runtime code

The runtime constructs `PatchManager` wired to the patch buses and exposes
New/Save/SaveAs/Load/Revert both as chrome buttons and as methods apps can
call. Startup: after `Init` and `CaptureDefaultControlState`, the runtime
loads the most recent patch under `config.patchesRoot`, selected by the
library's sortable version-file naming — the directory holding the
lexicographically greatest version filename, ties broken by directory name —
matching the existing version-name-based scan rather than filesystem mtimes
(falling back silently to defaults when none exists, per spp-5). After
consuming a load — including the startup load — the runtime rebuilds MIDI
processors from the loaded profile config and only then reopens persisted
MIDI endpoints (`MidiEndpointState`), so a patched profile is installed
before devices attach — responsibilities the miniapp currently hand-rolls.
Save-as directory naming and version-file handling stay in the library
helpers (spp-3/spp-4); the runtime only orchestrates.

### D8 — UI: runtime shell hosts an app component

The runtime owns the `juce::JUCEApplication`, `DocumentWindow`, and a shell
component containing the generic chrome: patch buttons, MIDI device/profile
panel, status labels. The app provides its content component via a hook
(`juce::Component& App::UIComponent()` — the one JUCE-facing part of an app),
which the shell hosts and resizes. The shell's repaint timer drives both
chrome and app component from `UIState` atomics. App widgets keep pushing
`MessageIn` values to `uiBus` exactly as today (`EncoderComponent::BindMessages`
is unchanged). Rationale: "runtime calls into the application for UI drawing"
without the runtime knowing widget specifics; the miniapp keeps its bespoke
buttons/sliders/encoders/waveform pane inside its own component.

### D10 — Async logging: port the Smart Grid system, drain on the runtime timer

Port the closed set — `AsyncLogger.hpp` (`LogMessage`, `AsyncLogQueue`, the
`INFO(...)` macro and its static instance), the `CircularQueue<T, N>` template
(only the ring buffer; the source file's unrelated `ByteBuffer` types stay
behind), and the `ThreadId` pattern (`enum class ThreadId`, `thread_local`
tag, `GetCurrentThreadId`/`SetCurrentThreadId`, `ScopedThreadId`,
`ThreadIdToString`) — into `projects/synth/include/synth` as JUCE-free core
headers in namespace `synth`, preserving the source semantics: producer-side
`snprintf` into a fixed 256-byte slot, one bounded queue per `ThreadId` (so
every producer is the sole producer of its own queue), drop-with-atomic-missed-
count on overflow, round-robin drain writing `HH:MM:SS <sample> <thread>
<message>` lines to stdout and to one timestamped session file per process
under the configured directory (file writes skipped when unconfigured),
missed counts reported per drain pass. Adaptations, each deliberate:

- **Thread enum is synth's own**: `Message, Audio, MidiInput, MidiSender,
  Unknown` (append-ready for future IO threads) — the queue array is sized by
  this enum, so it must match this framework's thread topology, not the
  source's eleven-thread list.
- **Sample clock hook instead of `SampleTimer`**: the source stamps messages
  via its hardcoded-48kHz `SampleTimer` singleton, which D4 already rejected.
  The logger gets a settable `const std::atomic<uint64_t>*` sample-counter
  source (default null → stamp 0); the runtime owns the counter and advances
  it in the audio callback.
- **No dedicated logger thread**: despite the "logger thread" name, the
  source drains from its 60 Hz UI timer. We keep that shape — the runtime's
  existing message-thread timer calls `DoLog()` last in each tick, after its
  other duties. Alternative considered: a real background drain thread
  (immune to message-thread stalls); rejected for v1 as an extra thread with
  no proven need — the enqueue side, which is what the audio thread touches,
  is identical either way, and the drain driver is one line to swap later.
- **Runtime owns configuration**: `ConfigureLogDirectory` is called from
  runtime startup with `RuntimeConfig.logsRoot`; apps and library code just
  call `INFO(...)`.
- **One interface**: the miniapp's `appendPatchLog` (per-line `ofstream` on
  the message thread) is deleted; runtime patch orchestration logs through
  `INFO`. The port keeps the source invariant of a single production code
  path — the same implementation is exercised by the JUCE-free unit tests
  (via the existing `ResetForTesting`-style hooks) and the runtime.

### D11 — Engine extraction and the SynthRig test harness

The Smart Grid's `SynthRig` proves the shape (single front door, time verbs,
message injection through real routing, sticky output invariants, seeded
fuzzing), but it hand-replicates the production `Process` sequence — a copy
that must be manually kept faithful. We modernize by inverting the
dependency: everything the runtime does that is not JUCE-bound moves into
`synth::Engine<App>` (JUCE-free, `include/synth/Engine.hpp`), and both the
JUCE runtime and the rig execute it.

`Engine<App>` owns: manager, the five buses, patch manager, MIDI sender,
profile configs, the app (by value), the context, and the sample counter. It
exposes the lifecycle (`Initialize()` — the D6 startup sequence minus
device/window/MIDI-device steps; MIDI processor construction from the
profile config is engine code, device open/close is not), a separate
`Prepare(sampleRate, blockSize)` that the host calls after device
negotiation (the runtime with negotiated values, the rig with config
values) and which forwards to the app's prepare hook, the audio-side
pump (`ProcessBlock(AudioBlock&, timestamp)` — D5 steps 1–5), and the
message-side tick (`MessageThreadTick()` — storage-batch replies, patch
manager responses, MIDI output processor polling). The injectable timestamp
provider lives here: the runtime supplies steady-clock time, the rig
supplies block-index-derived deterministic time. `Runtime<App>` shrinks to
the JUCE shell: device manager + callback delegating to
`engine.ProcessBlock`, MIDI device IO wired to the engine's sender/
processors, window/chrome/timer delegating to `engine.MessageThreadTick()`
plus the log drain, thread tagging.

`synth_rig::SynthRig<App>` (`tests/support/SynthRig.hpp`, JUCE-free,
requires only `SynthApplicationCore`) wraps an `Engine<App>` plus test
affordances, borrowing the Smart Grid rig's vocabulary:

- **Time**: `RunBlocks(n)` / `RunSamples(n)` / `RunSeconds(s)` — allocates
  input/output buffers per config, calls `engine.ProcessBlock` with
  deterministic timestamps, then `engine.MessageThreadTick()` each block, so
  both "threads" execute deterministically interleaved on the test thread
  (the rig is single-threaded by design; thread-interleaving bugs are the
  debug-assertion layer's job, not the rig's).
- **Injection**: encoder turn/press/shift verbs and gesture/scene/blend
  setters pushed as `MessageIn` onto the UI bus; `SendMidi(BasicMidi)`
  delivered through the engine's real `MidiInProcessor` chain into the MIDI
  bus — one layer lower than the manager API the oracle sims call, so bus
  routing and profiles get exercised.
- **Observation**: `UIState()` access, parameter reads via the manager,
  `Output()`/`LastOutput()`/`OutputPeak()`/`SawNaN()` with the sticky
  NaN/Inf scan over every output sample (bounded capture ring).
- **Patches**: `SavePatch()`/`LoadPatch()`/`RevertPatch()` helpers that issue
  patch manager commands and pump blocks until the response arrives, per the
  production message flow — bounded by a block budget and returning a
  success/failure/timeout status so a dropped response fails the test
  instead of hanging it.

Determinism needs no `GlobalEnv`-style reset ritual: the library has no
static RNGs or global clock (the D4/D10 decisions keep it that way), so a
fresh rig is a fresh system; seeds enter only through the existing
`SYNTH_RANDOM_SEEDS`-style env conventions when a rig-based fuzz test wants
them. The spm-18/spm-25 oracle simulations stay untouched — they verify the
parameter graph against independent math; the rig verifies the assembled
system end to end. The miniapp splits into a JUCE-free `MiniAppCore`
(config, init, process — hosted by the rig in a headless system test that
modernizes `DemoModulationTests.cpp`'s role) and a thin `MiniApp` adding the
UI component hook for the runtime.

### D12 — Audio device config: patch-persisted selection, message-side patch identity

Added after the initial implementation landed (user direction). Three parts:

- **`AudioDeviceState`** (JUCE-free, `PatchPersistence.hpp`): mirrors
  `MidiEndpointState` — `outputDeviceName` / `inputDeviceName` strings, empty
  meaning "system default". It rides the patch document as an `audioDevice`
  section (spp-2 delta), threads through `BuildPatchJSON`/`LoadPatchJSON`/
  `ApplyPatchMessage` exactly like the MIDI endpoints (live + default pair;
  revert restores the app default), and tolerates absent devices on load the
  way MIDI endpoints do: keep the current device, report status, no failure.
- **Runtime device selection**: an audio-device combo lives with the MIDI
  panel chrome. Selection (message thread) switches the
  `AudioDeviceManager` to the named device, which re-fires
  `audioDeviceAboutToStart` → `engine.Prepare(actual values)`. When a patch
  load (or startup load) carries a device name and that device is present,
  the runtime applies it via the same path, notified from the engine's
  consume side alongside the MIDI rebuild notification. The engine snapshots
  the post-`Init` audio state as the default, like the MIDI profile (D10/D11
  precedent).
- **Patch identity is message-side state**: `PatchManager` already owns
  `CurrentPatchDirectory()` on the message thread; the shell displays the
  current patch name from it and never caches identity elsewhere. Save with
  no current directory does not fail with `NeedsSaveAsPath` at the UI — the
  shell falls through to the Save As chooser.

Alternative considered for persistence location: an app-level config file
(Smart Grid's `Configuration` + `FileManager` pattern) separate from
patches — rejected per user direction: the audio interface is part of the
rig setup a patch captures, exactly like which MIDI controller is attached.

### D9 — Miniapp port defines the pattern

`apps/miniapp` keeps: the duophonic group config, `DualWavetableVcoModule`
wiring, LFO math (`DemoModulation.hpp` moves alongside it), pages/banks/slot
layout, scope wiring, gesture/scene demo controls, and its widget layout.
It deletes: all construction/pump/MIDI-device/patch-orchestration code (now
runtime). It gains: `ProcessBlock` writing the summed VCO voices to the
device outputs (config: 0 in / 2 out), and `PrepareToPlay` forwarding the
negotiated sample rate to the module. Patch root stays the deterministic
temp directory (now expressed as `RuntimeConfig.patchesRoot`) so spp-8's
scenarios keep holding.

## Risks / Trade-offs

- [Race between message-thread setup and audio-thread ownership at startup]
  → Ownership transfer is a specced lifecycle point: no audio callback is
  registered until construction, `Init`, UIState creation, and startup patch
  application complete; debug thread-tag assertions catch violations.
- [Patch commands do bounded non-RT work on the audio thread at block
  boundaries: load parses JSON, save serializes into the arena, and popped
  message payloads (strings/shared_ptrs) are destroyed there] → Accepted for
  v1 and specced as an explicit exception (sar-7): the engine supplies a
  preallocated serialization context (no per-command arena allocation),
  arena grow-and-retry stays on the message thread per spp-1, and patch
  commands are user-initiated non-realtime moments. Future work:
  Smart-Grid-style `StateInterchange`/IO-thread handoff to move even this
  off the callback.
- [Blocking patch file IO on the message thread] → Existing behavior today;
  bounded by patch size; noted as the same future IO-thread work.
- [`MessageInBus` consumer moves from UI timer to audio thread; on-screen
  controls now race the device callback if any code path still calls
  `bus.Process` from the message thread] → The runtime is the only consumer;
  apps get producer-only access conventions in the context docs, and the spec
  pins the consumer thread.
- [Template runtime means runtime code recompiles per app and errors surface
  at instantiation] → Concept-checked interface keeps errors early and
  readable; runtime stays header-only like the existing `juce/` layer.
- [Device may refuse requested rate/channels] → `PrepareToPlay` reports
  negotiated values; apps must treat `RuntimeConfig` as a request. Channel
  counts the device cannot satisfy degrade to the device maximum with the
  `AudioBlock` reporting actual counts.
- [`INFO` pays `snprintf` on the audio thread] → Bounded work into a fixed
  256-byte slot, same trade-off the source system runs in production;
  documented so hot per-sample loops don't log per sample. Deferred
  formatting is a possible future refinement.
- [Log drain rides the message-thread timer; a stalled UI stalls file/stdout
  output] → Producers keep enqueueing up to 16384 messages per thread and
  drops are counted per `ThreadId`; a dedicated drain thread is a one-line
  swap later if this bites.
- [Message truncation and silent drops under overflow] → Inherited source
  policy: 256-byte truncation and drop-new-with-missed-count; missed counts
  are reported in the log itself each drain pass.

## Migration Plan

1. Land contract headers + runtime alongside the existing miniapp (old app
   still builds).
2. Port the miniapp to `apps/miniapp`; verify behavior parity scenario by
   scenario (encoders, MIDI, patches, scope) plus new audio output.
3. Remove `projects/synth/miniapp`, repoint the `miniapp` Make target, update
   READMEs.
Rollback: revert is clean — the library core is untouched, so dropping the
runtime directory and restoring the old miniapp restores the prior world.

## Open Questions

- Should the runtime expose a headless mode (no window, for tests/CI) in v1,
  or is the JUCE-free `AppContext` + app-owned logic enough for testing?
  (Current plan: the latter; apps unit-test their JUCE-free parts directly,
  like `DemoModulationTests.cpp`.)
- ~~Exact startup-patch selection when multiple patch directories exist~~ —
  resolved (cross-provider review finding): select by the library's sortable
  version-file naming (lexicographically greatest version filename, ties by
  directory name), matching the existing miniapp scan; mtimes are not used.
