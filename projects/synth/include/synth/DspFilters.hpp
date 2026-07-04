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

struct ClassicStateVariableFilter {
    static constexpr float kMaxCutoff = 0.499f;

    struct Input {
        float value = 0.0f;
        float cutoff = 0.0f;
        float resonance = 1.0f;
        float blend = 0.0f;
    };

    struct UIState : TransferFunction {
        std::atomic<float> cutoff{0.0f};
        std::atomic<float> resonance{1.0f};
        std::atomic<float> blend{0.0f};

        float FrequencyResponse(float normalizedFrequency) const override {
            return std::abs(ClassicStateVariableFilter::TransferFunctionValue(
                cutoff.load(), resonance.load(), blend.load(), normalizedFrequency));
        }

        std::complex<float> TransferFunctionValue(float normalizedFrequency) const override {
            return ClassicStateVariableFilter::TransferFunctionValue(
                cutoff.load(), resonance.load(), blend.load(), normalizedFrequency);
        }
    };

    float m_low = 0.0f;
    float m_band = 0.0f;
    float m_high = 0.0f;
    float m_output = 0.0f;
    float m_cutoff = 0.0f;
    float m_resonance = 1.0f;
    float m_blend = 0.0f;

    static float ClampCutoff(float cutoff) {
        if (!std::isfinite(cutoff)) {
            return 0.0f;
        }
        return std::clamp(cutoff, 0.0f, kMaxCutoff);
    }

    static float ClampResonance(float resonance) {
        static constexpr float kMinResonance = 1.0e-4f;
        if (!std::isfinite(resonance)) {
            return 1.0f;
        }
        return std::max(resonance, kMinResonance);
    }

    static float ClampBlend(float blend) {
        if (!std::isfinite(blend)) {
            return 0.0f;
        }
        return std::clamp(blend, -1.0f, 1.0f);
    }

    static float LowBlendAmount(float blend) {
        return std::max(-ClampBlend(blend), 0.0f);
    }

    static float HighBlendAmount(float blend) {
        return std::max(ClampBlend(blend), 0.0f);
    }

    static float BandBlendAmount(float blend) {
        blend = ClampBlend(blend);
        return std::sqrt(std::max(0.0f, 1.0f - blend * blend));
    }

    static std::complex<float> TransferFunctionValue(
        float cutoff, float resonance, float blend, float normalizedFrequency) {
        cutoff = ClampCutoff(cutoff);
        resonance = ClampResonance(resonance);
        blend = ClampBlend(blend);
        normalizedFrequency = ClampCutoff(normalizedFrequency);

        const float lowAmount = LowBlendAmount(blend);
        const float highAmount = HighBlendAmount(blend);
        const float bandAmount = BandBlendAmount(blend);
        if (cutoff <= 0.0f) {
            return {highAmount, 0.0f};
        }
        if (normalizedFrequency <= 0.0f) {
            return {lowAmount, 0.0f};
        }

        const float damping = 1.0f / resonance;
        const float g = std::tan(std::numbers::pi_v<float> * cutoff);
        const float cosOmega = DefaultDspMath::Cos2Pi(normalizedFrequency);
        const float sinOmega = DefaultDspMath::Sin2Pi(normalizedFrequency);
        const std::complex<float> zInv(cosOmega, -sinOmega);
        const std::complex<float> integrator = g * (1.0f + zInv) / (1.0f - zInv);
        const std::complex<float> denominator = 1.0f + damping * integrator + integrator * integrator;
        const std::complex<float> low = integrator * integrator / denominator;
        const std::complex<float> band = integrator / denominator;
        const std::complex<float> high = 1.0f / denominator;
        return low * lowAmount + band * bandAmount + high * highAmount;
    }

    float Process(const Input& input) {
        m_cutoff = ClampCutoff(input.cutoff);
        m_resonance = ClampResonance(input.resonance);
        m_blend = ClampBlend(input.blend);

        const float g = std::tan(std::numbers::pi_v<float> * m_cutoff);
        const float damping = 1.0f / m_resonance;
        const float a1 = 1.0f / (1.0f + g * (g + damping));
        const float a2 = g * a1;
        const float a3 = g * a2;
        const float v3 = input.value - m_ic2eq;
        const float v1 = a1 * m_ic1eq + a2 * v3;
        const float v2 = m_ic2eq + a2 * m_ic1eq + a3 * v3;

        m_ic1eq = 2.0f * v1 - m_ic1eq;
        m_ic2eq = 2.0f * v2 - m_ic2eq;

        m_low = v2;
        m_band = v1;
        m_high = input.value - damping * v1 - v2;
        m_output = m_low * LowBlendAmount(m_blend)
            + m_band * BandBlendAmount(m_blend)
            + m_high * HighBlendAmount(m_blend);
        return m_output;
    }

    void PopulateUIState(UIState& state) const {
        state.cutoff.store(m_cutoff);
        state.resonance.store(m_resonance);
        state.blend.store(m_blend);
    }

private:
    float m_ic1eq = 0.0f;
    float m_ic2eq = 0.0f;
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
