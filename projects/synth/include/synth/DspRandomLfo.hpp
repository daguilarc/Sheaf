#pragma once

#include "synth/Color.hpp"
#include "synth/DspMath.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <random>
#include <stdexcept>
#include <utility>

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

struct VoiceInput {
    double waitingIncrement = 0.0;
    double movingIncrement = 0.0;
    float shape = 0.0f;
};

class GangedRandomLfoVoice {
public:
    enum class State {
        Waiting,
        Moving,
        Done,
    };

    void Reset(float newTarget) {
        m_state = State::Waiting;
        m_currentStateProgress = 0.0;
        m_source = m_target;
        m_target = newTarget;
        m_output = m_source;
    }

    float Process(const VoiceInput& input) {
        switch (m_state) {
        case State::Waiting:
            m_currentStateProgress += input.waitingIncrement;
            if (m_currentStateProgress >= 1.0) {
                m_state = State::Moving;
                m_currentStateProgress = 0.0;
            }
            m_output = m_source;
            break;
        case State::Moving:
            m_currentStateProgress += input.movingIncrement;
            m_output = ShapedInterpolate(
                m_source,
                m_target,
                input.shape,
                m_currentStateProgress);
            if (m_currentStateProgress >= 1.0) {
                m_state = State::Done;
                m_output = m_target;
            }
            break;
        case State::Done:
            m_output = m_target;
            break;
        }
        return m_output;
    }

    State GetState() const { return m_state; }
    double CurrentStateProgress() const { return m_currentStateProgress; }
    float Source() const { return m_source; }
    float Target() const { return m_target; }
    float Output() const { return m_output; }

private:
    State m_state = State::Done;
    double m_currentStateProgress = 0.0;
    float m_source = 0.0f;
    float m_target = 0.0f;
    float m_output = 0.0f;
};

struct GangedRandomLfoVoiceSnapshot {
    GangedRandomLfoVoice::State state = GangedRandomLfoVoice::State::Done;
    double currentStateProgress = 0.0;
    float source = 0.0f;
    float target = 0.0f;
    float output = 0.0f;
    float shape = 0.0f;
    double waitingIncrement = 0.0;
    double movingIncrement = 0.0;
    Color color = Color::Grey;
};

template<std::size_t VoiceCount>
struct GangedRandomLfoSnapshot {
    double sampleRate = 0.0;
    double roundElapsedSamples = 0.0;
    std::array<GangedRandomLfoVoiceSnapshot, VoiceCount> voices{};
};

struct GangedRandomLfoAtomicColor {
    void Store(Color color, std::memory_order order = std::memory_order_relaxed) {
        value.store(color.Packed(), order);
    }

    Color Load(std::memory_order order = std::memory_order_relaxed) const {
        return Color::FromPacked(value.load(order));
    }

    std::atomic<std::uint32_t> value{Color::Grey.Packed()};
};

static_assert(
    std::atomic<double>::is_always_lock_free,
    "ganged random LFO UI snapshots require lock-free double atomics");

struct GangedRandomLfoVoiceUiState {
    std::atomic<GangedRandomLfoVoice::State> state{GangedRandomLfoVoice::State::Done};
    std::atomic<double> currentStateProgress{0.0};
    std::atomic<float> source{0.0f};
    std::atomic<float> target{0.0f};
    std::atomic<float> output{0.0f};
    std::atomic<float> shape{0.0f};
    std::atomic<double> waitingIncrement{0.0};
    std::atomic<double> movingIncrement{0.0};
    GangedRandomLfoAtomicColor color;
};

template<std::size_t VoiceCount>
struct GangedRandomLfoUiState {
    GangedRandomLfoUiState() = default;
    GangedRandomLfoUiState(const GangedRandomLfoUiState&) = delete;
    GangedRandomLfoUiState& operator=(const GangedRandomLfoUiState&) = delete;

    bool ReadSnapshot(
        GangedRandomLfoSnapshot<VoiceCount>& snapshot,
        unsigned maxRetries = 4) const;

    std::atomic<std::uint32_t> revision{0};
    std::atomic<double> sampleRate{0.0};
    std::atomic<double> roundElapsedSamples{0.0};
    std::array<GangedRandomLfoVoiceUiState, VoiceCount> voices{};
};

namespace detail {

template<std::size_t VoiceCount, class AfterCopy>
bool ReadGangedRandomLfoSnapshot(
    const GangedRandomLfoUiState<VoiceCount>& state,
    GangedRandomLfoSnapshot<VoiceCount>& snapshot,
    unsigned maxRetries,
    AfterCopy&& afterCopy) {
    for (unsigned attempt = 0; attempt < maxRetries; ++attempt) {
        const std::uint32_t startRevision = state.revision.load(std::memory_order_acquire);
        if ((startRevision & 1u) != 0u) {
            continue;
        }

        GangedRandomLfoSnapshot<VoiceCount> candidate;
        candidate.sampleRate = state.sampleRate.load(std::memory_order_relaxed);
        candidate.roundElapsedSamples = state.roundElapsedSamples.load(std::memory_order_relaxed);
        for (std::size_t voice = 0; voice < VoiceCount; ++voice) {
            const auto& source = state.voices[voice];
            auto& destination = candidate.voices[voice];
            destination.state = source.state.load(std::memory_order_relaxed);
            destination.currentStateProgress =
                source.currentStateProgress.load(std::memory_order_relaxed);
            destination.source = source.source.load(std::memory_order_relaxed);
            destination.target = source.target.load(std::memory_order_relaxed);
            destination.output = source.output.load(std::memory_order_relaxed);
            destination.shape = source.shape.load(std::memory_order_relaxed);
            destination.waitingIncrement = source.waitingIncrement.load(std::memory_order_relaxed);
            destination.movingIncrement = source.movingIncrement.load(std::memory_order_relaxed);
            destination.color = source.color.Load(std::memory_order_relaxed);
        }

        std::forward<AfterCopy>(afterCopy)(attempt);
        const std::uint32_t endRevision = state.revision.load(std::memory_order_acquire);
        if (startRevision == endRevision && (endRevision & 1u) == 0u) {
            snapshot = candidate;
            return true;
        }
    }
    return false;
}

} // namespace detail

template<std::size_t VoiceCount>
bool GangedRandomLfoUiState<VoiceCount>::ReadSnapshot(
    GangedRandomLfoSnapshot<VoiceCount>& snapshot,
    unsigned maxRetries) const {
    return detail::ReadGangedRandomLfoSnapshot(
        *this,
        snapshot,
        maxRetries,
        [](unsigned) {});
}

struct GangedRandomLfoInput {
    RandomTimingConfig waiting;
    RandomTimingConfig moving;
    float targetInternalSigma = 0.0f;
};

class DefaultRandomDrawSource {
public:
    DefaultRandomDrawSource()
        : DefaultRandomDrawSource(std::random_device{}()) {}

    explicit DefaultRandomDrawSource(std::uint32_t seed)
        : m_engine(seed) {}

    double Normal(double mean, double sigma) {
        if (sigma == 0.0) {
            return mean;
        }
        using Parameters = std::normal_distribution<double>::param_type;
        return m_normal(m_engine, Parameters{mean, sigma});
    }

    float Uniform01() {
        return m_uniform(m_engine);
    }

private:
    std::mt19937 m_engine;
    std::normal_distribution<double> m_normal{0.0, 1.0};
    std::uniform_real_distribution<float> m_uniform{0.0f, 1.0f};
};

template<std::size_t VoiceCount, class DrawSource = DefaultRandomDrawSource>
class GangedRandomLfoProcessor {
    static_assert(VoiceCount > 0, "a ganged random LFO requires at least one voice");

public:
    GangedRandomLfoProcessor() = default;

    explicit GangedRandomLfoProcessor(std::uint32_t seed)
        : m_draws(seed) {}

    explicit GangedRandomLfoProcessor(DrawSource draws)
        : m_draws(std::move(draws)) {}

    void Prepare(double sampleRate) {
        if (!std::isfinite(sampleRate) || sampleRate <= 0.0) {
            throw std::invalid_argument("random LFO sample rate must be finite and positive");
        }
        m_sampleRate = sampleRate;

        // Initialize the guarded lookup table before the audio thread can enter
        // a moving state and call ShapedInterpolate for the first time.
        (void)DefaultDspMath::Cos2Pi(0.0f);
    }

    void Process(const GangedRandomLfoInput& input) {
        ValidateInput(input);

        bool allDone = true;
        for (std::size_t voice = 0; voice < VoiceCount; ++voice) {
            m_voices[voice].Process(m_voiceInputs[voice]);
            allDone = allDone && m_voices[voice].GetState() == GangedRandomLfoVoice::State::Done;
        }

        if (allDone) {
            SampleAndResetRound(input);
        } else {
            m_roundElapsedSamples += 1.0;
        }
    }

    float Output(std::size_t voice) const {
        if (voice >= VoiceCount) {
            throw std::out_of_range("random LFO voice index out of range");
        }
        return m_voices[voice].Output();
    }

    double SampleRate() const { return m_sampleRate; }
    double RoundElapsedSamples() const { return m_roundElapsedSamples; }

    void SetVoiceColor(std::size_t voice, Color color) {
        if (voice >= VoiceCount) {
            throw std::out_of_range("random LFO voice index out of range");
        }
        m_voiceColors[voice].Store(color, std::memory_order_relaxed);
    }

    Color VoiceColor(std::size_t voice) const {
        if (voice >= VoiceCount) {
            throw std::out_of_range("random LFO voice index out of range");
        }
        return m_voiceColors[voice].Load(std::memory_order_relaxed);
    }

    void PublishUiState() {
        const std::uint32_t startRevision =
            m_uiState.revision.fetch_add(1, std::memory_order_acq_rel);
        m_uiState.sampleRate.store(m_sampleRate, std::memory_order_relaxed);
        m_uiState.roundElapsedSamples.store(m_roundElapsedSamples, std::memory_order_relaxed);
        for (std::size_t voice = 0; voice < VoiceCount; ++voice) {
            const auto& source = m_voices[voice];
            const auto& input = m_voiceInputs[voice];
            auto& destination = m_uiState.voices[voice];
            destination.state.store(source.GetState(), std::memory_order_relaxed);
            destination.currentStateProgress.store(
                source.CurrentStateProgress(),
                std::memory_order_relaxed);
            destination.source.store(source.Source(), std::memory_order_relaxed);
            destination.target.store(source.Target(), std::memory_order_relaxed);
            destination.output.store(source.Output(), std::memory_order_relaxed);
            destination.shape.store(input.shape, std::memory_order_relaxed);
            destination.waitingIncrement.store(input.waitingIncrement, std::memory_order_relaxed);
            destination.movingIncrement.store(input.movingIncrement, std::memory_order_relaxed);
            destination.color.Store(m_voiceColors[voice].Load(std::memory_order_relaxed));
        }
        m_uiState.revision.store(startRevision + 2u, std::memory_order_release);
    }

    bool ReadSnapshot(
        GangedRandomLfoSnapshot<VoiceCount>& snapshot,
        unsigned maxRetries = 4) const {
        return m_uiState.ReadSnapshot(snapshot, maxRetries);
    }

    const GangedRandomLfoUiState<VoiceCount>& UiState() const { return m_uiState; }

    const std::array<GangedRandomLfoVoice, VoiceCount>& Voices() const {
        return m_voices;
    }

    const std::array<VoiceInput, VoiceCount>& VoiceInputs() const {
        return m_voiceInputs;
    }

    DrawSource& RandomSource() { return m_draws; }
    const DrawSource& RandomSource() const { return m_draws; }

private:
    void ValidateInput(const GangedRandomLfoInput& input) const {
        detail::ValidateRandomTimingConfig(m_sampleRate, input.waiting);
        detail::ValidateRandomTimingConfig(m_sampleRate, input.moving);
        if (!std::isfinite(input.targetInternalSigma) || input.targetInternalSigma < 0.0f) {
            throw std::invalid_argument("random LFO target sigma must be finite and nonnegative");
        }
    }

    static void ValidateUniformDraw(float draw) {
        if (!std::isfinite(draw) || draw < 0.0f || draw > 1.0f) {
            throw std::invalid_argument("random LFO uniform draw must be finite and within [0, 1]");
        }
    }

    void SampleAndResetRound(const GangedRandomLfoInput& input) {
        const auto waitingIncrements = SampleCorrelatedIncrements<VoiceCount>(
            m_sampleRate,
            input.waiting,
            m_draws);
        const auto movingIncrements = SampleCorrelatedIncrements<VoiceCount>(
            m_sampleRate,
            input.moving,
            m_draws);

        const float targetCenter = m_draws.Uniform01();
        ValidateUniformDraw(targetCenter);

        std::array<float, VoiceCount> targets{};
        for (std::size_t voice = 0; voice < VoiceCount; ++voice) {
            const double sampledTarget = m_draws.Normal(
                static_cast<double>(targetCenter),
                static_cast<double>(input.targetInternalSigma));
            if (!std::isfinite(sampledTarget)) {
                throw std::invalid_argument("random LFO target draw must be finite");
            }
            targets[voice] = static_cast<float>(std::clamp(sampledTarget, 0.0, 1.0));
        }

        std::array<float, VoiceCount> shapes{};
        for (std::size_t voice = 0; voice < VoiceCount; ++voice) {
            shapes[voice] = m_draws.Uniform01();
            ValidateUniformDraw(shapes[voice]);
        }

        for (std::size_t voice = 0; voice < VoiceCount; ++voice) {
            m_voiceInputs[voice] = {
                .waitingIncrement = waitingIncrements[voice],
                .movingIncrement = movingIncrements[voice],
                .shape = shapes[voice],
            };
            m_voices[voice].Reset(targets[voice]);
        }
        m_roundElapsedSamples = 0.0;
    }

    std::array<GangedRandomLfoVoice, VoiceCount> m_voices{};
    std::array<VoiceInput, VoiceCount> m_voiceInputs{};
    std::array<GangedRandomLfoAtomicColor, VoiceCount> m_voiceColors{};
    GangedRandomLfoUiState<VoiceCount> m_uiState;
    DrawSource m_draws{};
    double m_sampleRate = 0.0;
    double m_roundElapsedSamples = 0.0;
};

} // namespace synth
