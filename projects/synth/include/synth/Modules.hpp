#pragma once

#include "synth/DspAdsr.hpp"
#include "synth/DspFilters.hpp"
#include "synth/DspOscillators.hpp"
#include "synth/ParameterModulation.hpp"

#include <algorithm>
#include <array>
#include <cstddef>
#include <cmath>
#include <limits>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

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

    struct Options {
        std::vector<Color> indicatorColors;
    };

    explicit WavetableVcoModule(float sampleRate = 48000.0f) {
        SetSampleRate(sampleRate);
    }
    WavetableVcoModule(const WavetableVcoModule&) = delete;
    WavetableVcoModule& operator=(const WavetableVcoModule&) = delete;
    WavetableVcoModule(WavetableVcoModule&&) = delete;
    WavetableVcoModule& operator=(WavetableVcoModule&&) = delete;

    void RegisterParameters(ParameterManager& manager, ParameterGroup& group, std::string_view prefix = {}) {
        RegisterParameters(manager, group, prefix, Options{});
    }

    void RegisterParameters(ParameterManager& manager, ParameterGroup& group, std::string_view prefix,
                            const Options& options) {
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
                                                                  .baseColor = Color::Cyan,
                                                                  .indicatorColors = options.indicatorColors,
                                                              });
        parameterIds_.phase = manager.RegisterParameter(group, {
                                                                   .name = names[1],
                                                                   .shortName = "Phase",
                                                                   .defaultValue = 0.0f,
                                                                   .baseColor = Color::Indigo,
                                                                   .indicatorColors = options.indicatorColors,
                                                               });
        parameterIds_.shape = manager.RegisterParameter(group, {
                                                                   .name = names[2],
                                                                   .shortName = "Shape",
                                                                   .defaultValue = 0.0f,
                                                                   .baseColor = Color::Orange,
                                                                   .indicatorColors = options.indicatorColors,
                                                               });
        parameterIds_.volume = manager.RegisterParameter(group, {
                                                                    .name = names[3],
                                                                    .shortName = "Vol",
                                                                    .defaultValue = 1.0f,
                                                                    .baseColor = Color::Green,
                                                                    .indicatorColors = options.indicatorColors,
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
                                                        .sourceColor = Color::Cyan,
                                                        .connected = true,
                                                    });
        group.SetModulationSource(swappedModIx, swapped, {
                                                          .name = "VCO Swapped",
                                                          .shortName = "Swap",
                                                          .sourceColor = Color::Orange,
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

    void SetScopeColor(std::size_t voiceIx, Color scopeColor) {
        if (voiceIx >= kVoiceCount) {
            throw std::out_of_range("wavetable VCO voice index out of range");
        }
        vcos_[voiceIx].SetScopeColor(scopeColor);
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

template<std::size_t Size>
class BipolarMatrixMixerModule {
public:
    static_assert(Size > 0);

    static constexpr std::size_t kSize = Size;

    using ParameterIds = std::array<ParameterId, kSize * kSize>;

    BipolarMatrixMixerModule() = default;
    BipolarMatrixMixerModule(const BipolarMatrixMixerModule&) = delete;
    BipolarMatrixMixerModule& operator=(const BipolarMatrixMixerModule&) = delete;
    BipolarMatrixMixerModule(BipolarMatrixMixerModule&&) = delete;
    BipolarMatrixMixerModule& operator=(BipolarMatrixMixerModule&&) = delete;

    void SetParameterColors(Color diagonalColor, Color offDiagonalColor) {
        if (registered_) {
            throw std::logic_error("bipolar matrix mixer module colors must be set before registration");
        }
        diagonalColor_ = diagonalColor;
        offDiagonalColor_ = offDiagonalColor;
    }

    void RegisterParameters(ParameterManager& manager, ParameterGroup& group, std::string_view prefix = {}) {
        if (registered_) {
            throw std::logic_error("bipolar matrix mixer module parameters already registered");
        }
        if (&group.Manager() != &manager) {
            throw std::logic_error("bipolar matrix mixer module group is not owned by manager");
        }
        if (group.Config().numVoices != 1) {
            throw std::logic_error("bipolar matrix mixer module requires a mono parameter group");
        }

        // Matrix coordinates are [output row][input column] throughout.
        std::array<std::string, kSize * kSize> names{};
        // Each output row sums every input column in row-major order.
        for (std::size_t row = 0; row < kSize; ++row) {
            for (std::size_t column = 0; column < kSize; ++column) {
                names[Index(row, column)] = MatrixName(prefix, row, column);
            }
        }
        ValidateRegistration(manager, group, names, "bipolar matrix mixer module");

        for (std::size_t row = 0; row < kSize; ++row) {
            for (std::size_t column = 0; column < kSize; ++column) {
                parameterIds_[Index(row, column)] = manager.RegisterParameter(group, {
                                                                                         .name = names[Index(row, column)],
                                                                                         .shortName = MatrixShortName(row, column),
                                                                                         .defaultValue = row == column ? 1.0f : 0.5f,
                                                                                         .range = RangeKind::Bipolar,
                                                                                         .baseColor = row == column ? diagonalColor_ : offDiagonalColor_,
                                                                                     });
            }
        }

        manager_ = &manager;
        registered_ = true;
    }

    void RegisterToBank(Bank& bank, std::size_t offset) {
        RequireRegistered();

        std::array<Parameter*, kSize * kSize> parameters{};
        for (std::size_t parameterIx = 0; parameterIx < parameters.size(); ++parameterIx) {
            parameters[parameterIx] = &ParameterById(parameterIds_[parameterIx]);
        }
        bank.RegisterParameters(parameters, offset);
    }

    void SetInput(ParameterManager& manager) {
        RequireRegistered();
        if (&manager != manager_) {
            throw std::logic_error("bipolar matrix mixer module used with a different parameter manager");
        }

        for (std::size_t row = 0; row < kSize; ++row) {
            for (std::size_t column = 0; column < kSize; ++column) {
                gains_[Index(row, column)] =
                    manager.GetBipolarZeroBasedExponential(1.0f, 0.25f, 0, parameterIds_[Index(row, column)]);
            }
        }
    }

    void Process() {
        for (std::size_t row = 0; row < kSize; ++row) {
            float output = 0.0f;
            for (std::size_t column = 0; column < kSize; ++column) {
                output += inputs_[column] * gains_[Index(row, column)];
            }
            outputs_[row] = output;
        }
    }

    bool Registered() const { return registered_; }
    const ParameterIds& Parameters() const { return parameterIds_; }
    std::array<float, kSize>& Inputs() { return inputs_; }
    const std::array<float, kSize>& Inputs() const { return inputs_; }
    const std::array<float, kSize>& Outputs() const { return outputs_; }
    float Output(std::size_t row) const { return outputs_.at(row); }
    float Gain(std::size_t row, std::size_t column) const { return gains_.at(Index(row, column)); }

private:
    static constexpr std::size_t Index(std::size_t row, std::size_t column) {
        return row * kSize + column;
    }

    template<std::size_t Count>
    static void ValidateRegistration(const ParameterManager& manager, const ParameterGroup& group,
                                     const std::array<std::string, Count>& names, std::string_view moduleName) {
        if (group.AvailableParameterSlots() < names.size()) {
            std::string message(moduleName);
            message += " parameter capacity exhausted";
            throw std::length_error(message);
        }

        for (std::size_t nameIx = 0; nameIx < names.size(); ++nameIx) {
            for (std::size_t otherIx = nameIx + 1; otherIx < names.size(); ++otherIx) {
                if (names[nameIx] == names[otherIx]) {
                    std::string message("duplicate ");
                    message += moduleName;
                    message += " parameter name";
                    throw std::logic_error(message);
                }
            }
            for (std::size_t paramIx = 0; paramIx < manager.ParameterCount(); ++paramIx) {
                if (manager.ParameterById(static_cast<ParameterId>(paramIx)).Name() == names[nameIx]) {
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

    static std::string MatrixName(std::string_view prefix, std::size_t row, std::size_t column) {
        return EffectiveName(prefix, MatrixShortName(row, column));
    }

    static std::string MatrixShortName(std::size_t row, std::size_t column) {
        std::string result("R");
        result += std::to_string(row + 1);
        result += "C";
        result += std::to_string(column + 1);
        return result;
    }

    Parameter& ParameterById(ParameterId id) const {
        if (manager_ == nullptr) {
            throw std::logic_error("bipolar matrix mixer module parameters are not registered");
        }
        return manager_->ParameterById(id);
    }

    void RequireRegistered() const {
        if (!registered_ || manager_ == nullptr) {
            throw std::logic_error("bipolar matrix mixer module parameters are not registered");
        }
    }

    bool registered_ = false;
    ParameterManager* manager_ = nullptr;
    Color diagonalColor_ = Color::Grey;
    Color offDiagonalColor_ = Color::Grey;
    std::array<float, kSize> inputs_{};
    std::array<float, kSize> outputs_{};
    ParameterIds parameterIds_{};
    std::array<float, kSize * kSize> gains_{};
};

class Braid4VcoModule {
public:
    static constexpr std::size_t kOscillatorCount = 4;
    static constexpr std::size_t kStereoVoiceCount = 2;
    static constexpr float kMinModulationCutoffHz = 0.1f;
    static constexpr float kMaxModulationCutoffHz = 20000.0f;

    struct QuadParameterIds {
        ParameterId tune = 0;
        ParameterId phase = 0;
        ParameterId shape = 0;
        ParameterId gain = 0;
    };

    struct ParameterIds {
        ParameterId x = 0;
        ParameterId y = 0;
        QuadParameterIds quad{};
        std::array<ParameterId, kOscillatorCount> modulationCutoff{};
        std::array<ParameterId, kOscillatorCount> frequency{};
    };

    struct OscillatorInput {
        DefaultWavetableVco::Input vco;
        float tuneMultiplier = 1.0f;
        float phaseCycles = 0.0f;
        float shape = 0.0f;
        float gain = 1.0f;
        float baseFrequencyHz = 10.0f;
    };

    struct Input {
        std::array<float, kStereoVoiceCount> x{0.5f, 0.5f};
        std::array<float, kStereoVoiceCount> y{0.5f, 0.5f};
        std::array<OscillatorInput, kOscillatorCount> oscillators{};
    };

    struct UIState {
        std::array<DefaultWavetableVco::UIState, kOscillatorCount> vcos;
    };

    struct Options {
        Color parameterBaseColor = Color::Red;
        std::array<Color, kOscillatorCount> indicatorColors{Color::Red, Color::Red, Color::Red, Color::Red};
        float frequencyOctaveShift = 0.0f;
    };

    explicit Braid4VcoModule(float sampleRate = 48000.0f) {
        SetSampleRate(sampleRate);
    }
    Braid4VcoModule(const Braid4VcoModule&) = delete;
    Braid4VcoModule& operator=(const Braid4VcoModule&) = delete;
    Braid4VcoModule(Braid4VcoModule&&) = delete;
    Braid4VcoModule& operator=(Braid4VcoModule&&) = delete;

    void RegisterParameters(ParameterManager& manager, ParameterGroup& stereo, ParameterGroup& quad,
                            ParameterGroup& mono, std::string_view prefix = "Braid 4") {
        RegisterParameters(manager, stereo, quad, mono, prefix, Options{});
    }

    void RegisterParameters(ParameterManager& manager, ParameterGroup& stereo, ParameterGroup& quad,
                            ParameterGroup& mono, std::string_view prefix, const Options& options) {
        if (registered_) {
            throw std::logic_error("Braid 4 VCO module parameters already registered");
        }
        if (!std::isfinite(options.frequencyOctaveShift)) {
            throw std::invalid_argument("Braid 4 VCO module frequency octave shift must be finite");
        }
        ValidateGroupShapes(manager, stereo, quad, mono);

        const std::array<std::string, 14> names = ParameterNames(prefix);
        ValidateDuplicateNames(manager, names, "Braid 4 VCO module");
        ValidateCapacity(stereo, 2, "Braid 4 VCO module stereo");
        ValidateCapacity(quad, 4, "Braid 4 VCO module quad");
        ValidateCapacity(mono, 8, "Braid 4 VCO module mono");

        parameterIds_.x = manager.RegisterParameter(stereo, {
                                                                .name = names[0],
                                                                .shortName = "X",
                                                                .defaultValue = 0.5f,
                                                                .baseColor = options.parameterBaseColor,
                                                                .indicatorColors = {options.parameterBaseColor},
                                                            });
        parameterIds_.y = manager.RegisterParameter(stereo, {
                                                                .name = names[1],
                                                                .shortName = "Y",
                                                                .defaultValue = 0.5f,
                                                                .baseColor = options.parameterBaseColor,
                                                                .indicatorColors = {options.parameterBaseColor},
                                                            });
        parameterIds_.quad.tune = manager.RegisterParameter(quad, {
                                                                      .name = names[2],
                                                                      .shortName = "Tune",
                                                                      .defaultValue = 0.5f,
                                                                      .baseColor = options.parameterBaseColor,
                                                                      .indicatorColors = std::vector<Color>(options.indicatorColors.begin(),
                                                                                                             options.indicatorColors.end()),
                                                                  });
        parameterIds_.quad.phase = manager.RegisterParameter(quad, {
                                                                       .name = names[3],
                                                                       .shortName = "Phase",
                                                                       .defaultValue = 0.5f,
                                                                       .range = RangeKind::Bipolar,
                                                                       .baseColor = options.parameterBaseColor,
                                                                       .indicatorColors = std::vector<Color>(options.indicatorColors.begin(),
                                                                                                              options.indicatorColors.end()),
                                                                   });
        parameterIds_.quad.shape = manager.RegisterParameter(quad, {
                                                                       .name = names[4],
                                                                       .shortName = "Shape",
                                                                       .defaultValue = 0.0f,
                                                                       .baseColor = options.parameterBaseColor,
                                                                       .indicatorColors = std::vector<Color>(options.indicatorColors.begin(),
                                                                                                              options.indicatorColors.end()),
                                                                   });
        parameterIds_.quad.gain = manager.RegisterParameter(quad, {
                                                                      .name = names[5],
                                                                      .shortName = "Gain",
                                                                      .defaultValue = 1.0f,
                                                                      .range = RangeKind::Bipolar,
                                                                      .baseColor = options.parameterBaseColor,
                                                                      .indicatorColors = std::vector<Color>(options.indicatorColors.begin(),
                                                                                                             options.indicatorColors.end()),
                                                                  });
        for (std::size_t oscIx = 0; oscIx < kOscillatorCount; ++oscIx) {
            parameterIds_.modulationCutoff[oscIx] = manager.RegisterParameter(mono, {
                                                                                        .name = names[6 + oscIx],
                                                                                        .shortName = OscillatorShortName("Mod LPF", oscIx),
                                                                                        .defaultValue = 0.0f,
                                                                                        .baseColor = options.indicatorColors[oscIx],
                                                                                        .indicatorColors = {options.indicatorColors[oscIx]},
                                                                                    });
        }
        for (std::size_t oscIx = 0; oscIx < kOscillatorCount; ++oscIx) {
            parameterIds_.frequency[oscIx] = manager.RegisterParameter(mono, {
                                                                                 .name = names[10 + oscIx],
                                                                                 .shortName = OscillatorShortName("Freq", oscIx),
                                                                                 .defaultValue = 0.5f,
                                                                                 .baseColor = options.indicatorColors[oscIx],
                                                                                 .indicatorColors = {options.indicatorColors[oscIx]},
                                                                             });
        }

        frequencyScale_ = std::pow(2.0f, options.frequencyOctaveShift);
        manager_ = &manager;
        registered_ = true;
    }

    void RegisterToBank(Bank& bank) {
        RequireRegistered();
        if (bank.SlotCapacity() < 16) {
            throw std::logic_error("Braid 4 VCO module bank registration exceeds slot capacity");
        }

        bank.AddMapping(0, ParameterById(parameterIds_.x));
        bank.AddMapping(1, ParameterById(parameterIds_.y));
        bank.AddMapping(4, ParameterById(parameterIds_.quad.tune));
        bank.AddMapping(5, ParameterById(parameterIds_.quad.phase));
        bank.AddMapping(6, ParameterById(parameterIds_.quad.shape));
        bank.AddMapping(7, ParameterById(parameterIds_.quad.gain));
        for (std::size_t oscIx = 0; oscIx < kOscillatorCount; ++oscIx) {
            bank.AddMapping(static_cast<PhysicalEncoderId>(8 + oscIx), ParameterById(parameterIds_.modulationCutoff[oscIx]));
            bank.AddMapping(static_cast<PhysicalEncoderId>(12 + oscIx), ParameterById(parameterIds_.frequency[oscIx]));
        }
    }

    void SetInput(ParameterManager& manager) {
        RequireRegistered();
        if (&manager != manager_) {
            throw std::logic_error("Braid 4 VCO module used with a different parameter manager");
        }

        auto linear = [&manager](ParameterId id, std::size_t voiceIx, float minValue, float maxValue,
                                 float& previousRaw, float& previousMapped) {
            const float raw = manager.ParameterById(id).CachedKnobValue(voiceIx);
            if (raw != previousRaw) {
                previousRaw = raw;
                previousMapped = manager.GetLinear(minValue, maxValue, voiceIx, id);
            }
            return previousMapped;
        };
        auto bipolar = [&manager](ParameterId id, std::size_t voiceIx, float maxAbsValue,
                                  float& previousRaw, float& previousMapped) {
            const float raw = manager.ParameterById(id).CachedKnobValue(voiceIx);
            if (raw != previousRaw) {
                previousRaw = raw;
                previousMapped = manager.GetBipolarLinear(maxAbsValue, voiceIx, id);
            }
            return previousMapped;
        };
        auto exponential = [&manager](ParameterId id, std::size_t voiceIx, float minValue, float maxValue,
                                      float& previousRaw, float& previousMapped) {
            const float raw = manager.ParameterById(id).CachedKnobValue(voiceIx);
            if (raw != previousRaw) {
                previousRaw = raw;
                previousMapped = manager.GetExponential(minValue, maxValue, voiceIx, id);
            }
            return previousMapped;
        };
        for (std::size_t voiceIx = 0; voiceIx < kStereoVoiceCount; ++voiceIx) {
            input_.x[voiceIx] = linear(parameterIds_.x, voiceIx, 0.0f, 1.0f,
                                       cachedRaw_.x[voiceIx], cachedMapped_.x[voiceIx]);
            input_.y[voiceIx] = linear(parameterIds_.y, voiceIx, 0.0f, 1.0f,
                                       cachedRaw_.y[voiceIx], cachedMapped_.y[voiceIx]);
        }

        for (std::size_t oscIx = 0; oscIx < kOscillatorCount; ++oscIx) {
            OscillatorInput& oscillator = input_.oscillators[oscIx];
            oscillator.tuneMultiplier = exponential(parameterIds_.quad.tune, oscIx, 0.5f, 2.0f,
                                                    cachedRaw_.tune[oscIx], cachedMapped_.tune[oscIx]);
            oscillator.phaseCycles = bipolar(parameterIds_.quad.phase, oscIx, 1.0f,
                                             cachedRaw_.phase[oscIx], cachedMapped_.phase[oscIx]);
            oscillator.shape = linear(parameterIds_.quad.shape, oscIx, 0.0f, 1.0f,
                                      cachedRaw_.shape[oscIx], cachedMapped_.shape[oscIx]);
            oscillator.gain = bipolar(parameterIds_.quad.gain, oscIx, 1.0f,
                                      cachedRaw_.gain[oscIx], cachedMapped_.gain[oscIx]);
            oscillator.baseFrequencyHz = exponential(parameterIds_.frequency[oscIx], 0,
                                                     kMinFrequencyHz[oscIx], kMaxFrequencyHz[oscIx],
                                                     cachedRaw_.frequency[oscIx],
                                                     cachedMapped_.frequency[oscIx])
                                         * frequencyScale_;
            oscillator.vco.freq = static_cast<double>(oscillator.baseFrequencyHz * oscillator.tuneMultiplier)
                                  / static_cast<double>(sampleRate_);
            oscillator.vco.phaseOffset = oscillator.phaseCycles;
            oscillator.vco.wavetablePosition = oscillator.shape;
            oscillator.vco.maxFreq = 0.5f;
        }
    }

    void Process() {
        for (std::size_t oscIx = 0; oscIx < kOscillatorCount; ++oscIx) {
            rawOutputs_[oscIx] = vcos_[oscIx].Process(input_.oscillators[oscIx].vco);
            oscillatorOutputs_[oscIx] = rawOutputs_[oscIx] * input_.oscillators[oscIx].gain;
        }
        outputs_[0] = MixForPosition(input_.x[0], input_.y[0]);
        outputs_[1] = MixForPosition(input_.x[1], input_.y[1]);
    }

    void PopulateUIState(UIState& state) const {
        for (std::size_t oscIx = 0; oscIx < kOscillatorCount; ++oscIx) {
            vcos_[oscIx].PopulateUIState(state.vcos[oscIx]);
        }
    }

    void SetSampleRate(float sampleRate) {
        if (sampleRate <= 0.0f) {
            throw std::invalid_argument("Braid 4 VCO module sample rate must be positive");
        }
        sampleRate_ = sampleRate;
    }

    float SampleRate() const { return sampleRate_; }

    void SetScopeWriterHolder(std::size_t oscIx, ScopeWriterHolder* holder) {
        if (oscIx >= kOscillatorCount) {
            throw std::out_of_range("Braid 4 VCO oscillator index out of range");
        }
        vcos_[oscIx].SetScopeWriterHolder(holder);
    }

    void SetScopeColor(std::size_t oscIx, Color scopeColor) {
        if (oscIx >= kOscillatorCount) {
            throw std::out_of_range("Braid 4 VCO oscillator index out of range");
        }
        vcos_[oscIx].SetScopeColor(scopeColor);
    }

    bool Registered() const { return registered_; }
    const ParameterIds& Parameters() const { return parameterIds_; }
    const Input& CurrentInput() const { return input_; }
    Input& CurrentInput() { return input_; }
    float OutputLeft() const { return outputs_[0]; }
    float OutputRight() const { return outputs_[1]; }
    float OscillatorOutput(std::size_t oscIx) const { return oscillatorOutputs_.at(oscIx); }
    float RawOutput(std::size_t oscIx) const { return rawOutputs_.at(oscIx); }

private:
    static constexpr std::array<float, kOscillatorCount> kMinFrequencyHz{10.0f, 50.0f, 250.0f, 1000.0f};
    static constexpr std::array<float, kOscillatorCount> kMaxFrequencyHz{160.0f, 800.0f, 2000.0f, 16000.0f};

    template<std::size_t Count>
    static void ValidateDuplicateNames(const ParameterManager& manager, const std::array<std::string, Count>& names,
                                       std::string_view moduleName) {
        for (std::size_t nameIx = 0; nameIx < names.size(); ++nameIx) {
            for (std::size_t otherIx = nameIx + 1; otherIx < names.size(); ++otherIx) {
                if (names[nameIx] == names[otherIx]) {
                    std::string message("duplicate ");
                    message += moduleName;
                    message += " parameter name";
                    throw std::logic_error(message);
                }
            }
            for (std::size_t paramIx = 0; paramIx < manager.ParameterCount(); ++paramIx) {
                if (manager.ParameterById(static_cast<ParameterId>(paramIx)).Name() == names[nameIx]) {
                    std::string message("duplicate ");
                    message += moduleName;
                    message += " parameter name";
                    throw std::logic_error(message);
                }
            }
        }
    }

    static void ValidateCapacity(const ParameterGroup& group, std::size_t required, std::string_view moduleName) {
        if (group.AvailableParameterSlots() < required) {
            std::string message(moduleName);
            message += " parameter capacity exhausted";
            throw std::length_error(message);
        }
    }

    static void ValidateGroupShapes(const ParameterManager& manager, const ParameterGroup& stereo,
                                    const ParameterGroup& quad, const ParameterGroup& mono) {
        if (&stereo.Manager() != &manager || &quad.Manager() != &manager || &mono.Manager() != &manager) {
            throw std::logic_error("Braid 4 VCO module groups must belong to the supplied manager");
        }
        if (stereo.Config().numVoices != 2 || quad.Config().numVoices != 4 || mono.Config().numVoices != 1) {
            throw std::logic_error("Braid 4 VCO module parameter groups have incompatible voice counts");
        }
        if (quad.Config().numModulators < 1) {
            throw std::logic_error("Braid 4 VCO module quad group requires a modulation source slot");
        }
        if (stereo.Config().numScenes != quad.Config().numScenes || stereo.Config().numScenes != mono.Config().numScenes
            || stereo.Config().numScenes == 0) {
            throw std::logic_error("Braid 4 VCO module parameter groups have incompatible scene counts");
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

    static std::string OscillatorShortName(std::string_view base, std::size_t oscIx) {
        std::string result(base);
        result += " ";
        result += std::to_string(oscIx + 1);
        return result;
    }

    static std::array<std::string, 14> ParameterNames(std::string_view prefix) {
        std::array<std::string, 14> names{
            EffectiveName(prefix, "X"),
            EffectiveName(prefix, "Y"),
            EffectiveName(prefix, "Tune"),
            EffectiveName(prefix, "Phase"),
            EffectiveName(prefix, "Shape"),
            EffectiveName(prefix, "Gain"),
            {},
            {},
            {},
            {},
            {},
            {},
            {},
            {},
        };
        for (std::size_t oscIx = 0; oscIx < kOscillatorCount; ++oscIx) {
            names[6 + oscIx] = EffectiveName(prefix, OscillatorShortName("Mod LPF Cutoff", oscIx));
            names[10 + oscIx] = EffectiveName(prefix, OscillatorShortName("Frequency", oscIx));
        }
        return names;
    }

    float MixForPosition(float x, float y) const {
        constexpr float kHalfPi = 1.57079632679489661923f;
        const float clampedX = std::clamp(x, 0.0f, 1.0f);
        const float clampedY = std::clamp(y, 0.0f, 1.0f);
        const float xLow = std::cos(clampedX * kHalfPi);
        const float xHigh = std::sin(clampedX * kHalfPi);
        const float yLow = std::cos(clampedY * kHalfPi);
        const float yHigh = std::sin(clampedY * kHalfPi);

        return oscillatorOutputs_[0] * xLow * yLow
               + oscillatorOutputs_[1] * xHigh * yLow
               + oscillatorOutputs_[2] * xLow * yHigh
               + oscillatorOutputs_[3] * xHigh * yHigh;
    }

    Parameter& ParameterById(ParameterId id) const {
        if (manager_ == nullptr) {
            throw std::logic_error("Braid 4 VCO module parameters are not registered");
        }
        return manager_->ParameterById(id);
    }

    void RequireRegistered() const {
        if (!registered_ || manager_ == nullptr) {
            throw std::logic_error("Braid 4 VCO module parameters are not registered");
        }
    }

    float sampleRate_ = 48000.0f;
    bool registered_ = false;
    ParameterManager* manager_ = nullptr;
    float frequencyScale_ = 1.0f;
    ParameterIds parameterIds_{};
    Input input_{};
    struct CachedMappedInput {
        std::array<float, kStereoVoiceCount> x{};
        std::array<float, kStereoVoiceCount> y{};
        std::array<float, kOscillatorCount> tune{};
        std::array<float, kOscillatorCount> phase{};
        std::array<float, kOscillatorCount> shape{};
        std::array<float, kOscillatorCount> gain{};
        std::array<float, kOscillatorCount> frequency{};
    };
    struct CachedRawInput {
        std::array<float, kStereoVoiceCount> x{FillNaN<kStereoVoiceCount>()};
        std::array<float, kStereoVoiceCount> y{FillNaN<kStereoVoiceCount>()};
        std::array<float, kOscillatorCount> tune{FillNaN<kOscillatorCount>()};
        std::array<float, kOscillatorCount> phase{FillNaN<kOscillatorCount>()};
        std::array<float, kOscillatorCount> shape{FillNaN<kOscillatorCount>()};
        std::array<float, kOscillatorCount> gain{FillNaN<kOscillatorCount>()};
        std::array<float, kOscillatorCount> frequency{FillNaN<kOscillatorCount>()};
    };
    template<std::size_t Count>
    static constexpr std::array<float, Count> FillNaN() {
        std::array<float, Count> values{};
        values.fill(std::numeric_limits<float>::quiet_NaN());
        return values;
    }
    CachedRawInput cachedRaw_{};
    CachedMappedInput cachedMapped_{};
    std::array<DefaultWavetableVco, kOscillatorCount> vcos_;
    std::array<float, kOscillatorCount> rawOutputs_{};
    std::array<float, kOscillatorCount> oscillatorOutputs_{};
    std::array<float, kStereoVoiceCount> outputs_{};
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

    struct Options {
        std::vector<Color> indicatorColors;
    };

    explicit BasicLfoModule(float sampleRate = 48000.0f) {
        SetSampleRate(sampleRate);
    }
    BasicLfoModule(const BasicLfoModule&) = delete;
    BasicLfoModule& operator=(const BasicLfoModule&) = delete;
    BasicLfoModule(BasicLfoModule&&) = delete;
    BasicLfoModule& operator=(BasicLfoModule&&) = delete;

    void RegisterParameters(ParameterManager& manager, ParameterGroup& group, std::string_view prefix = {}) {
        RegisterParameters(manager, group, prefix, Options{});
    }

    void RegisterParameters(ParameterManager& manager, ParameterGroup& group, std::string_view prefix,
                            const Options& options) {
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
                                                                       .baseColor = Color::Green,
                                                                       .indicatorColors = options.indicatorColors,
                                                                   });
        parameterIds_.shape = manager.RegisterParameter(group, {
                                                                   .name = names[1],
                                                                   .shortName = "Shape",
                                                                   .defaultValue = 0.5f,
                                                                   .baseColor = Color::Cyan,
                                                                   .indicatorColors = options.indicatorColors,
                                                               });
        parameterIds_.phaseOffset = manager.RegisterParameter(group, {
                                                                         .name = names[2],
                                                                         .shortName = "Phase",
                                                                         .defaultValue = 0.0f,
                                                                         .baseColor = Color::Indigo,
                                                                         .indicatorColors = options.indicatorColors,
                                                                     });
        parameterIds_.skew = manager.RegisterParameter(group, {
                                                                  .name = names[3],
                                                                  .shortName = "Skew",
                                                                  .defaultValue = 0.5f,
                                                                  .baseColor = Color::Orange,
                                                                  .indicatorColors = options.indicatorColors,
                                                              });
        parameterIds_.exponent = manager.RegisterParameter(group, {
                                                                      .name = names[4],
                                                                      .shortName = "Exp",
                                                                      .defaultValue = 0.5f,
                                                                      .range = RangeKind::Bipolar,
                                                                      .baseColor = Color::Yellow,
                                                                      .indicatorColors = options.indicatorColors,
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
                                                    .sourceColor = Color::Green,
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

    void SetScopeColor(std::size_t voiceIx, Color scopeColor) {
        if (voiceIx >= kVoiceCount) {
            throw std::out_of_range("basic LFO voice index out of range");
        }
        lfos_[voiceIx].SetScopeColor(scopeColor);
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

template<std::size_t Polyphony>
class AdsrModule {
public:
    static_assert(Polyphony > 0);

    static constexpr std::size_t kVoiceCount = Polyphony;
    static constexpr float kMinAttackSeconds = 0.001f;
    static constexpr float kMaxAttackSeconds = 2.0f;
    static constexpr float kMinDecaySeconds = 0.001f;
    static constexpr float kMaxDecaySeconds = 5.0f;
    static constexpr float kMinReleaseSeconds = 0.001f;
    static constexpr float kMaxReleaseSeconds = 5.0f;

    struct ParameterIds {
        ParameterId attack = 0;
        ParameterId decay = 0;
        ParameterId sustain = 0;
        ParameterId release = 0;
    };

    struct Input {
        std::array<AdsrProcessor::Input, kVoiceCount> voices{};
    };

    struct Options {
        std::vector<Color> indicatorColors;
    };

    explicit AdsrModule(float sampleRate = 48000.0f) {
        SetSampleRate(sampleRate);
    }
    AdsrModule(const AdsrModule&) = delete;
    AdsrModule& operator=(const AdsrModule&) = delete;
    AdsrModule(AdsrModule&&) = delete;
    AdsrModule& operator=(AdsrModule&&) = delete;

    void RegisterParameters(ParameterManager& manager, ParameterGroup& group, std::string_view prefix = {}) {
        RegisterParameters(manager, group, prefix, Options{});
    }

    void RegisterParameters(ParameterManager& manager, ParameterGroup& group, std::string_view prefix,
                            const Options& options) {
        if (registered_) {
            throw std::logic_error("ADSR module parameters already registered");
        }

        const std::array<std::string, 4> names{
            EffectiveName(prefix, "Attack"),
            EffectiveName(prefix, "Decay"),
            EffectiveName(prefix, "Sustain"),
            EffectiveName(prefix, "Release"),
        };
        ValidateRegistration(manager, group, names, "ADSR module");

        parameterIds_.attack = manager.RegisterParameter(group, {
                                                                    .name = names[0],
                                                                    .shortName = "Atk",
                                                                    .defaultValue = ExponentialNormalized(
                                                                        kMinAttackSeconds,
                                                                        kMaxAttackSeconds,
                                                                        0.010f),
                                                                    .baseColor = Color::Cyan,
                                                                    .indicatorColors = options.indicatorColors,
                                                                });
        parameterIds_.decay = manager.RegisterParameter(group, {
                                                                   .name = names[1],
                                                                   .shortName = "Dec",
                                                                   .defaultValue = ExponentialNormalized(
                                                                       kMinDecaySeconds,
                                                                       kMaxDecaySeconds,
                                                                       0.100f),
                                                                   .baseColor = Color::Blue,
                                                                   .indicatorColors = options.indicatorColors,
                                                               });
        parameterIds_.sustain = manager.RegisterParameter(group, {
                                                                     .name = names[2],
                                                                     .shortName = "Sus",
                                                                     .defaultValue = 0.7f,
                                                                     .baseColor = Color::Green,
                                                                     .indicatorColors = options.indicatorColors,
                                                                 });
        parameterIds_.release = manager.RegisterParameter(group, {
                                                                     .name = names[3],
                                                                     .shortName = "Rel",
                                                                     .defaultValue = ExponentialNormalized(
                                                                         kMinReleaseSeconds,
                                                                         kMaxReleaseSeconds,
                                                                         0.250f),
                                                                     .baseColor = Color::Orange,
                                                                     .indicatorColors = options.indicatorColors,
                                                                 });
        manager_ = &manager;
        registered_ = true;
    }

    void RegisterToBank(Bank& bank, std::size_t offset) {
        RequireRegistered();
        std::array<Parameter*, 4> parameters{
            &ParameterById(parameterIds_.attack),
            &ParameterById(parameterIds_.decay),
            &ParameterById(parameterIds_.sustain),
            &ParameterById(parameterIds_.release),
        };
        bank.RegisterParameters(parameters, offset);
    }

    void SetInput(ParameterManager& manager, const std::array<bool, kVoiceCount>& gates) {
        RequireRegistered();
        if (&manager != manager_) {
            throw std::logic_error("ADSR module used with a different parameter manager");
        }

        for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
            const float attackSeconds = manager.GetExponential(
                kMinAttackSeconds, kMaxAttackSeconds, voiceIx, parameterIds_.attack);
            const float decaySeconds = manager.GetExponential(
                kMinDecaySeconds, kMaxDecaySeconds, voiceIx, parameterIds_.decay);
            const float releaseSeconds = manager.GetExponential(
                kMinReleaseSeconds, kMaxReleaseSeconds, voiceIx, parameterIds_.release);
            input_.voices[voiceIx] = {
                .attackIncrement = 1.0 / (static_cast<double>(attackSeconds) * sampleRate_),
                .decayIncrement = 1.0 / (static_cast<double>(decaySeconds) * sampleRate_),
                .sustain = manager.GetLinear(0.0f, 1.0f, voiceIx, parameterIds_.sustain),
                .releaseIncrement = 1.0 / (static_cast<double>(releaseSeconds) * sampleRate_),
                .gate = gates[voiceIx],
            };
        }
    }

    void Process() noexcept {
        for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
            outputs_[voiceIx] = processors_[voiceIx].Process(input_.voices[voiceIx]);
        }
    }

    void SetSampleRate(float sampleRate) {
        if (!std::isfinite(sampleRate) || sampleRate <= 0.0f) {
            throw std::invalid_argument("ADSR module sample rate must be finite and positive");
        }
        sampleRate_ = sampleRate;
    }

    float SampleRate() const { return sampleRate_; }
    bool Registered() const { return registered_; }
    const ParameterIds& Parameters() const { return parameterIds_; }
    const Input& CurrentInput() const { return input_; }
    Input& CurrentInput() { return input_; }
    float Output(std::size_t voiceIx) const { return outputs_.at(voiceIx); }
    std::span<const float> Outputs() const noexcept { return outputs_; }

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

    static float ExponentialNormalized(float minimum, float maximum, float value) {
        return std::log(value / minimum) / std::log(maximum / minimum);
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
            throw std::logic_error("ADSR module parameters are not registered");
        }
        return manager_->ParameterById(id);
    }

    void RequireRegistered() const {
        if (!registered_ || manager_ == nullptr) {
            throw std::logic_error("ADSR module parameters are not registered");
        }
    }

    float sampleRate_ = 48000.0f;
    bool registered_ = false;
    ParameterManager* manager_ = nullptr;
    ParameterIds parameterIds_{};
    Input input_{};
    std::array<AdsrProcessor, kVoiceCount> processors_;
    std::array<float, kVoiceCount> outputs_{};
};

template<std::size_t Polyphony>
class ClassicSvfModule {
public:
    static_assert(Polyphony > 0);

    static constexpr std::size_t kVoiceCount = Polyphony;
    static constexpr float kMinCutoffHz = 20.0f;
    static constexpr float kMaxCutoffHz = 20000.0f;
    static constexpr float kMinResonance = 0.5f;
    static constexpr float kMaxResonance = 5.5f;

    struct ParameterIds {
        ParameterId cutoff = 0;
        ParameterId resonance = 0;
        ParameterId blend = 0;
    };

    struct VoiceInput {
        ClassicStateVariableFilter::Input filter;
    };

    struct Input {
        std::array<VoiceInput, kVoiceCount> voices{};
    };

    struct UIState {
        std::array<ClassicStateVariableFilter::UIState, kVoiceCount> filters;
    };

    struct Options {
        std::vector<Color> indicatorColors;
    };

    explicit ClassicSvfModule(float sampleRate = 48000.0f) {
        SetSampleRate(sampleRate);
    }
    ClassicSvfModule(const ClassicSvfModule&) = delete;
    ClassicSvfModule& operator=(const ClassicSvfModule&) = delete;
    ClassicSvfModule(ClassicSvfModule&&) = delete;
    ClassicSvfModule& operator=(ClassicSvfModule&&) = delete;

    void RegisterParameters(ParameterManager& manager, ParameterGroup& group, std::string_view prefix = {}) {
        RegisterParameters(manager, group, prefix, Options{});
    }

    void RegisterParameters(ParameterManager& manager, ParameterGroup& group, std::string_view prefix,
                            const Options& options) {
        if (registered_) {
            throw std::logic_error("classic SVF module parameters already registered");
        }

        const std::array<std::string, 3> names{
            EffectiveName(prefix, "Cutoff"),
            EffectiveName(prefix, "Resonance"),
            EffectiveName(prefix, "Blend"),
        };
        ValidateRegistration(manager, group, names, "classic SVF module");

        parameterIds_.cutoff = manager.RegisterParameter(group, {
                                                                    .name = names[0],
                                                                    .shortName = "Cutoff",
                                                                    .defaultValue = 1.0f,
                                                                    .baseColor = Color::Cyan,
                                                                    .indicatorColors = options.indicatorColors,
                                                                });
        parameterIds_.resonance = manager.RegisterParameter(group, {
                                                                       .name = names[1],
                                                                       .shortName = "Res",
                                                                       .defaultValue = 0.0f,
                                                                       .baseColor = Color::Yellow,
                                                                       .indicatorColors = options.indicatorColors,
                                                                   });
        parameterIds_.blend = manager.RegisterParameter(group, {
                                                                   .name = names[2],
                                                                   .shortName = "Blend",
                                                                   .defaultValue = 0.0f,
                                                                   .range = RangeKind::Bipolar,
                                                                   .baseColor = Color::Orange,
                                                                   .indicatorColors = options.indicatorColors,
                                                               });
        manager_ = &manager;
        registered_ = true;
    }

    void RegisterToBank(Bank& bank, std::size_t offset) {
        RequireRegistered();
        std::array<Parameter*, 3> parameters{
            &ParameterById(parameterIds_.cutoff),
            &ParameterById(parameterIds_.resonance),
            &ParameterById(parameterIds_.blend),
        };
        bank.RegisterParameters(parameters, offset);
    }

    void SetInput(ParameterManager& manager) {
        RequireRegistered();
        if (&manager != manager_) {
            throw std::logic_error("classic SVF module used with a different parameter manager");
        }

        for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
            auto& filter = input_.voices[voiceIx].filter;
            const float cutoffHz = manager.GetExponential(kMinCutoffHz, kMaxCutoffHz, voiceIx, parameterIds_.cutoff);
            filter.cutoff = cutoffHz / sampleRate_;
            filter.resonance = manager.GetExponential(kMinResonance, kMaxResonance, voiceIx,
                                                      parameterIds_.resonance);
            filter.blend = manager.GetBipolarLinear(1.0f, voiceIx, parameterIds_.blend);
        }
    }

    void SetVoiceInput(std::size_t voiceIx, float value) {
        if (voiceIx >= kVoiceCount) {
            throw std::out_of_range("classic SVF voice index out of range");
        }
        input_.voices[voiceIx].filter.value = value;
    }

    void Process() {
        for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
            outputs_[voiceIx] = filters_[voiceIx].Process(input_.voices[voiceIx].filter);
        }
    }

    void PopulateUIState(UIState& state) const {
        for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
            filters_[voiceIx].PopulateUIState(state.filters[voiceIx]);
        }
    }

    void SetSampleRate(float sampleRate) {
        if (sampleRate <= 0.0f) {
            throw std::invalid_argument("classic SVF module sample rate must be positive");
        }
        sampleRate_ = sampleRate;
    }

    float SampleRate() const { return sampleRate_; }

    bool Registered() const { return registered_; }
    const ParameterIds& Parameters() const { return parameterIds_; }
    const Input& CurrentInput() const { return input_; }
    Input& CurrentInput() { return input_; }
    float Output(std::size_t voiceIx) const { return outputs_.at(voiceIx); }

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
            throw std::logic_error("classic SVF module parameters are not registered");
        }
        return manager_->ParameterById(id);
    }

    void RequireRegistered() const {
        if (!registered_ || manager_ == nullptr) {
            throw std::logic_error("classic SVF module parameters are not registered");
        }
    }

    float sampleRate_ = 48000.0f;
    bool registered_ = false;
    ParameterManager* manager_ = nullptr;
    ParameterIds parameterIds_{};
    Input input_{};
    std::array<ClassicStateVariableFilter, kVoiceCount> filters_;
    std::array<float, kVoiceCount> outputs_{};
};

} // namespace synth
