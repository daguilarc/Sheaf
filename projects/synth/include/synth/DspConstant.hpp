#pragma once

#include <cstddef>
#include <span>
#include <stdexcept>
#include <vector>

namespace synth {

class ConstantModulatorProcessor {
public:
    explicit ConstantModulatorProcessor(std::size_t voiceCount)
        : outputs_(voiceCount) {
        if (voiceCount == 0) {
            throw std::invalid_argument("constant modulator requires at least one voice");
        }
        InitializeOutputs();
        sourcePointers_.reserve(outputs_.size());
        for (float& output : outputs_) {
            sourcePointers_.push_back(&output);
        }
    }

    ConstantModulatorProcessor(const ConstantModulatorProcessor&) = delete;
    ConstantModulatorProcessor& operator=(const ConstantModulatorProcessor&) = delete;
    ConstantModulatorProcessor(ConstantModulatorProcessor&&) = delete;
    ConstantModulatorProcessor& operator=(ConstantModulatorProcessor&&) = delete;

    std::size_t VoiceCount() const noexcept { return outputs_.size(); }
    float Output(std::size_t voice) const { return outputs_.at(voice); }
    std::span<const float> Outputs() const noexcept { return outputs_; }
    std::span<float* const> SourcePointers() const noexcept { return sourcePointers_; }

private:
    void InitializeOutputs() noexcept {
        const std::size_t voices = outputs_.size();
        if (voices == 1) {
            outputs_[0] = 0.0f;
            return;
        }
        const float denominator = static_cast<float>(voices - 1);
        const std::size_t half = voices / 2;
        if ((voices % 2) == 0) {
            for (std::size_t k = 0; k < half; ++k) {
                outputs_[2 * k] = static_cast<float>(k) / denominator;
                outputs_[2 * k + 1] = static_cast<float>(half + k) / denominator;
            }
            return;
        }
        outputs_[0] = 0.0f;
        outputs_[1] = static_cast<float>(half) / denominator;
        for (std::size_t k = 1; k < half; ++k) {
            outputs_[2 * k] = static_cast<float>(half + k) / denominator;
            outputs_[2 * k + 1] = static_cast<float>(k) / denominator;
        }
        outputs_[voices - 1] = 1.0f;
    }

    std::vector<float> outputs_;
    std::vector<float*> sourcePointers_;
};

} // namespace synth
