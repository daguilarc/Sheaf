#pragma once

#include "../apps/miniapp/MiniAppDraw.hpp"
#include "synth/DspScope.hpp"

#include <juce_graphics/juce_graphics.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <limits>

namespace synth_juce {

class PathDrawer {
public:
    static constexpr std::size_t kNumPoints = synth_miniapp::ScopePathMath::x_NumPoints;

    PathDrawer() {
        ComputeBucketExpX();
    }

    PathDrawer(float height, float width, float xMin, float yMin)
        : height_(height), width_(width), xMin_(xMin), yMin_(yMin) {
        ComputeBucketExpX();
    }

    static double ScopeSampleForPoint(std::size_t point, std::size_t numXSamples) {
        return synth_miniapp::ScopePathMath::ScopeSampleForPoint(point, numXSamples);
    }

    static bool ScopePointCrossesTransfer(std::size_t point, std::size_t numXSamples, double transferSample) {
        return synth_miniapp::ScopePathMath::ScopePointCrossesTransfer(point, numXSamples, transferSample);
    }

    void SetBounds(juce::Rectangle<float> bounds) {
        xMin_ = bounds.getX();
        yMin_ = bounds.getY();
        width_ = bounds.getWidth();
        height_ = bounds.getHeight();
    }

    template<typename Fn>
    void DrawPath(juce::Graphics& g, juce::Colour colour, Fn fn) {
        juce::Path path;
        for (std::size_t j = 0; j < kNumPoints; ++j) {
            const float xIn = logX_ ? bucketExpX_[j] : static_cast<float>(j) / static_cast<float>(kNumPoints - 1);
            const float y = std::clamp(fn(xIn), 0.0f, 1.0f);
            const float screenX = xMin_ + width_ * static_cast<float>(j) / static_cast<float>(kNumPoints - 1);
            const float screenY = yMin_ + height_ * (1.0f - y);
            if (j == 0) {
                path.startNewSubPath(screenX, screenY);
            } else {
                path.lineTo(screenX, screenY);
            }
        }
        g.setColour(colour);
        g.strokePath(path, juce::PathStrokeType(1.2f));
    }

    void DrawScopePath(juce::Graphics& g,
                       juce::Colour colour,
                       const synth::ScopeReader& scopeReader,
                       float minY,
                       float maxY) {
        juce::Path path;
        const float denominator = std::max(1.0e-6f, maxY - minY);
        const double transferSample = scopeReader.TransferXSample();
        for (std::size_t j = 0; j < kNumPoints; ++j) {
            const double sample = ScopeSampleForPoint(j, scopeReader.NumXSamples());
            const float y = (scopeReader.Get(sample) - minY) / denominator;
            const float screenX = xMin_ + width_ * static_cast<float>(j) / static_cast<float>(kNumPoints - 1);
            const float screenY = yMin_ + height_ * (1.0f - std::clamp(y, 0.0f, 1.0f));
            if (j == 0 || ScopePointCrossesTransfer(j, scopeReader.NumXSamples(), transferSample)) {
                path.startNewSubPath(screenX, screenY);
            } else {
                path.lineTo(screenX, screenY);
            }
        }
        g.setColour(colour);
        g.strokePath(path, juce::PathStrokeType(1.4f));
    }

    void DrawScopeMarker(juce::Graphics& g,
                         juce::Colour colour,
                         const synth::ScopeReader& scopeReader,
                         float minY,
                         float maxY) {
        if (scopeReader.Empty() || scopeReader.NumXSamples() == 0) {
            return;
        }
        const double sample = std::clamp(
            scopeReader.TransferXSample() > 0.0 ? scopeReader.TransferXSample() - 1.0 : 0.0,
            0.0,
            static_cast<double>(scopeReader.NumXSamples() - 1));
        const float denominator = std::max(1.0e-6f, maxY - minY);
        const float x = xMin_ + width_ * static_cast<float>(sample) / static_cast<float>(scopeReader.NumXSamples() - 1);
        const float normalizedY = (scopeReader.Get(sample) - minY) / denominator;
        const float y = yMin_ + height_ * (1.0f - std::clamp(normalizedY, 0.0f, 1.0f));
        constexpr float radius = 3.0f;
        g.setColour(colour);
        g.fillEllipse(x - radius, y - radius, radius * 2.0f, radius * 2.0f);
    }

private:
    void ComputeBucketExpX() {
        const float m = static_cast<float>(kNumPoints);
        for (std::size_t i = 0; i < kNumPoints; ++i) {
            bucketExpX_[i] = std::pow(m - 1.0f, static_cast<float>(i) / m) / (2.0f * m);
        }
    }

    float height_ = 0.0f;
    float width_ = 0.0f;
    float xMin_ = 0.0f;
    float yMin_ = 0.0f;
    bool logX_ = true;
    std::array<float, kNumPoints> bucketExpX_{};
};

} // namespace synth_juce
