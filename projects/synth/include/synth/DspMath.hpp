#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <cstddef>
#include <numbers>

namespace synth {

template<std::size_t Bits>
struct DspMath {
    static constexpr std::size_t kTableSize = std::size_t{1} << Bits;
    static constexpr int kHannKernelRadius = 8;
    static constexpr std::size_t kHannKernelTableSize = kTableSize;
    static constexpr float kHannKernelMinOffset = -static_cast<float>(kHannKernelRadius);
    static constexpr float kHannKernelWidth = 2.0f * static_cast<float>(kHannKernelRadius) + 1.0f;

    std::array<float, kTableSize> cosTable{};
    std::array<std::complex<float>, kTableSize> rootOfUnity{};
    std::array<std::complex<float>, kHannKernelTableSize + 1> hannKernel{};

    DspMath() {
        for (std::size_t i = 0; i < kTableSize; ++i) {
            const float phase = static_cast<float>(i) / static_cast<float>(kTableSize);
            cosTable[i] = std::cos(2.0f * std::numbers::pi_v<float> * phase);
            rootOfUnity[i] = {
                std::cos(2.0f * std::numbers::pi_v<float> * phase),
                std::sin(2.0f * std::numbers::pi_v<float> * phase),
            };
        }

        for (std::size_t i = 0; i <= kHannKernelTableSize; ++i) {
            const float offset = kHannKernelMinOffset
                + kHannKernelWidth * static_cast<float>(i) / static_cast<float>(kHannKernelTableSize);
            hannKernel[i] = ComputeHannKernel(offset);
        }
    }

    static const DspMath& Instance() {
        static const DspMath instance;
        return instance;
    }

    static float WrapUnit(float x) {
        x -= std::floor(x);
        return x;
    }

    static float Cos2Pi(float x) {
        const auto& table = Instance().cosTable;
        const float phase = WrapUnit(x);
        const float pos = phase * static_cast<float>(kTableSize);
        const auto index = static_cast<std::size_t>(std::floor(pos)) % kTableSize;
        const float frac = pos - std::floor(pos);
        return table[index] * (1.0f - frac) + table[(index + 1) % kTableSize] * frac;
    }

    static float Sin2Pi(float x) {
        return Cos2Pi(x - 0.25f);
    }

    static float Cos(float radians) {
        return Cos2Pi(radians / (2.0f * std::numbers::pi_v<float>));
    }

    static float Sin(float radians) {
        return Sin2Pi(radians / (2.0f * std::numbers::pi_v<float>));
    }

    static float Tan2Pi(float x) {
        return Sin2Pi(x) / Cos2Pi(x);
    }

    static float TanPi(float x) {
        return Tan2Pi(x * 0.5f);
    }

    static float Tan(float radians) {
        return Tan2Pi(radians / (2.0f * std::numbers::pi_v<float>));
    }

    static std::complex<float> Polar(float magnitude, float radians) {
        return {magnitude * Cos(radians), magnitude * Sin(radians)};
    }

    static std::complex<float> Polar2Pi(float magnitude, float phase) {
        return {magnitude * Cos2Pi(phase), magnitude * Sin2Pi(phase)};
    }

    static std::complex<float> RootOfUnityByIndex(std::size_t index) {
        return Instance().rootOfUnity[index % kTableSize];
    }

    static float Hann(std::size_t index) {
        return 0.5f * (1.0f - Cos2Pi(static_cast<float>(index) / static_cast<float>(kTableSize)));
    }

    static std::complex<float> ComputeRectKernel(float offset) {
        const float denominator = std::sin(std::numbers::pi_v<float> * offset / static_cast<float>(kTableSize));
        if (std::abs(denominator) < 1.0e-6f) {
            return std::abs(offset) < 1.0e-6f ? std::complex<float>{1.0f, 0.0f}
                                              : std::complex<float>{0.0f, 0.0f};
        }

        const float magnitude = std::sin(std::numbers::pi_v<float> * offset)
            / (static_cast<float>(kTableSize) * denominator);
        const float phase = std::numbers::pi_v<float> * offset
            * static_cast<float>(kTableSize - 1) / static_cast<float>(kTableSize);
        return {magnitude * std::cos(phase), magnitude * std::sin(phase)};
    }

    static std::complex<float> ComputeHannKernel(float offset) {
        return 0.5f * ComputeRectKernel(offset)
            - 0.25f * ComputeRectKernel(offset + 1.0f)
            - 0.25f * ComputeRectKernel(offset - 1.0f);
    }

    static std::complex<float> HannKernel(float offset) {
        const auto& table = Instance().hannKernel;
        const float pos = (offset - kHannKernelMinOffset)
            * static_cast<float>(kHannKernelTableSize) / kHannKernelWidth;
        if (pos <= 0.0f) {
            return table[0];
        }
        if (static_cast<float>(kHannKernelTableSize) <= pos) {
            return table[kHannKernelTableSize];
        }

        const auto index = static_cast<std::size_t>(std::floor(pos));
        const float frac = pos - static_cast<float>(index);
        return table[index] * (1.0f - frac) + table[index + 1] * frac;
    }
};

using DefaultDspMath = DspMath<12>;

inline float ShapedInterpolate(
    float source,
    float target,
    float shape,
    double t) {
    const double clampedT = std::clamp(t, 0.0, 1.0);
    const float narrowedT = static_cast<float>(clampedT);
    const float clampedShape = std::clamp(shape, 0.0f, 1.0f);
    const float smoothT = 0.5f - 0.5f * DefaultDspMath::Cos2Pi(0.5f * narrowedT);
    const float shapedT = clampedShape * smoothT + (1.0f - clampedShape) * narrowedT;
    return target * shapedT + (1.0f - shapedT) * source;
}

} // namespace synth
