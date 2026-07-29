#pragma once

#include "synth/PortableUI.hpp"

#include <optional>

namespace synth::ui {

struct SpacingMetrics {
    float padding = 12.0f;
    float gap = 8.0f;
    float rowHeight = 24.0f;
    float labelGap = 8.0f;
};
inline constexpr SpacingMetrics kSpacing{};

struct Extent {
    enum class Mode { Fixed, Intrinsic, Fraction, Weighted };
    Mode mode = Mode::Intrinsic;
    float value = 0.0f;   // px when Fixed; 0..1 when Fraction; weight when Weighted
    float minimum = 0.0f;
    float maximum = 0.0f; // 0 means "no maximum"

    static Extent Px(float pixels);
    static Extent Intrinsic();
    static Extent Fraction(float fractionOfContentExtent);
    static Extent Weight(float weight);
    Extent& Min(float pixels);
    Extent& Max(float pixels);
};

inline Extent Extent::Px(float p)       { return Extent{Mode::Fixed, p, 0.0f, 0.0f}; }
inline Extent Extent::Intrinsic()       { return Extent{Mode::Intrinsic, 0.0f, 0.0f, 0.0f}; }
inline Extent Extent::Fraction(float f) { return Extent{Mode::Fraction, f, 0.0f, 0.0f}; }
inline Extent Extent::Weight(float w)   { return Extent{Mode::Weighted, w, 0.0f, 0.0f}; }
inline Extent& Extent::Min(float p) { minimum = p; return *this; }
inline Extent& Extent::Max(float p) { maximum = p; return *this; }

struct LayoutOptions {
    Extent main = Extent::Intrinsic();
    Extent cross = Extent::Weight(1.0f);
    float padding = kSpacing.padding;
    float gap = kSpacing.gap;
    bool wrap = false;      // Row only
    bool formGrid = false;
    // Set => this node is explicitly positioned and OUT OF FLOW.
    // Out-of-flow is a positioning mode, never a property of a node kind.
    std::optional<Bounds> explicitBounds{};
};

}  // namespace synth::ui
