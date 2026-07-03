#include "synth/MidiDevicePoller.hpp"
#include "synth/AsyncLogger.hpp"
#include "synth/ThreadId.hpp"

namespace synth {

MidiDevicePoller::MidiDevicePoller(std::chrono::milliseconds interval) : interval_(interval) {}

MidiDevicePoller::~MidiDevicePoller() {
    Stop();
}

void MidiDevicePoller::Start(Enumerate enumerate) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (running_) {
        return;
    }
    enumerate_ = std::move(enumerate);
    stopRequested_ = false;
    forceRequested_ = 0;
    forceCompleted_ = 0;
    hasSnapshot_ = false;
    dirty_ = false;
    running_ = true;
    thread_ = std::thread([this] { Run(); });
}

void MidiDevicePoller::Stop() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!running_ && !thread_.joinable()) {
            return;
        }
        stopRequested_ = true;
    }
    cv_.notify_all();
    if (thread_.joinable()) {
        thread_.join();
    }
    std::lock_guard<std::mutex> lock(mutex_);
    running_ = false;
    stopRequested_ = false;
    forceCompleted_ = forceRequested_;
    forceDoneCv_.notify_all();
}

bool MidiDevicePoller::ConsumeChange(MidiDeviceList& latest) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!dirty_) {
        return false;
    }
    latest = latest_;
    dirty_ = false;
    return true;
}

void MidiDevicePoller::PollNowForTests() {
    std::unique_lock<std::mutex> lock(mutex_);
    if (!running_) {
        return;
    }
    // Record our request BEFORE waking the worker, so a cycle that starts
    // after this point is guaranteed to complete it (see forceRequested_/
    // forceCompleted_ doc comment in the header).
    const std::uint64_t target = ++forceRequested_;
    lock.unlock();
    cv_.notify_all();
    lock.lock();
    // Also wake if Stop() races in concurrently and the worker exits before
    // running the forced cycle -- otherwise this would wait forever.
    forceDoneCv_.wait(lock, [this, target] {
        return forceCompleted_ >= target || !running_;
    });
}

namespace {

// MidiDeviceInfoRef (declared in MidiReconcile.hpp, from an earlier landed
// plan) has no operator==, so snapshot comparison is done field-by-field
// here rather than adding an operator to that shared header.
bool DeviceRefsEqual(const std::vector<MidiDeviceInfoRef>& a, const std::vector<MidiDeviceInfoRef>& b) {
    if (a.size() != b.size()) {
        return false;
    }
    for (std::size_t i = 0; i < a.size(); ++i) {
        if (a[i].identifier != b[i].identifier || a[i].name != b[i].name) {
            return false;
        }
    }
    return true;
}

} // namespace

bool MidiDevicePoller::SnapshotChanged(const MidiDeviceList& next) const {
    if (!hasSnapshot_) {
        return false;
    }
    return !(DeviceRefsEqual(snapshot_.inputs, next.inputs) && DeviceRefsEqual(snapshot_.outputs, next.outputs));
}

void MidiDevicePoller::Run() {
    ScopedThreadId scopedThreadId(ThreadId::IoPoll);

    for (;;) {
        std::unique_lock<std::mutex> lock(mutex_);
        cv_.wait_for(lock, interval_, [this] { return stopRequested_ || forceRequested_ > forceCompleted_; });
        if (stopRequested_) {
            break;
        }

        // Either the interval elapsed (spurious wake included -- wait_for's
        // predicate handles that) or a forced poll was requested; either way
        // we run exactly one poll cycle now. Capture the current forceRequested_
        // value BEFORE calling out to enumerate() so that once enumerate()
        // returns and we re-lock the mutex, we can complete all requests that
        // were pending before the cycle started. Requests arriving DURING the
        // in-flight enumerate() are not completed by this cycle; instead, the
        // worker loops again immediately and those requests get completed by
        // the next poll cycle.
        const std::uint64_t requestToComplete = forceRequested_;
        Enumerate enumerate = enumerate_;
        lock.unlock();

        RunOnePollCycle(enumerate, lock, requestToComplete);
    }

    // Wake any PollNowForTests callers blocked waiting for a cycle that will
    // now never complete, so Stop() (which requested the join) can't be
    // shadowed by a still-blocked caller on another thread.
    std::lock_guard<std::mutex> lock(mutex_);
    forceDoneCv_.notify_all();
}

void MidiDevicePoller::RunOnePollCycle(
    const Enumerate& enumerate, std::unique_lock<std::mutex>& lock, std::uint64_t requestToComplete) {
    // Precondition: lock is NOT held on entry (released by the caller before
    // invoking enumerate()); postcondition: lock is held on return.
    bool threw = false;
    MidiDeviceList next;
    try {
        next = enumerate ? enumerate() : MidiDeviceList{};
    } catch (const std::exception& ex) {
        threw = true;
        INFO("MidiDevicePoller: enumerate() threw: %s", ex.what());
    } catch (...) {
        threw = true;
        INFO("MidiDevicePoller: enumerate() threw a non-std::exception");
    }

    lock.lock();
    if (!threw) {
        if (SnapshotChanged(next)) {
            latest_ = next;
            dirty_ = true;
        }
        snapshot_ = std::move(next);
        hasSnapshot_ = true;
    }
    // On exception, treat the cycle as no-change: keep whatever snapshot
    // (possibly none, if this was the priming cycle) was already recorded.

    // Always complete pending forced-poll requests, even when enumerate()
    // threw, so PollNowForTests callers are never left hanging.
    if (requestToComplete > forceCompleted_) {
        forceCompleted_ = requestToComplete;
        forceDoneCv_.notify_all();
    }
}

} // namespace synth
