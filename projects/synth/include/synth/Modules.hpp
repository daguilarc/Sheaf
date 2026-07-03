#pragma once

#include "synth/DspOscillators.hpp"
#include "synth/ParameterModulation.hpp"

#include <algorithm>
#include <array>
#include <cstddef>
#include <stdexcept>
#include <string>
#include <string_view>

namespace synth {

template<std::size_t Polyphony>
class WavetableVcoModule {
public:
    static_assert(Polyphony > 0);

    static constexpr std::size_t kVoiceCount = Polyphony;
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

    explicit WavetableVcoModule(float sampleRate = 48000.0f) {
        SetSampleRate(sampleRate);
    }
    WavetableVcoModule(const WavetableVcoModule&) = delete;
    WavetableVcoModule& operator=(const WavetableVcoModule&) = delete;
    WavetableVcoModule(WavetableVcoModule&&) = delete;
    WavetableVcoModule& operator=(WavetableVcoModule&&) = delete;

    void RegisterParameters(ParameterManager& manager, ParameterGroup& group, std::string_view prefix = {}) {
        if (registered_) {
            throw std::logic_error("wavetable VCO module parameters already registered");
        }

        const std::array<std::string, 4> names{
            EffectiveName(prefix, "Tune"),
            EffectiveName(prefix, "Phase"),
            EffectiveName(prefix, "Shape"),
            EffectiveName(prefix, "Volume"),
        };
        ValidateRegistration(manager, group, names, "wavetable VCO module");

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

    void RegisterToBank(Bank& bank, std::size_t offset) {
        RequireRegistered();
        std::array<Parameter*, 4> parameters{
            &ParameterById(parameterIds_.tune),
            &ParameterById(parameterIds_.phase),
            &ParameterById(parameterIds_.shape),
            &ParameterById(parameterIds_.volume),
        };
        bank.RegisterParameters(parameters, offset);
    }

    void SetInput(ParameterManager& manager) {
        RequireRegistered();
        if (&manager != manager_) {
            throw std::logic_error("wavetable VCO module used with a different parameter manager");
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

    void Process() {
        for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
            rawOutputs_[voiceIx] = vcos_[voiceIx].Process(input_.voices[voiceIx].vco);
            outputs_[voiceIx] = rawOutputs_[voiceIx] * input_.voices[voiceIx].volume;
        }

        for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
            directSources_[voiceIx] = std::clamp((rawOutputs_[voiceIx] + 1.0f) * 0.5f, 0.0f, 1.0f);
            swappedSources_[voiceIx] = std::clamp((rawOutputs_[kVoiceCount - 1 - voiceIx] + 1.0f) * 0.5f,
                                                  0.0f, 1.0f);
        }
    }

    void RegisterModulationSources(ParameterGroup& group, std::size_t directModIx, std::size_t swappedModIx) {
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

    void PopulateUIState(UIState& state) const {
        for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
            vcos_[voiceIx].PopulateUIState(state.vcos[voiceIx]);
        }
    }

    void SetSampleRate(float sampleRate) {
        if (sampleRate <= 0.0f) {
            throw std::invalid_argument("wavetable VCO module sample rate must be positive");
        }
        sampleRate_ = sampleRate;
    }

    float SampleRate() const { return sampleRate_; }

    void SetScopeWriterHolder(std::size_t voiceIx, ScopeWriterHolder* holder) {
        if (voiceIx >= kVoiceCount) {
            throw std::out_of_range("wavetable VCO voice index out of range");
        }
        vcos_[voiceIx].SetScopeWriterHolder(holder);
    }

    void SetColor(std::size_t voiceIx, Color color) {
        if (voiceIx >= kVoiceCount) {
            throw std::out_of_range("wavetable VCO voice index out of range");
        }
        vcos_[voiceIx].SetColor(color);
    }

    bool Registered() const { return registered_; }
    const ParameterIds& Parameters() const { return parameterIds_; }
    const Input& CurrentInput() const { return input_; }
    Input& CurrentInput() { return input_; }
    float RawOutput(std::size_t voiceIx) const { return rawOutputs_.at(voiceIx); }
    float Output(std::size_t voiceIx) const { return outputs_.at(voiceIx); }
    const std::array<float, kVoiceCount>& DirectModulationSources() const { return directSources_; }
    const std::array<float, kVoiceCount>& SwappedModulationSources() const { return swappedSources_; }

private:
    template<std::size_t Count>
    static void ValidateRegistration(const ParameterManager& manager, const ParameterGroup& group,
                                     const std::array<std::string, Count>& names, std::string_view moduleName) {
        if (group.Config().maxParameters - group.ParameterCount() < names.size()) {
            std::string message(moduleName);
            message += " parameter capacity exhausted";
            throw std::length_error(message);
        }

        for (const std::string& name : names) {
            for (std::size_t paramIx = 0; paramIx < manager.ParameterCount(); ++paramIx) {
                if (manager.ParameterById(static_cast<ParameterId>(paramIx)).Name() == name) {
                    std::string message("duplicate ");
                    message += moduleName;
                    message += " parameter name";
                    throw std::logic_error(message);
                }
            }
        }
    }

    static std::string EffectiveName(std::string_view prefix, std::string_view name) {
        if (prefix.empty()) {
            return std::string(name);
        }
        std::string result(prefix);
        result += " ";
        result += name;
        return result;
    }

    Parameter& ParameterById(ParameterId id) const {
        if (manager_ == nullptr) {
            throw std::logic_error("wavetable VCO module parameters are not registered");
        }
        return manager_->ParameterById(id);
    }

    void RequireRegistered() const {
        if (!registered_ || manager_ == nullptr) {
            throw std::logic_error("wavetable VCO module parameters are not registered");
        }
    }

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

template<std::size_t Polyphony>
class BasicLfoModule {
public:
    static_assert(Polyphony > 0);

    static constexpr std::size_t kVoiceCount = Polyphony;
    static constexpr float kMinFrequencyHz = 0.1f;
    static constexpr float kMaxFrequencyHz = 1000.0f;
    static constexpr float kMinExponent = 0.2f;
    static constexpr float kCenterExponent = 1.0f;
    static constexpr float kMaxExponent = 5.0f;

    struct ParameterIds {
        ParameterId frequency = 0;
        ParameterId shape = 0;
        ParameterId phaseOffset = 0;
        ParameterId skew = 0;
        ParameterId exponent = 0;
    };

    struct VoiceInput {
        BasicLFOProcessor::Input lfo;
    };

    struct Input {
        std::array<VoiceInput, kVoiceCount> voices{};
    };

    struct UIState {
        std::array<BasicLFOProcessor::UIState, kVoiceCount> lfos;
    };

    explicit BasicLfoModule(float sampleRate = 48000.0f) {
        SetSampleRate(sampleRate);
    }
    BasicLfoModule(const BasicLfoModule&) = delete;
    BasicLfoModule& operator=(const BasicLfoModule&) = delete;
    BasicLfoModule(BasicLfoModule&&) = delete;
    BasicLfoModule& operator=(BasicLfoModule&&) = delete;

    void RegisterParameters(ParameterManager& manager, ParameterGroup& group, std::string_view prefix = {}) {
        if (registered_) {
            throw std::logic_error("basic LFO module parameters already registered");
        }

        const std::array<std::string, 5> names{
            EffectiveName(prefix, "Frequency"),
            EffectiveName(prefix, "Shape"),
            EffectiveName(prefix, "Phase Offset"),
            EffectiveName(prefix, "Skew"),
            EffectiveName(prefix, "Exponent"),
        };
        ValidateRegistration(manager, group, names, "basic LFO module");

        parameterIds_.frequency = manager.RegisterParameter(group, {
                                                                       .name = names[0],
                                                                       .shortName = "Freq",
                                                                       .defaultValue = 0.35f,
                                                                       .color = Color::Green,
                                                                   });
        parameterIds_.shape = manager.RegisterParameter(group, {
                                                                   .name = names[1],
                                                                   .shortName = "Shape",
                                                                   .defaultValue = 0.5f,
                                                                   .color = Color::Cyan,
                                                               });
        parameterIds_.phaseOffset = manager.RegisterParameter(group, {
                                                                         .name = names[2],
                                                                         .shortName = "Phase",
                                                                         .defaultValue = 0.0f,
                                                                         .color = Color::Indigo,
                                                                     });
        parameterIds_.skew = manager.RegisterParameter(group, {
                                                                  .name = names[3],
                                                                  .shortName = "Skew",
                                                                  .defaultValue = 0.5f,
                                                                  .color = Color::Orange,
                                                              });
        parameterIds_.exponent = manager.RegisterParameter(group, {
                                                                      .name = names[4],
                                                                      .shortName = "Exp",
                                                                      .defaultValue = 0.0f,
                                                                      .range = RangeKind::Bipolar,
                                                                      .color = Color::Yellow,
                                                                  });
        manager_ = &manager;
        registered_ = true;
    }

    void RegisterToBank(Bank& bank, std::size_t offset) {
        RequireRegistered();
        std::array<Parameter*, 5> parameters{
            &ParameterById(parameterIds_.frequency),
            &ParameterById(parameterIds_.shape),
            &ParameterById(parameterIds_.phaseOffset),
            &ParameterById(parameterIds_.skew),
            &ParameterById(parameterIds_.exponent),
        };
        bank.RegisterParameters(parameters, offset);
    }

    void SetInput(ParameterManager& manager) {
        RequireRegistered();
        if (&manager != manager_) {
            throw std::logic_error("basic LFO module used with a different parameter manager");
        }

        for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
            const float frequencyHz = manager.GetExponential(kMinFrequencyHz, kMaxFrequencyHz, voiceIx,
                                                             parameterIds_.frequency);
            auto& lfo = input_.voices[voiceIx].lfo;
            lfo.frequency = static_cast<double>(frequencyHz) / static_cast<double>(sampleRate_);
            lfo.shape.shape = manager.GetLinear(0.0f, 1.0f, voiceIx, parameterIds_.shape);
            lfo.shape.phaseOffset = manager.GetLinear(0.0f, 1.0f, voiceIx, parameterIds_.phaseOffset)
                                    + static_cast<float>(voiceIx) / static_cast<float>(2 * kVoiceCount);
            lfo.shape.skew = manager.GetLinear(0.0f, 1.0f, voiceIx, parameterIds_.skew);
            lfo.shape.exponent = manager.GetBipolarExponential(kMinExponent, kCenterExponent, kMaxExponent, voiceIx,
                                                               parameterIds_.exponent);
        }
    }

    void Process() {
        for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
            outputs_[voiceIx] = std::clamp(lfos_[voiceIx].Process(input_.voices[voiceIx].lfo), 0.0f, 1.0f);
            modulationSources_[voiceIx] = outputs_[voiceIx];
        }
    }

    void RegisterModulationSource(ParameterGroup& group, std::size_t modIx) {
        std::array<float*, kVoiceCount> sources{};
        for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
            sources[voiceIx] = &modulationSources_[voiceIx];
        }
        group.SetModulationSource(modIx, sources, {
                                                    .name = "LFO",
                                                    .shortName = "LFO",
                                                    .color = Color::Green,
                                                    .connected = true,
                                                });
    }

    void PopulateUIState(UIState& state) const {
        for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
            lfos_[voiceIx].PopulateUIState(state.lfos[voiceIx]);
        }
    }

    void SetSampleRate(float sampleRate) {
        if (sampleRate <= 0.0f) {
            throw std::invalid_argument("basic LFO module sample rate must be positive");
        }
        sampleRate_ = sampleRate;
    }

    float SampleRate() const { return sampleRate_; }

    void SetScopeWriterHolder(std::size_t voiceIx, ScopeWriterHolder* holder) {
        if (voiceIx >= kVoiceCount) {
            throw std::out_of_range("basic LFO voice index out of range");
        }
        lfos_[voiceIx].SetScopeWriterHolder(holder);
    }

    void SetColor(std::size_t voiceIx, Color color) {
        if (voiceIx >= kVoiceCount) {
            throw std::out_of_range("basic LFO voice index out of range");
        }
        lfos_[voiceIx].SetColor(color);
    }

    bool Registered() const { return registered_; }
    const ParameterIds& Parameters() const { return parameterIds_; }
    const Input& CurrentInput() const { return input_; }
    Input& CurrentInput() { return input_; }
    float Output(std::size_t voiceIx) const { return outputs_.at(voiceIx); }
    const std::array<float, kVoiceCount>& ModulationSources() const { return modulationSources_; }

private:
    template<std::size_t Count>
    static void ValidateRegistration(const ParameterManager& manager, const ParameterGroup& group,
                                     const std::array<std::string, Count>& names, std::string_view moduleName) {
        if (group.Config().maxParameters - group.ParameterCount() < names.size()) {
            std::string message(moduleName);
            message += " parameter capacity exhausted";
            throw std::length_error(message);
        }

        for (const std::string& name : names) {
            for (std::size_t paramIx = 0; paramIx < manager.ParameterCount(); ++paramIx) {
                if (manager.ParameterById(static_cast<ParameterId>(paramIx)).Name() == name) {
                    std::string message("duplicate ");
                    message += moduleName;
                    message += " parameter name";
                    throw std::logic_error(message);
                }
            }
        }
    }

    static std::string EffectiveName(std::string_view prefix, std::string_view name) {
        if (prefix.empty()) {
            return std::string(name);
        }
        std::string result(prefix);
        result += " ";
        result += name;
        return result;
    }

    Parameter& ParameterById(ParameterId id) const {
        if (manager_ == nullptr) {
            throw std::logic_error("basic LFO module parameters are not registered");
        }
        return manager_->ParameterById(id);
    }

    void RequireRegistered() const {
        if (!registered_ || manager_ == nullptr) {
            throw std::logic_error("basic LFO module parameters are not registered");
        }
    }

    float sampleRate_ = 48000.0f;
    bool registered_ = false;
    ParameterManager* manager_ = nullptr;
    ParameterIds parameterIds_{};
    Input input_{};
    std::array<BasicLFOProcessor, kVoiceCount> lfos_;
    std::array<float, kVoiceCount> outputs_{};
    std::array<float, kVoiceCount> modulationSources_{};
};

} // namespace synth
