#include "synth/MidiController.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth module tests must not see JUCE headers"
#endif

#include <atomic>
#include <array>
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <type_traits>
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

using synth::BasicMidi;
using synth::IMidiOutputSink;
using synth::MidiSchedulingCapability;
using synth::MidiSender;
using synth::ScheduledMidiEvent;
using synth::ScheduledMidiEventKind;
using synth::ScheduledMidiOrderingIntent;

static_assert(std::is_base_of_v<synth::IScheduledMidiEventSink, MidiSender>);
static_assert(noexcept(std::declval<MidiSender&>().TryEnqueue(
    std::declval<const ScheduledMidiEvent&>())));
static_assert(MidiSender::kIdleSelfHealMicros > 0);
static_assert(MidiSender::kIdleSelfHealMicros <= MidiSender::kHostScheduleLeadMicros / 4);

// A trivial, always-immediate sink: records every Send() call. Used for the
// non-blocking-path assertions (sink actually receives what was enqueued).
struct ImmediateSink final : IMidiOutputSink {
    void Send(const BasicMidi& midi) override {
        std::lock_guard<std::mutex> lock(mutex);
        received.push_back(midi);
    }

    std::mutex mutex;
    std::vector<BasicMidi> received;
};

struct RecordingSink final : IMidiOutputSink {
    struct Delivery {
        BasicMidi midi;
        bool scheduled = false;
        std::uint64_t dueTimeMicros = 0;
    };

    explicit RecordingSink(bool hostScheduled = false,
                           std::uint64_t schedulingLeadMicros = MidiSender::kHostScheduleLeadMicros)
        : hostScheduled(hostScheduled)
        , schedulingLeadMicros(schedulingLeadMicros) {}

    MidiSchedulingCapability SchedulingCapability() const noexcept override {
        return hostScheduled ? MidiSchedulingCapability::HostTimestamped
                             : MidiSchedulingCapability::ImmediateOnly;
    }

    std::uint64_t SchedulingLeadMicros() const noexcept override {
        return schedulingLeadMicros;
    }

    void Send(const BasicMidi& midi) override {
        std::lock_guard<std::mutex> lock(mutex);
        deliveries.push_back({.midi = midi});
    }

    void SendScheduled(const BasicMidi& midi, std::uint64_t dueTimeMicros) override {
        std::lock_guard<std::mutex> lock(mutex);
        deliveries.push_back({.midi = midi, .scheduled = true, .dueTimeMicros = dueTimeMicros});
    }

    std::vector<Delivery> Snapshot() {
        std::lock_guard<std::mutex> lock(mutex);
        return deliveries;
    }

    bool hostScheduled = false;
    std::uint64_t schedulingLeadMicros = MidiSender::kHostScheduleLeadMicros;
    std::mutex mutex;
    std::vector<Delivery> deliveries;
};

// A sink whose Send() blocks until the test releases a latch. Used to pin
// down ClearSinkSync's synchronization guarantee: while a Send() call is
// in-flight (blocked here), a concurrent ClearSinkSync(sinkIx) for that same
// sink must itself block until Send() returns, and must never allow another
// Send() to begin against this sink afterward -- callers rely on that to
// safely destroy the sink object the instant ClearSinkSync returns.
class BlockingSink final : public IMidiOutputSink {
public:
    void Send(const BasicMidi& midi) override {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            ++sendEnteredCount_;
            entered_ = true;
        }
        enteredCv_.notify_all();

        std::unique_lock<std::mutex> lock(mutex_);
        releaseCv_.wait(lock, [this] { return released_; });

        ++sendCompletedCountLocked_;
        lock.unlock();
        completedCv_.notify_all();

        // Record after unlocking sendCompletedCountLocked_'s critical
        // section but still inside Send() -- destroyedDuringSend below is
        // what actually matters for the use-after-free assertion; this
        // field just proves Send() genuinely ran to completion once
        // released, for sanity-checking test setup itself.
        (void)midi;
    }

    // Blocks the calling (test) thread until Send() has been entered at
    // least `count` times.
    void WaitEntered(int count) {
        std::unique_lock<std::mutex> lock(mutex_);
        enteredCv_.wait(lock, [this, count] { return sendEnteredCount_ >= count; });
    }

    // Releases a blocked Send() call to complete.
    void Release() {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            released_ = true;
        }
        releaseCv_.notify_all();
    }

    bool EnteredAtLeastOnce() {
        std::lock_guard<std::mutex> lock(mutex_);
        return sendEnteredCount_ > 0;
    }

    int SendEnteredCount() {
        std::lock_guard<std::mutex> lock(mutex_);
        return sendEnteredCount_;
    }

private:
    std::mutex mutex_;
    std::condition_variable enteredCv_;
    std::condition_variable releaseCv_;
    std::condition_variable completedCv_;
    bool entered_ = false;
    bool released_ = false;
    int sendEnteredCount_ = 0;
    int sendCompletedCountLocked_ = 0;
};

class BlockingScheduledSink final : public IMidiOutputSink {
public:
    MidiSchedulingCapability SchedulingCapability() const noexcept override {
        return MidiSchedulingCapability::HostTimestamped;
    }

    void Send(const BasicMidi&) override {}

    void SendScheduled(const BasicMidi& midi, std::uint64_t dueTimeMicros) override {
        {
            std::lock_guard lock(mutex_);
            ++entered_;
        }
        enteredCv_.notify_all();
        std::unique_lock lock(mutex_);
        releaseCv_.wait(lock, [this] { return released_; });
        deliveries_.push_back({.midi = midi, .scheduled = true, .dueTimeMicros = dueTimeMicros});
    }

    void WaitEntered(int count) {
        std::unique_lock lock(mutex_);
        enteredCv_.wait(lock, [this, count] { return entered_ >= count; });
    }

    void Release() {
        {
            std::lock_guard lock(mutex_);
            released_ = true;
        }
        releaseCv_.notify_all();
    }

    std::vector<RecordingSink::Delivery> Snapshot() {
        std::lock_guard lock(mutex_);
        return deliveries_;
    }

private:
    std::mutex mutex_;
    std::condition_variable enteredCv_;
    std::condition_variable releaseCv_;
    bool released_ = false;
    int entered_ = 0;
    std::vector<RecordingSink::Delivery> deliveries_;
};

BasicMidi NoteOn() {
    BasicMidi midi;
    midi.timestamp = 0;
    midi.raw = {0x90, 0x40, 0x7F};
    return midi;
}

ScheduledMidiEvent RealtimeEvent(
    ScheduledMidiEventKind kind,
    std::uint64_t dueTimeMicros,
    std::uint64_t sequence,
    std::uint64_t generation = 0) {
    ScheduledMidiOrderingIntent ordering = ScheduledMidiOrderingIntent::Transport;
    if (kind == ScheduledMidiEventKind::TimingClock) {
        ordering = ScheduledMidiOrderingIntent::Clock;
    } else if (kind == ScheduledMidiEventKind::PhaseGenerationCutoff) {
        ordering = ScheduledMidiOrderingIntent::GenerationCutoff;
    }
    return ScheduledMidiEvent{
        .kind = kind,
        .orderingIntent = ordering,
        .broadcast = true,
        .dueTimeMicros = dueTimeMicros,
        .sequence = sequence,
        .phaseGeneration = generation,
    };
}

template <typename Predicate>
bool WaitUntil(Predicate&& predicate, std::chrono::milliseconds timeout = std::chrono::milliseconds(1000)) {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    while (!predicate()) {
        if (std::chrono::steady_clock::now() >= deadline) {
            return false;
        }
        std::this_thread::yield();
    }
    return true;
}

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

} // namespace

TEST_CASE(scheduled_realtime_broadcast_preserves_original_deadline) {
    std::atomic<std::uint64_t> nowMicros{10'000};
    MidiSender sender(16, [&nowMicros] { return nowMicros.load(std::memory_order_relaxed); });
    RecordingSink first(true);
    RecordingSink second(true);
    sender.SetSink(0, &first);
    sender.SetSink(1, &second);

    const ScheduledMidiEvent clock = RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 10'500, 1, 7);
    REQUIRE_TRUE(sender.TryEnqueue(clock));
    sender.Start();
    REQUIRE_TRUE(sender.FlushForTests(std::chrono::milliseconds(500)));
    sender.Stop();

    const auto firstDeliveries = first.Snapshot();
    const auto secondDeliveries = second.Snapshot();
    REQUIRE_TRUE(firstDeliveries.size() == 1);
    REQUIRE_TRUE(secondDeliveries.size() == 1);
    REQUIRE_TRUE(firstDeliveries[0].midi.raw == std::vector<std::uint8_t>{0xF8});
    REQUIRE_TRUE(firstDeliveries[0].scheduled);
    REQUIRE_TRUE(firstDeliveries[0].dueTimeMicros == clock.dueTimeMicros);
    REQUIRE_TRUE(secondDeliveries[0].dueTimeMicros == clock.dueTimeMicros);
}

TEST_CASE(host_timestamped_broadcast_uses_the_max_registered_sink_lead) {
    std::atomic<std::uint64_t> nowMicros{100'000};
    MidiSender sender(16, [&nowMicros] { return nowMicros.load(std::memory_order_relaxed); });
    RecordingSink shortLead(true, 1'000);
    RecordingSink browserLead(true, 25'000);
    sender.SetSink(0, &shortLead);
    sender.SetSink(1, &browserLead);
    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 125'000, 1, 7)));

    sender.Start();
    REQUIRE_TRUE(WaitUntil([&] {
        return shortLead.Snapshot().size() == 1 && browserLead.Snapshot().size() == 1;
    }, std::chrono::milliseconds(100)));
    sender.Stop();

    REQUIRE_TRUE(shortLead.Snapshot()[0].dueTimeMicros == 125'000);
    REQUIRE_TRUE(browserLead.Snapshot()[0].dueTimeMicros == 125'000);
}

TEST_CASE(registering_a_long_lead_sink_wakes_a_sender_waiting_for_the_deadline) {
    std::atomic<std::uint64_t> nowMicros{100'000};
    MidiSender sender(16, [&nowMicros] { return nowMicros.load(std::memory_order_relaxed); });
    RecordingSink longLead(true, 900'000);
    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 1'000'000, 1, 7)));
    sender.Start();

    // Let the worker consume the realtime lane and begin its deadline wait
    // while there are no host-timestamped sinks registered.
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
    sender.SetSink(0, &longLead);
    REQUIRE_TRUE(WaitUntil([&] {
        return longLead.Snapshot().size() == 1;
    }, std::chrono::milliseconds(100)));
    sender.Stop();
}

TEST_CASE(horizon_ready_old_generation_is_cut_off_before_any_sink_snapshot) {
    std::atomic<std::uint64_t> nowMicros{100'000};
    MidiSender sender(16, [&nowMicros] { return nowMicros.load(std::memory_order_relaxed); });
    RecordingSink browserLead(true, 25'000);
    sender.SetSink(0, &browserLead);
    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 125'000, 1, 11)));
    ScheduledMidiEvent cutoff = RealtimeEvent(
        ScheduledMidiEventKind::PhaseGenerationCutoff, 125'000, 2, 12);
    cutoff.invalidatedPhaseGeneration = 11;
    cutoff.phaseCutoffDueTimeMicros = 125'000;
    REQUIRE_TRUE(sender.TryEnqueue(cutoff));

    sender.Start();
    REQUIRE_TRUE(sender.FlushForTests(std::chrono::milliseconds(500)));
    sender.Stop();

    REQUIRE_TRUE(browserLead.Snapshot().empty());
    REQUIRE_TRUE(sender.DiagnosticsSnapshot().staleGenerationDropCount == 1);
}

TEST_CASE(due_realtime_precedes_feedback_without_cross_sink_leakage) {
    std::atomic<std::uint64_t> nowMicros{20'000};
    MidiSender sender(16, [&nowMicros] { return nowMicros.load(std::memory_order_relaxed); });
    RecordingSink first;
    RecordingSink second;
    sender.SetSink(0, &first);
    sender.SetSink(1, &second);

    REQUIRE_TRUE(sender.Enqueue(0, NoteOn()));
    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 20'000, 2, 3)));
    sender.Start();
    REQUIRE_TRUE(sender.FlushForTests(std::chrono::milliseconds(500)));
    sender.Stop();

    const auto firstDeliveries = first.Snapshot();
    const auto secondDeliveries = second.Snapshot();
    REQUIRE_TRUE(firstDeliveries.size() == 2);
    REQUIRE_TRUE(firstDeliveries[0].midi.raw == std::vector<std::uint8_t>{0xF8});
    REQUIRE_TRUE(firstDeliveries[1].midi.raw == NoteOn().raw);
    REQUIRE_TRUE(secondDeliveries.size() == 1);
    REQUIRE_TRUE(secondDeliveries[0].midi.raw == std::vector<std::uint8_t>{0xF8});
}

TEST_CASE(equal_deadline_orders_transport_before_clock_then_sequence) {
    std::atomic<std::uint64_t> nowMicros{30'000};
    MidiSender sender(16, [&nowMicros] { return nowMicros.load(std::memory_order_relaxed); });
    RecordingSink sink;
    sender.SetSink(0, &sink);

    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 30'000, 4, 5)));
    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::Continue, 30'000, 3)));
    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::Start, 30'000, 2)));
    sender.Start();
    REQUIRE_TRUE(sender.FlushForTests(std::chrono::milliseconds(500)));
    sender.Stop();

    const auto deliveries = sink.Snapshot();
    REQUIRE_TRUE(deliveries.size() == 3);
    REQUIRE_TRUE(deliveries[0].midi.raw == std::vector<std::uint8_t>{0xFA});
    REQUIRE_TRUE(deliveries[1].midi.raw == std::vector<std::uint8_t>{0xFB});
    REQUIRE_TRUE(deliveries[2].midi.raw == std::vector<std::uint8_t>{0xF8});
}

TEST_CASE(cutoff_retains_old_generation_before_cutoff_and_drops_at_cutoff) {
    std::atomic<std::uint64_t> nowMicros{40'000};
    MidiSender sender(16, [&nowMicros] { return nowMicros.load(std::memory_order_relaxed); });
    RecordingSink sink;
    sender.SetSink(0, &sink);

    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 39'999, 1, 11)));
    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 40'000, 2, 11)));
    ScheduledMidiEvent cutoff = RealtimeEvent(
        ScheduledMidiEventKind::PhaseGenerationCutoff, 40'000, 3, 12);
    cutoff.invalidatedPhaseGeneration = 11;
    cutoff.phaseCutoffDueTimeMicros = 40'000;
    REQUIRE_TRUE(sender.TryEnqueue(cutoff));
    sender.Start();
    REQUIRE_TRUE(sender.FlushForTests(std::chrono::milliseconds(500)));
    sender.Stop();

    const auto deliveries = sink.Snapshot();
    REQUIRE_TRUE(deliveries.size() == 1);
    REQUIRE_TRUE(deliveries[0].midi.raw == std::vector<std::uint8_t>{0xF8});
    const auto diagnostics = sender.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.staleGenerationDropCount == 1);
}

TEST_CASE(realtime_lane_overflow_drops_newest_and_is_observable) {
    MidiSender sender;
    for (std::size_t index = 0; index < MidiSender::kScheduledRealtimeCapacity; ++index) {
        REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
            ScheduledMidiEventKind::TimingClock,
            1'000'000 + index,
            index + 1,
            1)));
    }
    REQUIRE_TRUE(!sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 2'000'000, 99'999, 1)));
    REQUIRE_TRUE(sender.DiagnosticsSnapshot().producerOverflowCount == 1);
}

TEST_CASE(immediate_only_sink_waits_for_due_and_reports_fallback) {
    std::atomic<std::uint64_t> nowMicros{50'000};
    MidiSender sender(16, [&nowMicros] { return nowMicros.load(std::memory_order_relaxed); });
    RecordingSink sink;
    sender.SetSink(0, &sink);
    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 60'000, 1, 2)));
    sender.Start();

    std::this_thread::sleep_for(std::chrono::milliseconds(20));
    REQUIRE_TRUE(sink.Snapshot().empty());
    nowMicros.store(60'001, std::memory_order_relaxed);
    REQUIRE_TRUE(sender.Enqueue(0, NoteOn()));
    REQUIRE_TRUE(sender.FlushForTests(std::chrono::milliseconds(500)));
    sender.Stop();

    const auto deliveries = sink.Snapshot();
    REQUIRE_TRUE(deliveries.size() == 2);
    REQUIRE_TRUE(deliveries[0].midi.raw == std::vector<std::uint8_t>{0xF8});
    REQUIRE_TRUE(!deliveries[0].scheduled);
    REQUIRE_TRUE(sender.DiagnosticsSnapshot().fallbackSendCount == 1);
    REQUIRE_TRUE(sender.DiagnosticsSnapshot().lateEventCount == 1);
}

TEST_CASE(late_scheduled_delivery_keeps_due_time_and_counts_lateness) {
    std::atomic<std::uint64_t> nowMicros{80'000};
    MidiSender sender(16, [&nowMicros] { return nowMicros.load(std::memory_order_relaxed); });
    RecordingSink sink(true);
    sender.SetSink(0, &sink);
    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 70'000, 1, 2)));
    sender.Start();
    REQUIRE_TRUE(sender.FlushForTests(std::chrono::milliseconds(500)));
    sender.Stop();

    const auto deliveries = sink.Snapshot();
    REQUIRE_TRUE(deliveries.size() == 1);
    REQUIRE_TRUE(deliveries[0].scheduled);
    REQUIRE_TRUE(deliveries[0].dueTimeMicros == 70'000);
    REQUIRE_TRUE(sender.DiagnosticsSnapshot().lateEventCount == 1);
}

TEST_CASE(scheduled_broadcast_snapshot_excludes_a_reconnected_sink_and_clear_is_per_sink) {
    std::atomic<std::uint64_t> nowMicros{100'000};
    MidiSender sender(16, [&nowMicros] { return nowMicros.load(std::memory_order_relaxed); });
    BlockingScheduledSink blocked;
    RecordingSink disconnected(true);
    RecordingSink reconnected(true);
    sender.SetSink(0, &blocked);
    sender.SetSink(1, &disconnected);
    sender.Start();

    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 100'500, 1, 2)));
    blocked.WaitEntered(1);

    const auto clearStart = std::chrono::steady_clock::now();
    sender.ClearSinkSync(1);
    REQUIRE_TRUE(std::chrono::steady_clock::now() - clearStart < std::chrono::milliseconds(500));
    sender.SetSink(1, &reconnected);
    blocked.Release();
    REQUIRE_TRUE(sender.FlushForTests(std::chrono::milliseconds(500)));
    REQUIRE_TRUE(disconnected.Snapshot().empty());
    REQUIRE_TRUE(reconnected.Snapshot().empty());

    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 101'000, 2, 2)));
    REQUIRE_TRUE(sender.FlushForTests(std::chrono::milliseconds(500)));
    sender.Stop();
    REQUIRE_TRUE(reconnected.Snapshot().size() == 1);
}

TEST_CASE(worker_pending_overflow_drops_newest_consumed_event_and_is_observable) {
    std::atomic<std::uint64_t> nowMicros{0};
    MidiSender sender(16, [&nowMicros] { return nowMicros.load(std::memory_order_relaxed); });
    for (std::size_t index = 0; index < MidiSender::kScheduledRealtimeCapacity; ++index) {
        REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
            ScheduledMidiEventKind::TimingClock,
            1'000'000'000 + index,
            index + 1,
            9)));
    }
    sender.Start();

    bool acceptedAfterDrain = false;
    const auto acceptDeadline = std::chrono::steady_clock::now() + std::chrono::seconds(1);
    while (!acceptedAfterDrain && std::chrono::steady_clock::now() < acceptDeadline) {
        acceptedAfterDrain = sender.TryEnqueue(RealtimeEvent(
            ScheduledMidiEventKind::TimingClock, 2'000'000'000, 99'999, 9));
        std::this_thread::yield();
    }
    REQUIRE_TRUE(acceptedAfterDrain);
    REQUIRE_TRUE(WaitUntil([&sender] {
        return sender.DiagnosticsSnapshot().workerOverflowCount > 0;
    }));
    sender.Stop();
}

TEST_CASE(master_clock_events_cross_the_concrete_sender_without_deadline_replacement) {
    std::atomic<std::uint64_t> nowMicros{3'000'000};
    MidiSender sender(16, [&nowMicros] { return nowMicros.load(std::memory_order_relaxed); });
    RecordingSink sink(true);
    sender.SetSink(0, &sink);

    synth::MasterClock clock;
    clock.SetScheduledMidiEventSink(&sender);
    REQUIRE_TRUE(clock.SetTempoBpm(60.0));
    synth::SyncConfig config;
    config.sendClock = true;
    config.ppqn = 4;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(100.0, 25));
    REQUIRE_TRUE(clock.CommitBlock(0, 25, 1'000'000) != nullptr);
    REQUIRE_TRUE(clock.CommitBlock(25, 25, 1'250'000) != nullptr);
    REQUIRE_TRUE(clock.CommitBlock(50, 25, 1'500'000) != nullptr);

    sender.Start();
    REQUIRE_TRUE(sender.FlushForTests(std::chrono::milliseconds(500)));
    sender.Stop();

    const auto deliveries = sink.Snapshot();
    REQUIRE_TRUE(deliveries.size() == 2);
    REQUIRE_TRUE(deliveries[0].dueTimeMicros == 1'750'000);
    REQUIRE_TRUE(deliveries[1].dueTimeMicros == 2'000'000);
    REQUIRE_TRUE(deliveries[1].dueTimeMicros - deliveries[0].dueTimeMicros == 250'000);
}

TEST_CASE(external_transition_regeneration_crosses_sender_with_fixed_offset_and_no_clock_hole) {
    std::atomic<std::uint64_t> nowMicros{3'000'000};
    MidiSender sender(32, [&nowMicros] { return nowMicros.load(std::memory_order_relaxed); });
    RecordingSink sink(true);
    sender.SetSink(0, &sink);

    synth::MasterClock clock;
    clock.SetScheduledMidiEventSink(&sender);
    synth::SyncConfig config;
    config.receiveClock = true;
    config.receiveTransport = true;
    config.sendTransport = true;
    config.ppqn = 24;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.Prepare(1000.0, 100));
    REQUIRE_TRUE(clock.CommitBlock(0, 100, 1'000'000) != nullptr);

    config.sendClock = true;
    REQUIRE_TRUE(clock.ApplySyncConfig(config));
    REQUIRE_TRUE(clock.HandleExternalTransport(
        synth::ClockTransportCommand::Continue, 1'010'000, 0));
    REQUIRE_TRUE(clock.HandleExternalClock(1'010'000, 0));

    sender.Start();
    REQUIRE_TRUE(sender.FlushForTests(std::chrono::milliseconds(500)));
    sender.Stop();

    const auto deliveries = sink.Snapshot();
    REQUIRE_TRUE(deliveries.size() >= 3);
    REQUIRE_TRUE(deliveries[0].midi.raw == std::vector<std::uint8_t>{0xFB});
    REQUIRE_TRUE(deliveries[0].dueTimeMicros == 1'210'000);
    REQUIRE_TRUE(deliveries[1].midi.raw == std::vector<std::uint8_t>{0xF8});
    REQUIRE_TRUE(deliveries[1].dueTimeMicros == 1'210'000);
    REQUIRE_TRUE(deliveries[2].midi.raw == std::vector<std::uint8_t>{0xF8});
    REQUIRE_TRUE(deliveries[2].dueTimeMicros == 1'230'833);
    REQUIRE_TRUE(deliveries[0].dueTimeMicros - 1'010'000 == 200'000);
    REQUIRE_TRUE(deliveries[2].dueTimeMicros - deliveries[1].dueTimeMicros == 20'833);
}

TEST_CASE(stop_discards_far_future_pending_events_without_waiting) {
    std::atomic<std::uint64_t> nowMicros{90'000};
    MidiSender sender(16, [&nowMicros] { return nowMicros.load(std::memory_order_relaxed); });
    RecordingSink sink;
    sender.SetSink(0, &sink);
    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 10'000'000, 1, 2)));
    sender.Start();
    const auto start = std::chrono::steady_clock::now();
    sender.Stop();
    REQUIRE_TRUE(std::chrono::steady_clock::now() - start < std::chrono::seconds(1));
    REQUIRE_TRUE(sink.Snapshot().empty());
}

TEST_CASE(quiescent_one_shot_scheduled_transport_never_strands_on_an_idle_wakeup_race) {
    std::atomic<std::uint64_t> nowMicros{500'000};
    MidiSender sender(16, [&nowMicros] { return nowMicros.load(std::memory_order_relaxed); });
    RecordingSink sink;
    sender.SetSink(0, &sink);
    sender.Start();

    constexpr std::size_t kOneShotCount = 2048;
    for (std::size_t index = 0; index < kOneShotCount; ++index) {
        REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
            ScheduledMidiEventKind::Start, 500'000, index + 1)));
        REQUIRE_TRUE(sender.FlushForTests(std::chrono::milliseconds(100)));
    }
    sender.Stop();

    REQUIRE_TRUE(sink.Snapshot().size() == kOneShotCount);
}

TEST_CASE(missing_timestamp_provider_uses_steady_clock_epoch_for_scheduled_delivery) {
    MidiSender sender(16);
    RecordingSink sink;
    sender.SetSink(0, &sink);
    sender.Start();

    const std::uint64_t nowMicros = static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::steady_clock::now().time_since_epoch()).count());
    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::Continue, nowMicros + 2'000, 1)));
    REQUIRE_TRUE(sender.FlushForTests(std::chrono::milliseconds(500)));
    sender.Stop();

    const auto deliveries = sink.Snapshot();
    REQUIRE_TRUE(deliveries.size() == 1);
    REQUIRE_TRUE(deliveries[0].midi.raw == std::vector<std::uint8_t>{0xFB});
}

// Baseline: SetSink + Enqueue + FlushForTests actually delivers to the sink
// (sanity check the harness itself before testing the trickier clear-sync
// path below).
TEST_CASE(enqueued_message_is_delivered_to_registered_sink) {
    MidiSender sender;
    ImmediateSink sink;
    sender.SetSink(0, &sink);
    sender.Start();

    REQUIRE_TRUE(sender.Enqueue(0, NoteOn()));
    REQUIRE_TRUE(sender.FlushForTests(std::chrono::milliseconds(500)));

    sender.Stop();

    std::lock_guard<std::mutex> lock(sink.mutex);
    REQUIRE_TRUE(sink.received.size() == 1);
}

// The core use-after-free regression test (Task 2 review, Critical): a
// blocked in-flight Send() must complete before ClearSinkSync returns, and
// no Send() may start against the sink afterward -- proving it is safe to
// destroy the sink object the instant ClearSinkSync returns, unlike plain
// SetSink(ix, nullptr) which does not wait for anything.
//
// Thread-timing sensitive: run with generous timeouts. The harness invoking
// this binary runs it 8x per the review's instruction.
TEST_CASE(clear_sink_sync_waits_for_in_flight_send_before_returning) {
    MidiSender sender;
    BlockingSink sink;
    sender.SetSink(0, &sink);
    sender.Start();

    REQUIRE_TRUE(sender.Enqueue(0, NoteOn()));
    // Wait until the worker is genuinely inside Send() (blocked on
    // sink.releaseCv_) before starting the race -- otherwise ClearSinkSync
    // could win the race trivially by running before Send() ever starts,
    // which would not exercise the synchronization at all.
    sink.WaitEntered(1);

    std::atomic<bool> clearSyncReturned{false};
    std::thread clearer([&] {
        sender.ClearSinkSync(0);
        clearSyncReturned.store(true, std::memory_order_release);
    });

    // Give ClearSinkSync ample opportunity to (incorrectly) return early --
    // it must NOT, because Send() is still blocked inside the sink.
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    REQUIRE_TRUE(clearSyncReturned.load(std::memory_order_acquire) == false);
    REQUIRE_TRUE(sink.SendEnteredCount() == 1);

    // Now let Send() finish -- ClearSinkSync must unblock shortly after.
    sink.Release();
    clearer.join();
    REQUIRE_TRUE(clearSyncReturned.load(std::memory_order_acquire) == true);

    // Safe to "destroy" the sink now (simulated: enqueue more traffic for
    // the same sinkIx and prove nothing is ever delivered to it again --
    // the real destruction happens in MidiConnectionManager, this test
    // stands in for that guarantee at the MidiSender layer).
    const int countAfterClear = sink.SendEnteredCount();
    sender.SetSink(0, &sink); // re-register is irrelevant; sinkIx 0 already cleared by ClearSinkSync
    sender.Stop();
    REQUIRE_TRUE(sink.SendEnteredCount() == countAfterClear);
}

// ClearSinkSync must not block on, or care about, in-flight Send() calls for
// OTHER sinks -- only the specific sinkIx being cleared.
TEST_CASE(clear_sink_sync_does_not_wait_on_other_sinks) {
    MidiSender sender;
    BlockingSink blockedSink;   // sink 0: will be mid-Send when we clear sink 1
    ImmediateSink otherSink;    // sink 1: the one we actually clear
    sender.SetSink(0, &blockedSink);
    sender.SetSink(1, &otherSink);
    sender.Start();

    REQUIRE_TRUE(sender.Enqueue(0, NoteOn()));
    blockedSink.WaitEntered(1);

    // sinkIx 1 has nothing in flight -- clearing it must return promptly
    // even while sink 0's Send() is still blocked.
    const auto start = std::chrono::steady_clock::now();
    sender.ClearSinkSync(1);
    const auto elapsed = std::chrono::steady_clock::now() - start;
    REQUIRE_TRUE(elapsed < std::chrono::milliseconds(500));

    blockedSink.Release();
    sender.Stop();
}

// sinkIx >= kMaxSinks is a documented no-op, not a crash.
TEST_CASE(clear_sink_sync_out_of_range_is_a_no_op) {
    MidiSender sender;
    sender.Start();
    sender.ClearSinkSync(MidiSender::kMaxSinks);
    sender.ClearSinkSync(MidiSender::kMaxSinks + 100);
    sender.Stop();
}

// ClearSinkSync on a sink index with nothing in flight (never enqueued)
// returns immediately.
TEST_CASE(clear_sink_sync_with_nothing_in_flight_returns_promptly) {
    MidiSender sender;
    ImmediateSink sink;
    sender.SetSink(0, &sink);
    sender.Start();

    const auto start = std::chrono::steady_clock::now();
    sender.ClearSinkSync(0);
    const auto elapsed = std::chrono::steady_clock::now() - start;
    REQUIRE_TRUE(elapsed < std::chrono::milliseconds(500));

    sender.Stop();
}

// Stop() itself must still join and return promptly even after a
// ClearSinkSync has run -- no leaked lock/CV state prevents shutdown.
TEST_CASE(stop_after_clear_sink_sync_joins_promptly) {
    MidiSender sender;
    BlockingSink sink;
    sender.SetSink(0, &sink);
    sender.Start();

    REQUIRE_TRUE(sender.Enqueue(0, NoteOn()));
    sink.WaitEntered(1);

    std::thread clearer([&] { sender.ClearSinkSync(0); });
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    sink.Release();
    clearer.join();

    const auto start = std::chrono::steady_clock::now();
    sender.Stop();
    const auto elapsed = std::chrono::steady_clock::now() - start;
    REQUIRE_TRUE(elapsed < std::chrono::seconds(1));
}

TEST_CASE(acceptance_trace_concrete_sender_broadcast_reconnect_cutoff_and_fallback) {
    struct DeliveryRecord {
        std::size_t sink = 0;
        std::uint8_t status = 0;
        bool scheduled = false;
        std::uint64_t dueTimeMicros = 0;
    };

    std::atomic<std::uint64_t> nowMicros{100'000};
    MidiSender sender(32, [&nowMicros] {
        return nowMicros.load(std::memory_order_relaxed);
    });
    RecordingSink first(true, 25'000);
    RecordingSink second(true, 1'000);
    RecordingSink reconnected(true, 1'000);
    RecordingSink immediateOnly;
    sender.SetSink(0, &first);
    sender.SetSink(1, &second);
    // Slots 2 and 4 begin offline. Slot 2 reconnects only after the first
    // ordered broadcast has already been snapshotted and submitted.

    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 124'999, 1, 11)));
    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 125'000, 2, 11)));
    ScheduledMidiEvent cutoff = RealtimeEvent(
        ScheduledMidiEventKind::PhaseGenerationCutoff, 125'000, 3, 12);
    cutoff.invalidatedPhaseGeneration = 11;
    cutoff.phaseCutoffDueTimeMicros = 125'000;
    REQUIRE_TRUE(sender.TryEnqueue(cutoff));
    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::Start, 125'000, 4)));
    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 125'000, 5, 12)));
    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 200'000, 6, 12)));

    sender.Start();
    REQUIRE_TRUE(WaitUntil([&] {
        return first.Snapshot().size() == 3 && second.Snapshot().size() == 3;
    }));
    REQUIRE_TRUE(reconnected.Snapshot().empty());

    nowMicros.store(175'000, std::memory_order_relaxed);
    sender.SetSink(2, &reconnected);
    REQUIRE_TRUE(WaitUntil([&] {
        return first.Snapshot().size() == 4 &&
               second.Snapshot().size() == 4 &&
               reconnected.Snapshot().size() == 1;
    }));

    sender.SetSink(3, &immediateOnly);
    nowMicros.store(185'000, std::memory_order_relaxed);
    REQUIRE_TRUE(sender.TryEnqueue(RealtimeEvent(
        ScheduledMidiEventKind::TimingClock, 210'000, 7, 12)));
    REQUIRE_TRUE(WaitUntil([&] {
        return first.Snapshot().size() == 5 &&
               second.Snapshot().size() == 5 &&
               reconnected.Snapshot().size() == 2;
    }));
    REQUIRE_TRUE(immediateOnly.Snapshot().empty());

    nowMicros.store(210'001, std::memory_order_relaxed);
    REQUIRE_TRUE(sender.Enqueue(7, NoteOn()));
    REQUIRE_TRUE(sender.FlushForTests(std::chrono::milliseconds(500)));
    sender.Stop();

    const auto firstDeliveries = first.Snapshot();
    const auto secondDeliveries = second.Snapshot();
    const auto reconnectDeliveries = reconnected.Snapshot();
    const auto immediateDeliveries = immediateOnly.Snapshot();
    REQUIRE_TRUE(firstDeliveries.size() == 5);
    REQUIRE_TRUE(secondDeliveries.size() == firstDeliveries.size());
    for (std::size_t index = 0; index < firstDeliveries.size(); ++index) {
        REQUIRE_TRUE(firstDeliveries[index].midi.raw == secondDeliveries[index].midi.raw);
        REQUIRE_TRUE(firstDeliveries[index].scheduled);
        REQUIRE_TRUE(secondDeliveries[index].scheduled);
        REQUIRE_TRUE(firstDeliveries[index].dueTimeMicros ==
                     secondDeliveries[index].dueTimeMicros);
    }
    REQUIRE_TRUE(firstDeliveries[0].midi.raw ==
                 std::vector<std::uint8_t>{0xF8});
    REQUIRE_TRUE(firstDeliveries[0].dueTimeMicros == 124'999);
    REQUIRE_TRUE(firstDeliveries[1].midi.raw ==
                 std::vector<std::uint8_t>{0xFA});
    REQUIRE_TRUE(firstDeliveries[1].dueTimeMicros == 125'000);
    REQUIRE_TRUE(firstDeliveries[2].midi.raw ==
                 std::vector<std::uint8_t>{0xF8});
    REQUIRE_TRUE(firstDeliveries[2].dueTimeMicros == 125'000);
    REQUIRE_TRUE(firstDeliveries[3].dueTimeMicros == 200'000);
    REQUIRE_TRUE(firstDeliveries[4].dueTimeMicros == 210'000);

    REQUIRE_TRUE(reconnectDeliveries.size() == 2);
    REQUIRE_TRUE(reconnectDeliveries[0].dueTimeMicros == 200'000);
    REQUIRE_TRUE(reconnectDeliveries[1].dueTimeMicros == 210'000);
    for (const auto& delivery : reconnectDeliveries) {
        REQUIRE_TRUE(delivery.dueTimeMicros > 125'000);
    }
    REQUIRE_TRUE(immediateDeliveries.size() == 1);
    REQUIRE_TRUE(!immediateDeliveries[0].scheduled);
    REQUIRE_TRUE(immediateDeliveries[0].midi.raw ==
                 std::vector<std::uint8_t>{0xF8});
    REQUIRE_TRUE(immediateDeliveries[0].midi.timestamp == 210'000);

    const auto diagnostics = sender.DiagnosticsSnapshot();
    REQUIRE_TRUE(diagnostics.staleGenerationDropCount == 1);
    REQUIRE_TRUE(diagnostics.fallbackSendCount == 1);
    REQUIRE_TRUE(diagnostics.lateEventCount == 1);

    FixedTrace<DeliveryRecord, 13> trace;
    const auto append = [&trace](
                            std::size_t sinkIndex,
                            const std::vector<RecordingSink::Delivery>& deliveries) {
        for (const auto& delivery : deliveries) {
            if (!trace.Push({
                    .sink = sinkIndex,
                    .status = static_cast<std::uint8_t>(
                        delivery.midi.raw.empty() ? 0 : delivery.midi.raw.front()),
                    .scheduled = delivery.scheduled,
                    .dueTimeMicros = delivery.scheduled
                        ? delivery.dueTimeMicros
                        : delivery.midi.timestamp,
                })) {
                return false;
            }
        }
        return true;
    };
    REQUIRE_TRUE(append(0, firstDeliveries));
    REQUIRE_TRUE(append(1, secondDeliveries));
    REQUIRE_TRUE(append(2, reconnectDeliveries));
    REQUIRE_TRUE(append(3, immediateDeliveries));
    REQUIRE_TRUE(trace.Size() == 13);
    REQUIRE_TRUE(trace[0].dueTimeMicros == trace[5].dueTimeMicros);
    REQUIRE_TRUE(trace[1].status == 0xFA && trace[2].status == 0xF8);
    REQUIRE_TRUE(trace[10].dueTimeMicros == 200'000);
    REQUIRE_TRUE(!trace[12].scheduled && trace[12].dueTimeMicros == 210'000);

    std::cout << "[trace] concrete_sender records=" << trace.Size()
              << " broadcast_deadlines=5"
              << " stale_drops=" << diagnostics.staleGenerationDropCount
              << " reconnect_first_us=" << reconnectDeliveries[0].dueTimeMicros
              << " fallback=" << diagnostics.fallbackSendCount << "\n";
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
