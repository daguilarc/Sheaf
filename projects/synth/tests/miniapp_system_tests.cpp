#include "MiniAppCore.hpp"
#include "support/SynthRig.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth miniapp system tests must not see JUCE headers -- MiniAppCore must stay JUCE-free"
#endif

#include <algorithm>
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

// Volume is the fourth parameter WavetableVcoModule<2>::RegisterParameters
// registers (Tune, Phase, Shape, Volume, in that order -- see
// synth/Modules.hpp), and RegisterToBank(vcoBank, /*offset=*/0) maps them onto
// bank positions offset+0..offset+3 in the same order, so Volume lands on
// bank position 3.
constexpr std::size_t kSlotIx = 0;
constexpr std::size_t kLfoBankIx = 1;
constexpr std::size_t kTunePosition = 0;
constexpr std::size_t kPhasePosition = 1;
constexpr std::size_t kShapePosition = 2;
constexpr std::size_t kVolumePosition = 3;
constexpr std::size_t kFilterCutoffPosition = 4;
constexpr std::size_t kFilterResonancePosition = 5;
constexpr std::size_t kFilterBlendPosition = 6;
constexpr std::size_t kLfoFrequencyPosition = 0;
constexpr std::size_t kLfoShapePosition = 1;
constexpr std::size_t kLfoPhaseOffsetPosition = 2;
constexpr std::size_t kLfoSkewPosition = 3;
constexpr std::size_t kLfoExponentPosition = 4;

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

// Assert that two windows have exactly equal shape: same frame count and equal
// per-frame channel counts. Used to guard value comparisons and fail clearly
// on shape mismatches.
void RequireEqualWindowShapes(const OutputWindow& a, const OutputWindow& b, const char* context) {
    if (a.size() != b.size()) {
        std::ostringstream oss;
        oss << context << " frame count mismatch: " << a.size() << " vs " << b.size();
        throw std::runtime_error(oss.str());
    }
    for (std::size_t i = 0; i < a.size(); ++i) {
        if (a[i].channels.size() != b[i].channels.size()) {
            std::ostringstream oss;
            oss << context << " frame " << i << " channel count mismatch: "
                << a[i].channels.size() << " vs " << b[i].channels.size();
            throw std::runtime_error(oss.str());
        }
    }
}

// True if any frame/channel sample differs by more than tolerance between the
// two windows. Requires equal shapes first (fails clearly on shape mismatch).
// Used to assert a Turn produces a materially different output signal, not
// just a changed parameter value that never reaches the audio path.
bool OutputWindowsDifferMaterially(const OutputWindow& before, const OutputWindow& after, float tolerance) {
    RequireEqualWindowShapes(before, after, "OutputWindowsDifferMaterially");
    for (std::size_t frame = 0; frame < before.size(); ++frame) {
        const auto& beforeChannels = before[frame].channels;
        const auto& afterChannels = after[frame].channels;
        for (std::size_t ch = 0; ch < beforeChannels.size(); ++ch) {
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

bool ValuesDifferMaterially(const std::vector<float>& values, float tolerance) {
    if (values.empty()) {
        return false;
    }
    const float first = values.front();
    for (const float value : values) {
        if (std::fabs(value - first) > tolerance) {
            return true;
        }
    }
    return false;
}

float OutputWindowPeak(const OutputWindow& window) {
    float peak = 0.0f;
    for (const auto& frame : window) {
        for (const float sample : frame.channels) {
            peak = std::max(peak, std::fabs(sample));
        }
    }
    return peak;
}

void RequireBankPosition(synth::BankSlot& slot, const synth::Bank& bank, std::size_t position,
                         synth::ParameterId expectedId, const char* expectedName) {
    synth::PhysicalEncoderId encoderId = 0;
    REQUIRE_TRUE(slot.ResolvePosition(position, encoderId));
    const synth::Parameter* parameter = bank.VisibleParameter(encoderId);
    REQUIRE_TRUE(parameter != nullptr);
    REQUIRE_TRUE(parameter->Id() == expectedId);
    REQUIRE_TRUE(parameter->Name() == expectedName);
}

void RequirePagePosition(const synth::Page& page, std::size_t position,
                         synth::ParameterId expectedId, const char* expectedName) {
    REQUIRE_TRUE(position < page.parameters.size());
    const synth::Parameter* parameter = page.parameters[position];
    REQUIRE_TRUE(parameter != nullptr);
    REQUIRE_TRUE(parameter->Id() == expectedId);
    REQUIRE_TRUE(parameter->Name() == expectedName);
}

void RequireUnboundBankPosition(synth::BankSlot& slot, const synth::Bank& bank, std::size_t position) {
    synth::PhysicalEncoderId encoderId = 0;
    REQUIRE_TRUE(slot.ResolvePosition(position, encoderId));
    REQUIRE_TRUE(bank.VisibleParameter(encoderId) == nullptr);
}

}  // namespace

TEST_CASE(miniapp_rig_initializes_headlessly_and_runs) {
    UseScratchPatchesRoot("initializes_headlessly_and_runs");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig;
    const float expectedDefaultAlpha = 0.1226942309f;  // one-pole 1 kHz cutoff at 48 kHz
    REQUIRE_NEAR(rig.Application().Group()->Config().processLiteAlpha, expectedDefaultAlpha, 0.000001f);
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

TEST_CASE(miniapp_rig_lfo_bank_exposes_five_module_parameters) {
    UseScratchPatchesRoot("lfo_bank_exposes_five_module_parameters");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig;
    rig.RunBlocks(1);

    REQUIRE_TRUE(rig.Application().Parameters().size() == 12);
    const auto lfoIds = rig.Application().LfoParameterIds();
    const float beforeFrequency = rig.ParameterValue(lfoIds.frequency);
    const float beforeShape = rig.ParameterValue(lfoIds.shape);
    const float beforePhaseOffset = rig.ParameterValue(lfoIds.phaseOffset);
    const float beforeSkew = rig.ParameterValue(lfoIds.skew);
    const float beforeExponent = rig.ParameterValue(lfoIds.exponent);

    rig.SelectBank(kSlotIx, kLfoBankIx);
    rig.RunBlocks(1);

    const synth::Page* activePage = rig.Application().Context()->parameterManager->ActivePage();
    REQUIRE_TRUE(activePage != nullptr);
    REQUIRE_TRUE(activePage->name == "LFO");
    REQUIRE_TRUE(activePage->parameters.size() == 5);
    RequirePagePosition(*activePage, kLfoFrequencyPosition, lfoIds.frequency, "LFO Frequency");
    RequirePagePosition(*activePage, kLfoShapePosition, lfoIds.shape, "LFO Shape");
    RequirePagePosition(*activePage, kLfoPhaseOffsetPosition, lfoIds.phaseOffset, "LFO Phase Offset");
    RequirePagePosition(*activePage, kLfoSkewPosition, lfoIds.skew, "LFO Skew");
    RequirePagePosition(*activePage, kLfoExponentPosition, lfoIds.exponent, "LFO Exponent");

    RequireBankPosition(*rig.Application().Slot(), *rig.Application().LfoBank(), kLfoFrequencyPosition,
                        lfoIds.frequency, "LFO Frequency");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().LfoBank(), kLfoShapePosition,
                        lfoIds.shape, "LFO Shape");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().LfoBank(), kLfoPhaseOffsetPosition,
                        lfoIds.phaseOffset, "LFO Phase Offset");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().LfoBank(), kLfoSkewPosition,
                        lfoIds.skew, "LFO Skew");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().LfoBank(), kLfoExponentPosition,
                        lfoIds.exponent, "LFO Exponent");
    RequireUnboundBankPosition(*rig.Application().Slot(), *rig.Application().LfoBank(), kFilterResonancePosition);
    RequireUnboundBankPosition(*rig.Application().Slot(), *rig.Application().LfoBank(), kFilterBlendPosition);

    rig.Turn(kSlotIx, kLfoFrequencyPosition, 0.10f);
    rig.Turn(kSlotIx, kLfoShapePosition, -0.10f);
    rig.Turn(kSlotIx, kLfoPhaseOffsetPosition, 0.20f);
    rig.Turn(kSlotIx, kLfoSkewPosition, -0.20f);
    rig.Turn(kSlotIx, kLfoExponentPosition, 0.15f);
    rig.RunBlocks(16);

    REQUIRE_NEAR(rig.ParameterValue(lfoIds.frequency), beforeFrequency + 0.10f, 1e-3f);
    REQUIRE_NEAR(rig.ParameterValue(lfoIds.shape), beforeShape - 0.10f, 1e-3f);
    REQUIRE_NEAR(rig.ParameterValue(lfoIds.phaseOffset), beforePhaseOffset + 0.20f, 1e-3f);
    REQUIRE_NEAR(rig.ParameterValue(lfoIds.skew), beforeSkew - 0.20f, 1e-3f);
    REQUIRE_NEAR(rig.ParameterValue(lfoIds.exponent), beforeExponent + 0.15f, 1e-3f);
    REQUIRE_TRUE(!rig.SawNaN());
}

TEST_CASE(miniapp_rig_vco_bank_exposes_vco_and_filter_parameters) {
    UseScratchPatchesRoot("vco_bank_exposes_vco_and_filter_parameters");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig;
    rig.RunBlocks(1);

    REQUIRE_TRUE(rig.Application().Parameters().size() == 12);
    const auto vcoIds = rig.Application().VcoParameterIds();
    const auto filterIds = rig.Application().FilterParameterIds();

    const synth::Page* activePage = rig.Application().Context()->parameterManager->ActivePage();
    REQUIRE_TRUE(activePage != nullptr);
    REQUIRE_TRUE(activePage->name == "VCO");
    REQUIRE_TRUE(activePage->parameters.size() == 7);
    RequirePagePosition(*activePage, kTunePosition, vcoIds.tune, "Tune");
    RequirePagePosition(*activePage, kPhasePosition, vcoIds.phase, "Phase");
    RequirePagePosition(*activePage, kShapePosition, vcoIds.shape, "Shape");
    RequirePagePosition(*activePage, kVolumePosition, vcoIds.volume, "Volume");
    RequirePagePosition(*activePage, kFilterCutoffPosition, filterIds.cutoff, "Filter Cutoff");
    RequirePagePosition(*activePage, kFilterResonancePosition, filterIds.resonance, "Filter Resonance");
    RequirePagePosition(*activePage, kFilterBlendPosition, filterIds.blend, "Filter Blend");

    RequireBankPosition(*rig.Application().Slot(), *rig.Application().VcoBank(), kTunePosition,
                        vcoIds.tune, "Tune");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().VcoBank(), kPhasePosition,
                        vcoIds.phase, "Phase");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().VcoBank(), kShapePosition,
                        vcoIds.shape, "Shape");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().VcoBank(), kVolumePosition,
                        vcoIds.volume, "Volume");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().VcoBank(), kFilterCutoffPosition,
                        filterIds.cutoff, "Filter Cutoff");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().VcoBank(), kFilterResonancePosition,
                        filterIds.resonance, "Filter Resonance");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().VcoBank(), kFilterBlendPosition,
                        filterIds.blend, "Filter Blend");
    REQUIRE_TRUE(!rig.SawNaN());
}

TEST_CASE(miniapp_rig_lfo_modulation_source_changes_from_module_processing) {
    UseScratchPatchesRoot("lfo_modulation_source_changes_from_module_processing");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig;
    std::vector<float> voice0Values;
    std::vector<float> voice1Values;

    for (int i = 0; i < 8; ++i) {
        rig.RunBlocks(8);
        voice0Values.push_back(rig.Application().Group()->GetModulators().Value(0, 2));
        voice1Values.push_back(rig.Application().Group()->GetModulators().Value(1, 2));
    }

    REQUIRE_TRUE(ValuesDifferMaterially(voice0Values, 1e-4f));
    REQUIRE_TRUE(ValuesDifferMaterially(voice1Values, 1e-4f));
    REQUIRE_TRUE(!rig.SawNaN());
}

TEST_CASE(miniapp_rig_zero_volume_yields_silence_and_turning_up_restores_signal) {
    UseScratchPatchesRoot("zero_volume_yields_silence_and_turning_up_restores_signal");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig;

    // Drive Volume down to (near) zero via repeated turns on its bank
    // position, then confirm the output peak collapses -- proving the
    // production Turn(slot, position) path for kVolumePosition actually
    // reaches WavetableVcoModule<2>'s Volume parameter and audibly changes
    // the mixed output, not just that output happens to be nonzero already.
    for (int i = 0; i < 40; ++i) {
        rig.Turn(kSlotIx, kVolumePosition, -0.1f);
    }
    rig.RunBlocks(8);
    const OutputWindow quietWindow = CaptureSettledOutputWindow(rig, 10);
    const float quietPeak = OutputWindowPeak(quietWindow);
    REQUIRE_TRUE(quietPeak < 0.02f);

    for (int i = 0; i < 40; ++i) {
        rig.Turn(kSlotIx, kVolumePosition, 0.1f);
    }
    rig.RunBlocks(8);
    rig.RunSeconds(0.1);

    REQUIRE_TRUE(rig.OutputPeak() > quietPeak + 0.05f);
    REQUIRE_TRUE(!rig.SawNaN());
}

// These "Turn changes output" tests must not compare two free-running output
// windows captured at different times against the SAME rig: the VCOs are
// free-running oscillators, so phase alone drifts the waveform from one
// window to the next even when a Turn has zero effect on the audio path.
// That would let a broken parameter->audio wire pass the test for the wrong
// reason.
//
// Instead this leans on the engine's proven determinism (see
// rig_two_identical_runs_are_deterministic in rig_tests.cpp): build TWO
// rigs, script them through an IDENTICAL sequence of blocks/turns for N
// blocks, then apply the Turn under test to ONLY rig B, run BOTH rigs for
// the SAME further M blocks, and compare their captured output over that
// same final-M-block range. With no turn applied, two identically-scripted
// rigs produce bit-identical output (determinism), so this test's baseline
// sanity check asserts the pre-turn windows from A and B match; any material
// post-turn difference between A and B is then attributable ONLY to the
// turn -- phase drift cannot explain it, because both rigs drift identically
// from the same identical history.
TEST_CASE(miniapp_rig_tune_turn_changes_output) {
    UseScratchPatchesRoot("tune_turn_changes_output");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rigA;
    UseScratchPatchesRoot("tune_turn_changes_output_b");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rigB;

    rigA.RunBlocks(4);
    rigB.RunBlocks(4);

    const synth::ParameterId tuneIdA = rigA.Application().VcoParameterIds().tune;
    const synth::ParameterId tuneIdB = rigB.Application().VcoParameterIds().tune;
    const float beforeA = rigA.ParameterValue(tuneIdA);
    const float beforeB = rigB.ParameterValue(tuneIdB);

    // Baseline sanity: with both rigs scripted identically so far and no
    // turn applied yet, their settled output windows must be bit-identical
    // (determinism). This proves the twin-rig setup itself is apples-to-
    // apples before the turn is introduced.
    const OutputWindow baselineA = CaptureSettledOutputWindow(rigA, 8);
    const OutputWindow baselineB = CaptureSettledOutputWindow(rigB, 8);
    REQUIRE_TRUE(AllSamplesFinite(baselineA));
    REQUIRE_TRUE(AllSamplesFinite(baselineB));
    // Rigs are deterministic, so baseline windows must be EXACTLY equal.
    RequireEqualWindowShapes(baselineA, baselineB, "miniapp_rig_tune_turn_changes_output baseline");
    REQUIRE_TRUE(baselineA.size() == baselineB.size());
    for (std::size_t i = 0; i < baselineA.size(); ++i) {
        REQUIRE_TRUE(baselineA[i].channels == baselineB[i].channels);  // bit-identical
    }

    // Apply the Turn under test to rig B only.
    rigB.Turn(kSlotIx, kTunePosition, 0.3f);

    rigA.RunBlocks(16);  // let the parameter slew settle before capturing
    rigB.RunBlocks(16);

    const OutputWindow afterA = CaptureSettledOutputWindow(rigA, 8);
    const OutputWindow afterB = CaptureSettledOutputWindow(rigB, 8);

    // Primary assertion (the brief's actual requirement): Tune's Turn must
    // audibly change the OUTPUT signal, not just the tracked parameter.
    // Because rigA and rigB were scripted identically up to this point,
    // determinism guarantees any material difference here comes from the
    // turn, not from oscillator phase drift.
    REQUIRE_TRUE(AllSamplesFinite(afterA));
    REQUIRE_TRUE(AllSamplesFinite(afterB));
    REQUIRE_TRUE(OutputWindowsDifferMaterially(afterA, afterB, 1e-4f));

    // Secondary (parameter-value) checks, kept for regression coverage of
    // the production Turn(slot, position) -> parameter routing path.
    const float afterValueA = rigA.ParameterValue(tuneIdA);
    const float afterValueB = rigB.ParameterValue(tuneIdB);
    REQUIRE_NEAR(afterValueA, beforeA, 1e-3f);
    REQUIRE_TRUE(afterValueB != beforeB);
    REQUIRE_NEAR(afterValueB, beforeB + 0.3f, 1e-3f);
    REQUIRE_TRUE(!rigA.SawNaN());
    REQUIRE_TRUE(!rigB.SawNaN());
}

TEST_CASE(miniapp_rig_shape_turn_changes_output) {
    UseScratchPatchesRoot("shape_turn_changes_output");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rigA;
    UseScratchPatchesRoot("shape_turn_changes_output_b");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rigB;

    rigA.RunBlocks(4);
    rigB.RunBlocks(4);

    const synth::ParameterId shapeIdA = rigA.Application().VcoParameterIds().shape;
    const synth::ParameterId shapeIdB = rigB.Application().VcoParameterIds().shape;
    const float beforeA = rigA.ParameterValue(shapeIdA);
    const float beforeB = rigB.ParameterValue(shapeIdB);

    // Baseline sanity: with both rigs scripted identically so far and no
    // turn applied yet, their settled output windows must be bit-identical
    // (determinism). This proves the twin-rig setup itself is apples-to-
    // apples before the turn is introduced.
    const OutputWindow baselineA = CaptureSettledOutputWindow(rigA, 8);
    const OutputWindow baselineB = CaptureSettledOutputWindow(rigB, 8);
    REQUIRE_TRUE(AllSamplesFinite(baselineA));
    REQUIRE_TRUE(AllSamplesFinite(baselineB));
    // Rigs are deterministic, so baseline windows must be EXACTLY equal.
    RequireEqualWindowShapes(baselineA, baselineB, "miniapp_rig_shape_turn_changes_output baseline");
    REQUIRE_TRUE(baselineA.size() == baselineB.size());
    for (std::size_t i = 0; i < baselineA.size(); ++i) {
        REQUIRE_TRUE(baselineA[i].channels == baselineB[i].channels);  // bit-identical
    }

    // Apply the Turn under test to rig B only.
    rigB.Turn(kSlotIx, kShapePosition, 0.4f);

    rigA.RunBlocks(16);  // let the parameter slew settle before capturing
    rigB.RunBlocks(16);

    const OutputWindow afterA = CaptureSettledOutputWindow(rigA, 8);
    const OutputWindow afterB = CaptureSettledOutputWindow(rigB, 8);

    // Primary assertion (the brief's actual requirement): Shape's Turn must
    // audibly change the OUTPUT signal (waveshape), not just the tracked
    // parameter. Because rigA and rigB were scripted identically up to this
    // point, determinism guarantees any material difference here comes from
    // the turn, not from oscillator phase drift.
    REQUIRE_TRUE(AllSamplesFinite(afterA));
    REQUIRE_TRUE(AllSamplesFinite(afterB));
    REQUIRE_TRUE(OutputWindowsDifferMaterially(afterA, afterB, 1e-4f));

    // Secondary (parameter-value) checks, kept for regression coverage of
    // the production Turn(slot, position) -> parameter routing path.
    const float afterValueA = rigA.ParameterValue(shapeIdA);
    const float afterValueB = rigB.ParameterValue(shapeIdB);
    REQUIRE_NEAR(afterValueA, beforeA, 1e-3f);
    REQUIRE_TRUE(afterValueB != beforeB);
    REQUIRE_NEAR(afterValueB, beforeB + 0.4f, 1e-3f);
    REQUIRE_TRUE(!rigA.SawNaN());
    REQUIRE_TRUE(!rigB.SawNaN());
}

TEST_CASE(miniapp_rig_filter_blend_turn_changes_output) {
    UseScratchPatchesRoot("filter_blend_turn_changes_output");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rigA;
    UseScratchPatchesRoot("filter_blend_turn_changes_output_b");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rigB;

    rigA.RunBlocks(4);
    rigB.RunBlocks(4);

    const synth::ParameterId blendIdA = rigA.Application().FilterParameterIds().blend;
    const synth::ParameterId blendIdB = rigB.Application().FilterParameterIds().blend;
    const float beforeA = rigA.ParameterValue(blendIdA);
    const float beforeB = rigB.ParameterValue(blendIdB);

    const OutputWindow baselineA = CaptureSettledOutputWindow(rigA, 8);
    const OutputWindow baselineB = CaptureSettledOutputWindow(rigB, 8);
    REQUIRE_TRUE(AllSamplesFinite(baselineA));
    REQUIRE_TRUE(AllSamplesFinite(baselineB));
    RequireEqualWindowShapes(baselineA, baselineB, "miniapp_rig_filter_blend_turn_changes_output baseline");
    for (std::size_t i = 0; i < baselineA.size(); ++i) {
        REQUIRE_TRUE(baselineA[i].channels == baselineB[i].channels);
    }

    rigB.Turn(kSlotIx, kFilterBlendPosition, 1.0f);

    rigA.RunBlocks(32);
    rigB.RunBlocks(32);

    const OutputWindow afterA = CaptureSettledOutputWindow(rigA, 8);
    const OutputWindow afterB = CaptureSettledOutputWindow(rigB, 8);

    REQUIRE_TRUE(AllSamplesFinite(afterA));
    REQUIRE_TRUE(AllSamplesFinite(afterB));
    REQUIRE_TRUE(OutputWindowsDifferMaterially(afterA, afterB, 1e-4f));

    const float afterValueA = rigA.ParameterValue(blendIdA);
    const float afterValueB = rigB.ParameterValue(blendIdB);
    REQUIRE_NEAR(afterValueA, beforeA, 1e-3f);
    REQUIRE_TRUE(afterValueB != beforeB);
    REQUIRE_TRUE(afterValueB > beforeB + 0.5f);
    REQUIRE_TRUE(!rigA.SawNaN());
    REQUIRE_TRUE(!rigB.SawNaN());
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

// spm-45: post-Init the default instrument (Engine::LiveInstrument(), which
// Engine::Initialize() snapshots into DefaultInstrument() right after
// MiniAppCore::Init() returns -- see MiniAppCore.hpp's comment on the
// controller-seeding block) must contain EXACTLY ONE controller slot, named
// "wrldbldr", kind WrldBldr, built from WrldBldrDefaultProfileConfig() with
// the same options MiniAppCore::Init() passes (visibleEncoderCount == the
// slot's 4 physical encoders, sceneCount 3, bankButtonCount 16,
// gestureSelectorCount 1). Spot-check the encoder input mapping rather than
// comparing the whole config: turns live on channel 0, pushes on channel 1,
// and CCs map onto positions 1:1 (EncoderPositionToCC(position) == position
// for position < 16 -- see MidiController.cpp); this instrument's
// KeepFirstPositions(4) trims the general 0..15 scheme down to positions
// 0..3, matching the slot's 4 physical encoders.
TEST_CASE(miniapp_rig_default_instrument_has_single_wrldbldr_controller) {
    UseScratchPatchesRoot("default_instrument_has_single_wrldbldr_controller");
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig;

    // Pin the post-Init DEFAULT instrument (revert/new-patch restore value).
    const synth::MidiInstrumentConfig& defaultInstrument = rig.Engine().DefaultInstrument();
    REQUIRE_TRUE(defaultInstrument.controllers.size() == 1);

    // Assert the live instrument equals the default at startup.
    const synth::MidiInstrumentConfig& liveInstrument = rig.Engine().LiveInstrument();
    REQUIRE_TRUE(liveInstrument.controllers.size() == defaultInstrument.controllers.size());

    const synth::MidiControllerSlot& slot = defaultInstrument.controllers.front();
    REQUIRE_TRUE(slot.name == "wrldbldr");
    REQUIRE_TRUE(slot.kind == synth::MidiProfileKind::WrldBldr);

    constexpr std::size_t kVisibleEncoderCount = 4;  // slot_->PhysicalEncoders() == {10, 11, 12, 13}
    synth::WrldBldrDefaultProfileOptions expectedOptions;
    expectedOptions.visibleEncoderCount = kVisibleEncoderCount;
    expectedOptions.sceneCount = 3;
    expectedOptions.bankButtonCount = 16;
    expectedOptions.gestureSelectorCount = 1;
    const synth::MidiControllerProfileConfig expectedConfig = synth::WrldBldrDefaultProfileConfig(expectedOptions);

    REQUIRE_TRUE(slot.config.encoderInput.has_value());
    REQUIRE_TRUE(expectedConfig.encoderInput.has_value());
    REQUIRE_TRUE(slot.config.encoderInput->turns.size() == expectedConfig.encoderInput->turns.size());
    REQUIRE_TRUE(slot.config.encoderInput->pushes.size() == expectedConfig.encoderInput->pushes.size());
    REQUIRE_TRUE(slot.config.encoderInput->turns.size() == kVisibleEncoderCount);

    // Assert system association count. WrldBldrDefaultProfileConfig produces:
    // 1 (shift) + sceneCount (3) + bankButtonCount (16) + gestureSelectorCount (1) = 21
    REQUIRE_TRUE(slot.config.systemMessages.size() == expectedConfig.systemMessages.size());
    REQUIRE_TRUE(slot.config.systemMessages.size() == 21);

    // Encoder-mapping spot-checks (brief Step 1): turn channel 0, push
    // channel 1, CCs 0..(visibleEncoderCount-1) -> positions
    // 0..(visibleEncoderCount-1).
    for (std::size_t position = 0; position < kVisibleEncoderCount; ++position) {
        const auto turnIt = std::find_if(
            slot.config.encoderInput->turns.begin(), slot.config.encoderInput->turns.end(),
            [position](const synth::EncoderMidiMapping& mapping) { return mapping.position == position; });
        REQUIRE_TRUE(turnIt != slot.config.encoderInput->turns.end());
        REQUIRE_TRUE(turnIt->control.channel == 0);
        REQUIRE_TRUE(turnIt->control.cc == static_cast<std::uint8_t>(position));

        const auto pushIt = std::find_if(
            slot.config.encoderInput->pushes.begin(), slot.config.encoderInput->pushes.end(),
            [position](const synth::EncoderMidiMapping& mapping) { return mapping.position == position; });
        REQUIRE_TRUE(pushIt != slot.config.encoderInput->pushes.end());
        REQUIRE_TRUE(pushIt->control.channel == 1);
        REQUIRE_TRUE(pushIt->control.cc == static_cast<std::uint8_t>(position));
    }
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
