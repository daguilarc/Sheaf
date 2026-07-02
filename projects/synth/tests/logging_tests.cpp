#include "synth/CircularQueue.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth logging tests must not see JUCE headers"
#endif

#include <exception>
#include <iostream>
#include <sstream>
#include <stdexcept>
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
