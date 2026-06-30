#pragma once

#include "synth/DspOscillators.hpp"
#include "synth/ParameterModulation.hpp"

#include <array>
#include <cstddef>
#include <string>
#include <string_view>

namespace synth {

class DualWavetableVcoModule {
public:
    static constexpr std::size_t kVoiceCount = 2;
    static constexpr float kMinTuneHz = 32.0f;
    static constexpr float kMaxTuneHz = 3000.0f;

    struct ParameterIds {
        ParameterId tune = 0;
        ParameterId phase = 0;
        ParameterId shape = 0;
        ParameterId volume = 0;
    };

    struct VoiceInput {
        DefaultWavetableVco::Input vco;
        float volume = 1.0f;
    };

    struct Input {
        std::array<VoiceInput, kVoiceCount> voices{};
    };

    struct UIState {
        std::array<DefaultWavetableVco::UIState, kVoiceCount> vcos;
    };

    explicit DualWavetableVcoModule(float sampleRate = 48000.0f);
    DualWavetableVcoModule(const DualWavetableVcoModule&) = delete;
    DualWavetableVcoModule& operator=(const DualWavetableVcoModule&) = delete;
    DualWavetableVcoModule(DualWavetableVcoModule&&) = delete;
    DualWavetableVcoModule& operator=(DualWavetableVcoModule&&) = delete;

    void RegisterParameters(ParameterManager& manager, ParameterGroup& group, std::string_view prefix = {});
    void RegisterToBank(Bank& bank, std::size_t offset);
    void SetInput(ParameterManager& manager);
    void Process();
    void RegisterModulationSources(ParameterGroup& group, std::size_t directModIx, std::size_t swappedModIx);
    void PopulateUIState(UIState& state) const;

    void SetSampleRate(float sampleRate);
    float SampleRate() const { return sampleRate_; }
    void SetScopeWriterHolder(std::size_t voiceIx, ScopeWriterHolder* holder);
    void SetColor(std::size_t voiceIx, Color color);

    bool Registered() const { return registered_; }
    const ParameterIds& Parameters() const { return parameterIds_; }
    const Input& CurrentInput() const { return input_; }
    Input& CurrentInput() { return input_; }
    float RawOutput(std::size_t voiceIx) const;
    float Output(std::size_t voiceIx) const;
    const std::array<float, kVoiceCount>& DirectModulationSources() const { return directSources_; }
    const std::array<float, kVoiceCount>& SwappedModulationSources() const { return swappedSources_; }

private:
    static std::string EffectiveName(std::string_view prefix, std::string_view name);
    Parameter& ParameterById(ParameterId id) const;
    void RequireRegistered() const;

    float sampleRate_ = 48000.0f;
    bool registered_ = false;
    ParameterManager* manager_ = nullptr;
    ParameterIds parameterIds_{};
    Input input_{};
    std::array<DefaultWavetableVco, kVoiceCount> vcos_;
    std::array<float, kVoiceCount> rawOutputs_{};
    std::array<float, kVoiceCount> outputs_{};
    std::array<float, kVoiceCount> directSources_{};
    std::array<float, kVoiceCount> swappedSources_{};
};

} // namespace synth
