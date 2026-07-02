#include "MiniAppCore.hpp"
#include "support/SynthRig.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth miniapp system tests must not see JUCE headers -- MiniAppCore must stay JUCE-free"
#endif

#include <cmath>
#include <cstdint>
#include <exception>
#include <filesystem>
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

// Volume is the fourth parameter DualWavetableVcoModule::RegisterParameters
// registers (Tune, Phase, Shape, Volume, in that order -- see
// src/Modules.cpp), and RegisterToBank(vcoBank, /*offset=*/0) maps them onto
// bank positions offset+0..offset+3 in the same order, so Volume lands on
// bank position 3.
constexpr std::size_t kSlotIx = 0;
constexpr std::size_t kTunePosition = 0;
constexpr std::size_t kPhasePosition = 1;
constexpr std::size_t kShapePosition = 2;
constexpr std::size_t kVolumePosition = 3;

// Points MiniAppCore::testPatchesRoot (the static test hook mirroring
// EngineTestApp::testPatchesRoot in tests/engine_tests.cpp) at a fresh, empty
// scratch directory unique to the calling test, and returns it. Every test
// below must call this -- leaving testPatchesRoot cleared would fall back to
// MiniAppCore::DefaultPatchesRoot(), the same deterministic
// /tmp/sheaf-synth-miniapp-patches root a real interactive host run (e.g.
// apps/miniapp's JUCE build) writes patches into; Engine::Initialize()
// auto-loads the latest patch found there, so a shared real host session's
// saved modulation/parameter state would silently leak into these tests
// (observed in practice: a stale saved patch there gave Shape/Phase
// non-default modulation depths, breaking assumptions about their starting
// values). Scoping every test to its own subdirectory keyed by test name
// keeps runs isolated from both the real host and each other.
std::filesystem::path UseScratchPatchesRoot(const char* testName) {
    const std::filesystem::path root =
        std::filesystem::temp_directory_path() / "sheaf-synth-miniapp-system-tests" / testName;
    std::filesystem::remove_all(root);
    std::filesystem::create_directories(root);
    synth_miniapp::MiniAppCore::testPatchesRoot = root;
    return root;
}

// Snapshot of a settled output window, used to prove a Turn actually changes
// the AUDIBLE output (not just a tracked parameter value). Captured via
// rig.ClearOutput() + rig.RunBlocks(count) + rig.Output(), copying every
// frame/channel sample out before the rig's capture ring can evict them.
using OutputWindow = std::vector<synth_rig::SynthRig<synth_miniapp::MiniAppCore>::OutputFrame>;

OutputWindow CaptureSettledOutputWindow(synth_rig::SynthRig<synth_miniapp::MiniAppCore>& rig, std::size_t numBlocks) {
    rig.ClearOutput();
    rig.RunBlocks(numBlocks);
    return rig.Output();
}

// True if any frame/channel sample differs by more than tolerance between the
// two windows (same shape assumed -- both captured from the same rig/config).
// Used to assert a Turn produces a materially different output signal, not
// just a changed parameter value that never reaches the audio path.
bool OutputWindowsDifferMaterially(const OutputWindow& before, const OutputWindow& after, float tolerance) {
    const std::size_t frameCount = std::min(before.size(), after.size());
    for (std::size_t frame = 0; frame < frameCount; ++frame) {
        const auto& beforeChannels = before[frame].channels;
        const auto& afterChannels = after[frame].channels;
        const std::size_t channelCount = std::min(beforeChannels.size(), afterChannels.size());
        for (std::size_t ch = 0; ch < channelCount; ++ch) {
            if (std::fabs(afterChannels[ch] - beforeChannels[ch]) > tolerance) {
                return true;
            }
        }
    }
    return false;
}

bool AllSamplesFinite(const OutputWindow& window) {
    for (const auto& frame : window) {
        for (const float sample : frame.channels) {
            if (!std::isfinite(sample)) {
                return false;
            }
        }
    }
    return true;
}

}  // namespace

TEST_CASE(miniapp_rig_initializes_headlessly_and_runs) {
    UseScratchPatchesRoot("initializes_headlessly_and_runs");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig;
    rig.RunBlocks(1);
    REQUIRE_TRUE(!rig.SawNaN());
}

TEST_CASE(miniapp_rig_run_seconds_produces_finite_output) {
    UseScratchPatchesRoot("run_seconds_produces_finite_output");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig;
    rig.RunSeconds(0.1);
    REQUIRE_TRUE(!rig.SawNaN());
    REQUIRE_TRUE(!rig.Output().empty());
}

TEST_CASE(miniapp_rig_raising_volume_yields_nonzero_output_peak) {
    UseScratchPatchesRoot("raising_volume_yields_nonzero_output_peak");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig;

    // Volume defaults to 1.0 (see Modules.cpp), so peak should already be
    // nonzero after a short run; still exercise Turn on the production bus
    // to prove the volume encoder position actually reaches the parameter.
    rig.Turn(kSlotIx, kVolumePosition, 0.3f);
    rig.RunSeconds(0.1);

    REQUIRE_TRUE(!rig.SawNaN());
    REQUIRE_TRUE(rig.OutputPeak() > 0.0f);
}

TEST_CASE(miniapp_rig_zero_volume_yields_silence_and_turning_up_restores_signal) {
    UseScratchPatchesRoot("zero_volume_yields_silence_and_turning_up_restores_signal");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig;

    // Drive Volume down to (near) zero via repeated turns on its bank
    // position, then confirm the output peak collapses -- proving the
    // production Turn(slot, position) path for kVolumePosition actually
    // reaches DualWavetableVcoModule's Volume parameter and audibly changes
    // the mixed output, not just that output happens to be nonzero already.
    for (int i = 0; i < 40; ++i) {
        rig.Turn(kSlotIx, kVolumePosition, -0.1f);
    }
    rig.RunBlocks(8);
    rig.ClearOutput();
    rig.RunSeconds(0.05);
    const float quietPeak = rig.OutputPeak();
    REQUIRE_TRUE(quietPeak < 0.02f);

    for (int i = 0; i < 40; ++i) {
        rig.Turn(kSlotIx, kVolumePosition, 0.1f);
    }
    rig.RunBlocks(8);
    rig.RunSeconds(0.1);

    REQUIRE_TRUE(rig.OutputPeak() > quietPeak + 0.05f);
    REQUIRE_TRUE(!rig.SawNaN());
}

TEST_CASE(miniapp_rig_tune_turn_changes_output) {
    UseScratchPatchesRoot("tune_turn_changes_output");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig;
    rig.RunBlocks(4);

    const synth::ParameterId tuneId = rig.Application().VcoParameterIds().tune;
    const float before = rig.ParameterValue(tuneId);

    // Capture a settled output window BEFORE the Turn, so the after-window
    // comparison isolates the Turn's effect rather than startup transients.
    const OutputWindow windowBefore = CaptureSettledOutputWindow(rig, 8);

    rig.Turn(kSlotIx, kTunePosition, 0.3f);
    rig.RunBlocks(16);  // let the parameter slew settle before capturing

    const OutputWindow windowAfter = CaptureSettledOutputWindow(rig, 8);

    // Primary assertion (the brief's actual requirement): Tune's Turn must
    // audibly change the OUTPUT signal, not just the tracked parameter.
    REQUIRE_TRUE(AllSamplesFinite(windowBefore));
    REQUIRE_TRUE(AllSamplesFinite(windowAfter));
    REQUIRE_TRUE(OutputWindowsDifferMaterially(windowBefore, windowAfter, 1e-4f));

    // Secondary (parameter-value) checks, kept for regression coverage of
    // the production Turn(slot, position) -> parameter routing path.
    const float after = rig.ParameterValue(tuneId);
    REQUIRE_TRUE(after != before);
    REQUIRE_NEAR(after, before + 0.3f, 1e-3f);
    REQUIRE_TRUE(!rig.SawNaN());
}

TEST_CASE(miniapp_rig_shape_turn_changes_output) {
    UseScratchPatchesRoot("shape_turn_changes_output");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig;
    rig.RunBlocks(4);

    const synth::ParameterId shapeId = rig.Application().VcoParameterIds().shape;
    const float before = rig.ParameterValue(shapeId);

    // Capture a settled output window BEFORE the Turn, so the after-window
    // comparison isolates the Turn's effect rather than startup transients.
    const OutputWindow windowBefore = CaptureSettledOutputWindow(rig, 8);

    rig.Turn(kSlotIx, kShapePosition, 0.4f);
    rig.RunBlocks(16);  // let the parameter slew settle before capturing

    const OutputWindow windowAfter = CaptureSettledOutputWindow(rig, 8);

    // Primary assertion (the brief's actual requirement): Shape's Turn must
    // audibly change the OUTPUT signal (waveshape), not just the tracked
    // parameter.
    REQUIRE_TRUE(AllSamplesFinite(windowBefore));
    REQUIRE_TRUE(AllSamplesFinite(windowAfter));
    REQUIRE_TRUE(OutputWindowsDifferMaterially(windowBefore, windowAfter, 1e-4f));

    // Secondary (parameter-value) checks, kept for regression coverage of
    // the production Turn(slot, position) -> parameter routing path.
    const float after = rig.ParameterValue(shapeId);
    REQUIRE_TRUE(after != before);
    REQUIRE_NEAR(after, before + 0.4f, 1e-3f);
    REQUIRE_TRUE(!rig.SawNaN());
}

TEST_CASE(miniapp_rig_patch_save_perturb_load_round_trip) {
    const std::filesystem::path root = UseScratchPatchesRoot("patch_save_perturb_load_round_trip");

    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig;
    rig.RunBlocks(4);

    const synth::ParameterId tuneId = rig.Application().VcoParameterIds().tune;
    const synth::ParameterId shapeId = rig.Application().VcoParameterIds().shape;

    rig.Turn(kSlotIx, kTunePosition, 0.25f);
    rig.Turn(kSlotIx, kShapePosition, -0.15f);
    rig.RunBlocks(16);

    const float savedTune = rig.ParameterValue(tuneId);
    const float savedShape = rig.ParameterValue(shapeId);

    const std::filesystem::path patchDir = root / "Take1";
    REQUIRE_TRUE(rig.SavePatchAs(patchDir) == synth_rig::RigPatchStatus::Written);

    // Perturb: move both parameters away from the saved values.
    rig.Turn(kSlotIx, kTunePosition, -0.4f);
    rig.Turn(kSlotIx, kShapePosition, 0.4f);
    rig.RunBlocks(16);

    REQUIRE_TRUE(std::fabs(rig.ParameterValue(tuneId) - savedTune) > 1e-3f);
    REQUIRE_TRUE(std::fabs(rig.ParameterValue(shapeId) - savedShape) > 1e-3f);

    REQUIRE_TRUE(rig.LoadPatch(patchDir) == synth_rig::RigPatchStatus::Ok);
    rig.RunBlocks(16);

    REQUIRE_NEAR(rig.ParameterValue(tuneId), savedTune, 1e-3f);
    REQUIRE_NEAR(rig.ParameterValue(shapeId), savedShape, 1e-3f);
    REQUIRE_TRUE(!rig.SawNaN());

    std::filesystem::remove_all(root);
}

TEST_CASE(miniapp_rig_no_nan_across_extended_run) {
    UseScratchPatchesRoot("no_nan_across_extended_run");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig;

    rig.Turn(kSlotIx, kTunePosition, 0.2f);
    rig.Turn(kSlotIx, kShapePosition, 0.3f);
    rig.Turn(kSlotIx, kPhasePosition, 0.5f);
    rig.Turn(kSlotIx, kVolumePosition, -0.2f);
    rig.RunSeconds(0.5);

    REQUIRE_TRUE(!rig.SawNaN());
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
