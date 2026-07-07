#pragma once

#include "synth/DspWavetable.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <numbers>
#include <vector>

namespace synth {

template<std::size_t Bits>
struct SpectralModel {
    using Buffer = BasicWavetable<Bits>;
    using DFT = DiscreteFourierTransform<Bits>;

    static constexpr std::size_t kTableSize = Buffer::kTableSize;
    static constexpr std::size_t kMaxComponents = DFT::kMaxComponents;
    static constexpr std::size_t kMaxAtoms = 8192;
    static constexpr std::size_t kNumSyntheticHarmonics = 6;
    static constexpr std::size_t kHopDenom = 4;
    static constexpr std::size_t kHopSize = kTableSize / kHopDenom;
    static constexpr float kDeathMagnitude = 1.0e-5f;
    static constexpr float kMergeGainThreshold = 1.0e-3f;

    struct Input {
        float m_gainThreshold = 0.001f;
        std::size_t m_numAtoms = 64;
        float m_slewUpAlpha = 1.0f;
        float m_slewDownAlpha = 1.0f;
        float m_omegaPortamentoAlpha = 1.0f;
        float m_omegaDensity = 1.0f / static_cast<float>(kTableSize);
        bool m_useSyntheticHarmonics = false;
        std::array<float, kNumSyntheticHarmonics> m_syntheticHarmonics{};
    };

    struct AnalysisAtom {
        float m_analysisOmega = 0.0f;
        float m_analysisMagnitude = 0.0f;
        float m_analysisPhase = 0.0f;
        bool m_isSynthetic = false;

        AnalysisAtom() = default;

        AnalysisAtom(float analysisOmega, float analysisMagnitude, float analysisPhase, bool isSynthetic)
            : m_analysisOmega(analysisOmega)
            , m_analysisMagnitude(analysisMagnitude)
            , m_analysisPhase(analysisPhase)
            , m_isSynthetic(isSynthetic) {}

        static bool CmpReverseMagnitude(const AnalysisAtom& a, const AnalysisAtom& b) {
            return b.m_analysisMagnitude < a.m_analysisMagnitude;
        }

        static bool CmpOmega(const AnalysisAtom& a, const AnalysisAtom& b) {
            return a.m_analysisOmega < b.m_analysisOmega;
        }

        static bool CmpOmegaFloat(const AnalysisAtom& a, float omega) {
            return a.m_analysisOmega < omega;
        }

        static float PreferredMatchTheta(const AnalysisAtom& candidate, float targetOmega, float omegaDensity) {
            const float distance = std::abs(candidate.m_analysisOmega - targetOmega);
            if (omegaDensity <= 0.0f) {
                return distance <= 0.0f ? candidate.m_analysisMagnitude : 0.0f;
            }

            const float distanceWeight = std::max(0.0f, 1.0f - distance / omegaDensity);
            return candidate.m_analysisMagnitude * distanceWeight;
        }

        static bool IsPreferred(
            const AnalysisAtom& candidate,
            const AnalysisAtom& current,
            float targetOmega,
            float omegaDensity) {
            if (candidate.m_isSynthetic != current.m_isSynthetic) {
                return !candidate.m_isSynthetic;
            }

            const float candidateTheta = PreferredMatchTheta(candidate, targetOmega, omegaDensity);
            const float currentTheta = PreferredMatchTheta(current, targetOmega, omegaDensity);
            if (currentTheta != candidateTheta) {
                return currentTheta < candidateTheta;
            }

            if (current.m_analysisMagnitude != candidate.m_analysisMagnitude) {
                return current.m_analysisMagnitude < candidate.m_analysisMagnitude;
            }

            const float candidateDistance = std::abs(candidate.m_analysisOmega - targetOmega);
            const float currentDistance = std::abs(current.m_analysisOmega - targetOmega);
            return candidateDistance < currentDistance;
        }
    };

    struct Atom : public AnalysisAtom {
        float m_synthesisOmega = 0.0f;
        float m_synthesisMagnitude = 0.0f;
        double m_synthesisPhase = 0.0;

        Atom() = default;

        Atom(const AnalysisAtom& analysisAtom, float synthesisMagnitude)
            : AnalysisAtom(analysisAtom)
            , m_synthesisOmega(analysisAtom.m_analysisOmega)
            , m_synthesisMagnitude(synthesisMagnitude)
            , m_synthesisPhase(0.0) {}

        void Merge(const AnalysisAtom& analysisAtom, const Input& input) {
            m_synthesisMagnitude = BiDirectionalSlew(
                m_synthesisMagnitude,
                analysisAtom.m_analysisMagnitude,
                input.m_slewUpAlpha,
                input.m_slewDownAlpha);
            this->m_analysisOmega = analysisAtom.m_analysisOmega;
            this->m_analysisMagnitude = analysisAtom.m_analysisMagnitude;
            this->m_analysisPhase = analysisAtom.m_analysisPhase;
            this->m_isSynthetic = analysisAtom.m_isSynthetic;
            m_synthesisOmega = Slew(m_synthesisOmega, analysisAtom.m_analysisOmega, input.m_omegaPortamentoAlpha);
        }

        void MergeNoMatch(const Input& input) {
            m_synthesisMagnitude = Slew(m_synthesisMagnitude, 0.0f, input.m_slewDownAlpha);
            this->m_analysisMagnitude = 0.0f;
            m_synthesisOmega = Slew(m_synthesisOmega, this->m_analysisOmega, input.m_omegaPortamentoAlpha);
        }

        void UpdatePhase() {
            m_synthesisPhase += static_cast<double>(kHopSize) * static_cast<double>(m_synthesisOmega);
        }

        static bool CmpReverseMagnitude(const Atom& a, const Atom& b) {
            return AnalysisAtom::CmpReverseMagnitude(a, b);
        }

        static bool CmpReverseSynthesisMagnitude(const Atom& a, const Atom& b) {
            const bool aFinite = std::isfinite(a.m_synthesisMagnitude);
            const bool bFinite = std::isfinite(b.m_synthesisMagnitude);
            if (aFinite != bFinite) {
                return aFinite;
            }

            return b.m_synthesisMagnitude < a.m_synthesisMagnitude;
        }
    };

    struct ResidualModel {
        static constexpr std::size_t kNumBuckets = DFT::kMaxComponents;

        struct Input {
            std::array<float, kNumBuckets> m_analysisResidualMagnitudes{};
        };

        std::array<float, kNumBuckets> m_magnitudes{};
        std::array<float, kNumBuckets> m_frequencies{};
        std::array<float, kNumBuckets> m_logFrequencies{};

        ResidualModel() {
            for (std::size_t i = 0; i < kNumBuckets; ++i) {
                m_frequencies[i] = static_cast<float>(i) / static_cast<float>(kTableSize);
                const std::size_t parameterBucket = std::max<std::size_t>(i, 1);
                const float parameterFrequency = static_cast<float>(parameterBucket) / static_cast<float>(kTableSize);
                m_logFrequencies[i] = std::log2(parameterFrequency);
            }
        }

        float GetEnvelope(std::size_t bucketIndex) const {
            if (kNumBuckets <= bucketIndex) {
                return 0.0f;
            }
            return m_magnitudes[bucketIndex];
        }

        void Process(const SpectralModel::Input& spectralInput, const Input& residualInput) {
            for (std::size_t i = 0; i < kNumBuckets; ++i) {
                m_magnitudes[i] = BiDirectionalSlew(
                    m_magnitudes[i],
                    residualInput.m_analysisResidualMagnitudes[i],
                    spectralInput.m_slewUpAlpha,
                    spectralInput.m_slewDownAlpha);
            }
        }
    };

    std::vector<Atom> m_atoms;
    ResidualModel m_residualModel;

    void ExtractAtoms(const Buffer& buffer, Input& input) {
        DFT dft;
        dft.Transform(buffer);
        std::vector<AnalysisAtom> analysisAtoms;
        ExtractAnalysisAtoms(dft, analysisAtoms, input);
        TrackAnalysisAtoms(analysisAtoms, input);
    }

    void ExtractAtomsAndResidual(const Buffer& buffer, Input& input) {
        DFT dft;
        dft.Transform(buffer);
        std::vector<AnalysisAtom> analysisAtoms;
        ExtractAnalysisAtoms(dft, analysisAtoms, input);

        typename ResidualModel::Input residualInput;
        for (const AnalysisAtom& analysisAtom : analysisAtoms) {
            if (!analysisAtom.m_isSynthetic) {
                dft.WriteWindowedPartial(
                    analysisAtom.m_analysisPhase + 0.5f,
                    analysisAtom.m_analysisMagnitude * 2.0f,
                    analysisAtom.m_analysisOmega);
            }
        }

        for (std::size_t i = 0; i < ResidualModel::kNumBuckets; ++i) {
            residualInput.m_analysisResidualMagnitudes[i] = std::abs(dft.m_components[i]);
        }

        m_residualModel.Process(input, residualInput);
        TrackAnalysisAtoms(analysisAtoms, input);
    }

private:
    static float Slew(float current, float target, float alpha) {
        const float clampedAlpha = std::clamp(alpha, 0.0f, 1.0f);
        return current + (target - current) * clampedAlpha;
    }

    static float BiDirectionalSlew(float current, float target, float upAlpha, float downAlpha) {
        return Slew(current, target, current < target ? upAlpha : downAlpha);
    }

    void ExtractAnalysisAtoms(DFT& dft, std::vector<AnalysisAtom>& analysisAtoms, const Input& input) const {
        analysisAtoms.clear();
        std::array<float, kMaxComponents> magnitudes{};
        for (std::size_t i = 1; i < kMaxComponents; ++i) {
            magnitudes[i] = std::abs(dft.m_components[i]);
        }

        constexpr float kLogEps = 1.0e-20f;
        for (int k = static_cast<int>(kMaxComponents) - 2; 2 <= k; --k) {
            const float magnitude = magnitudes[static_cast<std::size_t>(k)];
            if (!(magnitudes[static_cast<std::size_t>(k - 1)] < magnitude
                    && magnitudes[static_cast<std::size_t>(k + 1)] < magnitude
                    && input.m_gainThreshold <= magnitude)) {
                continue;
            }

            const float magLo = std::max(magnitudes[static_cast<std::size_t>(k - 1)], kLogEps);
            const float magMid = std::max(magnitude, kLogEps);
            const float magHi = std::max(magnitudes[static_cast<std::size_t>(k + 1)], kLogEps);
            const float alpha = std::log(magLo);
            const float beta = std::log(magMid);
            const float gamma = std::log(magHi);
            const float denom = alpha - 2.0f * beta + gamma;

            float p = 0.0f;
            float peakMagnitude = magnitude;
            if (1.0e-10f < std::abs(denom)) {
                p = 0.5f * (alpha - gamma) / denom;
                peakMagnitude = std::exp(beta - 0.25f * (alpha - gamma) * p);
            }

            const float peakOmega = (static_cast<float>(k) + p) / static_cast<float>(kTableSize);
            const int phaseBin = std::max(
                1,
                std::min(static_cast<int>(kMaxComponents) - 1, static_cast<int>(std::round(static_cast<float>(k) + p))));
            const float peakPhase = std::arg(dft.m_components[static_cast<std::size_t>(phaseBin)])
                / (2.0f * std::numbers::pi_v<float>);
            analysisAtoms.emplace_back(peakOmega, peakMagnitude, peakPhase, false);
        }

        const std::size_t numAnalysisAtoms = analysisAtoms.size();
        if (input.m_useSyntheticHarmonics) {
            for (std::size_t i = 0; i < numAnalysisAtoms; ++i) {
                const AnalysisAtom analysisAtom = analysisAtoms[i];
                for (std::size_t j = 0; j < kNumSyntheticHarmonics; ++j) {
                    if (kMaxAtoms <= analysisAtoms.size()) {
                        break;
                    }

                    const float harmonicOmega = analysisAtom.m_analysisOmega * static_cast<float>(j + 2);
                    if (harmonicOmega >= 0.5f) {
                        continue;
                    }

                    const float harmonicMagnitude = analysisAtom.m_analysisMagnitude * input.m_syntheticHarmonics[j];
                    if (input.m_gainThreshold <= harmonicMagnitude) {
                        analysisAtoms.emplace_back(harmonicOmega, harmonicMagnitude, analysisAtom.m_analysisPhase, true);
                    }
                }
            }
        }

        if (input.m_numAtoms < analysisAtoms.size()) {
            std::ranges::sort(analysisAtoms, AnalysisAtom::CmpReverseMagnitude);
            analysisAtoms.resize(input.m_numAtoms);
        }

        std::ranges::sort(analysisAtoms, AnalysisAtom::CmpOmega);
    }

    void SearchAndMerge(std::vector<AnalysisAtom>& analysisAtoms, Atom& atom, const Input& input) {
        const float targetOmega = atom.m_analysisOmega;
        const float omegaDensity = input.m_omegaDensity;
        const float lowerOmega = targetOmega - omegaDensity;
        const float upperOmega = targetOmega + omegaDensity;
        auto it = std::lower_bound(analysisAtoms.begin(), analysisAtoms.end(), lowerOmega, AnalysisAtom::CmpOmegaFloat);
        auto bestIt = analysisAtoms.end();
        for (; it != analysisAtoms.end(); ++it) {
            if (upperOmega < it->m_analysisOmega) {
                break;
            }

            if (bestIt == analysisAtoms.end()
                || AnalysisAtom::IsPreferred(*it, *bestIt, targetOmega, omegaDensity)) {
                bestIt = it;
            }
        }

        if (bestIt == analysisAtoms.end()
            || (atom.m_synthesisMagnitude > 0.0f
                && bestIt->m_analysisMagnitude / atom.m_synthesisMagnitude < kMergeGainThreshold)) {
            atom.MergeNoMatch(input);
            return;
        }

        atom.Merge(*bestIt, input);
        for (auto forIt = bestIt; forIt != analysisAtoms.end(); ++forIt) {
            if (upperOmega < forIt->m_analysisOmega) {
                break;
            }
            forIt->m_analysisMagnitude = -1.0f;
        }

        for (auto revIt = bestIt; revIt != analysisAtoms.begin();) {
            --revIt;
            if (revIt->m_analysisOmega < lowerOmega) {
                break;
            }
            revIt->m_analysisMagnitude = -1.0f;
        }
    }

    void TrackAnalysisAtoms(std::vector<AnalysisAtom>& analysisAtoms, const Input& input) {
        std::ranges::sort(m_atoms, Atom::CmpReverseMagnitude);
        for (Atom& atom : m_atoms) {
            SearchAndMerge(analysisAtoms, atom, input);
            atom.UpdatePhase();
        }

        for (const AnalysisAtom& analysisAtom : analysisAtoms) {
            if (kDeathMagnitude <= analysisAtom.m_analysisMagnitude) {
                const float initMagnitude = std::max(
                    Slew(0.0f, analysisAtom.m_analysisMagnitude, input.m_slewUpAlpha),
                    kDeathMagnitude);
                m_atoms.emplace_back(analysisAtom, initMagnitude);
            }
        }

        std::ranges::sort(m_atoms, Atom::CmpReverseSynthesisMagnitude);
        if (input.m_numAtoms < m_atoms.size()) {
            m_atoms.resize(input.m_numAtoms);
        }

        while (!m_atoms.empty()
            && (!std::isfinite(m_atoms.back().m_synthesisMagnitude)
                || m_atoms.back().m_synthesisMagnitude < kDeathMagnitude)) {
            m_atoms.pop_back();
        }
    }
};

} // namespace synth
