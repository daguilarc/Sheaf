#pragma once

#include "synth/ConstantBarVisualizer.hpp"
#include "synth/DspConstant.hpp"
#include "synth/DspNoise.hpp"
#include "synth/DspRandomLfo.hpp"
#include "synth/GangedRandomLfoVisualizer.hpp"
#include "synth/NoiseWaveformVisualizer.hpp"
#include "synth/ParameterModulation.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <stdexcept>
#include <utility>
#include <vector>

namespace synth {

template<std::size_t VoiceCount>
class StandardModulators {
    static_assert(VoiceCount > 0, "standard modulators require at least one voice");

public:
    static constexpr std::size_t kVoiceCount = VoiceCount;
    static constexpr std::size_t kRandomCount = 4;
    static constexpr std::size_t kRequiredModulatorCount = 15;

    struct Configuration {
        std::array<std::size_t, kRandomCount> randomIndexes{};
        std::size_t constantIndex = 0;
        std::size_t noiseIndex = 0;
        std::array<ModulatorMetadata, kRandomCount> randomMetadata{};
        ModulatorMetadata constantMetadata;
        ModulatorMetadata noiseMetadata;
        std::array<GangedRandomLfoInput, kRandomCount> randomInputs{};
        std::vector<Color> randomVoiceColors;
    };

    explicit StandardModulators(ParameterGroup& group)
        : group_(&group),
          config_(DefaultConfiguration()),
          noiseProcessor_(VoiceCount),
          constantProcessor_(VoiceCount),
          randomVisualizer0_(randomProcessors_[0].UiState()),
          randomVisualizer1_(randomProcessors_[1].UiState()),
          randomVisualizer2_(randomProcessors_[2].UiState()),
          randomVisualizer3_(randomProcessors_[3].UiState()),
          noiseVisualizer_(Color::White),
          constantVisualizer_(constantProcessor_.Outputs(), Color::Yellow) {
        for (std::size_t random = 0; random < kRandomCount; ++random) {
            for (std::size_t voice = 0; voice < VoiceCount; ++voice) {
                randomPointerRows_[random][voice] = &randomOutputRows_[random][voice];
            }
        }
    }

    StandardModulators(const StandardModulators&) = delete;
    StandardModulators& operator=(const StandardModulators&) = delete;
    StandardModulators(StandardModulators&&) = delete;
    StandardModulators& operator=(StandardModulators&&) = delete;

    Configuration& Config() {
        if (registered_) {
            throw std::logic_error("standard modulator configuration is frozen after registration");
        }
        return config_;
    }

    const Configuration& Config() const noexcept { return config_; }

    bool IsRegistered() const noexcept { return registered_; }
    bool IsPrepared() const noexcept { return prepared_; }

    void Prepare(double sampleRate) {
        if (!registered_) {
            throw std::logic_error("standard modulators must be registered before preparation");
        }
        if (!std::isfinite(sampleRate) || sampleRate <= 0.0) {
            throw std::invalid_argument("standard modulator sample rate must be finite and positive");
        }
        for (std::size_t random = 0; random < kRandomCount; ++random) {
            randomProcessors_[random].Prepare(sampleRate);
        }
        prepared_ = true;
    }

    void Process() {
        if (!prepared_) {
            throw std::logic_error("standard modulators must be prepared before processing");
        }
        for (std::size_t random = 0; random < kRandomCount; ++random) {
            randomProcessors_[random].Process(config_.randomInputs[random]);
            for (std::size_t voice = 0; voice < VoiceCount; ++voice) {
                randomOutputRows_[random][voice] = randomProcessors_[random].Output(voice);
            }
        }
        noiseProcessor_.Process();
    }

    void PublishUiState() {
        for (std::size_t random = 0; random < kRandomCount; ++random) {
            randomProcessors_[random].PublishUiState();
        }
    }

    void Register() {
        if (registered_) {
            throw std::logic_error("standard modulators are already registered");
        }
        ValidateConfiguration();

        std::array<ModulatorMetadata, kRandomCount> connectedRandomMetadata = config_.randomMetadata;
        for (std::size_t random = 0; random < kRandomCount; ++random) {
            connectedRandomMetadata[random].visualizer = &RandomVisualizer(random);
            connectedRandomMetadata[random].connected = true;
        }
        ModulatorMetadata connectedConstantMetadata = config_.constantMetadata;
        connectedConstantMetadata.visualizer = &constantVisualizer_;
        connectedConstantMetadata.connected = true;
        ModulatorMetadata connectedNoiseMetadata = config_.noiseMetadata;
        connectedNoiseMetadata.visualizer = &noiseVisualizer_;
        connectedNoiseMetadata.connected = true;

        for (std::size_t random = 0; random < kRandomCount; ++random) {
            for (std::size_t voice = 0; voice < VoiceCount; ++voice) {
                randomProcessors_[random].SetVoiceColor(voice, config_.randomVoiceColors[voice]);
            }
        }
        noiseVisualizer_.SetColor(config_.noiseMetadata.sourceColor);
        constantVisualizer_.SetColor(config_.constantMetadata.sourceColor);
        for (std::size_t random = 0; random < kRandomCount; ++random) {
            group_->SetModulationSource(
                config_.randomIndexes[random],
                randomPointerRows_[random],
                std::move(connectedRandomMetadata[random]));
        }
        group_->SetModulationSource(
            config_.noiseIndex,
            noiseProcessor_.SourcePointers(),
            std::move(connectedNoiseMetadata));
        if constexpr (VoiceCount > 1) {
            group_->SetModulationSource(
                config_.constantIndex,
                constantProcessor_.SourcePointers(),
                std::move(connectedConstantMetadata));
        }
        registered_ = true;
    }

    ParameterGroup& TargetGroup() noexcept { return *group_; }
    const ParameterGroup& TargetGroup() const noexcept { return *group_; }

    GangedRandomLfoProcessor<VoiceCount>& RandomProcessor(std::size_t random) {
        return randomProcessors_.at(random);
    }
    const GangedRandomLfoProcessor<VoiceCount>& RandomProcessor(std::size_t random) const {
        return randomProcessors_.at(random);
    }

    GangedRandomLfoInput& RandomInput(std::size_t random) {
        if (registered_) {
            throw std::logic_error("standard modulator configuration is frozen after registration");
        }
        return config_.randomInputs.at(random);
    }
    const GangedRandomLfoInput& RandomInput(std::size_t random) const {
        return config_.randomInputs.at(random);
    }

    std::array<float, VoiceCount>& RandomOutputRow(std::size_t random) {
        return randomOutputRows_.at(random);
    }
    const std::array<float, VoiceCount>& RandomOutputRow(std::size_t random) const {
        return randomOutputRows_.at(random);
    }

    std::array<float*, VoiceCount>& RandomPointerRow(std::size_t random) {
        return randomPointerRows_.at(random);
    }
    const std::array<float*, VoiceCount>& RandomPointerRow(std::size_t random) const {
        return randomPointerRows_.at(random);
    }

    ui::GangedRandomLfoVisualizer<VoiceCount>& RandomVisualizer(std::size_t random) {
        switch (random) {
        case 0: return randomVisualizer0_;
        case 1: return randomVisualizer1_;
        case 2: return randomVisualizer2_;
        case 3: return randomVisualizer3_;
        default: throw std::out_of_range("standard random visualizer index out of range");
        }
    }
    const ui::GangedRandomLfoVisualizer<VoiceCount>& RandomVisualizer(std::size_t random) const {
        switch (random) {
        case 0: return randomVisualizer0_;
        case 1: return randomVisualizer1_;
        case 2: return randomVisualizer2_;
        case 3: return randomVisualizer3_;
        default: throw std::out_of_range("standard random visualizer index out of range");
        }
    }

    NoiseModulatorProcessor& NoiseProcessor() noexcept { return noiseProcessor_; }
    const NoiseModulatorProcessor& NoiseProcessor() const noexcept { return noiseProcessor_; }
    ConstantModulatorProcessor& ConstantProcessor() noexcept { return constantProcessor_; }
    const ConstantModulatorProcessor& ConstantProcessor() const noexcept { return constantProcessor_; }
    ui::NoiseWaveformVisualizer& NoiseVisualizer() noexcept { return noiseVisualizer_; }
    const ui::NoiseWaveformVisualizer& NoiseVisualizer() const noexcept { return noiseVisualizer_; }
    ui::ConstantBarVisualizer& ConstantVisualizer() noexcept { return constantVisualizer_; }
    const ui::ConstantBarVisualizer& ConstantVisualizer() const noexcept { return constantVisualizer_; }

private:
    static GangedRandomLfoInput DefaultRandomInput(double waitingMean, float targetSigma) {
        return {
            .waiting = {
                .muSeconds = waitingMean,
                .sigmaSeconds = 0.3 * waitingMean,
                .internalSigmaHz = 0.2 / waitingMean,
            },
            .moving = {
                .muSeconds = waitingMean / 2.0,
                .sigmaSeconds = 0.15 * waitingMean,
                .internalSigmaHz = 0.4 / waitingMean,
            },
            .targetInternalSigma = targetSigma,
        };
    }

    static Configuration DefaultConfiguration() {
        Configuration config;
        config.randomIndexes = {0, 1, 2, 3};
        config.constantIndex = 11;
        config.noiseIndex = 14;
        config.randomMetadata = {
            ModulatorMetadata{"Random 500 ms", "Rnd .5", Color::Cyan},
            ModulatorMetadata{"Random 2 s", "Rnd 2", Color::Blue},
            ModulatorMetadata{"Random 6 s", "Rnd 6", Color::Indigo},
            ModulatorMetadata{"Random 16 s", "Rnd 16", Color::Orange},
        };
        config.constantMetadata = ModulatorMetadata{"Constant", "Const", Color::Yellow};
        config.noiseMetadata = ModulatorMetadata{"Noise", "Noise", Color::White};
        config.randomInputs = {
            DefaultRandomInput(0.5, 0.1f),
            DefaultRandomInput(2.0, 0.3f),
            DefaultRandomInput(6.0, 0.2f),
            DefaultRandomInput(16.0, 0.1f),
        };
        const std::array<Color, 4> defaultVoiceColors{
            Color::Cyan, Color::Orange, Color::Green, Color::Yellow};
        const std::size_t defaultColorCount = std::min<std::size_t>(VoiceCount, defaultVoiceColors.size());
        config.randomVoiceColors.assign(
            defaultVoiceColors.begin(),
            defaultVoiceColors.begin() + static_cast<std::ptrdiff_t>(defaultColorCount));
        return config;
    }

    static void ValidateMetadata(const ModulatorMetadata& metadata) {
        if (metadata.name.empty() || metadata.shortName.empty()) {
            throw std::invalid_argument("active standard modulator metadata names must not be empty");
        }
    }

    static void ValidateTiming(const RandomTimingConfig& timing) {
        if (!std::isfinite(timing.muSeconds)) {
            throw std::invalid_argument("standard random timing mean must be finite");
        }
        if (!std::isfinite(timing.sigmaSeconds) || timing.sigmaSeconds < 0.0) {
            throw std::invalid_argument("standard random timing sigma must be finite and nonnegative");
        }
        if (!std::isfinite(timing.internalSigmaHz) || timing.internalSigmaHz < 0.0) {
            throw std::invalid_argument("standard random internal sigma must be finite and nonnegative");
        }
    }

    static void ValidateInput(const GangedRandomLfoInput& input) {
        ValidateTiming(input.waiting);
        ValidateTiming(input.moving);
        if (!std::isfinite(input.targetInternalSigma) || input.targetInternalSigma < 0.0f) {
            throw std::invalid_argument("standard random target sigma must be finite and nonnegative");
        }
    }

    void ValidateConfiguration() const {
        if (group_->GetModulators().NumVoices() != VoiceCount ||
            group_->GetModulators().NumModulators() != kRequiredModulatorCount) {
            throw std::invalid_argument("standard modulators require an exact matching fifteen-source group");
        }
        if (config_.randomVoiceColors.size() != VoiceCount) {
            throw std::invalid_argument("standard random voice palette must match the group voice count");
        }

        std::array<bool, kRequiredModulatorCount> usedIndexes{};
        const auto validateIndex = [&usedIndexes](std::size_t index) {
            if (index >= kRequiredModulatorCount) {
                throw std::invalid_argument("active standard modulator index is out of range");
            }
            if (usedIndexes[index]) {
                throw std::invalid_argument("active standard modulator indexes must be unique");
            }
            usedIndexes[index] = true;
        };

        for (std::size_t random = 0; random < kRandomCount; ++random) {
            validateIndex(config_.randomIndexes[random]);
            ValidateMetadata(config_.randomMetadata[random]);
            ValidateInput(config_.randomInputs[random]);
        }
        validateIndex(config_.noiseIndex);
        ValidateMetadata(config_.noiseMetadata);
        if constexpr (VoiceCount > 1) {
            validateIndex(config_.constantIndex);
            ValidateMetadata(config_.constantMetadata);
        }
    }

    ParameterGroup* group_ = nullptr;
    Configuration config_;
    std::array<GangedRandomLfoProcessor<VoiceCount>, kRandomCount> randomProcessors_{};
    std::array<std::array<float, VoiceCount>, kRandomCount> randomOutputRows_{};
    std::array<std::array<float*, VoiceCount>, kRandomCount> randomPointerRows_{};
    NoiseModulatorProcessor noiseProcessor_;
    ConstantModulatorProcessor constantProcessor_;
    ui::GangedRandomLfoVisualizer<VoiceCount> randomVisualizer0_;
    ui::GangedRandomLfoVisualizer<VoiceCount> randomVisualizer1_;
    ui::GangedRandomLfoVisualizer<VoiceCount> randomVisualizer2_;
    ui::GangedRandomLfoVisualizer<VoiceCount> randomVisualizer3_;
    ui::NoiseWaveformVisualizer noiseVisualizer_;
    ui::ConstantBarVisualizer constantVisualizer_;
    bool registered_ = false;
    bool prepared_ = false;
};

} // namespace synth
