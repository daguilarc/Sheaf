#pragma once

#include "synth/DspFilters.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <memory>
#include <span>
#include <utility>
#include <vector>

namespace synth {

struct BoundedAudioBuffer {
    static constexpr std::size_t kNumSections = 1024;

    std::vector<float> samples;
    std::array<float, kNumSections> sectionMaximums{};
    std::array<float, kNumSections> sectionMinimums{};

    void ClearSectionExtrema() {
        sectionMaximums.fill(0.0f);
        sectionMinimums.fill(0.0f);
    }

    void ComputeSectionExtrema() {
        ClearSectionExtrema();

        const std::size_t n = samples.size();
        if (n == 0) {
            return;
        }

        for (std::size_t section = 0; section < kNumSections; ++section) {
            const std::size_t begin = (section * n) / kNumSections;
            const std::size_t end = ((section + 1) * n) / kNumSections;
            if (begin == end) {
                continue;
            }

            float minimum = samples[begin];
            float maximum = samples[begin];
            for (std::size_t i = begin + 1; i < end; ++i) {
                minimum = std::min(minimum, samples[i]);
                maximum = std::max(maximum, samples[i]);
            }

            sectionMinimums[section] = minimum;
            sectionMaximums[section] = maximum;
        }
    }

    void Clear() {
        samples.clear();
        ClearSectionExtrema();
    }

    double RealTimeFromNormalized(double normalized) const {
        if (samples.empty()) {
            return 0.0;
        }
        return normalized * static_cast<double>(samples.size() - 1);
    }

    float ReadRealTime(double realTime) const {
        const std::size_t n = samples.size();
        if (n == 0) {
            return 0.0f;
        }
        if (n == 1) {
            return samples[0];
        }

        const double maxIndex = static_cast<double>(n - 1);
        if (realTime <= 0.0) {
            return samples[0];
        }
        if (realTime >= maxIndex) {
            return samples[n - 1];
        }

        const double floorIndex = std::floor(realTime);
        const std::size_t i0 = static_cast<std::size_t>(floorIndex);
        const std::size_t i1 = i0 + 1;
        const float alpha = static_cast<float>(realTime - floorIndex);
        return samples[i0] + alpha * (samples[i1] - samples[i0]);
    }

    float ReadNormalized(double normalized) const {
        return ReadRealTime(RealTimeFromNormalized(std::clamp(normalized, 0.0, 1.0)));
    }
};

template<std::size_t Size>
struct RollingBuffer {
    static_assert(Size > 0);

    std::array<float, Size> samples{};
    std::size_t index = 0;

    void Write(float value) {
        samples[index] = value;
        index = (index + 1) % Size;
    }

    float Min() const {
        return *std::min_element(samples.begin(), samples.end());
    }

    float Max() const {
        return *std::max_element(samples.begin(), samples.end());
    }
};

namespace detail {

inline constexpr double kFirDesignPi = 3.141592653589793238462643383279502884;

constexpr double FirAbs(double value) {
    return value < 0.0 ? -value : value;
}

constexpr double FirSqrt(double value) {
    if (value <= 0.0) {
        return 0.0;
    }

    double estimate = value >= 1.0 ? value : 1.0;
    for (int i = 0; i < 48; ++i) {
        estimate = 0.5 * (estimate + value / estimate);
    }
    return estimate;
}

constexpr double FirSin(double value) {
    constexpr double twoPi = 2.0 * kFirDesignPi;
    while (value > kFirDesignPi) {
        value -= twoPi;
    }
    while (value < -kFirDesignPi) {
        value += twoPi;
    }

    double term = value;
    double sum = value;
    for (int i = 1; i < 20; ++i) {
        const double a = static_cast<double>(2 * i);
        const double b = static_cast<double>(2 * i + 1);
        term *= -(value * value) / (a * b);
        sum += term;
    }
    return sum;
}

constexpr double FirBesselI0(double value) {
    double term = 1.0;
    double sum = 1.0;
    for (int k = 1; k <= 50; ++k) {
        const double denominator = 4.0 * static_cast<double>(k) * static_cast<double>(k);
        term *= (value * value) / denominator;
        sum += term;
    }
    return sum;
}

template<std::size_t Taps>
constexpr std::array<double, Taps> MakeKaiserLowpass(double cutoff, double beta) {
    static_assert(Taps > 0);

    std::array<double, Taps> coefficients{};
    const double center = static_cast<double>(Taps - 1) * 0.5;
    const double besselDenominator = FirBesselI0(beta);

    for (std::size_t i = 0; i < Taps; ++i) {
        const double distanceFromCenter = FirAbs(static_cast<double>(i) - center);
        const double ideal = distanceFromCenter == 0.0
            ? 2.0 * cutoff
            : FirSin(2.0 * kFirDesignPi * cutoff * distanceFromCenter)
                / (kFirDesignPi * distanceFromCenter);
        const double normalizedDistance = center == 0.0 ? 0.0 : distanceFromCenter / center;
        const double window = FirBesselI0(beta * FirSqrt(1.0 - normalizedDistance * normalizedDistance))
            / besselDenominator;
        coefficients[i] = ideal * window;
    }

    double sum = 0.0;
    for (const double coefficient : coefficients) {
        sum += coefficient;
    }
    for (double& coefficient : coefficients) {
        coefficient /= sum;
    }
    return coefficients;
}

} // namespace detail

inline constexpr std::size_t kDresden4DecimatorTaps = 287;
inline constexpr std::array<double, kDresden4DecimatorTaps> kDresden4DecimatorCoefficients =
    detail::MakeKaiserLowpass<kDresden4DecimatorTaps>(11.0 / 96.0, 9.0);

constexpr std::span<const double, kDresden4DecimatorTaps> Dresden4DecimatorCoefficients() {
    return std::span<const double, kDresden4DecimatorTaps>{kDresden4DecimatorCoefficients};
}

template<std::size_t Factor, std::size_t Channels, std::size_t Taps>
class FirDecimator {
    static_assert(Factor > 0);
    static_assert(Channels > 0);
    static_assert(Taps > 0);

public:
    static constexpr std::size_t kFactor = Factor;
    static constexpr std::size_t kChannels = Channels;
    static constexpr std::size_t kTaps = Taps;

    constexpr explicit FirDecimator(std::span<const double, Taps> coefficients) {
        for (std::size_t i = 0; i < Taps; ++i) {
            coefficients_[i] = static_cast<float>(coefficients[i]);
        }
    }

    constexpr explicit FirDecimator(const std::array<double, Taps>& coefficients)
        : FirDecimator(std::span<const double, Taps>{coefficients}) {}

    void Reset() {
        for (auto& channelHistory : history_) {
            channelHistory.fill(0.0f);
        }
        writeIndex_ = 0;
        phase_ = 0;
    }

    bool ProcessFrame(std::span<const float, Channels> input, std::span<float, Channels> output) {
        for (std::size_t channel = 0; channel < Channels; ++channel) {
            history_[channel][writeIndex_] = input[channel];
        }

        writeIndex_ = (writeIndex_ + 1) % Taps;
        phase_ = (phase_ + 1) % Factor;
        if (phase_ != 0) {
            return false;
        }

        for (std::size_t channel = 0; channel < Channels; ++channel) {
            double sum = 0.0;
            std::size_t historyIndex = writeIndex_;
            for (std::size_t tap = 0; tap < Taps; ++tap) {
                if (historyIndex == 0) {
                    historyIndex = Taps;
                }
                --historyIndex;
                sum += static_cast<double>(coefficients_[tap] * history_[channel][historyIndex]);
            }
            output[channel] = static_cast<float>(sum);
        }
        return true;
    }

private:
    std::array<float, Taps> coefficients_{};
    std::array<std::array<float, Taps>, Channels> history_{};
    std::size_t writeIndex_ = 0;
    std::size_t phase_ = 0;
};

template<std::size_t Factor, std::size_t Channels, typename Decimator>
class OversampledOutputStage {
    static_assert(Factor > 0);
    static_assert(Channels > 0);
    static_assert(Decimator::kFactor == Factor, "OversampledOutputStage factor must match Decimator::kFactor");
    static_assert(Decimator::kChannels == Channels, "OversampledOutputStage channels must match Decimator::kChannels");

public:
    constexpr explicit OversampledOutputStage(Decimator decimator)
        : decimator_(std::move(decimator)) {}

    template<typename Generator>
    std::array<float, Channels> ProcessHostFrame(std::uint64_t hostSampleIndex, Generator&& generator) {
        std::array<float, Channels> output{};
        for (std::size_t subframe = 0; subframe < Factor; ++subframe) {
            const std::uint64_t internalIndex = hostSampleIndex * Factor + subframe;
            const std::array<float, Channels> input = generator(internalIndex);
            decimator_.ProcessFrame(input, output);
        }
        return output;
    }

    void Reset() {
        decimator_.Reset();
    }

private:
    Decimator decimator_;
};

struct BufferResampler {
    static constexpr std::size_t kMaxBufferBytes = std::size_t{16} * std::size_t{1024} * std::size_t{1024};
    static constexpr std::size_t kMaxSampleFrames = kMaxBufferBytes / sizeof(float);
    static constexpr double kRateMatchEpsilon = 1.0e-3;

    static std::size_t OutputFrameCount(std::size_t sourceCount, double sourceRate, double targetRate) {
        if (sourceCount == 0 || sourceRate <= 0.0 || targetRate <= 0.0) {
            return 0;
        }

        const double rel = std::abs(sourceRate - targetRate) / targetRate;
        if (rel < kRateMatchEpsilon) {
            return sourceCount;
        }

        const double outLen = static_cast<double>(sourceCount) * targetRate / sourceRate;
        return std::max<std::size_t>(1, static_cast<std::size_t>(std::lround(outLen)));
    }

    static void AntiAliasLowpassInPlace(float* source, std::size_t sourceCount, double sourceRate, double targetRate) {
        if (!source || sourceCount == 0 || sourceRate <= 0.0 || targetRate <= 0.0) {
            return;
        }
        if (sourceRate <= targetRate * (1.0 + kRateMatchEpsilon)) {
            return;
        }

        const float cutoff = BiquadSection::ClampCutoff(0.45f * static_cast<float>(targetRate / sourceRate));
        ButterworthFilter filter;
        filter.SetCutoff(cutoff);
        filter.Reset();

        for (std::size_t i = 0; i < sourceCount; ++i) {
            source[i] = filter.Process({.value = source[i], .cutoff = cutoff});
        }
    }

    static bool ResampleToRate(
        const float* source,
        std::size_t sourceCount,
        double sourceRate,
        double targetRate,
        float* out,
        std::size_t outCapacity,
        std::size_t* outCountOut) {
        if (outCountOut) {
            *outCountOut = 0;
        }

        if (!source || !out || !outCountOut || sourceCount == 0 || sourceRate <= 0.0 || targetRate <= 0.0) {
            return false;
        }
        if (sourceCount > kMaxSampleFrames) {
            return false;
        }

        const double rel = std::abs(sourceRate - targetRate) / targetRate;
        if (rel < kRateMatchEpsilon) {
            if (outCapacity < sourceCount) {
                return false;
            }
            std::memcpy(out, source, sourceCount * sizeof(float));
            *outCountOut = sourceCount;
            return true;
        }

        const std::size_t outCount = OutputFrameCount(sourceCount, sourceRate, targetRate);
        if (outCount == 0 || outCapacity < outCount || outCount > kMaxSampleFrames) {
            return false;
        }

        const float* readData = source;
        std::unique_ptr<float[]> filtered;
        if (sourceRate > targetRate * (1.0 + kRateMatchEpsilon)) {
            filtered = std::make_unique<float[]>(sourceCount);
            std::memcpy(filtered.get(), source, sourceCount * sizeof(float));
            AntiAliasLowpassInPlace(filtered.get(), sourceCount, sourceRate, targetRate);
            readData = filtered.get();
        }

        if (sourceCount == 1) {
            std::fill(out, out + outCount, readData[0]);
            *outCountOut = outCount;
            return true;
        }

        const double scale = sourceRate / targetRate;
        const double maxIndex = static_cast<double>(sourceCount - 1);
        for (std::size_t i = 0; i < outCount; ++i) {
            const double srcIndex = static_cast<double>(i) * scale;
            if (srcIndex <= 0.0) {
                out[i] = readData[0];
                continue;
            }
            if (srcIndex >= maxIndex) {
                out[i] = readData[sourceCount - 1];
                continue;
            }

            const double floorIndex = std::floor(srcIndex);
            const std::size_t i0 = static_cast<std::size_t>(floorIndex);
            const std::size_t i1 = i0 + 1;
            const float alpha = static_cast<float>(srcIndex - floorIndex);
            out[i] = readData[i0] + alpha * (readData[i1] - readData[i0]);
        }

        *outCountOut = outCount;
        return true;
    }
};

} // namespace synth
