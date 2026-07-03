#pragma once

#include <cstddef>

namespace synth {

enum class ThreadId : int { Message = 0, Audio, MidiInput, MidiSender, IoPoll, Unknown, Count };

inline constexpr std::size_t kThreadIdCount = static_cast<std::size_t>(ThreadId::Count);

inline thread_local ThreadId g_currentThreadId = ThreadId::Unknown;

inline ThreadId GetCurrentThreadId() {
    return g_currentThreadId;
}

inline void SetCurrentThreadId(ThreadId id) {
    g_currentThreadId = id;
}

inline std::size_t ThreadIdToIndex(ThreadId id) {
    std::size_t index = static_cast<std::size_t>(id);
    if (index >= kThreadIdCount) {
        return static_cast<std::size_t>(ThreadId::Unknown);
    }
    return index;
}

inline const char* ThreadIdToString(ThreadId id) {
    switch (id) {
        case ThreadId::Message: return "Message";
        case ThreadId::Audio: return "Audio";
        case ThreadId::MidiInput: return "MidiInput";
        case ThreadId::MidiSender: return "MidiSender";
        case ThreadId::IoPoll: return "IoPoll";
        case ThreadId::Unknown: return "Unknown";
        case ThreadId::Count: return "Count";
    }
    return "Unknown";
}

struct ScopedThreadId {
    explicit ScopedThreadId(ThreadId id) : prior_(GetCurrentThreadId()) {
        SetCurrentThreadId(id);
    }

    ~ScopedThreadId() {
        SetCurrentThreadId(prior_);
    }

    ScopedThreadId(const ScopedThreadId&) = delete;
    ScopedThreadId(ScopedThreadId&&) = delete;
    ScopedThreadId& operator=(const ScopedThreadId&) = delete;
    ScopedThreadId& operator=(ScopedThreadId&&) = delete;

private:
    ThreadId prior_;
};

} // namespace synth
