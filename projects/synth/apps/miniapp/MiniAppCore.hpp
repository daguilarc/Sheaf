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
// Per-parameter Compute() is no longer this file's job: synth::Engine's
// ProcessBlock calls manager_.ComputeAllTargets() once per block before
// invoking ProcessBlock(AudioBlock&) here (see Engine.hpp's binding order),
// so this core only does the per-frame ProcessLite() slewing the old
// MainComponent::processDspFrame did.

#include "DemoModulation.hpp"

#include "synth/AppContext.hpp"
#include "synth/DspScope.hpp"
#include "synth/MidiController.hpp"
#include "synth/Modules.hpp"
#include "synth/ParameterModulation.hpp"

#include <array>
#include <cstddef>
#include <filesystem>
#include <optional>
#include <vector>

namespace synth_miniapp {

class MiniAppCore {
public:
    static constexpr std::size_t kVoiceCount = 2;
    static constexpr std::size_t kScopeFrames = 6'553'600;
    using VcoModule = synth::WavetableVcoModule<kVoiceCount>;
    using LfoModule = synth::BasicLfoModule<kVoiceCount>;

    // Test-support hook, mirroring EngineTestApp's testPatchesRoot pattern
    // (tests/engine_tests.cpp): when set, Config() reports these roots
    // instead of the deterministic temp-directory defaults, so
    // tests/miniapp_system_tests.cpp can point patch persistence at a
    // scratch directory without touching the real default location. Empty
    // (the default) means "use the deterministic production roots".
    static inline std::filesystem::path testPatchesRoot;
    static inline std::filesystem::path testLogsRoot;

    static std::filesystem::path DefaultPatchesRoot() {
        return std::filesystem::temp_directory_path() / "sheaf-synth-miniapp-patches";
    }

    static std::filesystem::path DefaultLogsRoot() {
        return std::filesystem::temp_directory_path() / "sheaf-synth-miniapp-logs";
    }

    static synth::RuntimeConfig Config() {
        synth::RuntimeConfig config;
        config.appName = "SynthMiniapp";
        config.numAudioInputs = 0;
        config.numAudioOutputs = 2;
        config.preferredSampleRate = 48000.0;
        config.preferredBlockSize = 256;
        config.patchesRoot = testPatchesRoot.empty() ? DefaultPatchesRoot() : testPatchesRoot;
        config.logsRoot = testLogsRoot.empty() ? DefaultLogsRoot() : testLogsRoot;
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
            .voiceIndicatorColors = {synth::Color::Cyan, synth::Color::Orange},
        });
        group_ = &group;
        context_->parameterManager->GestureMetadataAt(0).name = "Gesture 1";
        context_->parameterManager->GestureMetadataAt(0).color = synth::Color::Orange;

        vcoModule_.RegisterParameters(*context_->parameterManager, group);
        lfoModule_.RegisterParameters(*context_->parameterManager, group, "LFO");
        vcoModule_.RegisterModulationSources(group, 0, 1);
        lfoModule_.RegisterModulationSource(group, 2);

        tune_ = &context_->parameterManager->ParameterById(vcoModule_.Parameters().tune);
        shape_ = &context_->parameterManager->ParameterById(vcoModule_.Parameters().shape);
        phaseParam_ = &context_->parameterManager->ParameterById(vcoModule_.Parameters().phase);
        volume_ = &context_->parameterManager->ParameterById(vcoModule_.Parameters().volume);
        lfoFrequency_ = &context_->parameterManager->ParameterById(lfoModule_.Parameters().frequency);
        lfoShape_ = &context_->parameterManager->ParameterById(lfoModule_.Parameters().shape);
        lfoPhaseOffset_ = &context_->parameterManager->ParameterById(lfoModule_.Parameters().phaseOffset);
        lfoSkew_ = &context_->parameterManager->ParameterById(lfoModule_.Parameters().skew);
        lfoExponent_ = &context_->parameterManager->ParameterById(lfoModule_.Parameters().exponent);
        parameters_ = {
            tune_,        phaseParam_,     shape_,   volume_, lfoFrequency_,
            lfoShape_,    lfoPhaseOffset_, lfoSkew_, lfoExponent_,
        };

        tune_->SetGestureActive(0, 0, true);
        tune_->SetGestureActive(1, 0, true);

        auto& vcoPage = context_->parameterManager->CreatePage("VCO");
        context_->parameterManager->AssignParameterToPage(vcoPage.ordinal, *tune_);
        context_->parameterManager->AssignParameterToPage(vcoPage.ordinal, *phaseParam_);
        context_->parameterManager->AssignParameterToPage(vcoPage.ordinal, *shape_);
        context_->parameterManager->AssignParameterToPage(vcoPage.ordinal, *volume_);
        auto& lfoPage = context_->parameterManager->CreatePage("LFO");
        context_->parameterManager->AssignParameterToPage(lfoPage.ordinal, *lfoFrequency_);
        context_->parameterManager->AssignParameterToPage(lfoPage.ordinal, *lfoShape_);
        context_->parameterManager->AssignParameterToPage(lfoPage.ordinal, *lfoPhaseOffset_);
        context_->parameterManager->AssignParameterToPage(lfoPage.ordinal, *lfoSkew_);
        context_->parameterManager->AssignParameterToPage(lfoPage.ordinal, *lfoExponent_);

        vcoBank_ = &context_->parameterManager->CreateBank();
        vcoBank_->SetColor(synth::Color::Cyan);
        lfoBank_ = &context_->parameterManager->CreateBank();
        lfoBank_->SetColor(synth::Color::Green);
        slot_ = &context_->parameterManager->CreateBankSlot();
        for (auto encoder : {10u, 11u, 12u, 13u, 14u}) {
            slot_->AddPhysicalEncoder(encoder);
        }
        slot_->SelectBank(vcoBank_);
        vcoModule_.RegisterToBank(*vcoBank_, 0);
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
        vcoModule_.SetColor(0, synth::Color::Cyan);
        vcoModule_.SetColor(1, synth::Color::Orange);
        lfoModule_.SetColor(0, synth::Color::Green);
        lfoModule_.SetColor(1, synth::Color::Yellow);

        // Default WrldBldr MIDI controller profile. context_->midiProfileConfig
        // is the live, message-thread-owned profile (mutable); write it there
        // so a real host's MIDI input is routed the same way the old
        // MainComponent wired it via CreateMidiControllerProfile.
        //
        // context_->defaultMidiProfileConfig is `const*` -- Engine.hpp shows
        // it points at Engine's private defaultMidiProfileConfig_ member.
        // There is no app-facing setter for it, and none is needed: right
        // after this Init() returns, Engine::Initialize() snapshots
        // defaultMidiProfileConfig_ = midiProfileConfig_ (see Engine.hpp's
        // binding-order comment, step 4a), so the WrldBldr profile installed
        // below into the live midiProfileConfig becomes the default profile
        // that revert/new-patch restore to.
        synth::WrldBldrDefaultProfileOptions profileOptions;
        profileOptions.visibleEncoderCount = slot_->PhysicalEncoders().size();
        profileOptions.sceneCount = 3;
        profileOptions.bankButtonCount = 16;
        profileOptions.gestureSelectorCount = 1;
        *context_->midiProfileConfig = synth::WrldBldrDefaultProfileConfig(profileOptions);
    }

    void PrepareToPlay(double sampleRate, int /*blockSize*/) {
        vcoModule_.SetSampleRate(static_cast<float>(sampleRate));
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
            ProcessLiteParameters(parameters_);
            vcoModule_.SetInput(*context_->parameterManager);
            vcoModule_.Process();
            lfoModule_.SetInput(*context_->parameterManager);
            lfoModule_.Process();

            context_->parameterManager->UpdateModValues(*group_);

            const float mixed = (vcoModule_.Output(0) + vcoModule_.Output(1)) * 0.5f;
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
        lfoModule_.PopulateUIState(lfoUiStates_);
    }

    // --- accessors for the UI wrapper (next task) --------------------------

    synth::AppContext* Context() const { return context_; }
    synth::ParameterGroup* Group() const { return group_; }

    const VcoModule::ParameterIds& VcoParameterIds() const { return vcoModule_.Parameters(); }
    const LfoModule::ParameterIds& LfoParameterIds() const { return lfoModule_.Parameters(); }
    const std::vector<synth::Parameter*>& Parameters() const { return parameters_; }

    synth::Bank* VcoBank() const { return vcoBank_; }
    synth::Bank* LfoBank() const { return lfoBank_; }
    synth::BankSlot* Slot() const { return slot_; }

    const VcoModule::UIState& VcoUiState() const { return vcoUiStates_; }
    // Non-const overload for the UI wrapper: synth_juce::VcoWaveformComponent
    // (juce/WaveformComponents.hpp) stores non-owning
    // DefaultWavetableVco::UIState* pointers and reads their atomics each
    // paint, never writing through them; it needs a mutable pointer only
    // because SetUIStates()'s signature predates this const accessor.
    VcoModule::UIState& VcoUiState() { return vcoUiStates_; }
    const LfoModule::UIState& LfoUiState() const { return lfoUiStates_; }
    LfoModule::UIState& LfoUiState() { return lfoUiStates_; }
    const synth::ScopeWriter& Scope() const { return scopeWriter_; }
    const std::array<synth::ScopeWriterHolder, 4>& ScopeHolders() const { return scopeHolders_; }

    VcoModule& VcoModuleInstance() { return vcoModule_; }
    LfoModule& LfoModuleInstance() { return lfoModule_; }

private:
    synth::AppContext* context_ = nullptr;
    synth::ParameterGroup* group_ = nullptr;
    synth::Parameter* tune_ = nullptr;
    synth::Parameter* phaseParam_ = nullptr;
    synth::Parameter* shape_ = nullptr;
    synth::Parameter* volume_ = nullptr;
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
    LfoModule lfoModule_;
    VcoModule::UIState vcoUiStates_;
    LfoModule::UIState lfoUiStates_;
};

}  // namespace synth_miniapp
