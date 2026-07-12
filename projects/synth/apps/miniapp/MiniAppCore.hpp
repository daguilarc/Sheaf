#pragma once

// synth_miniapp::MiniAppCore — JUCE-free port of the old miniapp's
// application content (projects/synth/miniapp/Main.cpp's MainComponent
// constructor + processDspFrame), reshaped to satisfy
// synth::SynthApplicationCore so it can run under both synth::Engine (the
// JUCE runtime shell, added by a later task) and synth_rig::SynthRig (the
// headless system test in tests/miniapp_system_tests.cpp).
//
// Everything JUCE-specific from the old MainComponent (juce::Component,
// buttons, sliders, MIDI device combo boxes, juce::Timer) is deliberately
// left out: this core only builds the parameter/bank/modulation/scope
// topology and runs the per-sample DSP. The UI wrapper (a later task) will
// own the JUCE-facing pieces and read this core's public accessors.
//
// Group-level per-sample parameter processing is owned here, before module
// processing, so target recompute cadence follows absolute audio sample time
// instead of host block boundaries.

#include "DemoModulation.hpp"
#include "MiniAppDraw.hpp"

#include "synth/AppContext.hpp"
#include "synth/DspScope.hpp"
#include "synth/MidiController.hpp"
#include "synth/Modules.hpp"
#include "synth/ParameterModulation.hpp"

#include <array>
#include <cstddef>
#include <memory>
#include <optional>
#include <vector>

namespace synth_miniapp {

class MiniAppCore {
public:
    static constexpr std::size_t kVoiceCount = 2;
    static constexpr std::size_t kScopeFrames = 6'553'600;
    using VcoModule = synth::WavetableVcoModule<kVoiceCount>;
    using FilterModule = synth::ClassicSvfModule<kVoiceCount>;
    using LfoModule = synth::BasicLfoModule<kVoiceCount>;
    using VcoUiLayerState = synth::DefaultWavetableVco::UIState;
    using LfoUiLayerState = synth::BasicLFOProcessor::UIState;

    static synth::RuntimeConfig Config() {
        synth::RuntimeConfig config;
        config.appName = "SynthMiniapp";
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
        context_ = context;

        context_->parameterManager->SetGestureCount(1);
        auto& group = context_->parameterManager->CreateGroup({
            .numVoices = 2,
            .numModulators = 3,
            .numScenes = 3,
            .maxParameters = 24,
        });
        group_ = &group;
        context_->parameterManager->GestureMetadataAt(0).name = "Gesture 1";
        context_->parameterManager->GestureMetadataAt(0).gestureColor = synth::Color::Orange;

        const std::vector<synth::Color> indicatorColors{synth::Color::Cyan, synth::Color::Orange};
        VcoModule::Options vcoOptions;
        vcoOptions.indicatorColors = indicatorColors;
        vcoModule_.RegisterParameters(*context_->parameterManager, group, {}, vcoOptions);
        FilterModule::Options filterOptions;
        filterOptions.indicatorColors = indicatorColors;
        filterModule_.RegisterParameters(*context_->parameterManager, group, "Filter", filterOptions);
        LfoModule::Options lfoOptions;
        lfoOptions.indicatorColors = indicatorColors;
        lfoModule_.RegisterParameters(*context_->parameterManager, group, "LFO", lfoOptions);
        vcoModule_.RegisterModulationSources(group, 0, 1);
        lfoModule_.RegisterModulationSource(group, 2);
        RegisterModulatorVisualizers(group);

        tune_ = &context_->parameterManager->ParameterById(vcoModule_.Parameters().tune);
        shape_ = &context_->parameterManager->ParameterById(vcoModule_.Parameters().shape);
        phaseParam_ = &context_->parameterManager->ParameterById(vcoModule_.Parameters().phase);
        volume_ = &context_->parameterManager->ParameterById(vcoModule_.Parameters().volume);
        filterCutoff_ = &context_->parameterManager->ParameterById(filterModule_.Parameters().cutoff);
        filterResonance_ = &context_->parameterManager->ParameterById(filterModule_.Parameters().resonance);
        filterBlend_ = &context_->parameterManager->ParameterById(filterModule_.Parameters().blend);
        lfoFrequency_ = &context_->parameterManager->ParameterById(lfoModule_.Parameters().frequency);
        lfoShape_ = &context_->parameterManager->ParameterById(lfoModule_.Parameters().shape);
        lfoPhaseOffset_ = &context_->parameterManager->ParameterById(lfoModule_.Parameters().phaseOffset);
        lfoSkew_ = &context_->parameterManager->ParameterById(lfoModule_.Parameters().skew);
        lfoExponent_ = &context_->parameterManager->ParameterById(lfoModule_.Parameters().exponent);
        parameters_ = {
            tune_,        phaseParam_,       shape_,        volume_,      filterCutoff_, filterResonance_,
            filterBlend_, lfoFrequency_,     lfoShape_,     lfoPhaseOffset_, lfoSkew_,   lfoExponent_,
        };

        tune_->SetGestureActive(0, 0, true);
        tune_->SetGestureActive(1, 0, true);

        auto& vcoPage = context_->parameterManager->CreatePage("VCO");
        context_->parameterManager->AssignParameterToPage(vcoPage.ordinal, *tune_);
        context_->parameterManager->AssignParameterToPage(vcoPage.ordinal, *phaseParam_);
        context_->parameterManager->AssignParameterToPage(vcoPage.ordinal, *shape_);
        context_->parameterManager->AssignParameterToPage(vcoPage.ordinal, *volume_);
        context_->parameterManager->AssignParameterToPage(vcoPage.ordinal, *filterCutoff_);
        context_->parameterManager->AssignParameterToPage(vcoPage.ordinal, *filterResonance_);
        context_->parameterManager->AssignParameterToPage(vcoPage.ordinal, *filterBlend_);
        auto& lfoPage = context_->parameterManager->CreatePage("LFO");
        context_->parameterManager->AssignParameterToPage(lfoPage.ordinal, *lfoFrequency_);
        context_->parameterManager->AssignParameterToPage(lfoPage.ordinal, *lfoShape_);
        context_->parameterManager->AssignParameterToPage(lfoPage.ordinal, *lfoPhaseOffset_);
        context_->parameterManager->AssignParameterToPage(lfoPage.ordinal, *lfoSkew_);
        context_->parameterManager->AssignParameterToPage(lfoPage.ordinal, *lfoExponent_);

        vcoBank_ = &context_->parameterManager->CreateBank();
        vcoBank_->SetBankColor(synth::Color::Cyan);
        lfoBank_ = &context_->parameterManager->CreateBank();
        lfoBank_->SetBankColor(synth::Color::Green);
        slot_ = &context_->parameterManager->CreateBankSlot();
        for (auto encoder : {10u, 11u, 12u, 13u, 14u, 15u, 16u}) {
            slot_->AddPhysicalEncoder(encoder);
        }
        slot_->SelectBank(vcoBank_);
        vcoModule_.RegisterToBank(*vcoBank_, 0);
        filterModule_.RegisterToBank(*vcoBank_, 4);
        slot_->SelectBank(lfoBank_);
        lfoModule_.RegisterToBank(*lfoBank_, 0);
        slot_->SelectBank(vcoBank_);

        context_->parameterManager->SetActivePage(0);
        context_->parameterManager->SetSceneEndpoints(0, 1);

        scopeHolders_[0] = scopeWriter_.ReserveChans(1);
        scopeHolders_[1] = scopeWriter_.ReserveChans(1);
        scopeHolders_[2] = scopeWriter_.ReserveChans(1);
        scopeHolders_[3] = scopeWriter_.ReserveChans(1);
        vcoModule_.SetScopeWriterHolder(0, &scopeHolders_[0]);
        vcoModule_.SetScopeWriterHolder(1, &scopeHolders_[1]);
        lfoModule_.SetScopeWriterHolder(0, &scopeHolders_[2]);
        lfoModule_.SetScopeWriterHolder(1, &scopeHolders_[3]);
        vcoModule_.SetScopeColor(0, synth::Color::Cyan);
        vcoModule_.SetScopeColor(1, synth::Color::Orange);
        lfoModule_.SetScopeColor(0, synth::Color::Green);
        lfoModule_.SetScopeColor(1, synth::Color::Yellow);

        // Install the shared default instrument. Apps may expose fewer scenes
        // or on-screen encoders than the default WRLD.Bldr profile maps; the
        // input path ignores out-of-range messages and output feedback blanks
        // cells with no backing parameter.
        *context_->instrument = synth::DefaultMidiInstrumentConfig();
    }

    void PrepareToPlay(double sampleRate, int /*blockSize*/) {
        vcoModule_.SetSampleRate(static_cast<float>(sampleRate));
        filterModule_.SetSampleRate(static_cast<float>(sampleRate));
        lfoModule_.SetSampleRate(static_cast<float>(sampleRate));
    }

    void ProcessBlock(synth::AudioBlock& block) {
        // Old MainComponent::timerCallback's step 5 (manager_.SetActivePage
        // follows the selected bank) ported here rather than into the UI
        // wrapper: bank selection changes come in over context_->uiBus,
        // which is only drained on the audio thread (uiBus_.Process() runs
        // inside Engine::ProcessBlock, before app_.ProcessBlock() — see
        // Engine.hpp's binding-order comment), and
        // context_->parameterManager is audio-thread-owned once running
        // (AppContext.hpp's thread-role comment). So this manager mutation
        // belongs here, alongside the other per-block manager work, not in
        // paint/refresh code on the message thread. The comparison is cheap
        // (pointer equality) and only actually calls SetActivePage when the
        // selected bank differs from the page it implies, so a steady state
        // costs one branch per block.
        const auto desiredPage = static_cast<synth::PageOrdinal>(slot_->SelectedBank() == lfoBank_ ? 1 : 0);
        if (context_->parameterManager->ActivePageOrdinal() != std::optional<synth::PageOrdinal>(desiredPage)) {
            context_->parameterManager->SetActivePage(desiredPage);
        }

        for (std::size_t frame = 0; frame < block.numFrames; ++frame) {
            ProcessParameters(*group_, block.startSample + frame);
            vcoModule_.SetInput(*context_->parameterManager);
            vcoModule_.Process();
            filterModule_.SetInput(*context_->parameterManager);
            for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
                filterModule_.SetVoiceInput(voiceIx, vcoModule_.Output(voiceIx));
            }
            filterModule_.Process();
            lfoModule_.SetInput(*context_->parameterManager);
            lfoModule_.Process();

            context_->parameterManager->UpdateModValues(*group_);

            const float mixed = (filterModule_.Output(0) + filterModule_.Output(1)) * 0.5f;
            for (int channel = 0; channel < block.numOutputChannels; ++channel) {
                float* out = block.outputs[channel];
                if (out == nullptr) {
                    continue;
                }
                out[frame] = mixed;
            }
            scopeWriter_.AdvanceIndex();
        }

        scopeWriter_.Publish();
        vcoModule_.PopulateUIState(vcoUiStates_);
        filterModule_.PopulateUIState(filterUiStates_);
        lfoModule_.PopulateUIState(lfoUiStates_);
    }

    // --- accessors for the UI wrapper (next task) --------------------------

    synth::AppContext* Context() const { return context_; }
    synth::ParameterGroup* Group() const { return group_; }

    const VcoModule::ParameterIds& VcoParameterIds() const { return vcoModule_.Parameters(); }
    const FilterModule::ParameterIds& FilterParameterIds() const { return filterModule_.Parameters(); }
    const LfoModule::ParameterIds& LfoParameterIds() const { return lfoModule_.Parameters(); }
    const std::vector<synth::Parameter*>& Parameters() const { return parameters_; }

    synth::Bank* VcoBank() const { return vcoBank_; }
    synth::Bank* LfoBank() const { return lfoBank_; }
    synth::BankSlot* Slot() const { return slot_; }

    const VcoModule::UIState& VcoUiState() const { return vcoUiStates_; }
    VcoModule::UIState& VcoUiState() { return vcoUiStates_; }
    const FilterModule::UIState& FilterUiState() const { return filterUiStates_; }
    FilterModule::UIState& FilterUiState() { return filterUiStates_; }
    const LfoModule::UIState& LfoUiState() const { return lfoUiStates_; }
    LfoModule::UIState& LfoUiState() { return lfoUiStates_; }
    const synth::ScopeWriter& Scope() const { return scopeWriter_; }
    const std::array<synth::ScopeWriterHolder, 4>& ScopeHolders() const { return scopeHolders_; }

    VcoModule& VcoModuleInstance() { return vcoModule_; }
    FilterModule& FilterModuleInstance() { return filterModule_; }
    LfoModule& LfoModuleInstance() { return lfoModule_; }

private:
    synth::AppContext* context_ = nullptr;
    synth::ParameterGroup* group_ = nullptr;
    synth::Parameter* tune_ = nullptr;
    synth::Parameter* phaseParam_ = nullptr;
    synth::Parameter* shape_ = nullptr;
    synth::Parameter* volume_ = nullptr;
    synth::Parameter* filterCutoff_ = nullptr;
    synth::Parameter* filterResonance_ = nullptr;
    synth::Parameter* filterBlend_ = nullptr;
    synth::Parameter* lfoFrequency_ = nullptr;
    synth::Parameter* lfoShape_ = nullptr;
    synth::Parameter* lfoPhaseOffset_ = nullptr;
    synth::Parameter* lfoSkew_ = nullptr;
    synth::Parameter* lfoExponent_ = nullptr;
    std::vector<synth::Parameter*> parameters_;
    synth::Bank* vcoBank_ = nullptr;
    synth::Bank* lfoBank_ = nullptr;
    synth::BankSlot* slot_ = nullptr;

    synth::ScopeWriter scopeWriter_{4, kScopeFrames};
    std::array<synth::ScopeWriterHolder, 4> scopeHolders_;
    VcoModule vcoModule_;
    FilterModule filterModule_;
    LfoModule lfoModule_;
    VcoModule::UIState vcoUiStates_;
    FilterModule::UIState filterUiStates_;
    LfoModule::UIState lfoUiStates_;
    std::unique_ptr<synth::ui::ScopeVisualizer<VcoUiLayerState>> vcoVisualizer0_;
    std::unique_ptr<synth::ui::ScopeVisualizer<VcoUiLayerState>> vcoVisualizer1_;
    std::unique_ptr<synth::ui::ScopeVisualizer<LfoUiLayerState>> lfoVisualizer_;

    void RegisterModulatorVisualizers(synth::ParameterGroup& group) {
        std::array<VcoUiLayerState*, kVoiceCount> vcoLayers{};
        std::array<LfoUiLayerState*, kVoiceCount> lfoLayers{};
        for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
            vcoLayers[voiceIx] = &vcoUiStates_.vcos[voiceIx];
            lfoLayers[voiceIx] = &lfoUiStates_.lfos[voiceIx];
        }

        vcoVisualizer0_ = std::make_unique<synth::ui::ScopeVisualizer<VcoUiLayerState>>(
            vcoLayers,
            VcoWaveformDrawState::x_MinY,
            VcoWaveformDrawState::x_MaxY,
            VcoWaveformDrawState::x_NumSamples,
            true);
        vcoVisualizer1_ = std::make_unique<synth::ui::ScopeVisualizer<VcoUiLayerState>>(
            vcoLayers,
            VcoWaveformDrawState::x_MinY,
            VcoWaveformDrawState::x_MaxY,
            VcoWaveformDrawState::x_NumSamples,
            true);
        lfoVisualizer_ = std::make_unique<synth::ui::ScopeVisualizer<LfoUiLayerState>>(
            lfoLayers,
            LfoWaveformDrawState::x_MinY,
            LfoWaveformDrawState::x_MaxY,
            LfoWaveformDrawState::x_NumSamples,
            true);

        group.GetModulators().Metadata(0).visualizer = vcoVisualizer0_.get();
        group.GetModulators().Metadata(1).visualizer = vcoVisualizer1_.get();
        group.GetModulators().Metadata(2).visualizer = lfoVisualizer_.get();
    }
};

}  // namespace synth_miniapp
