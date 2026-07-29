#pragma once

#include "synth/PortableUI.hpp"

#include <algorithm>
#include <string_view>

namespace synth::ui::metrics {

/*
Metrics seed, read from both existing backend tables before deleting backend
layout policy:

- JUCE PortableJuceBackend.hpp DefaultSizeForNode:
  button 72x28, slider 140x28, label height 22, combo 160x28,
  text field 120x28, text reservation `chars * 6.5 + padding`.
- Browser ui.ts defaultSize:
  same constants and the same `chars * 6.5 + padding` reservations.

The portable contract derives per-character advance from the current 14 px
default text size: 6.5 / 14 = 0.464. We round up to 0.62 for a conservative
backend-free reservation, so fitting text is usually truncation-free while
layout stays deterministic and JUCE-free.
*/

inline float AdvanceFor(const TextStyle& style)
{
    return style.size * 0.62f;
}

inline float TextWidth(std::string_view text, const TextStyle& style)
{
    return static_cast<float>(text.size()) * AdvanceFor(style) + 16.0f;
}

inline Bounds IntrinsicFor(const Node& node)
{
    const TextStyle style = node.textStyle.value_or(TextStyle{});
    switch (node.kind)
    {
        case NodeKind::Label:
        case NodeKind::StatusText:
            return {0.0f, 0.0f, TextWidth(node.text.empty() ? node.label : node.text, style), 22.0f};
        case NodeKind::Button:
            return {0.0f, 0.0f, std::max(72.0f, TextWidth(node.label, style)), 28.0f};
        case NodeKind::Toggle:
            return {0.0f, 0.0f, std::max(72.0f, TextWidth(node.label, style) + 24.0f), 28.0f};
        case NodeKind::Slider:
            return {0.0f, 0.0f, 140.0f, 28.0f};
        case NodeKind::ComboBox:
            return {0.0f, 0.0f, 160.0f, 28.0f};
        case NodeKind::TextField:
            return {0.0f, 0.0f, 120.0f, 28.0f};
        default:
            return {0.0f, 0.0f, 0.0f, 0.0f};
    }
}

}  // namespace synth::ui::metrics
