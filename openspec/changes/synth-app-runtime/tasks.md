# Tasks: synth-app-runtime

## 1. Application contract headers (JUCE-free core)

- [x] 1.1 Add `include/synth/AppContext.hpp` with `RuntimeConfig` (app name, audio in/out counts, preferred sample rate/block size, patches root, logs root, UI dimensions/frame rate), `AudioBlock` (input/output pointers, actual channel counts, frame count), and `AppContext` (non-owning pointers to parameter manager, patch manager, UI/MIDI message buses, parameter message out bus, patch buses, MIDI sender, live + default MIDI profile configs, runtime config, late-bound UI-state pointer)
- [x] 1.2 Extend a JUCE-free test binary to include the new header and assert it compiles without `JUCE_MAJOR_VERSION` (sar-1, sar-6 block-view scenario)
- [x] 1.3 Add contract doc comments pinning thread roles per bus/manager pointer (producer/consumer thread per sar-7)

## 2. Async logging port (JUCE-free core)

- [x] 2.1 Port `CircularQueue<T, N>` from the Smart Grid (`private/src/CircularQueue.hpp`, ring buffer only — leave `ByteBuffer`/`CircularByteQueue` behind) into `include/synth/CircularQueue.hpp`, namespace `synth` (slog-1)
- [ ] 2.2 Port the `ThreadId` system into `include/synth/ThreadId.hpp` with the synth thread enum (`Message`, `Audio`, `MidiInput`, `MidiSender`, `Unknown`), `thread_local` tag with get/set, `ScopedThreadId` RAII guard, and thread-name strings (slog-2)
- [ ] 2.3 Port `AsyncLogger.hpp` (`LogMessage` with 256-byte slot and producer-side `snprintf` fill, `AsyncLogQueue` with one queue per `ThreadId`, drop-with-missed-count overflow, round-robin `DoLog` drain to stdout + timestamped per-session log file, `INFO(...)` macro, test hooks) into `include/synth/AsyncLogger.hpp`; replace the `SampleTimer::GetSample()` dependency with a settable non-owning `std::atomic<uint64_t>*` sample-counter source defaulting to unset/0 (slog-3..slog-6)
- [ ] 2.4 Write JUCE-free logger unit tests in `tests/`: enqueue/drain round-trip, per-thread routing, concurrent distinctly-tagged producers, overflow missed counts, truncation, session-file creation in a test-controlled directory, unconfigured-directory stdout-only mode; document on the interface that concurrent untagged (Unknown) producers are unsupported (slog-3, slog-8)
- [ ] 2.5 Wire the new headers into the library build and confirm `make -C projects/synth build test` passes with the logger tests included (slog-1)

## 3. Engine (JUCE-free shared assembly)

- [ ] 3.1 Define the layered concepts: JUCE-free `SynthApplicationCore` (config accessor, `Init(AppContext*)`, block processing) and `SynthApplication` (core + UI hook), with optional-hook detection (`PrepareToPlay`, control-rate frame hook) and static-assert diagnostics naming missing members (sar-4)
- [ ] 3.2 Implement `synth::Engine<App>` construction in `include/synth/Engine.hpp`: managers, five buses, MIDI sender, patch manager, injectable timestamp provider, runtime-owned atomic sample counter, app held by value, `AppContext` wiring (sar-12)
- [ ] 3.3 Add `ParameterManager::ComputeAllTargets()` (compute without `SnapCurrentToTarget`, preserving the `ProcessLite` slew path) with a unit test proving an edit slews over samples instead of snapping; keep snapping for init/load/revert moments (sar-6)
- [ ] 3.4 Implement `Engine::Initialize()`: app `Init` → `CaptureDefaultControlState` → `CreateUIState` + publish into context → MIDI processor build from live profile → startup patch application (selected by lexicographically greatest sortable version filename, ties by directory name; silent fallback to defaults) with the load-consumption MIDI-processor rebuild running before the host reopens endpoints; plus a separate `Engine::Prepare(sampleRate, blockSize)` forwarding to the app prepare hook, called by the host after device negotiation (sar-5, sar-8, sar-12)
- [ ] 3.5 Implement `Engine::ProcessBlock(AudioBlock&, timestamp)`: drain patch input bus via `ApplyPatchMessage` with an engine-owned preallocated `PatchSerializationContext` (rebuild-MIDI/reopen-endpoint notifications surfaced to the host; arena grow/retry left to the message tick), `uiBus->Process`, `midiBus->Process`, `ComputeAllTargets()`, advance + publish the sample counter to the async logger, call `app.ProcessBlock` exactly once, throttled `PopulateUIState` (sar-6, sar-7, slog-6)
- [ ] 3.6 Implement `Engine::MessageThreadTick()`: parameter storage-batch replies, patch serialization arena grow/retry, `patchManager->ProcessResponses()`, MIDI output processor polling (sar-7)
- [ ] 3.7 Add JUCE-free engine unit tests: initialization ordering (patched profile installed before endpoint-reopen notification), pump ordering, slew preservation through the pump, concept rejection of a UI-less core by the full concept (sar-4, sar-5, sar-6, sar-12)

## 4. SynthRig test harness

- [ ] 4.1 Implement `synth_rig::SynthRig<App>` in `tests/support/SynthRig.hpp` wrapping `Engine<App>`: buffer allocation from config, `RunBlocks`/`RunSamples`/`RunSeconds` with block-derived deterministic timestamps and per-block `MessageThreadTick`, output capture ring with sticky NaN/Inf flag and peak tracking (sar-13)
- [ ] 4.2 Add injection verbs: encoder turn/press/shift-press, gesture select/value, scene select/endpoints/blend as `MessageIn` onto the UI bus; `SendMidi(BasicMidi)` through the engine's MIDI input processor chain into the MIDI bus (sar-13)
- [ ] 4.3 Add observation and patch helpers: UI-state access, parameter readback, `Output()`/`LastOutput()`/`OutputPeak()`/`SawNaN()`, `SavePatch`/`LoadPatch`/`RevertPatch` issuing patch commands and pumping with a bounded block budget, returning success/failure/timeout status (sar-13)
- [ ] 4.4 Write rig-driven system tests for the engine contract: bus drain ordering, MIDI-through-profile routing to a parameter, determinism (two identical runs produce identical state sequences), patch round-trip, and patch-helper timeout on a never-arriving response (sar-13)

## 5. Runtime scaffolding and build

- [ ] 5.1 Create `projects/synth/runtime/` with `juce_build.mk` extracted from the miniapp Makefile (JUCE module compilation rules, framework link flags, app-bundle rules, `check-juce`)
- [ ] 5.2 Create `projects/synth/apps/` and an app Makefile pattern that includes `juce_build.mk`; keep `make miniapp` working from `projects/synth` (repointed later in task 8)
- [ ] 5.3 Verify `make -C projects/synth build test` still builds only the core (no runtime/apps sources)

## 6. Runtime shell (`synth_runtime::Runtime<App>`)

- [ ] 6.1 Implement `Runtime<App>` over `Engine<App>`: construct engine with steady-clock timestamp provider, configure log directory from `RuntimeConfig.logsRoot`, tag the message thread, then engine `Initialize()` → reopen persisted MIDI endpoints (after any startup-patch profile rebuild) → open audio device (negotiate channel counts/rate/block from config) → `engine.Prepare(negotiated values)`, re-invoked on device change → register audio callback → start message-thread timer (sar-2, sar-5, sar-12, slog-7)
- [ ] 6.2 Implement the audio callback: `ScopedThreadId` audio tag, wrap device buffers in `synth::AudioBlock`, delegate to `engine.ProcessBlock` (sar-6, slog-2)
- [ ] 6.3 Implement the message-thread timer: `engine.MessageThreadTick()`, MIDI device management, repaint trigger, then `AsyncLogQueue` drain as the final step (sar-7, slog-7)
- [ ] 6.4 Implement shutdown ordering: deregister audio callback → stop/join MIDI sender → close MIDI devices → final log drain → destroy engine (sar-5)
- [ ] 6.5 Move MIDI device enumeration/open/close/status into a runtime MIDI panel; rebuild processors through the engine after patch loads with endpoint reopen; tag MIDI callbacks and the `MidiSender` run loop with `ThreadId` (sar-8, sar-9, slog-2)
- [ ] 6.6 Implement the runtime shell UI: JUCE application object, `DocumentWindow`, chrome (patch New/Save/SaveAs/Load/Revert buttons wired to the patch manager with `INFO` logging of results, MIDI panel, status), hosting/resizing of the app's UI component, repaint timer reading UIState atomics (sar-8, sar-10, slog-7)
- [ ] 6.7 Add the `SYNTH_RUNTIME_MAIN(AppType)` entry-point macro (sar-10)

## 7. Miniapp port

- [ ] 7.1 Create `projects/synth/apps/miniapp/` with a JUCE-free `MiniAppCore` (satisfies `SynthApplicationCore`): `RuntimeConfig` (0 in / 2 out, 48 kHz preferred, deterministic `/tmp` patches root, logs root), `Init` containing only group/VCO-module/LFO/pages/banks/slot/scope/gesture-metadata setup, prepare hook forwarding sample rate to `DualWavetableVcoModule` (sar-11, sar-14)
- [ ] 7.2 Implement `MiniAppCore::ProcessBlock`: per-sample `ProcessLite`, module `SetInput`/`Process`, LFO advance, `UpdateModValues`, scope writes, and summed VCO voices written to device outputs (sar-6, sar-11)
- [ ] 7.3 Add the thin `MiniApp` wrapper providing the UI component (encoders, buttons, sliders, waveform pane) over the core; keep `EncoderComponent::BindMessages` wiring to the UI bus (sar-10, sar-11)
- [ ] 7.4 Move `DemoModulation.hpp` alongside the app; add the rig-hosted miniapp system test (init through engine, run blocks, drive encoders/scenes/gestures, assert non-NaN output with nonzero peak at raised volume, patch save/load round-trip) subsuming `DemoModulationTests.cpp`'s coverage while keeping its pure-math checks (sar-14)
- [ ] 7.5 Delete the miniapp's `appendPatchLog`/`patchLogPath` ad hoc logging along with the old `projects/synth/miniapp/` directory; repoint the `miniapp` Make target to `apps/miniapp`, update `projects/synth/README.md` and the app README (slog-7)

## 8. Verification and spec sync

- [ ] 8.1 Run `make -C projects/synth all` (core + logger + engine + rig + miniapp system tests) and the miniapp build; launch the miniapp and verify behavior parity scenario-by-scenario: encoder grid/pages/scenes/gestures, modulation view double-click, MIDI preset + device open/close + feedback, patch new/save/save-as/load/revert with version files, waveform pane — plus audible VCO output at the negotiated sample rate
- [ ] 8.2 Verify threading contract in a debug build (thread-tag assertions clean while turning encoders, sending MIDI, and loading patches during audio)
- [ ] 8.3 Verify logging end-to-end: exactly one session file per launch under the miniapp logs root, lines carry wall-clock/sample/thread prefixes, audio-thread `INFO` calls appear, patch activity is logged, stdout mirrors the file
- [ ] 8.4 Sync delta specs to main specs (`synth-app-runtime` and `synth-async-logging` new; spm-26/spm-37, sdsp-1, spp-8 modified) and update `projects/synth` docs to describe the runtime/apps layout, engine/rig split, and logging interface
