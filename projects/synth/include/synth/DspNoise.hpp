#pragma once

#include <cstddef>
#include <cstdint>
#include <random>
#include <span>
#include <stdexcept>
#include <vector>

namespace synth {

class FastPcg32 {
public:
    explicit FastPcg32(std::uint64_t seed) noexcept { Seed(seed); }

    std::uint32_t NextWord() noexcept {
        const std::uint64_t previous = state_;
        state_ = previous * 6364136223846793005ULL + increment_;
        const std::uint32_t xorshifted =
            static_cast<std::uint32_t>(((previous >> 18U) ^ previous) >> 27U);
        const std::uint32_t rotation = static_cast<std::uint32_t>(previous >> 59U);
        return (xorshifted >> rotation) | (xorshifted << ((-rotation) & 31U));
    }

    float UniformOpen01() noexcept {
        const std::uint32_t bits = NextWord() >> 9U;
        return (static_cast<float>(bits) + 0.5f) * 0x1p-23f;
    }

private:
    void Seed(std::uint64_t seed) noexcept {
        state_ = 0;
        NextWord();
        state_ += seed;
        NextWord();
    }

    std::uint64_t state_ = 0;
    static constexpr std::uint64_t increment_ = 1442695040888963407ULL;
};

inline std::uint64_t NoiseInitializationSeed() {
    std::random_device entropy;
    return (static_cast<std::uint64_t>(entropy()) << 32U) ^
           static_cast<std::uint64_t>(entropy());
}

class NoiseModulatorProcessor {
public:
    explicit NoiseModulatorProcessor(std::size_t voiceCount)
        : NoiseModulatorProcessor(voiceCount, NoiseInitializationSeed()) {}

    NoiseModulatorProcessor(std::size_t voiceCount, std::uint64_t seed)
        : outputs_(voiceCount), random_(seed) {
        if (voiceCount == 0) {
            throw std::invalid_argument("noise modulator requires at least one voice");
        }
        sourcePointers_.reserve(outputs_.size());
        for (float& output : outputs_) {
            sourcePointers_.push_back(&output);
        }
    }

    NoiseModulatorProcessor(const NoiseModulatorProcessor&) = delete;
    NoiseModulatorProcessor& operator=(const NoiseModulatorProcessor&) = delete;
    NoiseModulatorProcessor(NoiseModulatorProcessor&&) = delete;
    NoiseModulatorProcessor& operator=(NoiseModulatorProcessor&&) = delete;

    void Process() noexcept {
        for (float& output : outputs_) {
            output = random_.UniformOpen01();
        }
    }

    std::size_t VoiceCount() const noexcept { return outputs_.size(); }
    float Output(std::size_t voice) const { return outputs_.at(voice); }
    std::span<const float> Outputs() const noexcept { return outputs_; }
    std::span<float* const> SourcePointers() const noexcept { return sourcePointers_; }

private:
    std::vector<float> outputs_;
    std::vector<float*> sourcePointers_;
    FastPcg32 random_;
};

} // namespace synth
