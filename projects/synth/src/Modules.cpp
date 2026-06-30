#include "synth/Modules.hpp"

#include <algorithm>
#include <array>
#include <stdexcept>
#include <utility>

namespace synth {

DualWavetableVcoModule::DualWavetableVcoModule(float sampleRate) {
    SetSampleRate(sampleRate);
}

std::string DualWavetableVcoModule::EffectiveName(std::string_view prefix, std::string_view name) {
    if (prefix.empty()) {
        return std::string(name);
    }
    std::string result(prefix);
    result += " ";
    result += name;
    return result;
}

void DualWavetableVcoModule::RegisterParameters(ParameterManager& manager, ParameterGroup& group,
                                                std::string_view prefix) {
    if (registered_) {
        throw std::logic_error("dual wavetable VCO module parameters already registered");
    }

    const std::array<std::string, 4> names{
        EffectiveName(prefix, "Tune"),
        EffectiveName(prefix, "Phase"),
        EffectiveName(prefix, "Shape"),
        EffectiveName(prefix, "Volume"),
    };
    if (group.Config().maxParameters - group.ParameterCount() < names.size()) {
        throw std::length_error("dual wavetable VCO module parameter capacity exhausted");
    }

    for (const std::string& name : names) {
        for (std::size_t paramIx = 0; paramIx < manager.ParameterCount(); ++paramIx) {
            if (manager.ParameterById(static_cast<ParameterId>(paramIx)).Name() == name) {
                throw std::logic_error("duplicate dual wavetable VCO module parameter name");
            }
        }
    }

    parameterIds_.tune = manager.RegisterParameter(group, {
                                                              .name = names[0],
                                                              .shortName = "Tune",
                                                              .defaultValue = 0.5f,
                                                              .color = Color::Cyan,
                                                          });
    parameterIds_.phase = manager.RegisterParameter(group, {
                                                              .name = names[1],
                                                              .shortName = "Phase",
                                                              .defaultValue = 0.0f,
                                                              .color = Color::Indigo,
                                                          });
    parameterIds_.shape = manager.RegisterParameter(group, {
                                                               .name = names[2],
                                                               .shortName = "Shape",
                                                               .defaultValue = 0.0f,
                                                               .color = Color::Orange,
                                                           });
    parameterIds_.volume = manager.RegisterParameter(group, {
                                                               .name = names[3],
                                                               .shortName = "Vol",
                                                               .defaultValue = 1.0f,
                                                               .color = Color::Green,
                                                           });
    manager_ = &manager;
    registered_ = true;
}

void DualWavetableVcoModule::RegisterToBank(Bank& bank, std::size_t offset) {
    RequireRegistered();
    std::array<Parameter*, 4> parameters{
        &ParameterById(parameterIds_.tune),
        &ParameterById(parameterIds_.phase),
        &ParameterById(parameterIds_.shape),
        &ParameterById(parameterIds_.volume),
    };
    bank.RegisterParameters(parameters, offset);
}

void DualWavetableVcoModule::SetInput(ParameterManager& manager) {
    RequireRegistered();
    if (&manager != manager_) {
        throw std::logic_error("dual wavetable VCO module used with a different parameter manager");
    }

    for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
        const float tuneHz = manager.GetExponential(kMinTuneHz, kMaxTuneHz, voiceIx, parameterIds_.tune);
        input_.voices[voiceIx].vco.freq = static_cast<double>(tuneHz) / static_cast<double>(sampleRate_);
        input_.voices[voiceIx].vco.wavetablePosition = manager.GetLinear(0.0f, 1.0f, voiceIx, parameterIds_.shape);
        input_.voices[voiceIx].vco.phaseOffset = manager.GetLinear(0.0f, 1.0f, voiceIx, parameterIds_.phase);
        input_.voices[voiceIx].vco.maxFreq = 0.5f;
        input_.voices[voiceIx].volume = manager.GetLinear(0.0f, 1.0f, voiceIx, parameterIds_.volume);
    }
}

void DualWavetableVcoModule::Process() {
    for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
        rawOutputs_[voiceIx] = vcos_[voiceIx].Process(input_.voices[voiceIx].vco);
        outputs_[voiceIx] = rawOutputs_[voiceIx] * input_.voices[voiceIx].volume;
    }

    for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
        directSources_[voiceIx] = std::clamp((rawOutputs_[voiceIx] + 1.0f) * 0.5f, 0.0f, 1.0f);
        swappedSources_[voiceIx] = std::clamp((rawOutputs_[kVoiceCount - 1 - voiceIx] + 1.0f) * 0.5f, 0.0f, 1.0f);
    }
}

void DualWavetableVcoModule::RegisterModulationSources(ParameterGroup& group, std::size_t directModIx,
                                                       std::size_t swappedModIx) {
    std::array<float*, kVoiceCount> direct{};
    std::array<float*, kVoiceCount> swapped{};
    for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
        direct[voiceIx] = &directSources_[voiceIx];
        swapped[voiceIx] = &swappedSources_[voiceIx];
    }
    group.SetModulationSource(directModIx, direct, {
                                                    .name = "VCO Direct",
                                                    .shortName = "VCO",
                                                    .color = Color::Cyan,
                                                    .connected = true,
                                                });
    group.SetModulationSource(swappedModIx, swapped, {
                                                      .name = "VCO Swapped",
                                                      .shortName = "Swap",
                                                      .color = Color::Orange,
                                                      .connected = true,
                                                  });
}

void DualWavetableVcoModule::PopulateUIState(UIState& state) const {
    for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
        vcos_[voiceIx].PopulateUIState(state.vcos[voiceIx]);
    }
}

void DualWavetableVcoModule::SetSampleRate(float sampleRate) {
    if (sampleRate <= 0.0f) {
        throw std::invalid_argument("dual wavetable VCO module sample rate must be positive");
    }
    sampleRate_ = sampleRate;
}

void DualWavetableVcoModule::SetScopeWriterHolder(std::size_t voiceIx, ScopeWriterHolder* holder) {
    if (voiceIx >= kVoiceCount) {
        throw std::out_of_range("dual wavetable VCO voice index out of range");
    }
    vcos_[voiceIx].SetScopeWriterHolder(holder);
}

void DualWavetableVcoModule::SetColor(std::size_t voiceIx, Color color) {
    if (voiceIx >= kVoiceCount) {
        throw std::out_of_range("dual wavetable VCO voice index out of range");
    }
    vcos_[voiceIx].SetColor(color);
}

float DualWavetableVcoModule::RawOutput(std::size_t voiceIx) const {
    return rawOutputs_.at(voiceIx);
}

float DualWavetableVcoModule::Output(std::size_t voiceIx) const {
    return outputs_.at(voiceIx);
}

Parameter& DualWavetableVcoModule::ParameterById(ParameterId id) const {
    if (manager_ == nullptr) {
        throw std::logic_error("dual wavetable VCO module parameters are not registered");
    }
    return manager_->ParameterById(id);
}

void DualWavetableVcoModule::RequireRegistered() const {
    if (!registered_ || manager_ == nullptr) {
        throw std::logic_error("dual wavetable VCO module parameters are not registered");
    }
}

} // namespace synth
