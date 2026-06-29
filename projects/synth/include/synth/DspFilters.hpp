#pragma once

#include "synth/DspMath.hpp"
#include "synth/DspTransferFunction.hpp"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <complex>
#include <numbers>

namespace synth {

struct OnePoleLowPass {
    static constexpr float kMaxCutoff = 0.499f;

    struct Input {
        float value = 0.0f;
        float cutoff = 0.0f;
    };

    struct UIState : TransferFunction {
        std::atomic<float> alpha{0.0f};

        float FrequencyResponse(float normalizedFrequency) const override {
            return std::abs(OnePoleLowPass::TransferFunctionValue(alpha.load(), normalizedFrequency));
        }

        std::complex<float> TransferFunctionValue(float normalizedFrequency) const override {
            return OnePoleLowPass::TransferFunctionValue(alpha.load(), normalizedFrequency);
        }
    };

    float m_alpha = 0.0f;
    float m_output = 0.0f;

    static float AlphaFromNatFreq(float cyclesPerSample) {
        cyclesPerSample = std::clamp(cyclesPerSample, 0.0f, kMaxCutoff);
        if (cyclesPerSample <= 0.0f) {
            return 0.0f;
        }
        return 1.0f - std::exp(-2.0f * std::numbers::pi_v<float> * cyclesPerSample);
    }

    static std::complex<float> TransferFunctionValue(float alpha, float normalizedFrequency) {
        const float cosOmega = DefaultDspMath::Cos2Pi(normalizedFrequency);
        const float sinOmega = DefaultDspMath::Sin2Pi(normalizedFrequency);
        const float a1 = 1.0f - alpha;
        const std::complex<float> numerator(alpha, 0.0f);
        const std::complex<float> denominator(1.0f - a1 * cosOmega, a1 * sinOmega);
        return numerator / denominator;
    }

    void SetAlphaFromNatFreq(float cyclesPerSample) {
        m_alpha = AlphaFromNatFreq(cyclesPerSample);
    }

    float Process(const Input& input) {
        SetAlphaFromNatFreq(input.cutoff);
        m_output = m_alpha * input.value + (1.0f - m_alpha) * m_output;
        return m_output;
    }

    void PopulateUIState(UIState& state) const {
        state.alpha.store(m_alpha);
    }
};

struct OnePoleHighPass {
    static constexpr float kMaxCutoff = 0.499f;

    struct Input {
        float value = 0.0f;
        float cutoff = 0.0f;
    };

    struct UIState : TransferFunction {
        std::atomic<float> alpha{0.0f};

        float FrequencyResponse(float normalizedFrequency) const override {
            return std::abs(OnePoleHighPass::TransferFunctionValue(alpha.load(), normalizedFrequency));
        }

        std::complex<float> TransferFunctionValue(float normalizedFrequency) const override {
            return OnePoleHighPass::TransferFunctionValue(alpha.load(), normalizedFrequency);
        }
    };

    float m_alpha = 0.0f;
    float m_output = 0.0f;
    float m_prevInput = 0.0f;

    static float AlphaFromNatFreq(float cyclesPerSample) {
        cyclesPerSample = std::clamp(cyclesPerSample, 0.0f, kMaxCutoff);
        if (cyclesPerSample <= 0.0f) {
            return 1.0f;
        }
        return std::exp(-2.0f * std::numbers::pi_v<float> * cyclesPerSample);
    }

    static std::complex<float> TransferFunctionValue(float alpha, float normalizedFrequency) {
        const float cosOmega = DefaultDspMath::Cos2Pi(normalizedFrequency);
        const float sinOmega = DefaultDspMath::Sin2Pi(normalizedFrequency);
        const std::complex<float> numerator(alpha * (1.0f - cosOmega), alpha * sinOmega);
        const std::complex<float> denominator(1.0f - alpha * cosOmega, alpha * sinOmega);
        return numerator / denominator;
    }

    void SetAlphaFromNatFreq(float cyclesPerSample) {
        m_alpha = AlphaFromNatFreq(cyclesPerSample);
    }

    float Process(const Input& input) {
        SetAlphaFromNatFreq(input.cutoff);
        m_output = m_alpha * (m_output + input.value - m_prevInput);
        m_prevInput = input.value;
        return m_output;
    }

    void PopulateUIState(UIState& state) const {
        state.alpha.store(m_alpha);
    }
};

template<bool Normalize = false>
struct TanhSaturator {
    struct Input {
        float value = 0.0f;
        float gain = 1.0f;
    };

    float m_inputGain = 1.0f;
    float m_tanhGain = RawApprox(1.0f);
    float m_output = 0.0f;

    static float RawApprox(float x) {
        const float x2 = x * x;
        return x * (27.0f + x2) / (27.0f + 9.0f * x2);
    }

    static float Tanh(float x) {
        return std::clamp(RawApprox(x), -1.0f, 1.0f);
    }

    void SetInputGain(float gain) {
        m_inputGain = gain;
        m_tanhGain = Tanh(gain);
    }

    float Process(const Input& input) {
        SetInputGain(input.gain);
        const float output = Tanh(input.value * m_inputGain);
        m_output = Normalize && std::abs(m_tanhGain) > 1.0e-6f ? output / m_tanhGain : output;
        return m_output;
    }
};

} // namespace synth
