#pragma once

#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <string>
#include <type_traits>

#include "synth/CircularQueue.hpp"
#include "synth/ThreadId.hpp"

namespace synth {

// Printf-format-argument safety constraint: only scalar types (arithmetic,
// enum, pointer, nullptr_t) may be forwarded to snprintf's variadic
// parameters. Passing a non-trivial class type (e.g. std::string) by value
// through "..." is undefined behavior, and by-value class arguments can
// copy/allocate on the producer path, which must stay allocation-free. Pass
// std::string via .c_str() instead.
template <typename T>
inline constexpr bool kIsPrintfSafe = std::is_arithmetic_v<std::decay_t<T>> ||
    std::is_enum_v<std::decay_t<T>> ||
    std::is_pointer_v<std::decay_t<T>> ||
    std::is_null_pointer_v<std::decay_t<T>>;

struct LogMessage {
    static constexpr std::size_t kMaxMessageLength = 256;

    char message_[kMaxMessageLength];
    std::size_t length_;
    std::uint64_t sample_;
    ThreadId threadId_;

    LogMessage()
        : message_{}
        , length_(0)
        , sample_(0)
        , threadId_(ThreadId::Unknown) {
    }

    void Clear() {
        length_ = 0;
        message_[0] = '\0';
    }

    void Fill(ThreadId threadId, std::uint64_t sample, const char* message) {
        Clear();
        int written = snprintf(message_, kMaxMessageLength, "%s", message);
        FinishFill(threadId, sample, written);
    }

    template <typename... Args>
    void Fill(ThreadId threadId, std::uint64_t sample, const char* format, Args... args) {
        static_assert(
            (kIsPrintfSafe<Args> && ...),
            "INFO/Log arguments must be printf-compatible scalar types (arithmetic, enum, pointer); pass std::string via .c_str()");
        Clear();
        int written = snprintf(message_, kMaxMessageLength, format, args...);
        FinishFill(threadId, sample, written);
    }

private:
    void FinishFill(ThreadId threadId, std::uint64_t sample, int written) {
        length_ = written < 0 ? 0 : static_cast<std::size_t>(written);
        if (length_ >= kMaxMessageLength) {
            length_ = kMaxMessageLength - 1;
            message_[kMaxMessageLength - 1] = '\0';
        }

        sample_ = sample;
        threadId_ = threadId;
    }
};

struct AsyncLogQueue {
    static constexpr std::size_t kQueueSize = 16384;

    std::array<CircularQueue<LogMessage, kQueueSize>, kThreadIdCount> queues_;
    std::array<std::atomic<std::size_t>, kThreadIdCount> missed_;
    std::size_t nextDrainIndex_;
    std::string logDirectory_;
    std::string logFilePath_;
    std::ofstream logFile_;
    const std::atomic<std::uint64_t>* sampleCounterSource_;

    AsyncLogQueue()
        : queues_()
        , missed_()
        , nextDrainIndex_(0)
        , logDirectory_()
        , logFilePath_()
        , logFile_()
        , sampleCounterSource_(nullptr) {
        for (std::size_t i = 0; i < kThreadIdCount; ++i) {
            missed_[i].store(0);
        }
    }

    // Producer path: no heap allocation, no locking, no IO. Concurrent
    // producers must hold distinct ThreadIds (see synth::ScopedThreadId);
    // ThreadId::Unknown is for single-threaded contexts only, since callers
    // sharing that identity from multiple threads would race on the same
    // CircularQueue.
    template <typename... Args>
    void Log(const char* format, Args... args) {
        static_assert(
            (kIsPrintfSafe<Args> && ...),
            "INFO/Log arguments must be printf-compatible scalar types (arithmetic, enum, pointer); pass std::string via .c_str()");
        ThreadId threadId = GetCurrentThreadId();
        std::size_t queueIndex = ThreadIdToIndex(threadId);
        LogMessage* message = queues_[queueIndex].NextToPush();
        if (message == nullptr) {
            missed_[queueIndex].fetch_add(1);
            return;
        }

        message->Fill(threadId, ReadSample(), format, args...);
        queues_[queueIndex].CompletePush();
    }

    void DoLog() {
        std::size_t emptyQueueCount = 0;
        bool didSomething = false;

        while (emptyQueueCount < kThreadIdCount) {
            std::size_t queueIndex = nextDrainIndex_;
            nextDrainIndex_ = (nextDrainIndex_ + 1) % kThreadIdCount;
            LogMessage* message = queues_[queueIndex].PeekPtr();
            if (message == nullptr) {
                ++emptyQueueCount;
                continue;
            }

            WriteLogMessage(static_cast<ThreadId>(queueIndex), message);
            didSomething = true;

            LogMessage discarded;
            queues_[queueIndex].Pop(discarded);
            emptyQueueCount = 0;
        }

        for (std::size_t i = 0; i < kThreadIdCount; ++i) {
            std::size_t missed = missed_[i].exchange(0);
            if (missed > 0) {
                WriteMissedMessage(static_cast<ThreadId>(i), missed);
                didSomething = true;
            }
        }

        if (didSomething) {
            fflush(stdout);
        }
    }

    void ConfigureLogDirectory(const char* logDirectory) {
        if (logFile_.is_open()) {
            logFile_.close();
        }

        logDirectory_ = logDirectory == nullptr ? "" : logDirectory;
        logFilePath_.clear();

        if (logDirectory_.empty()) {
            return;
        }

        std::error_code ec;
        std::filesystem::create_directories(logDirectory_, ec);
    }

    void SetSampleCounterSource(const std::atomic<std::uint64_t>* source) {
        sampleCounterSource_ = source;
    }

    void ResetForTesting() {
        LogMessage message;

        for (std::size_t i = 0; i < kThreadIdCount; ++i) {
            while (queues_[i].Pop(message)) {
            }

            missed_[i].store(0);
        }

        if (logFile_.is_open()) {
            logFile_.close();
        }

        logDirectory_.clear();
        logFilePath_.clear();

        nextDrainIndex_ = 0;
        sampleCounterSource_ = nullptr;
        SetCurrentThreadId(ThreadId::Unknown);
    }

    std::size_t QueueSizeForTesting(ThreadId threadId) const {
        return queues_[ThreadIdToIndex(threadId)].Size();
    }

    std::size_t MissedCountForTesting(ThreadId threadId) const {
        return missed_[ThreadIdToIndex(threadId)].load();
    }

    void SetLogDirectoryForTesting(const char* logDirectory) {
        ConfigureLogDirectory(logDirectory);
    }

    const std::string& LogFilePathForTesting() const {
        return logFilePath_;
    }

    // Runtime-only: s_instance is dynamically initialized (it owns
    // std::string/std::ofstream members), so its initialization order
    // relative to other translation units' static/global objects is
    // unspecified. Do not call INFO (or otherwise touch s_instance) from
    // static/global constructors, since s_instance may not be constructed
    // yet at that point.
    static AsyncLogQueue s_instance;

private:
    std::uint64_t ReadSample() const {
        if (sampleCounterSource_ == nullptr) {
            return 0;
        }
        return sampleCounterSource_->load(std::memory_order_relaxed);
    }

    void WriteLogMessage(ThreadId threadId, LogMessage* message) {
        std::tm localTm = LocalNow();

        char line[LogMessage::kMaxMessageLength + 96];
        snprintf(
            line,
            sizeof(line),
            "%02d:%02d:%02d %llu %s %s",
            localTm.tm_hour,
            localTm.tm_min,
            localTm.tm_sec,
            static_cast<unsigned long long>(message->sample_),
            ThreadIdToString(threadId),
            message->message_);
        WriteLine(line);
    }

    void WriteMissedMessage(ThreadId threadId, std::size_t missed) {
        char line[LogMessage::kMaxMessageLength];
        snprintf(
            line,
            sizeof(line),
            "Missed %zu messages on %s",
            missed,
            ThreadIdToString(threadId));
        WriteLine(line);
    }

    static std::tm LocalNow() {
        auto now = std::chrono::system_clock::now();
        std::time_t t = std::chrono::system_clock::to_time_t(now);
        std::tm localTm{};
#if defined(_WIN32)
        localtime_s(&localTm, &t);
#else
        localtime_r(&t, &localTm);
#endif
        return localTm;
    }

    void OpenSessionLogFile() {
        if (logDirectory_.empty()) {
            return;
        }

        auto now = std::chrono::system_clock::now();
        std::tm localTm = LocalNow();

        auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(
                          now.time_since_epoch())
                          .count() %
            1000;

        char filename[64];
        snprintf(
            filename,
            sizeof(filename),
            "%04d-%02d-%02dT%02d-%02d-%02d-%03lld.log",
            localTm.tm_year + 1900,
            localTm.tm_mon + 1,
            localTm.tm_mday,
            localTm.tm_hour,
            localTm.tm_min,
            localTm.tm_sec,
            static_cast<long long>(millis));

        std::filesystem::path logPath = std::filesystem::path(logDirectory_) / filename;
        logFilePath_ = logPath.string();
        logFile_.open(logFilePath_, std::ios::out | std::ios::app);
    }

    void WriteLine(const char* line) {
        fputs(line, stdout);
        fputc('\n', stdout);

        if (!logFile_.is_open()) {
            OpenSessionLogFile();
        }

        if (!logFile_.is_open()) {
            return;
        }

        logFile_ << line << '\n';
        logFile_.flush();
    }
};

inline AsyncLogQueue AsyncLogQueue::s_instance;

} // namespace synth

// Runtime-only: routes to synth::AsyncLogQueue::s_instance, which is
// dynamically initialized and has unspecified initialization order relative
// to static/global objects in other translation units. Do not call INFO
// from static/global constructors (or any other code that may run before
// s_instance is constructed).
#define INFO(...) ::synth::AsyncLogQueue::s_instance.Log(__VA_ARGS__)
