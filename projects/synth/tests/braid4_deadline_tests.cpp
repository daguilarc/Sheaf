#include "Braid4Core.hpp"

#include "synth/Engine.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "Braid 4 deadline tests must not see JUCE headers -- Braid4Core must stay JUCE-free"
#endif

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <iostream>
#include <numeric>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct TestCase {
    const char* name;
    void (*fn)();
};

std::vector<TestCase>& Registry() {
    static std::vector<TestCase> tests;
    return tests;
}

struct Register {
    Register(const char* name, void (*fn)()) {
        Registry().push_back({name, fn});
    }
};

#define TEST_CASE(name) \
    void name(); \
    Register reg_##name(#name, &name); \
    void name()

#define REQUIRE_TRUE(expr) \
    do { \
        if (!(expr)) { \
            std::ostringstream oss; \
            oss << __FILE__ << ":" << __LINE__ << " requirement failed: " #expr; \
            throw std::runtime_error(oss.str()); \
        } \
    } while (false)

void RequireNear(double actual, double expected, double tolerance, const char* expr) {
    if (std::fabs(actual - expected) > tolerance) {
        std::ostringstream oss;
        oss << expr << " expected " << expected << " got " << actual;
        throw std::runtime_error(oss.str());
    }
}

#define REQUIRE_NEAR(actual, expected, tolerance) RequireNear((actual), (expected), (tolerance), #actual)

enum class DeadlineScenario {
    Baseline,
    SparseActive,
};

const char* DeadlineScenarioName(DeadlineScenario scenario) {
    return scenario == DeadlineScenario::Baseline ? "baseline" : "sparse-active";
}

void ConfigureDeadlineScenario(synth::Engine<synth_braid4::Braid4Core>& engine,
                               DeadlineScenario scenario) {
    if (scenario != DeadlineScenario::SparseActive) {
        return;
    }
    synth::Parameter& parameter = engine.Manager().ParameterById(0);
    synth::Parameter* depth = parameter.EnsureModulationDepth(0);
    REQUIRE_TRUE(depth != nullptr);
    depth->SceneCenter(0) = 0.75f;
    depth->SceneCenter(1) = 0.75f;
    engine.Manager().ComputeAllParameters();
}

struct DeadlineStats {
    DeadlineScenario scenario = DeadlineScenario::Baseline;
    double sampleRate = 0.0;
    double averageSeconds = 0.0;
    double p99Seconds = 0.0;
    double blockSeconds = 0.0;
    synth_braid4::Braid4Core::DebugCounterState counters;
    std::vector<float> contiguousLeft;
    std::vector<float> contiguousRight;
    std::vector<float> splitLeft;
    std::vector<float> splitRight;
};

std::vector<float*> PointersFor(std::array<std::vector<float>, 2>& channels) {
    return {channels[0].data(), channels[1].data()};
}

void AssertFiniteStereo(const std::array<std::vector<float>, 2>& channels) {
    bool heardSignal = false;
    for (const auto& channel : channels) {
        for (const float sample : channel) {
            REQUIRE_TRUE(std::isfinite(sample));
            heardSignal = heardSignal || std::fabs(sample) > 0.000001f;
        }
    }
    REQUIRE_TRUE(heardSignal);
}

std::array<std::vector<float>, 2> RunSegments(double sampleRate,
                                              const std::vector<std::size_t>& segmentFrames,
                                              DeadlineScenario scenario) {
    std::uint64_t timestamp = 0;
    synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
    engine.Initialize();
    engine.Prepare(sampleRate, 256);
    ConfigureDeadlineScenario(engine, scenario);

    std::array<std::vector<float>, 2> captured;
    for (const std::size_t frames : segmentFrames) {
        std::array<std::vector<float>, 2> blockStorage{{
            std::vector<float>(frames, 12345.0f),
            std::vector<float>(frames, 12345.0f),
        }};
        std::vector<float*> outputs = PointersFor(blockStorage);
        synth::AudioBlock block{
            .outputs = outputs.data(),
            .numOutputChannels = 2,
            .numFrames = frames,
        };
        engine.ProcessBlock(block, timestamp++);

        captured[0].insert(captured[0].end(), blockStorage[0].begin(), blockStorage[0].end());
        captured[1].insert(captured[1].end(), blockStorage[1].begin(), blockStorage[1].end());
    }
    return captured;
}

DeadlineStats MeasureDeadline(double sampleRate, DeadlineScenario scenario) {
    constexpr std::size_t kBlockFrames = 256;
    constexpr std::size_t kWarmupBlocks = 64;
    constexpr std::size_t kMeasuredBlocks = 512;

    std::uint64_t timestamp = 0;
    synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
    engine.Initialize();
    engine.Prepare(sampleRate, static_cast<int>(kBlockFrames));
    ConfigureDeadlineScenario(engine, scenario);

    std::array<std::vector<float>, 2> blockStorage{{
        std::vector<float>(kBlockFrames, 0.0f),
        std::vector<float>(kBlockFrames, 0.0f),
    }};
    std::vector<float*> outputs = PointersFor(blockStorage);
    synth::AudioBlock block{
        .outputs = outputs.data(),
        .numOutputChannels = 2,
        .numFrames = kBlockFrames,
    };

    for (std::size_t i = 0; i < kWarmupBlocks; ++i) {
        engine.ProcessBlock(block, timestamp++);
    }

    std::vector<double> durations;
    durations.reserve(kMeasuredBlocks);
    for (std::size_t i = 0; i < kMeasuredBlocks; ++i) {
        const auto start = std::chrono::steady_clock::now();
        engine.ProcessBlock(block, timestamp++);
        const auto end = std::chrono::steady_clock::now();
        durations.push_back(std::chrono::duration<double>(end - start).count());
    }

    std::vector<double> sorted = durations;
    std::sort(sorted.begin(), sorted.end());
    const std::size_t p99Index = static_cast<std::size_t>(
        std::ceil(static_cast<double>(sorted.size()) * 0.99)) - 1;

    const auto contiguous = RunSegments(sampleRate, {kBlockFrames * 2}, scenario);
    const auto split = RunSegments(sampleRate, {kBlockFrames, kBlockFrames}, scenario);
    AssertFiniteStereo(contiguous);
    AssertFiniteStereo(split);

    return {
        .scenario = scenario,
        .sampleRate = sampleRate,
        .averageSeconds = std::accumulate(durations.begin(), durations.end(), 0.0) /
                          static_cast<double>(durations.size()),
        .p99Seconds = sorted.at(std::min(p99Index, sorted.size() - 1)),
        .blockSeconds = static_cast<double>(kBlockFrames) / sampleRate,
        .counters = engine.Application().DebugCounters(),
        .contiguousLeft = contiguous[0],
        .contiguousRight = contiguous[1],
        .splitLeft = split[0],
        .splitRight = split[1],
    };
}

void AssertDeadlineAndContinuity(double sampleRate,
                                 DeadlineScenario scenario = DeadlineScenario::Baseline) {
    const DeadlineStats stats = MeasureDeadline(sampleRate, scenario);

    constexpr std::size_t kBlockFrames = 256;
    constexpr std::size_t kMeasuredBlocks = 512;
    constexpr std::size_t kWarmupBlocks = 64;
    const std::size_t expectedProcessedHostFrames = (kWarmupBlocks + kMeasuredBlocks) * kBlockFrames;

    REQUIRE_TRUE(stats.counters.hostFramesProcessed == expectedProcessedHostFrames);
    REQUIRE_TRUE(stats.counters.internalSubframesProcessed == expectedProcessedHostFrames * 4);
    REQUIRE_TRUE(stats.counters.lastInternalSampleIndex == expectedProcessedHostFrames * 4 - 1);
    REQUIRE_TRUE(stats.counters.stereoStandardProcessCalls == stats.counters.internalSubframesProcessed);
    REQUIRE_TRUE(stats.counters.quadStandardProcessCalls == stats.counters.internalSubframesProcessed);
    REQUIRE_TRUE(stats.counters.monoStandardProcessCalls == stats.counters.internalSubframesProcessed);
    REQUIRE_TRUE(stats.counters.stereoStandardUiPublications == kWarmupBlocks + kMeasuredBlocks);
    REQUIRE_TRUE(stats.counters.quadStandardUiPublications == kWarmupBlocks + kMeasuredBlocks);
    REQUIRE_TRUE(stats.counters.monoStandardUiPublications == kWarmupBlocks + kMeasuredBlocks);
    REQUIRE_TRUE(stats.contiguousLeft.size() == kBlockFrames * 2);
    REQUIRE_TRUE(stats.splitLeft.size() == stats.contiguousLeft.size());
    REQUIRE_TRUE(stats.splitRight.size() == stats.contiguousRight.size());

    for (std::size_t frame = 0; frame < stats.contiguousLeft.size(); ++frame) {
        REQUIRE_NEAR(stats.splitLeft[frame], stats.contiguousLeft[frame], 0.000001);
        REQUIRE_NEAR(stats.splitRight[frame], stats.contiguousRight[frame], 0.000001);
    }

    REQUIRE_TRUE(stats.averageSeconds <= stats.blockSeconds * 0.60);
    REQUIRE_TRUE(stats.p99Seconds <= stats.blockSeconds * 0.80);

    std::cout << "[deadline] " << DeadlineScenarioName(stats.scenario) << " "
              << stats.sampleRate << "Hz/" << (stats.sampleRate * 4.0) << "Hz-internal avg="
              << (stats.averageSeconds * 1000.0) << "ms p99="
              << (stats.p99Seconds * 1000.0) << "ms block="
              << (stats.blockSeconds * 1000.0) << "ms\n";

    REQUIRE_TRUE(stats.averageSeconds <= stats.blockSeconds * 0.60);
    REQUIRE_TRUE(stats.p99Seconds <= stats.blockSeconds * 0.80);
}

} // namespace

TEST_CASE(braid4_meets_44100hz_256_frame_deadline_and_continuity) {
    AssertDeadlineAndContinuity(44100.0);
}

TEST_CASE(braid4_meets_48000hz_256_frame_deadline_and_continuity) {
    AssertDeadlineAndContinuity(48000.0);
}

TEST_CASE(braid4_meets_96000hz_256_frame_deadline_and_continuity) {
    AssertDeadlineAndContinuity(96000.0);
}

TEST_CASE(braid4_sparse_modulation_meets_48000hz_256_frame_deadline) {
    AssertDeadlineAndContinuity(48000.0, DeadlineScenario::SparseActive);
}

TEST_CASE(braid4_sparse_modulation_meets_96000hz_256_frame_deadline) {
    AssertDeadlineAndContinuity(96000.0, DeadlineScenario::SparseActive);
}

int main() {
    int failures = 0;
    for (const auto& test : Registry()) {
        try {
            test.fn();
            std::cout << "[PASS] " << test.name << "\n";
        } catch (const std::exception& e) {
            ++failures;
            std::cerr << "[FAIL] " << test.name << ": " << e.what() << "\n";
        } catch (...) {
            ++failures;
            std::cerr << "[FAIL] " << test.name << ": unknown exception\n";
        }
    }

    if (failures != 0) {
        std::cerr << failures << " Braid 4 deadline test(s) failed\n";
        return 1;
    }

    std::cout << "Braid 4 deadline tests passed\n";
    return 0;
}
