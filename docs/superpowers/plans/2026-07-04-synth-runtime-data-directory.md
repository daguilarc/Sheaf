# Synth Runtime Data Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move synth persistence to a runtime-owned long-lived data directory, split patches from MIDI/audio runtime configuration, and replace OS patch file dialogs with an in-app patch browser rooted at `patches/`.

**Architecture:** Add JUCE-free runtime data-path/configuration/patched-browser primitives in the synth core, then wire runtime startup and UI pages to those primitives. Patch persistence becomes parameter-only; runtime configuration owns `MidiInstrumentConfig` plus `AudioDeviceState`.

**Tech Stack:** C++20, JUCE runtime shell, JUCE-free synth core tests, OpenSpec `add-synth-runtime-data-directory`, xagent Claude Opus reviewers for review gates, Codex subagents for implementation.

---

## Source Of Truth

- OpenSpec change: `openspec/changes/add-synth-runtime-data-directory/`
- Proposal: `openspec/changes/add-synth-runtime-data-directory/proposal.md`
- Design: `openspec/changes/add-synth-runtime-data-directory/design.md`
- Specs:
  - `openspec/changes/add-synth-runtime-data-directory/specs/synth-app-runtime/spec.md`
  - `openspec/changes/add-synth-runtime-data-directory/specs/synth-patch-persistence/spec.md`
  - `openspec/changes/add-synth-runtime-data-directory/specs/synth-runtime-ui/spec.md`
  - `openspec/changes/add-synth-runtime-data-directory/specs/synth-async-logging/spec.md`
- OpenSpec tasks: `openspec/changes/add-synth-runtime-data-directory/tasks.md`

## File Responsibility Map

- `projects/synth/include/synth/AppContext.hpp`: `RuntimeConfig` and new `RuntimeDataPaths` contract.
- `projects/synth/include/synth/PatchPersistence.hpp` and `projects/synth/src/PatchPersistence.cpp`: patch JSON split, runtime configuration JSON helpers, atomic config save/load, patch message behavior.
- `projects/synth/include/synth/Engine.hpp`: engine-owned data paths, startup ordering, config load hook, startup patch root, patch-only message application.
- `projects/synth/runtime/Runtime.hpp`: production data path resolution, log configuration, runtime config save/load call sites, patch path accessors.
- `projects/synth/runtime/FilePage.hpp`: replace `juce::FileChooser` with in-app browser UI.
- `projects/synth/runtime/MainPane.hpp`, `AudioConfigPage.hpp`, `ControllersPage.hpp`: Back wiring for configuration saves.
- `projects/synth/include/synth/PatchBrowser.hpp` and `projects/synth/src/PatchBrowser.cpp`: new JUCE-free patch browser model, path validation, deterministic directory listing.
- `projects/synth/apps/miniapp/MiniAppCore.hpp` and `README.md`: remove production temp roots and document persistent runtime data.
- Tests:
  - `projects/synth/tests/contract_tests.cpp`
  - `projects/synth/tests/parameter_modulation_tests.cpp`
  - `projects/synth/tests/engine_tests.cpp`
  - `projects/synth/tests/rig_tests.cpp`
  - `projects/synth/tests/miniapp_system_tests.cpp`
  - new or existing `projects/synth/tests/patch_browser_tests.cpp`

## Review Policy

- Implementers are Codex worker subagents.
- Reviewers are xagent Claude Opus reviewers:
  - Spec compliance review command shape:
    `plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "<prompt>"`
  - Code quality review command shape:
    `plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "<prompt>"`
- Opus review prompts must ask for findings first, severity ordered, with concrete file/line references and uncertainty called out.
- Do not mark an OpenSpec checkbox done until implementation, targeted tests, Opus spec review, and Opus quality review pass for the corresponding slice.

### Task 1: Runtime Data Path Contract

**OpenSpec tasks covered:** 1.1, 1.2, 1.4, 1.5.

**Files:**
- Modify: `projects/synth/include/synth/AppContext.hpp`
- Modify: `projects/synth/include/synth/Engine.hpp`
- Modify: `projects/synth/tests/contract_tests.cpp`
- Modify: `projects/synth/tests/engine_tests.cpp`
- Modify: `projects/synth/tests/support/SynthRig.hpp`
- Modify: `projects/synth/apps/miniapp/MiniAppCore.hpp`

- [ ] **Step 1: Write failing contract tests for runtime paths and removed app-owned roots**

In `projects/synth/tests/contract_tests.cpp`, change `runtime_config_defaults_are_sensible` so it no longer expects `patchesRoot`/`logsRoot`. Add:

```cpp
TEST_CASE(runtime_data_paths_default_empty_and_derive_children) {
    const synth::RuntimeDataPaths paths;
    REQUIRE_TRUE(paths.dataRoot.empty());
    REQUIRE_TRUE(paths.patchesRoot.empty());
    REQUIRE_TRUE(paths.logsRoot.empty());
    REQUIRE_TRUE(paths.configFile.empty());

    const auto derived = synth::RuntimeDataPaths::FromDataRoot("/tmp/sheaf-test-root");
    REQUIRE_TRUE(derived.dataRoot == std::filesystem::path("/tmp/sheaf-test-root"));
    REQUIRE_TRUE(derived.patchesRoot == std::filesystem::path("/tmp/sheaf-test-root") / "patches");
    REQUIRE_TRUE(derived.logsRoot == std::filesystem::path("/tmp/sheaf-test-root") / "logs");
    REQUIRE_TRUE(derived.configFile == std::filesystem::path("/tmp/sheaf-test-root") / "config.json");
}
```

Expected RED command:

```bash
make -C projects/synth build/contract_tests && projects/synth/build/contract_tests
```

Expected failure: `RuntimeDataPaths` is not declared and/or `RuntimeConfig` still has root fields.

- [ ] **Step 2: Add `RuntimeDataPaths` and remove production roots from `RuntimeConfig`**

In `projects/synth/include/synth/AppContext.hpp`, add:

```cpp
struct RuntimeDataPaths {
    std::filesystem::path dataRoot;
    std::filesystem::path patchesRoot;
    std::filesystem::path logsRoot;
    std::filesystem::path configFile;

    static RuntimeDataPaths FromDataRoot(std::filesystem::path root) {
        RuntimeDataPaths paths;
        paths.dataRoot = std::move(root);
        paths.patchesRoot = paths.dataRoot / "patches";
        paths.logsRoot = paths.dataRoot / "logs";
        paths.configFile = paths.dataRoot / "config.json";
        return paths;
    }
};
```

Remove `patchesRoot`, `logsRoot`, `preferredOutputDeviceName`, and `preferredInputDeviceName` from `RuntimeConfig`. The runtime configuration document will own persistent audio preferences.

Also remove every immediate reader of `preferredOutputDeviceName` and `preferredInputDeviceName` in this task. In particular, delete the `Engine::Initialize()` block that seeds `audioDeviceState_` from app config before `app_.Init()`, and remove the `EngineTestApp::Config()` assignments that copy `initAudioDeviceState` into `RuntimeConfig`. Tests that need a non-default current audio device should seed it with `engine.SetAudioDeviceFromHost(...)` after initialization until runtime config file loading is introduced in Task 4.

- [ ] **Step 3: Thread data paths into `Engine`**

Change `Engine` to own data paths:

```cpp
void SetRuntimeDataPaths(RuntimeDataPaths paths) { dataPaths_ = std::move(paths); }
const RuntimeDataPaths& DataPaths() const { return dataPaths_; }
```

Add member:

```cpp
RuntimeDataPaths dataPaths_;
```

Update startup patch lookup from `config_.patchesRoot` to `dataPaths_.patchesRoot`.

- [ ] **Step 4: Update tests and miniapp static hooks**

Replace `EngineTestApp::testPatchesRoot` setup with `engine.SetRuntimeDataPaths(synth::RuntimeDataPaths::FromDataRoot(root))`, where tests use `root / "patches"` implicitly.

Remove `MiniAppCore::testPatchesRoot`, `testLogsRoot`, `DefaultPatchesRoot()`, and `DefaultLogsRoot()` from `MiniAppCore.hpp`. `MiniAppCore::Config()` should set only app identity, audio counts, sample rate/block size, and UI size/frame rate.

Migrate any tests that previously relied on app-configured preferred audio device names. The minimum safe rewrite is:

```cpp
engine.Initialize();
engine.SetAudioDeviceFromHost(synth::AudioDeviceState{
    .outputDeviceName = "Output From Test",
    .inputDeviceName = "Input From Test",
});
```

Use runtime config file fixtures only in Task 4, where the config loader exists.

Note: after Task 1 and before Tasks 4-5, JUCE app headers that read old `RuntimeConfig` path fields may not compile under `make apps`. That intermediate breakage is expected only for app-only targets; Task 1 verification is limited to the listed core test binaries.

- [ ] **Step 5: Verify Task 1**

Run:

```bash
make -C projects/synth build/contract_tests build/engine_tests build/miniapp_system_tests
projects/synth/build/contract_tests
```

Expected: contract tests pass; engine/miniapp core test binaries compile or fail only on later, expected patch/config split tests not yet updated.

### Task 2: Runtime Configuration JSON Helpers

**OpenSpec tasks covered:** 2.1, 2.2, 2.3, 2.4.

**Files:**
- Modify: `projects/synth/include/synth/PatchPersistence.hpp`
- Modify: `projects/synth/src/PatchPersistence.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
- Modify: `projects/synth/Makefile` only if a new test binary is chosen instead of extending `parameter_modulation_tests`.

- [ ] **Step 1: Write failing runtime configuration persistence tests**

In `projects/synth/tests/parameter_modulation_tests.cpp`, add tests:

```cpp
TEST_CASE(runtime_config_json_round_trips_midi_and_audio) {
    synth::MidiInstrumentConfig instrument =
        MakeInstrumentFromProfile(synth::WrldBldrDefaultProfileConfig({}), "input-id", "output-id");
    synth::AudioDeviceState audio{.outputDeviceName = "Interface Out", .inputDeviceName = "Interface In"};

    synth::JsonArena arena(64 * 1024);
    synth::JSON root = synth::BuildRuntimeConfigJSON(arena, instrument, audio);
    REQUIRE_TRUE(!root.IsNull());
    REQUIRE_TRUE(std::string(root.Get("schema").StringValue()) == "sheaf.synth.runtime-config");

    synth::MidiInstrumentConfig loadedInstrument;
    synth::AudioDeviceState loadedAudio;
    REQUIRE_TRUE(synth::LoadRuntimeConfigJSON(root, loadedInstrument, loadedAudio));
    REQUIRE_TRUE(loadedInstrument.controllers.size() == 1);
    REQUIRE_TRUE(loadedInstrument.controllers[0].input.identifier == "input-id");
    REQUIRE_TRUE(loadedAudio.outputDeviceName == "Interface Out");
    REQUIRE_TRUE(loadedAudio.inputDeviceName == "Interface In");
}

TEST_CASE(runtime_config_load_invalid_json_preserves_targets) {
    synth::JsonArena arena(1024);
    synth::JSON invalid = arena.Object();
    invalid.SetNew("schema", arena.String("wrong"));
    invalid.SetNew("schemaVersion", arena.Integer(1));

    synth::MidiInstrumentConfig instrument =
        MakeInstrumentFromProfile(synth::WrldBldrDefaultProfileConfig({}), "keep-in", "keep-out");
    synth::AudioDeviceState audio{.outputDeviceName = "Keep Out", .inputDeviceName = "Keep In"};

    REQUIRE_TRUE(!synth::LoadRuntimeConfigJSON(invalid, instrument, audio));
    REQUIRE_TRUE(instrument.controllers.size() == 1);
    REQUIRE_TRUE(instrument.controllers[0].input.identifier == "keep-in");
    REQUIRE_TRUE(audio.outputDeviceName == "Keep Out");
}
```

Also add disk tests for `SaveRuntimeConfigFile` and `LoadRuntimeConfigFile` using a temp directory, asserting missing file returns a distinct status and atomic save creates `config.json`.

Add two invalid-subdocument preservation tests required by `spp-9`:

```cpp
TEST_CASE(runtime_config_invalid_midi_json_preserves_targets) {
    synth::JsonArena arena(64 * 1024);
    synth::JSON root = arena.Object();
    root.SetNew("schema", arena.String(std::string(synth::kRuntimeConfigSchema)));
    root.SetNew("schemaVersion", arena.Integer(synth::kRuntimeConfigSchemaVersion));
    root.SetNew("midiInstrument", arena.Array());
    root.SetNew("audioDevice", synth::ToJSON(arena, synth::AudioDeviceState{
        .outputDeviceName = "New Out",
        .inputDeviceName = "New In",
    }));

    synth::MidiInstrumentConfig instrument =
        MakeInstrumentFromProfile(synth::WrldBldrDefaultProfileConfig({}), "keep-in", "keep-out");
    synth::AudioDeviceState audio{.outputDeviceName = "Keep Out", .inputDeviceName = "Keep In"};

    REQUIRE_TRUE(!synth::LoadRuntimeConfigJSON(root, instrument, audio));
    REQUIRE_TRUE(instrument.controllers[0].input.identifier == "keep-in");
    REQUIRE_TRUE(audio.outputDeviceName == "Keep Out");
}

TEST_CASE(runtime_config_invalid_audio_json_preserves_targets) {
    synth::JsonArena arena(64 * 1024);
    synth::JSON root = arena.Object();
    root.SetNew("schema", arena.String(std::string(synth::kRuntimeConfigSchema)));
    root.SetNew("schemaVersion", arena.Integer(synth::kRuntimeConfigSchemaVersion));
    root.SetNew("midiInstrument", synth::ToJSON(arena,
        MakeInstrumentFromProfile(synth::WrldBldrDefaultProfileConfig({}), "new-in", "new-out")));
    root.SetNew("audioDevice", arena.Array());

    synth::MidiInstrumentConfig instrument =
        MakeInstrumentFromProfile(synth::WrldBldrDefaultProfileConfig({}), "keep-in", "keep-out");
    synth::AudioDeviceState audio{.outputDeviceName = "Keep Out", .inputDeviceName = "Keep In"};

    REQUIRE_TRUE(!synth::LoadRuntimeConfigJSON(root, instrument, audio));
    REQUIRE_TRUE(instrument.controllers[0].input.identifier == "keep-in");
    REQUIRE_TRUE(audio.outputDeviceName == "Keep Out");
}
```

Expected RED:

```bash
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Expected failure: runtime config helper symbols do not exist.

- [ ] **Step 2: Implement helper API**

In `PatchPersistence.hpp`, declare:

```cpp
inline constexpr std::string_view kRuntimeConfigSchema = "sheaf.synth.runtime-config";
inline constexpr int kRuntimeConfigSchemaVersion = 1;

enum class RuntimeConfigFileStatus {
    Ok,
    Missing,
    Invalid,
    IOError,
};

JSON BuildRuntimeConfigJSON(JsonArena& arena, const MidiInstrumentConfig& instrument,
                            const AudioDeviceState& audioDevice);
bool LoadRuntimeConfigJSON(JSON root, MidiInstrumentConfig& instrument, AudioDeviceState& audioDevice);
bool ValidateRuntimeConfigJSON(JSON root);
RuntimeConfigFileStatus LoadRuntimeConfigFile(const std::filesystem::path& path,
                                              MidiInstrumentConfig& instrument,
                                              AudioDeviceState& audioDevice);
RuntimeConfigFileStatus SaveRuntimeConfigFile(const std::filesystem::path& path,
                                              const MidiInstrumentConfig& instrument,
                                              const AudioDeviceState& audioDevice);
const char* RuntimeConfigFileStatusName(RuntimeConfigFileStatus status);
```

In `PatchPersistence.cpp`, reuse existing `ToJSON/FromJSON` helpers for `MidiInstrumentConfig` and `AudioDeviceState`. Implement file save by creating the parent directory, writing `path + ".tmp"`, closing, then renaming.

- [ ] **Step 3: Verify Task 2**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
```

Expected: runtime config JSON and file tests pass.

### Task 3: Patch-Only Persistence Semantics

**OpenSpec tasks covered:** 3.1, 3.2, 3.3, 3.4.

**Files:**
- Modify: `projects/synth/include/synth/PatchPersistence.hpp`
- Modify: `projects/synth/src/PatchPersistence.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
- Modify: `projects/synth/tests/engine_tests.cpp`
- Modify: `projects/synth/tests/rig_tests.cpp`
- Modify: `projects/synth/tests/miniapp_system_tests.cpp`

- [ ] **Step 1: Write failing patch-only tests**

Update patch tests so `BuildPatchJSON` contains no `midiInstrument`/`audioDevice`:

```cpp
TEST_CASE(patch_json_serializes_parameter_values_only) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});
    auto& parameter = manager.CreateParameter(group, {.name = "Probe", .defaultValue = 0.25f});
    parameter.SceneCenter(0) = 0.75f;
    manager.CaptureDefaultControlState();

    synth::JsonArena arena(64 * 1024);
    synth::JSON root = synth::BuildPatchJSON(arena, "PatchOnly", manager);
    REQUIRE_TRUE(!root.IsNull());
    REQUIRE_TRUE(!root.Get("parameterValues").IsNull());
    REQUIRE_TRUE(root.Get("midiInstrument").IsNull());
    REQUIRE_TRUE(root.Get("audioDevice").IsNull());
}
```

Add an `ApplyPatchMessage` test where default/live instrument and audio state are non-empty, `RevertAllToDefault` runs, and both remain unchanged while parameter values revert.

Expected RED:

```bash
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Expected failure: patch JSON still carries MIDI/audio or APIs still require them.

- [ ] **Step 2: Change patch JSON APIs**

Change signatures to:

```cpp
JSON BuildPatchJSON(JsonArena& arena, std::string_view patchName, const ParameterManager& manager);
bool LoadPatchJSON(JSON root, ParameterManager& manager);
```

Update `ValidatePatchJSON` to require schema/schemaVersion/patchName/parameterValues only. If `midiInstrument` or `audioDevice` exists, ignore it for patch validation unless it corrupts the root shape.

- [ ] **Step 3: Change patch message application**

Change `ApplyPatchMessage` so:

```cpp
case PatchMessageIn::Type::LoadFromJSON:
    return LoadPatchJSON(message.document.root, manager) ? PatchApplyStatus::Applied
                                                         : PatchApplyStatus::InvalidJSON;
case PatchMessageIn::Type::RevertAllToDefault:
    manager.RevertAllToDefaults();
    return PatchApplyStatus::Reverted;
case PatchMessageIn::Type::SerializeToJSON:
    BuildPatchJSON(..., manager);
```

Keep the old parameters in the function signature only if needed to minimize churn, but do not mutate instrument or audio state.

- [ ] **Step 4: Rewrite engine/rig/miniapp patch tests**

Replace tests that expected patch-driven MIDI/audio mutation with assertions that patch load preserves `engine.InstrumentSnapshot()` and `engine.AudioDeviceSnapshot()`.

Specific tests to edit or replace:
- `engine_tick_fires_audio_device_changed_callback_once_when_load_changes_state`
- `engine_initialize_fires_audio_device_changed_callback_for_startup_load`
- `engine_audio_state_shadow_synced_after_startup_drain`
- `engine_patch_save_perturb_load_round_trips_instrument_through_production_messages`
- `engine_edit_instrument_and_pending_patch_load_same_tick_observe_serialized_order`
- `rig_patch_round_trip_through_production_flow`
- `miniapp_rig_patch_save_perturb_load_round_trip`

- [ ] **Step 5: Verify Task 3**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests build/engine_tests build/rig_tests build/miniapp_system_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/engine_tests
projects/synth/build/rig_tests
projects/synth/build/miniapp_system_tests
```

Expected: patch-only persistence tests pass; remaining failures should be runtime UI/data-path wiring not yet implemented.

### Task 4: Engine And Runtime Startup Wiring

**OpenSpec tasks covered:** 4.1, 4.2, 4.3, 4.4, 4.5.

**Files:**
- Modify: `projects/synth/include/synth/Engine.hpp`
- Modify: `projects/synth/runtime/Runtime.hpp`
- Modify: `projects/synth/include/synth/AsyncLogger.hpp` only if test hooks need naming updates.
- Modify: `projects/synth/tests/engine_tests.cpp`
- Modify: `projects/synth/tests/logging_tests.cpp`

- [ ] **Step 1: Write failing startup ordering tests**

In `engine_tests.cpp`, add a test that:
1. Creates `RuntimeDataPaths::FromDataRoot(root)`.
2. Writes `config.json` with a non-default MIDI instrument and audio device.
3. Writes a startup patch under `root / "patches" / "PatchA"` with parameter value `0.75`.
4. Initializes engine with those data paths.
5. Asserts parameter is from patch, instrument/audio are from runtime config, and patch did not overwrite config state.

Expected RED:

```bash
make -C projects/synth build/engine_tests && projects/synth/build/engine_tests
```

Expected failure: engine does not load runtime config and still reads patch root from old config path.

- [ ] **Step 2: Add engine config load phase**

In `Engine::Initialize()` order:
1. `config_ = App::Config()`
2. `app_.Init(&context_)`
3. snapshot app defaults
4. load runtime config from `dataPaths_.configFile` if present
5. capture control defaults/create UI state
6. rebuild MIDI processors
7. load startup patch from `dataPaths_.patchesRoot`

Preserve the existing non-persistence startup work while changing this order: `AsyncLogQueue::s_instance.SetSampleCounterSource(&sampleCounter_)` must remain early in initialization, and default instrument/audio snapshots plus `lastNotifiedAudioDeviceState_` shadow seeding must still happen after `app_.Init()`. If runtime config load changes `audioDeviceState_`, update `lastNotifiedAudioDeviceState_` to the loaded state before startup patch processing so change-detection bookkeeping does not compare against the old app default.

Expose helper methods needed by runtime:

```cpp
RuntimeConfigFileStatus LoadRuntimeConfiguration();
RuntimeConfigFileStatus SaveRuntimeConfiguration() const;
```

`SaveRuntimeConfiguration()` snapshots `instrumentConfig_` under the existing mutex discipline used by `InstrumentSnapshot()` and snapshots audio with `AudioDeviceSnapshot()`.

- [ ] **Step 3: Resolve production data paths in runtime**

In `Runtime.hpp`, add:

```cpp
static synth::RuntimeDataPaths DefaultDataPathsForApp(const synth::RuntimeConfig& config);
```

For macOS use:

```cpp
juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
    .getChildFile("Sheaf")
    .getChildFile(config.appName.empty() ? "SynthApp" : config.appName)
```

Before configuring logs or initializing engine:

```cpp
const synth::RuntimeConfig appConfig = App::Config();
dataPaths_ = dataPathsOverride_.has_value() ? *dataPathsOverride_ : DefaultDataPathsForApp(appConfig);
std::filesystem::create_directories(dataPaths_.patchesRoot, ec);
std::filesystem::create_directories(dataPaths_.logsRoot, ec);
engine_.SetRuntimeDataPaths(dataPaths_);
synth::AsyncLogQueue::s_instance.ConfigureLogDirectory(dataPaths_.logsRoot.string().c_str());
```

Add test-only/runtime override:

```cpp
void SetRuntimeDataPathsForTesting(synth::RuntimeDataPaths paths);
const synth::RuntimeDataPaths& DataPaths() const;
```

- [ ] **Step 4: Log config load/save statuses**

Every runtime config load/save should `INFO("Runtime config load status=%s path=%s", ...)` or equivalent. Configure logger from `dataPaths_.logsRoot`.

- [ ] **Step 5: Verify Task 4**

Run:

```bash
make -C projects/synth build/engine_tests build/logging_tests
projects/synth/build/engine_tests
projects/synth/build/logging_tests
```

Expected: startup ordering, logger directory, and patch-after-config behavior pass.

### Task 5: In-App Patch Browser

**OpenSpec tasks covered:** 5.1, 5.2, 5.3, 5.4, 5.5, 5.6.

**Files:**
- Create: `projects/synth/include/synth/PatchBrowser.hpp`
- Create: `projects/synth/src/PatchBrowser.cpp`
- Create or modify: `projects/synth/tests/patch_browser_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify: `projects/synth/runtime/Runtime.hpp` if adding `std::filesystem::path` overloads for patch save/load; otherwise keep conversion local in `FilePage.hpp`.
- Modify: `projects/synth/runtime/FilePage.hpp`
- Modify: `projects/synth/runtime/juce_build.mk` if needed for new header discovery.

- [ ] **Step 1: Write failing JUCE-free patch browser tests**

Create `projects/synth/tests/patch_browser_tests.cpp` with test harness style matching other synth tests. Required tests:
- `PatchBrowserListsPatchDirectoriesDeterministically`
- `PatchBrowserRejectsAbsoluteAndParentPaths`
- `PatchBrowserSaveAsPathStaysUnderRoot`
- `PatchBrowserLoadPathRequiresExistingPatchDirectory`

Example expected API:

```cpp
synth::PatchBrowserModel browser(root);
browser.Refresh();
REQUIRE_TRUE(browser.Entries()[0].name == "Alpha");
auto savePath = browser.PathForNewPatchName("Bright Lead");
REQUIRE_TRUE(savePath.has_value());
REQUIRE_TRUE(*savePath == root / "Bright Lead");
REQUIRE_TRUE(!browser.PathForNewPatchName("../Escape").has_value());
```

Expected RED:

```bash
make -C projects/synth build/patch_browser_tests
```

Expected failure: target/model does not exist.

- [ ] **Step 2: Implement JUCE-free model**

`PatchBrowserModel` should:
- own a root path
- list immediate child directories only
- sort by filename string
- ignore loose JSON files at root
- validate names/path components reject empty, absolute, `.`, `..`, separators, and root escapes
- return absolute paths under root for Save As and Load

- [ ] **Step 3: Add Makefile target**

Add:

```make
PATCH_BROWSER_TEST_BIN := $(BUILD_DIR)/patch_browser_tests
SRC := ... src/PatchBrowser.cpp
OBJ := ... $(BUILD_DIR)/PatchBrowser.o
$(PATCH_BROWSER_TEST_BIN): tests/patch_browser_tests.cpp $(LIB) include/synth/PatchBrowser.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(LIB) -o $@
test: ... $(PATCH_BROWSER_TEST_BIN)
	...
	$(PATCH_BROWSER_TEST_BIN)
```

- [ ] **Step 4: Replace OS chooser in `FilePage`**

Remove `#include <juce_gui_extra/juce_gui_extra.h>`, `std::unique_ptr<juce::FileChooser> fileChooser_`, `LaunchSaveAsChooser()`, and `LaunchLoadChooser()`. The replacement browser root must come from `runtime_.GetEngine().DataPaths().patchesRoot`, not from the removed `RuntimeConfig::patchesRoot`.

Add a simple in-page mode:

```cpp
enum class BrowserMode { None, SaveAs, Load };
BrowserMode browserMode_ = BrowserMode::None;
synth::PatchBrowserModel browser_;
juce::TextEditor saveAsName_;
juce::ListBox browserList_;
juce::TextButton confirmButton_;
juce::TextButton cancelButton_;
```

The first implementation can be plain and utilitarian: show patch commands, optional save-name editor, list of patch directories, Confirm, Cancel. Confirm Save As either calls a new runtime overload `runtime_.SavePatchAs(std::filesystem::path)` or wraps the validated model path at the call site:

```cpp
runtime_.SavePatchAs(juce::File(savePath->string()));
```

Confirm Load should follow the same rule:

```cpp
runtime_.LoadPatch(juce::File(selected.path.string()));
```

Do not pass `std::filesystem::path` directly to the existing `juce::File` patch APIs unless an overload is added in `Runtime.hpp`.

- [ ] **Step 5: Verify Task 5**

Run:

```bash
make -C projects/synth build/patch_browser_tests
projects/synth/build/patch_browser_tests
make -C projects/synth apps
```

Expected: browser tests pass and miniapp JUCE build compiles without `FileChooser` usage in `FilePage.hpp`.

### Task 6: Configuration Save On Back

**OpenSpec tasks covered:** 6.1, 6.2, 6.3, 6.4, 6.5.

**Files:**
- Modify: `projects/synth/include/synth/Engine.hpp`
- Modify: `projects/synth/runtime/Runtime.hpp`
- Modify: `projects/synth/runtime/MainPane.hpp`
- Modify: `projects/synth/runtime/AudioConfigPage.hpp` comments if needed.
- Modify: `projects/synth/runtime/ControllersPage.hpp` comments if needed.
- Modify: `projects/synth/tests/engine_tests.cpp`

- [ ] **Step 1: Write failing save snapshot tests**

In `engine_tests.cpp`, add tests for:
- `engine_save_runtime_configuration_writes_current_instrument_and_audio`
- `engine_save_runtime_configuration_does_not_write_patch_values`
- `main_pane_audio_back_saves_runtime_configuration`
- `main_pane_controllers_back_saves_runtime_configuration`
- `main_pane_file_back_does_not_save_runtime_configuration`

Use `engine.EditInstrument(...)`, `engine.SetAudioDeviceFromHost(...)`, `engine.SaveRuntimeConfiguration()`, then `LoadRuntimeConfigFile(dataPaths.configFile, ...)` to assert saved state.

For the three Back-button scenarios, prefer a thin runtime test double if a JUCE-free seam is introduced for Back routing; otherwise add a focused JUCE test helper or documented manual smoke assertion that directly invokes each page's `onBack` callback and counts calls to `Runtime::SaveRuntimeConfiguration()`. The required observable behavior is:

```cpp
audioPage_.onBack();       // save count increments once, page becomes None
controllersPage_.onBack(); // save count increments once, page becomes None
filePage_.onBack();        // save count remains unchanged, page becomes None
```

Expected RED:

```bash
make -C projects/synth build/engine_tests && projects/synth/build/engine_tests
```

Expected failure: save method does not exist.

- [ ] **Step 2: Add runtime save method**

In `Runtime.hpp`:

```cpp
synth::RuntimeConfigFileStatus SaveRuntimeConfiguration() {
    const auto status = engine_.SaveRuntimeConfiguration();
    INFO("Runtime config save status=%s path=%s",
         synth::RuntimeConfigFileStatusName(status), engine_.DataPaths().configFile.string().c_str());
    return status;
}
```

- [ ] **Step 3: Wire Back behavior in `MainPane`**

Change constructor wiring:

```cpp
audioPage_.onBack = [this] {
    runtime_.SaveRuntimeConfiguration();
    ShowPage(Page::None);
};
controllersPage_.onBack = [this] {
    runtime_.SaveRuntimeConfiguration();
    ShowPage(Page::None);
};
filePage_.onBack = [this] { ShowPage(Page::None); };
```

Keep File Back as navigation only.

- [ ] **Step 4: Verify Task 6**

Run:

```bash
make -C projects/synth build/engine_tests
projects/synth/build/engine_tests
make -C projects/synth apps
```

Expected: save snapshot tests pass and JUCE pages compile.

### Task 7: Documentation, OpenSpec Progress, And Full Verification

**OpenSpec tasks covered:** 7.1, 7.2, 7.3, 7.4, 7.5 plus checkbox synchronization for all earlier tasks.

**Files:**
- Modify: `projects/synth/apps/miniapp/README.md`
- Modify: comments in `projects/synth/apps/miniapp/MiniAppCore.hpp`, `Runtime.hpp`, `FilePage.hpp`, and `Engine.hpp`
- Modify: `openspec/changes/add-synth-runtime-data-directory/tasks.md`

- [ ] **Step 1: Update docs/comments**

Miniapp README must describe:
- production data root: OS app data directory under `Sheaf/<appName>`
- `patches/`
- `logs/`
- `config.json`
- in-app patch browser
- tests use scratch data paths, not production `/tmp`

Remove stale comments saying production miniapp writes patches/logs to deterministic temp roots.

- [ ] **Step 2: Run targeted tests**

Run:

```bash
make -C projects/synth build/contract_tests build/parameter_modulation_tests build/patch_browser_tests build/engine_tests build/rig_tests build/miniapp_system_tests build/logging_tests
projects/synth/build/contract_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/patch_browser_tests
projects/synth/build/engine_tests
projects/synth/build/rig_tests
projects/synth/build/miniapp_system_tests
projects/synth/build/logging_tests
```

Expected: all targeted tests pass.

- [ ] **Step 3: Run full synth suite**

Run:

```bash
make -C projects/synth test
```

Expected: all synth tests pass.

- [ ] **Step 4: Run OpenSpec validation**

Run:

```bash
openspec validate add-synth-runtime-data-directory
openspec status --change add-synth-runtime-data-directory
```

Expected: change is valid; task progress reflects completed work.

- [ ] **Step 5: Mark OpenSpec tasks complete**

Only after implementation and review, update all relevant checkboxes in:

```text
openspec/changes/add-synth-runtime-data-directory/tasks.md
```

Do not mark tasks 7.3, 7.4, or 7.5 complete until the command output has been observed.

## Final Review

After all tasks are complete and tests pass, run one final xagent Opus review over the complete diff:

```bash
plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "Review the complete implementation of OpenSpec change add-synth-runtime-data-directory. Findings first, severity ordered, concrete file/line references. Check spec compliance, runtime startup ordering, patch/config persistence split, path containment, and tests. Call out uncertainty."
```

Fix every actionable finding, then rerun targeted tests affected by the fix and rerun the final Opus review if the fix materially changes reviewed code.
