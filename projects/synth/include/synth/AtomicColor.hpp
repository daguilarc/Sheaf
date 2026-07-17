#pragma once

#include <atomic>
#include <cstdint>

#include "synth/Color.hpp"

namespace synth {

struct AtomicColor {
    AtomicColor() = default;
    explicit AtomicColor(Color color) { Store(color); }
    AtomicColor(const AtomicColor&) = delete;
    AtomicColor& operator=(const AtomicColor&) = delete;

    void Store(Color color, std::memory_order order = std::memory_order_relaxed) {
        value.store(color.Packed(), order);
    }
    Color Load(std::memory_order order = std::memory_order_relaxed) const {
        return Color::FromPacked(value.load(order));
    }
    bool IsLockFree() const { return value.is_lock_free(); }

    std::atomic<std::uint32_t> value{0};
};

}  // namespace synth
