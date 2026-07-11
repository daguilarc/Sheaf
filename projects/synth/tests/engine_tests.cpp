#include "synth/AppRegistry.hpp"
#include "synth/Engine.hpp"
#include "synth/RuntimePagePolicy.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth engine tests must not see JUCE headers"
#endif

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct TestCase {
    const char* name;
    void (*fn)();
};

std::vector<TestCase>& Registry() {
    static std::vector<TestCase> tests;
    return tests;
}

struct Register {
    Register(const char* name, void (*fn)()) {
        Registry().push_back({name, fn});
    }
};

#define TEST_CASE(name) \
    void name(); \
    Register reg_##name(#name, &name); \
    void name()

#define REQUIRE_TRUE(expr) \
    do { \
        if (!(expr)) { \
            std::ostringstream oss; \
            oss << __FILE__ << ":" << __LINE__ << " requirement failed: " #expr; \
            throw std::runtime_error(oss.str()); \
        } \
    } while (false)

void RequireNear(float actual, float expected, float tolerance, const char* expr) {
    if (std::fabs(actual - expected) > tolerance) {
        std::ostringstream oss;
        oss << expr << " expected " << expected << " got " << actual;
        throw std::runtime_error(oss.str());
    }
}

#define REQUIRE_NEAR(actual, expected, tolerance) RequireNear((actual), (expected), (tolerance), #actual)

struct EngineTestApp {
    static inline bool sawNullUiStateDuringInit = false;
    static inline int initCalls = 0;
    static inline double preparedSampleRate = 0.0;
    static inline int preparedBlockSize = 0;
    // processLiteAlpha is configurable per-test via this static, read by
    // Init() when building the parameter group (must be set before
    // constructing the Engine, since Init() runs during Engine::Initialize).
    static inline float processLiteAlpha = 1.0f;
    // When set, Init() installs a minimal encoder MIDI-input profile so
    // RebuildMidiProcessors() produces a non-null, freshly-allocated
    // MidiInProcessor each time it runs (tests that need to observe rebuild
    // identity/ordering set this before constructing the Engine; default
    // false keeps every other test's profile empty, as before).
    static inline bool wantEncoderMidiInput = false;
    synth::AppContext* context = nullptr;
    synth::ParameterId probeId = 0;
    synth::BankSlot* probeSlot = nullptr;
    int processBlockCalls = 0;
    float lastProbeDuringBlock = -1.0f;
    float lastProbeSceneCenterDuringBlock = -1.0f;
    std::uint64_t lastBlockStartSample = 0;

    static synth::RuntimeConfig Config() {
        synth::RuntimeConfig config;
        config.appName = "EngineTest";
        config.numAudioOutputs = 2;
        return config;
    }
    void Init(synth::AppContext* ctx) {
        ++initCalls;
        context = ctx;
        sawNullUiStateDuringInit = (ctx->uiState == nullptr);
        if (wantEncoderMidiInput && ctx->instrument != nullptr) {
            synth::MidiControllerSlot slot;
            slot.name = "test";
            slot.kind = synth::MidiProfileKind::Generic;
            slot.config.encoderInput = synth::EncoderMidiInConfig{};
            ctx->instrument->AddController(std::move(slot));
        }
        auto& group = ctx->parameterManager->CreateGroup({.numVoices = 1,
                                                           .numModulators = 0,
                                                           .numScenes = 1,
                                                           .maxParameters = 4,
                                                           .processLiteAlpha = processLiteAlpha,
                                                           .targetCenterAlpha = 1.0f});
        auto& probe = ctx->parameterManager->CreateParameter(group, {.name = "Probe", .defaultValue = 0.25f});
        probeId = probe.Id();

        // Bank/slot routing so MessageIn::ParamIncDec(slotIx=0, position=0, delta)
        // reaches the probe parameter, matching the miniapp's CreateBank /
        // CreateBankSlot / AddPhysicalEncoder / AddMapping / SelectBank shape.
        auto& bank = ctx->parameterManager->CreateBank();
        bank.AddMapping(/*encoderId=*/0, probe);
        probeSlot = &ctx->parameterManager->CreateBankSlot();
        probeSlot->AddPhysicalEncoder(/*encoderId=*/0);
        probeSlot->SelectBank(&bank);
    }
    void PrepareToPlay(double sampleRate, int blockSize) {
        preparedSampleRate = sampleRate;
        preparedBlockSize = blockSize;
    }
    void ProcessBlock(synth::AudioBlock& block) {
        ++processBlockCalls;
        lastBlockStartSample = block.startSample;
        for (std::size_t frame = 0; frame < block.numFrames; ++frame) {
            context->parameterManager->ParameterById(probeId).ProcessLite();
        }
        // Read after the per-frame slewing above. The engine pump applies
        // patch/UI/MIDI messages before calling into the app, but it no
        // longer recomputes parameter targets at the host block boundary.
        auto& probe = context->parameterManager->ParameterById(probeId);
        lastProbeDuringBlock = probe.CurrentCenter();
        lastProbeSceneCenterDuringBlock = probe.SceneCenter(0);
        for (int channel = 0; channel < block.numOutputChannels; ++channel) {
            float* out = block.outputs[channel];
            if (out == nullptr) {
                continue;
            }
            for (std::size_t frame = 0; frame < block.numFrames; ++frame) {
                out[frame] = 0.5f;
            }
        }
    }
};

// Builds a patch JSON document (matching EngineTestApp's Init topology, i.e.
// a single group with the "Probe" parameter) with Probe set to probeValue,
// and writes it as a version file in patchDir via SavePatchVersionInDirectory
// at the given time point. Some tests append legacy audio/instrument sections
// after BuildPatchJSON to prove patch application ignores old runtime config
// embedded in patch files.
void WriteProbePatchVersion(const std::filesystem::path& patchDir, float probeValue,
                            std::chrono::system_clock::time_point when,
                            const synth::AudioDeviceState& audioDevice = {},
                            const synth::MidiInstrumentConfig& instrument = {}) {
    synth::ParameterManager scratchManager;
    auto& group = scratchManager.CreateGroup(
        {.numVoices = 1, .numModulators = 0, .numScenes = 1, .maxParameters = 4, .processLiteAlpha = 1.0f});
    const synth::ParameterId probeId = scratchManager.RegisterParameter(group, {.name = "Probe", .defaultValue = 0.25f});
    scratchManager.ParameterById(probeId).SceneCenter(0) = probeValue;
    scratchManager.CaptureDefaultControlState();
    scratchManager.ComputeAllParameters();

    synth::JsonArena arena(64 * 1024);
    synth::JSON root = synth::BuildPatchJSON(arena, "Probe Patch", scratchManager, instrument, audioDevice);
    if (!instrument.controllers.empty()) {
        root.SetNew("midiInstrument", synth::ToJSON(arena, instrument));
    }
    if (!audioDevice.outputDeviceName.empty() || !audioDevice.inputDeviceName.empty()) {
        root.SetNew("audioDevice", synth::ToJSON(arena, audioDevice));
    }
    REQUIRE_TRUE(!root.IsNull());
    char* dumped = root.Dumps(JSON_ENCODE_ANY);
    REQUIRE_TRUE(dumped != nullptr);
    const std::string jsonText(dumped);
    std::free(dumped);

    synth::SavePatchVersionInDirectory(patchDir, jsonText, when);
}

synth::MidiInstrumentConfig MakeRuntimeConfigInstrument(std::string name) {
    synth::MidiInstrumentConfig instrument;
    synth::MidiControllerSlot slot;
    slot.name = std::move(name);
    slot.kind = synth::MidiProfileKind::Generic;
    slot.config.encoderInput = synth::EncoderMidiInConfig{};
    REQUIRE_TRUE(instrument.AddController(std::move(slot)));
    return instrument;
}

void WriteRuntimeConfigFile(const std::filesystem::path& configFile,
                            const synth::MidiInstrumentConfig& instrument,
                            const synth::AudioDeviceState& audioDevice) {
    const synth::RuntimeConfigFileStatus status = synth::SaveRuntimeConfigFile(configFile, instrument, audioDevice);
    REQUIRE_TRUE(status == synth::RuntimeConfigFileStatus::Ok);
}

std::string ReadTextFile(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    REQUIRE_TRUE(static_cast<bool>(in));
    std::ostringstream out;
    out << in.rdbuf();
    return out.str();
}

}  // namespace

TEST_CASE(engine_initialize_orders_init_before_ui_state) {
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    REQUIRE_TRUE(EngineTestApp::sawNullUiStateDuringInit);
    REQUIRE_TRUE(engine.Context().uiState != nullptr);
    REQUIRE_TRUE(EngineTestApp::initCalls >= 1);
}

TEST_CASE(engine_prepare_forwards_negotiated_values) {
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(44100.0, 128);
    REQUIRE_NEAR(static_cast<float>(EngineTestApp::preparedSampleRate), 44100.0f, 1e-3f);
    REQUIRE_TRUE(EngineTestApp::preparedBlockSize == 128);
}

TEST_CASE(engine_full_concept_rejects_ui_less_core) {
    REQUIRE_TRUE(synth::SynthApplicationCore<EngineTestApp>);
    REQUIRE_TRUE(!synth::SynthApplication<EngineTestApp>);
}

TEST_CASE(engine_missing_patches_root_keeps_defaults_silently) {
    const std::filesystem::path dataRoot = std::filesystem::temp_directory_path() / "engine-no-such-data-root";
    std::filesystem::remove_all(dataRoot);
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.SetRuntimeDataPaths(synth::RuntimeDataPaths::FromDataRoot(dataRoot));
    engine.Initialize();  // must not throw or report failure
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).GetRaw(0), 0.25f, 1e-5f);
}

TEST_CASE(engine_startup_loads_lexicographically_latest_patch) {
    const std::filesystem::path dataRoot =
        std::filesystem::temp_directory_path() / "engine-startup-data-root";
    std::filesystem::remove_all(dataRoot);
    const synth::RuntimeDataPaths paths = synth::RuntimeDataPaths::FromDataRoot(dataRoot);
    std::filesystem::create_directories(paths.patchesRoot);

    const std::filesystem::path dirAAA = paths.patchesRoot / "AAA";
    const std::filesystem::path dirZZZ = paths.patchesRoot / "ZZZ";

    // "AAA" gets the numerically later time point (greater version filename);
    // "ZZZ" gets the earlier one. The rule is greatest VERSION FILENAME wins,
    // not directory name, so "AAA" (0.75) must win over "ZZZ" (0.5) despite
    // "ZZZ" sorting later alphabetically as a directory name.
    const auto earlier = std::chrono::system_clock::from_time_t(1700000000);
    const auto later = earlier + std::chrono::seconds(1);

    WriteProbePatchVersion(dirZZZ, 0.5f, earlier);
    WriteProbePatchVersion(dirAAA, 0.75f, later);

    const auto latestDir = synth::Engine<EngineTestApp>::LatestPatchDirectory(paths.patchesRoot);
    REQUIRE_TRUE(latestDir.has_value());
    REQUIRE_TRUE(latestDir->filename() == "AAA");

    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.SetRuntimeDataPaths(paths);
    engine.Initialize();
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).GetRaw(0), 0.75f, 1e-5f);

    std::filesystem::remove_all(dataRoot);
}

TEST_CASE(engine_initialize_loads_runtime_config_before_midi_processors_and_then_startup_patch) {
    const std::filesystem::path dataRoot =
        std::filesystem::temp_directory_path() / "engine-runtime-config-before-midi-data-root";
    std::filesystem::remove_all(dataRoot);
    const synth::RuntimeDataPaths paths = synth::RuntimeDataPaths::FromDataRoot(dataRoot);
    std::filesystem::create_directories(paths.patchesRoot);

    const synth::MidiInstrumentConfig runtimeInstrument = MakeRuntimeConfigInstrument("runtime-loaded");
    const synth::AudioDeviceState runtimeAudio{.outputDeviceName = "Runtime Output", .inputDeviceName = "Runtime Input"};
    WriteRuntimeConfigFile(paths.configFile, runtimeInstrument, runtimeAudio);

    const synth::MidiInstrumentConfig legacyPatchInstrument = MakeRuntimeConfigInstrument("legacy-patch");
    WriteProbePatchVersion(paths.patchesRoot / "PatchA", 0.75f, std::chrono::system_clock::now(),
                           synth::AudioDeviceState{.outputDeviceName = "Patch Output", .inputDeviceName = "Patch Input"},
                           legacyPatchInstrument);

    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = false;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.SetRuntimeDataPaths(paths);
    engine.Initialize();

    REQUIRE_TRUE(engine.DefaultInstrument().controllers.empty());
    REQUIRE_TRUE(engine.LiveInstrument().controllers.size() == 1);
    REQUIRE_TRUE(engine.LiveInstrument().controllers.front().name == "runtime-loaded");
    REQUIRE_TRUE(engine.MidiControllerCount() == 1);
    REQUIRE_TRUE(engine.MidiInputProcessor(0) != nullptr);
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName == "Runtime Output");
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().inputDeviceName == "Runtime Input");
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).GetRaw(0), 0.75f, 1e-5f);

    std::filesystem::remove_all(dataRoot);
}

TEST_CASE(engine_initialize_ignores_invalid_runtime_config_and_still_loads_startup_patch) {
    const std::filesystem::path dataRoot =
        std::filesystem::temp_directory_path() / "engine-invalid-runtime-config-data-root";
    std::filesystem::remove_all(dataRoot);
    const synth::RuntimeDataPaths paths = synth::RuntimeDataPaths::FromDataRoot(dataRoot);
    std::filesystem::create_directories(paths.dataRoot);
    std::filesystem::create_directories(paths.patchesRoot);

    {
        std::ofstream out(paths.configFile, std::ios::binary | std::ios::trunc);
        out << R"({"schema":"wrong","schemaVersion":1})";
    }
    WriteProbePatchVersion(paths.patchesRoot / "PatchA", 0.7f, std::chrono::system_clock::now());

    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = true;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.SetRuntimeDataPaths(paths);
    engine.Initialize();

    REQUIRE_TRUE(engine.LiveInstrument().controllers.size() == 1);
    REQUIRE_TRUE(engine.LiveInstrument().controllers.front().name == "test");
    REQUIRE_TRUE(engine.MidiControllerCount() == 1);
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName.empty());
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).GetRaw(0), 0.7f, 1e-5f);

    std::filesystem::remove_all(dataRoot);
    EngineTestApp::wantEncoderMidiInput = false;
}

TEST_CASE(engine_initialize_treats_missing_runtime_config_as_defaults_and_still_loads_startup_patch) {
    const std::filesystem::path dataRoot =
        std::filesystem::temp_directory_path() / "engine-missing-runtime-config-data-root";
    std::filesystem::remove_all(dataRoot);
    const synth::RuntimeDataPaths paths = synth::RuntimeDataPaths::FromDataRoot(dataRoot);
    std::filesystem::create_directories(paths.patchesRoot);
    WriteProbePatchVersion(paths.patchesRoot / "PatchA", 0.8f, std::chrono::system_clock::now());

    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = true;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.SetRuntimeDataPaths(paths);
    engine.Initialize();

    REQUIRE_TRUE(engine.LiveInstrument().controllers.size() == 1);
    REQUIRE_TRUE(engine.LiveInstrument().controllers.front().name == "test");
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName.empty());
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).GetRaw(0), 0.8f, 1e-5f);

    std::filesystem::remove_all(dataRoot);
    EngineTestApp::wantEncoderMidiInput = false;
}

TEST_CASE(engine_save_runtime_configuration_snapshots_current_midi_and_audio_state) {
    const std::filesystem::path dataRoot =
        std::filesystem::temp_directory_path() / "engine-save-runtime-config-data-root";
    std::filesystem::remove_all(dataRoot);
    const synth::RuntimeDataPaths paths = synth::RuntimeDataPaths::FromDataRoot(dataRoot);

    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = true;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.SetRuntimeDataPaths(paths);
    engine.Initialize();
    engine.EditInstrument([](synth::MidiInstrumentConfig& instrument) {
        REQUIRE_TRUE(instrument.RenameController(0, "saved-controller"));
    });
    engine.SetAudioDeviceFromHost(synth::AudioDeviceState{.outputDeviceName = "Saved Output",
                                                          .inputDeviceName = "Saved Input"});

    const synth::RuntimeConfigFileStatus saveStatus = engine.SaveRuntimeConfiguration();
    REQUIRE_TRUE(saveStatus == synth::RuntimeConfigFileStatus::Ok);

    synth::MidiInstrumentConfig loadedInstrument;
    synth::AudioDeviceState loadedAudio;
    const synth::RuntimeConfigFileStatus loadStatus =
        synth::LoadRuntimeConfigFile(paths.configFile, loadedInstrument, loadedAudio);
    REQUIRE_TRUE(loadStatus == synth::RuntimeConfigFileStatus::Ok);
    REQUIRE_TRUE(loadedInstrument.controllers.size() == 1);
    REQUIRE_TRUE(loadedInstrument.controllers.front().name == "saved-controller");
    REQUIRE_TRUE(loadedAudio.outputDeviceName == "Saved Output");
    REQUIRE_TRUE(loadedAudio.inputDeviceName == "Saved Input");

    std::filesystem::remove_all(dataRoot);
    EngineTestApp::wantEncoderMidiInput = false;
}

TEST_CASE(engine_runtime_page_back_policy_saves_config_for_audio_and_controllers_only) {
    const std::filesystem::path dataRoot =
        std::filesystem::temp_directory_path() / "engine-runtime-page-back-save-data-root";
    std::filesystem::remove_all(dataRoot);
    const synth::RuntimeDataPaths paths = synth::RuntimeDataPaths::FromDataRoot(dataRoot);

    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = true;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.SetRuntimeDataPaths(paths);
    engine.Initialize();

    auto simulateBack = [&](synth::RuntimePageKind page) {
        if (synth::RuntimePageBackSavesConfiguration(page)) {
            REQUIRE_TRUE(engine.SaveRuntimeConfiguration() == synth::RuntimeConfigFileStatus::Ok);
        }
    };

    engine.EditInstrument([](synth::MidiInstrumentConfig& instrument) {
        REQUIRE_TRUE(instrument.RenameController(0, "audio-back-controller"));
    });
    engine.SetAudioDeviceFromHost(synth::AudioDeviceState{.outputDeviceName = "Audio Back Output",
                                                          .inputDeviceName = "Audio Back Input"});
    simulateBack(synth::RuntimePageKind::Audio);

    synth::MidiInstrumentConfig loadedInstrument;
    synth::AudioDeviceState loadedAudio;
    REQUIRE_TRUE(synth::LoadRuntimeConfigFile(paths.configFile, loadedInstrument, loadedAudio) ==
                 synth::RuntimeConfigFileStatus::Ok);
    REQUIRE_TRUE(loadedInstrument.controllers.front().name == "audio-back-controller");
    REQUIRE_TRUE(loadedAudio.outputDeviceName == "Audio Back Output");
    REQUIRE_TRUE(loadedAudio.inputDeviceName == "Audio Back Input");

    std::filesystem::remove(paths.configFile);
    simulateBack(synth::RuntimePageKind::File);
    REQUIRE_TRUE(!std::filesystem::exists(paths.configFile));

    engine.EditInstrument([](synth::MidiInstrumentConfig& instrument) {
        REQUIRE_TRUE(instrument.RenameController(0, "controllers-back-controller"));
    });
    engine.SetAudioDeviceFromHost(synth::AudioDeviceState{.outputDeviceName = "Controllers Back Output",
                                                          .inputDeviceName = "Controllers Back Input"});
    simulateBack(synth::RuntimePageKind::Controllers);

    REQUIRE_TRUE(synth::LoadRuntimeConfigFile(paths.configFile, loadedInstrument, loadedAudio) ==
                 synth::RuntimeConfigFileStatus::Ok);
    REQUIRE_TRUE(loadedInstrument.controllers.front().name == "controllers-back-controller");
    REQUIRE_TRUE(loadedAudio.outputDeviceName == "Controllers Back Output");
    REQUIRE_TRUE(loadedAudio.inputDeviceName == "Controllers Back Input");

    std::filesystem::remove_all(dataRoot);
    EngineTestApp::wantEncoderMidiInput = false;
}

TEST_CASE(engine_runtime_configuration_load_and_save_status_are_logged) {
    const std::filesystem::path dataRoot =
        std::filesystem::temp_directory_path() / "engine-runtime-config-logging-data-root";
    std::filesystem::remove_all(dataRoot);
    const synth::RuntimeDataPaths paths = synth::RuntimeDataPaths::FromDataRoot(dataRoot);

    synth::AsyncLogQueue& log = synth::AsyncLogQueue::s_instance;
    log.ResetForTesting();
    log.SetLogDirectoryForTesting(paths.logsRoot.string().c_str());

    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = false;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.SetRuntimeDataPaths(paths);
    engine.Initialize();
    REQUIRE_TRUE(engine.SaveRuntimeConfiguration() == synth::RuntimeConfigFileStatus::Ok);

    log.DoLog();
    std::ifstream in(log.LogFilePathForTesting());
    const std::string contents((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    REQUIRE_TRUE(contents.find("Runtime config load status=Missing") != std::string::npos);
    REQUIRE_TRUE(contents.find(paths.configFile.string()) != std::string::npos);
    REQUIRE_TRUE(contents.find("Runtime config save status=Ok") != std::string::npos);

    log.ResetForTesting();
    std::filesystem::remove_all(dataRoot);
}

namespace {

// Builds a numFrames-frame, numOutputChannels-channel AudioBlock backed by
// caller-owned storage (the vector-of-vectors below), matching AudioBlock's
// non-owning-pointer contract.
struct TestBlockBuffers {
    std::vector<std::vector<float>> channels;
    std::vector<float*> outputPointers;

    explicit TestBlockBuffers(int numOutputChannels, std::size_t numFrames) {
        channels.resize(static_cast<std::size_t>(numOutputChannels));
        outputPointers.resize(static_cast<std::size_t>(numOutputChannels));
        for (int ch = 0; ch < numOutputChannels; ++ch) {
            channels[static_cast<std::size_t>(ch)].assign(numFrames, 0.0f);
            outputPointers[static_cast<std::size_t>(ch)] = channels[static_cast<std::size_t>(ch)].data();
        }
    }

    synth::AudioBlock Block(std::size_t numFrames) {
        synth::AudioBlock block;
        block.inputs = nullptr;
        block.outputs = outputPointers.data();
        block.numInputChannels = 0;
        block.numOutputChannels = static_cast<int>(outputPointers.size());
        block.numFrames = numFrames;
        return block;
    }
};

}  // namespace

TEST_CASE(sheaf_patch_runtime_configuration_saves_shared_config_without_patch_values) {
    const std::filesystem::path dataRoot =
        std::filesystem::temp_directory_path() / "engine-sheaf-patch-runtime-config-data-root";
    std::filesystem::remove_all(dataRoot);
    const synth::RuntimeDataPaths paths = synth::SheafPatchDataPathsForApp(dataRoot, "miniapp");

    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = true;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.SetRuntimeDataPaths(paths);
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    engine.EditInstrument([](synth::MidiInstrumentConfig& instrument) {
        REQUIRE_TRUE(instrument.RenameController(0, "sheaf-controller"));
    });
    engine.SetAudioDeviceFromHost(synth::AudioDeviceState{.outputDeviceName = "Sheaf Output",
                                                          .inputDeviceName = "Sheaf Input"});

    TestBlockBuffers buffers(2, 4);
    engine.UiBus().Push(synth::MessageIn::ParamIncDec(/*timestamp=*/0, /*slotIx=*/0, /*position=*/0, /*delta=*/0.3f));
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).SceneCenter(0), 0.55f, 1e-4f);

    REQUIRE_TRUE(engine.SaveRuntimeConfiguration() == synth::RuntimeConfigFileStatus::Ok);
    REQUIRE_TRUE(std::filesystem::exists(paths.configFile));
    REQUIRE_TRUE(paths.configFile == dataRoot / "synth" / "sheaf-patch" / "config");
    REQUIRE_TRUE(!std::filesystem::exists(paths.dataRoot / "config.json"));

    const std::string contents = ReadTextFile(paths.configFile);
    REQUIRE_TRUE(contents.find("sheaf-controller") != std::string::npos);
    REQUIRE_TRUE(contents.find("Sheaf Output") != std::string::npos);
    REQUIRE_TRUE(contents.find("Probe") == std::string::npos);
    REQUIRE_TRUE(contents.find("parameters") == std::string::npos);
    REQUIRE_TRUE(contents.find("0.55") == std::string::npos);

    std::filesystem::remove_all(dataRoot);
    EngineTestApp::wantEncoderMidiInput = false;
}

TEST_CASE(sheaf_patch_startup_discovers_only_selected_app_patch_root) {
    const std::filesystem::path dataRoot =
        std::filesystem::temp_directory_path() / "engine-sheaf-patch-patch-isolation-data-root";
    std::filesystem::remove_all(dataRoot);
    const synth::RuntimeDataPaths miniappPaths = synth::SheafPatchDataPathsForApp(dataRoot, "miniapp");
    const synth::RuntimeDataPaths otherAppPaths = synth::SheafPatchDataPathsForApp(dataRoot, "otherapp");
    std::filesystem::create_directories(miniappPaths.patchesRoot);
    std::filesystem::create_directories(otherAppPaths.patchesRoot);

    const auto earlier = std::chrono::system_clock::from_time_t(1700000000);
    const auto later = earlier + std::chrono::seconds(2);
    WriteProbePatchVersion(miniappPaths.patchesRoot / "MiniPatch", 0.75f, earlier);
    WriteProbePatchVersion(otherAppPaths.patchesRoot / "OtherPatch", 0.95f, later);

    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.SetRuntimeDataPaths(miniappPaths);
    engine.Initialize();
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).GetRaw(0), 0.75f, 1e-5f);

    std::filesystem::remove_all(dataRoot);
}

TEST_CASE(sheaf_patch_patch_save_as_writes_under_selected_app_patch_root) {
    const std::filesystem::path dataRoot =
        std::filesystem::temp_directory_path() / "engine-sheaf-patch-patch-save-data-root";
    std::filesystem::remove_all(dataRoot);
    const synth::RuntimeDataPaths miniappPaths = synth::SheafPatchDataPathsForApp(dataRoot, "miniapp");
    const synth::RuntimeDataPaths otherAppPaths = synth::SheafPatchDataPathsForApp(dataRoot, "otherapp");

    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.SetRuntimeDataPaths(miniappPaths);
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    const std::filesystem::path saveDir = miniappPaths.patchesRoot / "SavedPatch";
    const synth::PatchCommandResult saveResult = engine.Patches().SavePatchAs(saveDir);
    REQUIRE_TRUE(saveResult.status == synth::PatchCommandStatus::Pending);

    TestBlockBuffers buffers(2, 4);
    bool written = false;
    for (int iteration = 0; iteration < 16 && !written; ++iteration) {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
        engine.MessageThreadTick();
        written = synth::LatestPatchVersion(saveDir).has_value();
    }

    REQUIRE_TRUE(written);
    REQUIRE_TRUE(saveDir.parent_path() == miniappPaths.patchesRoot);
    REQUIRE_TRUE(!std::filesystem::exists(otherAppPaths.patchesRoot));

    std::filesystem::remove_all(dataRoot);
}

TEST_CASE(engine_pump_applies_messages_before_app_block) {
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{2}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    const float before = engine.Manager().ParameterById(engine.Application().probeId).SceneCenter(0);

    // Push a ParamIncDec against the slot/position registered in Init (slot
    // 0, position 0 maps to the probe parameter via the bank/slot wiring).
    engine.UiBus().Push(synth::MessageIn::ParamIncDec(/*timestamp=*/2, /*slotIx=*/0, /*position=*/0, /*delta=*/0.3f));

    TestBlockBuffers buffers(2, 4);
    synth::AudioBlock block = buffers.Block(4);
    engine.ProcessBlock(block, /*timestamp=*/2);

    REQUIRE_TRUE(engine.Application().processBlockCalls == 1);
    REQUIRE_TRUE(engine.Application().lastProbeSceneCenterDuringBlock != before);
    REQUIRE_NEAR(engine.Application().lastProbeSceneCenterDuringBlock, before + 0.3f, 1e-4f);
    REQUIRE_NEAR(engine.Application().lastProbeDuringBlock, before, 1e-4f);
}

TEST_CASE(engine_audio_block_exposes_monotonic_start_sample) {
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 10);

    TestBlockBuffers buffers(2, 10);
    {
        synth::AudioBlock block = buffers.Block(10);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    REQUIRE_TRUE(engine.Application().lastBlockStartSample == 0);

    {
        synth::AudioBlock block = buffers.Block(10);
        engine.ProcessBlock(block, /*timestamp=*/1);
    }
    REQUIRE_TRUE(engine.Application().lastBlockStartSample == 10);
}

TEST_CASE(engine_process_block_does_not_compute_targets_at_host_block_boundary) {
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 10);

    engine.UiBus().Push(synth::MessageIn::ParamIncDec(/*timestamp=*/0, /*slotIx=*/0, /*position=*/0, /*delta=*/0.3f));

    TestBlockBuffers buffers(2, 10);
    {
        synth::AudioBlock block = buffers.Block(10);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }

    REQUIRE_NEAR(engine.Application().lastProbeDuringBlock, 0.25f, 1e-4f);
    engine.Application().context->parameterManager->ParameterById(engine.Application().probeId).ProcessSample(0);
    REQUIRE_NEAR(engine.Application().context->parameterManager->ParameterById(engine.Application().probeId).CurrentCenter(),
                 0.55f, 1e-4f);
}

TEST_CASE(engine_process_sample_preserves_slew_after_engine_message_pump) {
    EngineTestApp::processLiteAlpha = 0.1f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{1}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    auto& probe = engine.Manager().ParameterById(engine.Application().probeId);
    const float start = probe.CurrentCenter();
    engine.UiBus().Push(synth::MessageIn::ParamIncDec(/*timestamp=*/1, /*slotIx=*/0, /*position=*/0, /*delta=*/0.5f));
    const float target = std::clamp(start + 0.5f, 0.0f, 1.0f);

    TestBlockBuffers buffers(2, 4);

    synth::AudioBlock firstBlock = buffers.Block(4);
    engine.ProcessBlock(firstBlock, /*timestamp=*/1);
    REQUIRE_NEAR(engine.Application().lastProbeDuringBlock, start, 1e-6f);
    probe.ProcessSample(0);
    const float afterFirst = probe.CurrentCenter();
    REQUIRE_TRUE(afterFirst != target);  // no snap: slewed value must not equal target yet

    float previous = afterFirst;
    for (std::uint64_t sample = 1; sample < 64; ++sample) {
        probe.ProcessSample(sample);
        const float current = probe.CurrentCenter();
        REQUIRE_TRUE(current >= previous - 1e-6f);  // approaches monotonically
        previous = current;
    }
    REQUIRE_NEAR(previous, target, 1e-3f);
}

TEST_CASE(engine_pump_calls_app_exactly_once_per_block_and_advances_samples) {
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 64);

    TestBlockBuffers buffers(2, 64);

    synth::AudioBlock firstBlock = buffers.Block(64);
    engine.ProcessBlock(firstBlock, /*timestamp=*/10);
    synth::AudioBlock secondBlock = buffers.Block(64);
    engine.ProcessBlock(secondBlock, /*timestamp=*/11);

    REQUIRE_TRUE(engine.Application().processBlockCalls == 2);
    REQUIRE_TRUE(engine.SampleCount() == 128);
    REQUIRE_NEAR(buffers.channels[0][0], 0.5f, 1e-6f);
}

TEST_CASE(engine_pump_populates_ui_state_at_throttle_cadence) {
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{5}; });
    engine.Initialize();

    // config_.uiFrameHz defaults to 30 (EngineTestApp::Config() doesn't
    // override it), matching the brief's worked example:
    // interval = round(48000 / (30 * 256)) = 6.
    engine.Prepare(48000.0, 256);

    REQUIRE_TRUE(engine.Context().uiState != nullptr);
    auto& cell = engine.Context().uiState->slots[0].cells[0];
    const float initialDisplayCenter =
        engine.Manager().ParameterById(engine.Application().probeId).UIDisplayCenter(0);

    engine.UiBus().Push(synth::MessageIn::ParamIncDec(/*timestamp=*/5, /*slotIx=*/0, /*position=*/0, /*delta=*/0.4f));

    TestBlockBuffers buffers(2, 4);

    // First block: message applied, but UI state must not be republished yet
    // (interval is 6, and PopulateUIState happens after Initialize() as well,
    // so we capture the initial published value first to compare against).
    const float publishedBeforeAnyBlock = cell.values[0].load();

    synth::AudioBlock block1 = buffers.Block(4);
    engine.ProcessBlock(block1, /*timestamp=*/5);
    REQUIRE_NEAR(cell.values[0].load(), publishedBeforeAnyBlock, 1e-6f);  // unchanged: cadence not hit

    auto& probe = engine.Manager().ParameterById(engine.Application().probeId);
    for (std::uint64_t sample = 0; sample < 8000; ++sample) {
        probe.ProcessSample(sample);
    }
    const float advancedCurrentCenter = probe.CurrentCenter();
    REQUIRE_TRUE(advancedCurrentCenter != initialDisplayCenter);

    for (int i = 0; i < 5; ++i) {  // blocks 2..6: the 6th block hits the cadence
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/5);
    }

    REQUIRE_NEAR(probe.SceneCenter(0), 0.65f, 1e-4f);
    REQUIRE_NEAR(cell.values[0].load(), advancedCurrentCenter, 1e-4f);
}

TEST_CASE(engine_pump_stash_is_a_drain_barrier_with_retry_first_ordering) {
    EngineTestApp::processLiteAlpha = 1.0f;  // snap immediately so applied/reverted values are visible this block

    // Tiny arena: SerializeToJSON cannot fit even the patch-only document in
    // 512 bytes, so ApplyPatchMessage reports ArenaExhausted on the first
    // attempt. A single GrowAndReset() doubling is enough to fit it, so one
    // MessageThreadTick() call is enough to clear the barrier below.
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; }, /*initialArenaCapacity=*/512);
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    const float initial = engine.Manager().ParameterById(engine.Application().probeId).SceneCenter(0);
    REQUIRE_NEAR(initial, 0.25f, 1e-5f);

    TestBlockBuffers buffers(2, 4);

    // Move the probe away from its default via a normal UI message so a
    // later revert-to-default is visibly observable.
    engine.UiBus().Push(synth::MessageIn::ParamIncDec(/*timestamp=*/0, /*slotIx=*/0, /*position=*/0, /*delta=*/0.3f));
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    const float moved = engine.Manager().ParameterById(engine.Application().probeId).SceneCenter(0);
    REQUIRE_NEAR(moved, initial + 0.3f, 1e-4f);

    // Enqueue a serialize request (SavePatchAs) via PatchManager. The next
    // ProcessBlock will pop it, exhaust the tiny arena, stash it, and set
    // the grow-pending flag; the drain phase stops for this block without
    // touching anything else queued.
    const std::filesystem::path saveDir =
        std::filesystem::temp_directory_path() / "engine-drain-barrier-save-dir";
    std::filesystem::remove_all(saveDir);
    const synth::PatchCommandResult saveResult = engine.Patches().SavePatchAs(saveDir);
    REQUIRE_TRUE(saveResult.status == synth::PatchCommandStatus::Pending);

    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    REQUIRE_TRUE(engine.HasStashedPatchMessageForTest());  // exhausted and stashed
    REQUIRE_TRUE(engine.IsArenaGrowPendingForTest());      // grow flag set: barrier is up

    // Now enqueue a second patch command (revert to defaults) directly onto
    // patchInputBus_ via the engine's AppContext, bypassing PatchManager's
    // own SavePatchAs/RevertPatch bookkeeping entirely (which is orthogonal
    // to — and would otherwise confound observing — the engine's drain
    // barrier: e.g. PatchManager::RevertPatch()/NewPatch() reset
    // PatchManager's pendingSave_ synchronously at dispatch time, regardless
    // of whether the engine's drain has actually applied the pending save
    // yet). If the drain barrier holds, this RevertAllToDefault message must
    // NOT be applied while the stash is still pending: the probe value must
    // stay at `moved`, not reset back to `initial`.
    REQUIRE_TRUE(engine.Context().patchInputBus->Push(synth::PatchMessageIn::RevertAllToDefault()));

    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }

    // Barrier held: the revert was not applied (probe still at `moved`), and
    // the stash/grow-pending flag are still in force since MessageThreadTick
    // has not run yet.
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).SceneCenter(0), moved, 1e-4f);
    REQUIRE_TRUE(engine.HasStashedPatchMessageForTest());
    REQUIRE_TRUE(engine.IsArenaGrowPendingForTest());

    // Simulate Task 5's tick contract: grow the arena and clear
    // arenaGrowPending_ only (MessageThreadTick must not touch the stash
    // itself per the documented contract).
    engine.MessageThreadTick();
    REQUIRE_TRUE(engine.HasStashedPatchMessageForTest());  // tick must not touch the stash
    REQUIRE_TRUE(!engine.IsArenaGrowPendingForTest());     // tick cleared the grow flag

    // Next block: ProcessBlock must retry the stashed serialize FIRST. It
    // now fits in the grown arena, so it succeeds and the barrier lifts;
    // draining continues in the same block, so the previously-blocked
    // revert now applies too.
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }

    REQUIRE_TRUE(!engine.HasStashedPatchMessageForTest());  // stash retried and succeeded
    const synth::PatchCommandResult processed = engine.Patches().ProcessResponses();
    REQUIRE_TRUE(processed.status == synth::PatchCommandStatus::Written);  // serialize response was produced

    // The revert queued behind the stash has now applied too (drain
    // continued past the retried stash in the same block): the probe is
    // back at its default.
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).SceneCenter(0), initial, 1e-4f);

    std::filesystem::remove_all(saveDir);
}

TEST_CASE(engine_initialize_without_startup_patch_never_fires_rebuilt_callback) {
    // Property 1: Initialize()'s first, pre-startup-patch RebuildMidiProcessors()
    // call (sar-5 step 7) must never invoke midiProcessorsRebuiltCallback_,
    // and with no patchesRoot configured there is no startup patch to apply
    // either, so the callback must not fire at all across Initialize().
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });

    int callbackCalls = 0;
    engine.SetMidiProcessorsRebuiltCallback([&]() { ++callbackCalls; });

    engine.Initialize();

    REQUIRE_TRUE(callbackCalls == 0);
}

TEST_CASE(engine_initialize_applies_startup_patch_without_rebuilt_callback) {
    // Startup patch load applies synthesizer parameter values only. MIDI/audio
    // configuration now lives in the separate runtime config file, so applying
    // a patch during Initialize() must not rebuild MIDI processors or fire the
    // rebuilt callback.
    const std::filesystem::path dataRoot =
        std::filesystem::temp_directory_path() / "engine-initialize-callback-data-root";
    std::filesystem::remove_all(dataRoot);
    const synth::RuntimeDataPaths paths = synth::RuntimeDataPaths::FromDataRoot(dataRoot);
    std::filesystem::create_directories(paths.patchesRoot);
    WriteProbePatchVersion(paths.patchesRoot / "AAA", 0.75f, std::chrono::system_clock::now());

    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.SetRuntimeDataPaths(paths);

    int callbackCalls = 0;
    engine.SetMidiProcessorsRebuiltCallback([&]() { ++callbackCalls; });

    engine.Initialize();

    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).GetRaw(0), 0.75f, 1e-5f);
    REQUIRE_TRUE(callbackCalls == 0);

    std::filesystem::remove_all(dataRoot);
}

TEST_CASE(engine_tick_does_not_rebuild_midi_processors_after_parameter_patch_load) {
    // Runtime patch load applies synthesizer parameter values only. The tick
    // should keep processing MIDI controllers, but it must not perform a MIDI
    // processor rebuild or call the host reopen callback for a parameter-only
    // patch.
    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = true;  // so MidiInputProcessor(0) is non-null and identity-observable
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    int callbackCalls = 0;
    synth::MidiInProcessor* inputProcessorBeforeLoad = engine.MidiInputProcessor(0);
    engine.SetMidiProcessorsRebuiltCallback([&]() {
        ++callbackCalls;
    });

    // Write a patch version (reusing Task 3's WriteProbePatchVersion helper)
    // and enqueue it via PatchManager::LoadPatch, matching the brief's
    // "helper like Task 3's" instruction.
    const std::filesystem::path patchDir =
        std::filesystem::temp_directory_path() / "engine-tick-rebuild-patch-dir";
    std::filesystem::remove_all(patchDir);
    WriteProbePatchVersion(patchDir, 0.9f, std::chrono::system_clock::now());

    const synth::PatchCommandResult loadResult = engine.Patches().LoadPatch(patchDir);
    REQUIRE_TRUE(loadResult.status == synth::PatchCommandStatus::Ok);

    TestBlockBuffers buffers(2, 4);
    {
        // ProcessBlock drains patchInputBus_ and applies the LoadFromJSON
        // message without queuing MIDI/audio side effects.
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).GetRaw(0), 0.9f, 1e-4f);
    REQUIRE_TRUE(callbackCalls == 0);

    engine.MessageThreadTick();

    REQUIRE_TRUE(callbackCalls == 0);
    REQUIRE_TRUE(engine.MidiInputProcessor(0) == inputProcessorBeforeLoad);

    // A second tick with nothing pending must not fire the callback either.
    engine.MessageThreadTick();
    REQUIRE_TRUE(callbackCalls == 0);

    std::filesystem::remove_all(patchDir);
    EngineTestApp::wantEncoderMidiInput = false;  // restore default for subsequent tests
}

TEST_CASE(engine_tick_replies_to_storage_batch_requests) {
    // Dedicated test app variant with a tiny maxParameters group and two
    // modulator slots, matching
    // modulation_view_requests_storage_batch_and_succeeds_after_reinforcement's
    // recipe in parameter_modulation_tests.cpp for provoking
    // ParameterStorageBatchNeeded: a bank/slot mapped to a carrier
    // parameter, with HandlePress(1) requesting the modulation view. The
    // group's storage starts too small to hold the extra modulation-depth
    // parameters, so the manager posts a ParameterStorageBatchNeeded
    // request onto parameterMessageOutBus_ instead of materializing them.
    struct TinyGroupApp {
        static synth::RuntimeConfig Config() {
            synth::RuntimeConfig config;
            config.appName = "EngineTinyGroupTest";
            config.numAudioOutputs = 2;
            return config;
        }
        synth::AppContext* context = nullptr;
        synth::ParameterGroup* group = nullptr;
        synth::Bank* bank = nullptr;
        synth::BankSlot* slot = nullptr;
        synth::Parameter* carrier = nullptr;

        void Init(synth::AppContext* ctx) {
            context = ctx;
            group = &ctx->parameterManager->CreateGroup(
                {.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 2});
            carrier = &ctx->parameterManager->CreateParameter(*group, {.name = "Carrier", .defaultValue = 0.5f});
            auto& filler = ctx->parameterManager->CreateParameter(*group, {.name = "Filler", .defaultValue = 0.25f});
            (void)filler;
            bank = &ctx->parameterManager->CreateBank();
            bank->AddMapping(1, *carrier);
            bank->AddMapping(2, filler);
            slot = &ctx->parameterManager->CreateBankSlot();
            slot->AddPhysicalEncoder(1);
            slot->AddPhysicalEncoder(2);
            slot->AddPhysicalEncoder(3);
            slot->SelectBank(bank);
        }
        void ProcessBlock(synth::AudioBlock&) {}
    };

    synth::Engine<TinyGroupApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    synth::Bank* bank = engine.Application().bank;
    synth::BankSlot* slot = engine.Application().slot;
    REQUIRE_TRUE(!bank->ShowingModulation());

    // Trigger the growth-request path: pressing the mapped encoder asks the
    // manager to show the modulation view, which needs storage the tiny
    // group doesn't have, so it posts ParameterStorageBatchNeeded instead of
    // materializing the depth parameters.
    slot->HandlePress(1);
    REQUIRE_TRUE(!bank->ShowingModulation());  // materialization deferred: no room yet

    TestBlockBuffers buffers(2, 4);
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }

    engine.MessageThreadTick();  // drains parameterMessageOutBus_, replies with a storage batch

    // A subsequent registration/materialization now succeeds since the
    // group has been reinforced with the storage batch the tick provided:
    // re-pressing the same encoder materializes and shows the depth
    // parameters instead of deferring again.
    slot->HandlePress(1);
    REQUIRE_TRUE(bank->ShowingModulation());
    synth::Parameter* carrier = engine.Application().carrier;
    REQUIRE_TRUE(carrier->ModulationDepthParameter(0) != nullptr);
    REQUIRE_TRUE(carrier->ModulationDepthParameter(1) != nullptr);
}

TEST_CASE(engine_tick_grows_arena_and_retries_stashed_patch_message) {
    EngineTestApp::processLiteAlpha = 1.0f;

    // Tiny starting arena (64 bytes), matching the brief's initialArenaCapacity
    // constructor-parameter approach: far too small to serialize a patch
    // document, so the first ProcessBlock after SavePatchAs is expected to
    // exhaust and stash. Each MessageThreadTick doubles the arena
    // (GrowSerializationArenaForTick), so this drives the real grow/retry
    // loop end to end through the actual MessageThreadTick, bounded at 10
    // iterations, until the version file appears on disk under saveDir.
    //
    // Deliberately does NOT call patchManager_.ProcessResponses() directly
    // anywhere in this loop: MessageThreadTick's own step 3 is the only
    // thing that drains patchOutputBus_ here, so if the tick ever skipped
    // response processing, this test would stall out and fail the
    // iteration bound rather than passing vacuously.
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; }, /*initialArenaCapacity=*/64);
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    const std::filesystem::path saveDir =
        std::filesystem::temp_directory_path() / "engine-tick-arena-grow-save-dir";
    std::filesystem::remove_all(saveDir);

    const synth::PatchCommandResult saveResult = engine.Patches().SavePatchAs(saveDir);
    REQUIRE_TRUE(saveResult.status == synth::PatchCommandStatus::Pending);

    TestBlockBuffers buffers(2, 4);
    bool written = false;
    for (int iteration = 0; iteration < 10 && !written; ++iteration) {
        {
            synth::AudioBlock block = buffers.Block(4);
            engine.ProcessBlock(block, /*timestamp=*/0);
        }

        // MessageThreadTick's step 2 grows the arena when grow-pending is
        // set (clearing the barrier so the next ProcessBlock retries the
        // stash), and its step 3 (patchManager_.ProcessResponses()) drains
        // whatever response arrived this tick -- including the
        // SerializedJSON response a successful retry inside the preceding
        // ProcessBlock pushed onto patchOutputBus_. The tick is the only
        // thing under test that can make the version file show up on disk.
        engine.MessageThreadTick();

        written = synth::LatestPatchVersion(saveDir).has_value();
    }

    REQUIRE_TRUE(written);
    REQUIRE_TRUE(!engine.HasStashedPatchMessageForTest());
    REQUIRE_TRUE(!engine.IsArenaGrowPendingForTest());

    const auto latestVersion = synth::LatestPatchVersion(saveDir);
    REQUIRE_TRUE(latestVersion.has_value());
    REQUIRE_TRUE(std::filesystem::exists(*latestVersion));

    std::filesystem::remove_all(saveDir);
}

TEST_CASE(engine_logs_patch_apply_and_storage_batch_activity_for_slog_7) {
    // Regression for slog-7: the audio-thread patch drain (ProcessBlock) must
    // INFO-log each ApplyPatchMessage outcome, and the message-thread tick
    // must INFO-log storage-batch provisioning. Both run on ThreadId::Unknown
    // in this JUCE-free test binary (no ScopedThreadId tagging here), so
    // QueueSizeForTesting(ThreadId::Unknown) is where both land.
    synth::AsyncLogQueue& log = synth::AsyncLogQueue::s_instance;
    log.ResetForTesting();

    // --- Patch apply outcome, logged from ProcessBlock's audio-thread drain ---
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    // NewPatch() enqueues a RevertAllToDefault message onto patchInputBus_;
    // ProcessBlock's drain applies it synchronously and must log the outcome.
    const synth::PatchCommandResult newPatchResult = engine.Patches().NewPatch();
    REQUIRE_TRUE(newPatchResult.status == synth::PatchCommandStatus::Ok);

    const std::size_t queueSizeBeforePatchDrain = log.QueueSizeForTesting(synth::ThreadId::Unknown);
    TestBlockBuffers buffers(2, 4);
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    REQUIRE_TRUE(log.QueueSizeForTesting(synth::ThreadId::Unknown) > queueSizeBeforePatchDrain);

    // --- Storage-batch provisioning, logged from MessageThreadTick ---
    struct TinyGroupApp {
        static synth::RuntimeConfig Config() {
            synth::RuntimeConfig config;
            config.appName = "EngineLoggingTinyGroupTest";
            config.numAudioOutputs = 2;
            return config;
        }
        synth::AppContext* context = nullptr;
        synth::ParameterGroup* group = nullptr;
        synth::Bank* bank = nullptr;
        synth::BankSlot* slot = nullptr;
        synth::Parameter* carrier = nullptr;

        void Init(synth::AppContext* ctx) {
            context = ctx;
            group = &ctx->parameterManager->CreateGroup(
                {.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 2});
            carrier = &ctx->parameterManager->CreateParameter(*group, {.name = "Carrier", .defaultValue = 0.5f});
            auto& filler = ctx->parameterManager->CreateParameter(*group, {.name = "Filler", .defaultValue = 0.25f});
            (void)filler;
            bank = &ctx->parameterManager->CreateBank();
            bank->AddMapping(1, *carrier);
            bank->AddMapping(2, filler);
            slot = &ctx->parameterManager->CreateBankSlot();
            slot->AddPhysicalEncoder(1);
            slot->AddPhysicalEncoder(2);
            slot->AddPhysicalEncoder(3);
            slot->SelectBank(bank);
        }
        void ProcessBlock(synth::AudioBlock&) {}
    };

    synth::Engine<TinyGroupApp> tinyEngine([] { return std::uint64_t{0}; });
    tinyEngine.Initialize();
    tinyEngine.Prepare(48000.0, 256);

    synth::BankSlot* slot = tinyEngine.Application().slot;
    slot->HandlePress(1);  // triggers the deferred-growth path (ParameterStorageBatchNeeded)

    TestBlockBuffers tinyBuffers(2, 4);
    {
        synth::AudioBlock block = tinyBuffers.Block(4);
        tinyEngine.ProcessBlock(block, /*timestamp=*/0);
    }

    const std::size_t queueSizeBeforeTick = log.QueueSizeForTesting(synth::ThreadId::Unknown);
    tinyEngine.MessageThreadTick();  // drains parameterMessageOutBus_, logs storage-batch provisioning
    REQUIRE_TRUE(log.QueueSizeForTesting(synth::ThreadId::Unknown) > queueSizeBeforeTick);

    log.ResetForTesting();
}

namespace {

// App variant exercising the optional HasProcessFrame<App> control-rate
// hook (Engine::ProcessBlock step 4a): ProcessFrame() must run exactly once
// per block, after this block's messages have been applied (so it observes
// post-message-manager state) and before the app's own ProcessBlock(block)
// call.
struct ProcessFrameApp {
    static synth::RuntimeConfig Config() {
        synth::RuntimeConfig config;
        config.appName = "EngineProcessFrameTest";
        config.numAudioOutputs = 2;
        return config;
    }
    synth::AppContext* context = nullptr;
    synth::ParameterId probeId = 0;
    int processFrameCalls = 0;
    int processBlockCalls = 0;
    // Set by ProcessFrame() each call: the probe scene center after this
    // block's messages have been applied, as observed from inside the hook.
    float probeSceneCenterDuringProcessFrame = -1.0f;
    // Sequence-order flag: true only while ProcessFrame() is executing, and
    // observed (then cleared) by ProcessBlock() -- proves ProcessFrame() ran
    // BEFORE ProcessBlock() for the same block, not merely that both ran.
    bool insideProcessFrame = false;
    bool processFrameRanBeforeProcessBlockThisCall = false;

    void Init(synth::AppContext* ctx) {
        context = ctx;
        auto& group = ctx->parameterManager->CreateGroup(
            {.numVoices = 1, .numModulators = 0, .numScenes = 1, .maxParameters = 4, .processLiteAlpha = 1.0f});
        auto& probe = ctx->parameterManager->CreateParameter(group, {.name = "Probe", .defaultValue = 0.25f});
        probeId = probe.Id();

        auto& bank = ctx->parameterManager->CreateBank();
        bank.AddMapping(/*encoderId=*/0, probe);
        auto& slot = ctx->parameterManager->CreateBankSlot();
        slot.AddPhysicalEncoder(/*encoderId=*/0);
        slot.SelectBank(&bank);
    }
    void ProcessFrame() {
        ++processFrameCalls;
        insideProcessFrame = true;
        // uiBus_.Process(timestamp) (message-manager application) runs
        // earlier in Engine::ProcessBlock's binding order than ProcessFrame()
        // (uiBus_.Process -> midiBus_.Process -> ProcessFrame() ->
        // app_.ProcessBlock()), so SceneCenter(0) (which MessageInBus::Apply's
        // ParamIncDec handling writes directly, via Parameter::HandleIncDec)
        // already reflects any message applied earlier in this same block --
        // this is the "post-message-manager state" the hook is documented to
        // observe.
        probeSceneCenterDuringProcessFrame = context->parameterManager->ParameterById(probeId).SceneCenter(0);
        insideProcessFrame = false;
    }
    void ProcessBlock(synth::AudioBlock& block) {
        ++processBlockCalls;
        // ProcessFrame() for this block must already have run (and returned)
        // by the time ProcessBlock() is called.
        processFrameRanBeforeProcessBlockThisCall = (processFrameCalls == processBlockCalls) && !insideProcessFrame;
        for (int channel = 0; channel < block.numOutputChannels; ++channel) {
            float* out = block.outputs[channel];
            if (out == nullptr) {
                continue;
            }
            for (std::size_t frame = 0; frame < block.numFrames; ++frame) {
                out[frame] = 0.0f;
            }
        }
    }
};

}  // namespace

TEST_CASE(engine_process_frame_hook_runs_once_per_block_after_messages_before_process_block) {
    REQUIRE_TRUE(synth::HasProcessFrame<ProcessFrameApp>);
    REQUIRE_TRUE(!synth::HasProcessFrame<EngineTestApp>);  // EngineTestApp opts out: concept must not false-positive

    synth::Engine<ProcessFrameApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    // Push a message so ProcessFrame() observing the post-message scene
    // center is a meaningful check (not just reading the untouched default).
    engine.UiBus().Push(synth::MessageIn::ParamIncDec(/*timestamp=*/0, /*slotIx=*/0, /*position=*/0, /*delta=*/0.3f));

    TestBlockBuffers buffers(2, 4);
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }

    REQUIRE_TRUE(engine.Application().processFrameCalls == 1);
    REQUIRE_TRUE(engine.Application().processBlockCalls == 1);
    REQUIRE_TRUE(engine.Application().processFrameRanBeforeProcessBlockThisCall);
    REQUIRE_NEAR(engine.Application().probeSceneCenterDuringProcessFrame, 0.55f, 1e-4f);

    // A second block: call counts stay in lockstep (exactly once per block
    // each), reconfirming the once-per-block contract, not a one-shot fluke.
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/1);
    }
    REQUIRE_TRUE(engine.Application().processFrameCalls == 2);
    REQUIRE_TRUE(engine.Application().processBlockCalls == 2);
    REQUIRE_TRUE(engine.Application().processFrameRanBeforeProcessBlockThisCall);
}

TEST_CASE(engine_revert_all_to_default_restores_app_init_midi_profile_not_empty) {
    // Regression for the default-MIDI-profile gap: Engine::Initialize() must
    // snapshot defaultInstrumentConfig_ from the live instrument the app's
    // Init() configured, BEFORE any startup patch applies. Without that
    // snapshot, RevertAllToDefault (dispatched by Patches().NewPatch()
    // below) resets instrumentConfig_ to a default-constructed (empty,
    // zero-controller) MidiInstrumentConfig instead of back to the app's
    // real default, silently dropping MIDI control surface responsiveness.
    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = true;  // Init() adds a non-empty controller (encoderInput)

    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    // Sanity: the live instrument really is non-empty right after
    // Initialize, matching what the app's Init() configured.
    REQUIRE_TRUE(!engine.Context().instrument->controllers.empty());
    REQUIRE_TRUE(engine.Context().instrument->controllers.front().config.encoderInput.has_value());

    TestBlockBuffers buffers(2, 4);

    // NewPatch() dispatches RevertAllToDefault onto patchInputBus_ (see
    // PatchManager::NewPatch() in src/PatchPersistence.cpp); no patch is
    // loaded/saved here, so this exercises the "brand new patch" / revert
    // path directly against whatever Initialize() snapshotted as default.
    // NewPatch() itself returns Ok synchronously (it only enqueues the
    // message); the actual revert happens when ProcessBlock drains it below.
    const synth::PatchCommandResult newPatchResult = engine.Patches().NewPatch();
    REQUIRE_TRUE(newPatchResult.status == synth::PatchCommandStatus::Ok);

    {
        // ProcessBlock drains patchInputBus_ and applies RevertAllToDefault
        // synchronously (no arena growth needed for this message type).
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    engine.MessageThreadTick();

    // The live instrument must still equal the app's Init-configured default
    // -- i.e. still have a controller with an encoderInput mapping -- NOT
    // have been reset to an empty (zero-controller) MidiInstrumentConfig{}.
    REQUIRE_TRUE(!engine.Context().instrument->controllers.empty());
    REQUIRE_TRUE(engine.Context().instrument->controllers.front().config.encoderInput.has_value());

    // Also confirm the default instrument snapshot itself carries the
    // controller (not just that the live instrument happens to still have
    // it): the revert path copies defaultInstrumentConfig_ into
    // instrumentConfig_, so if the snapshot were empty the assertion above
    // would already have failed; this checks the snapshot directly for a
    // clearer failure signal.
    REQUIRE_TRUE(!engine.Context().defaultInstrument->controllers.empty());
    REQUIRE_TRUE(engine.Context().defaultInstrument->controllers.front().config.encoderInput.has_value());

    EngineTestApp::wantEncoderMidiInput = false;  // restore default for subsequent tests
}

TEST_CASE(engine_revert_all_to_default_preserves_host_audio_selection) {
    // Patch new/revert is parameter-only: a host-selected audio device is
    // runtime configuration and must survive RevertAllToDefault.
    EngineTestApp::processLiteAlpha = 1.0f;

    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.SetAudioDeviceFromHost(synth::AudioDeviceState{.outputDeviceName = "Speakers", .inputDeviceName = "Mic"});
    engine.Prepare(48000.0, 256);

    // Sanity: the live audio device state carries the host-selected value
    // after Initialize.
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName == "Speakers");
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().inputDeviceName == "Mic");

    TestBlockBuffers buffers(2, 4);

    // NewPatch() dispatches RevertAllToDefault onto patchInputBus_; no patch
    // is loaded/saved here, so this exercises the "brand new patch" / revert
    // path directly against whatever Initialize() snapshotted as default.
    const synth::PatchCommandResult newPatchResult = engine.Patches().NewPatch();
    REQUIRE_TRUE(newPatchResult.status == synth::PatchCommandStatus::Ok);

    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    engine.MessageThreadTick();

    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName == "Speakers");
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().inputDeviceName == "Mic");
}

TEST_CASE(engine_tick_preserves_audio_device_when_patch_load_has_legacy_audio_section) {
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName.empty());  // sanity: starts empty

    int callbackCalls = 0;
    engine.SetAudioDeviceChangedCallback([&]() { ++callbackCalls; });

    const std::filesystem::path patchDir =
        std::filesystem::temp_directory_path() / "engine-tick-audio-device-changed-patch-dir";
    std::filesystem::remove_all(patchDir);
    WriteProbePatchVersion(patchDir, 0.9f, std::chrono::system_clock::now(),
                           synth::AudioDeviceState{.outputDeviceName = "Interface A", .inputDeviceName = ""});

    const synth::PatchCommandResult loadResult = engine.Patches().LoadPatch(patchDir);
    REQUIRE_TRUE(loadResult.status == synth::PatchCommandStatus::Ok);

    TestBlockBuffers buffers(2, 4);
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName.empty());
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().inputDeviceName.empty());

    engine.MessageThreadTick();
    engine.MessageThreadTick();

    REQUIRE_TRUE(callbackCalls == 0);

    std::filesystem::remove_all(patchDir);
}

TEST_CASE(engine_tick_does_not_fire_audio_device_changed_callback_when_load_has_no_section) {
    // A runtime patch load whose document has no audioDevice section leaves
    // audioDeviceState_ untouched, so the callback must not fire.
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    int callbackCalls = 0;
    engine.SetAudioDeviceChangedCallback([&]() { ++callbackCalls; });

    const std::filesystem::path patchDir =
        std::filesystem::temp_directory_path() / "engine-tick-audio-device-unchanged-patch-dir";
    std::filesystem::remove_all(patchDir);
    WriteProbePatchVersion(patchDir, 0.9f, std::chrono::system_clock::now());  // no audioDevice section

    const synth::PatchCommandResult loadResult = engine.Patches().LoadPatch(patchDir);
    REQUIRE_TRUE(loadResult.status == synth::PatchCommandStatus::Ok);

    TestBlockBuffers buffers(2, 4);
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    engine.MessageThreadTick();

    REQUIRE_TRUE(callbackCalls == 0);
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName.empty());

    std::filesystem::remove_all(patchDir);
}

TEST_CASE(engine_initialize_preserves_audio_device_for_startup_patch_load) {
    const std::filesystem::path dataRoot =
        std::filesystem::temp_directory_path() / "engine-initialize-audio-device-callback-data-root";
    std::filesystem::remove_all(dataRoot);
    const synth::RuntimeDataPaths paths = synth::RuntimeDataPaths::FromDataRoot(dataRoot);
    std::filesystem::create_directories(paths.patchesRoot);
    WriteProbePatchVersion(paths.patchesRoot / "AAA", 0.75f, std::chrono::system_clock::now(),
                           synth::AudioDeviceState{.outputDeviceName = "Startup Interface", .inputDeviceName = ""});

    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.SetRuntimeDataPaths(paths);

    int callbackCalls = 0;
    std::string outputNameAtCallback;
    engine.SetAudioDeviceChangedCallback([&]() {
        ++callbackCalls;
        outputNameAtCallback = engine.AudioDeviceSnapshot().outputDeviceName;
    });

    engine.Initialize();

    REQUIRE_TRUE(callbackCalls == 0);
    REQUIRE_TRUE(outputNameAtCallback.empty());
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName.empty());

    std::filesystem::remove_all(dataRoot);
}

TEST_CASE(engine_startup_and_runtime_patch_loads_do_not_change_audio_device_shadow) {
    const std::filesystem::path dataRoot =
        std::filesystem::temp_directory_path() / "engine-audio-state-shadow-sync-data-root";
    std::filesystem::remove_all(dataRoot);
    const synth::RuntimeDataPaths paths = synth::RuntimeDataPaths::FromDataRoot(dataRoot);
    std::filesystem::create_directories(paths.patchesRoot);
    // Startup patch with audioDevice section
    WriteProbePatchVersion(paths.patchesRoot / "AAA", 0.75f, std::chrono::system_clock::now(),
                           synth::AudioDeviceState{.outputDeviceName = "Startup Device", .inputDeviceName = ""});

    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.SetRuntimeDataPaths(paths);

    int callbackCalls = 0;
    engine.SetAudioDeviceChangedCallback([&]() {
        ++callbackCalls;
    });

    engine.Initialize();
    REQUIRE_TRUE(callbackCalls == 0);
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName.empty());

    engine.Prepare(48000.0, 256);

    // Now drive a runtime patch message WITHOUT an audioDevice section
    // through ProcessBlock + MessageThreadTick twice. The callback should
    // not fire again (shadow is already synced).
    const std::filesystem::path runtimePatchDir =
        std::filesystem::temp_directory_path() / "engine-audio-state-shadow-runtime-dir";
    std::filesystem::remove_all(runtimePatchDir);
    WriteProbePatchVersion(runtimePatchDir, 0.9f, std::chrono::system_clock::now());

    const synth::PatchCommandResult loadResult = engine.Patches().LoadPatch(runtimePatchDir);
    REQUIRE_TRUE(loadResult.status == synth::PatchCommandStatus::Ok);

    TestBlockBuffers buffers(2, 4);
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    REQUIRE_TRUE(callbackCalls == 0);

    engine.MessageThreadTick();
    REQUIRE_TRUE(callbackCalls == 0);

    engine.MessageThreadTick();
    REQUIRE_TRUE(callbackCalls == 0);

    std::filesystem::remove_all(dataRoot);
    std::filesystem::remove_all(runtimePatchDir);
}

TEST_CASE(engine_revert_after_host_selection_preserves_audio_device) {
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    // Sanity: startup default is empty (no app-configured device, no startup
    // patch).
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName.empty());

    int callbackCalls = 0;
    std::string outputNameAtCallback;
    engine.SetAudioDeviceChangedCallback([&]() {
        ++callbackCalls;
        outputNameAtCallback = engine.AudioDeviceSnapshot().outputDeviceName;
    });

    // Simulate a host-initiated selection (Runtime::ApplyAudioDeviceSelection's
    // path): the host picks "DeviceX" in its combo.
    engine.SetAudioDeviceFromHost(synth::AudioDeviceState{.outputDeviceName = "DeviceX", .inputDeviceName = ""});

    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName == "DeviceX");
    REQUIRE_TRUE(callbackCalls == 0);  // host-initiated changes never fire the callback (see (b) below)

    // Drive a patch REVERT through ProcessBlock + MessageThreadTick.
    const synth::PatchCommandResult revertResult = engine.Patches().RevertPatch();
    REQUIRE_TRUE(revertResult.status == synth::PatchCommandStatus::Ok);

    TestBlockBuffers buffers(2, 4);
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    engine.MessageThreadTick();

    REQUIRE_TRUE(callbackCalls == 0);
    REQUIRE_TRUE(outputNameAtCallback.empty());
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName == "DeviceX");
}

TEST_CASE(engine_set_audio_device_from_host_fires_no_callback) {
    // (b): SetAudioDeviceFromHost itself must never fire
    // audioDeviceChangedCallback_ -- host-initiated changes are by
    // definition already known to the host that just made them; the
    // callback exists solely to notify the host of future engine-sourced
    // runtime configuration changes IT did not originate.
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    int callbackCalls = 0;
    engine.SetAudioDeviceChangedCallback([&]() { ++callbackCalls; });

    engine.SetAudioDeviceFromHost(synth::AudioDeviceState{.outputDeviceName = "Interface B", .inputDeviceName = ""});
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName == "Interface B");
    REQUIRE_TRUE(callbackCalls == 0);

    // Also confirm no *pending* notification was left for the tick to
    // deliver later -- a tick with nothing else happening must stay at 0.
    engine.MessageThreadTick();
    REQUIRE_TRUE(callbackCalls == 0);

    // A second host-initiated call to a different value likewise fires
    // nothing.
    engine.SetAudioDeviceFromHost(synth::AudioDeviceState{.outputDeviceName = "Interface C", .inputDeviceName = ""});
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName == "Interface C");
    REQUIRE_TRUE(callbackCalls == 0);
    engine.MessageThreadTick();
    REQUIRE_TRUE(callbackCalls == 0);
}

// ---------------------------------------------------------------------------
// Task 4: engine-owned instrument with serialized edits (LiveInstrument(),
// DefaultInstrument(), EditInstrument()).
// ---------------------------------------------------------------------------

TEST_CASE(engine_default_instrument_equals_app_seeded_instrument_after_initialize) {
    // Property 1 (brief Step 1): the post-Init() default snapshot must equal
    // the instrument the app's Init() actually seeded -- not an empty
    // MidiInstrumentConfig{}. EngineTestApp::Init() adds a "test"/Generic
    // controller with encoderInput set when wantEncoderMidiInput is true.
    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = true;

    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();

    const synth::MidiInstrumentConfig& live = engine.LiveInstrument();
    const synth::MidiInstrumentConfig& def = engine.DefaultInstrument();

    REQUIRE_TRUE(live.controllers.size() == 1);
    REQUIRE_TRUE(def.controllers.size() == 1);
    REQUIRE_TRUE(live.controllers.front().name == "test");
    REQUIRE_TRUE(def.controllers.front().name == "test");
    REQUIRE_TRUE(live.controllers.front().kind == synth::MidiProfileKind::Generic);
    REQUIRE_TRUE(def.controllers.front().kind == synth::MidiProfileKind::Generic);
    REQUIRE_TRUE(live.controllers.front().config.encoderInput.has_value());
    REQUIRE_TRUE(def.controllers.front().config.encoderInput.has_value());

    // Also reachable through AppContext (message-thread surface apps use).
    REQUIRE_TRUE(engine.Context().instrument == &engine.LiveInstrument());
    REQUIRE_TRUE(engine.Context().defaultInstrument == &engine.DefaultInstrument());

    EngineTestApp::wantEncoderMidiInput = false;  // restore default for subsequent tests
}

TEST_CASE(engine_edit_instrument_mutation_visible_and_fires_rebuilt_callback_once) {
    // Property 2 (brief Step 1): EditInstrument's mutation must be visible in
    // LiveInstrument() immediately afterward, and must trigger the
    // MIDI-processors-rebuilt callback exactly once (not zero, not twice).
    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = false;  // start from an empty instrument

    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    REQUIRE_TRUE(engine.LiveInstrument().controllers.empty());

    int callbackCalls = 0;
    engine.SetMidiProcessorsRebuiltCallback([&]() { ++callbackCalls; });

    engine.EditInstrument([](synth::MidiInstrumentConfig& instrument) {
        synth::MidiControllerSlot slot;
        slot.name = "edited";
        slot.kind = synth::MidiProfileKind::Generic;
        slot.config.encoderInput = synth::EncoderMidiInConfig{};
        instrument.controllers.push_back(std::move(slot));
    });

    REQUIRE_TRUE(engine.LiveInstrument().controllers.size() == 1);
    REQUIRE_TRUE(engine.LiveInstrument().controllers.front().name == "edited");
    REQUIRE_TRUE(callbackCalls == 1);  // fired exactly once

    // A second EditInstrument call with a no-op edit still rebuilds and
    // fires again (EditInstrument always rebuilds/fires after applying,
    // regardless of whether the edit actually changed anything -- same
    // unconditional-fire contract as RebuildMidiProcessors()'s other
    // callers).
    engine.EditInstrument([](synth::MidiInstrumentConfig&) {});
    REQUIRE_TRUE(callbackCalls == 2);
}

TEST_CASE(engine_patch_save_perturb_load_preserves_instrument_through_production_messages) {
    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = true;  // Init() seeds one "test" controller

    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    TestBlockBuffers buffers(2, 4);

    // Save a patch while the instrument is Init() configured ("test"/Generic).
    const std::filesystem::path saveDir =
        std::filesystem::temp_directory_path() / "engine-instrument-round-trip-save-dir";
    std::filesystem::remove_all(saveDir);
    const synth::PatchCommandResult saveResult = engine.Patches().SavePatchAs(saveDir);
    REQUIRE_TRUE(saveResult.status == synth::PatchCommandStatus::Pending);
    bool written = false;
    for (int i = 0; i < 16 && !written; ++i) {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
        engine.MessageThreadTick();
        written = synth::LatestPatchVersion(saveDir).has_value();
    }
    REQUIRE_TRUE(written);

    // Perturb the live instrument via EditInstrument (production entry
    // point): rename the controller and change its kind.
    engine.EditInstrument([](synth::MidiInstrumentConfig& instrument) {
        REQUIRE_TRUE(instrument.RenameController(0, "perturbed"));
    });
    REQUIRE_TRUE(engine.LiveInstrument().controllers.front().name == "perturbed");

    // Load the saved patch back through PatchManager::LoadPatch, exactly as
    // a production host would.
    const synth::PatchCommandResult loadResult = engine.Patches().LoadPatch(saveDir);
    REQUIRE_TRUE(loadResult.status == synth::PatchCommandStatus::Ok);
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    engine.MessageThreadTick();

    // Patch load restores parameter state only; runtime MIDI configuration is
    // still the host-perturbed state.
    REQUIRE_TRUE(engine.LiveInstrument().controllers.size() == 1);
    REQUIRE_TRUE(engine.LiveInstrument().controllers.front().name == "perturbed");
    REQUIRE_TRUE(engine.LiveInstrument().controllers.front().kind == synth::MidiProfileKind::Generic);
    REQUIRE_TRUE(engine.LiveInstrument().controllers.front().config.encoderInput.has_value());

    std::filesystem::remove_all(saveDir);
    EngineTestApp::wantEncoderMidiInput = false;  // restore default for subsequent tests
}

TEST_CASE(engine_revert_preserves_current_instrument) {
    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = true;

    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    REQUIRE_TRUE(engine.LiveInstrument().controllers.size() == 1);

    // Perturb: add a second controller and rename the first.
    engine.EditInstrument([](synth::MidiInstrumentConfig& instrument) {
        REQUIRE_TRUE(instrument.RenameController(0, "renamed"));
        synth::MidiControllerSlot extra;
        extra.name = "extra";
        extra.kind = synth::MidiProfileKind::Generic;
        REQUIRE_TRUE(instrument.AddController(std::move(extra)));
    });
    REQUIRE_TRUE(engine.LiveInstrument().controllers.size() == 2);

    TestBlockBuffers buffers(2, 4);
    const synth::PatchCommandResult newPatchResult = engine.Patches().NewPatch();
    REQUIRE_TRUE(newPatchResult.status == synth::PatchCommandStatus::Ok);
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    engine.MessageThreadTick();

    REQUIRE_TRUE(engine.LiveInstrument().controllers.size() == 2);
    REQUIRE_TRUE(engine.LiveInstrument().controllers.front().name == "renamed");
    REQUIRE_TRUE(engine.LiveInstrument().controllers.front().kind == synth::MidiProfileKind::Generic);

    EngineTestApp::wantEncoderMidiInput = false;  // restore default for subsequent tests
}

TEST_CASE(engine_edit_instrument_and_pending_patch_load_same_tick_preserves_edit) {
    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = true;  // Init() seeds "test"/Generic

    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    // Build a patch document whose instrument differs from the live one:
    // rename the single controller to "loaded" and give it a different kind
    // (still Generic-compatible: only encoderInput is set, matching
    // EngineTestApp's Init() shape) so FromJSON/SlotValidForKind accepts it.
    synth::MidiInstrumentConfig loadedInstrument = engine.LiveInstrument();
    REQUIRE_TRUE(loadedInstrument.RenameController(0, "loaded"));

    const std::filesystem::path patchDir =
        std::filesystem::temp_directory_path() / "engine-instrument-serialized-order-patch-dir";
    std::filesystem::remove_all(patchDir);
    WriteProbePatchVersion(patchDir, 0.6f, std::chrono::system_clock::now(), synth::AudioDeviceState{},
                           loadedInstrument);

    const synth::PatchCommandResult loadResult = engine.Patches().LoadPatch(patchDir);
    REQUIRE_TRUE(loadResult.status == synth::PatchCommandStatus::Ok);

    // Enqueue the load (queued onto patchInputBus_ by LoadPatch above, not
    // yet drained), then immediately race it with a host-initiated
    // EditInstrument renaming the controller to "edited" -- before the next
    // ProcessBlock has a chance to drain the load.
    engine.EditInstrument([](synth::MidiInstrumentConfig& instrument) {
        REQUIRE_TRUE(instrument.RenameController(0, "edited"));
    });

    TestBlockBuffers buffers(2, 4);
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    engine.MessageThreadTick();

    // Patch load is parameter-only, so the host edit must remain the final
    // runtime instrument state.
    REQUIRE_TRUE(engine.LiveInstrument().controllers.size() == 1);
    const std::string& finalName = engine.LiveInstrument().controllers.front().name;
    REQUIRE_TRUE(finalName == "edited");
    REQUIRE_TRUE(engine.LiveInstrument().controllers.front().kind == synth::MidiProfileKind::Generic);
    REQUIRE_TRUE(engine.LiveInstrument().controllers.front().config.encoderInput.has_value());

    std::filesystem::remove_all(patchDir);
    EngineTestApp::wantEncoderMidiInput = false;  // restore default for subsequent tests
}

TEST_CASE(engine_rebuild_midi_processors_observes_fully_applied_edit_snapshot) {
    // Critical-fix regression (RebuildMidiProcessors() data race): the fix
    // makes RebuildMidiProcessors() copy the WHOLE controllers vector out of
    // instrumentConfig_ while holding audioDeviceStateMutex_, the same lock
    // EditInstrument()/the audio-thread patch drain hold while mutating that
    // member (see audioDeviceStateMutex_'s doc comment). This single-threaded
    // harness cannot manufacture a real data race, but it can assert the
    // snapshot-then-build sequence is internally consistent: a rebuild
    // immediately after a serialized EditInstrument mutation must reflect
    // that mutation's fully-applied result (never an empty or partially
    // mutated profile), for both the empty-instrument (midiProcessors_ has
    // size 0) and populated-instrument (one result per controller slot)
    // cases.
    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = true;  // Init() seeds one "test"/Generic controller

    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();

    // Populated case: EditInstrument adds encoder-output config to the
    // existing controller's profile, then explicitly rebuilds (mirroring
    // EditInstrument's own post-edit rebuild, but isolating the call so this
    // test documents RebuildMidiProcessors()'s contract directly).
    engine.EditInstrument([](synth::MidiInstrumentConfig& instrument) {
        REQUIRE_TRUE(!instrument.controllers.empty());
        instrument.controllers.front().config.encoderOutput = synth::EncoderMidiOutConfig{};
    });
    REQUIRE_TRUE(engine.LiveInstrument().controllers.front().config.encoderOutput.has_value());
    engine.RebuildMidiProcessorsForTest();
    // A rebuilt processor chain must exist and reflect the edited (non-empty)
    // profile: MidiInputProcessor(0) stays non-null because encoderInput is
    // still set on the same controller slot.
    REQUIRE_TRUE(engine.MidiControllerCount() == 1);
    REQUIRE_TRUE(engine.MidiInputProcessor(0) != nullptr);

    // Empty case: remove the only controller, then rebuild again. The
    // snapshot copy must see the now-empty controllers list (not a stale or
    // torn view of the prior populated state) and yield zero processor
    // chains, so both MidiControllerCount() and the slot-0 accessor reflect
    // "no controllers".
    engine.EditInstrument([](synth::MidiInstrumentConfig& instrument) { instrument.controllers.clear(); });
    REQUIRE_TRUE(engine.LiveInstrument().controllers.empty());
    engine.RebuildMidiProcessorsForTest();
    REQUIRE_TRUE(engine.MidiControllerCount() == 0);
    REQUIRE_TRUE(engine.MidiInputProcessor(0) == nullptr);

    EngineTestApp::wantEncoderMidiInput = false;  // restore default for subsequent tests
}

TEST_CASE(engine_instrument_snapshot_is_deep_copy_equal_to_live_instrument) {
    // Task 4 review, Critical fix regression: InstrumentSnapshot() is the
    // locked running-state read surface any message-thread reader concurrent
    // with running audio (e.g. ControllersPage's per-tick VM refresh) must
    // use instead of the unlocked LiveInstrument() reference -- see both
    // methods' doc comments. This single-threaded harness cannot manufacture
    // a real data race, but it can assert the copy is (a) equal in content to
    // the live instrument at the moment of the call, and (b) a true deep
    // copy: mutating the returned value must not alter instrumentConfig_
    // (i.e. the snapshot does not alias the live controllers vector or its
    // per-slot config/endpoint members).
    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = true;  // Init() seeds one "test"/Generic controller

    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();

    engine.EditInstrument([](synth::MidiInstrumentConfig& instrument) {
        REQUIRE_TRUE(!instrument.controllers.empty());
        instrument.controllers.front().input = synth::MidiEndpointRef{"in-id", "In Device"};
        instrument.controllers.front().output = synth::MidiEndpointRef{"out-id", "Out Device"};
    });

    synth::MidiInstrumentConfig snapshot = engine.InstrumentSnapshot();

    // (a) Equal in content to the live instrument at the time of the call.
    const synth::MidiInstrumentConfig& live = engine.LiveInstrument();
    REQUIRE_TRUE(snapshot.controllers.size() == live.controllers.size());
    REQUIRE_TRUE(snapshot.controllers.front().name == live.controllers.front().name);
    REQUIRE_TRUE(snapshot.controllers.front().kind == live.controllers.front().kind);
    REQUIRE_TRUE(snapshot.controllers.front().config.encoderInput.has_value() ==
                 live.controllers.front().config.encoderInput.has_value());
    REQUIRE_TRUE(snapshot.controllers.front().input.identifier == live.controllers.front().input.identifier);
    REQUIRE_TRUE(snapshot.controllers.front().input.name == live.controllers.front().input.name);
    REQUIRE_TRUE(snapshot.controllers.front().output.identifier == live.controllers.front().output.identifier);
    REQUIRE_TRUE(snapshot.controllers.front().output.name == live.controllers.front().output.name);

    // (b) Deep copy: mutating the snapshot must not affect the live
    // instrument, whether by appending a controller (would alias a shared
    // vector buffer) or by editing a field on the existing slot (would alias
    // a shared string/optional).
    snapshot.controllers.front().input.identifier = "mutated-in-id";
    snapshot.controllers.front().name = "mutated-name";
    synth::MidiControllerSlot extra;
    extra.name = "extra";
    snapshot.controllers.push_back(std::move(extra));

    REQUIRE_TRUE(engine.LiveInstrument().controllers.size() == 1);
    REQUIRE_TRUE(engine.LiveInstrument().controllers.front().name == "test");
    REQUIRE_TRUE(engine.LiveInstrument().controllers.front().input.identifier == "in-id");

    EngineTestApp::wantEncoderMidiInput = false;  // restore default for subsequent tests
}

int main() {
    int failed = 0;
    for (const auto& test : Registry()) {
        try {
            test.fn();
            std::cout << "[PASS] " << test.name << "\n";
        } catch (const std::exception& ex) {
            ++failed;
            std::cerr << "[FAIL] " << test.name << ": " << ex.what() << "\n";
        }
    }
    return failed == 0 ? 0 : 1;
}
