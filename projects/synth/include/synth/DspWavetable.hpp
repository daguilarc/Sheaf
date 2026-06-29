#pragma once

#include "synth/DspMath.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <cstddef>
#include <functional>
#include <memory>
#include <stdexcept>
#include <vector>

namespace synth {

template<std::size_t Bits>
struct BasicWavetable {
    static constexpr std::size_t kTableSize = std::size_t{1} << Bits;

    std::array<float, kTableSize> m_table{};

    float Evaluate(float phase) const {
        phase -= std::floor(phase);
        const float pos = phase * static_cast<float>(kTableSize);
        const auto index = static_cast<std::size_t>(std::floor(pos)) % kTableSize;
        const float frac = pos - std::floor(pos);
        return m_table[index] * (1.0f - frac) + m_table[(index + 1) % kTableSize] * frac;
    }

    void Write(std::size_t index, float value) {
        if (index >= kTableSize) {
            throw std::out_of_range("wavetable write index out of range");
        }
        m_table[index] = value;
    }

    float Amplitude() const {
        float amplitude = 0.0f;
        for (float value : m_table) {
            amplitude = std::max(amplitude, std::abs(value));
        }
        return amplitude;
    }

    float RMSAmplitude() const {
        double sum = 0.0;
        for (float value : m_table) {
            sum += static_cast<double>(value) * static_cast<double>(value);
        }
        return static_cast<float>(std::sqrt(sum / static_cast<double>(kTableSize)));
    }

    void NormalizeAmplitude() {
        const float amplitude = Amplitude();
        if (amplitude <= 1.0e-8f) {
            std::ranges::fill(m_table, 0.0f);
            return;
        }
        for (float& value : m_table) {
            value /= amplitude;
        }
    }

    float StartValue() const { return m_table[0]; }
    float CenterValue() const { return m_table[kTableSize / 2]; }

    static BasicWavetable Generate(const std::function<float(float)>& fn) {
        BasicWavetable table;
        for (std::size_t i = 0; i < kTableSize; ++i) {
            table.m_table[i] = fn(static_cast<float>(i) / static_cast<float>(kTableSize));
        }
        return table;
    }

    static BasicWavetable Sine() {
        return Generate([](float phase) { return DspMath<Bits>::Sin2Pi(phase); });
    }

    static BasicWavetable Triangle() {
        return Generate([](float phase) {
            return 4.0f * std::abs(phase - std::floor(phase + 0.5f)) - 1.0f;
        });
    }

    static BasicWavetable Saw() {
        return Generate([](float phase) { return 1.0f - 2.0f * phase; });
    }

    static BasicWavetable Square() {
        return Generate([](float phase) { return phase < 0.5f ? 1.0f : -1.0f; });
    }
};

template<std::size_t Bits>
struct DiscreteFourierTransform {
    static constexpr std::size_t kTableSize = BasicWavetable<Bits>::kTableSize;
    static constexpr std::size_t kMaxComponents = kTableSize / 2;
    static constexpr int kPartialKernelRadius = 8;

    std::array<std::complex<float>, kMaxComponents> m_components{};

    void Init() {
        std::ranges::fill(m_components, std::complex<float>{0.0f, 0.0f});
    }

    void FFT(std::array<std::complex<float>, kTableSize>& data, bool inverse) const {
        for (std::size_t i = 1, j = 0; i < kTableSize; ++i) {
            std::size_t bit = kTableSize >> 1;
            for (; (j & bit) != 0; bit >>= 1) {
                j ^= bit;
            }
            j ^= bit;
            if (i < j) {
                std::swap(data[i], data[j]);
            }
        }

        for (std::size_t len = 2; len <= kTableSize; len <<= 1) {
            const std::size_t halfLen = len >> 1;
            for (std::size_t i = 0; i < kTableSize; i += len) {
                for (std::size_t j = 0; j < halfLen; ++j) {
                    const std::size_t rootIndex = inverse
                        ? j * kTableSize / len
                        : (kTableSize - j * kTableSize / len) % kTableSize;
                    const auto t = DspMath<Bits>::RootOfUnityByIndex(rootIndex) * data[i + j + halfLen];
                    const auto u = data[i + j];
                    data[i + j] = u + t;
                    data[i + j + halfLen] = u - t;
                }
            }
        }
    }

    void Transform(const BasicWavetable<Bits>& wavetable) {
        std::array<std::complex<float>, kTableSize> workspace{};
        for (std::size_t i = 0; i < kTableSize; ++i) {
            workspace[i] = {wavetable.m_table[i], 0.0f};
        }
        FFT(workspace, false);
        for (std::size_t k = 0; k < kMaxComponents; ++k) {
            m_components[k] = workspace[k] / static_cast<float>(kTableSize);
        }
    }

    void InverseTransform(BasicWavetable<Bits>& wavetable, std::size_t maxComponents) const {
        std::array<std::complex<float>, kTableSize> workspace{};
        const std::size_t components = std::min(maxComponents + 1, kMaxComponents);
        for (std::size_t k = 0; k < components; ++k) {
            workspace[k] = m_components[k];
            if (k > 0 && k < kTableSize / 2) {
                workspace[kTableSize - k] = std::conj(workspace[k]);
            }
        }
        FFT(workspace, true);
        for (std::size_t i = 0; i < kTableSize; ++i) {
            wavetable.m_table[i] = workspace[i].real();
        }
    }

    void WriteWindowedPartial(float phase, float magnitude, float exactFrequency) {
        const float exactBin = exactFrequency * static_cast<float>(kTableSize);
        const int centerBin = static_cast<int>(std::floor(exactBin));
        const int firstBin = std::max(1, centerBin - kPartialKernelRadius);
        const int lastBin = std::min(static_cast<int>(kMaxComponents) - 1, centerBin + kPartialKernelRadius);
        const std::complex<float> phaseFactor(
            magnitude * DspMath<Bits>::Cos2Pi(phase),
            magnitude * DspMath<Bits>::Sin2Pi(phase));

        for (int k = firstBin; k <= lastBin; ++k) {
            const float offset = exactBin - static_cast<float>(k);
            m_components[static_cast<std::size_t>(k)] += phaseFactor * DspMath<Bits>::HannKernel(offset);
        }
    }
};

template<std::size_t Bits>
struct AdaptiveWavetable {
    static constexpr std::size_t kMaxLevels = 25;
    static constexpr float kLevelsBase = 1.3f;
    static constexpr std::size_t kLookupSize = DiscreteFourierTransform<Bits>::kMaxComponents + 1;

    struct EvalSite {
        int lower = -1;
        int upper = -1;
        float wayThrough = 0.0f;
    };

    BasicWavetable<Bits> m_waveTable;
    DiscreteFourierTransform<Bits> m_dft;
    std::array<BasicWavetable<Bits>, kMaxLevels> m_levels{};
    std::size_t m_levelsReady = 0;

    static std::array<std::size_t, kMaxLevels> MakeLevelComponents() {
        std::array<std::size_t, kMaxLevels> result{};
        float components = 3.0f;
        result[0] = 1;
        for (std::size_t i = 1; i < kMaxLevels; ++i) {
            result[i] = std::min<std::size_t>(
                static_cast<std::size_t>(components),
                DiscreteFourierTransform<Bits>::kMaxComponents);
            components = std::max(components * kLevelsBase, std::floor(components) + 1.0f);
        }
        return result;
    }

    static std::array<std::size_t, kLookupSize> MakeComponentLookup() {
        std::array<std::size_t, kLookupSize> result{};
        const auto levels = MakeLevelComponents();
        for (std::size_t maxComponent = 0; maxComponent < kLookupSize; ++maxComponent) {
            std::size_t level = 0;
            while (level < kMaxLevels - 1 && levels[level + 1] < maxComponent) {
                ++level;
            }
            result[maxComponent] = level;
        }
        return result;
    }

    inline static std::array<std::size_t, kMaxLevels> s_levelComponents = MakeLevelComponents();
    inline static std::array<std::size_t, kLookupSize> s_componentLookup = MakeComponentLookup();

    void Generate() {
        m_dft.Transform(m_waveTable);
        GenerateLevels();
    }

    void GenerateLevels() {
        for (std::size_t i = 0; i < kMaxLevels; ++i) {
            m_dft.InverseTransform(m_levels[i], s_levelComponents[i]);
            m_levels[i].NormalizeAmplitude();
        }
        m_levelsReady = kMaxLevels;
    }

    EvalSite EvaluateSite(float freq, float maxFreq) const {
        if (freq <= 0.0f || maxFreq < freq) {
            return {};
        }
        const float maxComponents = maxFreq / freq;
        const auto maxComponentInt = std::min<std::size_t>(
            static_cast<std::size_t>(maxComponents),
            DiscreteFourierTransform<Bits>::kMaxComponents);
        std::size_t level = s_componentLookup[maxComponentInt];
        if (level < kMaxLevels - 1 && static_cast<float>(s_levelComponents[level + 1]) <= maxComponents) {
            ++level;
        }
        if (level == kMaxLevels - 1) {
            return {.lower = static_cast<int>(level), .upper = -1, .wayThrough = 0.0f};
        }
        if (maxComponents >= static_cast<float>(s_levelComponents[level])
            && maxComponents < static_cast<float>(s_levelComponents[level + 1])) {
            const float wayThrough = (maxComponents - static_cast<float>(s_levelComponents[level]))
                / static_cast<float>(s_levelComponents[level + 1] - s_levelComponents[level]);
            return {.lower = static_cast<int>(level), .upper = static_cast<int>(level + 1), .wayThrough = wayThrough};
        }
        return {.lower = static_cast<int>(level), .upper = -1, .wayThrough = 0.0f};
    }

    float Evaluate(float phase, const EvalSite& site) const {
        if (site.lower < 0) {
            return 0.0f;
        }
        if (site.upper < 0) {
            return m_levels[static_cast<std::size_t>(site.lower)].Evaluate(phase);
        }
        const float lower = m_levels[static_cast<std::size_t>(site.lower)].Evaluate(phase);
        const float upper = m_levels[static_cast<std::size_t>(site.upper)].Evaluate(phase);
        return lower * (1.0f - site.wayThrough) + upper * site.wayThrough;
    }

    float Evaluate(float phase, float freq, float maxFreq) const {
        return Evaluate(phase, EvaluateSite(freq, maxFreq));
    }
};

template<std::size_t Bits>
struct MorphingWavetable {
    std::vector<AdaptiveWavetable<Bits>> m_tables;

    std::size_t Size() const { return m_tables.size(); }

    void Add(AdaptiveWavetable<Bits> table) {
        m_tables.push_back(std::move(table));
    }

    float Evaluate(float phase, float freq, float maxFreq, float position) const {
        if (m_tables.empty()) {
            return 0.0f;
        }
        if (m_tables.size() == 1) {
            return m_tables.front().Evaluate(phase, freq, maxFreq);
        }

        position = std::clamp(position, 0.0f, 1.0f);
        const float scaled = position * static_cast<float>(m_tables.size() - 1);
        const auto leftIx = static_cast<std::size_t>(std::floor(scaled));
        const auto rightIx = std::min(leftIx + 1, m_tables.size() - 1);
        const float blend = scaled - std::floor(scaled);
        const float left = m_tables[leftIx].Evaluate(phase, freq, maxFreq);
        const float right = m_tables[rightIx].Evaluate(phase, freq, maxFreq);
        return left * (1.0f - blend) + right * blend;
    }
};

template<std::size_t Bits>
AdaptiveWavetable<Bits> MakeAdaptiveWavetable(BasicWavetable<Bits> table) {
    AdaptiveWavetable<Bits> adaptive;
    adaptive.m_waveTable = std::move(table);
    adaptive.Generate();
    return adaptive;
}

template<std::size_t Bits>
MorphingWavetable<Bits> MakeDefaultMorphingWavetable() {
    MorphingWavetable<Bits> morph;
    morph.Add(MakeAdaptiveWavetable(BasicWavetable<Bits>::Sine()));
    morph.Add(MakeAdaptiveWavetable(BasicWavetable<Bits>::Triangle()));
    morph.Add(MakeAdaptiveWavetable(BasicWavetable<Bits>::Saw()));
    morph.Add(MakeAdaptiveWavetable(BasicWavetable<Bits>::Square()));
    return morph;
}

using DefaultBasicWavetable = BasicWavetable<12>;
using DefaultAdaptiveWavetable = AdaptiveWavetable<12>;
using DefaultMorphingWavetable = MorphingWavetable<12>;

const DefaultMorphingWavetable& GetDefaultMorphingWavetable();

} // namespace synth
