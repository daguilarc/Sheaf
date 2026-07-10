#pragma once

// synth_dresden4::Dresden4Core — JUCE-free core graph for the Dresden 4
// patch-launchable synth app. The graph runs its oscillator/modulation loop at
// 4x the negotiated host sample rate, then decimates to the host block at the
// last output boundary.

#include "synth/AppContext.hpp"
#include "synth/DspBuffers.hpp"
#include "synth/DspScope.hpp"
#include "synth/Modules.hpp"
#include "synth/ParameterModulation.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <stdexcept>

namespace synth_dresden4 {

class Dresden4Core {
public:
    static constexpr std::size_t kOscillatorCount = 4;
    static constexpr std::size_t kOversampleFactor = 4;
    static constexpr std::size_t kScopeFrames = 6'553'600;
    static constexpr std::uint64_t kNoInternalSampleIndex = std::numeric_limits<std::uint64_t>::max();

    using VcoModule = synth::Dresden4VcoModule;
    using MatrixModuleType = synth::BipolarMatrixMixerModule<kOscillatorCount>;
    using Decimator = synth::FirDecimator<kOversampleFactor, 2, synth::kDresden4DecimatorTaps>;
    using OutputStage = synth::OversampledOutputStage<kOversampleFactor, 2, Decimator>;

    struct DebugCounterState {
        std::size_t hostFramesProcessed = 0;
        std::size_t internalSubframesProcessed = 0;
        std::uint64_t firstInternalSampleIndex = 0;
        std::uint64_t lastInternalSampleIndex = 0;
        std::uint64_t lastHostStartSample = 0;
        std::uint64_t lastMatrixInputInternalIndex = kNoInternalSampleIndex;
        std::uint64_t lastMatrixOutputPublicationInternalIndex = kNoInternalSampleIndex;
        std::uint64_t lastMatrixModulatorConsumptionInternalIndex = kNoInternalSampleIndex;
        std::uint64_t lastConsumedMatrixOutputPublicationInternalIndex = kNoInternalSampleIndex;
        std::array<float, kOscillatorCount> lastMatrixInputs{};
        std::array<float, kOscillatorCount> lastConsumedMatrixSources{};
    };

    static synth::RuntimeConfig Config() {
        synth::RuntimeConfig config;
        config.appName = "Dresden 4";
        config.numAudioInputs = 0;
        config.numAudioOutputs = 2;
        config.preferredSampleRate = 48000.0;
        config.preferredBlockSize = 256;
        config.uiWidth = 900;
        config.uiHeight = 560;
        config.uiFrameHz = 30;
        return config;
    }

    void Init(synth::AppContext* context) {
        if (context == nullptr || context->parameterManager == nullptr) {
            throw std::invalid_argument("Dresden 4 core requires a valid app context");
        }
        context_ = context;
        synth::ParameterManager& manager = *context_->parameterManager;

        stereoGroup_ = &manager.CreateGroup({
            .numVoices = 2,
            .numModulators = 0,
            .numScenes = 2,
            .maxParameters = 2,
            .voiceIndicatorColors = {synth::Color::Red, synth::Color::Red},
        });
        quadGroup_ = &manager.CreateGroup({
            .numVoices = 4,
            .numModulators = 1,
            .numScenes = 2,
            .maxParameters = 4,
            .voiceIndicatorColors = {synth::Color::Red, synth::Color::Red, synth::Color::Red, synth::Color::Red},
        });
        monoGroup_ = &manager.CreateGroup({
            .numVoices = 1,
            .numModulators = 0,
            .numScenes = 2,
            .maxParameters = 24,
            .voiceIndicatorColors = {synth::Color::Red},
        });

        dresdenModule_.RegisterParameters(manager, *stereoGroup_, *quadGroup_, *monoGroup_);
        matrixModule_.SetColor(synth::Color::Red);
        matrixModule_.RegisterParameters(manager, *monoGroup_, "Dresden 4 Matrix");
        RegisterMatrixModulationSources();

        dresdenBank_ = &manager.CreateBank();
        dresdenBank_->SetColor(synth::Color::Red);
        matrixBank_ = &manager.CreateBank();
        matrixBank_->SetColor(synth::Color::Red);
        slot_ = &manager.CreateBankSlot();
        for (synth::PhysicalEncoderId encoderId = 0; encoderId < 16; ++encoderId) {
            slot_->AddPhysicalEncoder(encoderId);
        }
        slot_->SelectBank(dresdenBank_);
        dresdenModule_.RegisterToBank(*dresdenBank_);
        slot_->SelectBank(matrixBank_);
        matrixModule_.RegisterToBank(*matrixBank_, 0);
        slot_->SelectBank(dresdenBank_);

        manager.SetSceneEndpoints(0, 1);

        for (std::size_t oscIx = 0; oscIx < kOscillatorCount; ++oscIx) {
            scopeHolders_[oscIx] = scopeWriter_.ReserveChans(1);
            dresdenModule_.SetScopeWriterHolder(oscIx, &scopeHolders_[oscIx]);
            dresdenModule_.SetColor(oscIx, synth::Color::Red);
        }

        ResetMatrixState();
    }

    void PrepareToPlay(double sampleRate, int /*blockSize*/) {
        if (!(std::isfinite(sampleRate) && sampleRate > 0.0)) {
            throw std::invalid_argument("Dresden 4 host sample rate must be finite and positive");
        }
        hostSampleRate_ = sampleRate;
        internalSampleRate_ = sampleRate * static_cast<double>(kOversampleFactor);

        const synth::ParameterProcessingTiming timing{
            .processLiteAlpha = synth::ConvertOnePoleAlpha(synth::kDefaultProcessLiteAlpha, 48000.0,
                                                           internalSampleRate_),
            .targetComputeIntervalSamples =
                synth::ConvertSampleInterval(synth::kDefaultTargetComputeIntervalSamples, 48000.0,
                                             internalSampleRate_),
            .uiDisplayCenterAlpha = synth::ConvertOnePoleAlpha(synth::kDefaultUiDisplayCenterAlpha, 48000.0,
                                                               internalSampleRate_),
            .uiDisplaySpreadAlpha = synth::ConvertOnePoleAlpha(synth::kDefaultUiDisplaySpreadAlpha, 48000.0,
                                                               internalSampleRate_),
        };
        stereoGroup_->ConfigureProcessingTiming(timing);
        quadGroup_->ConfigureProcessingTiming(timing);
        monoGroup_->ConfigureProcessingTiming(timing);

        dresdenModule_.SetSampleRate(static_cast<float>(internalSampleRate_));
        outputStage_.Reset();
        debugCounters_ = {};
        ResetMatrixState();
    }

    void ProcessBlock(synth::AudioBlock& block) {
        if (block.numFrames == 0) {
            return;
        }

        debugCounters_.lastHostStartSample = block.startSample;
        for (std::size_t frame = 0; frame < block.numFrames; ++frame) {
            const std::uint64_t hostIndex = block.startSample + frame;
            const std::array<float, 2> output = outputStage_.ProcessHostFrame(hostIndex, [this](std::uint64_t internalIndex) {
                return ProcessInternalSubframe(internalIndex);
            });
            WriteOutputFrame(block, frame, output);
            ++debugCounters_.hostFramesProcessed;
        }

        scopeWriter_.Publish();
        dresdenModule_.PopulateUIState(vcoUiState_);
    }

    synth::AppContext* Context() const { return context_; }
    synth::ParameterGroup* StereoGroup() const { return stereoGroup_; }
    synth::ParameterGroup* QuadGroup() const { return quadGroup_; }
    synth::ParameterGroup* MonoGroup() const { return monoGroup_; }
    synth::Bank* DresdenBank() const { return dresdenBank_; }
    synth::Bank* MatrixBank() const { return matrixBank_; }
    synth::BankSlot* BankSlot() const { return slot_; }

    VcoModule& DresdenModule() { return dresdenModule_; }
    const VcoModule& DresdenModule() const { return dresdenModule_; }
    MatrixModuleType& MatrixModule() { return matrixModule_; }
    const MatrixModuleType& MatrixModule() const { return matrixModule_; }

    const synth::ScopeWriter& Scope() const { return scopeWriter_; }
    const std::array<synth::ScopeWriterHolder, kOscillatorCount>& ScopeHolders() const { return scopeHolders_; }
    const VcoModule::UIState& VcoUiState() const { return vcoUiState_; }
    VcoModule::UIState& VcoUiState() { return vcoUiState_; }

    const std::array<float, kOscillatorCount>& RawMatrixOutputs() const { return rawMatrixOutputs_; }
    float RawMatrixOutput(std::size_t index) const { return rawMatrixOutputs_.at(index); }
    float NormalizedMatrixSource(std::size_t index) const { return normalizedMatrixSources_.at(index); }
    const std::array<float, kOscillatorCount>& NormalizedMatrixSources() const { return normalizedMatrixSources_; }

    double HostSampleRate() const { return hostSampleRate_; }
    double InternalSampleRate() const { return internalSampleRate_; }
    std::size_t DecimatorLatencyInternalFrames() const { return (synth::kDresden4DecimatorTaps - 1) / 2; }
    std::size_t DecimatorLatencyHostFrames() const {
        return (DecimatorLatencyInternalFrames() + kOversampleFactor - 1) / kOversampleFactor;
    }
    const DebugCounterState& DebugCounters() const { return debugCounters_; }

    void SetRawMatrixOutputForTest(std::size_t index, float value) { rawMatrixOutputs_.at(index) = value; }
    void PublishMatrixModulatorsForTest() {
        for (std::size_t index = 0; index < kOscillatorCount; ++index) {
            normalizedMatrixSources_[index] = NormalizeMatrixOutput(rawMatrixOutputs_[index]);
        }
    }

private:
    void RegisterMatrixModulationSources() {
        std::array<float*, kOscillatorCount> sourcePointers{};
        for (std::size_t voiceIx = 0; voiceIx < kOscillatorCount; ++voiceIx) {
            sourcePointers[voiceIx] = &normalizedMatrixSources_[voiceIx];
        }
        quadGroup_->SetModulationSource(0, sourcePointers, {
                                                        .name = "Dresden Matrix",
                                                        .shortName = "Mtx",
                                                        .color = synth::Color::Red,
                                                        .connected = true,
                                                    });
    }

    void ResetMatrixState() {
        rawMatrixOutputs_.fill(0.0f);
        normalizedMatrixSources_.fill(0.5f);
        matrixOutputPublicationInternalIndex_ = kNoInternalSampleIndex;
    }

    static float NormalizeMatrixOutput(float value) {
        return 0.5f + 0.5f * std::clamp(value, -1.0f, 1.0f);
    }

    std::array<float, 2> ProcessInternalSubframe(std::uint64_t internalIndex) {
        ProcessParameters(internalIndex);

        debugCounters_.lastMatrixModulatorConsumptionInternalIndex = internalIndex;
        debugCounters_.lastConsumedMatrixOutputPublicationInternalIndex = matrixOutputPublicationInternalIndex_;
        debugCounters_.lastConsumedMatrixSources = normalizedMatrixSources_;
        quadGroup_->UpdateModValues();

        dresdenModule_.SetInput(*context_->parameterManager);
        dresdenModule_.Process();

        for (std::size_t oscIx = 0; oscIx < kOscillatorCount; ++oscIx) {
            matrixModule_.Inputs()[oscIx] = dresdenModule_.OscillatorOutput(oscIx);
        }
        debugCounters_.lastMatrixInputs = matrixModule_.Inputs();
        debugCounters_.lastMatrixInputInternalIndex = internalIndex;
        matrixModule_.SetInput(*context_->parameterManager);
        matrixModule_.Process();

        rawMatrixOutputs_ = matrixModule_.Outputs();
        for (std::size_t oscIx = 0; oscIx < kOscillatorCount; ++oscIx) {
            normalizedMatrixSources_[oscIx] = NormalizeMatrixOutput(rawMatrixOutputs_[oscIx]);
        }
        matrixOutputPublicationInternalIndex_ = internalIndex;
        debugCounters_.lastMatrixOutputPublicationInternalIndex = internalIndex;

        scopeWriter_.AdvanceIndex();
        RecordInternalIndex(internalIndex);

        return {dresdenModule_.OutputLeft(), dresdenModule_.OutputRight()};
    }

    void ProcessParameters(std::uint64_t internalIndex) {
        stereoGroup_->ProcessSample(internalIndex);
        quadGroup_->ProcessSample(internalIndex);
        monoGroup_->ProcessSample(internalIndex);
    }

    void RecordInternalIndex(std::uint64_t internalIndex) {
        if (debugCounters_.internalSubframesProcessed == 0) {
            debugCounters_.firstInternalSampleIndex = internalIndex;
        }
        debugCounters_.lastInternalSampleIndex = internalIndex;
        ++debugCounters_.internalSubframesProcessed;
    }

    static void WriteOutputFrame(synth::AudioBlock& block, std::size_t frame, const std::array<float, 2>& output) {
        if (block.numOutputChannels <= 0 || block.outputs == nullptr) {
            return;
        }
        if (block.outputs[0] != nullptr) {
            block.outputs[0][frame] = block.numOutputChannels == 1 ? 0.5f * (output[0] + output[1]) : output[0];
        }
        if (block.numOutputChannels >= 2 && block.outputs[1] != nullptr) {
            block.outputs[1][frame] = output[1];
        }
        for (int channel = 2; channel < block.numOutputChannels; ++channel) {
            if (block.outputs[channel] != nullptr) {
                block.outputs[channel][frame] = 0.0f;
            }
        }
    }

    synth::AppContext* context_ = nullptr;
    synth::ParameterGroup* stereoGroup_ = nullptr;
    synth::ParameterGroup* quadGroup_ = nullptr;
    synth::ParameterGroup* monoGroup_ = nullptr;
    synth::Bank* dresdenBank_ = nullptr;
    synth::Bank* matrixBank_ = nullptr;
    synth::BankSlot* slot_ = nullptr;

    synth::ScopeWriter scopeWriter_{kOscillatorCount, kScopeFrames};
    std::array<synth::ScopeWriterHolder, kOscillatorCount> scopeHolders_;
    VcoModule dresdenModule_;
    MatrixModuleType matrixModule_;
    VcoModule::UIState vcoUiState_;
    OutputStage outputStage_{Decimator{synth::Dresden4DecimatorCoefficients()}};

    std::array<float, kOscillatorCount> rawMatrixOutputs_{};
    std::array<float, kOscillatorCount> normalizedMatrixSources_{0.5f, 0.5f, 0.5f, 0.5f};
    std::uint64_t matrixOutputPublicationInternalIndex_ = kNoInternalSampleIndex;
    double hostSampleRate_ = 0.0;
    double internalSampleRate_ = 0.0;
    DebugCounterState debugCounters_;
};

}  // namespace synth_dresden4
