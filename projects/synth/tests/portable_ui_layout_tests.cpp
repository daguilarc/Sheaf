#include "synth/PortableUIBuilders.hpp"
#include "synth/PortableUIMetrics.hpp"
#include "synth/PortableUIStandardLayout.hpp"

#include <cmath>
#include <cstring>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
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

void Require(bool condition, const std::string& label)
{
    Require(condition, label.c_str());
}

// The test binary runs from projects/synth, while the plan names repository
// relative paths. Try both, and fail loudly on a path that exists in neither
// so a typo can never make a source assertion pass vacuously.
std::string ReadSource(const std::string& repoRelativePath)
{
    for (const std::string& candidate : {repoRelativePath, "../../" + repoRelativePath})
    {
        std::ifstream stream(candidate);
        if (stream)
        {
            std::ostringstream contents;
            contents << stream.rdbuf();
            return contents.str();
        }
    }
    throw std::runtime_error("missing source file: " + repoRelativePath);
}

bool SourceContains(const std::string& repoRelativePath, const std::string& needle)
{
    return ReadSource(repoRelativePath).find(needle) != std::string::npos;
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

bool SameBounds(synth::ui::Bounds a, synth::ui::Bounds b)
{
    return NearlyEqual(a.x, b.x) && NearlyEqual(a.y, b.y) && NearlyEqual(a.width, b.width) &&
           NearlyEqual(a.height, b.height);
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

void TestWrappingRowLineBreakHeightIsPinned()
{
    // The line-break computation was previously pinned only relationally, so a
    // wrong break would have gone undetected. The column's 12 padding leaves
    // the unpadded row 176 wide, which holds two 80-wide children per line
    // (80 + 8 + 80 = 168 <= 176) and breaks before the third. Two lines of
    // 22-high labels separated by one 8 gap.
    synth::ui::LayoutOptions row;
    row.wrap = true;
    row.padding = 0.0f;
    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 200.0f, 300.0f});
    b.Column("col", {}, [row](synth::ui::Builder& b) {
        b.Row("wrapped", row, [](synth::ui::Builder& b) {
            for (int i = 0; i < 4; ++i)
            {
                b.Label("w" + std::to_string(i), "x", MainOf(synth::ui::Extent::Px(80.0f)));
            }
        });
    });
    const auto tree = b.Build({0.0f, 0.0f, 200.0f, 300.0f});
    Require(NearlyEqual(FindNode(tree, "wrapped").bounds.height, 22.0f + 8.0f + 22.0f),
            "a wrapping row reserves exactly its computed line count");
    Require(NearlyEqual(FindNode(tree, "w1").bounds.y, FindNode(tree, "w0").bounds.y),
            "the first two children share the first line");
    Require(NearlyEqual(FindNode(tree, "w2").bounds.y, FindNode(tree, "w0").bounds.y + 22.0f + 8.0f),
            "the third child starts the second line one gap below the first");
}

void TestIntrinsicColumnReservesAWrappingRowsGrownExtent()
{
    // A wrapping row measured from two levels up: the intrinsic column must
    // measure it at the width it will actually resolve to, not at its
    // unwrapped natural width, or the grandparent under-reserves.
    synth::ui::LayoutOptions wrapping;
    wrapping.wrap = true;
    wrapping.padding = 0.0f;
    synth::ui::LayoutOptions intrinsicColumn;
    intrinsicColumn.main = synth::ui::Extent::Intrinsic();
    intrinsicColumn.padding = 0.0f;

    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 200.0f, 300.0f});
    b.Column("outer", {}, [&](synth::ui::Builder& b) {
        b.Column("bay", intrinsicColumn, [&](synth::ui::Builder& b) {
            b.Row("wrapped", wrapping, [](synth::ui::Builder& b) {
                for (int i = 0; i < 4; ++i)
                {
                    b.Label("w" + std::to_string(i), "x", MainOf(synth::ui::Extent::Px(80.0f)));
                }
            });
        });
        b.Label("after", "after", MainOf(synth::ui::Extent::Px(20.0f)));
    });
    const auto tree = b.Build({0.0f, 0.0f, 200.0f, 300.0f});
    const auto& bay = FindNode(tree, "bay");
    const auto& wrapped = FindNode(tree, "wrapped");
    Require(NearlyEqual(bay.bounds.height, wrapped.bounds.height),
            "the intrinsic column reserves the wrapping row's grown extent");
    Require(FindNode(tree, "after").bounds.y >= bay.bounds.y + bay.bounds.height + synth::ui::kSpacing.gap,
            "a trailing sibling of the column clears every wrapped line");
}

void TestOverlayChildTakesItsTargetsResolvedBounds()
{
    const auto build = [](bool overlay) {
        synth::ui::Builder b;
        b.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
        b.Row("row", {}, [overlay](synth::ui::Builder& b) {
            b.Label("first", "first", MainOf(synth::ui::Extent::Px(60.0f)));
            if (overlay)
            {
                synth::ui::LayoutOptions o;
                o.overlayOf = "second";
                b.Draw("underlay", o, [](synth::ui::Bounds extent) {
                    return std::vector<synth::ui::DrawCommand>{
                        synth::ui::DrawCommand::Fill(extent, synth::Color::Rgb(7, 8, 9))};
                });
            }
            b.Label("second", "second", MainOf(synth::ui::Extent::Px(90.0f)));
        });
        return b.Build({0.0f, 0.0f, 400.0f, 300.0f});
    };
    const auto with = build(true);
    const auto& underlay = FindNode(with, "underlay");
    const auto& second = FindNode(with, "second");
    Require(NearlyEqual(underlay.bounds.x, second.bounds.x) &&
                NearlyEqual(underlay.bounds.y, second.bounds.y) &&
                NearlyEqual(underlay.bounds.width, second.bounds.width) &&
                NearlyEqual(underlay.bounds.height, second.bounds.height),
            "an overlay child resolves to exactly its target sibling's bounds");
    const auto without = build(false);
    for (const char* sibling : {"row", "first", "second"})
    {
        Require(SameBounds(FindNode(with, sibling).bounds, FindNode(without, sibling).bounds),
                std::string("'") + sibling +
                    "' resolves identically with and without the overlay, so the overlay "
                    "consumes no stacking space");
    }
    Require(underlay.drawCommands.size() == 1 &&
                NearlyEqual(underlay.drawCommands[0].bounds.width, second.bounds.width),
            "the overlay's draw factory receives its resolved node-local extent");
}

void TestOverlayRejectsATargetThatIsNotInFlow()
{
    // sru-44 anchors an overlay to an IN-FLOW sibling. An out-of-flow target
    // was never placed by the flow, so there is no slot to cover and the
    // overlay collapses rather than copying a position it was not promised.
    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
    b.Row("row", {}, [](synth::ui::Builder& b) {
        synth::ui::LayoutOptions anchored;
        anchored.explicitBounds = synth::ui::Bounds{5.0f, 6.0f, 70.0f, 40.0f};
        b.Draw("anchored", anchored, [](synth::ui::Bounds) {
            return std::vector<synth::ui::DrawCommand>{};
        });

        synth::ui::LayoutOptions ontoAnchored;
        ontoAnchored.overlayOf = "anchored";
        b.Draw("onto.anchored", ontoAnchored, [](synth::ui::Bounds) {
            return std::vector<synth::ui::DrawCommand>{};
        });

        synth::ui::LayoutOptions ontoOverlay;
        ontoOverlay.overlayOf = "onto.anchored";
        b.Draw("onto.overlay", ontoOverlay, [](synth::ui::Bounds) {
            return std::vector<synth::ui::DrawCommand>{};
        });

        // In flow, but under a different parent: not a sibling.
        synth::ui::LayoutOptions ontoStranger;
        ontoStranger.overlayOf = "elsewhere";
        b.Draw("onto.stranger", ontoStranger, [](synth::ui::Bounds) {
            return std::vector<synth::ui::DrawCommand>{};
        });
    });
    b.Label("elsewhere", "e", MainOf(synth::ui::Extent::Px(50.0f)));
    const auto tree = b.Build({0.0f, 0.0f, 400.0f, 300.0f});
    Require(SameBounds(FindNode(tree, "anchored").bounds, {5.0f, 6.0f, 70.0f, 40.0f}),
            "the explicitly positioned sibling keeps its author-supplied bounds");
    for (const char* rejected : {"onto.anchored", "onto.overlay", "onto.stranger"})
    {
        Require(SameBounds(FindNode(tree, rejected).bounds, {}),
                std::string("overlay '") + rejected + "' collapses to nothing");
    }
}

void TestOverlayInsideAnOverlayContainerResolves()
{
    // An overlay may be a container, and resolving it discovers an overlay of
    // its own. That inner one is found only while the deferred overlays are
    // already being walked, so it has to be picked up by the same walk.
    synth::ui::LayoutOptions panelOverlay;
    panelOverlay.overlayOf = "target";
    panelOverlay.padding = 0.0f;

    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
    b.Column("col", {}, [&panelOverlay](synth::ui::Builder& b) {
        b.Section("panel", panelOverlay, [](synth::ui::Builder& b) {
            b.Label("inner.target", "inner", MainOf(synth::ui::Extent::Px(20.0f)));
            synth::ui::LayoutOptions inner;
            inner.overlayOf = "inner.target";
            b.Draw("inner.overlay", inner, [](synth::ui::Bounds extent) {
                return std::vector<synth::ui::DrawCommand>{
                    synth::ui::DrawCommand::Fill(extent, synth::Color::Rgb(3, 4, 5))};
            });
        });
        b.Label("target", "target", MainOf(synth::ui::Extent::Px(40.0f)));
    });
    const auto tree = b.Build({0.0f, 0.0f, 400.0f, 300.0f});

    const auto& panel = FindNode(tree, "panel");
    const auto& target = FindNode(tree, "target");
    Require(SameBounds(panel.bounds, target.bounds),
            "the overlay container takes its own target's bounds");
    Require(panel.bounds.width > 0.0f && panel.bounds.height > 0.0f,
            "the overlay container really was given an extent to resolve into");

    const auto& innerTarget = FindNode(tree, "inner.target");
    const auto& innerOverlay = FindNode(tree, "inner.overlay");
    Require(SameBounds(innerTarget.bounds, {0.0f, 0.0f, panel.bounds.width, 20.0f}),
            "the overlay container lays its own children out");
    Require(SameBounds(innerOverlay.bounds, innerTarget.bounds),
            "an overlay nested inside an overlay container still reaches its target");
    Require(innerOverlay.drawCommands.size() == 1 &&
                NearlyEqual(innerOverlay.drawCommands[0].bounds.width, innerTarget.bounds.width) &&
                NearlyEqual(innerOverlay.drawCommands[0].bounds.height, innerTarget.bounds.height),
            "the nested overlay's draw factory runs against its resolved extent");
}

void TestOverlayTracksATargetTheFormGridMoves()
{
    // A form grid moves and resizes its cells after their own row has placed
    // them. An overlay on such a cell must land on where the cell ended up,
    // not on where the row first put it.
    synth::ui::LayoutOptions grid;
    grid.formGrid = true;
    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
    b.Column("form", grid, [](synth::ui::Builder& b) {
        b.Row("r1", {}, [](synth::ui::Builder& b) {
            b.Label("r1.label", "Tempo");
            synth::ui::LayoutOptions o;
            o.overlayOf = "r1.control";
            b.Draw("r1.underlay", o, [](synth::ui::Bounds extent) {
                return std::vector<synth::ui::DrawCommand>{
                    synth::ui::DrawCommand::Fill(extent, synth::Color::Rgb(1, 2, 3))};
            });
            b.ComboBox("r1.control", "", {}, "", synth::ui::Action::Named("a"));
        });
        b.Row("r2", {}, [](synth::ui::Builder& b) {
            b.Label("r2.label", "A considerably longer caption");
            b.ComboBox("r2.control", "", {}, "", synth::ui::Action::Named("b"));
        });
    });
    const auto tree = b.Build({0.0f, 0.0f, 400.0f, 300.0f});
    const auto& control = FindNode(tree, "r1.control");
    const auto& underlay = FindNode(tree, "r1.underlay");
    Require(control.bounds.x > FindNode(tree, "r1.label").bounds.x,
            "the form grid really did move the control into the shared column");
    Require(SameBounds(underlay.bounds, control.bounds),
            "an overlay lands on its target's post-form-grid bounds");
    Require(underlay.drawCommands.size() == 1 &&
                NearlyEqual(underlay.drawCommands[0].bounds.width, control.bounds.width),
            "the overlay's draw factory runs against the post-form-grid extent");
}

synth::ui::NodeTree BuildStandardLayoutWith(float width,
                                            float height,
                                            synth::ui::Builder::Children upper,
                                            synth::ui::Builder::Children bay)
{
    synth::ui::StandardAppLayout layout;
    layout.idPrefix = "app";
    layout.title = "App";
    layout.upperVisualizer = std::move(upper);
    layout.widgetBay = std::move(bay);

    synth::ui::Builder b;
    b.Root("root", {0.0f, 0.0f, width, height});
    layout.Emit(b);
    return b.Build({0.0f, 0.0f, width, height});
}

synth::ui::Builder::Children StandardBayContent()
{
    return [](synth::ui::Builder& b) {
        b.Button("app.bay.one", "One", synth::ui::Action::Named("one"));
        b.Button("app.bay.two", "Two", synth::ui::Action::Named("two"));
    };
}

synth::ui::NodeTree BuildStandardLayout(float width, float height, synth::ui::Builder::Children upper)
{
    return BuildStandardLayoutWith(width, height, std::move(upper), StandardBayContent());
}

synth::ui::NodeTree BuildStandardLayoutAt(float width, float height)
{
    return BuildStandardLayoutWith(width, height, {}, StandardBayContent());
}

synth::ui::NodeTree BuildStandardLayoutWithBay()
{
    return BuildStandardLayoutWith(900.0f, 560.0f, {}, StandardBayContent());
}

synth::ui::NodeTree BuildStandardLayoutWithoutBay()
{
    return BuildStandardLayoutWith(900.0f, 560.0f, {}, {});
}

void TestSlotsAcceptArbitraryComponents()
{
    const auto fill = [](const char* id) {
        return [id](synth::ui::Builder& b) {
            b.Draw(id, LayoutMain(synth::ui::Extent::Weight(1.0f)), [](synth::ui::Bounds e) {
                return std::vector<synth::ui::DrawCommand>{
                    synth::ui::DrawCommand::Fill(e, synth::Color::Rgb(1, 1, 1))};
            });
        };
    };
    const auto grid = [&fill](synth::ui::Builder& b) {
        b.Row("cells", LayoutMain(synth::ui::Extent::Weight(1.0f)), [&fill](synth::ui::Builder& b) {
            fill("cell0")(b);
            fill("cell1")(b);
        });
    };
    for (const auto& upper : {synth::ui::Builder::Children(grid),
                              synth::ui::Builder::Children(fill("wave"))})
    {
        const auto tree = BuildStandardLayout(900.0f, 560.0f, upper);
        Require(FindNode(tree, "app.slot.upper").bounds.width > 0.0f,
                "the upper slot resolves whatever component it is given");
    }
    // The slot names are part of the declared interface; what must not appear
    // is any knowledge of what a slot is filled with.
    for (const char* forbidden : {"cellCount", "cellWidth", "kEncoderCount", "kScopeCount",
                                  "BoundsForIndex"})
    {
        Require(!SourceContains("projects/synth/include/synth/PortableUIStandardLayout.hpp", forbidden),
                std::string("the standard layout contains no '") + forbidden + "' logic");
    }
}

void TestStandardLayoutProportionsMatchBothApps()
{
    const auto tree = BuildStandardLayoutAt(900.0f, 560.0f);
    // contentWidth = 900 - 2*16 = 868; 868 * 0.46 = 399.28, capped at 390.
    Require(NearlyEqual(FindNode(tree, "app.visualizers").bounds.width, 390.0f),
            "the visualizer stack takes min(390, contentWidth * 0.46)");
    Require(NearlyEqual(FindNode(tree, "app.encoders").bounds.width, 462.0f),
            "the encoder region takes min(462, remainder)");
    Require(NearlyEqual(FindNode(tree, "app.title").bounds.height, 30.0f),
            "the title row is 30 high");
    Require(FindNode(tree, "app.visualizers").bounds.x < FindNode(tree, "app.encoders").bounds.x,
            "the visualizer stack is on the LEFT, encoders to its right");
    Require(FindNode(tree, "app.slot.upper").bounds.y < FindNode(tree, "app.slot.lower").bounds.y,
            "the visualizer column stacks the upper slot above the lower");
}

void TestEmptyWidgetBayCollapses()
{
    const auto with = BuildStandardLayoutWithBay();
    const auto without = BuildStandardLayoutWithoutBay();
    Require(SameBounds(FindNode(without, "app.bay").bounds, {}),
            "an unsupplied widget bay occupies no space and renders no chrome");
    Require(FindNode(without, "app.bay").children.empty(),
            "an unsupplied widget bay renders no placeholder content");

    // 560 root less the 16 margin twice is 528 of page content. Supplied, this
    // bay stacks two 28-high buttons over one 14 gap — 70 — and costs a second
    // 14 separating it from the body: 528 - 30 title - 14 - 70 - 14 = 400.
    // Unsupplied, it costs NEITHER extent nor gap, so the body takes all 84
    // back: 528 - 30 - 14 = 484.
    Require(NearlyEqual(FindNode(with, "app.bay").bounds.height, 70.0f),
            "a supplied bay is exactly as high as the controls it was given");
    Require(NearlyEqual(FindNode(with, "app.visualizers").bounds.height, 400.0f),
            "the regions above give up the bay's extent and its gap");
    Require(NearlyEqual(FindNode(without, "app.visualizers").bounds.height, 484.0f),
            "a collapsed bay gives back its extent AND the gap it would have cost");
}

void TestStandardLayoutRedistributesAtDifferentExtents()
{
    const auto narrow = BuildStandardLayoutAt(700.0f, 560.0f);
    const auto wide = BuildStandardLayoutAt(1400.0f, 560.0f);
    Require(FindNode(wide, "app.encoders").bounds.width >=
                FindNode(narrow, "app.encoders").bounds.width,
            "regions redistribute through the ordinary resolver at a wider extent");
    Require(NearlyEqual(FindNode(wide, "app.visualizers").bounds.width, 390.0f),
            "the capped stack stays at its maximum inside a real composition");
    // 700 - 2*16 = 668 content; 668 * 0.46 = 307.28 is below the cap, and the
    // encoder region takes what is left after one 14 gap.
    Require(NearlyEqual(FindNode(narrow, "app.visualizers").bounds.width, 307.28f),
            "below the cap the stack is exactly the content-width fraction");
    Require(NearlyEqual(FindNode(narrow, "app.encoders").bounds.width, 668.0f - 14.0f - 307.28f),
            "the encoder region takes the remainder after the gap, as both apps did");
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
    TestWrappingRowLineBreakHeightIsPinned();
    TestIntrinsicColumnReservesAWrappingRowsGrownExtent();
    TestOverlayChildTakesItsTargetsResolvedBounds();
    TestOverlayRejectsATargetThatIsNotInFlow();
    TestOverlayInsideAnOverlayContainerResolves();
    TestOverlayTracksATargetTheFormGridMoves();
    TestSectionAndScrollAreaStackChildrenVertically();
    TestSlotsAcceptArbitraryComponents();
    TestStandardLayoutProportionsMatchBothApps();
    TestEmptyWidgetBayCollapses();
    TestStandardLayoutRedistributesAtDifferentExtents();
}
