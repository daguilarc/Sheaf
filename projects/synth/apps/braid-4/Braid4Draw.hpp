#pragma once

// JUCE-free draw helpers for the Braid 4 portable surface.

#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"

#include <algorithm>
#include <cstddef>
#include <span>
#include <vector>

namespace synth_braid4 {

namespace Braid4Palette {

inline constexpr synth::Color kVoid = synth::Color::Rgb(3, 4, 7);
inline constexpr synth::Color kRedDim = synth::Color::Rgb(92, 18, 24);

}  // namespace Braid4Palette
struct Braid4ScopeDrawState
{
    static constexpr float x_MinY = -1.1f;
    static constexpr float x_MaxY = 1.1f;
    static constexpr std::size_t x_NumSamples = 256;

    std::vector<synth::ui::WaveformLayerDrawState> layers;
};

inline std::vector<synth::ui::DrawCommand> BuildBraid4ScopeCommands(const Braid4ScopeDrawState& state,
                                                                      synth::ui::Bounds bounds)
{
    return synth::ui::BuildScopeWaveformCommands(
        std::span<const synth::ui::WaveformLayerDrawState>(state.layers.data(), state.layers.size()),
        bounds,
        Braid4ScopeDrawState::x_MinY,
        Braid4ScopeDrawState::x_MaxY,
        Braid4ScopeDrawState::x_NumSamples,
        true);
}

inline std::vector<synth::ui::DrawCommand> BuildBraid4BackgroundCommands(synth::ui::Bounds bounds)
{
    using synth::ui::DrawCommand;
    std::vector<DrawCommand> commands;
    commands.push_back(DrawCommand::Fill(bounds, Braid4Palette::kVoid));
    commands.push_back(DrawCommand::StrokeRect(
        {bounds.x + 1.0f, bounds.y + 1.0f, std::max(0.0f, bounds.width - 2.0f), std::max(0.0f, bounds.height - 2.0f)},
        Braid4Palette::kRedDim,
        1.0f));
    return commands;
}

}  // namespace synth_braid4
