# Synth App Runtime — Plan 1/3: Core Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the JUCE-free application contract headers, the async logging system ported from The All Electric Smart Grid, and the slew-preserving `ComputeAllTargets` manager API — the core-library foundations for the synth application runtime.

**Architecture:** Everything in this plan lives in the JUCE-free core (`projects/synth/include/synth`, `projects/synth/src`, `projects/synth/tests`). Contract headers define `RuntimeConfig`/`AudioBlock`/`AppContext` consumed later by the engine/runtime (Plans 2–3). The logging port is `CircularQueue<T, N>` (lock-free SPSC ring) + `ThreadId` (thread-local identity) + `AsyncLogQueue` (per-identity queues, producer-side formatting, message-thread drain to stdout + session file). `ComputeAllTargets` mirrors `ComputeAllParameters` minus `SnapCurrentToTarget`.

**Tech Stack:** C++20, GNU make, the repo's bespoke `TEST_CASE`/`REQUIRE_TRUE` micro test framework (see `projects/synth/tests/module_tests.cpp:16-56`).

**OpenSpec change:** `openspec/changes/synth-app-runtime` — this plan implements task groups 1, 2, and task 3.3 of `tasks.md`, satisfying requirements sar-1 (contract-header scenarios), sar-3 (struct shape), slog-1..slog-6, slog-8, and the sar-6 slew requirement's library prerequisite.

## Global Constraints

- C++20, compiled with `-std=c++20 -Wall -Wextra -Wpedantic -O2`; test output must be pristine (zero warnings).
- Everything in this plan is JUCE-free: every new test file starts with `#ifdef JUCE_MAJOR_VERSION` / `#error` guard like `tests/module_tests.cpp:3-5`.
- Namespace `synth`; house style: PascalCase methods (`GetCurrentThreadId`), trailing-underscore private members (`length_`), `enum class`, `k`-prefixed constexpr constants, exceptions only for coding errors, status enums/bools for expected failures.
- Logging producer path (`AsyncLogQueue::Log`): no heap allocation, no locks, no file/console IO, bounded work (one `snprintf` into a fixed 256-byte slot). Overflow drops the new message and increments an atomic per-identity missed counter — never blocks (slog-3, slog-4).
- One queue per `ThreadId` identity; concurrent producers must hold distinct identities; `Unknown` is reserved for single-threaded contexts — document this on the interface (slog-2, slog-3).
- Drain line format: `HH:MM:SS <sample> <thread-name> <message>`; one timestamp-named session log file per process, created lazily, append + flush per line; no directory configured → stdout only (slog-5).
- Sample stamps come from a settable non-owning `const std::atomic<std::uint64_t>*` source, default unset → stamp 0 (slog-6). No `SampleTimer`-style singleton.
- Port source of truth: `/Users/joyo/theallelectricsmartgrid/private/src/CircularQueue.hpp`, `ThreadId.hpp`, `AsyncLogger.hpp`. Port semantics faithfully; adapt naming to synth house style; do NOT port `ByteBuffer`/`CircularByteQueue`, the smart-grid `ThreadId` enum values, or any `SampleTimer` reference.
- `make -C projects/synth test` must pass after every task; run it from the repo root of this worktree.
- Commit after each task with a `feat:`/`test:` style subject and the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Application contract headers

**Files:**
- Create: `projects/synth/include/synth/AppContext.hpp`
- Create: `projects/synth/tests/contract_tests.cpp`
- Modify: `projects/synth/Makefile` (add `contract_tests` binary)

**Interfaces:**
- Consumes: existing types `synth::ParameterManager` (+ nested `UIState`), `synth::MessageInBus`, `synth::ParameterMessageOutBus` (from `synth/ParameterModulation.hpp`); `synth::PatchManager`, `synth::PatchMessageInBus`, `synth::MessageOutBus` (from `synth/PatchPersistence.hpp`); `synth::MidiSender`, `synth::MidiControllerProfileConfig` (from `synth/MidiController.hpp`).
- Produces: `synth::RuntimeConfig`, `synth::AudioBlock`, `synth::AppContext` — Plans 2–3 construct/consume these exactly as defined here.

- [ ] **Step 1: Write the failing test**

Create `projects/synth/tests/contract_tests.cpp`. Copy the test framework block verbatim from `tests/module_tests.cpp` lines 16–56 (the `TestCase`/`Registry`/`Register` structs and the `TEST_CASE`, `REQUIRE_TRUE`, `REQUIRE_NEAR` macros) into an anonymous namespace, and copy the `main()` runner from the bottom of that same file. Then add:

```cpp
#include "synth/AppContext.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth contract tests must not see JUCE headers"
#endif

// ... framework block ...

TEST_CASE(runtime_config_defaults_are_sensible) {
    const synth::RuntimeConfig config;
    REQUIRE_TRUE(config.appName.empty());
    REQUIRE_TRUE(config.numAudioInputs == 0);
    REQUIRE_TRUE(config.numAudioOutputs == 2);
    REQUIRE_NEAR(static_cast<float>(config.preferredSampleRate), 48000.0f, 1e-3f);
    REQUIRE_TRUE(config.preferredBlockSize == 256);
    REQUIRE_TRUE(config.patchesRoot.empty());
    REQUIRE_TRUE(config.logsRoot.empty());
    REQUIRE_TRUE(config.uiWidth == 900);
    REQUIRE_TRUE(config.uiHeight == 560);
    REQUIRE_TRUE(config.uiFrameHz == 30);
}

TEST_CASE(audio_block_is_a_plain_view) {
    float left[4] = {0.0f, 0.1f, 0.2f, 0.3f};
    float right[4] = {0.0f, -0.1f, -0.2f, -0.3f};
    float* outputs[2] = {left, right};
    const synth::AudioBlock block{nullptr, outputs, 0, 2, 4};
    REQUIRE_TRUE(block.inputs == nullptr);
    REQUIRE_TRUE(block.numInputChannels == 0);
    REQUIRE_TRUE(block.numOutputChannels == 2);
    REQUIRE_TRUE(block.numFrames == 4);
    REQUIRE_NEAR(block.outputs[0][3], 0.3f, 1e-6f);
}

TEST_CASE(app_context_default_constructs_null) {
    const synth::AppContext context;
    REQUIRE_TRUE(context.parameterManager == nullptr);
    REQUIRE_TRUE(context.patchManager == nullptr);
    REQUIRE_TRUE(context.uiBus == nullptr);
    REQUIRE_TRUE(context.midiBus == nullptr);
    REQUIRE_TRUE(context.parameterMessageOutBus == nullptr);
    REQUIRE_TRUE(context.patchInputBus == nullptr);
    REQUIRE_TRUE(context.patchOutputBus == nullptr);
    REQUIRE_TRUE(context.midiSender == nullptr);
    REQUIRE_TRUE(context.midiProfileConfig == nullptr);
    REQUIRE_TRUE(context.defaultMidiProfileConfig == nullptr);
    REQUIRE_TRUE(context.config == nullptr);
    REQUIRE_TRUE(context.uiState == nullptr);
}

TEST_CASE(app_context_holds_live_pointers) {
    synth::ParameterManager manager;
    synth::MessageInBus uiBus(&manager);
    synth::AppContext context;
    context.parameterManager = &manager;
    context.uiBus = &uiBus;
    REQUIRE_TRUE(context.parameterManager == &manager);
    REQUIRE_TRUE(context.uiBus == &uiBus);
}
```

- [ ] **Step 2: Add the Makefile target and run the test to verify it fails**

In `projects/synth/Makefile`: add `CONTRACT_TEST_BIN := $(BUILD_DIR)/contract_tests` next to the other `*_TEST_BIN` variables; add a build rule mirroring `$(MODULE_TEST_BIN)`:

```make
$(CONTRACT_TEST_BIN): tests/contract_tests.cpp $(LIB) include/synth/AppContext.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(LIB) -o $@
```

Add `$(CONTRACT_TEST_BIN)` to the `test:` prerequisites and add a `	$(CONTRACT_TEST_BIN)` invocation line.

Run: `make -C projects/synth build/contract_tests` (or `make -C projects/synth test`)
Expected: FAIL — `synth/AppContext.hpp: No such file or directory`

- [ ] **Step 3: Write the header**

Create `projects/synth/include/synth/AppContext.hpp`:

```cpp
#pragma once

// Application/runtime contract types for the synth application runtime
// (sar-1, sar-2, sar-3). JUCE-free: consumed by applications, the engine,
// the JUCE runtime shell, and the headless test rig.

#include "synth/MidiController.hpp"
#include "synth/ParameterModulation.hpp"
#include "synth/PatchPersistence.hpp"

#include <atomic>
#include <cstddef>
#include <filesystem>
#include <string>

namespace synth {

// Static configuration supplied by the application (sar-2). Audio fields are
// a request: the host negotiates actual values with the device and reports
// them through the application's prepare hook.
struct RuntimeConfig {
    std::string appName;
    int numAudioInputs = 0;
    int numAudioOutputs = 2;
    double preferredSampleRate = 48000.0;
    int preferredBlockSize = 256;
    std::filesystem::path patchesRoot;  // patch directories live here
    std::filesystem::path logsRoot;     // session log files; empty = stdout only
    int uiWidth = 900;
    int uiHeight = 560;
    int uiFrameHz = 30;
};

// Non-owning view of one audio device block (sar-6). Channel counts are the
// device's actual counts, which may differ from the RuntimeConfig request.
struct AudioBlock {
    const float* const* inputs = nullptr;
    float* const* outputs = nullptr;
    int numInputChannels = 0;
    int numOutputChannels = 0;
    std::size_t numFrames = 0;
};

// Non-owning pointers to every framework object an application may touch
// (sar-3). The host owns all pointees; addresses are stable for the
// application's lifetime. Thread roles below are binding (sar-7); a member
// may only be used from its named thread.
struct AppContext {
    ParameterManager* parameterManager = nullptr;   // audio thread once running; message thread before start
    PatchManager* patchManager = nullptr;           // message thread only (commands + responses)
    MessageInBus* uiBus = nullptr;                  // producer: message thread; consumer: audio thread
    MessageInBus* midiBus = nullptr;                // producer: MIDI callback thread; consumer: audio thread
    ParameterMessageOutBus* parameterMessageOutBus = nullptr;  // producer: audio; consumer: message thread
    PatchMessageInBus* patchInputBus = nullptr;     // producer: message thread; consumer: audio thread
    MessageOutBus* patchOutputBus = nullptr;        // producer: audio; consumer: message thread
    MidiSender* midiSender = nullptr;               // enqueue from message thread; owned worker drains
    MidiControllerProfileConfig* midiProfileConfig = nullptr;              // message thread only
    const MidiControllerProfileConfig* defaultMidiProfileConfig = nullptr; // immutable after init
    const RuntimeConfig* config = nullptr;          // immutable after construction
    ParameterManager::UIState* uiState = nullptr;   // null during Init; set before MIDI/audio/UI start
};

}  // namespace synth
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `make -C projects/synth test`
Expected: all binaries PASS including 4 new `contract_tests` cases; zero compiler warnings.

- [ ] **Step 5: Commit**

```bash
git add projects/synth/include/synth/AppContext.hpp projects/synth/tests/contract_tests.cpp projects/synth/Makefile
git commit -m "feat(synth): add application contract headers (RuntimeConfig, AudioBlock, AppContext)"
```

---

### Task 2: CircularQueue port

**Files:**
- Create: `projects/synth/include/synth/CircularQueue.hpp`
- Create: `projects/synth/tests/logging_tests.cpp`
- Modify: `projects/synth/Makefile` (add `logging_tests` binary)

**Interfaces:**
- Consumes: port source `/Users/joyo/theallelectricsmartgrid/private/src/CircularQueue.hpp` (read it first; port ONLY `CircularQueue<T, N>` — leave `ByteBuffer`/`CircularByteQueue` behind).
- Produces: `template <typename T, std::size_t N> struct synth::CircularQueue` with `bool Push(const T&)`, `T* NextToPush()` (returns slot pointer or nullptr when full), `void CompletePush()`, `bool Pop(T&)`, `T* PeekPtr()`, `std::size_t Size() const`, `bool IsEmpty() const`. Lock-free SPSC via atomic head/tail. Task 4 builds `AsyncLogQueue` on `NextToPush`/`CompletePush`/`Pop`.

- [ ] **Step 1: Write the failing tests**

Create `projects/synth/tests/logging_tests.cpp` with the same framework block + JUCE guard + `main()` pattern as Task 1 (copy from `tests/module_tests.cpp`), including `synth/CircularQueue.hpp`, with test cases:

```cpp
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
    REQUIRE_TRUE(pushed >= 1);          // capacity semantics come from the port
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
```

(Adjust the exact full/empty boundary assertions in `circular_queue_reports_full_without_blocking` to the ported implementation's documented capacity — e.g. if the ring reserves one slot, `pushed` will be `N-1`. Keep the assertions meaningful, not tautological.)

- [ ] **Step 2: Add the Makefile target and verify failure**

Mirror Task 1's Makefile pattern: `LOGGING_TEST_BIN := $(BUILD_DIR)/logging_tests`, build rule depending on `tests/logging_tests.cpp $(LIB) include/synth/CircularQueue.hpp`, added to `test:`.

Run: `make -C projects/synth test`
Expected: FAIL — missing `synth/CircularQueue.hpp`.

- [ ] **Step 3: Port the implementation**

Read `/Users/joyo/theallelectricsmartgrid/private/src/CircularQueue.hpp` and port the `CircularQueue<T, N>` template into `projects/synth/include/synth/CircularQueue.hpp`, `#pragma once`, namespace `synth`, keeping the atomic head/tail SPSC semantics and the `Push`/`NextToPush`/`CompletePush`/`Pop`/`PeekPtr`/`Size`/`IsEmpty` surface exactly. Adapt member naming to synth style (trailing underscore). Add a doc comment: single producer, single consumer per instance; producers never block. Do not port `ByteBuffer`/`CircularByteQueue`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `make -C projects/synth test`
Expected: all PASS, including the threaded SPSC test; zero warnings.

- [ ] **Step 5: Commit**

```bash
git add projects/synth/include/synth/CircularQueue.hpp projects/synth/tests/logging_tests.cpp projects/synth/Makefile
git commit -m "feat(synth): port lock-free SPSC CircularQueue from smart grid"
```

---

### Task 3: ThreadId system

**Files:**
- Create: `projects/synth/include/synth/ThreadId.hpp`
- Modify: `projects/synth/tests/logging_tests.cpp` (append cases)
- Modify: `projects/synth/Makefile` (add header to `logging_tests` deps)

**Interfaces:**
- Consumes: port source `/Users/joyo/theallelectricsmartgrid/private/src/ThreadId.hpp` (pattern only — the enum values are synth-specific).
- Produces (exact, Task 4 and Plans 2–3 depend on these):

```cpp
namespace synth {
enum class ThreadId : int { Message = 0, Audio, MidiInput, MidiSender, Unknown, Count };
inline constexpr std::size_t kThreadIdCount = static_cast<std::size_t>(ThreadId::Count);
ThreadId GetCurrentThreadId();               // thread_local, defaults Unknown
void SetCurrentThreadId(ThreadId id);
std::size_t ThreadIdToIndex(ThreadId id);    // 0..kThreadIdCount-1; Unknown for out-of-range
const char* ThreadIdToString(ThreadId id);   // "Message", "Audio", "MidiInput", "MidiSender", "Unknown"
struct ScopedThreadId {                      // RAII: sets on construction, restores prior on destruction
    explicit ScopedThreadId(ThreadId id);
    ~ScopedThreadId();
    // non-copyable, non-movable
};
}
```

- [ ] **Step 1: Write the failing tests** (append to `logging_tests.cpp`)

```cpp
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
```

- [ ] **Step 2: Run to verify failure** — `make -C projects/synth test` → FAIL (missing header).

- [ ] **Step 3: Implement** `include/synth/ThreadId.hpp` per the Produces block above (header-only, `inline`/`thread_local`), following the ScopedThreadId save/restore semantics of the port source.

- [ ] **Step 4: Run the tests and make sure they pass** — `make -C projects/synth test` → PASS, zero warnings. Add `include/synth/ThreadId.hpp` to the `logging_tests` Makefile rule dependencies.

- [ ] **Step 5: Commit**

```bash
git add projects/synth/include/synth/ThreadId.hpp projects/synth/tests/logging_tests.cpp projects/synth/Makefile
git commit -m "feat(synth): add ThreadId thread-identity system with scoped guard"
```

---

### Task 4: AsyncLogger port

**Files:**
- Create: `projects/synth/include/synth/AsyncLogger.hpp`
- Modify: `projects/synth/tests/logging_tests.cpp` (append cases)
- Modify: `projects/synth/Makefile` (add header to `logging_tests` deps)

**Interfaces:**
- Consumes: port source `/Users/joyo/theallelectricsmartgrid/private/src/AsyncLogger.hpp` (read it fully first); `synth::CircularQueue` (Task 2); `synth::ThreadId` (Task 3).
- Produces (exact; the engine/runtime in Plans 2–3 call `ConfigureLogDirectory`, `SetSampleCounterSource`, `DoLog`, and `INFO`):

```cpp
namespace synth {
struct LogMessage {
    static constexpr std::size_t kMaxMessageLength = 256;
    // fixed char buffer, length, sample stamp, ThreadId — POD, no heap
    void Clear();
    void Fill(ThreadId threadId, std::uint64_t sample, const char* message);            // plain
    template <typename... Args> void Fill(ThreadId threadId, std::uint64_t sample,
                                          const char* format, Args... args);            // snprintf, truncating
};
struct AsyncLogQueue {
    static constexpr std::size_t kQueueSize = 16384;
    template <typename... Args> void Log(const char* format, Args... args);  // producer path: lock/alloc/IO-free
    void DoLog();                                              // drain: round-robin queues -> stdout + session file
    void ConfigureLogDirectory(const char* logDirectory);
    void SetSampleCounterSource(const std::atomic<std::uint64_t>* source); // nullptr -> stamp 0
    // test hooks:
    void ResetForTesting();
    std::size_t QueueSizeForTesting(ThreadId id) const;
    std::size_t MissedCountForTesting(ThreadId id) const;
    void SetLogDirectoryForTesting(const char* logDirectory);
    const std::string& LogFilePathForTesting() const;
    static AsyncLogQueue s_instance;  // inline static; INFO() routes here
};
}
#define INFO(...) ::synth::AsyncLogQueue::s_instance.Log(__VA_ARGS__)
```

Port semantics to preserve exactly: one `CircularQueue<LogMessage, kQueueSize>` per `ThreadId` (array sized `kThreadIdCount`); `Log` formats on the calling thread into a `NextToPush()` slot and `CompletePush()`es (drop + `missed_[index].fetch_add(1)` when full); `DoLog` round-robins non-empty queues until `kThreadIdCount` consecutive empties, then writes one "Missed N messages on <thread>" line per nonzero missed counter (atomically exchanged to 0); every drained line goes to stdout AND (when a directory is configured) to one lazily created session file named from the wall-clock timestamp, append + flush per line, no in-session rotation; line format `HH:MM:SS <sample> <thread-name> <message>` via `localtime_r`. Sample stamp: read `SetSampleCounterSource` pointer (relaxed atomic load) at `Fill` time, 0 when unset. Document on `Log`: concurrent producers must hold distinct `ThreadId`s; `Unknown` is for single-threaded contexts only (slog-3).

- [ ] **Step 1: Write the failing tests** (append to `logging_tests.cpp`; each case starts with `synth::AsyncLogQueue::s_instance.ResetForTesting();`)

```cpp
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
```

- [ ] **Step 2: Run to verify failure** — `make -C projects/synth test` → FAIL (missing header).

- [ ] **Step 3: Port the implementation** into `include/synth/AsyncLogger.hpp` per the Produces block and the port-semantics list above. `ResetForTesting` must clear all queues, missed counters, the configured directory/file path, and close any open file, and reset the sample-counter source.

- [ ] **Step 4: Run the tests and make sure they pass** — `make -C projects/synth test` → PASS, zero warnings. Note: drained lines print to stdout by design; the missed-count burst test drains 16384+ lines — if test-output noise is a concern, cap what the burst case enqueues before draining by calling `ResetForTesting()` after asserting the missed count rather than draining everything, but keep at least one `DoLog()`-based missed-report assertion.

- [ ] **Step 5: Commit**

```bash
git add projects/synth/include/synth/AsyncLogger.hpp projects/synth/tests/logging_tests.cpp projects/synth/Makefile
git commit -m "feat(synth): port thread-aware async logger with INFO interface"
```

---

### Task 5: ComputeAllTargets

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp` (declaration next to `ComputeAllParameters()` at line 603)
- Modify: `projects/synth/src/ParameterModulation.cpp` (definition next to `ComputeAllParameters()` at line 2098)
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp` (append test)

**Interfaces:**
- Consumes: existing `Parameter::Compute(const SceneState&)`, `Parameter::SnapCurrentToTarget()`, `Parameter::ProcessLite()`, `Parameter::Get(voiceIx)`.
- Produces: `void ParameterManager::ComputeAllTargets();` — identical to `ComputeAllParameters()` (`src/ParameterModulation.cpp:2098-2106`) minus the `parameter->SnapCurrentToTarget();` line. Plans 2–3's engine pump calls this every block (sar-6).

- [ ] **Step 1: Write the failing test** (append to `tests/parameter_modulation_tests.cpp`, following that file's existing construction patterns for manager/group/parameter — reuse its helpers where they exist)

```cpp
TEST_CASE(compute_all_targets_preserves_process_lite_slew) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1,
                                       .numModulators = 0,
                                       .numScenes = 1,
                                       .maxParameters = 4,
                                       .processLiteAlpha = 0.1f});
    auto& parameter = manager.CreateParameter(group, {.name = "SlewProbe", .defaultValue = 0.0f});
    parameter.Compute(manager.Scene());
    parameter.SnapCurrentToTarget();
    REQUIRE_NEAR(parameter.Get(0), 0.0f, 1e-6f);

    parameter.SceneCenter(0) = 1.0f;

    manager.ComputeAllTargets();
    const float afterTargets = parameter.Get(0);
    REQUIRE_NEAR(afterTargets, 0.0f, 1e-6f);  // current not snapped

    parameter.ProcessLite();
    const float afterOneSlew = parameter.Get(0);
    REQUIRE_TRUE(afterOneSlew > 0.0f);
    REQUIRE_TRUE(afterOneSlew < 1.0f);        // approaching, not jumped

    manager.ComputeAllParameters();           // existing API still snaps
    REQUIRE_NEAR(parameter.Get(0), 1.0f, 1e-4f);
}
```

(If the group-config or parameter-config field names in this snippet don't match the file's existing usage exactly, match the file — `tests/parameter_modulation_tests.cpp` and `miniapp/Main.cpp` show the real designated-initializer shapes. The behavioral assertions are the requirement.)

- [ ] **Step 2: Run to verify failure** — `make -C projects/synth test` → FAIL: `no member named 'ComputeAllTargets'`.

- [ ] **Step 3: Implement**

Header (`ParameterModulation.hpp`, after line 603's `void ComputeAllParameters();`):

```cpp
    // Control-rate target computation for the steady-state audio pump:
    // Compute() every parameter without snapping current values, so
    // ProcessLite() slewing stays audible (sar-6). Use ComputeAllParameters()
    // only for non-steady-state moments (init, patch load, revert).
    void ComputeAllTargets();
```

Source (`ParameterModulation.cpp`, after `ComputeAllParameters()`):

```cpp
void ParameterManager::ComputeAllTargets() {
    for (Parameter* parameter : parameters_) {
        if (parameter == nullptr) {
            continue;
        }
        parameter->Compute(scene_);
    }
}
```

- [ ] **Step 4: Run the tests and make sure they pass** — `make -C projects/synth test` → PASS, zero warnings.

- [ ] **Step 5: Commit**

```bash
git add projects/synth/include/synth/ParameterModulation.hpp projects/synth/src/ParameterModulation.cpp projects/synth/tests/parameter_modulation_tests.cpp
git commit -m "feat(synth): add ComputeAllTargets preserving ProcessLite slew"
```
