#pragma once

#include "synth/DspNumbers.hpp"
#include "synth/DspWavetable.hpp"

#include <array>
#include <complex>
#include <cstddef>

namespace synth {

template<std::size_t Bits>
struct Ola {
    static constexpr std::size_t kHopDenom = 4;
    static constexpr std::size_t kTableSize = BasicWavetable<Bits>::kTableSize;
    static constexpr std::size_t kHopSize = kTableSize / kHopDenom;
    static constexpr std::size_t kMaxComponents = DiscreteFourierTransform<Bits>::kMaxComponents;

    std::size_t m_index = 0;
    BasicWavetable<Bits> m_buffer{};

    float Process() {
        const float result = m_buffer.m_table[m_index];
        m_buffer.m_table[m_index] = 0.0f;
        ++m_index;
        if (m_index == kTableSize) {
            m_index = 0;
        }
        return result;
    }

    void Write(const DiscreteFourierTransform<Bits>& dft) {
        BasicWavetable<Bits> buffer;
        dft.InverseTransform(buffer, kMaxComponents);
        for (std::size_t i = 0; i < kTableSize; ++i) {
            const std::size_t index = (m_index + i) % kTableSize;
            m_buffer.m_table[index] += buffer.m_table[i];
        }
    }
};

template<std::size_t Bits, std::size_t Channels>
struct NaryDftFrame {
    std::array<DiscreteFourierTransform<Bits>, Channels> m_dfts{};

    void Init() {
        for (auto& dft : m_dfts) {
            dft.Init();
        }
    }

    void AddComponent(
        std::size_t componentIndex,
        std::complex<float> value,
        const NaryNumber<float, Channels>& distribution) {
        if (componentIndex == 0 || DiscreteFourierTransform<Bits>::kMaxComponents <= componentIndex) {
            return;
        }

        for (std::size_t i = 0; i < Channels; ++i) {
            m_dfts[i].m_components[componentIndex] += value * distribution[i];
        }
    }

    void WriteWindowedPartial(
        float magnitude,
        float phase,
        float exactFrequency,
        const NaryNumber<float, Channels>& distribution) {
        for (std::size_t i = 0; i < Channels; ++i) {
            m_dfts[i].WriteWindowedPartial(phase, magnitude * distribution[i], exactFrequency);
        }
    }
};

template<std::size_t Bits, std::size_t Channels>
struct NaryOla {
    std::array<Ola<Bits>, Channels> m_olas{};

    NaryNumber<float, Channels> Process() {
        NaryNumber<float, Channels> result;
        for (std::size_t i = 0; i < Channels; ++i) {
            result[i] = m_olas[i].Process();
        }
        return result;
    }

    void Write(const NaryDftFrame<Bits, Channels>& dft) {
        for (std::size_t i = 0; i < Channels; ++i) {
            m_olas[i].Write(dft.m_dfts[i]);
        }
    }
};

} // namespace synth
