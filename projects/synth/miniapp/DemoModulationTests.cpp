#include "DemoModulation.hpp"
#include "synth/ParameterModulation.hpp"

#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

void RequireNear(float actual, float expected, float tolerance, const char* label) {
    if (std::fabs(actual - expected) > tolerance) {
        throw std::runtime_error(std::string(label) + " expected " + std::to_string(expected) + " got " +
                                 std::to_string(actual));
    }
}

void RequireTrue(bool value, const char* label) {
    if (!value) {
        throw std::runtime_error(std::string(label) + " expected true");
    }
}

} // namespace

int main() {
    constexpr float pi = 3.14159265358979323846f;
    constexpr float tolerance = 0.0001f;

    RequireNear(synth_miniapp::UnipolarSineModulator(0.0f), 0.5f, tolerance, "zero phase");
    RequireNear(synth_miniapp::UnipolarSineModulator(pi * 0.5f), 1.0f, tolerance, "positive peak");
    RequireNear(synth_miniapp::UnipolarSineModulator(pi), 0.5f, tolerance, "half cycle");
    RequireNear(synth_miniapp::UnipolarSineModulator(pi * 1.5f), 0.0f, tolerance, "negative peak");
    RequireNear(synth_miniapp::UnipolarSineModulator(0.0f, pi * 0.5f), 1.0f, tolerance, "90 degree voice offset");
    RequireNear(synth_miniapp::LfoPhaseStep(0.0f), 0.01f, tolerance, "slow LFO speed");
    RequireNear(synth_miniapp::LfoPhaseStep(1.0f), 0.17f, tolerance, "fast LFO speed");
    RequireNear(synth_miniapp::BipolarAudioToModulator(-2.0f), 0.0f, tolerance, "bipolar clamps low");
    RequireNear(synth_miniapp::BipolarAudioToModulator(-1.0f), 0.0f, tolerance, "bipolar maps negative one");
    RequireNear(synth_miniapp::BipolarAudioToModulator(0.0f), 0.5f, tolerance, "bipolar maps zero");
    RequireNear(synth_miniapp::BipolarAudioToModulator(1.0f), 1.0f, tolerance, "bipolar maps one");
    RequireNear(synth_miniapp::BipolarAudioToModulator(2.0f), 1.0f, tolerance, "bipolar clamps high");
    RequireNear(synth_miniapp::ThreePhaseVoiceOffset(0), 0.0f, tolerance, "three phase voice 0");
    RequireNear(synth_miniapp::ThreePhaseVoiceOffset(1), 2.0f * pi / 3.0f, tolerance, "three phase voice 1");
    RequireNear(synth_miniapp::ThreePhaseVoiceOffset(2), 4.0f * pi / 3.0f, tolerance, "three phase voice 2");
    RequireNear(synth_miniapp::ThreePhaseVoiceOffset(3), 0.0f, tolerance, "three phase wraps");

    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 3,
        .numScenes = 1,
        .maxParameters = 4,
        .processLiteAlpha = 1.0f,
    });
    auto& phase = manager.CreateParameter(group, {.name = "Phase", .defaultValue = 0.0f});
    auto& directDepth = manager.CreateParameter(group, {
        .name = "Phase Direct Depth",
        .defaultValue = 1.0f,
    });
    RequireTrue(phase.AssignModulationDepth(0, &directDepth), "assign direct depth");
    phase.Compute(manager.Scene());
    directDepth.Compute(manager.Scene());

    std::vector<synth::Parameter*> parameters{&phase, &directDepth};
    synth_miniapp::PublishVcoModulators(group.GetModulators(), -1.0f, 1.0f);
    synth_miniapp::ProcessLiteParameters(parameters);
    RequireNear(phase.Get(0), 0.0f, tolerance, "sample 0 direct VCO phase voice 0");
    RequireNear(phase.Get(1), 1.0f, tolerance, "sample 0 direct VCO phase voice 1");

    synth_miniapp::PublishVcoModulators(group.GetModulators(), 1.0f, -1.0f);
    synth_miniapp::ProcessLiteParameters(parameters);
    RequireNear(phase.Get(0), 1.0f, tolerance, "sample 1 direct VCO phase voice 0");
    RequireNear(phase.Get(1), 0.0f, tolerance, "sample 1 direct VCO phase voice 1");

    std::cout << "Demo modulation tests passed\n";
    return 0;
}
