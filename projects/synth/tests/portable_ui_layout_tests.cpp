#include "synth/PortableUIBuilders.hpp"
#include "synth/PortableUIMetrics.hpp"

#include <cmath>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>

#ifdef JUCE_MAJOR_VERSION
#error "portable UI layout tests must not see JUCE"
#endif

namespace {

void Require(bool condition, const char* label)
{
    if (!condition)
    {
        throw std::runtime_error(label);
    }
}

const synth::ui::Node& FindNode(const synth::ui::NodeTree& tree, const char* id)
{
    for (const synth::ui::Node& node : tree.nodes)
    {
        if (node.id == synth::ui::NodeId(id))
        {
            return node;
        }
    }
    throw std::runtime_error(std::string("missing node: ") + id);
}

bool NearlyEqual(float a, float b)
{
    return std::fabs(a - b) < 0.01f;
}

synth::ui::ControlStyle MainOf(synth::ui::Extent e)
{
    synth::ui::ControlStyle s;
    s.layout.main = e;
    return s;
}

synth::ui::LayoutOptions LayoutMain(synth::ui::Extent e)
{
    synth::ui::LayoutOptions o;
    o.main = e;
    return o;
}

void TestWeightsDivideRemainingSpaceDeterministically()
{
    const auto build = [] {
        synth::ui::Builder b;
        b.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
        b.Row("row", {}, [](synth::ui::Builder& b) {
            b.Label("fixed", "f", MainOf(synth::ui::Extent::Px(100.0f)));
            b.Label("a", "a", MainOf(synth::ui::Extent::Weight(1.0f)));
            b.Label("b", "b", MainOf(synth::ui::Extent::Weight(1.0f)));
        });
        return b.Build({0.0f, 0.0f, 400.0f, 300.0f});
    };
    const auto first = build();
    const auto second = build();
    Require(NearlyEqual(FindNode(first, "a").bounds.width, FindNode(first, "b").bounds.width),
            "equal weights resolve to equal widths");
    Require(FindNode(first, "a").bounds.width > 0.0f, "weighted children get real width");
    Require(std::memcmp(&FindNode(first, "a").bounds,
                        &FindNode(second, "a").bounds,
                        sizeof(synth::ui::Bounds)) == 0,
            "re-resolving identical inputs yields byte-identical bounds");
}

void TestMaximumClampsAndRedistributesOnce()
{
    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 1000.0f, 300.0f});
    b.Row("row", {}, [](synth::ui::Builder& b) {
        b.Label("capped", "c", MainOf(synth::ui::Extent::Weight(1.0f).Max(100.0f)));
        b.Label("open", "o", MainOf(synth::ui::Extent::Weight(1.0f)));
    });
    const auto tree = b.Build({0.0f, 0.0f, 1000.0f, 300.0f});
    Require(NearlyEqual(FindNode(tree, "capped").bounds.width, 100.0f),
            "a weighted child never exceeds its declared maximum");
    Require(FindNode(tree, "open").bounds.width > 400.0f,
            "freed space is redistributed to the weighted, unclamped sibling");
}

void TestClampingRedistributionDoesNotRepeat()
{
    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 1000.0f, 300.0f});
    b.Row("row", {}, [](synth::ui::Builder& b) {
        b.Label("capped", "c", MainOf(synth::ui::Extent::Weight(1.0f).Max(100.0f)));
        b.Label("limited", "l", MainOf(synth::ui::Extent::Weight(1.0f).Max(330.0f)));
        b.Label("open", "o", MainOf(synth::ui::Extent::Weight(1.0f)));
    });
    const auto tree = b.Build({0.0f, 0.0f, 1000.0f, 300.0f});
    Require(NearlyEqual(FindNode(tree, "limited").bounds.width, 330.0f),
            "the first redistribution pass may clamp an eligible child");
    Require(NearlyEqual(FindNode(tree, "open").bounds.width, 430.0f),
            "the pass does not repeat to force residual space elsewhere");
}

void TestFractionIsOfContentExtentNotRemainingSpace()
{
    synth::ui::LayoutOptions row;
    row.padding = 16.0f;
    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 900.0f, 560.0f});
    b.Row("row", row, [](synth::ui::Builder& b) {
        b.Label("stack", "s", MainOf(synth::ui::Extent::Fraction(0.46f).Max(390.0f)));
        b.Label("rest", "r", MainOf(synth::ui::Extent::Weight(1.0f).Max(462.0f)));
    });
    const auto tree = b.Build({0.0f, 0.0f, 900.0f, 560.0f});
    Require(NearlyEqual(FindNode(tree, "stack").bounds.width, 390.0f),
            "a fraction is taken of content extent, then clamped by the maximum");
    Require(NearlyEqual(FindNode(tree, "rest").bounds.width, 462.0f),
            "the weighted sibling clamps at its own maximum");
}

void TestUnclampedFractionPinsContentExtentBasis()
{
    synth::ui::LayoutOptions row;
    row.padding = 16.0f;
    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 900.0f, 560.0f});
    b.Row("row", row, [](synth::ui::Builder& b) {
        b.Label("fraction", "s", MainOf(synth::ui::Extent::Fraction(0.46f)));
        b.Label("rest", "r", MainOf(synth::ui::Extent::Weight(1.0f)));
    });
    const auto tree = b.Build({0.0f, 0.0f, 900.0f, 560.0f});
    Require(NearlyEqual(FindNode(tree, "fraction").bounds.width, 399.28f),
            "an unclamped fraction is taken from content extent, not container or post-gap extent");
}

void TestInfeasibleMinimaOverflowDeterministically()
{
    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 100.0f, 300.0f});
    b.Row("row", {}, [](synth::ui::Builder& b) {
        b.Label("a", "a", MainOf(synth::ui::Extent::Weight(1.0f).Min(80.0f)));
        b.Label("b", "b", MainOf(synth::ui::Extent::Weight(1.0f).Min(80.0f)));
    });
    const auto tree = b.Build({0.0f, 0.0f, 100.0f, 300.0f});
    Require(NearlyEqual(FindNode(tree, "a").bounds.width, 80.0f) &&
                NearlyEqual(FindNode(tree, "b").bounds.width, 80.0f),
            "no child shrinks below its minimum");
    Require(FindNode(tree, "b").bounds.x > FindNode(tree, "a").bounds.x,
            "they overflow in declaration order rather than being shrunk");
}

void TestInsertingARowShiftsSiblingsByExtentPlusGap()
{
    const auto build = [](bool extra) {
        synth::ui::Builder b;
        b.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
        b.Column("col", {}, [extra](synth::ui::Builder& b) {
            b.Label("first", "first", MainOf(synth::ui::Extent::Px(20.0f)));
            if (extra)
            {
                b.Label("inserted", "ins", MainOf(synth::ui::Extent::Px(20.0f)));
            }
            b.Label("last", "last", MainOf(synth::ui::Extent::Px(20.0f)));
        });
        return b.Build({0.0f, 0.0f, 400.0f, 300.0f});
    };
    Require(NearlyEqual(FindNode(build(true), "last").bounds.y -
                            FindNode(build(false), "last").bounds.y,
                        20.0f + synth::ui::kSpacing.gap),
            "inserting a row moves later siblings by its extent plus one gap");
}

void TestExplicitlyPositionedChildrenAreOutOfFlow()
{
    const auto build = [](bool overlay) {
        synth::ui::Builder b;
        b.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
        b.Column("col", {}, [overlay](synth::ui::Builder& b) {
            b.Label("first", "first", MainOf(synth::ui::Extent::Px(20.0f)));
            if (overlay)
            {
                synth::ui::LayoutOptions o;
                o.explicitBounds = synth::ui::Bounds{5.0f, 5.0f, 50.0f, 50.0f};
                b.Draw("overlay", o, [](synth::ui::Bounds) {
                    return std::vector<synth::ui::DrawCommand>{};
                });
            }
            b.Label("last", "last", MainOf(synth::ui::Extent::Px(20.0f)));
        });
        return b.Build({0.0f, 0.0f, 400.0f, 300.0f});
    };
    const auto with = build(true);
    Require(NearlyEqual(FindNode(with, "last").bounds.y, FindNode(build(false), "last").bounds.y),
            "stacked siblings resolve as if the out-of-flow child were absent");
    Require(NearlyEqual(FindNode(with, "overlay").bounds.x, 5.0f),
            "the out-of-flow child keeps its author-supplied bounds");
}

void TestInFlowDrawFactoryReceivesItsResolvedExtent()
{
    const auto buildAt = [](float width) {
        synth::ui::Builder b;
        b.Root("root", {0.0f, 0.0f, width, 300.0f});
        b.Row("row", {}, [](synth::ui::Builder& b) {
            b.Draw("canvas", LayoutMain(synth::ui::Extent::Weight(1.0f)),
                   [](synth::ui::Bounds extent) {
                       return std::vector<synth::ui::DrawCommand>{
                           synth::ui::DrawCommand::Fill(extent, synth::Color::Rgb(1, 2, 3))};
                   });
        });
        return b.Build({0.0f, 0.0f, width, 300.0f});
    };
    const auto narrow = buildAt(400.0f);
    const auto wide = buildAt(800.0f);
    Require(NearlyEqual(FindNode(narrow, "canvas").drawCommands[0].bounds.x, 0.0f),
            "the factory receives a node-local extent starting at the origin");
    Require(FindNode(wide, "canvas").drawCommands[0].bounds.width >
                FindNode(narrow, "canvas").drawCommands[0].bounds.width,
            "commands fill the extent the layout allocated, at any root extent");
}

void TestFormGridAlignsLabelAndControlColumns()
{
    synth::ui::LayoutOptions grid;
    grid.formGrid = true;
    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
    b.Column("form", grid, [](synth::ui::Builder& b) {
        b.Row("r1", {}, [](synth::ui::Builder& b) {
            b.Label("r1.label", "Tempo");
            b.ComboBox("r1.control", "", {}, "", synth::ui::Action::Named("a"));
        });
        b.Row("r2", {}, [](synth::ui::Builder& b) {
            b.Label("r2.label", "A considerably longer caption");
            b.ComboBox("r2.control", "", {}, "", synth::ui::Action::Named("b"));
        });
    });
    const auto tree = b.Build({0.0f, 0.0f, 400.0f, 300.0f});
    Require(NearlyEqual(FindNode(tree, "r1.label").bounds.x, FindNode(tree, "r2.label").bounds.x),
            "every participating label column starts at the same x-offset");
    Require(NearlyEqual(FindNode(tree, "r1.control").bounds.x, FindNode(tree, "r2.control").bounds.x),
            "every participating control column starts at the same x-offset");
    Require(FindNode(tree, "r1.control").bounds.x >=
                FindNode(tree, "r2.label").bounds.x + FindNode(tree, "r2.label").bounds.width,
            "the control column clears the widest label");
}

void TestFormGridUsesRowLocalPadding()
{
    synth::ui::LayoutOptions grid;
    grid.formGrid = true;
    grid.padding = 30.0f;
    synth::ui::LayoutOptions row;
    row.padding = 4.0f;

    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 420.0f, 300.0f});
    b.Column("form", grid, [&row](synth::ui::Builder& b) {
        b.Row("r1", row, [](synth::ui::Builder& b) {
            b.Label("r1.label", "Short");
            b.ComboBox("r1.control", "", {}, "", synth::ui::Action::Named("a"));
        });
        b.Row("r2", row, [](synth::ui::Builder& b) {
            b.Label("r2.label", "Longer label");
            b.ComboBox("r2.control", "", {}, "", synth::ui::Action::Named("b"));
        });
    });
    const auto tree = b.Build({0.0f, 0.0f, 420.0f, 300.0f});
    Require(NearlyEqual(FindNode(tree, "r1.label").bounds.x, 4.0f),
            "form-grid cells use their row's local padding, not the form container padding");
    Require(NearlyEqual(FindNode(tree, "r1.control").bounds.x, FindNode(tree, "r2.control").bounds.x),
            "control columns still align with mixed form and row padding");
}

void TestCrossAxisWeightDoesNotExceedContentExtent()
{
    synth::ui::ControlStyle style;
    style.layout.cross = synth::ui::Extent::Weight(2.0f);
    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 300.0f, 160.0f});
    b.Row("row", LayoutMain(synth::ui::Extent::Px(100.0f)), [&style](synth::ui::Builder& b) {
        b.Label("tall", "tall", style);
    });
    const auto tree = b.Build({0.0f, 0.0f, 300.0f, 160.0f});
    Require(NearlyEqual(FindNode(tree, "tall").bounds.height, 76.0f),
            "cross-axis weights are normalized to the available content extent");
}

void TestCaptionedControlRowOccupiesTheParentFlowSlot()
{
    synth::ui::ControlStyle style;
    style.caption = "Device";
    style.layout.main = synth::ui::Extent::Px(34.0f);
    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
    b.Column("form", {}, [&style](synth::ui::Builder& b) {
        b.ComboBox("device", "", {}, "", synth::ui::Action::Named("pick"), style);
        b.Label("after", "after", MainOf(synth::ui::Extent::Px(20.0f)));
    });
    const auto tree = b.Build({0.0f, 0.0f, 400.0f, 300.0f});
    Require(NearlyEqual(FindNode(tree, "device.row").bounds.height, 34.0f),
            "the author's layout applies to the implicit caption row");
    Require(NearlyEqual(FindNode(tree, "after").bounds.y - FindNode(tree, "device.row").bounds.y,
                        34.0f + synth::ui::kSpacing.gap),
            "the captioned row, not the inner control, advances parent flow");
}

void TestCaptionedAndUncaptionedControlsHonorTheSameDeclaredExtent()
{
    synth::ui::ControlStyle captioned;
    captioned.caption = "Device";
    captioned.layout.main = synth::ui::Extent::Px(34.0f);
    synth::ui::ControlStyle plain;
    plain.layout.main = synth::ui::Extent::Px(34.0f);

    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 420.0f, 300.0f});
    b.Column("form", {}, [&](synth::ui::Builder& b) {
        b.ComboBox("captioned", "", {}, "", synth::ui::Action::Named("captioned"), captioned);
        b.ComboBox("plain", "", {}, "", synth::ui::Action::Named("plain"), plain);
    });
    const auto tree = b.Build({0.0f, 0.0f, 420.0f, 300.0f});
    Require(NearlyEqual(FindNode(tree, "captioned.row").bounds.height, FindNode(tree, "plain").bounds.height),
            "captioned and uncaptioned controls honor the same declared flow extent");
}

void TestSplicedSubtreeLayoutOptionsAreHonoredWhenResolved()
{
    synth::ui::Builder inner;
    inner.Root("inner.root", {0.0f, 0.0f, 100.0f, 50.0f});
    inner.Label("inner.label", "spliced", MainOf(synth::ui::Extent::Px(44.0f)));

    synth::ui::Builder outer;
    outer.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
    outer.Column("host", {}, [&inner](synth::ui::Builder& b) {
        b.Splice(inner.BuildSubtree());
    });
    const auto tree = outer.Build({0.0f, 0.0f, 400.0f, 300.0f});
    Require(NearlyEqual(FindNode(tree, "inner.label").bounds.height, 44.0f),
            "spliced Subtree layout options are honored during resolution");
}

void TestSplicedSubtreeDrawFactoryStillRuns()
{
    synth::ui::Builder inner;
    inner.Root("inner.root", {0.0f, 0.0f, 100.0f, 50.0f});
    inner.Draw("inner.canvas", LayoutMain(synth::ui::Extent::Px(36.0f)), [](synth::ui::Bounds extent) {
        return std::vector<synth::ui::DrawCommand>{
            synth::ui::DrawCommand::Fill(extent, synth::Color::Rgb(4, 5, 6))};
    });

    synth::ui::Builder outer;
    outer.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
    outer.Column("host", {}, [&inner](synth::ui::Builder& b) {
        b.Splice(inner.BuildSubtree());
    });
    const auto tree = outer.Build({0.0f, 0.0f, 400.0f, 300.0f});
    const auto& canvas = FindNode(tree, "inner.canvas");
    Require(canvas.drawCommands.size() == 1, "spliced Subtree carries Draw factories");
    Require(NearlyEqual(canvas.drawCommands[0].bounds.height, 36.0f),
            "the spliced Draw factory fills the resolved extent");
}

void TestComponentResolvesIdenticallyUnderDifferentParents()
{
    const auto emit = [](synth::ui::Builder& b, const std::string& p) {
        b.Row(p + ".row", LayoutMain(synth::ui::Extent::Px(40.0f)), [&p](synth::ui::Builder& b) {
            b.Label(p + ".label", "same", MainOf(synth::ui::Extent::Px(60.0f)));
        });
    };
    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
    b.Column("top", LayoutMain(synth::ui::Extent::Px(100.0f)), [&](synth::ui::Builder& b) { emit(b, "top"); });
    b.Column("bottom", LayoutMain(synth::ui::Extent::Px(100.0f)), [&](synth::ui::Builder& b) { emit(b, "bottom"); });
    const auto tree = b.Build({0.0f, 0.0f, 400.0f, 300.0f});
    Require(NearlyEqual(FindNode(tree, "top.row").bounds.y, FindNode(tree, "bottom.row").bounds.y),
            "the same component resolves identically under different parents");
    Require(FindNode(tree, "top").bounds.y != FindNode(tree, "bottom").bounds.y,
            "the two parents really are at different positions");
}

void TestExtentDrivenRedistribution()
{
    const auto buildAt = [](float w) {
        synth::ui::Builder b;
        b.Root("root", {0.0f, 0.0f, w, 300.0f});
        b.Row("row", {}, [](synth::ui::Builder& b) {
            b.Label("fixed", "f", MainOf(synth::ui::Extent::Px(100.0f)));
            b.Label("weighted", "w", MainOf(synth::ui::Extent::Weight(1.0f)));
        });
        return b.Build({0.0f, 0.0f, w, 300.0f});
    };
    const auto narrow = buildAt(400.0f);
    const auto wide = buildAt(800.0f);
    Require(FindNode(wide, "weighted").bounds.width >
                FindNode(narrow, "weighted").bounds.width + 350.0f,
            "a wider root extent widens the weighted child proportionally");
    Require(NearlyEqual(FindNode(wide, "fixed").bounds.width,
                        FindNode(narrow, "fixed").bounds.width),
            "the fixed child keeps its extent at both root extents");
}

void TestTextReservationIsDeterministicAndBackendFree()
{
    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
    b.Row("row", {}, [](synth::ui::Builder& b) {
        b.Label("short", "ab");
        b.Label("long", "abcdefghij");
    });
    const auto tree = b.Build({0.0f, 0.0f, 400.0f, 300.0f});
    Require(NearlyEqual(FindNode(tree, "short").bounds.width,
                        synth::ui::metrics::TextWidth("ab", synth::ui::TextStyle{})),
            "an intrinsic label width is its character-count reservation");
    Require(FindNode(tree, "long").bounds.width > FindNode(tree, "short").bounds.width,
            "a longer string reserves more width");
}

void TestWrappingRowFlowsOntoAdditionalLines()
{
    synth::ui::LayoutOptions row;
    row.wrap = true;
    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 200.0f, 300.0f});
    b.Row("row", row, [](synth::ui::Builder& b) {
        for (int i = 0; i < 4; ++i)
        {
            b.Label("c" + std::to_string(i), "x", MainOf(synth::ui::Extent::Px(80.0f)));
        }
    });
    const auto tree = b.Build({0.0f, 0.0f, 200.0f, 300.0f});
    Require(FindNode(tree, "c2").bounds.y > FindNode(tree, "c0").bounds.y,
            "overflowing children resolve onto subsequent lines");
    Require(FindNode(tree, "row").bounds.height > 20.0f,
            "the container's extent grows to contain every line");
}

void TestWrappingRowReservesGrownExtentInParentFlow()
{
    synth::ui::LayoutOptions row;
    row.wrap = true;
    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 200.0f, 300.0f});
    b.Column("col", {}, [row](synth::ui::Builder& b) {
        b.Row("wrapped", row, [](synth::ui::Builder& b) {
            for (int i = 0; i < 4; ++i)
            {
                b.Label("w" + std::to_string(i), "x", MainOf(synth::ui::Extent::Px(80.0f)));
            }
        });
        b.Label("after", "after", MainOf(synth::ui::Extent::Px(20.0f)));
    });
    const auto tree = b.Build({0.0f, 0.0f, 200.0f, 300.0f});
    const auto& wrapped = FindNode(tree, "wrapped");
    Require(FindNode(tree, "after").bounds.y >= wrapped.bounds.y + wrapped.bounds.height + synth::ui::kSpacing.gap,
            "a trailing sibling clears the wrapping row's grown extent");
}

void TestSectionAndScrollAreaStackChildrenVertically()
{
    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
    b.Section("section", LayoutMain(synth::ui::Extent::Px(100.0f)), [](synth::ui::Builder& b) {
        b.Label("section.first", "first", MainOf(synth::ui::Extent::Px(20.0f)));
        b.Label("section.second", "second", MainOf(synth::ui::Extent::Px(20.0f)));
    });
    b.ScrollArea("scroll", LayoutMain(synth::ui::Extent::Px(100.0f)), [](synth::ui::Builder& b) {
        b.Label("scroll.first", "first", MainOf(synth::ui::Extent::Px(20.0f)));
        b.Label("scroll.second", "second", MainOf(synth::ui::Extent::Px(20.0f)));
    });
    const auto tree = b.Build({0.0f, 0.0f, 400.0f, 300.0f});
    Require(FindNode(tree, "section.second").bounds.y > FindNode(tree, "section.first").bounds.y,
            "Section stacks children vertically");
    Require(FindNode(tree, "scroll.second").bounds.y > FindNode(tree, "scroll.first").bounds.y,
            "ScrollArea stacks children vertically");
}

}  // namespace

int main()
{
    TestWeightsDivideRemainingSpaceDeterministically();
    TestMaximumClampsAndRedistributesOnce();
    TestClampingRedistributionDoesNotRepeat();
    TestFractionIsOfContentExtentNotRemainingSpace();
    TestUnclampedFractionPinsContentExtentBasis();
    TestInfeasibleMinimaOverflowDeterministically();
    TestInsertingARowShiftsSiblingsByExtentPlusGap();
    TestExplicitlyPositionedChildrenAreOutOfFlow();
    TestInFlowDrawFactoryReceivesItsResolvedExtent();
    TestFormGridAlignsLabelAndControlColumns();
    TestFormGridUsesRowLocalPadding();
    TestCrossAxisWeightDoesNotExceedContentExtent();
    TestCaptionedControlRowOccupiesTheParentFlowSlot();
    TestCaptionedAndUncaptionedControlsHonorTheSameDeclaredExtent();
    TestSplicedSubtreeLayoutOptionsAreHonoredWhenResolved();
    TestSplicedSubtreeDrawFactoryStillRuns();
    TestComponentResolvesIdenticallyUnderDifferentParents();
    TestExtentDrivenRedistribution();
    TestTextReservationIsDeterministicAndBackendFree();
    TestWrappingRowFlowsOntoAdditionalLines();
    TestWrappingRowReservesGrownExtentInParentFlow();
    TestSectionAndScrollAreaStackChildrenVertically();
}
