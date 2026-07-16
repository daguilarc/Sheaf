#include "Braid4.hpp"
#include "Braid4Core.hpp"
#include "support/SynthRig.hpp"

#include "synth/AppConcepts.hpp"
#include "synth/Modules.hpp"
#include "synth/ParameterModulation.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "Braid 4 system tests must not see JUCE headers -- Braid4Core must stay JUCE-free"
#endif

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <exception>
#include <filesystem>
#include <iostream>
#include <limits>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
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

void RequireNear(double actual, double expected, double tolerance, const char* expr) {
    if (std::fabs(actual - expected) > tolerance) {
        std::ostringstream oss;
        oss << expr << " expected " << expected << " got " << actual;
        throw std::runtime_error(oss.str());
    }
}

#define REQUIRE_NEAR(actual, expected, tolerance) RequireNear((actual), (expected), (tolerance), #actual)

synth::RuntimeDataPaths UseScratchRuntimeDataPaths(const char* testName) {
    const std::filesystem::path dataRoot =
        std::filesystem::temp_directory_path() / "sheaf-braid4-system-tests" / testName;
    std::filesystem::remove_all(dataRoot);
    synth::RuntimeDataPaths paths = synth::RuntimeDataPaths::FromDataRoot(dataRoot);
    std::filesystem::create_directories(paths.patchesRoot);
    return paths;
}

std::size_t SlotPositionToEncoderId(synth::BankSlot& slot, std::size_t position) {
    synth::PhysicalEncoderId encoderId = 0;
    REQUIRE_TRUE(slot.ResolvePosition(position, encoderId));
    return encoderId;
}

bool OutputHasNonSilentFiniteStereo(const std::vector<synth_rig::SynthRig<synth_braid4::Braid4Core>::OutputFrame>& output) {
    bool heardSignal = false;
    for (const auto& frame : output) {
        REQUIRE_TRUE(frame.channels.size() == 2);
        for (const float sample : frame.channels) {
            REQUIRE_TRUE(std::isfinite(sample));
            heardSignal = heardSignal || std::fabs(sample) > 0.000001f;
        }
    }
    return heardSignal;
}

bool HasPolyline(const std::vector<synth::ui::DrawCommand>& commands) {
    return std::any_of(commands.begin(), commands.end(), [](const synth::ui::DrawCommand& command) {
        return command.kind == synth::ui::DrawCommand::Kind::Polyline;
    });
}

struct EngineRunResult {
    std::vector<std::vector<float>> channels;
    synth_braid4::Braid4Core::DebugCounterState counters;
};

enum class Braid4WorkScenario {
    Baseline,
    MaterializedNeutral,
    SparseActive,
    Inactive64Gestures,
};

struct Braid4WorkResult {
    std::size_t topLevelProcessLiteCalls = 0;
    std::size_t activeRouteVisits = 0;
    std::size_t activeGestureVisits = 0;
    std::size_t internalSubframesProcessed = 0;
    std::size_t materializedLocalCount = 0;
    std::size_t remainingMaterializableSlots = 0;
    std::size_t denseConfiguredRouteVisits = 0;
};

Braid4WorkResult MeasureBraid4Work(Braid4WorkScenario scenario) {
    constexpr std::size_t kHostFrames = 32;
    std::uint64_t timestamp = 0;
    synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
    if (scenario == Braid4WorkScenario::Inactive64Gestures) {
        REQUIRE_TRUE(engine.Manager().SetGestureCount(64));
    }
    engine.SetRuntimeDataPaths(UseScratchRuntimeDataPaths("braid4_sparse_work_counters"));
    engine.Initialize();
    engine.Prepare(48000.0, static_cast<int>(kHostFrames));

    auto& core = engine.Application();
    synth::ParameterManager& manager = engine.Manager();
    const std::array<synth::ParameterGroup*, 3> groups{
        core.StereoGroup(),
        core.QuadGroup(),
        core.MonoGroup(),
    };

    Braid4WorkResult result;
    if (scenario == Braid4WorkScenario::MaterializedNeutral) {
        for (synth::ParameterGroup* group : groups) {
            const std::size_t availableBefore = group->AvailableParameterSlots();
            std::size_t materialized = 0;
            std::vector<synth::Parameter*> frontier;
            for (std::size_t parameterIx = 0; parameterIx < manager.ParameterCount(); ++parameterIx) {
                synth::Parameter& parameter = manager.ParameterById(static_cast<synth::ParameterId>(parameterIx));
                if (&parameter.Group() == group) {
                    frontier.push_back(&parameter);
                }
            }
            for (std::size_t parameterIx = 0;
                 parameterIx < frontier.size() && group->AvailableParameterSlots() != 0;
                 ++parameterIx) {
                for (std::size_t sourceIx = 0;
                     sourceIx < group->Config().numModulators && group->AvailableParameterSlots() != 0;
                     ++sourceIx) {
                    synth::Parameter* depth = frontier[parameterIx]->EnsureModulationDepth(sourceIx);
                    REQUIRE_TRUE(depth != nullptr);
                    frontier.push_back(depth);
                    ++materialized;
                }
            }
            REQUIRE_TRUE(materialized == availableBefore);
            result.materializedLocalCount += materialized;
            result.remainingMaterializableSlots += group->AvailableParameterSlots();
        }
    } else if (scenario == Braid4WorkScenario::SparseActive) {
        synth::Parameter& parameter = manager.ParameterById(0);
        synth::Parameter* depth = parameter.EnsureModulationDepth(0);
        REQUIRE_TRUE(depth != nullptr);
        depth->SceneCenter(0) = 0.75f;
        depth->SceneCenter(1) = 0.75f;
        manager.ComputeAllParameters();
    }

    std::array<synth::ParameterProcessingObserver, 3> work{};
    for (std::size_t groupIx = 0; groupIx < groups.size(); ++groupIx) {
        groups[groupIx]->SetProcessingObserverForTests(&work[groupIx]);
    }

    std::array<std::vector<float>, 2> blockStorage{{
        std::vector<float>(kHostFrames, 0.0f),
        std::vector<float>(kHostFrames, 0.0f),
    }};
    std::vector<float*> outputs{blockStorage[0].data(), blockStorage[1].data()};
    synth::AudioBlock block{
        .outputs = outputs.data(),
        .numOutputChannels = 2,
        .numFrames = kHostFrames,
    };
    engine.ProcessBlock(block, timestamp++);

    result.internalSubframesProcessed = core.DebugCounters().internalSubframesProcessed;
    for (const synth::ParameterProcessingObserver& observer : work) {
        result.topLevelProcessLiteCalls += observer.topLevelProcessLiteCalls;
        result.activeRouteVisits += observer.activeRouteVisits;
        result.activeGestureVisits += observer.activeGestureVisits;
    }
    std::size_t denseVisitsPerSubframe = 0;
    for (std::size_t parameterIx = 0; parameterIx < manager.ParameterCount(); ++parameterIx) {
        const synth::Parameter& parameter = manager.ParameterById(static_cast<synth::ParameterId>(parameterIx));
        denseVisitsPerSubframe += parameter.Group().Config().numVoices *
                                  parameter.Group().Config().numModulators;
    }
    result.denseConfiguredRouteVisits = result.internalSubframesProcessed * denseVisitsPerSubframe;
    return result;
}

EngineRunResult RunFreshEngineSegments(int outputChannels, const std::vector<std::size_t>& segmentFrames) {
    std::uint64_t timestamp = 0;
    synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
    engine.Initialize();
    engine.Prepare(synth_braid4::Braid4Core::Config().preferredSampleRate,
                   synth_braid4::Braid4Core::Config().preferredBlockSize);

    std::vector<std::vector<float>> captured(static_cast<std::size_t>(std::max(outputChannels, 0)));
    for (const std::size_t frames : segmentFrames) {
        std::vector<std::vector<float>> blockStorage(static_cast<std::size_t>(std::max(outputChannels, 0)),
                                                     std::vector<float>(frames, 12345.0f));
        std::vector<float*> outputs(blockStorage.size(), nullptr);
        for (std::size_t channel = 0; channel < blockStorage.size(); ++channel) {
            outputs[channel] = blockStorage[channel].data();
        }

        synth::AudioBlock block{
            .outputs = outputs.empty() ? nullptr : outputs.data(),
            .numOutputChannels = outputChannels,
            .numFrames = frames,
        };
        engine.ProcessBlock(block, timestamp++);

        for (std::size_t channel = 0; channel < blockStorage.size(); ++channel) {
            captured[channel].insert(captured[channel].end(), blockStorage[channel].begin(), blockStorage[channel].end());
        }
    }

    return {
        .channels = std::move(captured),
        .counters = engine.Application().DebugCounters(),
    };
}

void SetScenePair(synth::ParameterManager& manager, synth::ParameterId id, float value) {
    manager.ParameterById(id).SceneCenter(0) = value;
    manager.ParameterById(id).SceneCenter(1) = value;
}

void SetScenePairAndSettle(synth::ParameterManager& manager, synth::ParameterId id, float value) {
    SetScenePair(manager, id, value);
    auto& parameter = manager.ParameterById(id);
    for (int ix = 0; ix < 2048; ++ix) {
        parameter.Compute(manager.Scene());
        parameter.ProcessLite();
    }
}

float Scene0(const synth::ParameterManager& manager, synth::ParameterId id) {
    return manager.ParameterById(id).SceneCenter(0);
}

const synth::ui::Node* FindNodeById(const synth::ui::NodeTree& tree, const char* id) {
    for (const synth::ui::Node& node : tree.nodes) {
        if (node.id == synth::ui::NodeId(id)) {
            return &node;
        }
    }
    return nullptr;
}

const synth::ui::Node* FindNodeById(const synth::ui::NodeTree& tree, const std::string& id) {
    return FindNodeById(tree, id.c_str());
}

void RequireNodeId(const synth::ui::NodeTree& tree, const char* id) {
    REQUIRE_TRUE(FindNodeById(tree, id) != nullptr);
}

void RequireAction(const std::optional<synth::ui::Action>& action, const char* expectedName) {
    REQUIRE_TRUE(action.has_value());
    REQUIRE_TRUE(action->name == expectedName);
}

bool PopNextMessage(synth::MessageInBus& uiBus, synth::MessageIn& message) {
    return uiBus.Pop(message, std::numeric_limits<std::uint64_t>::max());
}

template <std::size_t N>
bool PairwiseDistinct(const std::array<synth::Color, N>& colors) {
    for (std::size_t left = 0; left < colors.size(); ++left) {
        for (std::size_t right = left + 1; right < colors.size(); ++right) {
            if (colors[left] == colors[right]) {
                return false;
            }
        }
    }
    return true;
}

bool IsRedFamily(synth::Color color) {
    return color.r > color.g && color.r > color.b;
}

bool IsGreenFamily(synth::Color color) {
    return color.g > color.r && color.g > color.b;
}

void RequireModulePalette(const synth::ParameterManager& manager,
                          const synth::Braid4VcoModule& module,
                          synth::Color familyBase,
                          const std::array<synth::Color, synth::Braid4VcoModule::kOscillatorCount>& shades) {
    const auto ids = module.Parameters();
    for (const synth::ParameterId id : {ids.x, ids.y}) {
        const synth::Parameter& parameter = manager.ParameterById(id);
        REQUIRE_TRUE(parameter.BaseColor() == familyBase);
        REQUIRE_TRUE(parameter.IndicatorColor(0) == familyBase);
        REQUIRE_TRUE(parameter.IndicatorColor(1) == familyBase);
    }

    for (const synth::ParameterId id : {ids.quad.tune, ids.quad.phase, ids.quad.shape, ids.quad.gain}) {
        const synth::Parameter& parameter = manager.ParameterById(id);
        REQUIRE_TRUE(parameter.BaseColor() == familyBase);
        for (std::size_t voiceIx = 0; voiceIx < shades.size(); ++voiceIx) {
            REQUIRE_TRUE(parameter.IndicatorColor(voiceIx) == shades[voiceIx]);
        }
    }

    for (std::size_t oscIx = 0; oscIx < shades.size(); ++oscIx) {
        for (const synth::ParameterId id : {ids.pmIndex[oscIx], ids.frequency[oscIx]}) {
            const synth::Parameter& parameter = manager.ParameterById(id);
            REQUIRE_TRUE(parameter.BaseColor() == shades[oscIx]);
            REQUIRE_TRUE(parameter.IndicatorColor(0) == shades[oscIx]);
        }
    }
}

void RequireBadgePalette(const synth::ui::EncoderDrawState& encoder,
                         synth::Color first,
                         synth::Color second) {
    REQUIRE_TRUE(encoder.modulatorColors.size() == 2);
    REQUIRE_TRUE(encoder.modulatorColors[0] == first);
    REQUIRE_TRUE(encoder.modulatorColors[1] == second);
}

void RequireSnapshotVcoPalette(
    const synth_braid4::Braid4UiSnapshot& snapshot,
    synth::Color familyBase,
    const std::array<synth::Color, synth_braid4::Braid4Core::kOscillatorCount>& shades) {
    for (const std::size_t position : {0u, 1u}) {
        const synth::ui::EncoderDrawState& encoder = snapshot.encoders[position];
        REQUIRE_TRUE(encoder.baseColor == familyBase);
        REQUIRE_TRUE(encoder.voices.size() == 2);
        REQUIRE_TRUE(encoder.voices[0].indicatorColor == familyBase);
        REQUIRE_TRUE(encoder.voices[1].indicatorColor == familyBase);
    }
    for (std::size_t position = 4; position < 8; ++position) {
        const synth::ui::EncoderDrawState& encoder = snapshot.encoders[position];
        REQUIRE_TRUE(encoder.baseColor == familyBase);
        REQUIRE_TRUE(encoder.voices.size() == shades.size());
        for (std::size_t voiceIx = 0; voiceIx < shades.size(); ++voiceIx) {
            REQUIRE_TRUE(encoder.voices[voiceIx].indicatorColor == shades[voiceIx]);
        }
    }
    for (std::size_t position = 8; position < 16; ++position) {
        const std::size_t oscIx = (position - 8) % shades.size();
        const synth::ui::EncoderDrawState& encoder = snapshot.encoders[position];
        REQUIRE_TRUE(encoder.baseColor == shades[oscIx]);
        REQUIRE_TRUE(encoder.voices.size() == 1);
        REQUIRE_TRUE(encoder.voices[0].indicatorColor == shades[oscIx]);
    }
}

struct CapturingMidiSink final : synth::IMidiOutputSink {
    std::vector<synth::BasicMidi> sent;

    void Send(const synth::BasicMidi& midi) override {
        sent.push_back(midi);
    }
};

} // namespace

static_assert(synth::SynthApplicationCore<synth_braid4::Braid4Core>);
static_assert(synth::SynthApplicationCore<synth_braid4::Braid4>);
static_assert(synth::SynthApplication<synth_braid4::Braid4>);

TEST_CASE(config_declares_patch_launchable_stereo_app) {
    const synth::RuntimeConfig config = synth_braid4::Braid4Core::Config();

    REQUIRE_TRUE(config.appName == "Braid 4");
    REQUIRE_TRUE(config.numAudioInputs == 0);
    REQUIRE_TRUE(config.numAudioOutputs == 2);
    REQUIRE_NEAR(config.preferredSampleRate, 48000.0, 0.000001);
    REQUIRE_TRUE(config.preferredBlockSize == 256);
}

TEST_CASE(initializes_parameter_groups_banks_slot_and_scene_endpoints) {
    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(
        64,
        UseScratchRuntimeDataPaths("initializes_parameter_groups_banks_slot_and_scene_endpoints"));
    auto& core = rig.Engine().Application();

    REQUIRE_TRUE(rig.Engine().Manager().NumGroups() == 3);
    REQUIRE_TRUE(core.StereoGroup() != nullptr);
    REQUIRE_TRUE(core.QuadGroup() != nullptr);
    REQUIRE_TRUE(core.MonoGroup() != nullptr);
    REQUIRE_TRUE(core.StereoGroup()->Config().numVoices == 2);
    REQUIRE_TRUE(core.QuadGroup()->Config().numVoices == 4);
    REQUIRE_TRUE(core.MonoGroup()->Config().numVoices == 1);
    REQUIRE_TRUE(core.StereoGroup()->Config().numScenes == 2);
    REQUIRE_TRUE(core.QuadGroup()->Config().numScenes == 2);
    REQUIRE_TRUE(core.MonoGroup()->Config().numScenes == 2);
    REQUIRE_TRUE(rig.Engine().Manager().Scene().leftScene == 0);
    REQUIRE_TRUE(rig.Engine().Manager().Scene().rightScene == 1);

    REQUIRE_TRUE(core.BraidBank() == rig.Engine().Manager().BankAt(0));
    REQUIRE_TRUE(core.MatrixBank() == rig.Engine().Manager().BankAt(1));
    REQUIRE_TRUE(core.LfoBank() == rig.Engine().Manager().BankAt(2));
    REQUIRE_TRUE(core.LfoMatrixBank() == rig.Engine().Manager().BankAt(3));
    REQUIRE_TRUE(rig.Engine().Manager().BankAt(4) == nullptr);
    REQUIRE_TRUE(core.BankSlot() == rig.Engine().Manager().BankSlotAt(0));
    REQUIRE_TRUE(rig.Engine().Manager().BankSlotAt(1) == nullptr);
    REQUIRE_TRUE(core.BankSlot()->PhysicalEncoders().size() == 16);
}

TEST_CASE(braid_scope_remains_visible_while_next_cycle_marker_is_unpublished) {
    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(
        64,
        UseScratchRuntimeDataPaths("braid_scope_remains_visible_while_next_cycle_marker_is_unpublished"));
    rig.RunBlocks(8);
    auto& core = rig.Engine().Application();

    const synth::ui::Bounds bounds{10.0f, 20.0f, 180.0f, 90.0f};
    const auto published = synth_braid4::BuildBraid4ScopeCommands(
        synth_braid4::ScopeDrawStateFromCore(core, 0), bounds);
    REQUIRE_TRUE(HasPolyline(published));

    auto inFlightHolder = core.ScopeHolders()[0];
    inFlightHolder.RecordStart();
    const auto whileWriting = synth_braid4::BuildBraid4ScopeCommands(
        synth_braid4::ScopeDrawStateFromCore(core, 0), bounds);
    REQUIRE_TRUE(HasPolyline(whileWriting));
}

TEST_CASE(parallel_lfo_topology_banks_colors_and_modulator_slots) {
    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(
        64,
        UseScratchRuntimeDataPaths("parallel_lfo_topology_banks_colors_and_modulator_slots"));
    auto& core = rig.Engine().Application();

    REQUIRE_TRUE(rig.Engine().Manager().NumGroups() == 3);
    REQUIRE_TRUE(core.StereoGroup()->Config().numModulators == 2);
    REQUIRE_TRUE(core.QuadGroup()->Config().numModulators == 2);
    REQUIRE_TRUE(core.MonoGroup()->Config().numModulators == 2);
    REQUIRE_TRUE(core.MonoGroup()->ParameterCount() == 48);

    REQUIRE_TRUE(core.BraidBank() == rig.Engine().Manager().BankAt(0));
    REQUIRE_TRUE(core.MatrixBank() == rig.Engine().Manager().BankAt(1));
    REQUIRE_TRUE(core.LfoBank() == rig.Engine().Manager().BankAt(2));
    REQUIRE_TRUE(core.LfoMatrixBank() == rig.Engine().Manager().BankAt(3));
    REQUIRE_TRUE(rig.Engine().Manager().BankAt(4) == nullptr);

    REQUIRE_TRUE(core.BraidBank()->BankColor() == synth::Color::Red);
    REQUIRE_TRUE(core.MatrixBank()->BankColor() == synth::Color::Orange);
    REQUIRE_TRUE(core.LfoBank()->BankColor() == synth::Color::Green);
    REQUIRE_TRUE(core.LfoMatrixBank()->BankColor() == synth::Color::Yellow);

    const auto lfoIds = core.LfoModule().Parameters();
    SetScenePairAndSettle(rig.Engine().Manager(), lfoIds.frequency[0], 0.0f);
    SetScenePairAndSettle(rig.Engine().Manager(), lfoIds.frequency[1], 0.0f);
    SetScenePairAndSettle(rig.Engine().Manager(), lfoIds.frequency[2], 0.0f);
    SetScenePairAndSettle(rig.Engine().Manager(), lfoIds.frequency[3], 0.0f);
    core.LfoModule().SetInput(rig.Engine().Manager());

    REQUIRE_NEAR(core.LfoModule().CurrentInput().oscillators[0].baseFrequencyHz, 10.0f / 1024.0f, 0.0001);
    REQUIRE_NEAR(core.LfoModule().CurrentInput().oscillators[1].baseFrequencyHz, 50.0f / 1024.0f, 0.0001);
    REQUIRE_NEAR(core.LfoModule().CurrentInput().oscillators[2].baseFrequencyHz, 250.0f / 1024.0f, 0.0001);
    REQUIRE_NEAR(core.LfoModule().CurrentInput().oscillators[3].baseFrequencyHz, 1000.0f / 1024.0f, 0.0001);
}

TEST_CASE(default_instrument_uses_shared_wrldbldr_default_profile) {
    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(
        64,
        UseScratchRuntimeDataPaths("default_instrument_uses_shared_wrldbldr_default_profile"));

    const synth::MidiInstrumentConfig& defaultInstrument = rig.Engine().DefaultInstrument();
    REQUIRE_TRUE(defaultInstrument.controllers.size() == 1);
    const synth::MidiControllerSlot& slot = defaultInstrument.controllers.front();
    REQUIRE_TRUE(slot.name == "wrldbldr");
    REQUIRE_TRUE(slot.kind == synth::MidiProfileKind::WrldBldr);

    const synth::MidiInstrumentConfig expected = synth::DefaultMidiInstrumentConfig();
    REQUIRE_TRUE(expected.controllers.size() == 1);
    REQUIRE_TRUE(slot.config.encoderInput.has_value());
    REQUIRE_TRUE(expected.controllers.front().config.encoderInput.has_value());
    REQUIRE_TRUE(slot.config.encoderInput->turns.size() == expected.controllers.front().config.encoderInput->turns.size());
    REQUIRE_TRUE(slot.config.encoderInput->pushes.size() == expected.controllers.front().config.encoderInput->pushes.size());
    REQUIRE_TRUE(slot.config.systemMessages.size() == expected.controllers.front().config.systemMessages.size());
    REQUIRE_TRUE(slot.config.systemMessages.size() == 28);
}

TEST_CASE(braid_and_matrix_banks_expose_required_encoder_cells) {
    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(
        64,
        UseScratchRuntimeDataPaths("braid_and_matrix_banks_expose_required_encoder_cells"));
    auto& core = rig.Engine().Application();
    auto& slot = *core.BankSlot();

    REQUIRE_TRUE(core.MonoGroup()->ParameterCount() == 48);
    REQUIRE_TRUE(core.QuadGroup()->Config().numModulators == 2);

    for (std::size_t position = 0; position < 16; ++position) {
        const auto encoderId = SlotPositionToEncoderId(slot, position);
        const synth::Parameter* braidParam = core.BraidBank()->VisibleParameter(encoderId);
        if (position == 2 || position == 3) {
            REQUIRE_TRUE(braidParam == nullptr);
        } else {
            REQUIRE_TRUE(braidParam != nullptr);
            if (position == 0 || position == 1) {
                REQUIRE_TRUE(braidParam->BaseColor() == synth::Color::Red);
            } else {
                REQUIRE_TRUE(braidParam->BaseColor() != synth::Color::Off);
            }
        }

        const synth::Parameter* matrixParam = core.MatrixBank()->VisibleParameter(encoderId);
        REQUIRE_TRUE(matrixParam != nullptr);
        REQUIRE_TRUE(matrixParam->BaseColor() == synth::Color::Orange || matrixParam->BaseColor() == synth::Color::Yellow);

        const synth::Parameter* lfoMatrixParam = core.LfoMatrixBank()->VisibleParameter(encoderId);
        REQUIRE_TRUE(lfoMatrixParam != nullptr);
        REQUIRE_TRUE(lfoMatrixParam->BaseColor() == synth_braid4::Braid4Core::LfoMatrixDiagonalColor() ||
                     lfoMatrixParam->BaseColor() == synth::Color::Yellow);
    }

    REQUIRE_TRUE(core.MatrixModule().Parameters()[0] == core.MonoGroup()->ParameterByLocalIndex(8).Id());
    REQUIRE_TRUE(core.MatrixModule().Parameters()[15] == core.MonoGroup()->ParameterByLocalIndex(23).Id());
    REQUIRE_TRUE(core.LfoModule().Parameters().pmIndex[0] == core.MonoGroup()->ParameterByLocalIndex(24).Id());
    REQUIRE_TRUE(core.LfoModule().Parameters().frequency[3] == core.MonoGroup()->ParameterByLocalIndex(31).Id());
    REQUIRE_TRUE(core.LfoMatrixModule().Parameters()[0] == core.MonoGroup()->ParameterByLocalIndex(32).Id());
    REQUIRE_TRUE(core.LfoMatrixModule().Parameters()[15] == core.MonoGroup()->ParameterByLocalIndex(47).Id());
}

TEST_CASE(braid4_parameter_processing_ignores_materialized_local_depths) {
    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(
        64,
        UseScratchRuntimeDataPaths("braid4_parameter_processing_ignores_materialized_local_depths"));
    auto& core = rig.Engine().Application();
    const std::array<synth::ParameterGroup*, 3> groups{
        core.StereoGroup(),
        core.QuadGroup(),
        core.MonoGroup(),
    };

    std::size_t rootCount = 0;
    std::array<synth::ParameterProcessingObserver, 3> work{};
    for (std::size_t groupIx = 0; groupIx < groups.size(); ++groupIx) {
        synth::ParameterGroup& group = *groups[groupIx];
        rootCount += group.ParameterCount();
        REQUIRE_TRUE(group.ParameterByLocalIndex(0).EnsureModulationDepth(0) != nullptr);
        group.SetProcessingObserverForTests(&work[groupIx]);
    }

    REQUIRE_TRUE(rootCount == rig.Engine().Manager().ParameterCount());
    for (synth::ParameterGroup* group : groups) {
        group->ProcessSample(1);
    }

    const std::size_t visited = work[0].topLevelProcessLiteCalls +
                                work[1].topLevelProcessLiteCalls +
                                work[2].topLevelProcessLiteCalls;
    REQUIRE_TRUE(visited == rootCount);
}

TEST_CASE(braid4_sparse_work_counters_bound_inactive_capacity) {
    const Braid4WorkResult baseline = MeasureBraid4Work(Braid4WorkScenario::Baseline);
    const Braid4WorkResult neutral = MeasureBraid4Work(Braid4WorkScenario::MaterializedNeutral);
    const Braid4WorkResult sparse = MeasureBraid4Work(Braid4WorkScenario::SparseActive);
    const Braid4WorkResult inactive64 = MeasureBraid4Work(Braid4WorkScenario::Inactive64Gestures);

    REQUIRE_TRUE(neutral.topLevelProcessLiteCalls == baseline.topLevelProcessLiteCalls);
    REQUIRE_TRUE(sparse.topLevelProcessLiteCalls == baseline.topLevelProcessLiteCalls);
    REQUIRE_TRUE(inactive64.topLevelProcessLiteCalls == baseline.topLevelProcessLiteCalls);
    REQUIRE_TRUE(neutral.internalSubframesProcessed == baseline.internalSubframesProcessed);
    REQUIRE_TRUE(sparse.internalSubframesProcessed == baseline.internalSubframesProcessed);
    REQUIRE_TRUE(inactive64.internalSubframesProcessed == baseline.internalSubframesProcessed);
    REQUIRE_TRUE(neutral.materializedLocalCount > 0);
    REQUIRE_TRUE(neutral.remainingMaterializableSlots == 0);
    REQUIRE_TRUE(neutral.activeRouteVisits == 0);
    REQUIRE_TRUE(inactive64.activeGestureVisits == 0);
    REQUIRE_TRUE(sparse.activeRouteVisits > 0);
    REQUIRE_TRUE(sparse.activeRouteVisits < sparse.denseConfiguredRouteVisits);
}

TEST_CASE(braid_palette_roles_propagate_from_literal_configuration) {
    synth::ParameterManager manager;
    synth::MessageInBus uiBus(&manager);
    synth::MidiInstrumentConfig instrument;
    synth::RuntimeConfig config = synth_braid4::Braid4::Config();
    synth::AppContext context;
    context.parameterManager = &manager;
    context.uiBus = &uiBus;
    context.instrument = &instrument;
    context.config = &config;

    synth_braid4::Braid4 app;
    app.Init(&context);
    auto uiState = manager.CreateUIState();
    context.uiState = uiState.get();
    manager.PopulateUIState(*context.uiState);

    const std::array<synth::Color, 4> expectedRedShades{
        synth::Color::Rgb(242, 29, 65),
        synth::Color::Rgb(224, 40, 47),
        synth::Color::Rgb(209, 62, 46),
        synth::Color::Rgb(194, 84, 50),
    };
    const std::array<synth::Color, 4> expectedGreenShades{
        synth::Color::Rgb(42, 224, 36),
        synth::Color::Rgb(42, 209, 75),
        synth::Color::Rgb(48, 199, 113),
        synth::Color::Rgb(53, 189, 143),
    };
    const auto redShades = synth_braid4::Braid4Core::RedShades();
    const auto greenShades = synth_braid4::Braid4Core::GreenShades();
    REQUIRE_TRUE(redShades == expectedRedShades);
    REQUIRE_TRUE(greenShades == expectedGreenShades);
    REQUIRE_TRUE(PairwiseDistinct(redShades));
    REQUIRE_TRUE(PairwiseDistinct(greenShades));
    for (const synth::Color color : redShades) {
        REQUIRE_TRUE(IsRedFamily(color));
    }
    for (const synth::Color color : greenShades) {
        REQUIRE_TRUE(IsGreenFamily(color));
        for (const synth::Color red : redShades) {
            REQUIRE_TRUE(color != red);
        }
    }

    RequireModulePalette(manager, app.BraidModule(), synth::Color::Rgb(255, 0, 0), expectedRedShades);
    constexpr synth::Color kFullGreen = synth::Color::Rgb(0, 255, 0);
    RequireModulePalette(manager, app.LfoModule(), kFullGreen, expectedGreenShades);

    const auto matrixIds = app.MatrixModule().Parameters();
    const auto lfoMatrixIds = app.LfoMatrixModule().Parameters();
    for (std::size_t row = 0; row < 4; ++row) {
        for (std::size_t column = 0; column < 4; ++column) {
            const std::size_t index = row * 4 + column;
            REQUIRE_TRUE(manager.ParameterById(matrixIds[index]).BaseColor() ==
                         (row == column ? synth::Color::Rgb(255, 128, 0) : synth::Color::Rgb(255, 220, 0)));
            REQUIRE_TRUE(manager.ParameterById(lfoMatrixIds[index]).BaseColor() ==
                         (row == column ? synth::Color::Rgb(154, 235, 33) : synth::Color::Rgb(255, 220, 0)));
        }
    }

    REQUIRE_TRUE(app.BraidBank()->BankColor() == synth::Color::Rgb(255, 0, 0));
    REQUIRE_TRUE(app.MatrixBank()->BankColor() == synth::Color::Rgb(255, 128, 0));
    REQUIRE_TRUE(app.LfoBank()->BankColor() == synth::Color::Rgb(0, 200, 80));
    REQUIRE_TRUE(app.LfoMatrixBank()->BankColor() == synth::Color::Rgb(255, 220, 0));
    REQUIRE_TRUE(app.StereoGroup()->GetModulators().Metadata()[0].sourceColor == synth::Color::Rgb(255, 0, 0));
    REQUIRE_TRUE(app.StereoGroup()->GetModulators().Metadata()[1].sourceColor == synth::Color::Rgb(0, 200, 80));
    REQUIRE_TRUE(app.QuadGroup()->GetModulators().Metadata()[0].sourceColor == synth::Color::Rgb(255, 128, 0));
    REQUIRE_TRUE(app.QuadGroup()->GetModulators().Metadata()[1].sourceColor == synth::Color::Rgb(255, 220, 0));
    REQUIRE_TRUE(app.MonoGroup()->GetModulators().Metadata()[0].sourceColor == synth::Color::Rgb(255, 0, 0));
    REQUIRE_TRUE(app.MonoGroup()->GetModulators().Metadata()[1].sourceColor == synth::Color::Rgb(0, 200, 80));

    app.BraidModule().PopulateUIState(app.VcoUiState());
    app.LfoModule().PopulateUIState(app.LfoUiState());
    for (std::size_t oscIx = 0; oscIx < 4; ++oscIx) {
        const auto audibleScope = synth_braid4::ScopeDrawStateFromCore(app, oscIx);
        const auto lfoScope = synth_braid4::LfoScopeDrawStateFromCore(app, oscIx);
        REQUIRE_TRUE(audibleScope.layers.size() == 1);
        REQUIRE_TRUE(lfoScope.layers.size() == 1);
        REQUIRE_TRUE(audibleScope.layers[0].scopeColor == expectedRedShades[oscIx]);
        REQUIRE_TRUE(lfoScope.layers[0].scopeColor == expectedGreenShades[oscIx]);
    }

    const auto braidSnapshot = synth_braid4::SnapshotUiState(&context);
    RequireSnapshotVcoPalette(braidSnapshot, synth::Color::Red, expectedRedShades);
    RequireBadgePalette(braidSnapshot.encoders[0], synth::Color::Red, synth::Color::Green);
    RequireBadgePalette(braidSnapshot.encoders[4], synth::Color::Orange, synth::Color::Yellow);
    RequireBadgePalette(braidSnapshot.encoders[8], synth::Color::Red, synth::Color::Green);

    app.BankSlot()->SelectBank(app.MatrixBank());
    manager.PopulateUIState(*context.uiState);
    const auto matrixSnapshot = synth_braid4::SnapshotUiState(&context);
    RequireBadgePalette(matrixSnapshot.encoders[0], synth::Color::Red, synth::Color::Green);

    app.BankSlot()->SelectBank(app.LfoBank());
    manager.PopulateUIState(*context.uiState);
    const auto lfoSnapshot = synth_braid4::SnapshotUiState(&context);
    RequireSnapshotVcoPalette(lfoSnapshot, kFullGreen, expectedGreenShades);
    RequireBadgePalette(lfoSnapshot.encoders[0], synth::Color::Red, synth::Color::Green);
    RequireBadgePalette(lfoSnapshot.encoders[4], synth::Color::Orange, synth::Color::Yellow);
    RequireBadgePalette(lfoSnapshot.encoders[8], synth::Color::Red, synth::Color::Green);

    app.BankSlot()->SelectBank(app.LfoMatrixBank());
    manager.PopulateUIState(*context.uiState);
    const auto lfoMatrixSnapshot = synth_braid4::SnapshotUiState(&context);
    RequireBadgePalette(lfoMatrixSnapshot.encoders[0], synth::Color::Red, synth::Color::Green);

    app.BankSlot()->SelectBank(app.BraidBank());
    manager.PopulateUIState(*context.uiState);
    const auto screenSnapshot = synth_braid4::SnapshotUiState(&context);
    const synth::ui::EncoderDrawState& screenEncoder = screenSnapshot.encoders[4];
    CapturingMidiSink sink;
    synth::MidiSender sender;
    sender.SetSink(0, &sink);
    sender.Start();
    auto outputConfig = synth::EncoderMidiOutConfig::WrldBldrDefault(0);
    outputConfig.KeepFirstPositions(5);
    outputConfig.wrldBldrColorBudgetPerProcess = 10;
    const std::uint8_t targetCc = outputConfig.mappings[4].cc;
    synth::WrldBldrMidiOutProcessor output(outputConfig, &sender, context.uiState);
    output.Process();
    REQUIRE_TRUE(sender.FlushForTests(std::chrono::milliseconds(500)));
    sender.Stop();

    bool sawBase = false;
    bool sawIndicator = false;
    for (const synth::BasicMidi& midi : sink.sent) {
        if (midi.raw.size() != 14 || midi.raw[9] != targetCc) {
            continue;
        }
        if (midi.raw[8] == 1) {
            REQUIRE_TRUE(midi.raw[10] == screenEncoder.baseColor.r / 2);
            REQUIRE_TRUE(midi.raw[11] == screenEncoder.baseColor.g / 2);
            REQUIRE_TRUE(midi.raw[12] == screenEncoder.baseColor.b / 2);
            sawBase = true;
        } else if (midi.raw[8] == 0) {
            REQUIRE_TRUE(midi.raw[10] == screenEncoder.voices[0].indicatorColor.r / 2);
            REQUIRE_TRUE(midi.raw[11] == screenEncoder.voices[0].indicatorColor.g / 2);
            REQUIRE_TRUE(midi.raw[12] == screenEncoder.voices[0].indicatorColor.b / 2);
            sawIndicator = true;
        }
    }
    REQUIRE_TRUE(sawBase);
    REQUIRE_TRUE(sawIndicator);
}

TEST_CASE(braid_snapshot_translation_does_not_rewrite_published_colors) {
    synth::ParameterManager manager;
    synth::MessageInBus uiBus(&manager);
    synth::MidiInstrumentConfig instrument;
    synth::RuntimeConfig config = synth_braid4::Braid4::Config();
    synth::AppContext context;
    context.parameterManager = &manager;
    context.uiBus = &uiBus;
    context.instrument = &instrument;
    context.config = &config;

    synth_braid4::Braid4 app;
    app.Init(&context);
    auto uiState = manager.CreateUIState();
    context.uiState = uiState.get();
    manager.PopulateUIState(*context.uiState);

    synth::Parameter::UIState& published = context.uiState->slots[0].cells[4];
    published.indicatorColors[0].Store(synth::Color::Blue);
    const auto snapshot = synth_braid4::SnapshotUiState(&context);
    REQUIRE_TRUE(snapshot.encoders[4].voices[0].indicatorColor == synth::Color::Blue);
}

TEST_CASE(portable_surface_exposes_braid_main_screen_and_routes_actions) {
    synth::ParameterManager manager;
    synth::MessageInBus uiBus(&manager);
    synth::MidiInstrumentConfig instrument;
    synth::RuntimeConfig config = synth_braid4::Braid4::Config();
    synth::AppContext context;
    context.parameterManager = &manager;
    context.uiBus = &uiBus;
    context.instrument = &instrument;
    context.config = &config;

    std::uint64_t timestamp = 700;
    context.now = [&timestamp]() { return timestamp++; };

    synth_braid4::Braid4 app;
    app.Init(&context);
    auto uiState = manager.CreateUIState();
    context.uiState = uiState.get();
    manager.PopulateUIState(*context.uiState);

    synth::ui::Surface& surface = app.PortableSurface();
    const synth::ui::NodeTree braidTree = surface.BuildTree();
    const auto redShades = synth_braid4::Braid4Core::RedShades();
    const auto greenShades = synth_braid4::Braid4Core::GreenShades();
    const auto braidSnapshot = synth_braid4::SnapshotUiState(&context);
    REQUIRE_TRUE(braidSnapshot.selectedBank == 0);
    REQUIRE_TRUE(braidSnapshot.encoders[0].voices[0].indicatorColor == synth::Color::Red);
    REQUIRE_TRUE(braidSnapshot.encoders[4].voices[0].indicatorColor == redShades[0]);
    REQUIRE_TRUE(braidSnapshot.encoders[4].voices[3].indicatorColor == redShades[3]);
    REQUIRE_TRUE(braidSnapshot.encoders[8].voices[0].indicatorColor == braidSnapshot.encoders[8].baseColor);

    RequireNodeId(braidTree, "braid4.root");
    float lastVcoY = -1.0f;
    float firstLfoY = std::numeric_limits<float>::max();
    for (std::size_t scopeIx = 0; scopeIx < 4; ++scopeIx) {
        const synth::ui::Node* vcoScope = FindNodeById(braidTree, "braid4.scope.vco." + std::to_string(scopeIx));
        REQUIRE_TRUE(vcoScope != nullptr);
        REQUIRE_TRUE(vcoScope->kind == synth::ui::NodeKind::Draw);
        REQUIRE_TRUE(!vcoScope->drawCommands.empty());
        lastVcoY = std::max(lastVcoY, vcoScope->bounds.y + vcoScope->bounds.height);

        const synth::ui::Node* lfoScope = FindNodeById(braidTree, "braid4.scope.lfo." + std::to_string(scopeIx));
        REQUIRE_TRUE(lfoScope != nullptr);
        REQUIRE_TRUE(lfoScope->kind == synth::ui::NodeKind::Draw);
        REQUIRE_TRUE(!lfoScope->drawCommands.empty());
        firstLfoY = std::min(firstLfoY, lfoScope->bounds.y);
    }
    REQUIRE_TRUE(firstLfoY > lastVcoY);
    for (std::size_t encoderIx = 0; encoderIx < 16; ++encoderIx) {
        const synth::ui::Node* encoder = FindNodeById(braidTree, "braid4.encoder." + std::to_string(encoderIx));
        REQUIRE_TRUE(encoder != nullptr);
        REQUIRE_TRUE(encoder->kind == synth::ui::NodeKind::Draw);
        RequireAction(encoder->pointerDragAction, "braid4.encoder.drag");
        RequireAction(encoder->doubleClickAction, "braid4.encoder.push");
    }
    RequireNodeId(braidTree, "braid4.scene.0");
    RequireNodeId(braidTree, "braid4.scene.1");
    const synth::ui::Node* blend = FindNodeById(braidTree, "braid4.scene.blend");
    REQUIRE_TRUE(blend != nullptr);
    REQUIRE_TRUE(blend->kind == synth::ui::NodeKind::Slider);

    const synth::ui::Node* disconnected2 = FindNodeById(braidTree, "braid4.encoder.2");
    const synth::ui::Node* disconnected3 = FindNodeById(braidTree, "braid4.encoder.3");
    REQUIRE_TRUE(disconnected2 != nullptr && disconnected2->drawCommands.empty());
    REQUIRE_TRUE(disconnected3 != nullptr && disconnected3->drawCommands.empty());

    surface.DispatchAction(synth::ui::Action::WithValue("braid4.encoder.drag", "0:5:0.25"));
    synth::MessageIn message;
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ParamIncDec);
    REQUIRE_TRUE(message.slotIx == 0);
    REQUIRE_TRUE(message.position == 5);
    REQUIRE_NEAR(message.delta, 0.25f, 0.000001);
    REQUIRE_TRUE(message.timestamp == 700);

    surface.DispatchAction(synth::ui::Action::WithValue("braid4.encoder.push", "0:5:0"));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ParamPush);
    REQUIRE_TRUE(message.slotIx == 0);
    REQUIRE_TRUE(message.position == 5);
    REQUIRE_TRUE(message.timestamp == 701);

    surface.DispatchAction(synth::ui::Action::WithValue("braid4.bank.select", "1"));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SelectParamBank);
    REQUIRE_TRUE(message.slotIx == 0);
    REQUIRE_TRUE(message.bankIx == 1);
    REQUIRE_TRUE(message.timestamp == 702);

    surface.DispatchAction(synth::ui::Action::WithValue("braid4.bank.select", "3"));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SelectParamBank);
    REQUIRE_TRUE(message.slotIx == 0);
    REQUIRE_TRUE(message.bankIx == 3);
    REQUIRE_TRUE(message.timestamp == 703);

    surface.DispatchAction(synth::ui::Action::WithValue("braid4.scene.select", "1"));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SceneSelect);
    REQUIRE_TRUE(message.sceneIx == 1);
    REQUIRE_TRUE(message.timestamp == 704);

    surface.DispatchAction(synth::ui::Action::WithValue("braid4.scene.blend", "0.60"));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetSceneBlend);
    REQUIRE_NEAR(message.value, 0.60f, 0.000001);
    REQUIRE_TRUE(message.timestamp == 705);

    uiBus.Push(synth::MessageIn::SelectParamBank(800, 0, 1));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    uiBus.Apply(message);
    manager.PopulateUIState(*context.uiState);
    const synth::ui::NodeTree matrixTree = surface.BuildTree();
    const auto matrixSnapshot = synth_braid4::SnapshotUiState(&context);
    REQUIRE_TRUE(matrixSnapshot.selectedBank == 1);
    REQUIRE_TRUE(matrixSnapshot.encoders[0].voices[0].indicatorColor == matrixSnapshot.encoders[0].baseColor);
    REQUIRE_TRUE(matrixSnapshot.encoders[1].voices[0].indicatorColor == matrixSnapshot.encoders[1].baseColor);
    for (std::size_t encoderIx = 0; encoderIx < 16; ++encoderIx) {
        const synth::ui::Node* encoder = FindNodeById(matrixTree, "braid4.encoder." + std::to_string(encoderIx));
        REQUIRE_TRUE(encoder != nullptr);
        REQUIRE_TRUE(encoder->kind == synth::ui::NodeKind::Draw);
    }
    REQUIRE_TRUE(!FindNodeById(matrixTree, "braid4.encoder.2")->drawCommands.empty());
    REQUIRE_TRUE(!FindNodeById(matrixTree, "braid4.encoder.3")->drawCommands.empty());

    uiBus.Push(synth::MessageIn::SelectParamBank(801, 0, 2));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    uiBus.Apply(message);
    manager.PopulateUIState(*context.uiState);
    const auto lfoSnapshot = synth_braid4::SnapshotUiState(&context);
    REQUIRE_TRUE(lfoSnapshot.selectedBank == 2);
    REQUIRE_TRUE(lfoSnapshot.encoders[0].baseColor == synth::Color::Rgb(0, 255, 0));
    REQUIRE_TRUE(lfoSnapshot.encoders[0].voices[0].indicatorColor == synth::Color::Rgb(0, 255, 0));
    REQUIRE_TRUE(lfoSnapshot.encoders[4].voices[0].indicatorColor == greenShades[0]);
    REQUIRE_TRUE(lfoSnapshot.encoders[4].voices[3].indicatorColor == greenShades[3]);
    REQUIRE_TRUE(lfoSnapshot.encoders[8].voices[0].indicatorColor == lfoSnapshot.encoders[8].baseColor);

    uiBus.Push(synth::MessageIn::SelectParamBank(802, 0, 3));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    uiBus.Apply(message);
    manager.PopulateUIState(*context.uiState);
    const auto lfoMatrixSnapshot = synth_braid4::SnapshotUiState(&context);
    REQUIRE_TRUE(lfoMatrixSnapshot.selectedBank == 3);
    REQUIRE_TRUE(lfoMatrixSnapshot.encoders[0].baseColor == synth_braid4::Braid4Core::LfoMatrixDiagonalColor());
    REQUIRE_TRUE(lfoMatrixSnapshot.encoders[0].voices[0].indicatorColor == lfoMatrixSnapshot.encoders[0].baseColor);
    REQUIRE_TRUE(lfoMatrixSnapshot.encoders[1].baseColor == synth::Color::Yellow);
    REQUIRE_TRUE(lfoMatrixSnapshot.encoders[1].voices[0].indicatorColor == lfoMatrixSnapshot.encoders[1].baseColor);
}

TEST_CASE(braid4_modulation_view_remains_encoder_only_without_visualizers) {
    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(
        64,
        UseScratchRuntimeDataPaths("braid4_modulation_view_remains_encoder_only_without_visualizers"));
    rig.RunBlocks(4);
    rig.Press(0, 0);
    rig.RunBlocks(1);

    auto& manager = rig.Engine().Manager();
    auto ui = manager.CreateUIState();
    manager.PopulateUIState(*ui);

    synth::AppContext context = rig.Engine().Context();
    context.uiState = ui.get();
    synth_braid4::Braid4UiSurface surface;
    surface.Attach(&context, &rig.Engine().Application());
    const synth::ui::NodeTree tree = surface.BuildTree();
    const std::string encoderId = synth_braid4::Braid4NodeIds::Encoder(0);
    REQUIRE_TRUE(FindNodeById(tree, encoderId) != nullptr);
    REQUIRE_TRUE(FindNodeById(tree, encoderId + ".visualizer") == nullptr);
}

TEST_CASE(braid4_modulator_visualizer_pointers_remain_null) {
    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(
        64,
        UseScratchRuntimeDataPaths("braid4_modulator_visualizer_pointers_remain_null"));
    const synth::ParameterGroup* groups[] = {
        rig.Engine().Application().StereoGroup(),
        rig.Engine().Application().QuadGroup(),
        rig.Engine().Application().MonoGroup(),
    };
    for (const synth::ParameterGroup* group : groups) {
        REQUIRE_TRUE(group != nullptr);
        REQUIRE_TRUE(group->Config().numModulators == 2);
        REQUIRE_TRUE(group->GetModulators().Metadata(0).visualizer == nullptr);
        REQUIRE_TRUE(group->GetModulators().Metadata(1).visualizer == nullptr);
    }
}

TEST_CASE(matrix_sources_materialize_quad_modulator_values_for_four_voices) {
    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(
        64,
        UseScratchRuntimeDataPaths("matrix_sources_materialize_quad_modulator_values_for_four_voices"));
    auto& core = rig.Engine().Application();

    core.SetRawMatrixOutputForTest(0, -2.0f);
    core.SetRawMatrixOutputForTest(1, -1.0f);
    core.SetRawMatrixOutputForTest(2, 0.0f);
    core.SetRawMatrixOutputForTest(3, 2.0f);
    core.PublishMatrixModulatorsForTest();

    REQUIRE_NEAR(core.NormalizedMatrixSource(0), 0.0, 0.000001);
    REQUIRE_NEAR(core.NormalizedMatrixSource(1), 0.0, 0.000001);
    REQUIRE_NEAR(core.NormalizedMatrixSource(2), 0.5, 0.000001);
    REQUIRE_NEAR(core.NormalizedMatrixSource(3), 1.0, 0.000001);

    core.QuadGroup()->UpdateModValues();
    REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(0, 0), 0.0, 0.000001);
    REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(1, 0), 0.0, 0.000001);
    REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(2, 0), 0.5, 0.000001);
    REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(3, 0), 1.0, 0.000001);
}

TEST_CASE(audio_and_lfo_outputs_publish_normalized_stereo_mono_and_quad_modulators) {
    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(
        64,
        UseScratchRuntimeDataPaths("audio_and_lfo_outputs_publish_normalized_stereo_mono_and_quad_modulators"));
    auto& core = rig.Engine().Application();

    core.SetRawAudioStereoOutputForTest(-2.0f, 0.5f);
    core.SetRawLfoStereoOutputForTest(-0.5f, 2.0f);
    core.SetRawMatrixOutputForTest(0, -2.0f);
    core.SetRawMatrixOutputForTest(1, -1.0f);
    core.SetRawMatrixOutputForTest(2, 0.0f);
    core.SetRawMatrixOutputForTest(3, 2.0f);
    core.SetRawLfoMatrixOutputForTest(0, -1.0f);
    core.SetRawLfoMatrixOutputForTest(1, 0.0f);
    core.SetRawLfoMatrixOutputForTest(2, 1.0f);
    core.SetRawLfoMatrixOutputForTest(3, 2.0f);
    core.PublishAllModulatorsForTest();

    core.StereoGroup()->UpdateModValues();
    core.MonoGroup()->UpdateModValues();
    core.QuadGroup()->UpdateModValues();

    REQUIRE_NEAR(core.StereoGroup()->GetModulators().Value(0, 0), 0.0, 0.000001);
    REQUIRE_NEAR(core.StereoGroup()->GetModulators().Value(1, 0), 0.75, 0.000001);
    REQUIRE_NEAR(core.StereoGroup()->GetModulators().Value(0, 1), 0.25, 0.000001);
    REQUIRE_NEAR(core.StereoGroup()->GetModulators().Value(1, 1), 1.0, 0.000001);

    REQUIRE_NEAR(core.MonoGroup()->GetModulators().Value(0, 0), 0.125, 0.000001);
    REQUIRE_NEAR(core.MonoGroup()->GetModulators().Value(0, 1), 0.875, 0.000001);

    REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(0, 0), 0.0, 0.000001);
    REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(1, 0), 0.0, 0.000001);
    REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(2, 0), 0.5, 0.000001);
    REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(3, 0), 1.0, 0.000001);
    REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(0, 1), 0.0, 0.000001);
    REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(1, 1), 0.5, 0.000001);
    REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(2, 1), 1.0, 0.000001);
    REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(3, 1), 1.0, 0.000001);
}

TEST_CASE(prepares_four_x_internal_rate_and_sequences_internal_subframes) {
    synth::RuntimeConfig config = synth_braid4::Braid4Core::Config();
    std::uint64_t timestamp = 0;
    synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
    engine.Initialize();

    for (const double hostRate : {44100.0, 48000.0, 96000.0}) {
        engine.Prepare(hostRate, config.preferredBlockSize);
        auto& core = engine.Application();
        REQUIRE_NEAR(core.HostSampleRate(), hostRate, 0.000001);
        REQUIRE_NEAR(core.InternalSampleRate(), hostRate * 4.0, 0.000001);
        REQUIRE_TRUE(core.BraidModule().SampleRate() == static_cast<float>(hostRate * 4.0));
    }

    std::array<float, 8> left{};
    std::array<float, 8> right{};
    std::array<float*, 2> outputs{left.data(), right.data()};
    synth::AudioBlock block{
        .outputs = outputs.data(),
        .numOutputChannels = 2,
        .numFrames = left.size(),
    };

    engine.ProcessBlock(block, timestamp++);
    const auto& counters = engine.Application().DebugCounters();
    REQUIRE_TRUE(counters.hostFramesProcessed == left.size());
    REQUIRE_TRUE(counters.internalSubframesProcessed == left.size() * 4);
    REQUIRE_TRUE(counters.firstInternalSampleIndex == 0);
    REQUIRE_TRUE(counters.lastInternalSampleIndex == 31);
}

TEST_CASE(matrix_feedback_uses_current_vco_outputs_and_delays_only_modulator_consumption_one_internal_sample) {
    std::uint64_t timestamp = 0;
    synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
    engine.Initialize();
    auto& core = engine.Application();
    synth::ParameterManager& manager = *core.Context()->parameterManager;
    synth::Parameter& shape = manager.ParameterById(core.BraidModule().Parameters().quad.shape);
    shape.SceneCenter(0) = 0.0f;
    shape.SceneCenter(1) = 0.0f;
    synth::Parameter* shapeMatrixDepth = shape.EnsureModulationDepth(0);
    REQUIRE_TRUE(shapeMatrixDepth != nullptr);
    shapeMatrixDepth->SceneCenter(0) = 1.0f;
    shapeMatrixDepth->SceneCenter(1) = 1.0f;

    engine.Prepare(48000.0, 8);

    std::array<float, 2> left{};
    std::array<float, 2> right{};
    std::array<float*, 2> outputs{left.data(), right.data()};
    synth::AudioBlock block{
        .outputs = outputs.data(),
        .numOutputChannels = 2,
        .numFrames = left.size(),
    };

    engine.ProcessBlock(block, timestamp++);
    const auto& counters = core.DebugCounters();

    REQUIRE_TRUE(counters.lastInternalSampleIndex == 7);
    REQUIRE_TRUE(counters.lastMatrixInputInternalIndex == counters.lastInternalSampleIndex);
    REQUIRE_TRUE(counters.lastMatrixOutputPublicationInternalIndex == counters.lastInternalSampleIndex);
    REQUIRE_TRUE(counters.lastMatrixModulatorConsumptionInternalIndex == counters.lastInternalSampleIndex);
    REQUIRE_TRUE(counters.lastConsumedMatrixOutputPublicationInternalIndex == counters.lastInternalSampleIndex - 1);
    for (std::size_t oscIx = 0; oscIx < synth_braid4::Braid4Core::kOscillatorCount; ++oscIx) {
        REQUIRE_NEAR(counters.lastMatrixInputs[oscIx], core.BraidModule().OscillatorOutput(oscIx), 0.000001);
        REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(oscIx, 0),
                     counters.lastConsumedMatrixSources[oscIx],
                     0.000001);
        REQUIRE_NEAR(shape.CachedKnobValue(oscIx), shape.GetRaw(oscIx), 0.000001);
        REQUIRE_NEAR(core.BraidModule().CurrentInput().oscillators[oscIx].shape,
                     shape.CachedKnobValue(oscIx),
                     0.000001);
    }
}

TEST_CASE(output_policy_handles_zero_mono_stereo_and_extra_channels) {
    const auto zero = RunFreshEngineSegments(0, {8});
    REQUIRE_TRUE(zero.channels.empty());
    REQUIRE_TRUE(zero.counters.hostFramesProcessed == 8);

    const auto stereo = RunFreshEngineSegments(2, {8});
    const auto mono = RunFreshEngineSegments(1, {8});
    REQUIRE_TRUE(stereo.channels.size() == 2);
    REQUIRE_TRUE(mono.channels.size() == 1);
    for (std::size_t frame = 0; frame < mono.channels[0].size(); ++frame) {
        REQUIRE_NEAR(mono.channels[0][frame], 0.5f * (stereo.channels[0][frame] + stereo.channels[1][frame]), 0.000001);
    }

    const auto extra = RunFreshEngineSegments(3, {8});
    REQUIRE_TRUE(extra.channels.size() == 3);
    for (std::size_t frame = 0; frame < extra.channels[0].size(); ++frame) {
        REQUIRE_NEAR(extra.channels[0][frame], stereo.channels[0][frame], 0.000001);
        REQUIRE_NEAR(extra.channels[1][frame], stereo.channels[1][frame], 0.000001);
        REQUIRE_NEAR(extra.channels[2][frame], 0.0f, 0.000001);
    }
}

TEST_CASE(decimator_state_is_continuous_across_split_app_blocks) {
    const auto contiguous = RunFreshEngineSegments(2, {16});
    const auto split = RunFreshEngineSegments(2, {5, 7, 4});

    REQUIRE_TRUE(contiguous.channels.size() == 2);
    REQUIRE_TRUE(split.channels.size() == 2);
    REQUIRE_TRUE(contiguous.channels[0].size() == split.channels[0].size());
    for (std::size_t channel = 0; channel < contiguous.channels.size(); ++channel) {
        for (std::size_t frame = 0; frame < contiguous.channels[channel].size(); ++frame) {
            REQUIRE_NEAR(split.channels[channel][frame], contiguous.channels[channel][frame], 0.000001);
        }
    }
}

TEST_CASE(patch_save_perturb_load_round_trips_representative_braid_and_matrix_values) {
    const synth::RuntimeDataPaths paths =
        UseScratchRuntimeDataPaths("patch_save_perturb_load_round_trips_representative_braid_and_matrix_values");
    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(128, paths);
    auto& manager = rig.Engine().Manager();
    const auto braidIds = rig.Application().BraidModule().Parameters();
    const auto matrixIds = rig.Application().MatrixModule().Parameters();

    SetScenePair(manager, braidIds.x, 0.20f);
    SetScenePair(manager, braidIds.y, 0.80f);
    SetScenePair(manager, braidIds.quad.phase, -0.30f);
    SetScenePair(manager, braidIds.pmIndex[2], 0.70f);
    SetScenePair(manager, braidIds.frequency[3], 0.40f);
    SetScenePair(manager, matrixIds[0], 0.55f);
    SetScenePair(manager, matrixIds[7], -0.45f);

    const std::array<std::pair<synth::ParameterId, float>, 7> saved{{
        {braidIds.x, Scene0(manager, braidIds.x)},
        {braidIds.y, Scene0(manager, braidIds.y)},
        {braidIds.quad.phase, Scene0(manager, braidIds.quad.phase)},
        {braidIds.pmIndex[2], Scene0(manager, braidIds.pmIndex[2])},
        {braidIds.frequency[3], Scene0(manager, braidIds.frequency[3])},
        {matrixIds[0], Scene0(manager, matrixIds[0])},
        {matrixIds[7], Scene0(manager, matrixIds[7])},
    }};

    const std::filesystem::path patchDir = paths.patchesRoot / "Take1";
    REQUIRE_TRUE(rig.SavePatchAs(patchDir) == synth_rig::RigPatchStatus::Written);

    SetScenePair(manager, braidIds.x, 0.90f);
    SetScenePair(manager, braidIds.y, 0.10f);
    SetScenePair(manager, braidIds.quad.phase, 0.30f);
    SetScenePair(manager, braidIds.pmIndex[2], 0.10f);
    SetScenePair(manager, braidIds.frequency[3], 0.90f);
    SetScenePair(manager, matrixIds[0], -0.20f);
    SetScenePair(manager, matrixIds[7], 0.35f);

    REQUIRE_TRUE(std::fabs(Scene0(manager, braidIds.x) - saved[0].second) > 0.001f);
    REQUIRE_TRUE(std::fabs(Scene0(manager, matrixIds[7]) - saved[6].second) > 0.001f);

    REQUIRE_TRUE(rig.LoadPatch(patchDir) == synth_rig::RigPatchStatus::Ok);
    rig.RunBlocks(4);

    for (const auto& [id, expected] : saved) {
        REQUIRE_NEAR(Scene0(manager, id), expected, 0.000001);
    }
}

TEST_CASE(runs_finite_non_silent_stereo_audio_after_decimation) {
    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(
        64,
        UseScratchRuntimeDataPaths("runs_finite_non_silent_stereo_audio_after_decimation"));

    rig.RunBlocks(4);
    REQUIRE_TRUE(OutputHasNonSilentFiniteStereo(rig.Output()));
}

int main() {
    int failures = 0;
    for (const auto& test : Registry()) {
        try {
            test.fn();
            std::cout << "[PASS] " << test.name << "\n";
        } catch (const std::exception& e) {
            ++failures;
            std::cerr << "[FAIL] " << test.name << ": " << e.what() << "\n";
        } catch (...) {
            ++failures;
            std::cerr << "[FAIL] " << test.name << ": unknown exception\n";
        }
    }

    if (failures != 0) {
        std::cerr << failures << " Braid 4 system test(s) failed\n";
        return 1;
    }

    std::cout << "Braid 4 system tests passed\n";
    return 0;
}
