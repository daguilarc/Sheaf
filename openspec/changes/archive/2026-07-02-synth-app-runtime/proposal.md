# Proposal: synth-app-runtime

## Why

The synth library (parameters/modulation, MIDI controller IO and profiles, DSP
classes, modules, patch persistence) is functionally complete, but every
application must hand-roll ~800 lines of harness code: the miniapp's `Main.cpp`
personally constructs the manager, five message buses, the patch manager, the
MIDI sender, the device-selection UI, and an eleven-step timer pump — and it
never opens a real audio device (DSP runs on a 30 Hz UI timer and is never
heard). There is no configuration object for sample rate or audio channel
counts anywhere in the framework. To turn the library into a complete system,
the boilerplate must be factored into a reusable runtime so an application is
only the code that defines what it does.

## What Changes

- Add a **runtime layer** at `projects/synth/runtime` (namespace
  `synth_runtime`, JUCE-dependent): a `Runtime<App>` class template
  parameterized on an application type. The runtime owns construction of all
  framework objects, application init, startup patch loading, audio device
  setup and the audio callback, MIDI device/profile management, patch
  save/load orchestration, thread and queue setup, the window/UI shell, and
  the message pumps.
- Add a JUCE-free **application contract**: a `RuntimeConfig` struct (audio
  input/output counts, preferred sample rate and block size, patches root,
  app name), an `AppContext` struct holding non-owning pointers to all manager
  objects (parameter manager, patch manager, message buses, MIDI sender,
  profile config) plus the config, and a compile-time-checked application
  interface — at minimum `Init(AppContext*)` and `ProcessBlock(...)`, plus a
  UI-component hook. The runtime never processes individual modules; the
  application's `ProcessBlock` owns all per-sample work.
- Establish a real-time threading model: the audio callback drains the SPSC
  message buses into the manager and delegates to the application, while the
  message thread handles storage-growth replies, patch file IO, MIDI output
  feedback, and UI repaint from `UIState` atomics.
- Port the **thread-aware async logging system** from The All Electric Smart
  Grid into the JUCE-free core: a single `INFO(...)` interface whose producer
  path is audio-thread-safe (lock-free per-thread bounded queues, no
  allocation or IO, drop-with-missed-count on overflow), with a runtime-driven
  drain that mirrors every line to stdout and a timestamped per-session log
  file. Ports `AsyncLogger`, the `CircularQueue<T, N>` ring buffer, and the
  `ThreadId`/`ScopedThreadId` thread-identity pattern (with a synth-specific
  thread enum); replaces the miniapp's ad hoc per-line `std::ofstream` patch
  log.
- Factor the runtime's JUCE-free assembly and pump into a shared
  `synth::Engine<App>` and add a **headless test rig** modeled on the Smart
  Grid's `SynthRig` harness: a JUCE-free `SynthRig<App>` that drives the same
  production engine code block-by-block (`RunBlocks`/`RunSamples`/
  `RunSeconds`), injects control and MIDI messages through the real bus and
  routing layers, captures output with sticky NaN/peak invariants, and
  orchestrates patch round-trips — used for new system tests of the runtime
  contract and a headless miniapp system test. Unlike the Smart Grid rig,
  which hand-replicates its production pump, this rig executes the identical
  engine code the runtime ships.
- Add **audio device configuration** alongside the MIDI configuration: the
  runtime lets the user select the audio interface (instead of always using
  the system default), persists the selection in the patch document the same
  way MIDI endpoints persist (applied when the device is present, silently
  kept-default when absent), and re-prepares the engine on device switches.
  Patch identity (current patch name/directory, pending-save state) is owned
  by message-thread components; the chrome displays the current patch name,
  and Save with no current patch falls through to the Save As flow.
- Add an **applications directory** `projects/synth/apps/` with shared build
  scaffolding (JUCE module compilation extracted from the miniapp Makefile).
- **Port the miniapp** to `projects/synth/apps/miniapp` as the first
  application: its code shrinks to patch-specific content (group/VCO/LFO
  setup, pages/banks, scope wiring, per-sample processing, bespoke widgets),
  and it gains audible output through the runtime's audio device. The old
  `projects/synth/miniapp` directory is removed. **BREAKING** for the local
  build path (`miniapp` target now builds from `apps/miniapp`).

## Capabilities

### New Capabilities

- `synth-app-runtime`: the application/runtime contract — runtime and apps
  project layout, `RuntimeConfig`, `AppContext`, the application interface and
  `Runtime<App>` template, lifecycle ordering, audio device setup and block
  delegation, thread ownership, runtime patch orchestration, MIDI device
  management, the UI shell, and the miniapp as the reference runtime-hosted
  application, plus the shared JUCE-free engine and the headless `SynthRig`
  test harness that drives it. ID prefix `sar`.
- `synth-async-logging`: the JUCE-free thread-aware async logging library —
  thread identity (`ThreadId`, `ScopedThreadId`), the single audio-thread-safe
  `INFO(...)` producer interface, per-thread bounded queues with
  drop-and-count overflow, round-robin draining to stdout and per-session log
  files, sample-accurate timestamps, and runtime integration (directory
  configuration, drain cadence, thread tagging). ID prefix `slog`.

### Modified Capabilities

- `synth-parameter-modulation`: `spm-26` (miniapp probe) — miniapp path moves
  to `projects/synth/apps/miniapp` and the app is hosted by the runtime;
  `spm-37` (miniapp MIDI configuration) — bus draining moves from the UI timer
  to the runtime's audio-thread pump, and the MIDI configuration page is
  provided by the runtime shell.
- `synth-dsp-classes`: `sdsp-1` — allowed locations for JUCE-dependent code
  expand to include `projects/synth/runtime` and `projects/synth/apps`.
- `synth-patch-persistence`: `spp-8` — the runtime (not the miniapp) now
  instantiates the patch manager and patch message buses and consumes patch
  lifecycle messages; the miniapp supplies its deterministic patch root via
  `RuntimeConfig`.

## Impact

- **New code**: `projects/synth/runtime/` (runtime template, audio callback,
  UI shell, MIDI device glue), `projects/synth/include/synth/` additions for
  the JUCE-free `RuntimeConfig`/`AppContext`/audio-block view and the ported
  logging headers (`AsyncLogger`, `CircularQueue`, `ThreadId`),
  `projects/synth/apps/miniapp/`, JUCE-free logger unit tests and the
  `SynthRig` harness plus rig-driven system tests under
  `projects/synth/tests/`.
- **Removed/moved**: `projects/synth/miniapp/` contents are ported; JUCE
  module build rules move into a shared makefile fragment.
- **Unchanged**: the JUCE-free core library (`include/synth`, `src`), its
  Makefile targets and tests, and all existing library-level spec contracts
  (spm, spp, smod, sdsp requirements other than those listed above).
- **Behavioral upgrade**: the miniapp opens a real audio device and outputs
  the VCO signal; sample rate is negotiated from the device instead of the
  module's hardcoded 48 kHz default.
- **Sibling project**: the async logging system (`AsyncLogger.hpp`,
  `CircularQueue<T, N>`, the `ThreadId` pattern) is ported from The All
  Electric Smart Grid and adapted (synth thread enum, runtime-owned sample
  clock and drain); other reviewed patterns (IO task thread,
  `StateInterchange`) remain future work.
