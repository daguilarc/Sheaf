#pragma once

#include <algorithm>
#include <cassert>
#include <cmath>

namespace synth {

class AdsrProcessor {
public:
    enum class State {
        Idle,
        Attack,
        Decay,
        Sustain,
        Release,
    };

    struct Input {
        double attackIncrement = 0.0;
        double decayIncrement = 0.0;
        float sustain = 0.0f;
        double releaseIncrement = 0.0;
        bool gate = false;
    };

    float Process(const Input& input) noexcept {
        assert(std::isfinite(input.attackIncrement) && input.attackIncrement >= 0.0);
        assert(std::isfinite(input.decayIncrement) && input.decayIncrement >= 0.0);
        assert(std::isfinite(input.sustain) && input.sustain >= 0.0f && input.sustain <= 1.0f);
        assert(std::isfinite(input.releaseIncrement) && input.releaseIncrement >= 0.0);

        const bool rising = input.gate && !previousGate_;
        const bool falling = !input.gate && previousGate_;
        previousGate_ = input.gate;
        if (rising) {
            BeginStage(State::Attack);
        } else if (falling) {
            BeginStage(State::Release);
        }

        switch (state_) {
        case State::Idle:
            output_ = 0.0f;
            break;
        case State::Attack:
            progress_ = Advance(progress_, input.attackIncrement);
            output_ = Interpolate(stageSource_, 1.0f, progress_);
            if (progress_ >= 1.0) {
                output_ = 1.0f;
                state_ = State::Decay;
                progress_ = 0.0;
            }
            break;
        case State::Decay:
            progress_ = Advance(progress_, input.decayIncrement);
            output_ = Interpolate(1.0f, input.sustain, progress_);
            if (progress_ >= 1.0) {
                output_ = input.sustain;
                state_ = State::Sustain;
                progress_ = 0.0;
            }
            break;
        case State::Sustain:
            output_ = input.sustain;
            break;
        case State::Release:
            progress_ = Advance(progress_, input.releaseIncrement);
            output_ = Interpolate(stageSource_, 0.0f, progress_);
            if (progress_ >= 1.0) {
                output_ = 0.0f;
                state_ = State::Idle;
                progress_ = 0.0;
            }
            break;
        }
        return output_;
    }

    State GetState() const noexcept { return state_; }
    float Output() const noexcept { return output_; }

private:
    void BeginStage(State state) noexcept {
        state_ = state;
        progress_ = 0.0;
        stageSource_ = output_;
    }

    static double Advance(double progress, double increment) noexcept {
        return std::min(1.0, progress + increment);
    }

    static float Interpolate(float source, float target, double progress) noexcept {
        return source + (target - source) * static_cast<float>(progress);
    }

    State state_ = State::Idle;
    double progress_ = 0.0;
    float stageSource_ = 0.0f;
    float output_ = 0.0f;
    bool previousGate_ = false;
};

} // namespace synth
