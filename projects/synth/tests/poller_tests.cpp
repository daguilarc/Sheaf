#include "synth/MidiDevicePoller.hpp"
#include "synth/ThreadId.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth module tests must not see JUCE headers"
#endif

#include <atomic>
#include <chrono>
#include <iostream>
#include <mutex>
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

using synth::MidiDeviceInfoRef;
using synth::MidiDeviceList;
using synth::MidiDevicePoller;

MidiDeviceList ListA() {
    MidiDeviceList list;
    list.inputs.push_back(MidiDeviceInfoRef{"in-1", "Twister"});
    list.outputs.push_back(MidiDeviceInfoRef{"out-1", "Twister"});
    return list;
}

MidiDeviceList ListB() {
    MidiDeviceList list;
    list.inputs.push_back(MidiDeviceInfoRef{"in-1", "Twister"});
    list.inputs.push_back(MidiDeviceInfoRef{"in-2", "Launchpad"});
    list.outputs.push_back(MidiDeviceInfoRef{"out-1", "Twister"});
    return list;
}

// A fake enumerate function that returns a controllable list and records
// which ThreadId it observed itself running under, so tests can assert the
// callback runs on the poll thread.
class FakeEnumerate {
public:
    MidiDeviceList operator()() {
        std::lock_guard<std::mutex> lock(mutex_);
        ++callCount_;
        observedThreadId_ = synth::GetCurrentThreadId();
        return list_;
    }

    void SetList(MidiDeviceList list) {
        std::lock_guard<std::mutex> lock(mutex_);
        list_ = std::move(list);
    }

    int CallCount() {
        std::lock_guard<std::mutex> lock(mutex_);
        return callCount_;
    }

    synth::ThreadId ObservedThreadId() {
        std::lock_guard<std::mutex> lock(mutex_);
        return observedThreadId_;
    }

private:
    std::mutex mutex_;
    MidiDeviceList list_;
    int callCount_ = 0;
    synth::ThreadId observedThreadId_ = synth::ThreadId::Unknown;
};

} // namespace

TEST_CASE(priming_poll_is_not_a_change) {
    MidiDevicePoller poller(std::chrono::seconds(5));
    FakeEnumerate fake;
    fake.SetList(ListA());

    poller.Start([&fake] { return fake(); });
    poller.PollNowForTests();

    MidiDeviceList latest;
    REQUIRE_TRUE(poller.ConsumeChange(latest) == false);

    poller.Stop();
}

TEST_CASE(change_from_a_to_b_reports_true_once) {
    MidiDevicePoller poller(std::chrono::seconds(5));
    FakeEnumerate fake;
    fake.SetList(ListA());

    poller.Start([&fake] { return fake(); });
    poller.PollNowForTests();  // primes

    MidiDeviceList primed;
    REQUIRE_TRUE(poller.ConsumeChange(primed) == false);

    fake.SetList(ListB());
    poller.PollNowForTests();

    MidiDeviceList latest;
    REQUIRE_TRUE(poller.ConsumeChange(latest) == true);
    REQUIRE_TRUE(latest.inputs.size() == 2);
    REQUIRE_TRUE(latest.inputs[0].identifier == "in-1");
    REQUIRE_TRUE(latest.inputs[1].identifier == "in-2");
    REQUIRE_TRUE(latest.outputs.size() == 1);

    // Second call returns false -- the flag was cleared by the first.
    MidiDeviceList second;
    REQUIRE_TRUE(poller.ConsumeChange(second) == false);

    poller.Stop();
}

TEST_CASE(identical_repeat_polls_do_not_report_change) {
    MidiDevicePoller poller(std::chrono::seconds(5));
    FakeEnumerate fake;
    fake.SetList(ListA());

    poller.Start([&fake] { return fake(); });
    poller.PollNowForTests();  // primes

    MidiDeviceList primed;
    REQUIRE_TRUE(poller.ConsumeChange(primed) == false);

    // Repeat the same list twice more -- no changes should ever be detected.
    poller.PollNowForTests();
    MidiDeviceList afterFirstRepeat;
    REQUIRE_TRUE(poller.ConsumeChange(afterFirstRepeat) == false);

    poller.PollNowForTests();
    MidiDeviceList afterSecondRepeat;
    REQUIRE_TRUE(poller.ConsumeChange(afterSecondRepeat) == false);

    poller.Stop();
}

TEST_CASE(stop_joins_promptly_well_under_interval) {
    MidiDevicePoller poller(std::chrono::seconds(5));
    FakeEnumerate fake;
    fake.SetList(ListA());

    poller.Start([&fake] { return fake(); });
    poller.PollNowForTests();

    const auto start = std::chrono::steady_clock::now();
    poller.Stop();
    const auto elapsed = std::chrono::steady_clock::now() - start;

    REQUIRE_TRUE(elapsed < std::chrono::seconds(1));
}

TEST_CASE(enumerate_runs_under_io_poll_thread_id) {
    MidiDevicePoller poller(std::chrono::seconds(5));
    FakeEnumerate fake;
    fake.SetList(ListA());

    poller.Start([&fake] { return fake(); });
    poller.PollNowForTests();

    REQUIRE_TRUE(fake.ObservedThreadId() == synth::ThreadId::IoPoll);

    poller.Stop();
}

TEST_CASE(stop_is_idempotent) {
    MidiDevicePoller poller(std::chrono::seconds(5));
    FakeEnumerate fake;
    fake.SetList(ListA());

    poller.Start([&fake] { return fake(); });
    poller.PollNowForTests();

    poller.Stop();
    poller.Stop();  // must not hang or crash
    poller.Stop();
}

TEST_CASE(destructor_without_stop_is_safe) {
    FakeEnumerate fake;
    fake.SetList(ListA());
    {
        MidiDevicePoller poller(std::chrono::seconds(5));
        poller.Start([&fake] { return fake(); });
        poller.PollNowForTests();
        // No explicit Stop() -- destructor must join cleanly.
    }
}

TEST_CASE(multiple_poll_now_calls_each_wait_for_their_own_cycle) {
    MidiDevicePoller poller(std::chrono::seconds(5));
    FakeEnumerate fake;
    fake.SetList(ListA());

    poller.Start([&fake] { return fake(); });
    poller.PollNowForTests();
    REQUIRE_TRUE(fake.CallCount() == 1);

    poller.PollNowForTests();
    REQUIRE_TRUE(fake.CallCount() == 2);

    poller.PollNowForTests();
    REQUIRE_TRUE(fake.CallCount() == 3);

    poller.Stop();
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
