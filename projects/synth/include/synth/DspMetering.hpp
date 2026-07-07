#pragma once

#include "synth/DspNumbers.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <numbers>

namespace synth {

struct MeterSnapshot {
    float rms = 0.0f;
    float peak = 0.0f;
    float reduction = 1.0f;
};

struct Meter {
    static constexpr float kSmoothingAlphaDown = 0.0002f;
    static constexpr float kSmoothingAlphaUp = 0.0008f;
    static constexpr float kPeakSmoothingAlpha = 0.00005f;
    static constexpr std::size_t kPeakHistorySize = 48000;
    static constexpr float kEpsilon = 1.0e-11f;

    float meanSquare = 0.0f;
    float peak = 0.0f;
    float reduction = 1.0f;
    std::size_t samplesSincePeak = 0;

    static float FiniteOr(float value, float fallback) {
        return std::isfinite(value) ? value : fallback;
    }

    void Process(float input) {
        input = FiniteOr(input, 0.0f);
        const float inputSquared = input * input;
        if (meanSquare < inputSquared) {
            meanSquare = meanSquare * (1.0f - kSmoothingAlphaUp) + inputSquared * kSmoothingAlphaUp;
        } else {
            meanSquare = meanSquare * (1.0f - kSmoothingAlphaDown) + inputSquared * kSmoothingAlphaDown;
        }

        const float magnitude = std::abs(input);
        if (peak < magnitude) {
            peak = magnitude;
            samplesSincePeak = 0;
        } else if (samplesSincePeak < kPeakHistorySize) {
            ++samplesSincePeak;
        } else {
            peak = peak * (1.0f - kPeakSmoothingAlpha) + magnitude * kPeakSmoothingAlpha;
        }
    }

    float ProcessAndSaturate(float input) {
        input = FiniteOr(input, 0.0f);
        const float halfPi = std::numbers::pi_v<float> * 0.5f;
        const float output = std::atan(input * halfPi) / halfPi;
        Process(output);
        reduction = std::max(kEpsilon, std::abs(output)) / std::max(kEpsilon, std::abs(input));
        return output;
    }

    MeterSnapshot Snapshot() const {
        // Plain-value snapshot; callers own any cross-thread publication/atomic handoff.
        return {.rms = std::sqrt(std::max(0.0f, meanSquare)), .peak = peak, .reduction = reduction};
    }

    static float RmsDbFS(float linearRms) {
        return 20.0f * std::log10(std::max(kEpsilon, linearRms));
    }

    static float PeakDbFS(float linearPeak) {
        return 20.0f * std::log10(std::max(kEpsilon, linearPeak));
    }
};

template<std::size_t Size>
struct NaryMeterSnapshot {
    std::array<MeterSnapshot, Size> meters{};
};

template<std::size_t Size>
struct NaryMeter {
    std::array<Meter, Size> meters{};

    void Process(const NaryNumber<float, Size>& input) {
        for (std::size_t i = 0; i < Size; ++i) {
            meters[i].Process(input[i]);
        }
    }

    NaryNumber<float, Size> ProcessAndSaturate(const NaryNumber<float, Size>& input) {
        NaryNumber<float, Size> output;
        for (std::size_t i = 0; i < Size; ++i) {
            output[i] = meters[i].ProcessAndSaturate(input[i]);
        }
        return output;
    }

    NaryMeterSnapshot<Size> Snapshot() const {
        NaryMeterSnapshot<Size> snapshot;
        for (std::size_t i = 0; i < Size; ++i) {
            snapshot.meters[i] = meters[i].Snapshot();
        }
        return snapshot;
    }
};

} // namespace synth
