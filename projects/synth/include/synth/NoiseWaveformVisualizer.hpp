#pragma once

#include "synth/DspNoise.hpp"
#include "synth/PortableUI.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <utility>
#include <vector>

namespace synth::ui {

class NoiseWaveformVisualizer final : public Visualizer {
public:
    explicit NoiseWaveformVisualizer(Color color = Color::White)
        : NoiseWaveformVisualizer(color, NoiseInitializationSeed()) {}

    NoiseWaveformVisualizer(Color color, std::uint64_t seed)
        : color_(color), random_(seed) {}

    void SetColor(Color color) noexcept { color_ = color; }

protected:
    std::vector<DrawCommand> DrawVisible() const override {
        const Bounds bounds = GetBounds();
        if (!std::isfinite(bounds.x) || !std::isfinite(bounds.y) ||
            !std::isfinite(bounds.width) || !std::isfinite(bounds.height) ||
            bounds.width <= 0.0f || bounds.height <= 0.0f) {
            return {};
        }

        std::vector<Point> points;
        const std::size_t wholeColumns = static_cast<std::size_t>(std::floor(bounds.width));
        points.reserve(wholeColumns + 2);
        const auto appendPoint = [&](float x) {
            points.push_back({x, bounds.y + random_.UniformOpen01() * bounds.height});
        };
        for (std::size_t column = 0; column <= wholeColumns; ++column) {
            appendPoint(bounds.x + static_cast<float>(column));
        }
        const float right = bounds.x + bounds.width;
        if (points.back().x < right) {
            appendPoint(right);
        }
        return {DrawCommand::Polyline(std::move(points), color_, 1.4f)};
    }

private:
    Color color_;
    mutable FastPcg32 random_;
};

} // namespace synth::ui
