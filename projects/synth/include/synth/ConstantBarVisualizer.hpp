#pragma once

#include "synth/PortableUI.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <span>
#include <vector>

namespace synth::ui {

class ConstantBarVisualizer final : public Visualizer {
public:
    explicit ConstantBarVisualizer(
        std::span<const float> values,
        Color color = Color::White) noexcept
        : values_(values), color_(color) {}

    void SetColor(Color color) noexcept { color_ = color; }
    bool WantsEncoderFrame() const noexcept override { return false; }

protected:
    std::vector<DrawCommand> DrawVisible() const override {
        const Bounds bounds = GetBounds();
        if (values_.empty() || !std::isfinite(bounds.x) || !std::isfinite(bounds.y) ||
            !std::isfinite(bounds.width) || !std::isfinite(bounds.height) ||
            bounds.width <= 0.0f || bounds.height <= 0.0f) {
            return {};
        }
        for (const float value : values_) {
            if (!std::isfinite(value)) {
                return {};
            }
        }

        constexpr float kMinimum = -0.1f;
        constexpr float kMaximum = 1.1f;
        constexpr float kRange = kMaximum - kMinimum;
        const float slotWidth = bounds.width / static_cast<float>(values_.size());
        const float gap = std::min(2.0f, slotWidth * 0.2f);
        const float barWidth = (slotWidth - gap) * 0.5f;
        const float bottom = bounds.y + bounds.height;
        std::vector<DrawCommand> commands;
        commands.reserve(values_.size());
        for (std::size_t voice = 0; voice < values_.size(); ++voice) {
            const float value = std::clamp(values_[voice], 0.0f, 1.0f);
            const float top = bounds.y + ((kMaximum - value) / kRange) * bounds.height;
            commands.push_back(DrawCommand::Fill({
                bounds.x + static_cast<float>(voice) * slotWidth + (slotWidth - barWidth) * 0.5f,
                top,
                barWidth,
                bottom - top,
            }, color_));
        }
        return commands;
    }

private:
    std::span<const float> values_;
    Color color_;
};

} // namespace synth::ui
