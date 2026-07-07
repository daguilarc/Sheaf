#pragma once

#include "synth/DspOla.hpp"
#include "synth/DspWavetable.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <cstddef>
#include <numbers>

namespace synth {

template<std::size_t Bits>
struct OlaResynthesizer {
    using Buffer = BasicWavetable<Bits>;
    using DFT = DiscreteFourierTransform<Bits>;

    static constexpr std::size_t kHopDenom = Ola<Bits>::kHopDenom;
    static constexpr std::size_t kTableSize = Buffer::kTableSize;
    static constexpr std::size_t kHopSize = Ola<Bits>::kHopSize;
    static constexpr std::size_t kMaxComponents = DFT::kMaxComponents;
    static constexpr std::size_t kNumOscillators = 3;

    struct Input {
        float m_pitchRatio = 1.0f;
        float m_shiftPitchRatio = 1.0f;
        float m_shiftPitchFade = 0.0f;
        float m_unisonDetune = 1.0f;
        float m_unisonGain = 0.0f;
        float m_slewUpAlpha = 1.0f;
        float m_slewDownAlpha = 1.0f;
        bool m_useSpectralDistortion = false;
        float m_spectralThreshold = 1.0f;
        float m_spectralQuiet = 0.0f;
        float m_spectralLoud = 1.0f;
        float m_spectralShiftAmount = 0.0f;
        float m_spectralShiftPitchRatio = 1.0f;
    };

    std::array<float, kMaxComponents> m_analysisMagnitudes{};
    std::array<float, kMaxComponents> m_prevAnalysisMagnitudes{};
    std::array<float, kMaxComponents> m_analysisPhases{};
    std::array<float, kMaxComponents> m_prevAnalysisPhases{};
    std::array<float, kMaxComponents> m_omegaInstantaneous{};
    std::array<float, kMaxComponents> m_synthesisMagnitudes{};
    std::array<std::array<double, kMaxComponents>, kNumOscillators> m_synthesisPhases{};
    DFT m_lastSynthesisDft{};
    Ola<Bits> m_ola{};

    void PrimeAnalysis(const Buffer& previousFrame) {
        DFT dft;
        dft.Transform(previousFrame);
        for (std::size_t bin = 1; bin < kMaxComponents; ++bin) {
            m_prevAnalysisMagnitudes[bin] = std::abs(dft.m_components[bin]);
            m_prevAnalysisPhases[bin] = ComponentPhase(dft.m_components[bin]);
        }
    }

    void ProcessHop(const Buffer& currentFrame, const Input& input) {
        DFT analysisDft;
        analysisDft.Transform(currentFrame);
        AnalyzeFrame(analysisDft, input);

        m_lastSynthesisDft.Init();
        const float pitchFade = std::clamp(input.m_shiftPitchFade, 0.0f, 1.0f);
        const float shiftedGain = pitchFade * pitchFade * pitchFade * pitchFade;
        const float directGain = 1.0f - shiftedGain;

        for (std::size_t osc = 0; osc < kNumOscillators; ++osc) {
            const float detune = UnisonDetune(osc, input);
            const float gain = UnisonGain(osc, input);
            UpdateSynthesisPhases(osc, detune);
            SynthesizePitch(m_lastSynthesisDft, osc, input.m_pitchRatio, gain * directGain);
            SynthesizePitch(m_lastSynthesisDft, osc, input.m_shiftPitchRatio, gain * shiftedGain);
        }

        if (input.m_useSpectralDistortion) {
            ApplySpectralDistortion(m_lastSynthesisDft, input);
        }

        m_ola.Write(m_lastSynthesisDft);
        PrimeFromCurrentAnalysis();
    }

    float Process() {
        return m_ola.Process();
    }

private:
    static float ComponentPhase(const std::complex<float>& component) {
        return std::arg(component) / (2.0f * std::numbers::pi_v<float>);
    }

    static float PrincArg(float arg) {
        arg -= std::floor(arg);
        if (0.5f < arg) {
            arg -= 1.0f;
        }
        return arg;
    }

    static float Slew(float current, float target, float alpha) {
        const float clampedAlpha = std::clamp(alpha, 0.0f, 1.0f);
        return current + (target - current) * clampedAlpha;
    }

    static float BiDirectionalSlew(float current, float target, float upAlpha, float downAlpha) {
        return Slew(current, target, current < target ? upAlpha : downAlpha);
    }

    static float OmegaBin(std::size_t bin) {
        return static_cast<float>(bin) / static_cast<float>(kTableSize);
    }

    void AnalyzeFrame(const DFT& dft, const Input& input) {
        for (std::size_t bin = 1; bin < kMaxComponents; ++bin) {
            m_analysisMagnitudes[bin] = std::abs(dft.m_components[bin]);
            m_analysisPhases[bin] = ComponentPhase(dft.m_components[bin]);
            m_synthesisMagnitudes[bin] = BiDirectionalSlew(
                m_synthesisMagnitudes[bin],
                m_analysisMagnitudes[bin],
                input.m_slewUpAlpha,
                input.m_slewDownAlpha);

            const float expectedDelta = OmegaBin(bin) * static_cast<float>(kHopSize);
            float phaseDelta = m_analysisPhases[bin] - m_prevAnalysisPhases[bin];
            phaseDelta = PrincArg(phaseDelta - expectedDelta);
            m_omegaInstantaneous[bin] = OmegaBin(bin) + phaseDelta / static_cast<float>(kHopSize);
            if (!std::isfinite(m_omegaInstantaneous[bin])) {
                m_omegaInstantaneous[bin] = OmegaBin(bin);
            }
        }
    }

    void PrimeFromCurrentAnalysis() {
        for (std::size_t bin = 1; bin < kMaxComponents; ++bin) {
            m_prevAnalysisMagnitudes[bin] = m_analysisMagnitudes[bin];
            m_prevAnalysisPhases[bin] = m_analysisPhases[bin];
        }
    }

    static float UnisonGain(std::size_t osc, const Input& input) {
        const float unisonGain = std::clamp(input.m_unisonGain, 0.0f, 1.0f);
        if (osc == 0) {
            return std::sqrt(std::max(0.0f, 1.0f - 2.0f * unisonGain * unisonGain / 3.0f));
        }
        return unisonGain / std::sqrt(3.0f);
    }

    static float UnisonDetune(std::size_t osc, const Input& input) {
        const float detune = std::max(1.0e-6f, input.m_unisonDetune);
        if (osc == 1) {
            return detune;
        }
        if (osc == 2) {
            return 1.0f / detune;
        }
        return 1.0f;
    }

    void UpdateSynthesisPhases(std::size_t osc, float detune) {
        for (std::size_t bin = 1; bin < kMaxComponents; ++bin) {
            m_synthesisPhases[osc][bin] += static_cast<double>(kHopSize)
                * static_cast<double>(m_omegaInstantaneous[bin])
                * static_cast<double>(detune);
        }
    }

    static void AddShiftedComponent(DFT& dft, double exactBin, std::complex<float> component) {
        if (component == std::complex<float>{0.0f, 0.0f}) {
            return;
        }

        const int lo = static_cast<int>(std::floor(exactBin));
        const int hi = lo + 1;
        const float hiFrac = static_cast<float>(exactBin - static_cast<double>(lo));
        const float loFrac = 1.0f - hiFrac;

        if (0 < lo && lo < static_cast<int>(kMaxComponents)) {
            dft.m_components[static_cast<std::size_t>(lo)] += component * loFrac;
        }
        if (0 < hi && hi < static_cast<int>(kMaxComponents)) {
            dft.m_components[static_cast<std::size_t>(hi)] += component * hiFrac;
        }
    }

    void SynthesizePitch(DFT& dft, std::size_t osc, float pitchRatio, float gain) {
        const float ratio = std::max(0.0f, pitchRatio);
        if (gain == 0.0f || ratio == 0.0f) {
            return;
        }

        for (std::size_t bin = 1; bin < kMaxComponents; ++bin) {
            const float magnitude = m_synthesisMagnitudes[bin] * gain;
            if (magnitude <= 0.0f || !std::isfinite(magnitude)) {
                continue;
            }

            const double exactBin = static_cast<double>(bin) * static_cast<double>(ratio);
            const float phase = static_cast<float>(m_synthesisPhases[osc][bin] * static_cast<double>(ratio));
            AddShiftedComponent(dft, exactBin, DspMath<Bits>::Polar2Pi(magnitude, phase));
        }
    }

    static void ApplySpectralDistortion(DFT& dft, const Input& input) {
        const float threshold = std::max(input.m_spectralThreshold, 1.0e-12f);
        const float quietLimit = std::max(0.0f, input.m_spectralQuiet) * threshold;
        const float loudLimit = std::max(0.0f, input.m_spectralLoud) * threshold;
        const float shiftAmount = std::clamp(input.m_spectralShiftAmount, 0.0f, 1.0f);
        const float shiftRatio = std::max(0.0f, input.m_spectralShiftPitchRatio);

        std::array<std::complex<float>, kMaxComponents> shifted{};
        for (std::size_t bin = 1; bin < kMaxComponents; ++bin) {
            const float rms = std::norm(dft.m_components[bin]);
            if (!std::isfinite(rms)) {
                dft.m_components[bin] = {0.0f, 0.0f};
                continue;
            }

            if (rms < quietLimit) {
                dft.m_components[bin] *= 0.5f;
            } else if (loudLimit < rms && loudLimit > 0.0f) {
                const float factor = std::sqrt(loudLimit / rms);
                const std::complex<float> removed = dft.m_components[bin] * (1.0f - factor) * shiftAmount;
                dft.m_components[bin] *= factor;
                if (shiftRatio > 0.0f) {
                    const double exactBin = static_cast<double>(bin) * static_cast<double>(shiftRatio);
                    const int lo = static_cast<int>(std::floor(exactBin));
                    const int hi = lo + 1;
                    const float hiFrac = static_cast<float>(exactBin - static_cast<double>(lo));
                    const float loFrac = 1.0f - hiFrac;
                    if (0 < lo && lo < static_cast<int>(kMaxComponents)) {
                        shifted[static_cast<std::size_t>(lo)] += removed * loFrac;
                    }
                    if (0 < hi && hi < static_cast<int>(kMaxComponents)) {
                        shifted[static_cast<std::size_t>(hi)] += removed * hiFrac;
                    }
                }
            }
        }

        for (std::size_t bin = 1; bin < kMaxComponents; ++bin) {
            dft.m_components[bin] += shifted[bin];
        }
    }
};

} // namespace synth
