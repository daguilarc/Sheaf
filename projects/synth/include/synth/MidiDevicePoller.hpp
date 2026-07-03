#pragma once

#include "synth/MidiReconcile.hpp"

#include <chrono>
#include <condition_variable>
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
// exactly once per detected change. `PollNowForTests` pokes the CV and
// blocks the calling thread until that poll cycle has completed, so tests
// are deterministic instead of racing the worker's timer.
class MidiDevicePoller {
public:
    using Enumerate = std::function<MidiDeviceList()>;

    explicit MidiDevicePoller(std::chrono::milliseconds interval = std::chrono::seconds(5));
    ~MidiDevicePoller();  // calls Stop()

    MidiDevicePoller(const MidiDevicePoller&) = delete;
    MidiDevicePoller& operator=(const MidiDevicePoller&) = delete;

    void Start(Enumerate enumerate);
    void Stop();  // signals + joins; idempotent

    // Message thread: true once per detected change, copying the latest
    // list into `latest`. False (and `latest` left untouched) when no
    // change is pending.
    bool ConsumeChange(MidiDeviceList& latest);

    // Forces one immediate poll cycle and blocks until it has completed.
    void PollNowForTests();

private:
    void Run();
    bool SnapshotChanged(const MidiDeviceList& next) const;

    std::chrono::milliseconds interval_;
    Enumerate enumerate_;
    std::thread thread_;

    mutable std::mutex mutex_;
    std::condition_variable cv_;
    bool running_ = false;
    bool stopRequested_ = false;

    // Poke-and-wait support for PollNowForTests: forceRequested_ asks the
    // worker to run a poll cycle immediately; forceGeneration_ increments
    // once that cycle has completed so the caller can wait on it precisely
    // (avoids racing multiple forced polls against each other).
    bool forceRequested_ = false;
    std::uint64_t forceGeneration_ = 0;
    std::condition_variable forceDoneCv_;

    bool hasSnapshot_ = false;
    MidiDeviceList snapshot_;

    bool dirty_ = false;
    MidiDeviceList latest_;
};

} // namespace synth
