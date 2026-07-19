#pragma once

// synth_braid4::Braid4Core — JUCE-free core graph for the Braid 4
// patch-launchable synth app. The graph runs its oscillator/modulation loop at
// 4x the negotiated host sample rate, then decimates to the host block at the
// last output boundary.

#include "synth/AppContext.hpp"
#include "synth/DspBuffers.hpp"
#include "synth/DspFilters.hpp"
#include "synth/DspScope.hpp"
#include "synth/Modules.hpp"
#include "synth/ParameterModulation.hpp"
#include "synth/StandardModulators.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <stdexcept>

namespace synth_braid4 {

class Braid4Core {
public:
    static constexpr std::size_t kOscillatorCount = 4;
    static constexpr std::size_t kOversampleFactor = 4;
    static constexpr std::size_t kParameterFilterStatesPerOscillator = 10;
    static constexpr std::size_t kFilteredParameterStateCount =
        2 * kOscillatorCount * kParameterFilterStatesPerOscillator;
    static constexpr std::size_t kScopeFrames = 6'553'600;
    static constexpr std::uint64_t kNoInternalSampleIndex = std::numeric_limits<std::uint64_t>::max();

    using VcoModule = synth::Braid4VcoModule;
    using MatrixModuleType = synth::BipolarMatrixMixerModule<kOscillatorCount>;
    using Decimator = synth::FirDecimator<kOversampleFactor, 2, synth::kFourToOneDecimatorTaps>;
    using OutputStage = synth::OversampledOutputStage<kOversampleFactor, 2, Decimator>;

    struct DebugCounterState {
        std::size_t hostFramesProcessed = 0;
        std::size_t internalSubframesProcessed = 0;
        std::size_t stereoStandardProcessCalls = 0;
        std::size_t quadStandardProcessCalls = 0;
        std::size_t monoStandardProcessCalls = 0;
        std::size_t stereoStandardUiPublications = 0;
        std::size_t quadStandardUiPublications = 0;
        std::size_t monoStandardUiPublications = 0;
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
        config.appName = "Braid 4";
        config.numAudioInputs = 0;
        config.numAudioOutputs = 2;
        config.preferredSampleRate = 48000.0;
        config.preferredBlockSize = 256;
        config.uiWidth = 900;
        config.uiHeight = 560;
        config.uiFrameHz = 30;
        return config;
    }

    static std::array<synth::Color, kOscillatorCount> RedShades() {
        return {
            synth::Color::FromHsvDegrees(350.0f, 0.88f, 0.95f),
            synth::Color::FromHsvDegrees(358.0f, 0.82f, 0.88f),
            synth::Color::FromHsvDegrees(6.0f, 0.78f, 0.82f),
            synth::Color::FromHsvDegrees(14.0f, 0.74f, 0.76f),
        };
    }

    static std::array<synth::Color, kOscillatorCount> GreenShades() {
        return {
            synth::Color::FromHsvDegrees(118.0f, 0.84f, 0.88f),
            synth::Color::FromHsvDegrees(132.0f, 0.80f, 0.82f),
            synth::Color::FromHsvDegrees(146.0f, 0.76f, 0.78f),
            synth::Color::FromHsvDegrees(160.0f, 0.72f, 0.74f),
        };
    }

    static synth::Color LfoMatrixDiagonalColor() { return synth::Color::FromHsvDegrees(84.0f, 0.86f, 0.92f); }

    void Init(synth::AppContext* context) {
        if (context == nullptr || context->parameterManager == nullptr || context->instrument == nullptr) {
            throw std::invalid_argument("Braid 4 core requires a valid app context");
        }
        context_ = context;
        synth::ParameterManager& manager = *context_->parameterManager;
        const auto redShades = RedShades();
        const auto greenShades = GreenShades();

        stereoGroup_ = &manager.CreateGroup({
            .numVoices = 2,
            .numModulators = 15,
            .numScenes = 2,
            .maxParameters = 19,
        });
        quadGroup_ = &manager.CreateGroup({
            .numVoices = 4,
            .numModulators = 15,
            .numScenes = 2,
            .maxParameters = 32,
        });
        monoGroup_ = &manager.CreateGroup({
            .numVoices = 1,
            .numModulators = 15,
            .numScenes = 2,
            .maxParameters = 80,
        });

        stereoStandardModulators_ = std::make_unique<synth::StandardModulators<2>>(*stereoGroup_);
        quadStandardModulators_ = std::make_unique<synth::StandardModulators<4>>(*quadGroup_);
        monoStandardModulators_ = std::make_unique<synth::StandardModulators<1>>(*monoGroup_);
        stereoStandardModulators_->Register();
        quadStandardModulators_->Register();
        monoStandardModulators_->Register();

        synth::Braid4VcoModule::Options braidOptions;
        braidOptions.parameterBaseColor = synth::Color::Red;
        braidOptions.indicatorColors = redShades;
        braidModule_.RegisterParameters(manager, *stereoGroup_, *quadGroup_, *monoGroup_, "Braid 4", braidOptions);
        matrixModule_.SetParameterColors(synth::Color::Orange, synth::Color::Yellow);
        matrixModule_.RegisterParameters(manager, *monoGroup_, "Matrix Mixer");
        synth::Braid4VcoModule::Options lfoOptions;
        lfoOptions.parameterBaseColor = synth::Color::Rgb(0, 255, 0);
        lfoOptions.indicatorColors = greenShades;
        lfoOptions.frequencyOctaveShift = -10.0f;
        lfoModule_.RegisterParameters(manager, *stereoGroup_, *quadGroup_, *monoGroup_, "Braid 4 LFO", lfoOptions);
        lfoMatrixModule_.SetParameterColors(LfoMatrixDiagonalColor(), synth::Color::Yellow);
        lfoMatrixModule_.RegisterParameters(manager, *monoGroup_, "LFO Matrix");
        RegisterModulationSources();

        braidBank_ = &manager.CreateBank();
        braidBank_->SetBankColor(synth::Color::Red);
        matrixBank_ = &manager.CreateBank();
        matrixBank_->SetBankColor(synth::Color::Orange);
        lfoBank_ = &manager.CreateBank();
        lfoBank_->SetBankColor(synth::Color::Green);
        lfoMatrixBank_ = &manager.CreateBank();
        lfoMatrixBank_->SetBankColor(synth::Color::Yellow);
        slot_ = &manager.CreateBankSlot();
        for (synth::PhysicalEncoderId encoderId = 0; encoderId < 16; ++encoderId) {
            slot_->AddPhysicalEncoder(encoderId);
        }
        slot_->SelectBank(braidBank_);
        braidModule_.RegisterToBank(*braidBank_);
        slot_->SelectBank(matrixBank_);
        matrixModule_.RegisterToBank(*matrixBank_, 0);
        slot_->SelectBank(lfoBank_);
        lfoModule_.RegisterToBank(*lfoBank_);
        slot_->SelectBank(lfoMatrixBank_);
        lfoMatrixModule_.RegisterToBank(*lfoMatrixBank_, 0);
        slot_->SelectBank(braidBank_);

        manager.SetSceneEndpoints(0, 1);

        for (std::size_t oscIx = 0; oscIx < kOscillatorCount; ++oscIx) {
            scopeHolders_[oscIx] = scopeWriter_.ReserveChans(1);
            braidModule_.SetScopeWriterHolder(oscIx, &scopeHolders_[oscIx]);
            braidModule_.SetScopeColor(oscIx, redShades[oscIx]);
            lfoScopeHolders_[oscIx] = scopeWriter_.ReserveChans(1);
            lfoModule_.SetScopeWriterHolder(oscIx, &lfoScopeHolders_[oscIx]);
            lfoModule_.SetScopeColor(oscIx, greenShades[oscIx]);
        }

        *context_->instrument = synth::DefaultMidiInstrumentConfig();
        ResetModulationState();
    }

    void PrepareToPlay(double sampleRate, int /*blockSize*/) {
        if (!(std::isfinite(sampleRate) && sampleRate > 0.0)) {
            throw std::invalid_argument("Braid 4 host sample rate must be finite and positive");
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

        stereoStandardModulators_->Prepare(internalSampleRate_);
        quadStandardModulators_->Prepare(internalSampleRate_);
        monoStandardModulators_->Prepare(internalSampleRate_);

        braidModule_.SetSampleRate(static_cast<float>(internalSampleRate_));
        lfoModule_.SetSampleRate(static_cast<float>(internalSampleRate_));
        outputStage_.Reset();
        debugCounters_ = {};
        ResetModulationState();
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
        braidModule_.PopulateUIState(vcoUiState_);
        lfoModule_.PopulateUIState(lfoUiState_);
        stereoStandardModulators_->PublishUiState();
        ++debugCounters_.stereoStandardUiPublications;
        quadStandardModulators_->PublishUiState();
        ++debugCounters_.quadStandardUiPublications;
        monoStandardModulators_->PublishUiState();
        ++debugCounters_.monoStandardUiPublications;
    }

    synth::AppContext* Context() const { return context_; }
    synth::ParameterGroup* StereoGroup() const { return stereoGroup_; }
    synth::ParameterGroup* QuadGroup() const { return quadGroup_; }
    synth::ParameterGroup* MonoGroup() const { return monoGroup_; }
    synth::StandardModulators<2>& StereoStandardModulatorsInstance() { return *stereoStandardModulators_; }
    const synth::StandardModulators<2>& StereoStandardModulatorsInstance() const {
        return *stereoStandardModulators_;
    }
    synth::StandardModulators<4>& QuadStandardModulatorsInstance() { return *quadStandardModulators_; }
    const synth::StandardModulators<4>& QuadStandardModulatorsInstance() const {
        return *quadStandardModulators_;
    }
    synth::StandardModulators<1>& MonoStandardModulatorsInstance() { return *monoStandardModulators_; }
    const synth::StandardModulators<1>& MonoStandardModulatorsInstance() const {
        return *monoStandardModulators_;
    }
    synth::Bank* BraidBank() const { return braidBank_; }
    synth::Bank* MatrixBank() const { return matrixBank_; }
    synth::Bank* LfoBank() const { return lfoBank_; }
    synth::Bank* LfoMatrixBank() const { return lfoMatrixBank_; }
    synth::BankSlot* BankSlot() const { return slot_; }

    VcoModule& BraidModule() { return braidModule_; }
    const VcoModule& BraidModule() const { return braidModule_; }
    VcoModule& LfoModule() { return lfoModule_; }
    const VcoModule& LfoModule() const { return lfoModule_; }
    MatrixModuleType& MatrixModule() { return matrixModule_; }
    const MatrixModuleType& MatrixModule() const { return matrixModule_; }
    MatrixModuleType& LfoMatrixModule() { return lfoMatrixModule_; }
    const MatrixModuleType& LfoMatrixModule() const { return lfoMatrixModule_; }

    const synth::ScopeWriter& Scope() const { return scopeWriter_; }
    const std::array<synth::ScopeWriterHolder, kOscillatorCount>& ScopeHolders() const { return scopeHolders_; }
    const std::array<synth::ScopeWriterHolder, kOscillatorCount>& LfoScopeHolders() const { return lfoScopeHolders_; }
    const VcoModule::UIState& VcoUiState() const { return vcoUiState_; }
    VcoModule::UIState& VcoUiState() { return vcoUiState_; }
    const VcoModule::UIState& LfoUiState() const { return lfoUiState_; }
    VcoModule::UIState& LfoUiState() { return lfoUiState_; }

    const std::array<float, kOscillatorCount>& RawMatrixOutputs() const { return rawMatrixOutputs_; }
    float RawMatrixOutput(std::size_t index) const { return rawMatrixOutputs_.at(index); }
    float NormalizedMatrixSource(std::size_t index) const { return normalizedMatrixSources_.at(index); }
    const std::array<float, kOscillatorCount>& NormalizedMatrixSources() const { return normalizedMatrixSources_; }
    const std::array<float, kOscillatorCount>& RawLfoMatrixOutputs() const { return rawLfoMatrixOutputs_; }
    float RawLfoMatrixOutput(std::size_t index) const { return rawLfoMatrixOutputs_.at(index); }
    float NormalizedLfoMatrixSource(std::size_t index) const { return normalizedLfoMatrixSources_.at(index); }
    const std::array<float, kOscillatorCount>& NormalizedLfoMatrixSources() const { return normalizedLfoMatrixSources_; }

    double HostSampleRate() const { return hostSampleRate_; }
    double InternalSampleRate() const { return internalSampleRate_; }
    std::size_t DecimatorLatencyInternalFrames() const { return (synth::kFourToOneDecimatorTaps - 1) / 2; }
    std::size_t DecimatorLatencyHostFrames() const {
        return (DecimatorLatencyInternalFrames() + kOversampleFactor - 1) / kOversampleFactor;
    }
    const DebugCounterState& DebugCounters() const { return debugCounters_; }

    static constexpr std::size_t FilteredParameterStateCountForTest() {
        return kFilteredParameterStateCount;
    }
    float ParameterFilterOutputForTest(bool lfo, std::size_t oscillatorIx,
                                       std::size_t ownedIx) const {
        return ParameterFilterForTest(lfo, oscillatorIx, ownedIx).m_output;
    }
    float ParameterFilterAlphaForTest(bool lfo, std::size_t oscillatorIx,
                                      std::size_t ownedIx) const {
        return ParameterFilterForTest(lfo, oscillatorIx, ownedIx).m_alpha;
    }

    void SetRawMatrixOutputForTest(std::size_t index, float value) { rawMatrixOutputs_.at(index) = value; }
    void SetRawLfoMatrixOutputForTest(std::size_t index, float value) { rawLfoMatrixOutputs_.at(index) = value; }
    void SetRawAudioStereoOutputForTest(float left, float right) {
        rawAudioStereoOutputs_[0] = left;
        rawAudioStereoOutputs_[1] = right;
    }
    void SetRawLfoStereoOutputForTest(float left, float right) {
        rawLfoStereoOutputs_[0] = left;
        rawLfoStereoOutputs_[1] = right;
    }
    void PublishMatrixModulatorsForTest() {
        for (std::size_t index = 0; index < kOscillatorCount; ++index) {
            normalizedMatrixSources_[index] = NormalizeMatrixOutput(rawMatrixOutputs_[index]);
        }
    }
    void PublishAllModulatorsForTest() { PublishNormalizedSources(); }

private:
    void RegisterModulationSources() {
        std::array<float*, 2> audioStereoPointers{&normalizedAudioStereoSources_[0],
                                                  &normalizedAudioStereoSources_[1]};
        std::array<float*, 2> lfoStereoPointers{&normalizedLfoStereoSources_[0],
                                                &normalizedLfoStereoSources_[1]};
        std::array<float*, kOscillatorCount> matrixPointers{};
        std::array<float*, kOscillatorCount> lfoMatrixPointers{};
        std::array<float*, 1> audioMonoPointer{&normalizedAudioMonoSource_};
        std::array<float*, 1> lfoMonoPointer{&normalizedLfoMonoSource_};
        for (std::size_t voiceIx = 0; voiceIx < kOscillatorCount; ++voiceIx) {
            matrixPointers[voiceIx] = &normalizedMatrixSources_[voiceIx];
            lfoMatrixPointers[voiceIx] = &normalizedLfoMatrixSources_[voiceIx];
        }

        stereoGroup_->SetModulationSource(4, audioStereoPointers, {
                                                                   .name = "Audio XY",
                                                                   .shortName = "Aud",
                                                                   .sourceColor = synth::Color::Red,
                                                                   .connected = true,
                                                               });
        stereoGroup_->SetModulationSource(5, lfoStereoPointers, {
                                                                 .name = "LFO XY",
                                                                 .shortName = "LFO",
                                                                 .sourceColor = synth::Color::Green,
                                                                 .connected = true,
                                                             });
        quadGroup_->SetModulationSource(4, matrixPointers, {
                                                            .name = "Matrix",
                                                            .shortName = "Mtx",
                                                            .sourceColor = synth::Color::Orange,
                                                            .connected = true,
                                                        });
        quadGroup_->SetModulationSource(5, lfoMatrixPointers, {
                                                               .name = "LFO Matrix",
                                                               .shortName = "LMx",
                                                               .sourceColor = synth::Color::Yellow,
                                                               .connected = true,
                                                           });
        monoGroup_->SetModulationSource(4, audioMonoPointer, {
                                                            .name = "Audio Mid",
                                                            .shortName = "Aud",
                                                            .sourceColor = synth::Color::Red,
                                                            .connected = true,
                                                        });
        monoGroup_->SetModulationSource(5, lfoMonoPointer, {
                                                          .name = "LFO Mid",
                                                          .shortName = "LFO",
                                                          .sourceColor = synth::Color::Green,
                                                          .connected = true,
                                                      });
    }

    void ResetModulationState() {
        rawMatrixOutputs_.fill(0.0f);
        rawLfoMatrixOutputs_.fill(0.0f);
        rawAudioStereoOutputs_.fill(0.0f);
        rawLfoStereoOutputs_.fill(0.0f);
        normalizedMatrixSources_.fill(0.5f);
        normalizedLfoMatrixSources_.fill(0.5f);
        normalizedAudioStereoSources_.fill(0.5f);
        normalizedLfoStereoSources_.fill(0.5f);
        normalizedAudioMonoSource_ = 0.5f;
        normalizedLfoMonoSource_ = 0.5f;
        matrixOutputPublicationInternalIndex_ = kNoInternalSampleIndex;
        SeedParameterFilters();
    }

    static float NormalizeMatrixOutput(float value) {
        return 0.5f + 0.5f * std::clamp(value, -1.0f, 1.0f);
    }

    void PublishNormalizedSources() {
        for (std::size_t index = 0; index < kOscillatorCount; ++index) {
            normalizedMatrixSources_[index] = NormalizeMatrixOutput(rawMatrixOutputs_[index]);
            normalizedLfoMatrixSources_[index] = NormalizeMatrixOutput(rawLfoMatrixOutputs_[index]);
        }
        for (std::size_t voiceIx = 0; voiceIx < 2; ++voiceIx) {
            normalizedAudioStereoSources_[voiceIx] = NormalizeMatrixOutput(rawAudioStereoOutputs_[voiceIx]);
            normalizedLfoStereoSources_[voiceIx] = NormalizeMatrixOutput(rawLfoStereoOutputs_[voiceIx]);
        }
        normalizedAudioMonoSource_ =
            NormalizeMatrixOutput(0.5f * (rawAudioStereoOutputs_[0] + rawAudioStereoOutputs_[1]));
        normalizedLfoMonoSource_ =
            NormalizeMatrixOutput(0.5f * (rawLfoStereoOutputs_[0] + rawLfoStereoOutputs_[1]));
    }

    std::array<float, 2> ProcessInternalSubframe(std::uint64_t internalIndex) {
        debugCounters_.lastMatrixModulatorConsumptionInternalIndex = internalIndex;
        debugCounters_.lastConsumedMatrixOutputPublicationInternalIndex = matrixOutputPublicationInternalIndex_;
        debugCounters_.lastConsumedMatrixSources = normalizedMatrixSources_;
        stereoStandardModulators_->Process();
        ++debugCounters_.stereoStandardProcessCalls;
        quadStandardModulators_->Process();
        ++debugCounters_.quadStandardProcessCalls;
        monoStandardModulators_->Process();
        ++debugCounters_.monoStandardProcessCalls;
        stereoGroup_->UpdateModValues();
        quadGroup_->UpdateModValues();
        monoGroup_->UpdateModValues();

        ProcessParameterPhase1(internalIndex);
        FilterParameterCaches();
        ProcessParameterPhase2();

        braidModule_.SetInput(*context_->parameterManager);
        braidModule_.Process();
        lfoModule_.SetInput(*context_->parameterManager);
        lfoModule_.Process();
        rawAudioStereoOutputs_[0] = braidModule_.OutputLeft();
        rawAudioStereoOutputs_[1] = braidModule_.OutputRight();
        rawLfoStereoOutputs_[0] = lfoModule_.OutputLeft();
        rawLfoStereoOutputs_[1] = lfoModule_.OutputRight();

        for (std::size_t oscIx = 0; oscIx < kOscillatorCount; ++oscIx) {
            matrixModule_.Inputs()[oscIx] = braidModule_.OscillatorOutput(oscIx);
            lfoMatrixModule_.Inputs()[oscIx] = lfoModule_.OscillatorOutput(oscIx);
        }
        debugCounters_.lastMatrixInputs = matrixModule_.Inputs();
        debugCounters_.lastMatrixInputInternalIndex = internalIndex;
        matrixModule_.SetInput(*context_->parameterManager);
        matrixModule_.Process();
        lfoMatrixModule_.SetInput(*context_->parameterManager);
        lfoMatrixModule_.Process();

        rawMatrixOutputs_ = matrixModule_.Outputs();
        rawLfoMatrixOutputs_ = lfoMatrixModule_.Outputs();
        PublishNormalizedSources();
        matrixOutputPublicationInternalIndex_ = internalIndex;
        debugCounters_.lastMatrixOutputPublicationInternalIndex = internalIndex;

        scopeWriter_.AdvanceIndex();
        RecordInternalIndex(internalIndex);

        return {braidModule_.OutputLeft(), braidModule_.OutputRight()};
    }

    struct OscillatorParameterFilters {
        std::array<synth::OnePoleLowPass, 4> quad;
        synth::OnePoleLowPass cutoff;
        synth::OnePoleLowPass frequency;
        std::array<synth::OnePoleLowPass, 4> matrixRow;
    };

    using ParameterFilterFamily = std::array<OscillatorParameterFilters, kOscillatorCount>;

    static synth::OnePoleLowPass& ParameterFilterAt(OscillatorParameterFilters& filters,
                                                     std::size_t ownedIx) {
        if (ownedIx < 4) {
            return filters.quad.at(ownedIx);
        }
        if (ownedIx == 4) {
            return filters.cutoff;
        }
        if (ownedIx == 5) {
            return filters.frequency;
        }
        return filters.matrixRow.at(ownedIx - 6);
    }

    static const synth::OnePoleLowPass& ParameterFilterAt(const OscillatorParameterFilters& filters,
                                                           std::size_t ownedIx) {
        if (ownedIx < 4) {
            return filters.quad.at(ownedIx);
        }
        if (ownedIx == 4) {
            return filters.cutoff;
        }
        if (ownedIx == 5) {
            return filters.frequency;
        }
        return filters.matrixRow.at(ownedIx - 6);
    }

    const synth::OnePoleLowPass& ParameterFilterForTest(bool lfo, std::size_t oscillatorIx,
                                                         std::size_t ownedIx) const {
        const ParameterFilterFamily& family = lfo ? lfoParameterFilters_ : braidParameterFilters_;
        return ParameterFilterAt(family.at(oscillatorIx), ownedIx);
    }

    void ProcessParameterPhase1(std::uint64_t internalIndex) {
        stereoGroup_->ProcessSamplePhase1(internalIndex);
        quadGroup_->ProcessSamplePhase1(internalIndex);
        monoGroup_->ProcessSamplePhase1(internalIndex);
    }

    void ProcessParameterPhase2() {
        stereoGroup_->ProcessSamplePhase2();
        quadGroup_->ProcessSamplePhase2();
        monoGroup_->ProcessSamplePhase2();
    }

    void FilterParameterCaches() {
        FilterParameterFamily(braidModule_, matrixModule_, braidParameterFilters_);
        FilterParameterFamily(lfoModule_, lfoMatrixModule_, lfoParameterFilters_);
    }

    void FilterParameterFamily(VcoModule& module, MatrixModuleType& matrix,
                               ParameterFilterFamily& filters) {
        synth::ParameterManager& manager = *context_->parameterManager;
        const VcoModule::ParameterIds& ids = module.Parameters();
        const std::array<synth::ParameterId, 4> quadIds{
            ids.quad.tune,
            ids.quad.phase,
            ids.quad.shape,
            ids.quad.gain,
        };
        const MatrixModuleType::ParameterIds& matrixIds = matrix.Parameters();

        for (std::size_t oscillatorIx = 0; oscillatorIx < kOscillatorCount; ++oscillatorIx) {
            OscillatorParameterFilters& oscillatorFilters = filters[oscillatorIx];
            synth::Parameter& cutoffParameter =
                manager.ParameterById(ids.modulationCutoff[oscillatorIx]);
            const float normalizedCutoff = cutoffParameter.CachedKnobValue(0);
            const float cutoffHz = VcoModule::kMinModulationCutoffHz *
                std::pow(VcoModule::kMaxModulationCutoffHz /
                             VcoModule::kMinModulationCutoffHz,
                         normalizedCutoff);
            const float alpha = synth::OnePoleLowPass::AlphaFromNatFreq(
                cutoffHz / static_cast<float>(internalSampleRate_));

            for (std::size_t quadIx = 0; quadIx < quadIds.size(); ++quadIx) {
                synth::Parameter& parameter = manager.ParameterById(quadIds[quadIx]);
                parameter.ReplaceCachedKnobValue(
                    oscillatorIx,
                    oscillatorFilters.quad[quadIx].ProcessWithAlpha(
                        parameter.CachedKnobValue(oscillatorIx), alpha));
            }

            cutoffParameter.ReplaceCachedKnobValue(
                0,
                oscillatorFilters.cutoff.ProcessWithAlpha(
                    cutoffParameter.CachedKnobValue(0), alpha));

            synth::Parameter& frequencyParameter =
                manager.ParameterById(ids.frequency[oscillatorIx]);
            frequencyParameter.ReplaceCachedKnobValue(
                0,
                oscillatorFilters.frequency.ProcessWithAlpha(
                    frequencyParameter.CachedKnobValue(0), alpha));

            for (std::size_t column = 0; column < kOscillatorCount; ++column) {
                synth::Parameter& matrixParameter = manager.ParameterById(
                    matrixIds[oscillatorIx * kOscillatorCount + column]);
                matrixParameter.ReplaceCachedKnobValue(
                    0,
                    oscillatorFilters.matrixRow[column].ProcessWithAlpha(
                        matrixParameter.CachedKnobValue(0), alpha));
            }
        }
    }

    void SeedParameterFilters() {
        if (context_ == nullptr || context_->parameterManager == nullptr ||
            !braidModule_.Registered() || !lfoModule_.Registered() ||
            !matrixModule_.Registered() || !lfoMatrixModule_.Registered()) {
            return;
        }
        SeedParameterFilterFamily(braidModule_, matrixModule_, braidParameterFilters_);
        SeedParameterFilterFamily(lfoModule_, lfoMatrixModule_, lfoParameterFilters_);
    }

    void SeedParameterFilterFamily(const VcoModule& module, const MatrixModuleType& matrix,
                                   ParameterFilterFamily& filters) {
        synth::ParameterManager& manager = *context_->parameterManager;
        const VcoModule::ParameterIds& ids = module.Parameters();
        const std::array<synth::ParameterId, 4> quadIds{
            ids.quad.tune,
            ids.quad.phase,
            ids.quad.shape,
            ids.quad.gain,
        };
        const MatrixModuleType::ParameterIds& matrixIds = matrix.Parameters();

        for (std::size_t oscillatorIx = 0; oscillatorIx < kOscillatorCount; ++oscillatorIx) {
            OscillatorParameterFilters& oscillatorFilters = filters[oscillatorIx];
            for (std::size_t quadIx = 0; quadIx < quadIds.size(); ++quadIx) {
                oscillatorFilters.quad[quadIx].Reset(
                    manager.ParameterById(quadIds[quadIx]).CachedKnobValue(oscillatorIx));
            }
            oscillatorFilters.cutoff.Reset(
                manager.ParameterById(ids.modulationCutoff[oscillatorIx]).CachedKnobValue(0));
            oscillatorFilters.frequency.Reset(
                manager.ParameterById(ids.frequency[oscillatorIx]).CachedKnobValue(0));
            for (std::size_t column = 0; column < kOscillatorCount; ++column) {
                oscillatorFilters.matrixRow[column].Reset(
                    manager.ParameterById(matrixIds[oscillatorIx * kOscillatorCount + column])
                        .CachedKnobValue(0));
            }
        }
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
    std::unique_ptr<synth::StandardModulators<2>> stereoStandardModulators_;
    std::unique_ptr<synth::StandardModulators<4>> quadStandardModulators_;
    std::unique_ptr<synth::StandardModulators<1>> monoStandardModulators_;
    synth::Bank* braidBank_ = nullptr;
    synth::Bank* matrixBank_ = nullptr;
    synth::Bank* lfoBank_ = nullptr;
    synth::Bank* lfoMatrixBank_ = nullptr;
    synth::BankSlot* slot_ = nullptr;

    synth::ScopeWriter scopeWriter_{kOscillatorCount * 2, kScopeFrames};
    std::array<synth::ScopeWriterHolder, kOscillatorCount> scopeHolders_;
    std::array<synth::ScopeWriterHolder, kOscillatorCount> lfoScopeHolders_;
    VcoModule braidModule_;
    VcoModule lfoModule_;
    MatrixModuleType matrixModule_;
    MatrixModuleType lfoMatrixModule_;
    ParameterFilterFamily braidParameterFilters_{};
    ParameterFilterFamily lfoParameterFilters_{};
    VcoModule::UIState vcoUiState_;
    VcoModule::UIState lfoUiState_;
    OutputStage outputStage_{Decimator{synth::FourToOneDecimatorCoefficients()}};

    std::array<float, kOscillatorCount> rawMatrixOutputs_{};
    std::array<float, kOscillatorCount> normalizedMatrixSources_{0.5f, 0.5f, 0.5f, 0.5f};
    std::array<float, kOscillatorCount> rawLfoMatrixOutputs_{};
    std::array<float, kOscillatorCount> normalizedLfoMatrixSources_{0.5f, 0.5f, 0.5f, 0.5f};
    std::array<float, 2> rawAudioStereoOutputs_{};
    std::array<float, 2> rawLfoStereoOutputs_{};
    std::array<float, 2> normalizedAudioStereoSources_{0.5f, 0.5f};
    std::array<float, 2> normalizedLfoStereoSources_{0.5f, 0.5f};
    float normalizedAudioMonoSource_ = 0.5f;
    float normalizedLfoMonoSource_ = 0.5f;
    std::uint64_t matrixOutputPublicationInternalIndex_ = kNoInternalSampleIndex;
    double hostSampleRate_ = 0.0;
    double internalSampleRate_ = 0.0;
    DebugCounterState debugCounters_;
};

}  // namespace synth_braid4
