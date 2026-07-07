#pragma once

#include "synth/DspFilters.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstring>
#include <memory>
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
