#pragma once

#include "synth/DspScope.hpp"
#include "synth/PortableUI.hpp"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <span>
#include <utility>
#include <vector>

namespace synth::ui {

namespace waveform_detail {

inline float Clamp(float value, float minValue, float maxValue)
{
    return std::max(minValue, std::min(maxValue, value));
}

inline double Clamp(double value, double minValue, double maxValue)
{
    return std::max(minValue, std::min(maxValue, value));
}

inline constexpr std::size_t x_NumPoints = 1024;

inline double ScopeSampleForPoint(std::size_t point, std::size_t numXSamples)
{
    return static_cast<double>(point) * static_cast<double>(numXSamples) / static_cast<double>(x_NumPoints - 1);
}

inline bool ScopePointCrossesTransfer(std::size_t point, std::size_t numXSamples, double transferSample)
{
    if (point == 0 || transferSample <= 0.0 || transferSample >= static_cast<double>(numXSamples))
    {
        return false;
    }
    const double previousSample = ScopeSampleForPoint(point - 1, numXSamples);
    const double sample = ScopeSampleForPoint(point, numXSamples);
    return previousSample < transferSample && sample >= transferSample;
}

inline std::vector<std::vector<Point>> BuildScopePolylines(const ::synth::ScopeReader& scopeReader,
                                                           Bounds bounds,
                                                           float minY,
                                                           float maxY)
{
    std::vector<std::vector<Point>> polylines;
    if (scopeReader.Empty())
    {
        return polylines;
    }

    const float denominator = std::max(1.0e-6f, maxY - minY);
    const double transferSample = scopeReader.TransferXSample();
    std::vector<Point> current;

    for (std::size_t j = 0; j < x_NumPoints; ++j)
    {
        const double sample = ScopeSampleForPoint(j, scopeReader.NumXSamples());
        const float y = (scopeReader.Get(sample) - minY) / denominator;
        const float screenX = bounds.x + bounds.width * static_cast<float>(j) / static_cast<float>(x_NumPoints - 1);
        const float screenY = bounds.y + bounds.height * (1.0f - Clamp(y, 0.0f, 1.0f));

        if (j == 0 || ScopePointCrossesTransfer(j, scopeReader.NumXSamples(), transferSample))
        {
            if (!current.empty())
            {
                polylines.push_back(std::move(current));
                current = {};
            }
            current.push_back({screenX, screenY});
        }
        else
        {
            current.push_back({screenX, screenY});
        }
    }

    if (!current.empty())
    {
        polylines.push_back(std::move(current));
    }

    return polylines;
}

inline Bounds ScopeMarkerBounds(const ::synth::ScopeReader& scopeReader,
                                Bounds bounds,
                                float minY,
                                float maxY,
                                float radius = 3.0f)
{
    if (scopeReader.Empty() || scopeReader.NumXSamples() == 0)
    {
        return {};
    }

    const double sample = Clamp(
        scopeReader.TransferXSample() > 0.0 ? scopeReader.TransferXSample() - 1.0 : 0.0,
        0.0,
        static_cast<double>(scopeReader.NumXSamples() - 1));
    const float denominator = std::max(1.0e-6f, maxY - minY);
    const float x = bounds.x + bounds.width * static_cast<float>(sample) /
                                    static_cast<float>(scopeReader.NumXSamples() - 1);
    const float normalizedY = (scopeReader.Get(sample) - minY) / denominator;
    const float y = bounds.y + bounds.height * (1.0f - Clamp(normalizedY, 0.0f, 1.0f));
    return {x - radius, y - radius, radius * 2.0f, radius * 2.0f};
}

}  // namespace waveform_detail

namespace ScopePathMath {

inline constexpr std::size_t x_NumPoints = waveform_detail::x_NumPoints;

inline double ScopeSampleForPoint(std::size_t point, std::size_t numXSamples)
{
    return waveform_detail::ScopeSampleForPoint(point, numXSamples);
}

inline bool ScopePointCrossesTransfer(std::size_t point, std::size_t numXSamples, double transferSample)
{
    return waveform_detail::ScopePointCrossesTransfer(point, numXSamples, transferSample);
}

inline std::vector<std::vector<Point>> BuildScopePolylines(const ::synth::ScopeReader& scopeReader,
                                                           Bounds bounds,
                                                           float minY,
                                                           float maxY)
{
    return waveform_detail::BuildScopePolylines(scopeReader, bounds, minY, maxY);
}

inline Bounds ScopeMarkerBounds(const ::synth::ScopeReader& scopeReader,
                                Bounds bounds,
                                float minY,
                                float maxY,
                                float radius = 3.0f)
{
    return waveform_detail::ScopeMarkerBounds(scopeReader, bounds, minY, maxY, radius);
}

}  // namespace ScopePathMath

struct WaveformLayerDrawState
{
    bool connected = false;
    ::synth::Color scopeColor = ::synth::Color::Off;
    const ::synth::ScopeWriter* scope = nullptr;
    std::size_t scopeChannel = 0;
};

inline std::vector<DrawCommand> BuildScopeWaveformCommands(std::span<const WaveformLayerDrawState> layers,
                                                           Bounds nodeExtent,
                                                           float minY,
                                                           float maxY,
                                                           std::size_t numSamples,
                                                           bool drawMarkers)
{
    std::vector<DrawCommand> commands;

    constexpr float x_Inset = 4.0f;
    commands.push_back(DrawCommand::Fill({0.0f, 0.0f, nodeExtent.width, nodeExtent.height},
                                         Color::Rgb(12, 14, 16)));

    Bounds bounds{
        x_Inset,
        x_Inset,
        std::max(0.0f, nodeExtent.width - x_Inset * 2.0f),
        std::max(0.0f, nodeExtent.height - x_Inset * 2.0f),
    };

    commands.push_back(DrawCommand::Line(
        {bounds.x, bounds.y + bounds.height * 0.5f},
        {bounds.x + bounds.width, bounds.y + bounds.height * 0.5f},
        Color::Rgb(42, 46, 48),
        1.0f));

    for (const WaveformLayerDrawState& layer : layers)
    {
        if (!layer.connected || layer.scope == nullptr)
        {
            continue;
        }

        ::synth::ScopeReader reader(layer.scope, layer.scopeChannel, numSamples, 1);
        if (reader.Empty())
        {
            continue;
        }

        const Color waveColor = layer.scopeColor;
        auto polylines = waveform_detail::BuildScopePolylines(reader, bounds, minY, maxY);
        for (auto& polyline : polylines)
        {
            if (!polyline.empty())
            {
                commands.push_back(DrawCommand::Polyline(std::move(polyline), waveColor, 1.4f));
            }
        }

        if (drawMarkers)
        {
            const Bounds marker = waveform_detail::ScopeMarkerBounds(reader, bounds, minY, maxY);
            if (marker.width > 0.0f)
            {
                commands.push_back(DrawCommand::FillEllipse(
                    marker,
                    ::synth::Brighten(waveColor, 0.45f)));
            }
        }
    }

    return commands;
}

template <typename LayerState>
class ScopeVisualizer final : public Visualizer
{
public:
    ScopeVisualizer(std::span<LayerState* const> layers,
                    float minY,
                    float maxY,
                    std::size_t numSamples,
                    bool drawMarkers)
        : layers_(layers.begin(), layers.end()),
          minY_(minY),
          maxY_(maxY),
          numSamples_(numSamples),
          drawMarkers_(drawMarkers)
    {}

protected:
    std::vector<DrawCommand> DrawVisible() const override
    {
        std::vector<WaveformLayerDrawState> snapshots;
        snapshots.reserve(layers_.size());
        for (const LayerState* layer : layers_)
        {
            if (layer == nullptr)
            {
                continue;
            }
            snapshots.push_back({
                .connected = layer->connected.load(std::memory_order_relaxed),
                .scopeColor = layer->scopeColor.Load(std::memory_order_relaxed),
                .scope = layer->scope.load(std::memory_order_relaxed),
                .scopeChannel = layer->scopeChannel.load(std::memory_order_relaxed),
            });
        }
        const Bounds bounds = GetBounds();
        return BuildScopeWaveformCommands(
            snapshots,
            {0.0f, 0.0f, bounds.width, bounds.height},
            minY_,
            maxY_,
            numSamples_,
            drawMarkers_);
    }

private:
    std::vector<LayerState*> layers_;
    float minY_ = -1.0f;
    float maxY_ = 1.0f;
    std::size_t numSamples_ = 0;
    bool drawMarkers_ = true;
};

}  // namespace synth::ui
