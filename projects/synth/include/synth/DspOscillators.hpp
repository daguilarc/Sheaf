#pragma once

#include "synth/DspScope.hpp"
#include "synth/DspWavetable.hpp"
#include "synth/ParameterModulation.hpp"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>

namespace synth {

struct Incrementer {
    struct Input {
        double freq = 0.0;
    };

    double m_phase = 0.0;
    double m_wrappedPhase = 0.0;
    double m_topOffset = 0.0;
    bool m_top = false;

    double Process(const Input& input) {
        const double previous = m_phase;
        m_phase += input.freq;
        m_wrappedPhase = WrappedPhase();
        m_top = std::floor(previous) != std::floor(m_phase);
        m_topOffset = 0.0;
        if (m_top && input.freq > 0.0) {
            const double crossing = std::floor(previous) + 1.0;
            m_topOffset = std::clamp((crossing - previous) / input.freq, 0.0, 1.0);
        }
        return m_wrappedPhase;
    }

    double WrappedPhase() const {
        return m_phase - std::floor(m_phase);
    }
};

struct LFOShape {
    struct Input {
        float inPhase = 0.0f;
        float shape = 0.5f;
        float phaseOffset = 0.0f;
        float skew = 0.5f;
        float exponent = 1.0f;
    };

    static float WrapUnit(float x) {
        return x - std::floor(x);
    }

    static float Tri(float x) {
        const float phase = std::clamp(x, 0.0f, 1.0f);
        return 1.0f - std::abs(phase * 2.0f - 1.0f);
    }

    static float PD(float skew, float x) {
        const float phase = WrapUnit(x);
        const float breakpoint = std::clamp(skew, 0.000001f, 0.999999f);
        if (phase < breakpoint) {
            return std::clamp(0.5f * phase / breakpoint, 0.0f, 1.0f);
        }
        return std::clamp(0.5f + 0.5f * (phase - breakpoint) / (1.0f - breakpoint), 0.0f, 1.0f);
    }

    static float Shape(float shape, float x) {
        const float s = std::clamp(shape, 0.0f, 1.0f);
        const float base = std::clamp(x, 0.0f, 1.0f);
        if (s < 0.5f) {
            constexpr float kPi = 3.14159265358979323846f;
            const float linear = 2.0f * s;
            const float curved = 1.0f - linear;
            return std::clamp(std::sin(kPi * base * 0.5f) * curved + base * linear, 0.0f, 1.0f);
        }
        if (s >= 1.0f) {
            if (base < 0.5f) {
                return 0.0f;
            }
            if (base > 0.5f) {
                return 1.0f;
            }
            return 0.5f;
        }
        return std::clamp(base / (2.0f - 2.0f * s) - 1.0f / (4.0f - 4.0f * s) + 0.5f, 0.0f, 1.0f);
    }

    static float Process(const Input& input) {
        const float wrapped = WrapUnit(input.inPhase + input.phaseOffset);
        const float distorted = PD(input.skew, wrapped);
        const float triangle = Tri(distorted);
        const float shaped = Shape(input.shape, triangle);
        const float powered = std::pow(shaped, input.exponent);
        if (!std::isfinite(powered)) {
            return powered > 0.0f ? 1.0f : 0.0f;
        }
        return std::clamp(powered, 0.0f, 1.0f);
    }
};

template<std::size_t Bits>
const MorphingWavetable<Bits>& GetDefaultMorphingWavetableForBits() {
    static const MorphingWavetable<Bits> table = MakeDefaultMorphingWavetable<Bits>();
    return table;
}

template<std::size_t Bits = 12>
class WavetableVco {
public:
    struct Input {
        double freq = 0.0;
        float phaseOffset = 0.0f;
        float wavetablePosition = 0.0f;
        float maxFreq = 0.5f;
    };

    struct UIState {
        std::atomic<bool> connected{false};
        std::atomic<const ScopeWriter*> scope{nullptr};
        std::atomic<std::size_t> scopeChannel{0};
        AtomicColor scopeColor;
    };

    explicit WavetableVco(const MorphingWavetable<Bits>& wavetable = GetDefaultMorphingWavetableForBits<Bits>())
        : m_wavetable(&wavetable) {}

    void SetWavetable(const MorphingWavetable<Bits>& wavetable) {
        m_wavetable = &wavetable;
    }

    void SetScopeWriterHolder(ScopeWriterHolder* holder) {
        m_scopeWriterHolder = holder;
    }

    void SetScopeColor(Color scopeColor) {
        m_scopeColor = scopeColor;
    }

    float Process(const Input& input) {
        Incrementer::Input increment{.freq = input.freq};
        m_incrementer.Process(increment);
        const double phase = m_incrementer.m_wrappedPhase + static_cast<double>(input.phaseOffset);
        const float wrapped = static_cast<float>(phase - std::floor(phase));
        m_output = m_wavetable ? m_wavetable->Evaluate(
            wrapped,
            static_cast<float>(input.freq),
            input.maxFreq,
            input.wavetablePosition) : 0.0f;
        m_top = m_incrementer.m_top;

        if (m_scopeWriterHolder) {
            m_scopeWriterHolder->Write(m_output);
            if (m_top) {
                const double markerOffset = m_incrementer.m_topOffset - 1.0;
                if (markerOffset >= 0.0 || m_scopeWriterHolder->Writer()->CurrentIndex() > 0) {
                    m_scopeWriterHolder->RecordStart(0, markerOffset);
                }
            }
        }
        return m_output;
    }

    void PopulateUIState(UIState& state) const {
        state.scopeColor.Store(m_scopeColor);
        const bool connected = m_scopeWriterHolder && m_scopeWriterHolder->Writer();
        state.connected.store(connected);
        state.scope.store(connected ? m_scopeWriterHolder->Writer() : nullptr);
        state.scopeChannel.store(connected ? m_scopeWriterHolder->FlatChan() : 0);
    }

    Incrementer m_incrementer;
    float m_output = 0.0f;
    bool m_top = false;

private:
    Color m_scopeColor = Color::Cyan;
    const MorphingWavetable<Bits>* m_wavetable = nullptr;
    ScopeWriterHolder* m_scopeWriterHolder = nullptr;
};

using DefaultWavetableVco = WavetableVco<12>;

class BasicLFOProcessor {
public:
    struct Input {
        double frequency = 0.0;
        LFOShape::Input shape;
    };

    struct UIState {
        std::atomic<bool> connected{false};
        std::atomic<const ScopeWriter*> scope{nullptr};
        std::atomic<std::size_t> scopeChannel{0};
        AtomicColor scopeColor;
    };

    void SetScopeWriterHolder(ScopeWriterHolder* holder) {
        m_scopeWriterHolder = holder;
    }

    void SetScopeColor(Color scopeColor) {
        m_scopeColor = scopeColor;
    }

    float Process(const Input& input) {
        Incrementer::Input increment{.freq = input.frequency};
        const double phase = m_incrementer.Process(increment);
        LFOShape::Input shapeInput = input.shape;
        shapeInput.inPhase = static_cast<float>(phase);
        m_output = LFOShape::Process(shapeInput);
        m_top = m_incrementer.m_top;

        if (m_scopeWriterHolder && m_scopeWriterHolder->Writer()) {
            m_scopeWriterHolder->Write(m_output);
            if (m_top) {
                const double markerOffset = m_incrementer.m_topOffset - 1.0;
                if (markerOffset >= 0.0 || m_scopeWriterHolder->Writer()->CurrentIndex() > 0) {
                    m_scopeWriterHolder->RecordStart(0, markerOffset);
                }
            }
        }
        return m_output;
    }

    void PopulateUIState(UIState& state) const {
        state.scopeColor.Store(m_scopeColor);
        const bool connected = m_scopeWriterHolder && m_scopeWriterHolder->Writer();
        state.connected.store(connected);
        state.scope.store(connected ? m_scopeWriterHolder->Writer() : nullptr);
        state.scopeChannel.store(connected ? m_scopeWriterHolder->FlatChan() : 0);
    }

    Incrementer m_incrementer;
    float m_output = 0.0f;
    bool m_top = false;

private:
    Color m_scopeColor = Color::Cyan;
    ScopeWriterHolder* m_scopeWriterHolder = nullptr;
};

} // namespace synth
