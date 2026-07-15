#pragma once

#include "synth/DspMath.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <stdexcept>

namespace synth {

struct RandomTimingConfig {
    double muSeconds = 0.0;
    double sigmaSeconds = 0.0;
    double internalSigmaHz = 0.0;
};

namespace detail {

inline void ValidateRandomTimingConfig(
    double sampleRate,
    const RandomTimingConfig& config) {
    if (!std::isfinite(sampleRate) || sampleRate <= 0.0) {
        throw std::invalid_argument("random LFO sample rate must be finite and positive");
    }
    if (!std::isfinite(config.muSeconds)) {
        throw std::invalid_argument("random LFO center-time mean must be finite");
    }
    if (!std::isfinite(config.sigmaSeconds) || config.sigmaSeconds < 0.0) {
        throw std::invalid_argument("random LFO center-time sigma must be finite and nonnegative");
    }
    if (!std::isfinite(config.internalSigmaHz) || config.internalSigmaHz < 0.0) {
        throw std::invalid_argument("random LFO internal rate sigma must be finite and nonnegative");
    }
}

} // namespace detail

template<std::size_t N, class DrawSource>
std::array<double, N> SampleCorrelatedIncrements(
    double sampleRate,
    const RandomTimingConfig& config,
    DrawSource& draws) {
    detail::ValidateRandomTimingConfig(sampleRate, config);

    const double sampledCenterSeconds = draws.Normal(config.muSeconds, config.sigmaSeconds);
    if (!std::isfinite(sampledCenterSeconds)) {
        throw std::invalid_argument("random LFO center-time draw must be finite");
    }

    const double centerSeconds = std::max(1.0 / sampleRate, std::abs(sampledCenterSeconds));
    const double centerRateHz = 1.0 / centerSeconds;
    const double epsilonIncrement = 1.0 / (sampleRate * 3600.0);

    std::array<double, N> increments{};
    for (std::size_t voice = 0; voice < N; ++voice) {
        const double sampledRateHz = draws.Normal(centerRateHz, config.internalSigmaHz);
        if (!std::isfinite(sampledRateHz)) {
            throw std::invalid_argument("random LFO voice-rate draw must be finite");
        }
        increments[voice] = std::max(epsilonIncrement, std::abs(sampledRateHz) / sampleRate);
    }
    return increments;
}

} // namespace synth
