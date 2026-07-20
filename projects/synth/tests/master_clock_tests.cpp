#include "synth/MasterClock.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "master clock tests must not see JUCE headers"
#endif

#include <atomic>
#include <algorithm>
#include <array>
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
static_assert(std::is_trivially_copyable_v<synth::ScheduledMidiEvent>);
static_assert(sizeof(synth::ClockPlanDescriptor) <= 96);
static_assert(sizeof(synth::ClockBlockPlan) <= 96);
static_assert(noexcept(std::declval<const synth::ClockBlockPlan&>().Contains(0.0)));
static_assert(noexcept(std::declval<const synth::ClockBlockPlan&>().LifetimeQuarterNotesAt(0.0)));
static_assert(noexcept(std::declval<const synth::ClockBlockPlan&>().TransportQuarterNotesAt(0.0)));
static_assert(noexcept(std::declval<synth::AudioSampleTimeMapper&>().ObserveBlock(0, 0)));
static_assert(noexcept(std::declval<const synth::AudioSampleTimeMapper&>().TimeMicrosAt(0.0)));
static_assert(noexcept(std::declval<synth::MasterClock&>().CommitBlock(0, 64, 0)));
static_assert(noexcept(std::declval<synth::MasterClock&>().HandleInternalTransport(
    synth::ClockTransportCommand::Start)));
static_assert(noexcept(std::declval<synth::MasterClock&>().HandleExternalTransport(
    synth::ClockTransportCommand::Start, 0, 0)));
static_assert(noexcept(std::declval<synth::MasterClock&>().HandleExternalClock(0, 0)));
static_assert(std::is_same_v<
              decltype(std::declval<const synth::MasterClock&>().CurrentPlan()),
              const synth::ClockBlockPlan*>);

template <std::size_t Capacity>
class FixedScheduledSink final : public synth::IScheduledMidiEventSink {
public:
    bool TryEnqueue(const synth::ScheduledMidiEvent& event) noexcept override {
        if (size_ == Capacity) {
            return false;
        }
        events_[size_++] = event;
        return true;
    }

    std::size_t Size() const noexcept { return size_; }
    const synth::ScheduledMidiEvent& operator[](std::size_t index) const noexcept {
        return events_[index];
    }

    std::size_t Count(synth::ScheduledMidiEventKind kind) const noexcept {
        std::size_t count = 0;
        for (std::size_t index = 0; index < size_; ++index) {
            if (events_[index].kind == kind) {
                ++count;
            }
        }
        return count;
    }

private:
    std::array<synth::ScheduledMidiEvent, Capacity> events_{};
    std::size_t size_ = 0;
};

template <typename Record, std::size_t Capacity>
class FixedTrace {
public:
    bool Push(const Record& record) noexcept {
        if (size_ == Capacity) {
            return false;
        }
        records_[size_++] = record;
        return true;
    }

    std::size_t Size() const noexcept { return size_; }
    const Record& operator[](std::size_t index) const noexcept {
        return records_[index];
    }

private:
    std::array<Record, Capacity> records_{};
    std::size_t size_ = 0;
};

template <std::size_t Capacity>
const synth::ScheduledMidiEvent* FindEvent(
    const FixedScheduledSink<Capacity>& sink,
    synth::ScheduledMidiEventKind kind,
    std::size_t occurrence = 0) noexcept {
    for (std::size_t index = 0; index < sink.Size(); ++index) {
        if (sink[index].kind == kind) {
            if (occurrence == 0) {
                return &sink[index];
            }
            --occurrence;
        }
    }
    return nullptr;
}

template <std::size_t Capacity>
std::size_t CountEventsAtDeadline(
    const FixedScheduledSink<Capacity>& sink,
    synth::ScheduledMidiEventKind kind,
    std::uint64_t dueTimeMicros) noexcept {
    std::size_t count = 0;
    for (std::size_t index = 0; index < sink.Size(); ++index) {
        if (sink[index].kind == kind && sink[index].dueTimeMicros == dueTimeMicros) {
            ++count;
        }
    }
    return count;
}

template <std::size_t Capacity>
const synth::ScheduledMidiEvent* FindEventAtDeadline(
    const FixedScheduledSink<Capacity>& sink,
    synth::ScheduledMidiEventKind kind,
    std::uint64_t dueTimeMicros) noexcept {
    for (std::size_t index = 0; index < sink.Size(); ++index) {
        if (sink[index].kind == kind && sink[index].dueTimeMicros == dueTimeMicros) {
            return &sink[index];
        }
    }
    return nullptr;
}

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

TEST_CASE(master_clock_adds_host_scheduling_horizon_after_the_full_base_latency) {
    synth::MasterClock clock;
    clock.SetOutputSchedulingHorizonMicros(25'000);
    REQUIRE_TRUE(clock.OutputSchedulingHorizonMicros() == 25'000);
    REQUIRE_TRUE(clock.Prepare(48'000.0, 128));

    // ceil(max(2 * 128 / 48k, 5ms) + 25ms) = 30,334us. The
    // horizon is additive, leaving the complete two-block handoff margin
    // before the host-timestamped sink snapshot becomes irreversible.
    REQUIRE_TRUE(clock.OutputLatencyMicros() == 30'334);

    synth::MasterClock overflowing;
    overflowing.SetOutputSchedulingHorizonMicros(
        std::numeric_limits<std::uint64_t>::max());
    REQUIRE_TRUE(!overflowing.Prepare(48'000.0, 128));
    REQUIRE_TRUE(!overflowing.IsPrepared());
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

TEST_CASE(master_clock_prepare_rejects_a_saved_tempo_whose_slope_underflows) {
    synth::MasterClock clock;
    const double denormalTempo = std::numeric_limits<double>::denorm_min();
    REQUIRE_TRUE(clock.SetTempoBpm(denormalTempo));

    REQUIRE_TRUE(!clock.Prepare(48000.0, 64));
    REQUIRE_TRUE(!clock.IsPrepared());
    REQUIRE_TRUE(!clock.TimeMapper().IsPrepared());
    REQUIRE_TRUE(clock.CurrentPlan() == nullptr);
    REQUIRE_NEAR(clock.TempoBpm(), denormalTempo, 0.0);
    REQUIRE_NEAR(clock.SampleRate(), 0.0, 0.0);
    REQUIRE_TRUE(clock.BlockSize() == 0);
    REQUIRE_TRUE(clock.OutputLatencyMicros() == 0);
    REQUIRE_NEAR(clock.QuarterNotesPerSample(), 0.0, 0.0);
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

TEST_CASE(master_clock_underflowing_tempo_rejection_preserves_clock_state) {
    synth::MasterClock clock;
    REQUIRE_TRUE(clock.Prepare(48000.0, 64));
    REQUIRE_TRUE(clock.CommitBlock(0, 64, 1'000'000) != nullptr);
    const synth::ClockBlockPlan priorPlan = *clock.CurrentPlan();
    const std::size_t priorMapperHistorySize = clock.TimeMapper().HistorySize();
    const std::size_t priorPlanHistorySize = clock.PlanHistorySize();
    const double priorTempo = clock.TempoBpm();
    const double priorIncrement = clock.QuarterNotesPerSample();

    REQUIRE_TRUE(!clock.SetTempoBpm(std::numeric_limits<double>::denorm_min()));

    REQUIRE_NEAR(clock.TempoBpm(), priorTempo, 0.0);
    REQUIRE_NEAR(clock.QuarterNotesPerSample(), priorIncrement, 0.0);
    REQUIRE_TRUE(clock.TimeMapper().HistorySize() == priorMapperHistorySize);
    REQUIRE_TRUE(clock.PlanHistorySize() == priorPlanHistorySize);
    REQUIRE_TRUE(clock.CurrentPlan() != nullptr);
    REQUIRE_TRUE(clock.CurrentPlan()->Descriptor().startSample == priorPlan.Descriptor().startSample);
    REQUIRE_TRUE(clock.CurrentPlan()->Descriptor().endSample == priorPlan.Descriptor().endSample);
    REQUIRE_NEAR(
        clock.CurrentPlan()->LifetimeStartQuarterNotes(),
        priorPlan.LifetimeStartQuarterNotes(),
        0.0);

    REQUIRE_TRUE(clock.CommitBlock(64, 64, 1'001'333) != nullptr);
    REQUIRE_TRUE(clock.TimeMapper().HistorySize() == priorMapperHistorySize + 1);
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

TEST_CASE(mapper_rejections_are_diagnosed_separately_from_ignored_midi_input) {
    synth::AudioSampleTimeMapper mapper;
    REQUIRE_TRUE(mapper.Prepare(1000.0, 5000));
    REQUIRE_TRUE(mapper.ObserveBlock(0, 1000) == synth::MapperObservationResult::Anchored);
    REQUIRE_TRUE(mapper.ObserveBlock(0, 1001) == synth::MapperObservationResult::Rejected);
    REQUIRE_TRUE(mapper.DiagnosticsSnapshot().ignoredObservationCount == 1);

    synth::ClockDiagnostics diagnostics;
    diagnostics.ignoredInputCount = 7;
    diagnostics.mapperIgnoredObservationCount =
        mapper.DiagnosticsSnapshot().ignoredObservationCount;
    REQUIRE_TRUE(diagnostics.ignoredInputCount == 7);
    REQUIRE_TRUE(diagnostics.mapperIgnoredObservationCount == 1);

    synth::MasterClock clock;
    REQUIRE_TRUE(clock.Prepare(48000.0, 64));
    const auto clockDiagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(clockDiagnostics.ignoredInputCount == 0);
    REQUIRE_TRUE(clockDiagnostics.mapperIgnoredObservationCount == 0);
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

TEST_CASE(master_clock_internal_transport_uses_boundary_epochs_and_current_run_time) {
    synth::MasterClock clock;
    FixedScheduledSink<64> sink;
    clock.SetScheduledMidiEventSink(&sink);
    synth::SyncConfig config;
    config.sendClock = true;
    config.sendTransport = true;
    config.ppqn = 4;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(100.0, 10));

    REQUIRE_TRUE(clock.CommitBlock(0, 10, 1'000'000) != nullptr);
    REQUIRE_TRUE(clock.TransportState() == synth::ClockTransportState::Stopped);
    REQUIRE_TRUE(sink.Count(synth::ScheduledMidiEventKind::TimingClock) == 0);

    REQUIRE_TRUE(clock.HandleInternalTransport(synth::ClockTransportCommand::Start));
    REQUIRE_TRUE(clock.TransportState() == synth::ClockTransportState::Stopped);
    const synth::ClockBlockPlan* started = clock.CommitBlock(10, 10, 1'100'000);
    REQUIRE_TRUE(started != nullptr);
    REQUIRE_TRUE(started->TransportState() == synth::ClockTransportState::Running);
    REQUIRE_NEAR(started->TransportStartQuarterNotes(), 0.0, 0.0);
    REQUIRE_TRUE(started->TransportEpoch() == 1);

    const auto* cutoff = FindEvent(sink, synth::ScheduledMidiEventKind::PhaseGenerationCutoff);
    const auto* start = FindEvent(sink, synth::ScheduledMidiEventKind::Start);
    const auto* zero = FindEvent(sink, synth::ScheduledMidiEventKind::TimingClock);
    REQUIRE_TRUE(cutoff != nullptr);
    REQUIRE_TRUE(start != nullptr);
    REQUIRE_TRUE(zero != nullptr);
    REQUIRE_TRUE(cutoff->dueTimeMicros == 1'300'000);
    REQUIRE_TRUE(start->dueTimeMicros == cutoff->dueTimeMicros);
    REQUIRE_TRUE(zero->dueTimeMicros == cutoff->dueTimeMicros);
    REQUIRE_TRUE(cutoff->orderingIntent == synth::ScheduledMidiOrderingIntent::GenerationCutoff);
    REQUIRE_TRUE(start->orderingIntent == synth::ScheduledMidiOrderingIntent::Transport);
    REQUIRE_TRUE(zero->orderingIntent == synth::ScheduledMidiOrderingIntent::Clock);
    REQUIRE_TRUE(cutoff->sequence < start->sequence);
    REQUIRE_TRUE(start->sequence < zero->sequence);
    REQUIRE_TRUE(zero->phaseGeneration == cutoff->phaseGeneration);
    REQUIRE_TRUE(cutoff->invalidatedPhaseGeneration + 1 == cutoff->phaseGeneration);
    REQUIRE_TRUE(sink.Count(synth::ScheduledMidiEventKind::TimingClock) == 1);

    REQUIRE_TRUE(clock.CommitBlock(20, 10, 1'200'000) != nullptr);
    const auto* fractionalTick = FindEvent(
        sink, synth::ScheduledMidiEventKind::TimingClock, 1);
    REQUIRE_TRUE(fractionalTick != nullptr);
    REQUIRE_TRUE(fractionalTick->dueTimeMicros == 1'425'000);

    REQUIRE_TRUE(clock.HandleInternalTransport(synth::ClockTransportCommand::Stop));
    const synth::ClockBlockPlan* stopped = clock.CommitBlock(30, 10, 1'300'000);
    REQUIRE_TRUE(stopped != nullptr);
    REQUIRE_TRUE(stopped->TransportState() == synth::ClockTransportState::Stopped);
    REQUIRE_NEAR(stopped->TransportStartQuarterNotes(), 0.0, 0.0);
    REQUIRE_TRUE(stopped->TransportEpoch() == 1);
    const auto* stop = FindEvent(sink, synth::ScheduledMidiEventKind::Stop);
    REQUIRE_TRUE(stop != nullptr);
    REQUIRE_TRUE(stop->dueTimeMicros == 1'500'000);
    for (std::size_t index = 0; index < sink.Size(); ++index) {
        REQUIRE_TRUE(!(sink[index].kind == synth::ScheduledMidiEventKind::TimingClock &&
                       sink[index].dueTimeMicros == stop->dueTimeMicros));
    }

    REQUIRE_TRUE(clock.HandleInternalTransport(synth::ClockTransportCommand::Continue));
    const synth::ClockBlockPlan* continued = clock.CommitBlock(40, 10, 1'400'000);
    REQUIRE_TRUE(continued != nullptr);
    REQUIRE_TRUE(continued->TransportState() == synth::ClockTransportState::Running);
    REQUIRE_NEAR(continued->TransportStartQuarterNotes(), 0.0, 0.0);
    REQUIRE_TRUE(continued->TransportEpoch() == 2);
    REQUIRE_TRUE(FindEvent(sink, synth::ScheduledMidiEventKind::Continue) != nullptr);
}

TEST_CASE(master_clock_external_start_arms_and_first_clock_is_timestamped_zero) {
    synth::MasterClock clock;
    FixedScheduledSink<64> sink;
    clock.SetScheduledMidiEventSink(&sink);
    synth::SyncConfig config;
    config.sendClock = true;
    config.receiveClock = true;
    config.sendTransport = true;
    config.receiveTransport = true;
    config.ppqn = 4;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(1000.0, 100));
    const synth::ClockBlockPlan* prior = clock.CommitBlock(0, 100, 1'000'000);
    REQUIRE_TRUE(prior != nullptr);
    const synth::ClockBlockPlan immutablePrior = *prior;

    REQUIRE_TRUE(clock.HandleExternalTransport(
        synth::ClockTransportCommand::Start, 1'050'000, 2));
    auto diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.hasActiveExternalSource);
    REQUIRE_TRUE(diagnostics.activeExternalSourceSlot == 2);
    REQUIRE_TRUE(diagnostics.sourceIsProvisional);
    REQUIRE_TRUE(clock.HandleExternalClock(1'075'000, 2));
    diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(!diagnostics.sourceIsProvisional);
    REQUIRE_TRUE(diagnostics.acceptedExternalClockCount == 1);
    REQUIRE_TRUE(clock.CurrentPlan()->TransportState() == synth::ClockTransportState::Stopped);
    REQUIRE_NEAR(
        clock.CurrentPlan()->LifetimeStartQuarterNotes(),
        immutablePrior.LifetimeStartQuarterNotes(),
        0.0);

    const auto* start = FindEvent(sink, synth::ScheduledMidiEventKind::Start);
    const auto* zero = FindEvent(sink, synth::ScheduledMidiEventKind::TimingClock);
    REQUIRE_TRUE(start != nullptr);
    REQUIRE_TRUE(zero != nullptr);
    REQUIRE_TRUE(start->dueTimeMicros == 1'250'000);
    REQUIRE_TRUE(zero->dueTimeMicros == 1'275'000);

    const synth::ClockBlockPlan* running = clock.CommitBlock(100, 100, 1'100'000);
    REQUIRE_TRUE(running != nullptr);
    REQUIRE_TRUE(running->TransportState() == synth::ClockTransportState::Running);
    REQUIRE_NEAR(running->TransportStartQuarterNotes(), 0.05, 1.0e-12);
    REQUIRE_TRUE(running->TransportEpoch() == 1);
    REQUIRE_TRUE(!clock.HandleExternalClock(1'125'000, 1));
    REQUIRE_TRUE(clock.DiagnosticsSnapshot().ignoredInputCount == 1);

    REQUIRE_TRUE(clock.HandleExternalTransport(
        synth::ClockTransportCommand::Stop, 1'150'000, 2));
    REQUIRE_TRUE(clock.CurrentPlan()->TransportState() == synth::ClockTransportState::Running);
    const synth::ClockBlockPlan* stopped = clock.CommitBlock(200, 100, 1'200'000);
    REQUIRE_TRUE(stopped != nullptr);
    REQUIRE_TRUE(stopped->TransportState() == synth::ClockTransportState::Stopped);
    REQUIRE_NEAR(stopped->TransportStartQuarterNotes(), 0.0, 0.0);
    REQUIRE_TRUE(stopped->LifetimeStartQuarterNotes() >
                 immutablePrior.LifetimeStartQuarterNotes());

    REQUIRE_TRUE(clock.HandleExternalTransport(
        synth::ClockTransportCommand::Stop, 1'225'000, 2));
    REQUIRE_TRUE(clock.CommitBlock(300, 100, 1'300'000) != nullptr);
    REQUIRE_TRUE(clock.TransportState() == synth::ClockTransportState::Stopped);
    REQUIRE_TRUE(sink.Count(synth::ScheduledMidiEventKind::Stop) == 2);
}

TEST_CASE(master_clock_receive_gating_and_send_policy_are_independent) {
    synth::MasterClock clock;
    FixedScheduledSink<16> sink;
    clock.SetScheduledMidiEventSink(&sink);
    synth::SyncConfig config;
    config.sendTransport = true;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(1000.0, 100));
    REQUIRE_TRUE(clock.CommitBlock(0, 100, 10'000) != nullptr);

    REQUIRE_TRUE(!clock.HandleExternalClock(20'000, 4));
    REQUIRE_TRUE(!clock.HandleExternalTransport(
        synth::ClockTransportCommand::Start, 20'000, 4));
    REQUIRE_TRUE(clock.DiagnosticsSnapshot().ignoredInputCount == 2);
    REQUIRE_TRUE(clock.HandleInternalTransport(synth::ClockTransportCommand::Start));
    REQUIRE_TRUE(clock.CommitBlock(100, 100, 110'000) != nullptr);
    REQUIRE_TRUE(clock.IsTransportRunning());
    REQUIRE_TRUE(sink.Count(synth::ScheduledMidiEventKind::Start) == 1);
    REQUIRE_TRUE(sink.Count(synth::ScheduledMidiEventKind::TimingClock) == 0);
}

TEST_CASE(master_clock_transport_only_external_input_keeps_internal_tempo_authority) {
    synth::MasterClock clock;
    synth::SyncConfig config;
    config.receiveTransport = true;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(1000.0, 100));
    REQUIRE_TRUE(clock.CommitBlock(0, 100, 1'000'000) != nullptr);
    REQUIRE_TRUE(clock.HandleExternalTransport(
        synth::ClockTransportCommand::Start, 1'050'000, 6));
    const auto diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.acquisition == synth::ClockAcquisitionState::Internal);
    REQUIRE_TRUE(diagnostics.source == synth::ClockSource::Internal);
    REQUIRE_NEAR(diagnostics.currentBpm, 120.0, 0.0);
}

TEST_CASE(master_clock_pll_uses_median_and_one_eighth_ewma) {
    synth::MasterClock clock;
    synth::SyncConfig config;
    config.receiveClock = true;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(1000.0, 10'000));
    REQUIRE_TRUE(clock.CommitBlock(0, 10'000, 1'000'000) != nullptr);

    std::uint64_t timestamp = 1'000'000;
    REQUIRE_TRUE(clock.HandleExternalClock(timestamp, 0));
    timestamp += 1000;
    REQUIRE_TRUE(clock.HandleExternalClock(timestamp, 0));
    auto diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_NEAR(diagnostics.externalRawIntervalMicros, 1000.0, 0.0);
    REQUIRE_NEAR(diagnostics.externalMedianIntervalMicros, 1000.0, 0.0);
    REQUIRE_NEAR(diagnostics.externalFilteredPeriodMicros, 1000.0, 0.0);

    timestamp += 1100;
    REQUIRE_TRUE(clock.HandleExternalClock(timestamp, 0));
    diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_NEAR(diagnostics.externalMedianIntervalMicros, 1050.0, 0.0);
    REQUIRE_NEAR(diagnostics.externalFilteredPeriodMicros, 1006.25, 1.0e-12);
    REQUIRE_TRUE(diagnostics.acquisition == synth::ClockAcquisitionState::Locked);

    timestamp += 900;
    REQUIRE_TRUE(clock.HandleExternalClock(timestamp, 0));
    diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_NEAR(diagnostics.externalMedianIntervalMicros, 1000.0, 0.0);
    REQUIRE_NEAR(diagnostics.externalFilteredPeriodMicros, 1005.46875, 1.0e-12);
}

TEST_CASE(master_clock_pll_recovers_120_bpm_after_64_exact_intervals) {
    synth::MasterClock clock;
    synth::SyncConfig config;
    config.receiveClock = true;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(48'000.0, 100'000));
    REQUIRE_TRUE(clock.CommitBlock(0, 100'000, 1'000'000) != nullptr);

    constexpr long double periodMicros = 60'000'000.0L / (120.0L * 24.0L);
    for (std::uint64_t tick = 0; tick <= 64; ++tick) {
        const auto timestamp = static_cast<std::uint64_t>(
            std::llround(1'000'000.0L + periodMicros * static_cast<long double>(tick)));
        REQUIRE_TRUE(clock.HandleExternalClock(timestamp, 7));
    }
    const auto diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.acquisition == synth::ClockAcquisitionState::Locked);
    REQUIRE_TRUE(diagnostics.acceptedExternalClockCount == 65);
    REQUIRE_TRUE(diagnostics.externalInputTickIndex == 64);
    REQUIRE_NEAR(diagnostics.currentBpm, 120.0, 0.1);
}

TEST_CASE(master_clock_pll_rejects_duplicate_and_out_of_order_and_infers_multiples_two_to_eight) {
    synth::MasterClock clock;
    synth::SyncConfig config;
    config.receiveClock = true;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(1000.0, 10'000));
    REQUIRE_TRUE(clock.CommitBlock(0, 10'000, 1'000'000) != nullptr);

    std::uint64_t timestamp = 1'000'000;
    REQUIRE_TRUE(clock.HandleExternalClock(timestamp, 1));
    timestamp += 20'000;
    REQUIRE_TRUE(clock.HandleExternalClock(timestamp, 1));
    const auto acceptedBeforeRejects =
        clock.DiagnosticsSnapshot().acceptedExternalClockCount;
    REQUIRE_TRUE(!clock.HandleExternalClock(timestamp, 1));
    REQUIRE_TRUE(!clock.HandleExternalClock(timestamp - 1, 1));
    REQUIRE_TRUE(!clock.HandleExternalClock(timestamp + 10'000, 1));
    REQUIRE_TRUE(!clock.HandleExternalClock(timestamp + 28'000, 1));
    REQUIRE_TRUE(clock.DiagnosticsSnapshot().acceptedExternalClockCount ==
                 acceptedBeforeRejects);

    std::uint64_t expectedTickIndex = 1;
    std::uint64_t expectedMissed = 0;
    for (std::uint64_t multiple = 2; multiple <= 8; ++multiple) {
        timestamp += multiple * 20'000;
        REQUIRE_TRUE(clock.HandleExternalClock(timestamp, 1));
        expectedTickIndex += multiple;
        expectedMissed += multiple - 1;
    }
    const auto diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.externalInputTickIndex == expectedTickIndex);
    REQUIRE_TRUE(diagnostics.inferredMissedPulseCount == expectedMissed);
    REQUIRE_TRUE(diagnostics.ignoredInputCount == 4);
    REQUIRE_NEAR(diagnostics.externalFilteredPeriodMicros, 20'000.0, 1.0e-9);
}

TEST_CASE(master_clock_pll_bounds_phase_correction_and_hard_reacquires_beyond_two_pulses) {
    synth::MasterClock clock;
    REQUIRE_TRUE(clock.SetTempoBpm(60.0));
    synth::SyncConfig config;
    config.receiveClock = true;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(48'000.0, 100'000));
    REQUIRE_TRUE(clock.CommitBlock(0, 100'000, 1'000'000) != nullptr);
    const synth::ClockBlockPlan committed = *clock.CurrentPlan();

    constexpr long double periodMicros = 60'000'000.0L / (120.0L * 24.0L);
    REQUIRE_TRUE(clock.HandleExternalClock(1'000'000, 0));
    for (std::uint64_t tick = 1; tick <= 3; ++tick) {
        const auto timestamp = static_cast<std::uint64_t>(
            std::llround(1'000'000.0L + periodMicros * static_cast<long double>(tick)));
        REQUIRE_TRUE(clock.HandleExternalClock(timestamp, 0));
    }
    auto diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(std::fabs(diagnostics.appliedPhaseCorrectionPulsePeriods) <= 0.25);
    REQUIRE_NEAR(
        std::fabs(diagnostics.appliedPhaseCorrectionPulsePeriods), 0.25, 1.0e-4);
    const double baseSlope =
        1.0 / (24.0 * diagnostics.externalFilteredPeriodMicros * 48'000.0 / 1'000'000.0);
    REQUIRE_TRUE(clock.QuarterNotesPerSample() >= baseSlope * 0.75);
    REQUIRE_TRUE(clock.QuarterNotesPerSample() <= baseSlope * 1.25);
    REQUIRE_NEAR(
        clock.CurrentPlan()->QuarterNotesPerSample(),
        committed.QuarterNotesPerSample(),
        0.0);

    const auto reacquireTimestamp = static_cast<std::uint64_t>(
        std::llround(1'000'000.0L + periodMicros * 5.0L));
    REQUIRE_TRUE(clock.HandleExternalClock(reacquireTimestamp, 0));
    diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.hardReacquireCount >= 1);
    REQUIRE_NEAR(diagnostics.appliedPhaseCorrectionPulsePeriods, 0.0, 0.0);
}

TEST_CASE(master_clock_pll_phase_correction_can_slow_a_future_plan_but_stays_positive) {
    synth::MasterClock clock;
    REQUIRE_TRUE(clock.SetTempoBpm(240.0));
    synth::SyncConfig config;
    config.receiveClock = true;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(48'000.0, 100'000));
    REQUIRE_TRUE(clock.CommitBlock(0, 100'000, 1'000'000) != nullptr);
    REQUIRE_TRUE(clock.HandleExternalClock(1'000'000, 0));
    REQUIRE_TRUE(clock.HandleExternalClock(1'020'833, 0));

    const auto diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.appliedPhaseCorrectionPulsePeriods < 0.0);
    REQUIRE_TRUE(diagnostics.appliedPhaseCorrectionPulsePeriods >= -0.25);
    const double baseSlope =
        1.0 / (24.0 * diagnostics.externalFilteredPeriodMicros * 48'000.0 / 1'000'000.0);
    REQUIRE_TRUE(clock.QuarterNotesPerSample() >= baseSlope * 0.75);
    REQUIRE_TRUE(clock.QuarterNotesPerSample() < baseSlope);
}

TEST_CASE(master_clock_source_arbitration_provisional_lock_timeout_and_takeover_are_deterministic) {
    synth::MasterClock provisional;
    synth::SyncConfig config;
    config.receiveClock = true;
    config.receiveTransport = true;
    REQUIRE_TRUE(provisional.ApplySyncConfig(config));
    REQUIRE_TRUE(provisional.Prepare(1000.0, 100));
    REQUIRE_TRUE(provisional.CommitBlock(0, 100, 1'000'000) != nullptr);
    REQUIRE_TRUE(provisional.HandleExternalTransport(
        synth::ClockTransportCommand::Start, 1'010'000, 3));
    REQUIRE_TRUE(provisional.DiagnosticsSnapshot().sourceIsProvisional);
    REQUIRE_TRUE(!provisional.HandleExternalTransport(
        synth::ClockTransportCommand::Continue, 1'020'000, 4));
    REQUIRE_TRUE(provisional.HandleExternalClock(1'030'000, 3));
    REQUIRE_TRUE(!provisional.DiagnosticsSnapshot().sourceIsProvisional);

    synth::MasterClock clock;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(1000.0, 100));
    REQUIRE_TRUE(clock.CommitBlock(0, 100, 1'000'000) != nullptr);
    REQUIRE_TRUE(clock.HandleExternalClock(1'000'000, 0));
    REQUIRE_TRUE(clock.HandleExternalClock(1'020'000, 0));
    REQUIRE_TRUE(clock.HandleExternalClock(1'040'000, 0));
    const double lockedBpm = clock.TempoBpm();
    REQUIRE_TRUE(!clock.HandleExternalClock(1'060'000, 1));
    REQUIRE_TRUE(!clock.HandleExternalTransport(
        synth::ClockTransportCommand::Start, 1'070'000, 1));
    REQUIRE_TRUE(clock.DiagnosticsSnapshot().activeExternalSourceSlot == 0);

    const double priorLifetimeEnd = clock.CurrentPlan()->LifetimeEndQuarterNotes();
    REQUIRE_TRUE(clock.CommitBlock(100, 100, 1'600'001) != nullptr);
    auto diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.acquisition == synth::ClockAcquisitionState::FreeRun);
    REQUIRE_TRUE(!diagnostics.hasActiveExternalSource);
    REQUIRE_NEAR(clock.TempoBpm(), lockedBpm, 0.0);
    REQUIRE_NEAR(clock.CurrentPlan()->LifetimeStartQuarterNotes(), priorLifetimeEnd, 0.0);

    REQUIRE_TRUE(clock.HandleExternalClock(1'610'000, 1));
    diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.hasActiveExternalSource);
    REQUIRE_TRUE(diagnostics.activeExternalSourceSlot == 1);
    REQUIRE_TRUE(diagnostics.acquisition == synth::ClockAcquisitionState::Acquiring);
    REQUIRE_NEAR(clock.TempoBpm(), lockedBpm, 0.0);
    REQUIRE_TRUE(diagnostics.sourceTimeoutCount == 1);
}

TEST_CASE(master_clock_repeated_provisional_owner_transport_refreshes_its_timeout) {
    synth::MasterClock clock;
    synth::SyncConfig config;
    config.receiveClock = true;
    config.receiveTransport = true;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(1000.0, 100));
    REQUIRE_TRUE(clock.CommitBlock(0, 100, 1'000'000) != nullptr);

    REQUIRE_TRUE(clock.HandleExternalTransport(
        synth::ClockTransportCommand::Start, 1'010'000, 3));
    REQUIRE_TRUE(clock.HandleExternalTransport(
        synth::ClockTransportCommand::Continue, 1'400'000, 3));
    REQUIRE_TRUE(clock.HandleExternalClock(1'800'000, 3));
    const auto diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.sourceTimeoutCount == 0);
    REQUIRE_TRUE(diagnostics.hasActiveExternalSource);
    REQUIRE_TRUE(diagnostics.activeExternalSourceSlot == 3);
    REQUIRE_TRUE(!diagnostics.sourceIsProvisional);
}

TEST_CASE(master_clock_source_timeout_uses_four_periods_when_larger_than_500_ms) {
    synth::MasterClock clock;
    synth::SyncConfig config;
    config.receiveClock = true;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(1000.0, 100));
    REQUIRE_TRUE(clock.CommitBlock(0, 100, 1'000'000) != nullptr);
    REQUIRE_TRUE(clock.HandleExternalClock(1'000'000, 0));
    REQUIRE_TRUE(clock.HandleExternalClock(1'200'000, 0));
    REQUIRE_TRUE(clock.HandleExternalClock(1'400'000, 0));
    REQUIRE_NEAR(
        clock.DiagnosticsSnapshot().externalFilteredPeriodMicros,
        200'000.0,
        0.0);

    REQUIRE_TRUE(clock.CommitBlock(100, 100, 2'100'000) != nullptr);
    REQUIRE_TRUE(clock.DiagnosticsSnapshot().hasActiveExternalSource);
    REQUIRE_TRUE(clock.DiagnosticsSnapshot().acquisition ==
                 synth::ClockAcquisitionState::Locked);
    REQUIRE_TRUE(clock.CommitBlock(200, 100, 2'300'001) != nullptr);
    REQUIRE_TRUE(!clock.DiagnosticsSnapshot().hasActiveExternalSource);
    REQUIRE_TRUE(clock.DiagnosticsSnapshot().acquisition ==
                 synth::ClockAcquisitionState::FreeRun);
}

TEST_CASE(master_clock_alternating_jitter_is_smoothed_and_dropout_keeps_output_free_running) {
    synth::MasterClock clock;
    FixedScheduledSink<256> sink;
    clock.SetScheduledMidiEventSink(&sink);
    synth::SyncConfig config;
    config.sendClock = true;
    config.receiveClock = true;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(1000.0, 1000));
    REQUIRE_TRUE(clock.CommitBlock(0, 1000, 1'000'000) != nullptr);

    std::uint64_t timestamp = 1'000'000;
    REQUIRE_TRUE(clock.HandleExternalClock(timestamp, 0));
    for (std::size_t interval = 0; interval < 20; ++interval) {
        timestamp += (interval % 2) == 0 ? 19'000 : 21'000;
        REQUIRE_TRUE(clock.HandleExternalClock(timestamp, 0));
    }
    const auto locked = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(locked.acquisition == synth::ClockAcquisitionState::Locked);
    REQUIRE_TRUE(std::fabs(locked.externalFilteredPeriodMicros - 20'000.0) < 400.0);
    REQUIRE_TRUE(std::fabs(locked.externalFilteredPeriodMicros -
                           locked.externalRawIntervalMicros) > 500.0);
    const double lockedBpm = locked.currentBpm;
    const std::size_t eventsBeforeDropout = sink.Size();

    REQUIRE_TRUE(clock.CommitBlock(1000, 1000, timestamp + 500'001) != nullptr);
    const auto freeRun = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(freeRun.acquisition == synth::ClockAcquisitionState::FreeRun);
    REQUIRE_NEAR(freeRun.currentBpm, lockedBpm, 0.0);
    REQUIRE_TRUE(sink.Size() > eventsBeforeDropout);
}

TEST_CASE(master_clock_external_activation_and_stop_fill_output_only_splices) {
    synth::MasterClock clock;
    FixedScheduledSink<128> sink;
    clock.SetScheduledMidiEventSink(&sink);
    synth::SyncConfig config;
    config.receiveClock = true;
    config.receiveTransport = true;
    config.sendTransport = true;
    config.ppqn = 24;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(1000.0, 100));
    const synth::ClockBlockPlan* immutable = clock.CommitBlock(0, 100, 1'000'000);
    REQUIRE_TRUE(immutable != nullptr);
    const synth::ClockBlockPlan prior = *immutable;

    config.sendClock = true;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.HandleExternalTransport(
        synth::ClockTransportCommand::Continue, 1'010'000, 0));
    REQUIRE_TRUE(clock.HandleExternalClock(1'010'000, 0));
    REQUIRE_TRUE(clock.CurrentPlan()->TransportState() ==
                 synth::ClockTransportState::Stopped);
    REQUIRE_NEAR(
        clock.CurrentPlan()->LifetimeEndQuarterNotes(),
        prior.LifetimeEndQuarterNotes(),
        0.0);

    const auto* continued = FindEvent(sink, synth::ScheduledMidiEventKind::Continue);
    REQUIRE_TRUE(continued != nullptr);
    REQUIRE_TRUE(continued->dueTimeMicros == 1'210'000);
    bool sawZero = false;
    bool sawSpliceTick = false;
    for (std::size_t index = 0; index < sink.Size(); ++index) {
        if (sink[index].kind != synth::ScheduledMidiEventKind::TimingClock) {
            continue;
        }
        sawZero = sawZero || sink[index].dueTimeMicros == 1'210'000;
        sawSpliceTick = sawSpliceTick || sink[index].dueTimeMicros == 1'230'833;
    }
    REQUIRE_TRUE(sawZero);
    REQUIRE_TRUE(sawSpliceTick);

    const synth::ClockBlockPlan* running = clock.CommitBlock(100, 100, 1'100'000);
    REQUIRE_TRUE(running != nullptr);
    REQUIRE_TRUE(running->TransportState() == synth::ClockTransportState::Running);
    REQUIRE_NEAR(running->TransportStartQuarterNotes(), 0.18, 1.0e-12);
    const std::size_t beforeStop = sink.Size();
    REQUIRE_TRUE(clock.HandleExternalTransport(
        synth::ClockTransportCommand::Stop, 1'150'000, 0));
    bool sawStop = false;
    bool sawImmediateStopClock = false;
    bool sawResumedLifetimeClock = false;
    for (std::size_t index = beforeStop; index < sink.Size(); ++index) {
        sawStop = sawStop ||
            (sink[index].kind == synth::ScheduledMidiEventKind::Stop &&
             sink[index].dueTimeMicros == 1'350'000);
        sawImmediateStopClock = sawImmediateStopClock ||
            (sink[index].kind == synth::ScheduledMidiEventKind::TimingClock &&
             sink[index].dueTimeMicros == 1'350'000);
        sawResumedLifetimeClock = sawResumedLifetimeClock ||
            (sink[index].kind == synth::ScheduledMidiEventKind::TimingClock &&
             sink[index].dueTimeMicros == 1'366'667);
    }
    REQUIRE_TRUE(sawStop);
    REQUIRE_TRUE(!sawImmediateStopClock);
    REQUIRE_TRUE(sawResumedLifetimeClock);
}

TEST_CASE(master_clock_ppqn_change_clears_external_lock_without_changing_lifetime_or_bpm) {
    synth::MasterClock clock;
    synth::SyncConfig config;
    config.receiveClock = true;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(1000.0, 100));
    REQUIRE_TRUE(clock.CommitBlock(0, 100, 1'000'000) != nullptr);
    REQUIRE_TRUE(clock.HandleExternalClock(1'000'000, 5));
    REQUIRE_TRUE(clock.HandleExternalClock(1'020'000, 5));
    REQUIRE_TRUE(clock.HandleExternalClock(1'040'000, 5));
    const double priorBpm = clock.TempoBpm();
    const double priorLifetimeEnd = clock.CurrentPlan()->LifetimeEndQuarterNotes();

    config.ppqn = 48;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    const auto diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(!diagnostics.hasActiveExternalSource);
    REQUIRE_TRUE(diagnostics.acquisition == synth::ClockAcquisitionState::Acquiring);
    REQUIRE_NEAR(diagnostics.currentBpm, priorBpm, 0.0);
    REQUIRE_TRUE(clock.CommitBlock(100, 100, 1'100'000) != nullptr);
    REQUIRE_NEAR(clock.CurrentPlan()->LifetimeStartQuarterNotes(), priorLifetimeEnd, 0.0);
}

TEST_CASE(master_clock_disabling_external_recovery_restores_the_saved_manual_tempo) {
    synth::MasterClock clock;
    REQUIRE_TRUE(clock.SetTempoBpm(90.0));
    synth::SyncConfig config;
    config.receiveClock = true;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(48'000.0, 100'000));
    REQUIRE_TRUE(clock.CommitBlock(0, 100'000, 1'000'000) != nullptr);
    REQUIRE_TRUE(clock.HandleExternalClock(1'000'000, 0));
    REQUIRE_TRUE(clock.HandleExternalClock(1'020'833, 0));
    REQUIRE_TRUE(clock.HandleExternalClock(1'041'667, 0));
    REQUIRE_TRUE(std::fabs(clock.TempoBpm() - 120.0) < 0.1);
    REQUIRE_TRUE(!clock.SetTempoBpm(75.0));

    config.receiveClock = false;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_NEAR(clock.TempoBpm(), 90.0, 0.0);
    REQUIRE_NEAR(
        clock.QuarterNotesPerSample(),
        90.0 / (60.0 * 48'000.0),
        1.0e-18);
}

TEST_CASE(master_clock_half_open_crossings_ppqn_reprime_and_sink_overflow_are_observable) {
    synth::MasterClock clock;
    FixedScheduledSink<4> sink;
    clock.SetScheduledMidiEventSink(&sink);
    REQUIRE_TRUE(clock.SetTempoBpm(60.0));
    synth::SyncConfig config;
    config.sendClock = true;
    config.ppqn = 4;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(100.0, 25));

    REQUIRE_TRUE(clock.CommitBlock(0, 25, 1'000'000) != nullptr);
    REQUIRE_TRUE(sink.Count(synth::ScheduledMidiEventKind::TimingClock) == 0);
    REQUIRE_TRUE(clock.CommitBlock(25, 25, 1'250'000) != nullptr);
    REQUIRE_TRUE(sink.Count(synth::ScheduledMidiEventKind::TimingClock) == 1);
    const auto* boundary = FindEvent(sink, synth::ScheduledMidiEventKind::TimingClock);
    REQUIRE_TRUE(boundary != nullptr);
    REQUIRE_TRUE(boundary->dueTimeMicros == 1'750'000);

    config.ppqn = 8;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    const std::size_t before = sink.Size();
    REQUIRE_TRUE(clock.CommitBlock(50, 25, 1'500'000) != nullptr);
    REQUIRE_TRUE(sink.Size() > before);
    for (std::size_t index = before; index < sink.Size(); ++index) {
        REQUIRE_TRUE(!(sink[index].kind == synth::ScheduledMidiEventKind::TimingClock &&
                       sink[index].dueTimeMicros == 2'000'000));
    }

    REQUIRE_TRUE(clock.CommitBlock(75, 25, 1'750'000) != nullptr);
    REQUIRE_TRUE(clock.DiagnosticsSnapshot().droppedOutputCount > 0);
}

TEST_CASE(master_clock_delayed_splice_has_one_total_crossing_iteration_budget) {
    synth::MasterClock clock;
    REQUIRE_TRUE(clock.SetTempoBpm(60'000.0));
    synth::SyncConfig config;
    config.receiveTransport = true;
    config.ppqn = 960;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(1000.0, 10));

    constexpr std::uint64_t kBlocks = synth::MasterClock::kPlanHistoryCapacity;
    constexpr std::uint64_t kFramesPerBlock = 10;
    constexpr std::uint64_t kCrossingsPerFrame = 960;
    for (std::uint64_t block = 0; block < kBlocks; ++block) {
        REQUIRE_TRUE(clock.CommitBlock(
                         block * kFramesPerBlock,
                         kFramesPerBlock,
                         1'000'000 + block * 10'000) != nullptr);
    }

    const auto before = clock.DiagnosticsSnapshot();
    config.sendClock = true;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.HandleExternalTransport(
        synth::ClockTransportCommand::Start, 1'000'000, 0));
    const auto after = clock.DiagnosticsSnapshot();

    constexpr std::uint64_t kTotalSpliceIterationBudget = 4096;
    static_assert(
        synth::MasterClock::kMaximumSpliceCrossingIterations ==
        kTotalSpliceIterationBudget);
    constexpr std::uint64_t kAnalyticalCandidates =
        kBlocks * kFramesPerBlock * kCrossingsPerFrame;
    REQUIRE_TRUE(
        after.enumeratedCrossingCount - before.enumeratedCrossingCount ==
        kTotalSpliceIterationBudget);
    REQUIRE_TRUE(
        after.droppedOutputCount - before.droppedOutputCount ==
        kAnalyticalCandidates - kTotalSpliceIterationBudget);
}

TEST_CASE(master_clock_clock_production_and_input_paths_allocate_nothing_and_are_bounded_by_crossings) {
    synth::MasterClock clock;
    FixedScheduledSink<4096> sink;
    clock.SetScheduledMidiEventSink(&sink);
    synth::SyncConfig config;
    config.sendClock = true;
    config.receiveClock = true;
    config.receiveTransport = true;
    config.ppqn = 24;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(48'000.0, 64));
    REQUIRE_TRUE(clock.CommitBlock(0, 64, 1'000'000) != nullptr);

    allocation_probe::count.store(0, std::memory_order_relaxed);
    allocation_probe::enabled.store(true, std::memory_order_release);
    bool realtimeOk = true;
    std::uint64_t timestamp = 1'000'000;
    for (std::uint64_t block = 1; block <= 1000; ++block) {
        timestamp += 1333;
        realtimeOk = realtimeOk && clock.HandleExternalClock(timestamp, 0);
        const std::uint64_t startSample = block * 64;
        realtimeOk = realtimeOk &&
            clock.CommitBlock(startSample, 64, timestamp) != nullptr;
    }
    allocation_probe::enabled.store(false, std::memory_order_release);
    REQUIRE_TRUE(realtimeOk);
    REQUIRE_TRUE(allocation_probe::count.load(std::memory_order_relaxed) == 0);
    const auto diagnostics = clock.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.enumeratedCrossingCount < 1000 * 64);
    REQUIRE_TRUE(diagnostics.enumeratedCrossingCount <= sink.Size());
}

TEST_CASE(acceptance_trace_internal_timeline_orders_half_open_fractional_transport_epochs) {
    struct PlanRecord {
        synth::ClockTransportState state = synth::ClockTransportState::Stopped;
        std::uint64_t startSample = 0;
        std::uint64_t endSample = 0;
        std::uint64_t transportEpoch = 0;
        double lifetimeStart = 0.0;
        double lifetimeEnd = 0.0;
        double transportStart = 0.0;
        double fractionalTransport = 0.0;
        double increment = 0.0;
    };

    synth::MasterClock clock;
    FixedScheduledSink<256> sink;
    FixedTrace<PlanRecord, 5> trace;
    clock.SetScheduledMidiEventSink(&sink);
    synth::SyncConfig config;
    config.sendClock = true;
    config.sendTransport = true;
    config.ppqn = 24;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.SetTempoBpm(120.0));
    REQUIRE_TRUE(clock.Prepare(1000.0, 125));
    REQUIRE_TRUE(clock.OutputLatencyMicros() == 250'000);

    const auto appendPlan = [&trace](const synth::ClockBlockPlan& plan) {
        return trace.Push(PlanRecord{
            .state = plan.TransportState(),
            .startSample = plan.StartSample(),
            .endSample = plan.EndSample(),
            .transportEpoch = plan.TransportEpoch(),
            .lifetimeStart = plan.LifetimeStartQuarterNotes(),
            .lifetimeEnd = plan.LifetimeEndQuarterNotes(),
            .transportStart = plan.TransportStartQuarterNotes(),
            .fractionalTransport = plan.TransportQuarterNotesAt(
                static_cast<double>(plan.StartSample()) + 1.5),
            .increment = plan.QuarterNotesPerSample(),
        });
    };

    const synth::ClockBlockPlan first = *clock.CommitBlock(0, 125, 1'000'000);
    REQUIRE_TRUE(appendPlan(first));
    REQUIRE_TRUE(first.Contains(124.999));
    REQUIRE_TRUE(!first.Contains(125.0));
    constexpr std::uint64_t endpointDue = 1'375'000;
    REQUIRE_TRUE(CountEventsAtDeadline(
                     sink, synth::ScheduledMidiEventKind::TimingClock, endpointDue) == 0);

    const synth::ClockBlockPlan second = *clock.CommitBlock(125, 125, 1'125'000);
    REQUIRE_TRUE(appendPlan(second));
    REQUIRE_TRUE(second.Contains(125.0));
    REQUIRE_NEAR(second.LifetimeStartQuarterNotes(), first.LifetimeEndQuarterNotes(), 0.0);
    REQUIRE_TRUE(CountEventsAtDeadline(
                     sink, synth::ScheduledMidiEventKind::TimingClock, endpointDue) == 1);

    REQUIRE_TRUE(clock.SetTempoBpm(90.0));
    REQUIRE_TRUE(clock.HandleInternalTransport(synth::ClockTransportCommand::Start));
    const std::size_t beforeStart = sink.Size();
    const synth::ClockBlockPlan started = *clock.CommitBlock(250, 125, 1'250'000);
    REQUIRE_TRUE(appendPlan(started));
    REQUIRE_TRUE(started.TransportState() == synth::ClockTransportState::Running);
    REQUIRE_TRUE(started.TransportEpoch() == 1);
    REQUIRE_NEAR(started.TransportStartQuarterNotes(), 0.0, 0.0);
    REQUIRE_NEAR(started.QuarterNotesPerSample(), 90.0 / 60'000.0, 1.0e-18);
    REQUIRE_NEAR(started.LifetimeStartQuarterNotes(), second.LifetimeEndQuarterNotes(), 0.0);
    REQUIRE_NEAR(started.TransportQuarterNotesAt(251.5), 1.5 * 90.0 / 60'000.0, 1.0e-15);
    REQUIRE_TRUE(sink[beforeStart].kind ==
                 synth::ScheduledMidiEventKind::PhaseGenerationCutoff);
    REQUIRE_TRUE(sink[beforeStart + 1].kind == synth::ScheduledMidiEventKind::Start);
    REQUIRE_TRUE(sink[beforeStart + 2].kind == synth::ScheduledMidiEventKind::TimingClock);
    REQUIRE_TRUE(sink[beforeStart + 1].dueTimeMicros == 1'500'000);
    REQUIRE_TRUE(sink[beforeStart + 2].dueTimeMicros == 1'500'000);
    REQUIRE_TRUE(sink[beforeStart + 1].sequence < sink[beforeStart + 2].sequence);
    constexpr std::uint64_t firstFractionalRunningTickDue = 1'527'778;
    REQUIRE_TRUE(CountEventsAtDeadline(
                     sink,
                     synth::ScheduledMidiEventKind::TimingClock,
                     firstFractionalRunningTickDue) == 1);

    REQUIRE_TRUE(clock.HandleInternalTransport(synth::ClockTransportCommand::Continue));
    const std::size_t beforeContinue = sink.Size();
    const synth::ClockBlockPlan continued = *clock.CommitBlock(375, 125, 1'375'000);
    REQUIRE_TRUE(appendPlan(continued));
    REQUIRE_TRUE(continued.TransportState() == synth::ClockTransportState::Running);
    REQUIRE_TRUE(continued.TransportEpoch() == 2);
    REQUIRE_NEAR(continued.TransportStartQuarterNotes(), 0.0, 0.0);
    REQUIRE_NEAR(continued.LifetimeStartQuarterNotes(), started.LifetimeEndQuarterNotes(), 0.0);
    REQUIRE_TRUE(sink[beforeContinue].kind ==
                 synth::ScheduledMidiEventKind::PhaseGenerationCutoff);
    REQUIRE_TRUE(sink[beforeContinue + 1].kind == synth::ScheduledMidiEventKind::Continue);
    REQUIRE_TRUE(sink[beforeContinue + 2].kind == synth::ScheduledMidiEventKind::TimingClock);
    REQUIRE_TRUE(sink[beforeContinue + 1].dueTimeMicros == 1'625'000);
    REQUIRE_TRUE(sink[beforeContinue + 2].dueTimeMicros == 1'625'000);

    REQUIRE_TRUE(clock.HandleInternalTransport(synth::ClockTransportCommand::Stop));
    const std::size_t beforeStop = sink.Size();
    const synth::ClockBlockPlan stopped = *clock.CommitBlock(500, 125, 1'500'000);
    REQUIRE_TRUE(appendPlan(stopped));
    REQUIRE_TRUE(stopped.TransportState() == synth::ClockTransportState::Stopped);
    REQUIRE_NEAR(stopped.TransportStartQuarterNotes(), 0.0, 0.0);
    REQUIRE_NEAR(stopped.LifetimeStartQuarterNotes(), continued.LifetimeEndQuarterNotes(), 0.0);
    REQUIRE_TRUE(sink[beforeStop].kind ==
                 synth::ScheduledMidiEventKind::PhaseGenerationCutoff);
    REQUIRE_TRUE(sink[beforeStop + 1].kind == synth::ScheduledMidiEventKind::Stop);
    REQUIRE_TRUE(sink[beforeStop + 1].dueTimeMicros == 1'750'000);
    REQUIRE_TRUE(CountEventsAtDeadline(
                     sink, synth::ScheduledMidiEventKind::TimingClock, 1'750'000) == 0);
    REQUIRE_TRUE(CountEventsAtDeadline(
                     sink, synth::ScheduledMidiEventKind::TimingClock, 1'777'778) == 1);

    REQUIRE_TRUE(trace.Size() == 5);
    REQUIRE_TRUE(trace[0].state == synth::ClockTransportState::Stopped);
    REQUIRE_TRUE(trace[1].state == synth::ClockTransportState::Stopped);
    REQUIRE_TRUE(trace[2].state == synth::ClockTransportState::Running);
    REQUIRE_TRUE(trace[3].state == synth::ClockTransportState::Running);
    REQUIRE_TRUE(trace[4].state == synth::ClockTransportState::Stopped);
    for (std::size_t index = 1; index < trace.Size(); ++index) {
        REQUIRE_TRUE(trace[index].startSample == trace[index - 1].endSample);
        REQUIRE_NEAR(trace[index].lifetimeStart, trace[index - 1].lifetimeEnd, 0.0);
    }

    std::cout << "[trace] internal_timeline plans=" << trace.Size()
              << " endpoint_due_us=" << endpointDue
              << " fractional_tick_due_us=" << firstFractionalRunningTickDue
              << " epochs=0,0,1,2,2\n";
}

TEST_CASE(acceptance_trace_external_acquisition_jitter_dropout_takeover_and_regeneration) {
    enum class Step : std::uint8_t {
        ExactLocked,
        JitterFiltered,
        RejectedInputs,
        MissedPulses,
        FreeRun,
        ProvisionalStart,
        RunningStart,
        Stopped,
        RunningContinue,
        Takeover,
    };
    struct Record {
        Step step = Step::ExactLocked;
        synth::ClockAcquisitionState acquisition = synth::ClockAcquisitionState::Internal;
        synth::ClockTransportState transport = synth::ClockTransportState::Stopped;
        std::size_t sourceSlot = 0;
        std::uint64_t accepted = 0;
        std::uint64_t ignored = 0;
        std::uint64_t missed = 0;
        double bpm = 0.0;
        double filteredPeriodMicros = 0.0;
    };
    FixedTrace<Record, 10> trace;

    synth::MasterClock acquisition;
    synth::SyncConfig receive;
    receive.receiveClock = true;
    REQUIRE_TRUE(acquisition.ApplySyncConfig(receive));
    REQUIRE_TRUE(acquisition.Prepare(48'000.0, 100'000));
    REQUIRE_TRUE(acquisition.CommitBlock(0, 100'000, 1'000'000) != nullptr);
    constexpr long double exactPeriodMicros =
        60'000'000.0L / (120.0L * 24.0L);
    std::uint64_t timestamp = 1'000'000;
    for (std::uint64_t tick = 0; tick <= 64; ++tick) {
        timestamp = static_cast<std::uint64_t>(std::llround(
            1'000'000.0L + exactPeriodMicros * static_cast<long double>(tick)));
        REQUIRE_TRUE(acquisition.HandleExternalClock(timestamp, 7));
    }
    auto diagnostics = acquisition.DiagnosticsSnapshot();
    const double recoveredBpmError = std::fabs(diagnostics.currentBpm - 120.0);
    REQUIRE_TRUE(diagnostics.acquisition == synth::ClockAcquisitionState::Locked);
    REQUIRE_TRUE(diagnostics.acceptedExternalClockCount == 65);
    REQUIRE_TRUE(recoveredBpmError <= 0.1);
    REQUIRE_TRUE(trace.Push({
        .step = Step::ExactLocked,
        .acquisition = diagnostics.acquisition,
        .sourceSlot = diagnostics.activeExternalSourceSlot,
        .accepted = diagnostics.acceptedExternalClockCount,
        .ignored = diagnostics.ignoredInputCount,
        .missed = diagnostics.inferredMissedPulseCount,
        .bpm = diagnostics.currentBpm,
        .filteredPeriodMicros = diagnostics.externalFilteredPeriodMicros,
    }));

    for (std::size_t interval = 0; interval < 12; ++interval) {
        timestamp += interval % 2 == 0 ? 19'833 : 21'833;
        REQUIRE_TRUE(acquisition.HandleExternalClock(timestamp, 7));
    }
    diagnostics = acquisition.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.acquisition == synth::ClockAcquisitionState::Locked);
    REQUIRE_TRUE(std::fabs(diagnostics.externalFilteredPeriodMicros - 20'833.0) < 400.0);
    REQUIRE_TRUE(std::fabs(diagnostics.externalFilteredPeriodMicros -
                           diagnostics.externalRawIntervalMicros) > 500.0);
    REQUIRE_TRUE(trace.Push({
        .step = Step::JitterFiltered,
        .acquisition = diagnostics.acquisition,
        .sourceSlot = diagnostics.activeExternalSourceSlot,
        .accepted = diagnostics.acceptedExternalClockCount,
        .ignored = diagnostics.ignoredInputCount,
        .missed = diagnostics.inferredMissedPulseCount,
        .bpm = diagnostics.currentBpm,
        .filteredPeriodMicros = diagnostics.externalFilteredPeriodMicros,
    }));

    const std::uint64_t acceptedBeforeRejects = diagnostics.acceptedExternalClockCount;
    REQUIRE_TRUE(!acquisition.HandleExternalClock(timestamp, 7));
    REQUIRE_TRUE(!acquisition.HandleExternalClock(timestamp - 1, 7));
    REQUIRE_TRUE(!acquisition.HandleExternalClock(timestamp + 5'000, 7));
    diagnostics = acquisition.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.acceptedExternalClockCount == acceptedBeforeRejects);
    REQUIRE_TRUE(diagnostics.ignoredInputCount >= 3);
    REQUIRE_TRUE(trace.Push({
        .step = Step::RejectedInputs,
        .acquisition = diagnostics.acquisition,
        .sourceSlot = diagnostics.activeExternalSourceSlot,
        .accepted = diagnostics.acceptedExternalClockCount,
        .ignored = diagnostics.ignoredInputCount,
        .missed = diagnostics.inferredMissedPulseCount,
        .bpm = diagnostics.currentBpm,
        .filteredPeriodMicros = diagnostics.externalFilteredPeriodMicros,
    }));

    const std::uint64_t missedBefore = diagnostics.inferredMissedPulseCount;
    timestamp += 3 * 20'833;
    REQUIRE_TRUE(acquisition.HandleExternalClock(timestamp, 7));
    diagnostics = acquisition.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.inferredMissedPulseCount == missedBefore + 2);
    REQUIRE_TRUE(trace.Push({
        .step = Step::MissedPulses,
        .acquisition = diagnostics.acquisition,
        .sourceSlot = diagnostics.activeExternalSourceSlot,
        .accepted = diagnostics.acceptedExternalClockCount,
        .ignored = diagnostics.ignoredInputCount,
        .missed = diagnostics.inferredMissedPulseCount,
        .bpm = diagnostics.currentBpm,
        .filteredPeriodMicros = diagnostics.externalFilteredPeriodMicros,
    }));

    const double bpmBeforeDropout = diagnostics.currentBpm;
    const double lifetimeBeforeDropout = acquisition.CurrentPlan()->LifetimeEndQuarterNotes();
    REQUIRE_TRUE(acquisition.CommitBlock(
                     100'000, 100'000, timestamp + 500'001) != nullptr);
    diagnostics = acquisition.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.acquisition == synth::ClockAcquisitionState::FreeRun);
    REQUIRE_TRUE(!diagnostics.hasActiveExternalSource);
    REQUIRE_NEAR(diagnostics.currentBpm, bpmBeforeDropout, 0.0);
    REQUIRE_NEAR(
        acquisition.CurrentPlan()->LifetimeStartQuarterNotes(),
        lifetimeBeforeDropout,
        0.0);
    REQUIRE_TRUE(trace.Push({
        .step = Step::FreeRun,
        .acquisition = diagnostics.acquisition,
        .sourceSlot = diagnostics.activeExternalSourceSlot,
        .accepted = diagnostics.acceptedExternalClockCount,
        .ignored = diagnostics.ignoredInputCount,
        .missed = diagnostics.inferredMissedPulseCount,
        .bpm = diagnostics.currentBpm,
        .filteredPeriodMicros = diagnostics.externalFilteredPeriodMicros,
    }));

    synth::MasterClock transport;
    FixedScheduledSink<256> sink;
    transport.SetScheduledMidiEventSink(&sink);
    synth::SyncConfig sendReceive;
    sendReceive.sendClock = true;
    sendReceive.receiveClock = true;
    sendReceive.sendTransport = true;
    sendReceive.receiveTransport = true;
    sendReceive.ppqn = 24;
    REQUIRE_TRUE(transport.ApplySyncConfig(sendReceive));
    REQUIRE_TRUE(transport.Prepare(1000.0, 100));
    REQUIRE_TRUE(transport.CommitBlock(0, 100, 1'000'000) != nullptr);
    REQUIRE_TRUE(transport.HandleExternalTransport(
        synth::ClockTransportCommand::Start, 1'010'000, 3));
    diagnostics = transport.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.sourceIsProvisional);
    REQUIRE_TRUE(diagnostics.activeExternalSourceSlot == 3);
    REQUIRE_TRUE(!transport.HandleExternalTransport(
        synth::ClockTransportCommand::Continue, 1'011'000, 4));
    REQUIRE_TRUE(trace.Push({
        .step = Step::ProvisionalStart,
        .acquisition = diagnostics.acquisition,
        .transport = synth::ClockTransportState::ArmedStart,
        .sourceSlot = diagnostics.activeExternalSourceSlot,
        .accepted = diagnostics.acceptedExternalClockCount,
        .ignored = transport.DiagnosticsSnapshot().ignoredInputCount,
        .bpm = diagnostics.currentBpm,
    }));

    REQUIRE_TRUE(transport.HandleExternalClock(1'025'000, 3));
    REQUIRE_TRUE(FindEventAtDeadline(
                     sink, synth::ScheduledMidiEventKind::Start, 1'210'000) != nullptr);
    REQUIRE_TRUE(FindEventAtDeadline(
                     sink, synth::ScheduledMidiEventKind::TimingClock, 1'225'000) != nullptr);
    REQUIRE_TRUE(transport.HandleExternalClock(1'047'000, 3));
    REQUIRE_TRUE(FindEventAtDeadline(
                     sink, synth::ScheduledMidiEventKind::TimingClock, 1'245'833) != nullptr);
    REQUIRE_TRUE(FindEventAtDeadline(
                     sink, synth::ScheduledMidiEventKind::TimingClock, 1'247'000) == nullptr);
    const synth::ClockBlockPlan runningStart =
        *transport.CommitBlock(100, 100, 1'100'000);
    REQUIRE_TRUE(runningStart.TransportState() == synth::ClockTransportState::Running);
    diagnostics = transport.DiagnosticsSnapshot();
    REQUIRE_TRUE(trace.Push({
        .step = Step::RunningStart,
        .acquisition = diagnostics.acquisition,
        .transport = runningStart.TransportState(),
        .sourceSlot = diagnostics.activeExternalSourceSlot,
        .accepted = diagnostics.acceptedExternalClockCount,
        .ignored = diagnostics.ignoredInputCount,
        .bpm = diagnostics.currentBpm,
        .filteredPeriodMicros = diagnostics.externalFilteredPeriodMicros,
    }));

    REQUIRE_TRUE(transport.HandleExternalTransport(
        synth::ClockTransportCommand::Stop, 1'150'000, 3));
    const synth::ClockBlockPlan stopped = *transport.CommitBlock(200, 100, 1'200'000);
    REQUIRE_TRUE(stopped.TransportState() == synth::ClockTransportState::Stopped);
    REQUIRE_NEAR(stopped.TransportStartQuarterNotes(), 0.0, 0.0);
    REQUIRE_TRUE(FindEventAtDeadline(
                     sink, synth::ScheduledMidiEventKind::Stop, 1'350'000) != nullptr);
    diagnostics = transport.DiagnosticsSnapshot();
    REQUIRE_TRUE(trace.Push({
        .step = Step::Stopped,
        .acquisition = diagnostics.acquisition,
        .transport = stopped.TransportState(),
        .sourceSlot = diagnostics.activeExternalSourceSlot,
        .accepted = diagnostics.acceptedExternalClockCount,
        .ignored = diagnostics.ignoredInputCount,
        .bpm = diagnostics.currentBpm,
        .filteredPeriodMicros = diagnostics.externalFilteredPeriodMicros,
    }));

    REQUIRE_TRUE(transport.HandleExternalTransport(
        synth::ClockTransportCommand::Continue, 1'210'000, 3));
    REQUIRE_TRUE(transport.HandleExternalClock(1'230'000, 3));
    const synth::ClockBlockPlan runningContinue =
        *transport.CommitBlock(300, 100, 1'300'000);
    REQUIRE_TRUE(runningContinue.TransportState() == synth::ClockTransportState::Running);
    REQUIRE_TRUE(runningContinue.TransportEpoch() == 2);
    REQUIRE_NEAR(
        runningContinue.TransportStartQuarterNotes(),
        70.0 * stopped.QuarterNotesPerSample(),
        1.0e-12);
    REQUIRE_TRUE(FindEventAtDeadline(
                     sink, synth::ScheduledMidiEventKind::Continue, 1'410'000) != nullptr);
    REQUIRE_TRUE(FindEventAtDeadline(
                     sink, synth::ScheduledMidiEventKind::TimingClock, 1'430'000) != nullptr);
    diagnostics = transport.DiagnosticsSnapshot();
    REQUIRE_TRUE(trace.Push({
        .step = Step::RunningContinue,
        .acquisition = diagnostics.acquisition,
        .transport = runningContinue.TransportState(),
        .sourceSlot = diagnostics.activeExternalSourceSlot,
        .accepted = diagnostics.acceptedExternalClockCount,
        .ignored = diagnostics.ignoredInputCount,
        .bpm = diagnostics.currentBpm,
        .filteredPeriodMicros = diagnostics.externalFilteredPeriodMicros,
    }));

    REQUIRE_TRUE(transport.HandleExternalClock(1'730'001, 4));
    diagnostics = transport.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.hasActiveExternalSource);
    REQUIRE_TRUE(diagnostics.activeExternalSourceSlot == 4);
    REQUIRE_TRUE(diagnostics.sourceTimeoutCount == 1);
    REQUIRE_TRUE(diagnostics.acquisition == synth::ClockAcquisitionState::Acquiring);
    REQUIRE_TRUE(trace.Push({
        .step = Step::Takeover,
        .acquisition = diagnostics.acquisition,
        .transport = synth::ClockTransportState::Running,
        .sourceSlot = diagnostics.activeExternalSourceSlot,
        .accepted = diagnostics.acceptedExternalClockCount,
        .ignored = diagnostics.ignoredInputCount,
        .bpm = diagnostics.currentBpm,
        .filteredPeriodMicros = diagnostics.externalFilteredPeriodMicros,
    }));

    REQUIRE_TRUE(trace.Size() == 10);
    REQUIRE_TRUE(trace[0].step == Step::ExactLocked);
    REQUIRE_TRUE(trace[1].step == Step::JitterFiltered);
    REQUIRE_TRUE(trace[2].step == Step::RejectedInputs);
    REQUIRE_TRUE(trace[3].step == Step::MissedPulses);
    REQUIRE_TRUE(trace[4].step == Step::FreeRun);
    REQUIRE_TRUE(trace[5].step == Step::ProvisionalStart);
    REQUIRE_TRUE(trace[6].step == Step::RunningStart);
    REQUIRE_TRUE(trace[7].step == Step::Stopped);
    REQUIRE_TRUE(trace[8].step == Step::RunningContinue);
    REQUIRE_TRUE(trace[9].step == Step::Takeover);

    std::cout << "[trace] external_acquisition records=" << trace.Size()
              << " bpm_error=" << recoveredBpmError
              << " jitter_filtered_us=" << trace[1].filteredPeriodMicros
              << " ignored=" << trace[2].ignored
              << " missed=" << trace[3].missed
              << " takeover_slot=" << trace[9].sourceSlot << "\n";
}

TEST_CASE(acceptance_trace_mapper_output_calculation_reports_normative_maxima) {
    struct MapperRecord {
        double latestError = 0.0;
        double medianError = 0.0;
        double filteredError = 0.0;
        double microsPerSample = 0.0;
    };
    FixedTrace<MapperRecord, 5> mapperTrace;
    synth::AudioSampleTimeMapper mapper;
    REQUIRE_TRUE(mapper.Prepare(1000.0, 1'000'000));
    REQUIRE_TRUE(mapper.ObserveBlock(0, 0) == synth::MapperObservationResult::Anchored);
    constexpr std::array<double, 5> requestedErrors{50.0, 10.0, 90.0, 30.0, 70.0};
    std::array<double, 5> actualErrors{};
    double expectedFiltered = 0.0;
    for (std::size_t index = 0; index < requestedErrors.size(); ++index) {
        const std::uint64_t sample = static_cast<std::uint64_t>((index + 1) * 100);
        const double predicted = *mapper.TimeMicrosAt(static_cast<double>(sample));
        const auto observed = static_cast<std::uint64_t>(
            std::llround(predicted + requestedErrors[index]));
        actualErrors[index] = static_cast<double>(observed) - predicted;
        std::array<double, 5> sorted = actualErrors;
        std::sort(sorted.begin(), sorted.begin() + static_cast<std::ptrdiff_t>(index + 1));
        const std::size_t count = index + 1;
        const double expectedMedian = count % 2 != 0
            ? sorted[count / 2]
            : (sorted[count / 2 - 1] + sorted[count / 2]) * 0.5;
        expectedFiltered +=
            (expectedMedian - expectedFiltered) *
            synth::AudioSampleTimeMapper::kPhaseErrorEwmaGain;
        REQUIRE_TRUE(mapper.ObserveBlock(sample, observed) ==
                     synth::MapperObservationResult::Continuous);
        const auto snapshot = mapper.DiagnosticsSnapshot();
        REQUIRE_NEAR(snapshot.latestPhaseErrorMicros, actualErrors[index], 1.0e-9);
        REQUIRE_NEAR(snapshot.medianPhaseErrorMicros, expectedMedian, 1.0e-9);
        REQUIRE_NEAR(snapshot.filteredPhaseErrorMicros, expectedFiltered, 1.0e-9);
        REQUIRE_TRUE(mapperTrace.Push({
            .latestError = snapshot.latestPhaseErrorMicros,
            .medianError = snapshot.medianPhaseErrorMicros,
            .filteredError = snapshot.filteredPhaseErrorMicros,
            .microsPerSample = snapshot.currentMicrosPerSample,
        }));
    }
    REQUIRE_TRUE(mapperTrace.Size() == 5);
    REQUIRE_NEAR(mapperTrace[4].medianError, 50.0, 1.0);

    synth::AudioSampleTimeMapper positiveSlew;
    REQUIRE_TRUE(positiveSlew.Prepare(1000.0, 2'000'000));
    REQUIRE_TRUE(positiveSlew.ObserveBlock(0, 0) == synth::MapperObservationResult::Anchored);
    const double positivePriorEnd = *positiveSlew.TimeMicrosAt(10.0);
    REQUIRE_TRUE(positiveSlew.ObserveBlock(10, 1'010'000) ==
                 synth::MapperObservationResult::Continuous);
    REQUIRE_NEAR(*positiveSlew.TimeMicrosAt(10.0), positivePriorEnd, 0.0);
    REQUIRE_NEAR(
        positiveSlew.DiagnosticsSnapshot().currentMicrosPerSample, 1000.5, 1.0e-12);

    synth::AudioSampleTimeMapper negativeSlew;
    REQUIRE_TRUE(negativeSlew.Prepare(1000.0, 20'000));
    REQUIRE_TRUE(negativeSlew.ObserveBlock(0, 10'000) ==
                 synth::MapperObservationResult::Anchored);
    REQUIRE_TRUE(negativeSlew.ObserveBlock(10, 11'000) ==
                 synth::MapperObservationResult::Continuous);
    REQUIRE_NEAR(
        negativeSlew.DiagnosticsSnapshot().currentMicrosPerSample, 999.5, 1.0e-12);

    synth::AudioSampleTimeMapper discontinuity;
    REQUIRE_TRUE(discontinuity.Prepare(1000.0, 5000));
    REQUIRE_TRUE(discontinuity.ObserveBlock(0, 100'000) ==
                 synth::MapperObservationResult::Anchored);
    REQUIRE_TRUE(discontinuity.ObserveBlock(10, 120'001) ==
                 synth::MapperObservationResult::Discontinuity);
    REQUIRE_TRUE(discontinuity.DiagnosticsSnapshot().generation == 2);
    REQUIRE_NEAR(*discontinuity.TimeMicrosAt(10.0), 120'001.0, 0.0);

    synth::MasterClock outputClock;
    FixedScheduledSink<128> outputSink;
    outputClock.SetScheduledMidiEventSink(&outputSink);
    synth::SyncConfig outputConfig;
    outputConfig.sendClock = true;
    outputConfig.ppqn = 24;
    REQUIRE_TRUE(outputClock.ApplySyncConfig(outputConfig));
    REQUIRE_TRUE(outputClock.SetTempoBpm(120.0));
    REQUIRE_TRUE(outputClock.Prepare(1000.0, 100));
    REQUIRE_TRUE(outputClock.CommitBlock(0, 100, 1'000'000) != nullptr);
    const std::size_t outputBegin = outputSink.Size();
    REQUIRE_TRUE(outputClock.CommitBlock(100, 100, 1'110'000) != nullptr);
    const auto outputMapperDiagnostics = outputClock.TimeMapper().DiagnosticsSnapshot();
    const double nominalMicrosPerSample =
        outputClock.TimeMapper().NominalMicrosPerSample();
    const double slewPpm = std::fabs(
        outputMapperDiagnostics.currentMicrosPerSample / nominalMicrosPerSample - 1.0) *
        1'000'000.0;
    REQUIRE_TRUE(slewPpm <= synth::AudioSampleTimeMapper::kMaximumSlewPpm + 1.0e-9);
    REQUIRE_NEAR(slewPpm, 500.0, 1.0e-9);

    double maximumDeadlineErrorMicros = 0.0;
    double maximumSpacingErrorMicros = 0.0;
    double previousDue = 0.0;
    const double tickSpacingSamples =
        1.0 / (24.0 * outputClock.CurrentPlan()->QuarterNotesPerSample());
    const double nominalTickSpacingMicros = tickSpacingSamples * nominalMicrosPerSample;
    const double maximumSlewContributionMicros = nominalTickSpacingMicros *
        synth::AudioSampleTimeMapper::kMaximumSlewPpm / 1'000'000.0;
    REQUIRE_TRUE(outputSink.Size() - outputBegin == 5);
    for (std::size_t index = outputBegin; index < outputSink.Size(); ++index) {
        const std::size_t cell = 5 + (index - outputBegin);
        const double crossingSample =
            (static_cast<double>(cell) / 24.0) /
            outputClock.CurrentPlan()->QuarterNotesPerSample();
        const double idealDeadline =
            *outputClock.TimeMapper().TimeMicrosAt(crossingSample) +
            static_cast<double>(outputClock.OutputLatencyMicros());
        maximumDeadlineErrorMicros = std::max(
            maximumDeadlineErrorMicros,
            std::fabs(static_cast<double>(outputSink[index].dueTimeMicros) - idealDeadline));
        if (index != outputBegin) {
            maximumSpacingErrorMicros = std::max(
                maximumSpacingErrorMicros,
                std::fabs(
                    static_cast<double>(outputSink[index].dueTimeMicros) -
                    previousDue - nominalTickSpacingMicros));
        }
        previousDue = static_cast<double>(outputSink[index].dueTimeMicros);
    }
    REQUIRE_TRUE(maximumDeadlineErrorMicros <= 1.0);
    REQUIRE_TRUE(maximumSpacingErrorMicros <=
                 2.0 + maximumSlewContributionMicros);

    synth::MasterClock regeneration;
    FixedScheduledSink<128> regenerationSink;
    regeneration.SetScheduledMidiEventSink(&regenerationSink);
    synth::SyncConfig regenerationConfig;
    regenerationConfig.sendClock = true;
    regenerationConfig.receiveClock = true;
    regenerationConfig.sendTransport = true;
    regenerationConfig.receiveTransport = true;
    regenerationConfig.ppqn = 24;
    REQUIRE_TRUE(regeneration.ApplySyncConfig(regenerationConfig));
    REQUIRE_TRUE(regeneration.Prepare(1000.0, 100));
    REQUIRE_TRUE(regeneration.CommitBlock(0, 100, 1'000'000) != nullptr);
    constexpr std::uint64_t continueInput = 1'010'000;
    constexpr std::uint64_t zeroInput = 1'025'000;
    REQUIRE_TRUE(regeneration.HandleExternalTransport(
        synth::ClockTransportCommand::Continue, continueInput, 5));
    REQUIRE_TRUE(regeneration.HandleExternalClock(zeroInput, 5));
    const auto* continueEvent = FindEventAtDeadline(
        regenerationSink,
        synth::ScheduledMidiEventKind::Continue,
        continueInput + regeneration.OutputLatencyMicros());
    const auto* zeroEvent = FindEventAtDeadline(
        regenerationSink,
        synth::ScheduledMidiEventKind::TimingClock,
        zeroInput + regeneration.OutputLatencyMicros());
    REQUIRE_TRUE(continueEvent != nullptr);
    REQUIRE_TRUE(zeroEvent != nullptr);
    const double continueOffsetError = std::fabs(
        static_cast<double>(continueEvent->dueTimeMicros - continueInput) -
        static_cast<double>(regeneration.OutputLatencyMicros()));
    const double zeroOffsetError = std::fabs(
        static_cast<double>(zeroEvent->dueTimeMicros - zeroInput) -
        static_cast<double>(regeneration.OutputLatencyMicros()));
    const double maximumFixedOffsetErrorMicros =
        std::max(continueOffsetError, zeroOffsetError);
    REQUIRE_TRUE(maximumFixedOffsetErrorMicros <= 1.0);

    std::cout << "[trace] mapper_output deadline_max_us="
              << maximumDeadlineErrorMicros
              << " spacing_max_us=" << maximumSpacingErrorMicros
              << " slew_allowance_us=" << maximumSlewContributionMicros
              << " fixed_offset_max_us=" << maximumFixedOffsetErrorMicros
              << " median_us=" << mapperTrace[4].medianError
              << " generation=" << discontinuity.DiagnosticsSnapshot().generation
              << "\n";
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
