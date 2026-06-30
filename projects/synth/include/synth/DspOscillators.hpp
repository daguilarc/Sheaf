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
        AtomicColor color;
    };

    explicit WavetableVco(const MorphingWavetable<Bits>& wavetable = GetDefaultMorphingWavetableForBits<Bits>())
        : m_wavetable(&wavetable) {}

    void SetWavetable(const MorphingWavetable<Bits>& wavetable) {
        m_wavetable = &wavetable;
    }

    void SetScopeWriterHolder(ScopeWriterHolder* holder) {
        m_scopeWriterHolder = holder;
    }

    void SetColor(Color color) {
        m_color = color;
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
        state.color.Store(m_color);
        const bool connected = m_scopeWriterHolder && m_scopeWriterHolder->Writer();
        state.connected.store(connected);
        state.scope.store(connected ? m_scopeWriterHolder->Writer() : nullptr);
        state.scopeChannel.store(connected ? m_scopeWriterHolder->FlatChan() : 0);
    }

    Incrementer m_incrementer;
    float m_output = 0.0f;
    bool m_top = false;
    Color m_color = Color::Cyan;

private:
    const MorphingWavetable<Bits>* m_wavetable = nullptr;
    ScopeWriterHolder* m_scopeWriterHolder = nullptr;
};

using DefaultWavetableVco = WavetableVco<12>;

} // namespace synth
