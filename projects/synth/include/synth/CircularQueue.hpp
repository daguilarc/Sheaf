#pragma once

#include <atomic>
#include <cstddef>

namespace synth {

// Lock-free single-producer, single-consumer ring buffer of fixed capacity N.
//
// Exactly one thread may call Push/NextToPush/CompletePush, and exactly one
// (possibly different) thread may call Pop/PeekPtr, concurrently and without
// external locking. Producers never block: when the queue is full, Push
// returns false and NextToPush returns nullptr instead of waiting.
template <typename T, std::size_t N>
struct CircularQueue {
    bool Push(const T& value) {
        if (head_.load() - tail_.load() == N) {
            return false;
        }

        data_[head_.load() % N] = value;
        head_.fetch_add(1);
        return true;
    }

    T* NextToPush() {
        if (head_.load() - tail_.load() == N) {
            return nullptr;
        }

        return &data_[head_.load() % N];
    }

    void CompletePush() {
        head_.fetch_add(1);
    }

    bool Pop(T& value) {
        if (head_.load() == tail_.load()) {
            return false;
        }

        value = data_[tail_.load() % N];
        tail_.fetch_add(1);
        return true;
    }

    T* PeekPtr() {
        if (head_.load() == tail_.load()) {
            return nullptr;
        }

        return &data_[tail_.load() % N];
    }

    std::size_t Size() const {
        return head_.load() - tail_.load();
    }

    bool IsEmpty() const {
        return head_.load() == tail_.load();
    }

private:
    T data_[N];
    std::atomic<std::size_t> head_{0};
    std::atomic<std::size_t> tail_{0};
};

} // namespace synth
