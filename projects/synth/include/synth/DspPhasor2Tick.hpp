#pragma once

#include <cmath>

namespace synth {

// Detects changes of an integer musical-time grid. Invalid inputs are quiet
// and preserve the last valid cell, making accidental bad data safe on the
// realtime path without throwing or hiding a valid later transition.
class Phasor2Tick {
public:
    struct Input {
        double time = 0.0;
        int multiplier = 1;
    };

    static bool IsValid(const Input& input) noexcept {
        if (!std::isfinite(input.time) || input.multiplier <= 0) {
            return false;
        }
        return std::isfinite(input.time * static_cast<double>(input.multiplier));
    }

    bool Prime(const Input& input) noexcept {
        tick_ = false;
        if (!IsValid(input)) {
            return false;
        }
        previousCell_ = std::floor(input.time * static_cast<double>(input.multiplier));
        primed_ = true;
        return true;
    }

    bool Process(const Input& input) noexcept {
        tick_ = false;
        if (!IsValid(input)) {
            return false;
        }

        const double currentCell =
            std::floor(input.time * static_cast<double>(input.multiplier));
        if (!primed_) {
            previousCell_ = currentCell;
            primed_ = true;
            return false;
        }

        tick_ = currentCell != previousCell_;
        previousCell_ = currentCell;
        return tick_;
    }

    bool Tick() const noexcept { return tick_; }
    bool IsPrimed() const noexcept { return primed_; }
    double PreviousCell() const noexcept { return previousCell_; }

private:
    double previousCell_ = 0.0;
    bool primed_ = false;
    bool tick_ = false;
};

} // namespace synth
