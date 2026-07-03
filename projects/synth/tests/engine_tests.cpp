#include "synth/Engine.hpp"

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
    static inline std::filesystem::path testPatchesRoot;
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
    // When non-empty, Config() reports these as
    // preferredOutputDeviceName/preferredInputDeviceName (the same way
    // RuntimeConfig fields are always reported), so Engine::Initialize()
    // seeds its engine-owned audioDeviceState_ from them before Init() runs
    // -- tests use this to exercise a non-default app-configured audio
    // device selection (e.g. the revert-restores-default test).
    // Default-constructed (empty) leaves audioDeviceState_ at its default, as
    // before. Replaces the old *ctx->audioDeviceState write now that
    // AppContext no longer exposes a mutable pointer into engine state (Task
    // 3 review, Critical fix).
    static inline synth::AudioDeviceState initAudioDeviceState;
    synth::AppContext* context = nullptr;
    synth::ParameterId probeId = 0;
    synth::BankSlot* probeSlot = nullptr;
    int processBlockCalls = 0;
    float lastProbeDuringBlock = -1.0f;

    static synth::RuntimeConfig Config() {
        synth::RuntimeConfig config;
        config.appName = "EngineTest";
        config.numAudioOutputs = 2;
        config.patchesRoot = testPatchesRoot;
        config.preferredOutputDeviceName = initAudioDeviceState.outputDeviceName;
        config.preferredInputDeviceName = initAudioDeviceState.inputDeviceName;
        return config;
    }
    void Init(synth::AppContext* ctx) {
        ++initCalls;
        context = ctx;
        sawNullUiStateDuringInit = (ctx->uiState == nullptr);
        if (wantEncoderMidiInput && ctx->midiProfileConfig != nullptr) {
            ctx->midiProfileConfig->encoderInput = synth::EncoderMidiInConfig{};
        }
        auto& group = ctx->parameterManager->CreateGroup({.numVoices = 1,
                                                           .numModulators = 0,
                                                           .numScenes = 1,
                                                           .maxParameters = 4,
                                                           .processLiteAlpha = processLiteAlpha});
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
        for (std::size_t frame = 0; frame < block.numFrames; ++frame) {
            context->parameterManager->ParameterById(probeId).ProcessLite();
        }
        // Read after the per-frame slewing above so lastProbeDuringBlock
        // reflects this block's post-message, post-slew value (the engine
        // pump applies patch/UI/MIDI messages and recomputes targets before
        // calling into the app, so the app's per-frame work is what makes
        // the new target audible/observable within this same block).
        lastProbeDuringBlock = context->parameterManager->ParameterById(probeId).Get(0);
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
// at the given time point. audioDevice defaults to an empty AudioDeviceState,
// which BuildPatchJSON omits from the document entirely (see its "not both
// empty" guard), so callers that don't pass one get a patch with no
// audioDevice section -- exactly what the "load without the section fires
// nothing" tests need.
void WriteProbePatchVersion(const std::filesystem::path& patchDir, float probeValue,
                            std::chrono::system_clock::time_point when,
                            const synth::AudioDeviceState& audioDevice = {}) {
    synth::ParameterManager scratchManager;
    auto& group = scratchManager.CreateGroup(
        {.numVoices = 1, .numModulators = 0, .numScenes = 1, .maxParameters = 4, .processLiteAlpha = 1.0f});
    const synth::ParameterId probeId = scratchManager.RegisterParameter(group, {.name = "Probe", .defaultValue = 0.25f});
    scratchManager.ParameterById(probeId).SceneCenter(0) = probeValue;
    scratchManager.CaptureDefaultControlState();
    scratchManager.ComputeAllParameters();

    const synth::MidiInstrumentConfig instrument;  // zero controllers: valid
    synth::JsonArena arena(64 * 1024);
    synth::JSON root = synth::BuildPatchJSON(arena, "Probe Patch", scratchManager, instrument, audioDevice);
    REQUIRE_TRUE(!root.IsNull());
    char* dumped = root.Dumps(JSON_ENCODE_ANY);
    REQUIRE_TRUE(dumped != nullptr);
    const std::string jsonText(dumped);
    std::free(dumped);

    synth::SavePatchVersionInDirectory(patchDir, jsonText, when);
}

}  // namespace

TEST_CASE(engine_initialize_orders_init_before_ui_state) {
    EngineTestApp::testPatchesRoot.clear();
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    REQUIRE_TRUE(EngineTestApp::sawNullUiStateDuringInit);
    REQUIRE_TRUE(engine.Context().uiState != nullptr);
    REQUIRE_TRUE(EngineTestApp::initCalls >= 1);
}

TEST_CASE(engine_prepare_forwards_negotiated_values) {
    EngineTestApp::testPatchesRoot.clear();
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
    EngineTestApp::testPatchesRoot = std::filesystem::temp_directory_path() / "engine-no-such-root";
    std::filesystem::remove_all(EngineTestApp::testPatchesRoot);
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();  // must not throw or report failure
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).Get(0), 0.25f, 1e-5f);
}

TEST_CASE(engine_startup_loads_lexicographically_latest_patch) {
    const std::filesystem::path root =
        std::filesystem::temp_directory_path() / "engine-startup-patch-root";
    std::filesystem::remove_all(root);
    std::filesystem::create_directories(root);

    const std::filesystem::path dirAAA = root / "AAA";
    const std::filesystem::path dirZZZ = root / "ZZZ";

    // "AAA" gets the numerically later time point (greater version filename);
    // "ZZZ" gets the earlier one. The rule is greatest VERSION FILENAME wins,
    // not directory name, so "AAA" (0.75) must win over "ZZZ" (0.5) despite
    // "ZZZ" sorting later alphabetically as a directory name.
    const auto earlier = std::chrono::system_clock::from_time_t(1700000000);
    const auto later = earlier + std::chrono::seconds(1);

    WriteProbePatchVersion(dirZZZ, 0.5f, earlier);
    WriteProbePatchVersion(dirAAA, 0.75f, later);

    const auto latestDir = synth::Engine<EngineTestApp>::LatestPatchDirectory(root);
    REQUIRE_TRUE(latestDir.has_value());
    REQUIRE_TRUE(latestDir->filename() == "AAA");

    EngineTestApp::testPatchesRoot = root;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).Get(0), 0.75f, 1e-5f);

    std::filesystem::remove_all(root);
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

TEST_CASE(engine_pump_applies_messages_before_app_block) {
    EngineTestApp::testPatchesRoot.clear();
    EngineTestApp::processLiteAlpha = 1.0f;  // snap immediately so the applied message is visible this block
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{2}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    const float before = engine.Manager().ParameterById(engine.Application().probeId).Get(0);

    // Push a ParamIncDec against the slot/position registered in Init (slot
    // 0, position 0 maps to the probe parameter via the bank/slot wiring).
    engine.UiBus().Push(synth::MessageIn::ParamIncDec(/*timestamp=*/2, /*slotIx=*/0, /*position=*/0, /*delta=*/0.3f));

    TestBlockBuffers buffers(2, 4);
    synth::AudioBlock block = buffers.Block(4);
    engine.ProcessBlock(block, /*timestamp=*/2);

    REQUIRE_TRUE(engine.Application().processBlockCalls == 1);
    REQUIRE_TRUE(engine.Application().lastProbeDuringBlock != before);
    REQUIRE_NEAR(engine.Application().lastProbeDuringBlock, before + 0.3f, 1e-4f);
}

TEST_CASE(engine_pump_preserves_slew_across_blocks) {
    EngineTestApp::testPatchesRoot.clear();
    EngineTestApp::processLiteAlpha = 0.1f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{1}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    const float start = engine.Manager().ParameterById(engine.Application().probeId).Get(0);
    engine.UiBus().Push(synth::MessageIn::ParamIncDec(/*timestamp=*/1, /*slotIx=*/0, /*position=*/0, /*delta=*/0.5f));
    const float target = std::clamp(start + 0.5f, 0.0f, 1.0f);

    TestBlockBuffers buffers(2, 4);

    synth::AudioBlock firstBlock = buffers.Block(4);
    engine.ProcessBlock(firstBlock, /*timestamp=*/1);
    const float afterFirst = engine.Application().lastProbeDuringBlock;
    REQUIRE_TRUE(afterFirst != target);  // no snap: slewed value must not equal target yet

    float previous = afterFirst;
    for (int i = 0; i < 20; ++i) {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/1);
        const float current = engine.Application().lastProbeDuringBlock;
        REQUIRE_TRUE(current >= previous - 1e-6f);  // approaches monotonically
        previous = current;
    }
    REQUIRE_NEAR(previous, target, 1e-3f);
}

TEST_CASE(engine_pump_calls_app_exactly_once_per_block_and_advances_samples) {
    EngineTestApp::testPatchesRoot.clear();
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
    EngineTestApp::testPatchesRoot.clear();
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{5}; });
    engine.Initialize();

    // config_.uiFrameHz defaults to 30 (EngineTestApp::Config() doesn't
    // override it), matching the brief's worked example:
    // interval = round(48000 / (30 * 256)) = 6.
    engine.Prepare(48000.0, 256);

    REQUIRE_TRUE(engine.Context().uiState != nullptr);
    auto& cell = engine.Context().uiState->slots[0].cells[0];

    engine.UiBus().Push(synth::MessageIn::ParamIncDec(/*timestamp=*/5, /*slotIx=*/0, /*position=*/0, /*delta=*/0.4f));

    TestBlockBuffers buffers(2, 4);

    // First block: message applied, but UI state must not be republished yet
    // (interval is 6, and PopulateUIState happens after Initialize() as well,
    // so we capture the initial published value first to compare against).
    const float publishedBeforeAnyBlock = cell.values[0].load();

    synth::AudioBlock block1 = buffers.Block(4);
    engine.ProcessBlock(block1, /*timestamp=*/5);
    REQUIRE_NEAR(cell.values[0].load(), publishedBeforeAnyBlock, 1e-6f);  // unchanged: cadence not hit

    for (int i = 0; i < 5; ++i) {  // blocks 2..6: the 6th block hits the cadence
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/5);
    }

    const float target = std::clamp(0.25f + 0.4f, 0.0f, 1.0f);
    REQUIRE_NEAR(cell.values[0].load(), target, 1e-4f);
}

TEST_CASE(engine_pump_stash_is_a_drain_barrier_with_retry_first_ordering) {
    EngineTestApp::testPatchesRoot.clear();
    EngineTestApp::processLiteAlpha = 1.0f;  // snap immediately so applied/reverted values are visible this block

    // Tiny arena: SerializeToJSON cannot fit a patch document (needs ~2KB;
    // measured empirically against EngineTestApp's topology) in 1024 bytes,
    // so ApplyPatchMessage reports ArenaExhausted on the first attempt. A
    // single GrowAndReset() doubling (1024 -> 2048) is enough to fit it, so
    // one MessageThreadTick() call is enough to clear the barrier below.
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; }, /*initialArenaCapacity=*/1024);
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    const float initial = engine.Manager().ParameterById(engine.Application().probeId).Get(0);
    REQUIRE_NEAR(initial, 0.25f, 1e-5f);

    TestBlockBuffers buffers(2, 4);

    // Move the probe away from its default via a normal UI message so a
    // later revert-to-default is visibly observable.
    engine.UiBus().Push(synth::MessageIn::ParamIncDec(/*timestamp=*/0, /*slotIx=*/0, /*position=*/0, /*delta=*/0.3f));
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    const float moved = engine.Manager().ParameterById(engine.Application().probeId).Get(0);
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
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).Get(0), moved, 1e-4f);
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
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).Get(0), initial, 1e-4f);

    std::filesystem::remove_all(saveDir);
}

TEST_CASE(engine_initialize_without_startup_patch_never_fires_rebuilt_callback) {
    // Property 1: Initialize()'s first, pre-startup-patch RebuildMidiProcessors()
    // call (sar-5 step 7) must never invoke midiProcessorsRebuiltCallback_,
    // and with no patchesRoot configured there is no startup patch to apply
    // either, so the callback must not fire at all across Initialize().
    EngineTestApp::testPatchesRoot.clear();
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });

    int callbackCalls = 0;
    engine.SetMidiProcessorsRebuiltCallback([&]() { ++callbackCalls; });

    engine.Initialize();

    REQUIRE_TRUE(callbackCalls == 0);
}

TEST_CASE(engine_initialize_fires_rebuilt_callback_exactly_once_when_startup_patch_applies) {
    // Property 2: when Initialize() finds and applies a startup patch, the
    // second (post-apply) RebuildMidiProcessors() call must be followed by
    // exactly one callback invocation -- not zero (the pre-patch rebuild
    // must stay silent) and not two (no double-fire from the two rebuilds).
    const std::filesystem::path root =
        std::filesystem::temp_directory_path() / "engine-initialize-callback-patch-root";
    std::filesystem::remove_all(root);
    std::filesystem::create_directories(root);
    WriteProbePatchVersion(root / "AAA", 0.75f, std::chrono::system_clock::now());

    EngineTestApp::testPatchesRoot = root;
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });

    int callbackCalls = 0;
    engine.SetMidiProcessorsRebuiltCallback([&]() { ++callbackCalls; });

    engine.Initialize();

    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).Get(0), 0.75f, 1e-5f);
    REQUIRE_TRUE(callbackCalls == 1);  // fired exactly once: not zero, not double-fired

    std::filesystem::remove_all(root);
    EngineTestApp::testPatchesRoot.clear();
}

TEST_CASE(engine_tick_rebuilds_midi_processors_after_patch_load_before_reopen_callback) {
    // Property 3: a runtime patch load consumed by MessageThreadTick must
    // rebuild the MIDI processors and clear midiRebuildPending_ BEFORE the
    // callback fires -- the callback must never fire early (e.g. still
    // inside RebuildMidiProcessors() itself) and must observe the
    // freshly-rebuilt processors when it runs.
    EngineTestApp::testPatchesRoot.clear();
    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = true;  // so MidiInputProcessor() is non-null and identity-observable
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    int callbackCalls = 0;
    bool inputProcessorFreshAtCallback = false;
    synth::MidiInProcessor* inputProcessorBeforeLoad = engine.MidiInputProcessor();
    engine.SetMidiProcessorsRebuiltCallback([&]() {
        ++callbackCalls;
        // The rebuild must have already run by the time the callback fires:
        // the input processor pointer should reflect the freshly-rebuilt
        // profile, not the one captured before the load.
        inputProcessorFreshAtCallback = engine.MidiInputProcessor() != inputProcessorBeforeLoad;
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
        // ProcessBlock drains patchInputBus_, applies the LoadFromJSON
        // message, and sets midiRebuildPending_ for the tick to consume.
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).Get(0), 0.9f, 1e-4f);
    REQUIRE_TRUE(callbackCalls == 0);  // rebuild (and its callback) hasn't run yet: that's the tick's job

    engine.MessageThreadTick();

    REQUIRE_TRUE(callbackCalls == 1);  // fired exactly once, and after (not before) the tick's rebuild
    REQUIRE_TRUE(inputProcessorFreshAtCallback);  // and after the rebuild had already replaced the processors

    // A second tick with nothing pending must not fire the callback again.
    engine.MessageThreadTick();
    REQUIRE_TRUE(callbackCalls == 1);

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
    EngineTestApp::testPatchesRoot.clear();
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
    EngineTestApp::testPatchesRoot.clear();
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
// per block, after ComputeAllTargets() has applied this block's messages
// (so it observes post-message-manager state) and before the app's own
// ProcessBlock(block) call.
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
    // Set by ProcessFrame() each call: the probe's freshly-computed target
    // value (post ComputeAllTargets(), i.e. reflects this block's applied
    // messages) as observed from inside the hook.
    float probeTargetDuringProcessFrame = -1.0f;
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
        // (uiBus_.Process -> midiBus_.Process -> ComputeAllTargets() ->
        // ProcessFrame() -> app_.ProcessBlock()), so SceneCenter(0) (which
        // MessageInBus::Apply's ParamIncDec handling writes directly, via
        // Parameter::HandleIncDec) already reflects any message applied
        // earlier in this same block -- this is the "post-message-manager
        // state" the hook is documented to observe.
        probeTargetDuringProcessFrame = context->parameterManager->ParameterById(probeId).SceneCenter(0);
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

TEST_CASE(engine_process_frame_hook_runs_once_per_block_after_targets_before_process_block) {
    REQUIRE_TRUE(synth::HasProcessFrame<ProcessFrameApp>);
    REQUIRE_TRUE(!synth::HasProcessFrame<EngineTestApp>);  // EngineTestApp opts out: concept must not false-positive

    synth::Engine<ProcessFrameApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    // Push a message so this block's ComputeAllTargets() has something new
    // to apply, so ProcessFrame() observing the post-target value is a
    // meaningful check (not just reading the untouched default).
    engine.UiBus().Push(synth::MessageIn::ParamIncDec(/*timestamp=*/0, /*slotIx=*/0, /*position=*/0, /*delta=*/0.3f));

    TestBlockBuffers buffers(2, 4);
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }

    REQUIRE_TRUE(engine.Application().processFrameCalls == 1);
    REQUIRE_TRUE(engine.Application().processBlockCalls == 1);
    REQUIRE_TRUE(engine.Application().processFrameRanBeforeProcessBlockThisCall);
    REQUIRE_NEAR(engine.Application().probeTargetDuringProcessFrame, 0.55f, 1e-4f);

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
    // snapshot defaultMidiProfileConfig_/defaultEndpoints_ from the live
    // profile the app's Init() configured, BEFORE any startup patch applies.
    // Without that snapshot, RevertAllToDefault (dispatched by
    // Patches().NewPatch() below) resets midiProfileConfig_ to a
    // default-constructed (empty) MidiControllerProfileConfig instead of
    // back to the app's real default, silently dropping MIDI control
    // surface responsiveness.
    EngineTestApp::testPatchesRoot.clear();
    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::wantEncoderMidiInput = true;  // Init() sets a non-empty live profile (encoderInput)

    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    // Sanity: the live profile really is non-empty right after Initialize,
    // matching what the app's Init() configured.
    REQUIRE_TRUE(engine.Context().midiProfileConfig->encoderInput.has_value());

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

    // The live profile must still equal the app's Init-configured default --
    // i.e. still have an encoderInput mapping -- NOT have been reset to an
    // empty MidiControllerProfileConfig{}.
    REQUIRE_TRUE(engine.Context().midiProfileConfig->encoderInput.has_value());

    // Also confirm the default profile snapshot itself carries the mapping
    // (not just that the live profile happens to still have it): the
    // revert path copies defaultMidiProfileConfig_ into midiProfileConfig_,
    // so if the snapshot were empty the assertion above would already have
    // failed; this checks the snapshot directly for a clearer failure signal.
    REQUIRE_TRUE(engine.Context().defaultMidiProfileConfig->encoderInput.has_value());

    EngineTestApp::wantEncoderMidiInput = false;  // restore default for subsequent tests
}

TEST_CASE(engine_revert_all_to_default_restores_app_init_audio_device_state) {
    // Task 2: mirrors engine_revert_all_to_default_restores_app_init_midi_profile_not_empty
    // but for AudioDeviceState. Engine::Initialize() must snapshot
    // defaultAudioDeviceState_ from the live state it seeded from
    // config_.preferredOutputDeviceName/preferredInputDeviceName (Task 3
    // review, Critical fix), BEFORE any startup patch applies, so a later
    // RevertAllToDefault restores that app-configured selection rather than
    // an empty AudioDeviceState{}.
    EngineTestApp::testPatchesRoot.clear();
    EngineTestApp::processLiteAlpha = 1.0f;
    EngineTestApp::initAudioDeviceState = synth::AudioDeviceState{.outputDeviceName = "Speakers", .inputDeviceName = "Mic"};

    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    // Sanity: the live audio device state really is the app-configured value
    // right after Initialize.
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

    // The live audio device state must still equal the app's Init-configured
    // default -- NOT have been reset to an empty AudioDeviceState{}.
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName == "Speakers");
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().inputDeviceName == "Mic");

    EngineTestApp::initAudioDeviceState = synth::AudioDeviceState{};  // restore default for subsequent tests
}

TEST_CASE(engine_tick_fires_audio_device_changed_callback_once_when_load_changes_state) {
    // A runtime patch load whose document carries a non-empty audioDevice
    // section must change audioDeviceState_ and fire
    // audioDeviceChangedCallback_ exactly once, via ProcessBlock (drain) +
    // MessageThreadTick (callback), with the new state visible in both the
    // callback and afterward.
    EngineTestApp::testPatchesRoot.clear();
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName.empty());  // sanity: starts empty

    int callbackCalls = 0;
    std::string outputNameAtCallback;
    engine.SetAudioDeviceChangedCallback([&]() {
        ++callbackCalls;
        outputNameAtCallback = engine.AudioDeviceSnapshot().outputDeviceName;
    });

    const std::filesystem::path patchDir =
        std::filesystem::temp_directory_path() / "engine-tick-audio-device-changed-patch-dir";
    std::filesystem::remove_all(patchDir);
    WriteProbePatchVersion(patchDir, 0.9f, std::chrono::system_clock::now(),
                           synth::AudioDeviceState{.outputDeviceName = "Interface A", .inputDeviceName = ""});

    const synth::PatchCommandResult loadResult = engine.Patches().LoadPatch(patchDir);
    REQUIRE_TRUE(loadResult.status == synth::PatchCommandStatus::Ok);

    TestBlockBuffers buffers(2, 4);
    {
        // ProcessBlock drains patchInputBus_, applies the LoadFromJSON
        // message (changing audioDeviceState_), and sets
        // audioDeviceChangedPending_ for the tick to consume.
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName == "Interface A");  // state already applied
    REQUIRE_TRUE(callbackCalls == 0);  // callback hasn't run yet: that's the tick's job

    engine.MessageThreadTick();

    REQUIRE_TRUE(callbackCalls == 1);  // fired exactly once
    REQUIRE_TRUE(outputNameAtCallback == "Interface A");  // callback observed the already-applied new state

    // A second tick with no new device-changing patch message must NOT
    // fire again: audioDeviceChangedPending_ was consumed (exchanged false)
    // by the first tick, so the flag must stay cleared here.
    engine.MessageThreadTick();

    REQUIRE_TRUE(callbackCalls == 1);  // still exactly once: flag was consumed, not just observed

    std::filesystem::remove_all(patchDir);
}

TEST_CASE(engine_tick_does_not_fire_audio_device_changed_callback_when_load_has_no_section) {
    // A runtime patch load whose document has no audioDevice section leaves
    // audioDeviceState_ untouched, so the callback must not fire.
    EngineTestApp::testPatchesRoot.clear();
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

TEST_CASE(engine_initialize_fires_audio_device_changed_callback_for_startup_load) {
    // A startup load (found via LatestPatchDirectory + synchronous drain
    // inside Initialize()) whose document carries an audioDevice section
    // must fire audioDeviceChangedCallback_ directly at the end of
    // Initialize() -- mirroring how midiProcessorsRebuiltCallback_ behaves
    // on startup loads. Hosts wire the callback before calling Initialize(),
    // so it must be observable there.
    const std::filesystem::path root =
        std::filesystem::temp_directory_path() / "engine-initialize-audio-device-callback-patch-root";
    std::filesystem::remove_all(root);
    std::filesystem::create_directories(root);
    WriteProbePatchVersion(root / "AAA", 0.75f, std::chrono::system_clock::now(),
                           synth::AudioDeviceState{.outputDeviceName = "Startup Interface", .inputDeviceName = ""});

    EngineTestApp::testPatchesRoot = root;
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });

    int callbackCalls = 0;
    std::string outputNameAtCallback;
    engine.SetAudioDeviceChangedCallback([&]() {
        ++callbackCalls;
        outputNameAtCallback = engine.AudioDeviceSnapshot().outputDeviceName;
    });

    engine.Initialize();

    REQUIRE_TRUE(callbackCalls == 1);  // fired exactly once, during Initialize()
    REQUIRE_TRUE(outputNameAtCallback == "Startup Interface");
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName == "Startup Interface");

    std::filesystem::remove_all(root);
    EngineTestApp::testPatchesRoot.clear();
}

TEST_CASE(engine_audio_state_shadow_synced_after_startup_drain) {
    // Regression test for the audio-state shadow sync bug: when a startup
    // patch changes audioDeviceState_, the lastNotifiedAudioDeviceState_
    // shadow must be re-synced AFTER the drain completes. Otherwise, a
    // subsequent runtime patch WITHOUT an audioDevice section will spuriously
    // detect a change (because the shadow still holds the pre-drain state)
    // and incorrectly fire the callback a second time.
    const std::filesystem::path root =
        std::filesystem::temp_directory_path() / "engine-audio-state-shadow-sync-root";
    std::filesystem::remove_all(root);
    std::filesystem::create_directories(root);
    // Startup patch with audioDevice section
    WriteProbePatchVersion(root / "AAA", 0.75f, std::chrono::system_clock::now(),
                           synth::AudioDeviceState{.outputDeviceName = "Startup Device", .inputDeviceName = ""});

    EngineTestApp::testPatchesRoot = root;
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });

    int callbackCalls = 0;
    engine.SetAudioDeviceChangedCallback([&]() {
        ++callbackCalls;
    });

    engine.Initialize();
    REQUIRE_TRUE(callbackCalls == 1);  // fired once during Initialize for the startup patch

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
    REQUIRE_TRUE(callbackCalls == 1);  // callback should NOT have fired yet

    engine.MessageThreadTick();
    REQUIRE_TRUE(callbackCalls == 1);  // callback must stay at 1 (no spurious change)

    engine.MessageThreadTick();
    REQUIRE_TRUE(callbackCalls == 1);  // second tick must also not fire it again

    std::filesystem::remove_all(root);
    std::filesystem::remove_all(runtimePatchDir);
    EngineTestApp::testPatchesRoot.clear();
}

TEST_CASE(engine_revert_after_host_selection_fires_changed_callback) {
    // Regression test for the reviewer's scenario (Task 3 review, Critical
    // Finding 1): a host-initiated selection (e.g. the runtime's audio-device
    // combo) must advance BOTH the live state and the
    // lastNotifiedAudioDeviceState_ shadow via SetAudioDeviceFromHost. If it
    // only wrote the live state (the old `engine_.AudioDevice().outputDeviceName
    // = ...` pattern), the shadow would stay stale at the pre-selection value,
    // so a later revert back to that stale shadow value would be
    // (incorrectly) treated as "no change" and never notify the host, leaving
    // its JUCE device selection stuck on DeviceX even though the engine's
    // state reverted to empty.
    EngineTestApp::testPatchesRoot.clear();
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

    // Drive a patch REVERT (no saved patch exists, so RevertPatch() falls
    // back to NewPatch()'s RevertAllToDefault -- the default audio device
    // state is empty, i.e. different from "DeviceX") through
    // ProcessBlock + MessageThreadTick.
    const synth::PatchCommandResult revertResult = engine.Patches().RevertPatch();
    REQUIRE_TRUE(revertResult.status == synth::PatchCommandStatus::Ok);

    TestBlockBuffers buffers(2, 4);
    {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    engine.MessageThreadTick();

    // The revert changed the state back to the default (empty), which is a
    // real change relative to "DeviceX" -- the host MUST be told, so the
    // callback fires and observes the reverted (empty) state.
    REQUIRE_TRUE(callbackCalls == 1);
    REQUIRE_TRUE(outputNameAtCallback.empty());
    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName.empty());
}

TEST_CASE(engine_set_audio_device_from_host_fires_no_callback) {
    // (b): SetAudioDeviceFromHost itself must never fire
    // audioDeviceChangedCallback_ -- host-initiated changes are by
    // definition already known to the host that just made them; the
    // callback exists solely to notify the host of changes IT did not
    // originate (patch load/revert).
    EngineTestApp::testPatchesRoot.clear();
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
