#pragma once

// JUCE-free portable command builders for miniapp waveform widgets.

#include "synth/DspOscillators.hpp"
#include "synth/DspScope.hpp"
#include "synth/ParameterModulation.hpp"
#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"

#include <cstddef>
#include <vector>

namespace synth_miniapp {

struct VcoWaveformDrawState
{
    std::vector<synth::ui::WaveformLayerDrawState> layers;
    static constexpr float x_MinY = -1.1f;
    static constexpr float x_MaxY = 1.1f;
    static constexpr std::size_t x_NumSamples = 1024;
};

struct LfoWaveformDrawState
{
    std::vector<synth::ui::WaveformLayerDrawState> layers;
    static constexpr float x_MinY = 0.0f;
    static constexpr float x_MaxY = 1.0f;
    static constexpr std::size_t x_NumSamples = 1024;
};

inline std::vector<synth::ui::DrawCommand> BuildVcoWaveformCommands(const VcoWaveformDrawState& state,
                                                                    synth::ui::Bounds nodeBounds)
{
    return synth::ui::BuildScopeWaveformCommands(
        state.layers, nodeBounds, VcoWaveformDrawState::x_MinY, VcoWaveformDrawState::x_MaxY, state.x_NumSamples, true);
}

inline std::vector<synth::ui::DrawCommand> BuildLfoWaveformCommands(const LfoWaveformDrawState& state,
                                                                    synth::ui::Bounds nodeBounds)
{
    return synth::ui::BuildScopeWaveformCommands(
        state.layers, nodeBounds, LfoWaveformDrawState::x_MinY, LfoWaveformDrawState::x_MaxY, state.x_NumSamples, true);
}

}  // namespace synth_miniapp
