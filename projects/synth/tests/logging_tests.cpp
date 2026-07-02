#include "synth/AsyncLogger.hpp"
#include "synth/CircularQueue.hpp"
#include "synth/ThreadId.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth logging tests must not see JUCE headers"
#endif

#include <atomic>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
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

} // namespace

TEST_CASE(circular_queue_push_pop_round_trip) {
    synth::CircularQueue<int, 4> queue;
    REQUIRE_TRUE(queue.IsEmpty());
    REQUIRE_TRUE(queue.Push(1));
    REQUIRE_TRUE(queue.Push(2));
    REQUIRE_TRUE(queue.Size() == 2);
    int value = 0;
    REQUIRE_TRUE(queue.Pop(value));
    REQUIRE_TRUE(value == 1);
    REQUIRE_TRUE(queue.Pop(value));
    REQUIRE_TRUE(value == 2);
    REQUIRE_TRUE(!queue.Pop(value));
}

TEST_CASE(circular_queue_reports_full_without_blocking) {
    synth::CircularQueue<int, 2> queue;
    std::size_t pushed = 0;
    while (queue.Push(static_cast<int>(pushed))) {
        ++pushed;
    }
    REQUIRE_TRUE(pushed == 2);           // full capacity is N usable slots
    REQUIRE_TRUE(queue.NextToPush() == nullptr);
    int value = -1;
    REQUIRE_TRUE(queue.Pop(value));
    REQUIRE_TRUE(queue.NextToPush() != nullptr);  // slot freed
}

TEST_CASE(circular_queue_in_place_publish) {
    synth::CircularQueue<int, 4> queue;
    int* slot = queue.NextToPush();
    REQUIRE_TRUE(slot != nullptr);
    *slot = 42;
    REQUIRE_TRUE(queue.IsEmpty());      // not visible until CompletePush
    queue.CompletePush();
    int value = 0;
    REQUIRE_TRUE(queue.Pop(value));
    REQUIRE_TRUE(value == 42);
}

TEST_CASE(circular_queue_spsc_threads_deliver_in_order) {
    synth::CircularQueue<int, 1024> queue;
    constexpr int kCount = 10000;
    std::thread producer([&queue] {
        for (int i = 0; i < kCount; ++i) {
            while (!queue.Push(i)) { std::this_thread::yield(); }
        }
    });
    int expected = 0;
    while (expected < kCount) {
        int value = -1;
        if (queue.Pop(value)) {
            REQUIRE_TRUE(value == expected);
            ++expected;
        } else {
            std::this_thread::yield();
        }
    }
    producer.join();
}

TEST_CASE(thread_id_defaults_to_unknown) {
    REQUIRE_TRUE(synth::GetCurrentThreadId() == synth::ThreadId::Unknown);
}

TEST_CASE(scoped_thread_id_sets_and_restores) {
    REQUIRE_TRUE(synth::GetCurrentThreadId() == synth::ThreadId::Unknown);
    {
        synth::ScopedThreadId scoped(synth::ThreadId::Audio);
        REQUIRE_TRUE(synth::GetCurrentThreadId() == synth::ThreadId::Audio);
        {
            synth::ScopedThreadId nested(synth::ThreadId::MidiInput);
            REQUIRE_TRUE(synth::GetCurrentThreadId() == synth::ThreadId::MidiInput);
        }
        REQUIRE_TRUE(synth::GetCurrentThreadId() == synth::ThreadId::Audio);
    }
    REQUIRE_TRUE(synth::GetCurrentThreadId() == synth::ThreadId::Unknown);
}

TEST_CASE(thread_id_is_thread_local) {
    synth::SetCurrentThreadId(synth::ThreadId::Message);
    synth::ThreadId seenOnOtherThread = synth::ThreadId::Message;
    std::thread other([&seenOnOtherThread] { seenOnOtherThread = synth::GetCurrentThreadId(); });
    other.join();
    REQUIRE_TRUE(seenOnOtherThread == synth::ThreadId::Unknown);
    synth::SetCurrentThreadId(synth::ThreadId::Unknown);  // restore for later cases
}

TEST_CASE(thread_id_names_and_indices) {
    REQUIRE_TRUE(std::string(synth::ThreadIdToString(synth::ThreadId::Audio)) == "Audio");
    REQUIRE_TRUE(std::string(synth::ThreadIdToString(synth::ThreadId::Unknown)) == "Unknown");
    REQUIRE_TRUE(synth::ThreadIdToIndex(synth::ThreadId::Message) == 0);
    REQUIRE_TRUE(synth::ThreadIdToIndex(synth::ThreadId::Unknown) == synth::kThreadIdCount - 1);
}

TEST_CASE(logger_round_trips_a_message_through_drain) {
    auto& log = synth::AsyncLogQueue::s_instance;
    log.ResetForTesting();
    {
        synth::ScopedThreadId scoped(synth::ThreadId::Audio);
        INFO("value is %d", 42);
    }
    REQUIRE_TRUE(log.QueueSizeForTesting(synth::ThreadId::Audio) == 1);
    log.DoLog();
    REQUIRE_TRUE(log.QueueSizeForTesting(synth::ThreadId::Audio) == 0);
}

TEST_CASE(logger_routes_by_thread_identity) {
    auto& log = synth::AsyncLogQueue::s_instance;
    log.ResetForTesting();
    { synth::ScopedThreadId scoped(synth::ThreadId::Audio); INFO("from audio"); }
    { synth::ScopedThreadId scoped(synth::ThreadId::Message); INFO("from message"); }
    INFO("untagged");
    REQUIRE_TRUE(log.QueueSizeForTesting(synth::ThreadId::Audio) == 1);
    REQUIRE_TRUE(log.QueueSizeForTesting(synth::ThreadId::Message) == 1);
    REQUIRE_TRUE(log.QueueSizeForTesting(synth::ThreadId::Unknown) == 1);
    log.DoLog();
}

TEST_CASE(logger_overflow_drops_and_counts_missed) {
    auto& log = synth::AsyncLogQueue::s_instance;
    log.ResetForTesting();
    synth::ScopedThreadId scoped(synth::ThreadId::Audio);
    for (std::size_t i = 0; i < synth::AsyncLogQueue::kQueueSize + 10; ++i) {
        INFO("burst %zu", i);
    }
    REQUIRE_TRUE(log.MissedCountForTesting(synth::ThreadId::Audio) >= 1);
    log.DoLog();  // drains and reports the missed count
    REQUIRE_TRUE(log.MissedCountForTesting(synth::ThreadId::Audio) == 0);
}

TEST_CASE(logger_truncates_long_messages) {
    auto& log = synth::AsyncLogQueue::s_instance;
    log.ResetForTesting();
    const std::string huge(2 * synth::LogMessage::kMaxMessageLength, 'x');
    INFO("%s", huge.c_str());
    REQUIRE_TRUE(log.QueueSizeForTesting(synth::ThreadId::Unknown) == 1);  // queued, not crashed
    log.DoLog();
}

TEST_CASE(logger_concurrent_distinct_identities_do_not_race) {
    auto& log = synth::AsyncLogQueue::s_instance;
    log.ResetForTesting();
    constexpr int kPerThread = 2000;
    std::thread audio([&] {
        synth::ScopedThreadId scoped(synth::ThreadId::Audio);
        for (int i = 0; i < kPerThread; ++i) { INFO("audio %d", i); }
    });
    std::thread midi([&] {
        synth::ScopedThreadId scoped(synth::ThreadId::MidiInput);
        for (int i = 0; i < kPerThread; ++i) { INFO("midi %d", i); }
    });
    audio.join();
    midi.join();
    const std::size_t audioTotal = log.QueueSizeForTesting(synth::ThreadId::Audio)
                                 + log.MissedCountForTesting(synth::ThreadId::Audio);
    const std::size_t midiTotal = log.QueueSizeForTesting(synth::ThreadId::MidiInput)
                                + log.MissedCountForTesting(synth::ThreadId::MidiInput);
    REQUIRE_TRUE(audioTotal == kPerThread);
    REQUIRE_TRUE(midiTotal == kPerThread);
    log.DoLog();
}

TEST_CASE(logger_session_file_created_once_and_appended) {
    auto& log = synth::AsyncLogQueue::s_instance;
    log.ResetForTesting();
    const auto dir = std::filesystem::temp_directory_path() / "synth-logger-test";
    std::filesystem::remove_all(dir);
    std::filesystem::create_directories(dir);
    log.SetLogDirectoryForTesting(dir.string().c_str());
    INFO("first line");
    log.DoLog();
    const std::string path = log.LogFilePathForTesting();
    REQUIRE_TRUE(!path.empty());
    INFO("second line");
    log.DoLog();
    REQUIRE_TRUE(log.LogFilePathForTesting() == path);  // same session file
    std::ifstream in(path);
    std::string contents((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    REQUIRE_TRUE(contents.find("first line") != std::string::npos);
    REQUIRE_TRUE(contents.find("second line") != std::string::npos);
    REQUIRE_TRUE(contents.find("Unknown") != std::string::npos);  // thread name in line
    log.ResetForTesting();
    std::filesystem::remove_all(dir);
}

TEST_CASE(logger_without_directory_stays_stdout_only) {
    auto& log = synth::AsyncLogQueue::s_instance;
    log.ResetForTesting();
    INFO("no directory configured");
    log.DoLog();
    REQUIRE_TRUE(log.LogFilePathForTesting().empty());
}

TEST_CASE(logger_sample_stamps_read_counter_source) {
    auto& log = synth::AsyncLogQueue::s_instance;
    log.ResetForTesting();
    const auto dir = std::filesystem::temp_directory_path() / "synth-logger-stamp-test";
    std::filesystem::remove_all(dir);
    std::filesystem::create_directories(dir);
    log.SetLogDirectoryForTesting(dir.string().c_str());
    std::atomic<std::uint64_t> counter{123456};
    log.SetSampleCounterSource(&counter);
    INFO("stamped");
    log.DoLog();
    std::ifstream in(log.LogFilePathForTesting());
    std::string contents((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    REQUIRE_TRUE(contents.find("123456") != std::string::npos);
    log.SetSampleCounterSource(nullptr);
    log.ResetForTesting();
    std::filesystem::remove_all(dir);
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
