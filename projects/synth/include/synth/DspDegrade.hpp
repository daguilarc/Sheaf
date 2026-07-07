#pragma once

#include <algorithm>
#include <cmath>

namespace synth {

struct BitCrusher {
    struct Input {
        float value = 0.0f;
        float amount = 0.0f;
    };

    float amount = 0.0f;
    float step = 0.0f;

    static float FiniteOr(float value, float fallback) {
        return std::isfinite(value) ? value : fallback;
    }

    void SetAmount(float nextAmount) {
        nextAmount = std::clamp(FiniteOr(nextAmount, 0.0f), 0.0f, 1.0f);
        if (nextAmount == amount) {
            return;
        }

        static constexpr float kMaxBits = 16.0f;
        const float effectiveBits = (1.0f + kMaxBits) * std::pow(1.0f - nextAmount, 3.5f) - 1.0f;
        step = std::pow(2.0f, -effectiveBits);
        amount = nextAmount;
    }

    float Process(const Input& input) {
        SetAmount(input.amount);
        const float value = std::clamp(FiniteOr(input.value, 0.0f), -1.0f, 1.0f);
        if (amount == 0.0f) {
            return value;
        }
        return std::round((value + 1.0f) / step) * step - 1.0f;
    }
};

struct SampleRateReducer {
    struct Input {
        float value = 0.0f;
        float freq = 1.0f;
    };

    float freq = 1.0f;
    float phase = 0.0f;
    float output = 0.0f;

    static float FiniteOr(float value, float fallback) {
        return std::isfinite(value) ? value : fallback;
    }

    float Process(const Input& input) {
        freq = std::clamp(FiniteOr(input.freq, 1.0f), 0.0f, 1.0f);
        const float value = FiniteOr(input.value, 0.0f);

        if (freq >= 1.0f) {
            output = value;
            return value;
        }

        phase += freq;
        if (phase >= 1.0f) {
            phase -= std::floor(phase);
            output = value;
        }

        return output;
    }
};

} // namespace synth
