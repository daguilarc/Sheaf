#pragma once

// JUCE-free draw helpers for the Dresden 4 portable surface.

#include "synth/ParameterModulation.hpp"
#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <span>
#include <string>
#include <utility>
#include <vector>

namespace synth_dresden4 {

inline float Clamp(float value, float minValue, float maxValue)
{
    return std::max(minValue, std::min(maxValue, value));
}

inline synth::ui::Color ToDresdenUiColor(synth::Color color, float alphaScale = 1.0f)
{
    const float scaledAlpha = Clamp(static_cast<float>(color.a) * alphaScale, 0.0f, 255.0f);
    return synth::ui::Color::Rgba(color.r, color.g, color.b, static_cast<std::uint8_t>(scaledAlpha));
}

namespace Dresden4Palette {

inline constexpr synth::ui::Color kVoid = synth::ui::Color::Rgb(3, 4, 7);
inline constexpr synth::ui::Color kPanel = synth::ui::Color::Rgb(13, 9, 12);
inline constexpr synth::ui::Color kPanelDim = synth::ui::Color::Rgb(18, 14, 18);
inline constexpr synth::ui::Color kRed = synth::ui::Color::Rgb(215, 24, 34);
inline constexpr synth::ui::Color kRedDim = synth::ui::Color::Rgb(92, 18, 24);
inline constexpr synth::ui::Color kRedFaint = synth::ui::Color::Rgba(160, 20, 28, 96);
inline constexpr synth::ui::Color kText = synth::ui::Color::Rgb(238, 214, 212);
inline constexpr synth::ui::Color kMuted = synth::ui::Color::Rgb(110, 69, 72);
inline constexpr synth::ui::Color kDisconnected = synth::ui::Color::Rgb(52, 37, 43);

}  // namespace Dresden4Palette

struct Dresden4EncoderDrawState
{
    bool connected = false;
    bool selectedBank = false;
    bool bipolar = false;
    float value = 0.0f;
    float spread = 0.0f;
    synth::Color color = synth::Color::Red;
    std::string label;
};

struct Dresden4ScopeDrawState
{
    static constexpr float x_MinY = -1.1f;
    static constexpr float x_MaxY = 1.1f;
    static constexpr std::size_t x_NumSamples = 256;

    std::vector<synth::ui::WaveformLayerDrawState> layers;
};

inline std::vector<synth::ui::DrawCommand> BuildDresden4ScopeCommands(const Dresden4ScopeDrawState& state,
                                                                      synth::ui::Bounds bounds)
{
    return synth::ui::BuildScopeWaveformCommands(
        std::span<const synth::ui::WaveformLayerDrawState>(state.layers.data(), state.layers.size()),
        bounds,
        Dresden4ScopeDrawState::x_MinY,
        Dresden4ScopeDrawState::x_MaxY,
        Dresden4ScopeDrawState::x_NumSamples,
        true);
}

inline std::vector<synth::ui::DrawCommand> BuildDresden4EncoderCommands(const Dresden4EncoderDrawState& state,
                                                                        synth::ui::Bounds bounds)
{
    using synth::ui::DrawCommand;
    using synth::ui::Point;
    using synth::ui::TextAlign;
    using synth::ui::TextStyle;

    std::vector<DrawCommand> commands;
    const float corner = 10.0f;
    commands.push_back(DrawCommand::FillRoundedRect(bounds, corner, Dresden4Palette::kPanel));
    commands.push_back(DrawCommand::StrokeRoundedRect(
        bounds,
        corner,
        state.connected ? (state.selectedBank ? Dresden4Palette::kRed : Dresden4Palette::kRedDim)
                        : Dresden4Palette::kDisconnected,
        state.connected ? 1.6f : 1.0f));

    const float labelHeight = 22.0f;
    const synth::ui::Bounds labelBounds{
        bounds.x + 6.0f,
        bounds.y + 5.0f,
        std::max(0.0f, bounds.width - 12.0f),
        labelHeight,
    };
    commands.push_back(DrawCommand::Text(
        labelBounds,
        state.label.empty() ? "—" : state.label,
        TextStyle{.size = 11.0f,
                  .color = state.connected ? Dresden4Palette::kText : Dresden4Palette::kMuted,
                  .align = TextAlign::Center}));

    if (!state.connected)
    {
        const synth::ui::Bounds textBounds{
            bounds.x + 6.0f,
            bounds.y + bounds.height * 0.46f,
            std::max(0.0f, bounds.width - 12.0f),
            20.0f,
        };
        commands.push_back(DrawCommand::Text(
            textBounds,
            "Disconnected",
            TextStyle{.size = 10.0f, .color = Dresden4Palette::kMuted, .align = TextAlign::Center}));
        commands.push_back(DrawCommand::Line(
            {bounds.x + 12.0f, bounds.y + bounds.height - 14.0f},
            {bounds.x + bounds.width - 12.0f, bounds.y + 14.0f},
            Dresden4Palette::kDisconnected,
            1.0f));
        return commands;
    }

    const float size = std::min(bounds.width, bounds.height) * 0.48f;
    const float centerX = bounds.x + bounds.width * 0.5f;
    const float centerY = bounds.y + bounds.height * 0.58f;
    const float radius = size * 0.5f;
    const synth::ui::Bounds knob{centerX - radius, centerY - radius, radius * 2.0f, radius * 2.0f};
    const synth::ui::Color color = ToDresdenUiColor(state.color);
    const float value = state.bipolar ? (state.value + 1.0f) * 0.5f : state.value;
    const float clampedValue = Clamp(value, 0.0f, 1.0f);
    constexpr float startAngle = 3.92699082f;
    constexpr float arcSpan = 4.71238898f;
    const float endAngle = startAngle + arcSpan * clampedValue;

    commands.push_back(DrawCommand::StrokeEllipse(knob, Dresden4Palette::kRedDim, 2.0f));
    commands.push_back(DrawCommand::Arc(knob, startAngle, endAngle, color, 3.0f));

    if (state.spread > 0.001f)
    {
        const float spreadValue = Clamp(state.spread, 0.0f, 1.0f);
        commands.push_back(DrawCommand::Arc(knob, endAngle, startAngle + arcSpan * Clamp(clampedValue + spreadValue, 0.0f, 1.0f),
                                            Dresden4Palette::kRedFaint, 5.0f));
    }

    const float indicatorAngle = startAngle + arcSpan * clampedValue;
    const Point indicator{
        centerX + std::cos(indicatorAngle) * radius * 0.72f,
        centerY + std::sin(indicatorAngle) * radius * 0.72f,
    };
    commands.push_back(DrawCommand::Line({centerX, centerY}, indicator, Dresden4Palette::kText, 1.5f));
    commands.push_back(DrawCommand::FillEllipse({indicator.x - 3.0f, indicator.y - 3.0f, 6.0f, 6.0f}, color));
    return commands;
}

inline std::vector<synth::ui::DrawCommand> BuildDresden4BackgroundCommands(synth::ui::Bounds bounds)
{
    using synth::ui::DrawCommand;
    std::vector<DrawCommand> commands;
    commands.push_back(DrawCommand::Fill(bounds, Dresden4Palette::kVoid));
    commands.push_back(DrawCommand::StrokeRect(
        {bounds.x + 1.0f, bounds.y + 1.0f, std::max(0.0f, bounds.width - 2.0f), std::max(0.0f, bounds.height - 2.0f)},
        Dresden4Palette::kRedDim,
        1.0f));
    return commands;
}

}  // namespace synth_dresden4
