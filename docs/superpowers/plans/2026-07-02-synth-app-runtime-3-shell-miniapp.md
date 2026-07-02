# Synth App Runtime — Plan 3/3: Runtime Shell + Miniapp Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the JUCE runtime shell (`synth_runtime::Runtime<App>` over the landed `synth::Engine<App>`), the apps build scaffolding, and port the miniapp to `projects/synth/apps/miniapp` as a JUCE-free core + thin UI wrapper — replacing the old `projects/synth/miniapp`.

**Architecture:** The shell is thin by design: a JUCE audio device callback delegating to `engine.ProcessBlock`, a message-thread timer delegating to `engine.MessageThreadTick` plus MIDI device management, repaint, and the log drain, a `DocumentWindow` with generic chrome hosting the app's UI component, and a `SYNTH_RUNTIME_MAIN` macro. The old `miniapp/Main.cpp` (~815 lines) is the reference implementation being decomposed: its generic harness code moves into the runtime; only its app content survives into `apps/miniapp`.

**Tech Stack:** C++20, JUCE (developer-local checkout at `~/JUCE`, compiled from source per the existing miniapp Makefile pattern), GNU make.

**OpenSpec change:** `openspec/changes/synth-app-runtime` — implements task groups 5, 6, 7 and 8.1–8.3 of `tasks.md` (8.4 spec sync is controller work after the final review); requirements sar-1, sar-2, sar-5, sar-6 (shell side), sar-9, sar-10, sar-11, sar-14, slog-2, slog-7.

## Global Constraints

- The core library build and tests (`make -C projects/synth build test`) must never compile runtime or apps sources; 199+ tests stay green after every task.
- JUCE code is permitted ONLY in `projects/synth/juce`, `projects/synth/runtime`, and `projects/synth/apps` (delta-specced sdsp-1). `MiniAppCore` and everything it includes must be JUCE-free.
- Runtime namespace `synth_runtime`; header-only like `projects/synth/juce`. House style throughout (PascalCase methods, trailing-underscore privates).
- Engine surface (landed, verbatim — do not widen except where a task explicitly says): `Engine(TimestampProvider, std::size_t initialArenaCapacity = 256*1024)`, `Initialize()`, `Prepare(double, int)`, `ProcessBlock(AudioBlock&, std::uint64_t)`, `MessageThreadTick()`, `Application()`, `Context()`, `Manager()`, `UiBus()`, `MidiBus()`, `Patches()`, `MidiInputProcessor()`, `SetMidiProcessorsRebuiltCallback(std::function<void()>)`, `Endpoints()`, `Config()`, `SampleCount()`.
- Thread tagging (slog-2, binding): message thread tagged once at app initialise; audio callback and MIDI input callbacks wrapped in `ScopedThreadId`; `MidiSender` worker — the library owns that thread, so tag via the sink/run path ONLY if the library exposes it; otherwise document that the sender thread logs as Unknown and record it as a known limitation (do NOT modify MidiSender for this).
- Runtime startup order (sar-5, binding): configure `AsyncLogQueue` directory from `RuntimeConfig.logsRoot` + tag message thread → `engine.Initialize()` → reopen persisted MIDI endpoints (the engine's rebuilt-callback drives reopen after startup-patch rebuilds) → open audio device (request config channels/rate/block) → `engine.Prepare(negotiated values)` (re-invoked on device change) → register audio callback → start message-thread timer at `uiFrameHz`. Shutdown: deregister audio callback → stop/join MIDI sender → close MIDI devices → final `DoLog()` drain → destroy engine.
- Message-thread timer tick order (sar-7, slog-7, binding): `engine.MessageThreadTick()` → MIDI device management → repaint trigger → `AsyncLogQueue::s_instance.DoLog()` LAST.
- Patch chrome buttons log every command result through `INFO` (slog-7); the miniapp's old `appendPatchLog`/`patchLogPath` ofstream logging must NOT survive the port.
- Miniapp behavior parity (sar-11): everything spm-26/spm-37/sdsp-13/sdsp-14/smod-6/spp-8 describe — encoder grid with pages/banks, scenes/blend/gestures/shift, modulation view double-click, MIDI preset + device open/close + feedback, patch New/Save/SaveAs/Load/Revert with version files under the deterministic `/tmp` root, waveform pane — plus NEW: audible output (summed VCO voices × 0.5 to both device output channels) at the negotiated sample rate.
- Reference files: old app `projects/synth/miniapp/Main.cpp` + `miniapp/Makefile`; JUCE device wrappers `projects/synth/juce/MidiHandlers.hpp`; UI components `projects/synth/juce/EncoderComponent.hpp`, `WaveformComponents.hpp`.
- Build check for every JUCE task: `make -C projects/synth miniapp` (or the new app target) links successfully with `~/JUCE`. Commit per task, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Build scaffolding — juce_build.mk and apps directory

**Files:**
- Create: `projects/synth/runtime/juce_build.mk`
- Create: `projects/synth/apps/miniapp/Makefile` (skeleton that builds an empty-main placeholder this task; replaced by the real app in Tasks 5–6)
- Modify: `projects/synth/Makefile` (add `apps` convenience target; `miniapp` keeps pointing at the OLD `miniapp/` until Task 6 swaps it)

**Steps:**
- [ ] **Step 1:** Extract everything generic from `projects/synth/miniapp/Makefile` into `runtime/juce_build.mk`: `JUCE_DIR ?= $(HOME)/JUCE`, `check-juce`, the full JUCE module object list and compile rules (all `.mm`/`.cpp`/`.c` module translation units), the preprocessor defines (`JUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1`, `JUCE_STANDALONE_APPLICATION=1`, `JUCE_WEB_BROWSER=0`, `JUCE_USE_CURL=0`, `NDEBUG`), `LDFLAGS_DARWIN` frameworks, the synth library source list (`SYNTH_SRC`), and parameterized app-bundle rules driven by variables the including Makefile sets: `APP_NAME`, `APP_SOURCES`, `APP_BUILD_DIR`, `APP_INFO_PLIST`. Keep the old `miniapp/Makefile` untouched and building.
- [ ] **Step 2:** Write `apps/miniapp/Makefile` including `../../runtime/juce_build.mk` with a placeholder `Main.cpp` (a JUCE `main` that immediately returns 0 — replaced in Task 6) and a copied `Info.plist` from the old miniapp. Verify `make -C projects/synth/apps/miniapp` builds and links.
- [ ] **Step 3:** Verify `make -C projects/synth build test` compiles no runtime/apps sources (unchanged core), and `make -C projects/synth miniapp` (old app) still builds.
- [ ] **Step 4: Commit** — `build(synth): extract shared JUCE build into runtime/juce_build.mk with apps scaffolding`.

---

### Task 2: Runtime shell — device, callback, timer, lifecycle

**Files:**
- Create: `projects/synth/runtime/Runtime.hpp` (namespace `synth_runtime`)

**Interfaces:**
- Produces `template <synth::SynthApplication App> class Runtime`:

```cpp
template <synth::SynthApplication App>
class Runtime : private juce::AudioIODeviceCallback, private juce::Timer {
public:
    Runtime();          // engine with steady-clock TimestampProvider (µs since construction)
    ~Runtime() override; // shutdown ordering per Global Constraints
    void Start();       // startup ordering per Global Constraints
    synth::Engine<App>& GetEngine();
    juce::Component& AppComponent();     // app_.UIComponent()
    // patch commands for chrome (each calls Patches().X(), INFO-logs the result):
    void NewPatch(); void SavePatch(); void SavePatchAs(const juce::File&);
    void LoadPatch(const juce::File&); void RevertPatch();
private:
    // AudioIODeviceCallback:
    void audioDeviceIOCallbackWithContext(const float* const* inputChannelData, int numInputChannels,
                                          float* const* outputChannelData, int numOutputChannels,
                                          int numSamples, const juce::AudioIODeviceCallbackContext&) override;
        // { synth::ScopedThreadId tag(synth::ThreadId::Audio);
        //   build synth::AudioBlock over the raw pointers; engine_.ProcessBlock(block, NowMicros()); }
    void audioDeviceAboutToStart(juce::AudioIODevice* device) override;   // engine_.Prepare(actual rate, actual block)
    void audioDeviceStopped() override {}
    // Timer:
    void timerCallback() override;  // tick order per Global Constraints; MIDI mgmt delegated to panel (Task 3)
    juce::AudioDeviceManager deviceManager_;
    synth::Engine<App> engine_;
    ...
};
```

**Steps:**
- [ ] **Step 1:** Implement construction (engine with `[start = steady_clock::now()]{ ... }` µs provider), `Start()` exactly per the startup order (device open: `deviceManager_.initialiseWithDefaultDevices(config.numAudioInputs, config.numAudioOutputs)` then apply preferred rate/block via `AudioDeviceSetup` where the device allows; register `this` as callback LAST; `startTimerHz(config.uiFrameHz)`), the audio callback, `audioDeviceAboutToStart` re-preparation, the timer skeleton (engine tick → repaint hook → `DoLog()` last), destructor ordering. MIDI endpoint reopen is wired in Task 3 — leave a clearly named hook (`onMidiProcessorsRebuilt_` forwarding to the panel).
- [ ] **Step 2:** Compile check: a scratch translation unit in the apps skeleton instantiating `Runtime<PlaceholderApp>` (placeholder satisfying `SynthApplication` with a trivial `juce::Component`) must build and link via the Task 1 scaffolding. Keep this scratch TU as the apps placeholder main for now.
- [ ] **Step 3:** `make -C projects/synth build test` still green; apps skeleton links.
- [ ] **Step 4: Commit** — `feat(synth-runtime): add Runtime shell with audio device, callback, and timer lifecycle`.

---

### Task 3: Runtime MIDI panel and endpoint persistence

**Files:**
- Create: `projects/synth/runtime/MidiPanel.hpp`
- Modify: `projects/synth/runtime/Runtime.hpp` (own the panel; wire the rebuilt-callback and shutdown)

**Steps:**
- [ ] **Step 1:** Port the old miniapp's MIDI device management verbatim in behavior (from `Main.cpp`: `configureMidiControls`, `refreshMidiDevices`, `toggleMidiInput/Output`, `updateMidiStatus`, `selectDeviceByIdentifier`, `openSavedMidiDevices`, `rebuildMidiProcessors` glue) into a `synth_runtime::MidiPanel` component: device combo boxes + refresh/open/close buttons + status label, backed by `synth_juce::MidiInHandler`/`MidiOutputHandler` (from `projects/synth/juce/MidiHandlers.hpp`); the input handler forwards into `engine.MidiInputProcessor()` (guard the processor swap the way the old app did); the output handler is set as the `MidiSender` sink; opening/closing devices updates `engine.Endpoints()` identifiers.
- [ ] **Step 2:** Wire persistence + rebuilds in `Runtime`: `engine_.SetMidiProcessorsRebuiltCallback([this]{ midiPanel_->ReopenPersistedEndpoints(); })` — after any startup-patch or runtime-load rebuild, the panel reopens the endpoints recorded in `engine.Endpoints()` when available (device-absent → status shows closed, no failure). `MidiSender` `Start()` on runtime start; shutdown closes devices after the sender stops. MIDI input callback path carries `synth::ScopedThreadId tag(synth::ThreadId::MidiInput)` (add at the runtime's forwarding lambda if `MidiHandlers.hpp` doesn't already tag — do not modify library MidiSender).
- [ ] **Step 3:** Build checks as Task 2; core suite green.
- [ ] **Step 4: Commit** — `feat(synth-runtime): add MIDI device panel with endpoint persistence and rebuild reopen`.

---

### Task 4: Runtime window, chrome, and entry macro

**Files:**
- Create: `projects/synth/runtime/Shell.hpp` (window + chrome + `SYNTH_RUNTIME_MAIN`)
- Modify: `projects/synth/runtime/Runtime.hpp` (expose what the shell needs)

**Steps:**
- [ ] **Step 1:** Implement `synth_runtime::ShellComponent`: hosts (top) generic chrome — patch buttons New/Save/Save As/Load/Revert wired to `Runtime` patch methods (Save As/Load use `juce::FileChooser` against `config.patchesRoot`), the Task 3 MIDI panel, a status label — and (below, filling the rest) the app's `UIComponent()`. Repaint driven by the runtime timer.
- [ ] **Step 2:** Implement the application wrapper + macro in `Shell.hpp`:

```cpp
#define SYNTH_RUNTIME_MAIN(AppType)                                            \
    class AppType##Application : public juce::JUCEApplication { ... /* sets   \
        ThreadId::Message in initialise(), constructs Runtime<AppType>,       \
        calls Start(), creates DocumentWindow sized from RuntimeConfig,       \
        sets ShellComponent as content; shutdown() destroys in order */ };    \
    START_JUCE_APPLICATION(AppType##Application)
```

Write the full wrapper class in the header (initialise: `synth::SetCurrentThreadId(synth::ThreadId::Message);` then `AsyncLogQueue` directory config happens inside `Runtime::Start()`; getApplicationName from `AppType::Config().appName`).
- [ ] **Step 3:** Point the apps-skeleton placeholder at the macro with the placeholder app; build and launch-smoke (`open` not required — linking is the gate here; interactive launch is Task 7).
- [ ] **Step 4:** Core suite green. **Commit** — `feat(synth-runtime): add shell window, patch/MIDI chrome, and SYNTH_RUNTIME_MAIN`.

---

### Task 5: MiniAppCore (JUCE-free) + rig-hosted system test

**Files:**
- Create: `projects/synth/apps/miniapp/MiniAppCore.hpp` (namespace `synth_miniapp`, JUCE-free)
- Create: `projects/synth/apps/miniapp/DemoModulation.hpp` (moved from `miniapp/DemoModulation.hpp`, unchanged content)
- Create: `projects/synth/tests/miniapp_system_tests.cpp` (new binary, Makefile-wired; includes the core across directories via `-I` addition for `apps/miniapp` in that rule only)
- Modify: `projects/synth/Makefile`

**Steps:**
- [ ] **Step 1:** Write `MiniAppCore` satisfying `synth::SynthApplicationCore` by porting the old `MainComponent` constructor's app content (Main.cpp steps: gesture count, group config `{numVoices=2, numModulators=3, numScenes=3, maxParameters=24, processLiteAlpha=1.0f, voiceIndicatorColors={Cyan, Orange}}`, VCO module registration + modulation sources + LFO source slot 2, parameter handles incl. `lfoSpeed`, gesture pre-wiring, pages "VCO"/"LFO", banks/slot with encoders {10,11,12,13}, `SetActivePage(0)`, `SetSceneEndpoints(0,1)`, scope writer wiring, default WrldBldr profile config into `context->midiProfileConfig` + default copy) into `Init(AppContext*)`; `Config()` returns `{appName="SynthMiniapp", 0 in, 2 out, 48000, 256, patchesRoot=/tmp/sheaf-synth-miniapp-patches (the old deterministic root), logsRoot=/tmp/sheaf-synth-miniapp-logs, 900×560, 30}`; `PrepareToPlay(sr, bs)` → `vcoModule_.SetSampleRate((float) sr)`; `ProcessBlock(AudioBlock&)` ports `processDspFrame` per frame: `ProcessLiteParameters`, `vcoModule_.SetInput(manager)`, `vcoModule_.Process()`, scope advance, LFO phase/modulator updates, `manager.UpdateModValues(group)` — then NEW: write `(voice0 + voice1) * 0.5f` output samples to every device output channel; publish scope + `vcoModule_.PopulateUIState` at block end. Expose the accessors the UI wrapper needs (uiState pointers, scope reader handles, parameter ids, bus access via stored context).
- [ ] **Step 2:** Write the rig-hosted system test (sar-14, binding): `synth_rig::SynthRig<synth_miniapp::MiniAppCore>` — asserts: initializes headlessly; `RunSeconds(0.1)` produces finite output with nonzero peak after raising Volume via the production bus (Turn on the volume encoder position); encoder turns on Tune/Shape change output; patch save→perturb→load round-trip restores values; no NaN throughout. Point `patchesRoot` at a test temp dir (make the core's `Config()` patchesRoot overridable via a static test hook exactly like EngineTestApp's pattern).
- [ ] **Step 3:** `make -C projects/synth test` green including the new binary (this proves the core is JUCE-free — the binary compiles without JUCE include paths).
- [ ] **Step 4: Commit** — `feat(synth): add JUCE-free MiniAppCore with rig-hosted system test`.

---

### Task 6: Miniapp UI wrapper and the swap

**Files:**
- Create: `projects/synth/apps/miniapp/MiniApp.hpp` (UI wrapper), `projects/synth/apps/miniapp/Main.cpp` (SYNTH_RUNTIME_MAIN), `projects/synth/apps/miniapp/README.md`
- Modify: `projects/synth/apps/miniapp/Makefile` (real sources), `projects/synth/Makefile` (`miniapp` target → apps/miniapp), `projects/synth/README.md`
- Delete: `projects/synth/miniapp/` (entire directory)

**Steps:**
- [ ] **Step 1:** Write `MiniApp` (extends/wraps `MiniAppCore`, adds `UIComponent()`): port the old app's bespoke UI — 4 `synth_juce::EncoderComponent`s bound via `BindMessages(uiBus, 0, ix)` with the runtime timestamp provider, page/bank buttons, gesture button + slider, 3 scene buttons + blend slider, shift + start/stop buttons, `VcoWaveformComponent` — into a single app component reading `context->uiState` atomics (color conversion stays in app code). The patch buttons and MIDI configuration are NOT ported — the runtime chrome provides them (spm-37 delta). The old `appendPatchLog`/`patchLogPath`/`logPatchCommand` code is NOT ported (slog-7) — verify no ofstream logging remains anywhere under `apps/`.
- [ ] **Step 2:** `Main.cpp` = includes + `SYNTH_RUNTIME_MAIN(synth_miniapp::MiniApp)`. Update the app Makefile to the real sources; build and link.
- [ ] **Step 3:** The swap: `git rm -r projects/synth/miniapp`; repoint the root `miniapp` target to `$(MAKE) -C apps/miniapp`; update both READMEs (build instructions, JUCE_DIR note, new layout, logging location, runtime-owned chrome).
- [ ] **Step 4:** Full verification: `make -C projects/synth all` (library + all 8 test binaries) green; `make -C projects/synth miniapp` builds the new app bundle.
- [ ] **Step 5: Commit** — `feat(synth): port miniapp onto the runtime and remove the legacy app`.

---

### Task 7: End-to-end verification sweep

**Files:** none created (fixes only if the sweep finds breakage)

**Steps:**
- [ ] **Step 1:** Clean rebuild everything: `make -C projects/synth clean && make -C projects/synth all && make -C projects/synth miniapp`. All suites green, zero warnings, app links.
- [ ] **Step 2:** Launch the app (`open projects/synth/apps/miniapp/build/SynthMiniapp.app` or run the binary directly) long enough to confirm it starts, creates exactly one session log file under the logs root with wall-clock/sample/thread-prefixed lines (verify with `ls` + `head`), writes patch version files on Save, and shuts down cleanly (check the log tail for shutdown ordering). Automated observation only — no audio-quality judgment; report what the log shows.
- [ ] **Step 3:** Run the debug thread-tag check: grep the session log for any producer tagged `Unknown` during steady state (only startup/single-threaded contexts may be Unknown).
- [ ] **Step 4:** Report findings (no commit unless fixes were needed). Manual human smoke items (audible output, encoder feel, MIDI hardware, modulation view) are listed for the user at handoff.
