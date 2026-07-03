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
    forceRequested_ = false;
    forceGeneration_ = 0;
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
    forceRequested_ = false;
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
    const std::uint64_t targetGeneration = forceGeneration_ + 1;
    forceRequested_ = true;
    lock.unlock();
    cv_.notify_all();
    lock.lock();
    // Also wake if Stop() races in concurrently and the worker exits before
    // running the forced cycle -- otherwise this would wait forever.
    forceDoneCv_.wait(lock, [this, targetGeneration] {
        return forceGeneration_ >= targetGeneration || !running_ || stopRequested_;
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
        cv_.wait_for(lock, interval_, [this] { return stopRequested_ || forceRequested_; });
        if (stopRequested_) {
            break;
        }

        // Either the interval elapsed (spurious wake included -- wait_for's
        // predicate handles that) or a forced poll was requested; either way
        // we run exactly one poll cycle now. Clear forceRequested_ before
        // calling out so a concurrent PollNowForTests during Enumerate()
        // still schedules another cycle rather than getting folded into this
        // one.
        const bool wasForced = forceRequested_;
        forceRequested_ = false;
        Enumerate enumerate = enumerate_;
        lock.unlock();

        MidiDeviceList next = enumerate ? enumerate() : MidiDeviceList{};

        lock.lock();
        if (SnapshotChanged(next)) {
            latest_ = next;
            dirty_ = true;
        }
        snapshot_ = std::move(next);
        hasSnapshot_ = true;

        if (wasForced) {
            ++forceGeneration_;
            forceDoneCv_.notify_all();
        }
    }

    // Wake any PollNowForTests callers blocked waiting for a cycle that will
    // now never complete, so Stop() (which requested the join) can't be
    // shadowed by a still-blocked caller on another thread.
    forceDoneCv_.notify_all();
}

} // namespace synth
