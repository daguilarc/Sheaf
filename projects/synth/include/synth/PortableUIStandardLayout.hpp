#pragma once

// The one standard synth application layout (sru-53): a title, a visualizer
// column of two stacked slots anchored on the LEFT, an encoder region to its
// right, and a widget bay across the bottom.
//
// Every slot and region takes an arbitrary application-supplied component and
// this file prescribes nothing about what goes in one beyond its position and
// extent. That constraint is the point: composed from ordinary containers with
// no layout logic of its own, the standard layout is the test of whether the
// component library composes. If it ever needs arithmetic of its own, the
// resolver is wrong (design.md D10a).

#include "synth/PortableUIBuilders.hpp"
#include "synth/PortableUILayout.hpp"

#include <string>

namespace synth::ui {

// The proportions Braid 4 and Mini App already agreed on before they were
// rebuilt on this component: margin 16, title 30, gap 14, visualizer stack
// min(390, contentWidth * 0.46), encoder region min(462, remainder).
//
// The stack is a FRACTION with a maximum, never a weight: `contentWidth * 0.46`
// is a fraction of the container's content extent, taken before gaps, while a
// weight divides only what is left after them. At 700 wide with a 14 gap the
// two land on different numbers, and the fraction is the one both apps used.
struct StandardAppMetrics {
    float margin = 16.0f;
    float titleHeight = 30.0f;
    float gap = 14.0f;
    float stackFraction = 0.46f;
    float stackMaximum = 390.0f;
    float encoderMaximum = 462.0f;
};
inline constexpr StandardAppMetrics kStandardApp{};

// Node ids are "<idPrefix>.page", ".title", ".body", ".visualizers",
// ".slot.upper", ".slot.lower", ".encoders", and ".bay".
struct StandardAppLayout {
    std::string idPrefix;
    std::string title;
    Builder::Children upperVisualizer;
    Builder::Children lowerVisualizer;
    Builder::Children encoders;
    Builder::Children widgetBay;       // empty => bay collapses to zero extent

    void Emit(Builder& builder) const;
};

inline void StandardAppLayout::Emit(Builder& builder) const
{
    // The parentless root is the surface extent and carries no padding, so the
    // shared margin belongs to the page column beneath it.
    LayoutOptions page;
    page.main = Extent::Weight(1.0f);
    page.padding = kStandardApp.margin;
    page.gap = kStandardApp.gap;

    ControlStyle titleStyle;
    titleStyle.layout.main = Extent::Px(kStandardApp.titleHeight);

    LayoutOptions body;
    body.main = Extent::Weight(1.0f);
    body.padding = 0.0f;
    body.gap = kStandardApp.gap;

    LayoutOptions stack;
    stack.main = Extent::Fraction(kStandardApp.stackFraction).Max(kStandardApp.stackMaximum);
    stack.padding = 0.0f;
    stack.gap = kStandardApp.gap;

    LayoutOptions slot;
    slot.main = Extent::Weight(1.0f);
    slot.padding = 0.0f;
    slot.gap = kStandardApp.gap;

    LayoutOptions encoderRegion;
    encoderRegion.main = Extent::Weight(1.0f).Max(kStandardApp.encoderMaximum);
    encoderRegion.padding = 0.0f;
    encoderRegion.gap = kStandardApp.gap;

    // An unsupplied bay leaves the flow entirely rather than declaring a zero
    // extent inside it. A zero-extent child is still a child, so the column
    // would still charge the 14 gap that separates it from the body, and
    // sru-53 requires the regions above to take the bay's whole extent — all
    // of it, not all but one gap.
    LayoutOptions bay;
    bay.padding = 0.0f;
    bay.gap = kStandardApp.gap;
    if (widgetBay)
    {
        bay.main = Extent::Intrinsic();
    }
    else
    {
        bay.explicitBounds = Bounds{};
    }

    builder.Column(idPrefix + ".page", page, [&](Builder& b) {
        b.Label(idPrefix + ".title", title, titleStyle);
        b.Row(idPrefix + ".body", body, [&](Builder& b) {
            b.Column(idPrefix + ".visualizers", stack, [&](Builder& b) {
                b.Section(idPrefix + ".slot.upper", slot, upperVisualizer);
                b.Section(idPrefix + ".slot.lower", slot, lowerVisualizer);
            });
            b.Section(idPrefix + ".encoders", encoderRegion, encoders);
        });
        b.Section(idPrefix + ".bay", bay, widgetBay);
    });
}

}  // namespace synth::ui
