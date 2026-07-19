#include "synth/MasterClock.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "master clock tests must not see JUCE headers"
#endif

#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdlib>
#include <exception>
#include <iostream>
#include <limits>
#include <new>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <type_traits>
#include <utility>
#include <vector>

namespace allocation_probe {

std::atomic<bool> enabled{false};
std::atomic<std::size_t> count{0};

} // namespace allocation_probe

void* operator new(std::size_t size) {
    if (allocation_probe::enabled.load(std::memory_order_relaxed)) {
        allocation_probe::count.fetch_add(1, std::memory_order_relaxed);
    }
    if (void* memory = std::malloc(size)) {
        return memory;
    }
    throw std::bad_alloc();
}

void* operator new[](std::size_t size) {
    return ::operator new(size);
}

void operator delete(void* memory) noexcept {
    std::free(memory);
}

void operator delete[](void* memory) noexcept {
    std::free(memory);
}

void operator delete(void* memory, std::size_t) noexcept {
    std::free(memory);
}

void operator delete[](void* memory, std::size_t) noexcept {
    std::free(memory);
}

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
    if (!std::isfinite(actual) || std::fabs(actual - expected) > tolerance) {
        std::ostringstream oss;
        oss << expr << " expected " << expected << " got " << actual;
        throw std::runtime_error(oss.str());
    }
}

#define REQUIRE_NEAR(actual, expected, tolerance) RequireNear((actual), (expected), (tolerance), #actual)

static_assert(std::is_trivially_copyable_v<synth::SyncConfig>);
static_assert(std::is_trivially_copyable_v<synth::ClockDiagnostics>);
static_assert(std::is_trivially_copyable_v<synth::ClockPlanDescriptor>);
static_assert(std::is_trivially_copyable_v<synth::ClockBlockPlan>);
static_assert(std::is_trivially_copyable_v<synth::AudioSampleTimeMapper::Diagnostics>);
static_assert(sizeof(synth::ClockPlanDescriptor) <= 96);
static_assert(sizeof(synth::ClockBlockPlan) <= 96);
static_assert(noexcept(std::declval<const synth::ClockBlockPlan&>().Contains(0.0)));
static_assert(noexcept(std::declval<const synth::ClockBlockPlan&>().LifetimeQuarterNotesAt(0.0)));
static_assert(noexcept(std::declval<const synth::ClockBlockPlan&>().TransportQuarterNotesAt(0.0)));
static_assert(noexcept(std::declval<synth::AudioSampleTimeMapper&>().ObserveBlock(0, 0)));
static_assert(noexcept(std::declval<const synth::AudioSampleTimeMapper&>().TimeMicrosAt(0.0)));
static_assert(noexcept(std::declval<synth::MasterClock&>().CommitBlock(0, 64, 0)));
static_assert(std::is_same_v<
              decltype(std::declval<const synth::MasterClock&>().CurrentPlan()),
              const synth::ClockBlockPlan*>);

} // namespace

TEST_CASE(sync_config_defaults_and_validation_are_deterministic) {
    const synth::SyncConfig defaults;
    REQUIRE_TRUE(!defaults.sendClock);
    REQUIRE_TRUE(!defaults.receiveClock);
    REQUIRE_TRUE(!defaults.sendTransport);
    REQUIRE_TRUE(!defaults.receiveTransport);
    REQUIRE_TRUE(defaults.ppqn == 24);
    REQUIRE_TRUE(defaults.IsValid());

    synth::SyncConfig low = defaults;
    low.ppqn = 0;
    REQUIRE_TRUE(!low.IsValid());
    synth::SyncConfig high = defaults;
    high.ppqn = 961;
    REQUIRE_TRUE(!high.IsValid());
    synth::SyncConfig edge = defaults;
    edge.ppqn = 960;
    REQUIRE_TRUE(edge.IsValid());
}

TEST_CASE(clock_plan_queries_stopped_lifetime_on_a_half_open_fractional_range) {
    const synth::ClockBlockPlan plan{synth::ClockPlanDescriptor{
        .startSample = 100,
        .endSample = 164,
        .lifetimeStartQuarterNotes = 2.0,
        .transportStartQuarterNotes = 0.0,
        .quarterNotesPerSample = 0.01,
        .transportState = synth::ClockTransportState::Stopped,
        .transportEpoch = 7,
        .generation = 11,
    }};

    REQUIRE_TRUE(plan.StartSample() == 100);
    REQUIRE_TRUE(plan.EndSample() == 164);
    REQUIRE_TRUE(plan.FrameCount() == 64);
    REQUIRE_TRUE(plan.Contains(100.0));
    REQUIRE_TRUE(plan.Contains(163.999));
    REQUIRE_TRUE(!plan.Contains(99.999));
    REQUIRE_TRUE(!plan.Contains(164.0));
    REQUIRE_TRUE(!plan.Contains(std::numeric_limits<double>::quiet_NaN()));
    REQUIRE_NEAR(plan.LifetimeQuarterNotesAt(100.0), 2.0, 0.0);
    REQUIRE_NEAR(plan.LifetimeQuarterNotesAt(103.5), 2.035, 1.0e-15);
    REQUIRE_NEAR(plan.LifetimeEndQuarterNotes(), 2.64, 1.0e-15);
    REQUIRE_NEAR(plan.TransportQuarterNotesAt(103.5), 0.0, 0.0);
    REQUIRE_NEAR(plan.TransportEndQuarterNotes(), 0.0, 0.0);
    REQUIRE_TRUE(!plan.TryLifetimeQuarterNotesAt(164.0).has_value());
    REQUIRE_TRUE(!plan.TryTransportQuarterNotesAt(99.0).has_value());
}

TEST_CASE(clock_plan_queries_running_transport_at_integer_and_fractional_positions) {
    const synth::ClockBlockPlan plan{synth::ClockPlanDescriptor{
        .startSample = 4096,
        .endSample = 4160,
        .lifetimeStartQuarterNotes = 10.0,
        .transportStartQuarterNotes = 1.25,
        .quarterNotesPerSample = 1.0 / 480.0,
        .transportState = synth::ClockTransportState::Running,
        .transportEpoch = 3,
        .generation = 8,
    }};

    REQUIRE_TRUE(plan.IsTransportRunning());
    REQUIRE_NEAR(plan.LifetimeQuarterNotesAt(4100.0), 10.0 + 4.0 / 480.0, 1.0e-15);
    REQUIRE_NEAR(plan.TransportQuarterNotesAt(4102.5), 1.25 + 6.5 / 480.0, 1.0e-15);
    REQUIRE_NEAR(plan.TransportEndQuarterNotes(), 1.25 + 64.0 / 480.0, 1.0e-15);
    REQUIRE_TRUE(plan.TransportEpoch() == 3);
    REQUIRE_TRUE(plan.Generation() == 8);
}

TEST_CASE(master_clock_default_and_prepare_state_match_the_output_domain_contract) {
    synth::MasterClock clock;
    REQUIRE_TRUE(!clock.IsPrepared());
    REQUIRE_TRUE(clock.CurrentPlan() == nullptr);
    REQUIRE_TRUE(clock.TransportState() == synth::ClockTransportState::Stopped);
    REQUIRE_TRUE(!clock.IsTransportRunning());
    REQUIRE_NEAR(clock.LifetimeQuarterNotes(), 0.0, 0.0);
    REQUIRE_NEAR(clock.TransportQuarterNotes(), 0.0, 0.0);
    REQUIRE_NEAR(clock.TempoBpm(), 120.0, 0.0);
    REQUIRE_NEAR(clock.QuarterNotesPerSample(), 0.0, 0.0);

    REQUIRE_TRUE(clock.Prepare(48000.0, 64));
    REQUIRE_TRUE(clock.IsPrepared());
    REQUIRE_NEAR(clock.SampleRate(), 48000.0, 0.0);
    REQUIRE_TRUE(clock.BlockSize() == 64);
    REQUIRE_NEAR(clock.QuarterNotesPerSample(), 120.0 / (60.0 * 48000.0), 1.0e-18);
    REQUIRE_TRUE(clock.OutputLatencyMicros() == 5000);

    const auto diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.acquisition == synth::ClockAcquisitionState::Internal);
    REQUIRE_TRUE(diagnostics.source == synth::ClockSource::Internal);
    REQUIRE_NEAR(diagnostics.currentBpm, 120.0, 0.0);
    REQUIRE_TRUE(diagnostics.outputLatencyMicros == 5000);
}

TEST_CASE(master_clock_rejects_invalid_prepare_and_tempo_transactionally) {
    synth::MasterClock clock;
    REQUIRE_TRUE(!clock.Prepare(0.0, 64));
    REQUIRE_TRUE(!clock.Prepare(std::numeric_limits<double>::infinity(), 64));
    REQUIRE_TRUE(!clock.Prepare(48000.0, 0));
    REQUIRE_TRUE(!clock.IsPrepared());

    REQUIRE_TRUE(clock.Prepare(48000.0, 64));
    const double priorBpm = clock.TempoBpm();
    const double priorIncrement = clock.QuarterNotesPerSample();
    REQUIRE_TRUE(!clock.SetTempoBpm(0.0));
    REQUIRE_TRUE(!clock.SetTempoBpm(-1.0));
    REQUIRE_TRUE(!clock.SetTempoBpm(std::numeric_limits<double>::quiet_NaN()));
    REQUIRE_TRUE(!clock.SetTempoBpm(std::numeric_limits<double>::infinity()));
    REQUIRE_NEAR(clock.TempoBpm(), priorBpm, 0.0);
    REQUIRE_NEAR(clock.QuarterNotesPerSample(), priorIncrement, 0.0);
}

TEST_CASE(master_clock_receive_authority_rejects_manual_tempo_and_restores_it) {
    synth::MasterClock clock;
    REQUIRE_TRUE(clock.Prepare(48000.0, 64));
    REQUIRE_TRUE(clock.SetTempoBpm(90.0));

    synth::SyncConfig external = clock.SyncConfiguration();
    external.receiveClock = true;
    REQUIRE_TRUE(clock.ApplySyncConfig(external));
    REQUIRE_TRUE(clock.DiagnosticsSnapshot().acquisition == synth::ClockAcquisitionState::Acquiring);
    REQUIRE_TRUE(!clock.SetTempoBpm(75.0));
    REQUIRE_NEAR(clock.TempoBpm(), 90.0, 0.0);

    external.receiveClock = false;
    REQUIRE_TRUE(clock.ApplySyncConfig(external));
    REQUIRE_NEAR(clock.TempoBpm(), 90.0, 0.0);
    REQUIRE_NEAR(clock.QuarterNotesPerSample(), 90.0 / (60.0 * 48000.0), 1.0e-18);
    REQUIRE_TRUE(clock.DiagnosticsSnapshot().acquisition == synth::ClockAcquisitionState::Internal);

    synth::SyncConfig invalid = external;
    invalid.ppqn = 0;
    REQUIRE_TRUE(!clock.ApplySyncConfig(invalid));
    REQUIRE_TRUE(clock.SyncConfiguration() == external);
}

TEST_CASE(master_clock_commits_exact_adjacent_anchors_and_only_future_tempo_slopes) {
    synth::MasterClock clock;
    REQUIRE_TRUE(clock.Prepare(48000.0, 64));

    const synth::ClockBlockPlan* firstPointer = clock.CommitBlock(1000, 64, 1'000'000);
    REQUIRE_TRUE(firstPointer != nullptr);
    REQUIRE_TRUE(firstPointer == clock.CurrentPlan());
    const synth::ClockBlockPlan first = *firstPointer;
    const double oldIncrement = first.QuarterNotesPerSample();
    REQUIRE_TRUE(clock.SetTempoBpm(60.0));
    REQUIRE_NEAR(firstPointer->QuarterNotesPerSample(), oldIncrement, 0.0);
    REQUIRE_NEAR(firstPointer->LifetimeEndQuarterNotes(), first.LifetimeEndQuarterNotes(), 0.0);

    const std::uint64_t secondTimestamp = 1'000'000 + 1'333;
    const synth::ClockBlockPlan* secondPointer = clock.CommitBlock(1064, 64, secondTimestamp);
    REQUIRE_TRUE(secondPointer != nullptr);
    REQUIRE_TRUE(secondPointer == clock.CurrentPlan());
    REQUIRE_TRUE(secondPointer->StartSample() == first.EndSample());
    REQUIRE_NEAR(secondPointer->LifetimeStartQuarterNotes(), first.LifetimeEndQuarterNotes(), 0.0);
    REQUIRE_NEAR(secondPointer->QuarterNotesPerSample(), 60.0 / (60.0 * 48000.0), 1.0e-18);
    REQUIRE_TRUE(first.LifetimeQuarterNotesAt(1063.0) < secondPointer->LifetimeQuarterNotesAt(1064.0));
}

TEST_CASE(master_clock_maps_delayed_timestamps_through_bounded_plan_history) {
    synth::MasterClock clock;
    REQUIRE_TRUE(clock.Prepare(100.0, 10));
    REQUIRE_TRUE(clock.CommitBlock(100, 10, 1'000'000) != nullptr);
    REQUIRE_TRUE(clock.CommitBlock(110, 10, 1'100'000) != nullptr);

    const auto sample = clock.SampleAtTimestamp(1'055'000);
    REQUIRE_TRUE(sample.has_value());
    REQUIRE_NEAR(*sample, 105.5, 1.0e-12);
    const auto point = clock.TimeAtTimestamp(1'055'000);
    REQUIRE_TRUE(point.has_value());
    REQUIRE_NEAR(point->samplePosition, 105.5, 1.0e-12);
    REQUIRE_NEAR(point->lifetimeQuarterNotes, 0.11, 1.0e-15);
    REQUIRE_NEAR(point->transportQuarterNotes, 0.0, 0.0);

    std::uint64_t start = 120;
    std::uint64_t timestamp = 1'200'000;
    for (std::size_t index = 0; index < synth::MasterClock::kPlanHistoryCapacity + 3; ++index) {
        REQUIRE_TRUE(clock.CommitBlock(start, 10, timestamp) != nullptr);
        start += 10;
        timestamp += 100'000;
    }
    REQUIRE_TRUE(clock.PlanHistorySize() == synth::MasterClock::kPlanHistoryCapacity);
    REQUIRE_TRUE(!clock.PlanAtSample(100.0).has_value());
    REQUIRE_TRUE(clock.PlanAtSample(static_cast<double>(start - 1)).has_value());
}

TEST_CASE(audio_sample_time_mapper_anchors_epoch_and_preserves_ordinary_continuity) {
    synth::AudioSampleTimeMapper mapper;
    REQUIRE_TRUE(!mapper.IsPrepared());
    REQUIRE_TRUE(!mapper.Prepare(0.0, 5000));
    REQUIRE_TRUE(mapper.Prepare(48000.0, 5000));
    REQUIRE_NEAR(mapper.NominalMicrosPerSample(), 1'000'000.0 / 48000.0, 1.0e-15);

    REQUIRE_TRUE(mapper.ObserveBlock(0, 1'000'000) == synth::MapperObservationResult::Anchored);
    const auto priorEnd = mapper.TimeMicrosAt(64.0);
    REQUIRE_TRUE(priorEnd.has_value());
    REQUIRE_TRUE(mapper.ObserveBlock(64, 1'001'500) == synth::MapperObservationResult::Continuous);
    const auto nextStart = mapper.TimeMicrosAt(64.0);
    REQUIRE_TRUE(nextStart.has_value());
    REQUIRE_NEAR(*nextStart, *priorEnd, 0.0);
    REQUIRE_NEAR(*mapper.TimeMicrosAt(0.0), 1'000'000.0, 0.0);

    const auto timestamp = mapper.TimestampMicrosAt(24.0);
    REQUIRE_TRUE(timestamp.has_value());
    REQUIRE_TRUE(*timestamp == 1'000'500);
    const auto sample = mapper.SampleAtTimestamp(1'000'500);
    REQUIRE_TRUE(sample.has_value());
    REQUIRE_NEAR(*sample, 24.0, 1.0e-9);
}

TEST_CASE(audio_sample_time_mapper_applies_five_error_median_and_one_over_32_ewma) {
    synth::AudioSampleTimeMapper mapper;
    REQUIRE_TRUE(mapper.Prepare(1000.0, 1'000'000));
    REQUIRE_TRUE(mapper.ObserveBlock(0, 0) == synth::MapperObservationResult::Anchored);
    REQUIRE_TRUE(mapper.ObserveBlock(100, 100'320) == synth::MapperObservationResult::Continuous);
    auto diagnostics = mapper.DiagnosticsSnapshot();
    REQUIRE_NEAR(diagnostics.latestPhaseErrorMicros, 320.0, 0.0);
    REQUIRE_NEAR(diagnostics.medianPhaseErrorMicros, 320.0, 0.0);
    REQUIRE_NEAR(diagnostics.filteredPhaseErrorMicros, 10.0, 1.0e-12);
    REQUIRE_NEAR(diagnostics.currentMicrosPerSample, 1000.1, 1.0e-12);

    synth::AudioSampleTimeMapper medianMapper;
    REQUIRE_TRUE(medianMapper.Prepare(1000.0, 1'000'000));
    REQUIRE_TRUE(medianMapper.ObserveBlock(0, 0) == synth::MapperObservationResult::Anchored);
    const double errors[] = {50.0, 10.0, 90.0, 30.0, 70.0};
    for (std::uint64_t index = 0; index < 5; ++index) {
        const std::uint64_t sample = (index + 1) * 100;
        const auto predicted = medianMapper.TimeMicrosAt(static_cast<double>(sample));
        REQUIRE_TRUE(predicted.has_value());
        const auto observed = static_cast<std::uint64_t>(std::llround(*predicted + errors[index]));
        REQUIRE_TRUE(medianMapper.ObserveBlock(sample, observed) == synth::MapperObservationResult::Continuous);
    }
    diagnostics = medianMapper.DiagnosticsSnapshot();
    REQUIRE_NEAR(diagnostics.medianPhaseErrorMicros, 50.0, 1.0);
    REQUIRE_TRUE(diagnostics.phaseErrorCount == 5);
}

TEST_CASE(audio_sample_time_mapper_caps_future_slew_at_five_hundred_ppm) {
    synth::AudioSampleTimeMapper slow;
    REQUIRE_TRUE(slow.Prepare(1000.0, 2'000'000));
    REQUIRE_TRUE(slow.ObserveBlock(0, 0) == synth::MapperObservationResult::Anchored);
    const double pastTime = *slow.TimeMicrosAt(5.0);
    REQUIRE_TRUE(slow.ObserveBlock(10, 1'010'000) == synth::MapperObservationResult::Continuous);
    REQUIRE_NEAR(slow.DiagnosticsSnapshot().currentMicrosPerSample, 1000.5, 1.0e-12);
    REQUIRE_NEAR(*slow.TimeMicrosAt(5.0), pastTime, 0.0);
    REQUIRE_NEAR(*slow.TimeMicrosAt(10.0), 10'000.0, 0.0);

    synth::AudioSampleTimeMapper fast;
    REQUIRE_TRUE(fast.Prepare(1000.0, 20'000));
    REQUIRE_TRUE(fast.ObserveBlock(0, 0) == synth::MapperObservationResult::Anchored);
    REQUIRE_TRUE(fast.ObserveBlock(10, 1'000) == synth::MapperObservationResult::Continuous);
    REQUIRE_NEAR(fast.DiagnosticsSnapshot().currentMicrosPerSample, 999.5, 1.0e-12);
}

TEST_CASE(audio_sample_time_mapper_resets_generation_on_host_discontinuity) {
    synth::AudioSampleTimeMapper mapper;
    REQUIRE_TRUE(mapper.Prepare(1000.0, 5000));
    REQUIRE_TRUE(mapper.ObserveBlock(0, 100'000) == synth::MapperObservationResult::Anchored);
    REQUIRE_TRUE(mapper.ObserveBlock(10, 120'001) == synth::MapperObservationResult::Discontinuity);

    const auto diagnostics = mapper.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.generation == 2);
    REQUIRE_TRUE(diagnostics.discontinuityCount == 1);
    REQUIRE_TRUE(diagnostics.lateEventCount == 1);
    REQUIRE_TRUE(diagnostics.phaseErrorCount == 0);
    REQUIRE_NEAR(diagnostics.latestPhaseErrorMicros, 10'001.0, 0.0);
    REQUIRE_NEAR(*mapper.TimeMicrosAt(10.0), 120'001.0, 0.0);
    REQUIRE_NEAR(*mapper.TimeMicrosAt(5.0), 105'000.0, 0.0);
}

TEST_CASE(audio_sample_time_mapper_history_is_bounded_and_long_run_mapping_stays_finite_monotonic) {
    synth::AudioSampleTimeMapper mapper;
    REQUIRE_TRUE(mapper.Prepare(1000.0, 5000));
    REQUIRE_TRUE(mapper.ObserveBlock(0, 1000) == synth::MapperObservationResult::Anchored);

    double previous = *mapper.TimeMicrosAt(0.0);
    for (std::uint64_t sample = 64; sample <= 640'000; sample += 64) {
        const std::uint64_t timestamp = 1000 + sample * 1000;
        REQUIRE_TRUE(mapper.ObserveBlock(sample, timestamp) == synth::MapperObservationResult::Continuous);
        const double current = *mapper.TimeMicrosAt(static_cast<double>(sample));
        REQUIRE_TRUE(std::isfinite(current));
        REQUIRE_TRUE(current > previous);
        previous = current;
    }
    REQUIRE_TRUE(mapper.HistorySize() == synth::AudioSampleTimeMapper::kHistoryCapacity);
    REQUIRE_TRUE(!mapper.TimeMicrosAt(0.0).has_value());
    REQUIRE_TRUE(mapper.TimeMicrosAt(640'000.5).has_value());
}

TEST_CASE(master_clock_commit_query_and_mapper_paths_allocate_nothing_after_prepare) {
    synth::MasterClock clock;
    REQUIRE_TRUE(clock.Prepare(48000.0, 64));
    REQUIRE_TRUE(clock.CommitBlock(0, 64, 1'000'000) != nullptr);

    allocation_probe::count.store(0, std::memory_order_relaxed);
    allocation_probe::enabled.store(true, std::memory_order_release);
    for (std::uint64_t block = 1; block <= 1000; ++block) {
        const std::uint64_t start = block * 64;
        const std::uint64_t timestamp = 1'000'000 + (start * 1'000'000) / 48000;
        const synth::ClockBlockPlan* plan = clock.CommitBlock(start, 64, timestamp);
        if (plan == nullptr || !plan->TryLifetimeQuarterNotesAt(static_cast<double>(start) + 0.5).has_value()) {
            allocation_probe::enabled.store(false, std::memory_order_release);
            throw std::runtime_error("realtime clock operation failed");
        }
        (void)clock.TimeAtSample(static_cast<double>(start) + 1.0);
        (void)clock.TimeMapper().TimestampMicrosAt(static_cast<double>(start) + 1.0);
    }
    allocation_probe::enabled.store(false, std::memory_order_release);

    REQUIRE_TRUE(allocation_probe::count.load(std::memory_order_relaxed) == 0);
}

int main() {
    int failed = 0;
    for (const auto& test : Registry()) {
        try {
            test.fn();
            std::cout << "[PASS] " << test.name << "\n";
        } catch (const std::exception& ex) {
            ++failed;
            std::cerr << "[FAIL] " << test.name << ": " << ex.what() << "\n";
        }
    }
    return failed == 0 ? 0 : 1;
}
