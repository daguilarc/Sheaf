#pragma once

#include "synth/MidiReconcile.hpp"

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <mutex>
#include <thread>

namespace synth {

// Background USB MIDI device-list watcher. JUCE-free: device enumeration is
// injected via `Enumerate` so this class has no platform dependency and no
// knowledge of the engine/runtime. It never opens/closes devices and never
// touches anything but its own snapshot + dirty flag.
//
// Threading contract: the worker thread wakes every `interval` (a
// condition-variable wait against a stop-or-poke predicate -- never a bare
// sleep, so Stop() joins promptly instead of waiting out the interval). Each
// wake calls the injected `enumerate` (which therefore runs ON the poll
// thread, under ScopedThreadId(ThreadId::IoPoll)) and compares the result to
// the previous snapshot via exact identifier+name vector equality across
// both inputs and outputs. The very first poll after Start() only primes the
// snapshot -- priming is not a change, so it never sets the dirty flag
// (startup's synchronous reconcile is responsible for the initial state).
// On a real difference, the latest list and a dirty flag are published under
// a mutex. `ConsumeChange` (called from the message thread) copies the
// latest list out under the mutex and clears the flag, returning true
// exactly once per detected change. `PollNowForTests` requests a poll cycle
// and blocks the calling thread until a cycle that started AFTER the request
// has completed, so tests are deterministic instead of racing the worker's
// timer.
//
// Enumerate callback contract: the injected `enumerate` function must be
// bounded/non-blocking (no indefinite waits) -- Stop() may block for at most
// one in-flight `enumerate()` call before it can signal the worker to exit
// and join it. There is no timeout machinery around the callback, so a
// callback that never returns will make Stop() (and the destructor, which
// calls Stop()) block indefinitely. If `enumerate` throws, the exception is
// caught on the worker thread, logged via INFO under ThreadId::IoPoll, and
// treated as a no-change cycle (the previous snapshot, if any, is kept);
// polling continues on the next wake.
//
// Concurrency contract: the public API (Start/Stop/ConsumeChange/
// PollNowForTests) is intended to be called from a single external thread
// (the message thread). Only the background worker thread runs concurrently
// with that caller -- there is no locking to protect against multiple
// external threads calling these methods concurrently with each other.
class MidiDevicePoller {
public:
    using Enumerate = std::function<MidiDeviceList()>;

    explicit MidiDevicePoller(std::chrono::milliseconds interval = std::chrono::seconds(5));
    ~MidiDevicePoller();  // calls Stop()

    MidiDevicePoller(const MidiDevicePoller&) = delete;
    MidiDevicePoller& operator=(const MidiDevicePoller&) = delete;

    // `enumerate` must be bounded/non-blocking -- see class comment.
    void Start(Enumerate enumerate);
    void Stop();  // signals + joins; idempotent. Blocks for at most one in-flight enumerate() call.

    // Message thread: true once per detected change, copying the latest
    // list into `latest`. False (and `latest` left untouched) when no
    // change is pending.
    bool ConsumeChange(MidiDeviceList& latest);

    // Forces one immediate poll cycle and blocks until a cycle that started
    // after this call was made has completed. Two concurrent or sequential
    // callers are each guaranteed their own such cycle -- see
    // forceRequested_/forceCompleted_ below.
    void PollNowForTests();

private:
    void Run();
    void RunOnePollCycle(const Enumerate& enumerate, std::unique_lock<std::mutex>& lock, std::uint64_t requestToComplete);
    bool SnapshotChanged(const MidiDeviceList& next) const;

    std::chrono::milliseconds interval_;
    Enumerate enumerate_;
    std::thread thread_;

    mutable std::mutex mutex_;
    std::condition_variable cv_;
    bool running_ = false;
    bool stopRequested_ = false;

    // Request/completion sequence numbers for PollNowForTests. Each call
    // takes `target = ++forceRequested_` under the mutex, pokes the worker,
    // and waits until `forceCompleted_ >= target`. The worker captures
    // `forceRequested_` into `requestToComplete` BEFORE calling enumerate(),
    // then after the cycle completes, sets `forceCompleted_ = requestToComplete`
    // (completing all requests that arrived before the cycle started). Requests
    // that arrive during an in-flight enumerate() are not part of that cycle's
    // completion; instead, the worker loops immediately and those requests are
    // satisfied by the next poll cycle. This means every PollNowForTests caller
    // is guaranteed a poll cycle whose enumerate() call started strictly after
    // their request was recorded.
    std::uint64_t forceRequested_ = 0;
    std::uint64_t forceCompleted_ = 0;
    std::condition_variable forceDoneCv_;

    bool hasSnapshot_ = false;
    MidiDeviceList snapshot_;

    bool dirty_ = false;
    MidiDeviceList latest_;
};

} // namespace synth
