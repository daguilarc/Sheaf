# Portable UI Component Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the portable UI layer's two disjoint authoring paths, backend-side layout engine, and guessed coordinate spaces with one hierarchical component library that resolves all layout producer-side into parent-relative coordinates, carries colour and text style directly on nodes, and leaves both backends as dumb renderers.

**Architecture:** A JUCE-free component library gains lambda-scoped container components and a build-time layout resolver that computes every node's parent-relative `Bounds` from declarative extents, using a library-owned metrics contract instead of any backend measurement. `Bounds` changes meaning from surface-absolute to parent-relative and `Draw` geometry becomes node-local, carried across a single command-buffer version bump (1 → 2) with no backwards compatibility. Both backends lose four things each: the draw-geometry coordinate classifier, the node-bounds parent-local classifier, the auto-flow cursor with its default-size table, and the hardcoded per-variant colour constants. The config pages and both first-party apps are then rebuilt on the library, and "looks better" is verified by named criteria, Playwright structural assertions, and human-gated screenshot baselines.

**Tech Stack:** C++20 (`-std=c++20 -Wall -Wextra -Wpedantic`), JUCE (desktop backend), TypeScript + Emscripten Wasm (browser backend), Playwright (Chromium), plain assertion-style C++ test binaries built by `projects/synth/Makefile`.

## Global Constraints

Apply to every task. Copy into your working context before you start.

- **OpenSpec is the source of truth.** Read `openspec/changes/rebuild-portable-ui-component-library/{proposal,design,tasks}.md` and both files under `specs/`. Do not invent behavior outside them. If implementation reveals a design defect, **STOP and report it**. If missing behavior is a spec gap, report it — do not silently implement beyond the spec.
- **The library is JUCE-free.** `PortableUI.hpp`, `PortableUIBuilders.hpp`, and everything new beside them compile with no JUCE header, no DOM knowledge, and no backend or wire-codec include.
- **Backends contain no policy.** No layout, no sizing, no coordinate inference, no appearance decisions. The only appearance decision a backend makes is fitting text inside an extent the library already resolved.
- **Coordinates.** A node's `Bounds` are in its parent's space. The single parentless root's bounds are surface coordinates. A `ScrollArea`'s children are relative to the scroll-*content* origin. All `Draw` geometry is relative to the owning node's own origin, clipped to the node's bounds.
- **No compiled-in surface size** in any layout resolution path.
- **Commands:**
  - JUCE-free C++: `make -C projects/synth test`
  - Browser: `make -C projects/synth browser-unit-test` then `make -C projects/synth/browser test` (or `make synth-browser-test`)
  - JUCE simulation (needs JUCE): `make -C projects/synth/apps/miniapp test`
  - Layering: `make -C projects/synth check-ui-boundary`
- **Never merge; rebase only.** Conventional-commit messages. Commit frequently.
- **Do not loosen a failing position assertion.** Layout and coordinate changes will intentionally break position pins. Re-pin them to the new resolved parent-relative values. Loosening one is a plan failure.
- **Version 2 is a hard break.** No dual-version decode, no v1 fallback, no negotiation.

## Ordering Constraint — read before Task 4

**Every producer converts before the backend mechanism that currently rescues it is deleted.** Three producers break loudly otherwise:

- **The File page** emits nested browser rows surface-absolute (`RuntimePages.hpp:698-750`) and survives only because `ExplicitBoundsAreParentLocal` rescues them. → Task 4.
- **The shell** adds the sidebar offset to *every* sidebar node (`RuntimeMainComponent.hpp:117`). Under parent-relative semantics the sidebar root already carries that offset, so leaving the loop double-offsets every descendant through component and DOM nesting. → Task 5.
- **Both apps** append unbounded labels, buttons, toggles, and sliders directly beneath `Root`; the auto-flow cursor is the only thing positioning them. Compilation shims preserve the *signature*, not the layout. → Task 6.

Tasks 4-6 therefore run **before** Tasks 7-8 delete the classifiers and the cursor. Intermediate states stay green: while the classifiers still exist, a well-formed parent-relative tree whose children fit their parents is classified parent-local and translated correctly, so the classifiers are inert rather than wrong once producers have converted. That is precisely why the File page — whose nested children do *not* fit — must convert first.

## Shared Interfaces

Defined once so tasks written by different implementers agree. Do not rename these.

```cpp
// projects/synth/include/synth/PortableUILayout.hpp   (Tasks 1-2)
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
```

```cpp
// projects/synth/include/synth/PortableUIMetrics.hpp   (Task 2)
namespace synth::ui::metrics {
float AdvanceFor(const TextStyle& style);                     // per-character advance
float TextWidth(std::string_view text, const TextStyle& style);
Bounds IntrinsicFor(const Node& node);                        // per-kind intrinsic extent
}
```

```cpp
// projects/synth/include/synth/PortableUIBuilders.hpp   (Tasks 1-2)
namespace synth::ui {

struct ControlStyle {
    std::optional<Color> color{};
    std::optional<TextStyle> textStyle{};
    bool selected = false;
    bool enabled = true;
    std::optional<Action> action{};            // plain click
    std::optional<Action> pointerDragAction{};
    std::optional<Action> doubleClickAction{};
    std::string caption;                       // emitted as a sibling Label node
    LayoutOptions layout{};
};

struct Subtree {
    NodeTree tree;
    std::map<std::string, LayoutOptions> layout;
};

class Builder {
public:
    using Children = std::function<void(Builder&)>;
    // Commands produced at resolve time from the node's own resolved extent.
    using DrawFactory = std::function<std::vector<DrawCommand>(Bounds nodeExtent)>;

    Builder& Column(std::string id, LayoutOptions opts, const Children& children);
    Builder& Row(std::string id, LayoutOptions opts, const Children& children);
    Builder& Section(std::string id, LayoutOptions opts, const Children& children);
    Builder& ScrollArea(std::string id, LayoutOptions opts, const Children& children);

    // Splicing unit. NodeTree alone cannot carry LayoutOptions, and Node must
    // not — the model layer knows nothing about the library's layout
    // vocabulary (sru-51). So a spliced subtree carries its own declarations.
    Builder& Splice(Subtree subtree);
    Builder& Splice(NodeTree tree);   // externally produced; no layout declarations
    Subtree BuildSubtree();           // rootless or rooted, with its layout map

    // In-flow Draw: the resolver invokes `factory` with the resolved extent.
    Builder& Draw(std::string id, LayoutOptions opts, DrawFactory factory);

    NodeTree Build(Bounds rootExtent);
};

}  // namespace synth::ui
```

```cpp
// projects/synth/include/synth/PortableUIStandardLayout.hpp   (Task 6)
namespace synth::ui {
struct StandardAppLayout {
    std::string idPrefix;              // ids are "<prefix>.title", ".slot.upper", etc.
    std::string title;
    Builder::Children upperVisualizer;
    Builder::Children lowerVisualizer;
    Builder::Children encoders;
    Builder::Children widgetBay;       // empty => bay collapses to zero extent
    void Emit(Builder& builder) const;
};
}
```

**Node model additions (Task 1 adds the fields; Task 3 fixes their semantics):**

```cpp
std::optional<Color> color{};          // meaning is per-kind, see table below
std::optional<TextStyle> textStyle{};  // glyph colour ALWAYS comes from here
```

**Per-kind meaning of `Node::color`** (sru-45 — every backend task honours this exactly):

| Node kind | What `color` paints |
|---|---|
| `Button`, `Toggle` | the control fill |
| `ComboBox`, `TextField` | the field background |
| `Slider` | the filled-track accent |
| `Root`, `Row`, `Section`, `ScrollArea` | the container background fill |
| `Label`, `StatusText` | the text background — **never** the glyphs |
| `Draw` | nothing; draw commands carry their own colours |

A carried value beats every backend constant. Selected/hover/pressed/disabled are **derived** from the carried colour, never substituted from a palette. Absent `color` → the backend's existing default look in full.

**The allocation algorithm** (design.md D3 — Task 2 implements it; nothing else may reinvent it):

1. Fixed, intrinsic, and fractional extents resolve first. A fraction is of the container's extent **less padding**, before gaps and siblings.
2. Weights divide the main-axis space remaining after those extents, all gaps, and padding.
3. Every resolved extent is clamped to `[minimum, maximum]`.
4. Space freed or demanded by clamping is redistributed in **exactly one** further pass, across only children that are weighted **and** unclamped, proportional to weight.
5. Residual space no eligible child can absorb is left unallocated at the end of the container. Never forced onto a clamped child; the pass never repeats.
6. If minima exceed the container's extent, no child shrinks below its minimum — they overflow in declaration order, deterministically.

---

## File Structure

**Created:** `PortableUILayout.hpp` (extents, spacing, resolver), `PortableUIMetrics.hpp` (intrinsic extents, text reservations), `PortableUIStandardLayout.hpp`, `RuntimePageStyle.hpp` (config-page colour constants), `browser/tests/visual-criteria.spec.ts`, `tests/portable_ui_layout_tests.cpp`.

**Modified:** `PortableUI.hpp`, `PortableUIBuilders.hpp`, `BrowserCommandBuffer.hpp` + `protocol.ts`, `BrowserRuntimeAbi.cpp`, `PortableJuceBackend.hpp` + `ui.ts` (four deletions each), `RuntimePages.hpp` + `ControllersPageUI.hpp` + `ControllerWizard.cpp`, `RuntimeMainComponent.hpp`, `apps/braid-4/` + `apps/miniapp/`, `scripts/check_ui_boundary.sh`, `docs/coverage.md`.

---

## Task 1: The authoring surface — containers, splice, and control style

**OpenSpec:** 2.1, 2.5, 2.6 · **Requirements:** sru-43, sru-45

**Files:**
- Modify: `projects/synth/include/synth/PortableUIBuilders.hpp:270-421`, `projects/synth/include/synth/PortableUI.hpp`
- Create: `projects/synth/include/synth/PortableUILayout.hpp` (types only; the resolver is Task 2)
- Test: `projects/synth/tests/portable_ui_tests.cpp`

**Interfaces:**
- Consumes: nothing.
- Produces: `Builder::Column/Row/Section/ScrollArea`, `Builder::Splice`, `Builder::Children`, `ControlStyle`, `Extent`/`LayoutOptions`/`SpacingMetrics`, `Node::color`/`Node::textStyle` — all exactly as in Shared Interfaces. `Build()` keeps its no-argument form here; Task 2 replaces it with `Build(Bounds)`.

Today `AppendChild` (line 412) always appends to `rootIndex_`, so every tree is one root plus flat leaves. Replace the single index with a scope stack.

- [ ] **Step 1: Write the failing tests**

Match the existing `Require` / `FindNode` idiom in the file — read it first; do not introduce a second assertion style.

```cpp
static void TestContainersNestToArbitraryDepth()
{
    synth::ui::Builder builder;
    builder.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
    builder.Section("sect", {}, [](synth::ui::Builder& b) {
        b.ScrollArea("scroll", {}, [](synth::ui::Builder& b) {
            b.Row("row", {}, [](synth::ui::Builder& b) { b.Label("leaf", "hello"); });
        });
    });
    const synth::ui::NodeTree tree = builder.Build();
    Require(FindNode(tree, "root").children[0].value == "sect", "root holds the section");
    Require(FindNode(tree, "sect").kind == synth::ui::NodeKind::Section, "sect is a Section");
    Require(FindNode(tree, "sect").children[0].value == "scroll", "section holds the scroll area");
    Require(FindNode(tree, "scroll").children[0].value == "row", "scroll area holds the row");
    Require(FindNode(tree, "row").children[0].value == "leaf", "row holds the leaf");
}

// A reusable component is an ordinary callable. Nothing else.
struct CaptionedRow {
    std::string id, caption;
    void operator()(synth::ui::Builder& b) const {
        b.Row(id, {}, [this](synth::ui::Builder& b) {
            b.Label(id + ".caption", caption);
            b.Button(id + ".action", "Go", synth::ui::Action::Named("go"));
        });
    }
};

static void TestComponentsComposeComponents()
{
    synth::ui::Builder builder;
    builder.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
    builder.Column("col", {}, [](synth::ui::Builder& b) {
        CaptionedRow{"first", "First"}(b);
        CaptionedRow{"second", "Second"}(b);
    });
    const synth::ui::NodeTree tree = builder.Build();
    Require(FindNode(tree, "col").children.size() == 2, "column holds both rows");
    Require(FindNode(tree, "first.caption").text == "First", "each invocation emits in place");
    Require(FindNode(tree, "first").children.size() == 2, "with distinct stable ids");
}

static void TestSpliceGraftsWithoutNestedRoot()
{
    synth::ui::Builder inner;
    inner.Root("inner.root", {0.0f, 0.0f, 100.0f, 50.0f});
    inner.Label("inner.label", "spliced");

    synth::ui::Builder outer;
    outer.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
    outer.Section("host", {}, [&inner](synth::ui::Builder& b) { b.Splice(inner.Build()); });

    const synth::ui::NodeTree tree = outer.Build();
    std::size_t roots = 0;
    for (const auto& n : tree.nodes) { if (n.kind == synth::ui::NodeKind::Root) ++roots; }
    Require(roots == 1, "exactly one Root survives the splice");
    Require(FindNode(tree, "host").children[0].value == "inner.label",
            "the spliced root's children become the host's children");
}

static void TestConstructionExpressesFullControlState()
{
    synth::ui::ControlStyle style;
    style.color = synth::Color::Rgb(0, 200, 0);
    style.textStyle = synth::ui::TextStyle{16.0f, synth::Color::Rgb(255,255,255),
                                           synth::ui::TextAlign::Center};
    style.selected = true;
    style.enabled = false;

    synth::ui::Builder builder;
    builder.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
    builder.Button("green", "Go", synth::ui::Action::Named("go"), style);

    const synth::ui::NodeTree tree = builder.Build();
    const synth::ui::Node& n = FindNode(tree, "green");
    Require(n.color.has_value() && n.color->g == 200, "colour reaches the node record");
    Require(n.textStyle.has_value(), "text style reaches the node record");
    Require(n.selected && !n.enabled, "selected and enabled reach the node record");
}

static void TestUnstyledNodesCarryNothing()
{
    synth::ui::Builder builder;
    builder.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
    builder.Button("plain", "Plain", synth::ui::Action::Named("go"));
    const synth::ui::NodeTree tree = builder.Build();
    const synth::ui::Node& n = FindNode(tree, "plain");
    Require(!n.color.has_value() && !n.textStyle.has_value(),
            "an unstyled control carries nothing, so each backend uses its default look");
}

static void TestCaptionIsAnEmittedLabelNodeNotAField()
{
    synth::ui::ControlStyle style;
    style.caption = "Output device";
    synth::ui::LayoutOptions grid;
    grid.formGrid = true;

    synth::ui::Builder builder;
    builder.Root("root", {0.0f, 0.0f, 400.0f, 300.0f});
    builder.Column("form", grid, [&style](synth::ui::Builder& b) {
        b.ComboBox("device", "", {}, "", synth::ui::Action::Named("pick"), style);
    });
    const synth::ui::NodeTree tree = builder.Build();
    Require(FindNode(tree, "device.caption").kind == synth::ui::NodeKind::Label,
            "a caption is an ordinary Label node in the control's row");
    Require(FindNode(tree, "device.caption").text == "Output device", "carrying its text");
    Require(FindNode(tree, "device").label.empty(),
            "the caption does not route through ComboBox::label");
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `make -C projects/synth test 2>&1 | tail -20`
Expected: compile failure — no `Section`, no `Splice`, no `ControlStyle`, no `Node::color`.

- [ ] **Step 3: Replace the root index with a scope stack**

```cpp
private:
    void AppendChild(Node node) {
        assert(!scopeStack_.empty() && "Builder::Root must be called before adding child nodes");
        const NodeId childId = node.id;
        tree_.nodes.push_back(std::move(node));
        tree_.nodes[scopeStack_.back()].children.push_back(childId);
    }

    Builder& Container(std::string id, NodeKind kind, LayoutOptions opts, const Children& children) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = kind;
        if (opts.explicitBounds.has_value()) { node.bounds = *opts.explicitBounds; }
        const std::string key = node.id.value;
        AppendChild(std::move(node));
        layoutByNodeId_[key] = opts;
        scopeStack_.push_back(tree_.nodes.size() - 1);
        if (children) { children(*this); }
        scopeStack_.pop_back();
        return *this;
    }

    NodeTree tree_;
    std::vector<std::size_t> scopeStack_;
    std::map<std::string, LayoutOptions> layoutByNodeId_;
```

`Root()` becomes `scopeStack_.assign(1, tree_.nodes.size() - 1);` after pushing the root node.

```cpp
    // Column and Section both emit NodeKind::Section: the model has no Column
    // kind and adding one would be a wire change this change does not budget
    // for. Stacking direction is a resolver property keyed on LayoutOptions,
    // not on the node kind. Do not "fix" this.
    Builder& Column(std::string id, LayoutOptions o, const Children& c) { return Container(std::move(id), NodeKind::Section, o, c); }
    Builder& Section(std::string id, LayoutOptions o, const Children& c) { return Container(std::move(id), NodeKind::Section, o, c); }
    Builder& Row(std::string id, LayoutOptions o, const Children& c)    { return Container(std::move(id), NodeKind::Row, o, c); }
    Builder& ScrollArea(std::string id, LayoutOptions o, const Children& c) { return Container(std::move(id), NodeKind::ScrollArea, o, c); }
```

Create `PortableUILayout.hpp` with `SpacingMetrics`, `Extent` (including `Fraction`), and `LayoutOptions` exactly as in Shared Interfaces:

```cpp
inline Extent Extent::Px(float p)       { return Extent{Mode::Fixed, p, 0.0f, 0.0f}; }
inline Extent Extent::Intrinsic()       { return Extent{Mode::Intrinsic, 0.0f, 0.0f, 0.0f}; }
inline Extent Extent::Fraction(float f) { return Extent{Mode::Fraction, f, 0.0f, 0.0f}; }
inline Extent Extent::Weight(float w)   { return Extent{Mode::Weighted, w, 0.0f, 0.0f}; }
inline Extent& Extent::Min(float p) { minimum = p; return *this; }
inline Extent& Extent::Max(float p) { maximum = p; return *this; }
```

- [ ] **Step 4: Implement Splice**

```cpp
    // Grafts a subtree. A Root node in the subtree is discarded and its
    // children attach to the currently open scope, so exactly one Root
    // survives. A ROOTLESS subtree attaches its FOREST ROOTS — the nodes not
    // named in any sibling's `children` — to the open scope; that is the shape
    // Tasks 12 and 13 produce. Grafting without attaching leaves the nodes
    // parentless, and PortableJuceBackend.hpp:664-676 throws when more than one
    // node has no parent.
    Builder& Splice(Subtree subtree);
    Builder& Splice(NodeTree tree) { return Splice(Subtree{std::move(tree), {}}); }
```

- [ ] **Step 5: Add the two Node fields and ControlStyle**

In `PortableUI.hpp`, after `std::string variant;`:

```cpp
    // Direct appearance properties (sru-45). Optional: absent means the
    // backend's plain default look. `color`'s meaning is per-kind; glyph
    // colour always comes from `textStyle`, never from `color`.
    std::optional<Color> color{};
    std::optional<TextStyle> textStyle{};
```

Add `ControlStyle` exactly as in Shared Interfaces and give every leaf method (`Label`, `StatusText`, `Button`, `Toggle`, `Slider`, `ComboBox`, `TextField`, `Draw`, `DrawInteractive`, `Visualizer`) a trailing `ControlStyle style = {}`, applied through one helper:

```cpp
    void ApplyStyle(Node& node, const ControlStyle& s) {
        node.color = s.color;
        node.textStyle = s.textStyle;
        node.selected = s.selected;
        node.enabled = s.enabled;
        if (s.action.has_value())            { node.action = s.action; }
        if (s.pointerDragAction.has_value()) { node.pointerDragAction = s.pointerDragAction; }
        if (s.doubleClickAction.has_value()) { node.doubleClickAction = s.doubleClickAction; }
    }
```

For a non-empty `style.caption`, emit a `Label` with id `<controlId>.caption` **before** the control, wrapping both in an implicit `Row` with id `<controlId>.row` so the form grid sees a label cell and a control cell. **Document that id convention in a comment** — Task 11's Audio page and Task 14's Playwright caption assertion both depend on it.

Keep the old flat signatures as shims; Task 16 deletes them.

- [ ] **Step 6: Run to verify all tests pass**

Run: `make -C projects/synth test 2>&1 | tail -30`
Expected: PASS, including every pre-existing assertion — a tree with only `Root()` open behaves exactly as before.

- [ ] **Step 7: Commit**

```bash
git add projects/synth/include/synth/PortableUI.hpp projects/synth/include/synth/PortableUIBuilders.hpp projects/synth/include/synth/PortableUILayout.hpp projects/synth/tests/portable_ui_tests.cpp
git commit -m "feat(portable-ui): add container scopes, splicing, and construction-time control style (sru-43, sru-45)"
```

---

## Task 2: The layout engine — resolver, metrics, form grid, in-flow Draw

**OpenSpec:** 2.2, 2.2a, 2.3, 2.4, 2.7 · **Requirements:** sru-44, sru-50, part of sru-49

**Files:**
- Modify: `projects/synth/include/synth/PortableUILayout.hpp` (add the resolver)
- Create: `projects/synth/include/synth/PortableUIMetrics.hpp`
- Modify: `projects/synth/include/synth/PortableUIBuilders.hpp` (`Build()` → `Build(Bounds)`, the `DrawFactory` overload)
- Create: `projects/synth/tests/portable_ui_layout_tests.cpp`
- Modify: `projects/synth/Makefile` (new test binary, copying the `PORTABLE_UI_TEST_BIN` pattern exactly)

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `NodeTree Builder::Build(Bounds)`, `Builder::DrawFactory` and the in-flow `Draw` overload, and `synth::ui::metrics::{AdvanceFor,TextWidth,IntrinsicFor}`.

The heart of the change. Read design.md D3 and D4 in full first. **Implement the allocation algorithm exactly as stated in Shared Interfaces** — it is stated once so two implementers cannot diverge.

Resolution rules:

1. A container stacks along its **main axis** — vertical for `Section`/`Column`/`ScrollArea`, horizontal for `Row`.
2. A child with `explicitBounds` is **out of flow**: it takes those bounds verbatim and consumes no stacking space; siblings resolve as if it were absent. Out-of-flow is a positioning mode, **not** a property of `NodeKind::Draw`.
3. In-flow extents resolve by the six-step allocation algorithm.
4. Cross-axis resolves the same way against the container's cross extent minus padding.
5. Positions accumulate from the container's padding, adding each in-flow child's main extent plus `gap` between consecutive in-flow children.
6. A `Row` with `wrap = true` starts a new line when the next child would exceed the remaining line width; lines are separated by `gap` and the row's cross extent grows to contain every line.
7. Resolution is **local**: a container resolves children against only its own extent, never reading an ancestor.
8. An in-flow `Draw` with a `DrawFactory` has the factory invoked **during resolution**, with that node's resolved node-local extent `{0, 0, w, h}`, and the returned commands stored on the node.

- [ ] **Step 1: Write the metrics contract**

Create `PortableUIMetrics.hpp`. Seed the constants from the two existing backend tables — read `DefaultSizeForNode` at `projects/synth/juce/PortableJuceBackend.hpp:590` and `defaultSize` at `projects/synth/browser/src/ui.ts:448`. **Record the values you read and the advance-metric derivation** in a comment block and in design.md open question 2.

```cpp
#pragma once
#include "synth/PortableUI.hpp"
#include <algorithm>
#include <string_view>

namespace synth::ui::metrics {

// Per-character advance, deliberately conservative so truncation is the
// exception. See design.md D4.
inline float AdvanceFor(const TextStyle& style) { return style.size * 0.62f; }

// A deterministic width RESERVATION, never a measurement. Identical in every
// backend because no backend is consulted.
inline float TextWidth(std::string_view text, const TextStyle& style) {
    return static_cast<float>(text.size()) * AdvanceFor(style) + 16.0f;
}

// Per-kind intrinsic extent: successor of DefaultSizeForNode / defaultSize.
inline Bounds IntrinsicFor(const Node& node) {
    const TextStyle style = node.textStyle.value_or(TextStyle{});
    switch (node.kind) {
        case NodeKind::Label:
        case NodeKind::StatusText: return {0,0, TextWidth(node.text, style), 20.0f};
        case NodeKind::Button:     return {0,0, std::max(72.0f, TextWidth(node.label, style)), 24.0f};
        case NodeKind::Toggle:     return {0,0, std::max(96.0f, TextWidth(node.label, style) + 24.0f), 24.0f};
        case NodeKind::ComboBox:
        case NodeKind::TextField:
        case NodeKind::Slider:     return {0,0, 180.0f, 24.0f};
        default:                   return {0,0, 0.0f, 0.0f};
    }
}

}  // namespace synth::ui::metrics
```

Replace the literals with the values you actually read if they differ; the shapes are what matter.

- [ ] **Step 2: Write the failing resolver tests**

Create `projects/synth/tests/portable_ui_layout_tests.cpp`, matching the idiom of `portable_ui_tests.cpp`. Helpers first:

```cpp
static bool NearlyEqual(float a, float b) { return std::fabs(a - b) < 0.01f; }
static synth::ui::ControlStyle MainOf(synth::ui::Extent e) {
    synth::ui::ControlStyle s; s.layout.main = e; return s;
}
static synth::ui::LayoutOptions LayoutMain(synth::ui::Extent e) {
    synth::ui::LayoutOptions o; o.main = e; return o;
}
```

```cpp
static void TestWeightsDivideRemainingSpaceDeterministically()
{
    const auto build = []{
        synth::ui::Builder b;
        b.Root("root", {0,0,400,300});
        b.Row("row", {}, [](synth::ui::Builder& b) {
            b.Label("fixed", "f", MainOf(synth::ui::Extent::Px(100.0f)));
            b.Label("a", "a", MainOf(synth::ui::Extent::Weight(1.0f)));
            b.Label("b", "b", MainOf(synth::ui::Extent::Weight(1.0f)));
        });
        return b.Build({0,0,400,300});
    };
    const auto first = build(), second = build();
    Require(NearlyEqual(FindNode(first,"a").bounds.width, FindNode(first,"b").bounds.width),
            "equal weights resolve to equal widths");
    Require(FindNode(first,"a").bounds.width > 0.0f, "weighted children get real width");
    Require(std::memcmp(&FindNode(first,"a").bounds, &FindNode(second,"a").bounds,
                        sizeof(synth::ui::Bounds)) == 0,
            "re-resolving identical inputs yields byte-identical bounds");
}

static void TestMaximumClampsAndRedistributesOnce()
{
    synth::ui::Builder b;
    b.Root("root", {0,0,1000,300});
    b.Row("row", {}, [](synth::ui::Builder& b) {
        b.Label("capped", "c", MainOf(synth::ui::Extent::Weight(1.0f).Max(100.0f)));
        b.Label("open", "o", MainOf(synth::ui::Extent::Weight(1.0f)));
    });
    const auto tree = b.Build({0,0,1000,300});
    Require(NearlyEqual(FindNode(tree,"capped").bounds.width, 100.0f),
            "a weighted child never exceeds its declared maximum");
    Require(FindNode(tree,"open").bounds.width > 400.0f,
            "freed space is redistributed to the weighted, unclamped sibling");
}

static void TestFractionIsOfContentExtentNotRemainingSpace()
{
    // Container 900 wide, padding 16 each side => content 868.
    // 868 * 0.46 = 399.28, capped at 390. A plain weight would divide only
    // what is LEFT after gaps and land on a different number.
    synth::ui::LayoutOptions row;
    row.padding = 16.0f;
    synth::ui::Builder b;
    b.Root("root", {0,0,900,560});
    b.Row("row", row, [](synth::ui::Builder& b) {
        b.Label("stack", "s", MainOf(synth::ui::Extent::Fraction(0.46f).Max(390.0f)));
        b.Label("rest", "r", MainOf(synth::ui::Extent::Weight(1.0f).Max(462.0f)));
    });
    const auto tree = b.Build({0,0,900,560});
    Require(NearlyEqual(FindNode(tree,"stack").bounds.width, 390.0f),
            "a fraction is taken of content extent, then clamped by the maximum");
    Require(NearlyEqual(FindNode(tree,"rest").bounds.width, 462.0f),
            "the weighted sibling clamps at its own maximum");
}

static void TestInfeasibleMinimaOverflowDeterministically()
{
    synth::ui::Builder b;
    b.Root("root", {0,0,100,300});
    b.Row("row", {}, [](synth::ui::Builder& b) {
        b.Label("a", "a", MainOf(synth::ui::Extent::Weight(1.0f).Min(80.0f)));
        b.Label("b", "b", MainOf(synth::ui::Extent::Weight(1.0f).Min(80.0f)));
    });
    const auto tree = b.Build({0,0,100,300});
    Require(NearlyEqual(FindNode(tree,"a").bounds.width, 80.0f)
                && NearlyEqual(FindNode(tree,"b").bounds.width, 80.0f),
            "no child shrinks below its minimum");
    Require(FindNode(tree,"b").bounds.x > FindNode(tree,"a").bounds.x,
            "they overflow in declaration order rather than being shrunk");
}

static void TestInsertingARowShiftsSiblingsByExtentPlusGap()
{
    const auto build = [](bool extra) {
        synth::ui::Builder b;
        b.Root("root", {0,0,400,300});
        b.Column("col", {}, [extra](synth::ui::Builder& b) {
            b.Label("first", "first", MainOf(synth::ui::Extent::Px(20.0f)));
            if (extra) b.Label("inserted", "ins", MainOf(synth::ui::Extent::Px(20.0f)));
            b.Label("last", "last", MainOf(synth::ui::Extent::Px(20.0f)));
        });
        return b.Build({0,0,400,300});
    };
    Require(NearlyEqual(FindNode(build(true),"last").bounds.y
                            - FindNode(build(false),"last").bounds.y,
                        20.0f + synth::ui::kSpacing.gap),
            "inserting a row moves later siblings by its extent plus one gap, "
            "with no producer-side coordinate edits");
}

static void TestExplicitlyPositionedChildrenAreOutOfFlow()
{
    const auto build = [](bool overlay) {
        synth::ui::Builder b;
        b.Root("root", {0,0,400,300});
        b.Column("col", {}, [overlay](synth::ui::Builder& b) {
            b.Label("first", "first", MainOf(synth::ui::Extent::Px(20.0f)));
            if (overlay) {
                synth::ui::LayoutOptions o;
                o.explicitBounds = synth::ui::Bounds{5,5,50,50};
                b.Draw("overlay", o, [](synth::ui::Bounds){
                    return std::vector<synth::ui::DrawCommand>{}; });
            }
            b.Label("last", "last", MainOf(synth::ui::Extent::Px(20.0f)));
        });
        return b.Build({0,0,400,300});
    };
    const auto with = build(true);
    Require(NearlyEqual(FindNode(with,"last").bounds.y, FindNode(build(false),"last").bounds.y),
            "stacked siblings resolve as if the out-of-flow child were absent");
    Require(NearlyEqual(FindNode(with,"overlay").bounds.x, 5.0f),
            "the out-of-flow child keeps its author-supplied bounds");
}

static void TestInFlowDrawFactoryReceivesItsResolvedExtent()
{
    const auto buildAt = [](float width) {
        synth::ui::Builder b;
        b.Root("root", {0,0,width,300});
        b.Row("row", {}, [](synth::ui::Builder& b) {
            b.Draw("canvas", LayoutMain(synth::ui::Extent::Weight(1.0f)),
                   [](synth::ui::Bounds extent) {
                       // Fills whatever the slot turned out to be.
                       return std::vector<synth::ui::DrawCommand>{
                           synth::ui::DrawCommand::Fill(extent, synth::Color::Rgb(1,2,3))};
                   });
        });
        return b.Build({0,0,width,300});
    };
    const auto narrow = buildAt(400.0f), wide = buildAt(800.0f);
    Require(NearlyEqual(FindNode(narrow,"canvas").drawCommands[0].bounds.x, 0.0f),
            "the factory receives a node-local extent starting at the origin");
    Require(FindNode(wide,"canvas").drawCommands[0].bounds.width
                > FindNode(narrow,"canvas").drawCommands[0].bounds.width,
            "commands fill the extent the layout allocated, at any root extent");
}

static void TestFormGridAlignsLabelAndControlColumns()
{
    synth::ui::LayoutOptions grid; grid.formGrid = true;
    synth::ui::Builder b;
    b.Root("root", {0,0,400,300});
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
    const auto tree = b.Build({0,0,400,300});
    Require(NearlyEqual(FindNode(tree,"r1.label").bounds.x, FindNode(tree,"r2.label").bounds.x),
            "every participating label column starts at the same x-offset");
    Require(NearlyEqual(FindNode(tree,"r1.control").bounds.x, FindNode(tree,"r2.control").bounds.x),
            "every participating control column starts at the same x-offset");
    Require(FindNode(tree,"r1.control").bounds.x
                >= FindNode(tree,"r2.label").bounds.x + FindNode(tree,"r2.label").bounds.width,
            "the control column clears the widest label");
}

static void TestComponentResolvesIdenticallyUnderDifferentParents()
{
    const auto emit = [](synth::ui::Builder& b, const std::string& p) {
        b.Row(p + ".row", LayoutMain(synth::ui::Extent::Px(40.0f)), [&p](synth::ui::Builder& b) {
            b.Label(p + ".label", "same", MainOf(synth::ui::Extent::Px(60.0f)));
        });
    };
    synth::ui::Builder b;
    b.Root("root", {0,0,400,300});
    b.Column("top", LayoutMain(synth::ui::Extent::Px(100.0f)), [&](synth::ui::Builder& b){ emit(b,"top"); });
    b.Column("bottom", LayoutMain(synth::ui::Extent::Px(100.0f)), [&](synth::ui::Builder& b){ emit(b,"bottom"); });
    const auto tree = b.Build({0,0,400,300});
    Require(NearlyEqual(FindNode(tree,"top.row").bounds.y, FindNode(tree,"bottom.row").bounds.y),
            "the same component resolves identically under different parents "
            "at the same available extent");
    Require(FindNode(tree,"top").bounds.y != FindNode(tree,"bottom").bounds.y,
            "the two parents really are at different positions");
}

static void TestExtentDrivenRedistribution()
{
    const auto buildAt = [](float w) {
        synth::ui::Builder b;
        b.Root("root", {0,0,w,300});
        b.Row("row", {}, [](synth::ui::Builder& b) {
            b.Label("fixed", "f", MainOf(synth::ui::Extent::Px(100.0f)));
            b.Label("weighted", "w", MainOf(synth::ui::Extent::Weight(1.0f)));
        });
        return b.Build({0,0,w,300});
    };
    const auto narrow = buildAt(400.0f), wide = buildAt(800.0f);
    Require(FindNode(wide,"weighted").bounds.width
                > FindNode(narrow,"weighted").bounds.width + 350.0f,
            "a wider root extent widens the weighted child proportionally");
    Require(NearlyEqual(FindNode(wide,"fixed").bounds.width,
                        FindNode(narrow,"fixed").bounds.width),
            "the fixed child keeps its extent at both root extents");
}

static void TestTextReservationIsDeterministicAndBackendFree()
{
    synth::ui::Builder b;
    b.Root("root", {0,0,400,300});
    b.Column("col", {}, [](synth::ui::Builder& b) {
        b.Label("short", "ab");
        b.Label("long", "abcdefghij");
    });
    const auto tree = b.Build({0,0,400,300});
    Require(NearlyEqual(FindNode(tree,"short").bounds.width,
                        synth::ui::metrics::TextWidth("ab", synth::ui::TextStyle{})),
            "an intrinsic label width is its character-count reservation");
    Require(FindNode(tree,"long").bounds.width > FindNode(tree,"short").bounds.width,
            "a longer string reserves more width");
}

static void TestWrappingRowFlowsOntoAdditionalLines()
{
    synth::ui::LayoutOptions row; row.wrap = true;
    synth::ui::Builder b;
    b.Root("root", {0,0,200,300});
    b.Row("row", row, [](synth::ui::Builder& b) {
        for (int i = 0; i < 4; ++i) {
            b.Label("c" + std::to_string(i), "x", MainOf(synth::ui::Extent::Px(80.0f)));
        }
    });
    const auto tree = b.Build({0,0,200,300});
    Require(FindNode(tree,"c2").bounds.y > FindNode(tree,"c0").bounds.y,
            "overflowing children resolve onto subsequent lines");
    Require(FindNode(tree,"row").bounds.height > 20.0f,
            "the container's extent grows to contain every line");
}
```

- [ ] **Step 3: Run to verify they fail**

Run: `make -C projects/synth test 2>&1 | tail -20`
Expected: compile failure — `Build` takes no arguments, no `DrawFactory` overload, metrics not wired in.

- [ ] **Step 4: Implement the resolver**

Add to `PortableUILayout.hpp`:

```cpp
// Resolves every node's parent-relative bounds in one pass over the container
// tree, following the six-step allocation algorithm in the plan's Shared
// Interfaces. Resolution is LOCAL: each container resolves its children
// against only its own extent, never consulting an ancestor.
void ResolveLayout(NodeTree& tree,
                   const NodeId& rootId,
                   Bounds rootExtent,
                   const std::map<std::string, LayoutOptions>& layoutByNodeId,
                   const std::map<std::string, Builder::DrawFactory>& drawFactories);
```

For each container: partition children into out-of-flow and in-flow; run the six-step algorithm on the in-flow set; walk them in order assigning bounds from `padding`, advancing by extent plus `gap`; handle wrapping; assign out-of-flow children their `explicitBounds`; invoke any `DrawFactory` with the node's resolved `{0,0,w,h}` and store the commands; recurse into every child with that child's resolved extent as the new container extent.

**Form grid:** when `formGrid` is set, before resolving the container's `Row` children, compute `labelColumnWidth` as the max over rows of the first in-flow child's resolved main extent, and `controlOffset = padding + labelColumnWidth + kSpacing.labelGap`. Resolve each row normally, then override the label cell's `bounds.x` to `padding` and the control cell's to `controlOffset`, giving the control cell the remaining width. A row with fewer than two in-flow children does not participate. **Participation is structural, not a per-node flag**, so producers cannot forget to mark a row — comment that.

Change `Builder::Build()` to `Build(Bounds rootExtent)`, setting the root's bounds and calling `ResolveLayout`. Splice-inserted nodes have no entry in `layoutByNodeId_` and default to `LayoutOptions{}`. Keep a no-argument `Build()` shim delegating to `Build(rootBounds)` so existing callers compile; Task 16 deletes it.

Add the in-flow `Draw` overload taking a `DrawFactory`, recorded in a `drawFactories_` map keyed by node id.

- [ ] **Step 5: Wire the new test binary into the Makefile**

Add `PORTABLE_UI_LAYOUT_TEST_BIN := $(BUILD_DIR)/portable_ui_layout_tests` with its build rule and `test` dependency, copying the `PORTABLE_UI_TEST_BIN` pattern exactly.

- [ ] **Step 6: Run all tests**

Run: `make -C projects/synth test 2>&1 | tail -30`
Expected: PASS, including every pre-existing suite.

- [ ] **Step 7: Verify no compiled-in surface size**

Run: `grep -nE '\b(900|560|996)\b' projects/synth/include/synth/PortableUILayout.hpp projects/synth/include/synth/PortableUIMetrics.hpp`
Expected: no output. Any hit is a resolution path depending on a compiled-in surface dimension, which sru-50 forbids.

- [ ] **Step 8: Commit**

```bash
git add projects/synth/include/synth/PortableUILayout.hpp projects/synth/include/synth/PortableUIMetrics.hpp projects/synth/include/synth/PortableUIBuilders.hpp projects/synth/tests/portable_ui_layout_tests.cpp projects/synth/Makefile
git commit -m "feat(portable-ui): add the layout resolver, metrics contract, and form grid (sru-44, sru-50)"
```

---

## Task 3: Version-2 model semantics and the wire format

**OpenSpec:** 1.2, 1.3, 3.1, 3.2, 3.2a, 3.3 · **Requirements:** sru-45, sru-46, design.md OQ1 and OQ5

**Files:**
- Modify: `projects/synth/include/synth/PortableUI.hpp`, `include/synth/browser/BrowserCommandBuffer.hpp`, `browser/src/protocol.ts`, `browser/cpp/BrowserRuntimeAbi.cpp:19-22`
- Modify: `tests/browser_runtime_contract_tests.cpp:890`, `browser/src/static-server.mjs:38`, `browser/tests/midi-timing.test.mjs:204`, `browser/tests/runtime-core.spec.ts` (~132, ~162, ~193), `browser/tests/package-loader.spec.ts:297`, `browser/tests/scaffold.test.mjs:49`
- Modify: `openspec/changes/rebuild-portable-ui-component-library/design.md` (record OQ1, OQ5 resolved)
- Test: `projects/synth/tests/browser_command_buffer_tests.cpp`

**Interfaces:**
- Consumes: `Node::color`/`Node::textStyle` (Task 1).
- Produces: the **fixed** v2 schema. Every downstream backend task encodes, decodes, and renders against exactly what this task documents.

A later change to this schema forces a second wire migration, which is why OQ1 and OQ5 are settled here rather than in cleanup.

- [ ] **Step 1: Decide and record the `variant` residual (OQ1)**

Read `PortableJuceBackend.hpp:377-407` (`SetSemantics`), `:1119-1158`, `:1357-1363`, `:1374`. Split the strings:

- **Appearance** (`danger`, `primary`, `quiet`, `muted`, `muted-title`, `title` where it only picks a colour or weight): replaced outright by `Node::color`/`Node::textStyle`. Deleted.
- **Interaction semantics** (`list-row`, `panel`, and anything `SetSemantics` branches on for hover/selection rather than colour): the residual.

Record in design.md OQ1 as RESOLVED with the exact final set: either `variant` shrinks to that closed set, or the residual becomes an explicit field (e.g. `bool interactiveRow`). Whichever you pick lands in the v2 schema **now**.

- [ ] **Step 2: Decide and record `ComboBox::label` (OQ5)**

Read `PortableJuceBackend.hpp:1262` (`setTextWhenNothingSelected`). Captions now come from Task 1's emitted `Label` nodes, so this field no longer carries caption duty. Decide: rename to `placeholder` (keeping the behavior for a genuine placeholder) or retire it. Record in design.md OQ5 as RESOLVED. Task 11's Audio rebuild depends on this — an unanswered `label` field is exactly how the trap gets recreated.

- [ ] **Step 3: Write the coordinate and clipping contract onto the model**

Above `struct Bounds` and again above `struct Node`:

```cpp
// Coordinate contract (sru-46, command buffer version 2).
//
// A node's `bounds` are expressed in its PARENT's coordinate space:
//   * the single parentless root's bounds are surface coordinates;
//   * a ScrollArea's children are relative to the scroll-CONTENT origin, so
//     scrolling is purely a backend view transform and producers never see a
//     scroll offset;
//   * every other node's bounds are relative to its parent's origin.
//
// A node's `drawCommands` geometry is NODE-LOCAL: against the owning node's
// own (0, 0, width, height) box. Node content clips to the node's bounds. A
// producer whose drawing overhangs its node box must grow the node's bounds;
// there is no classification and no rescue.
//
// No backend infers, guesses, or classifies any of the above. A node's
// rendered position is exactly its own bounds folded over the accumulated
// origins of its ancestor chain, plus scroll offset and uniform surface scale
// where applicable.
```

Apply the OQ1 decision to the model. Add `bool IsResidualVariant(std::string_view)` returning membership of the closed set (or, if you chose an explicit field, add the field and skip this).

- [ ] **Step 4: Write the failing round-trip tests**

Match the real encode/decode entry-point names you read from `BrowserCommandBuffer.hpp`; the names below are illustrative.

```cpp
static void TestVersionTwoCarriesStyleAndParentRelativeBounds()
{
    synth::ui::NodeTree tree;
    synth::ui::Node root; root.id = synth::ui::NodeId("root");
    root.kind = synth::ui::NodeKind::Root; root.bounds = {0,0,400,300};
    root.children.push_back(synth::ui::NodeId("child"));
    synth::ui::Node child; child.id = synth::ui::NodeId("child");
    child.kind = synth::ui::NodeKind::Button;
    child.bounds = {10,20,80,24};                      // parent-relative
    child.color = synth::Color::Rgb(0,200,0);
    child.textStyle = synth::ui::TextStyle{16.0f, synth::Color::Rgb(255,255,255),
                                           synth::ui::TextAlign::Center};
    tree.nodes.push_back(root); tree.nodes.push_back(child);

    const auto out = FindNode(synth::browser::DecodeNodeTree(
                                  synth::browser::EncodeNodeTree(tree)), "child");
    Require(NearlyEqual(out.bounds.x, 10.0f) && NearlyEqual(out.bounds.y, 20.0f),
            "parent-relative bounds survive encode/decode unchanged");
    Require(out.color.has_value() && out.color->g == 200, "carried colour survives");
    Require(out.textStyle.has_value() && NearlyEqual(out.textStyle->size, 16.0f),
            "carried text style survives");
}

static void TestAbsentStyleStaysAbsent()
{
    synth::ui::NodeTree tree;
    synth::ui::Node root; root.id = synth::ui::NodeId("root");
    root.kind = synth::ui::NodeKind::Root; root.bounds = {0,0,400,300};
    tree.nodes.push_back(root);
    Require(!FindNode(synth::browser::DecodeNodeTree(
                          synth::browser::EncodeNodeTree(tree)), "root").color.has_value(),
            "an absent colour decodes as absent, not as a sentinel value");
}

static void TestMovingAParentChangesOnlyTheParentRecord()
{
    const auto at = [](float parentY) {
        synth::ui::NodeTree t;
        synth::ui::Node r; r.id = synth::ui::NodeId("root");
        r.kind = synth::ui::NodeKind::Root; r.bounds = {0,0,400,300};
        r.children.push_back(synth::ui::NodeId("parent"));
        synth::ui::Node p; p.id = synth::ui::NodeId("parent");
        p.kind = synth::ui::NodeKind::Section; p.bounds = {0,parentY,400,100};
        p.children.push_back(synth::ui::NodeId("child"));
        synth::ui::Node c; c.id = synth::ui::NodeId("child");
        c.kind = synth::ui::NodeKind::Label; c.bounds = {4,4,80,20};
        t.nodes.push_back(r); t.nodes.push_back(p); t.nodes.push_back(c);
        return synth::browser::DecodeNodeTree(synth::browser::EncodeNodeTree(t));
    };
    const auto a = at(0.0f), b = at(50.0f);
    Require(std::memcmp(&FindNode(a,"child").bounds, &FindNode(b,"child").bounds,
                        sizeof(synth::ui::Bounds)) == 0,
            "moving a parent leaves every descendant's serialized bounds byte-identical");
    Require(FindNode(a,"parent").bounds.y != FindNode(b,"parent").bounds.y,
            "only the moved parent's record differs");
}

static void TestVariantCarriesNoAppearanceStrings()
{
    for (const char* s : {"danger", "primary", "muted", "muted-title"}) {
        Require(!synth::ui::IsResidualVariant(s),
                std::string("appearance variant '") + s + "' is no longer valid");
    }
    Require(synth::ui::IsResidualVariant("list-row"),
            "the interaction-semantics residual survives");
}
```

- [ ] **Step 5: Run to verify they fail, then implement the v2 encoding**

Run: `make -C projects/synth browser-unit-test 2>&1 | tail -20`

Set `kCommandBufferVersion = 2` and `COMMAND_BUFFER_VERSION = 2`. Keep the strict equality checks (`BrowserCommandBuffer.hpp:503`, `protocol.ts:103`) exactly as they are — no fallback branch, no negotiation. **v1 has no presence encoding for optional fields** (`DrawCommand::color` is raw RGBA at `:173-178`), so encode `color` and `textStyle` each as one presence byte followed by the payload when present. Do not use a sentinel colour for "absent". Mirror in `protocol.ts`. Encode the OQ1 decision.

- [ ] **Step 6: Bump every remaining version site**

```bash
grep -rn "synth_browser_ui_protocol_version" projects/synth/ --include="*.cpp" --include="*.ts" --include="*.mjs" --include="*.hpp" | grep -v "/build/"
```

**Three artifacts advertise the version, not two.** Bumping only the buffer constants ships a v2 shell that rejects every v2 package, because packages independently export `synth_browser_ui_protocol_version()`. Change the real export in `BrowserRuntimeAbi.cpp:19-22`, the assertion in `browser_runtime_contract_tests.cpp:890`, and all six stubs. Refresh any package/catalog metadata and `catalog-schema-v1.md` wording naming the version.

Add to `projects/synth/browser/tests/package-contract.test.mjs` (or the nearest package-contract suite) an assertion that **both real first-party packages** export a UI protocol version equal to the shell's `COMMAND_BUFFER_VERSION`, so a stale package cannot reach publication.

- [ ] **Step 7: Run every affected suite**

Run: `make -C projects/synth test 2>&1 | tail -20`
Run: `make -C projects/synth browser-unit-test 2>&1 | tail -20`
Run: `make -C projects/synth/browser test 2>&1 | tail -30`
Expected: PASS. A version-mismatch test must still fail loudly with an explicit version error and render no frame.

- [ ] **Step 8: Commit**

```bash
git add projects/synth/include/synth/PortableUI.hpp projects/synth/include/synth/browser/BrowserCommandBuffer.hpp projects/synth/browser/ projects/synth/tests/ openspec/changes/rebuild-portable-ui-component-library/design.md
git commit -m "feat(portable-ui)!: fix the v2 model semantics and bump the wire and package ABI (sru-46)"
```

---

## Task 4: Producer coordinate migration — all Draw geometry and the File page

**OpenSpec:** 3.4, 3.4a, 3.10 · **Requirements:** sru-46

**Files:**
- Modify: `projects/synth/include/synth/PortableUIBuilders.hpp:162-223` (`BuildScopeWaveformCommands`), `:225-268` (`ScopeVisualizer`)
- Modify: `apps/braid-4/Braid4Draw.hpp`, `apps/miniapp/MiniAppDraw.hpp`, `include/synth/EncoderDraw.hpp`, visualizer sources
- Modify: `projects/synth/include/synth/RuntimePages.hpp:698-750` (File page nested browser rows)
- Test: `tests/portable_ui_tests.cpp`, `juce/PortableDrawGeometryTests.cpp`, `tests/braid4_system_tests.cpp`, `tests/miniapp_system_tests.cpp`

**Interfaces:**
- Consumes: the coordinate contract (Task 3), the `DrawFactory` API (Task 2).
- Produces: every `DrawCommand` producer emitting node-local geometry; the File page emitting parent-relative nested node bounds.

**First of the three ordering-constraint tasks.** All of it must land before Tasks 7-8.

- [ ] **Step 1: Write the failing node-local emission tests**

```cpp
static void TestScopeWaveformCommandsAreNodeLocal()
{
    const synth::ui::Bounds atOrigin{0,0,100,60}, offset{250,180,100,60};
    const auto a = synth::ui::BuildScopeWaveformCommands({}, atOrigin, -1.0f, 1.0f, 64, true);
    const auto b = synth::ui::BuildScopeWaveformCommands({}, offset, -1.0f, 1.0f, 64, true);
    Require(a.size() == b.size(), "the same node extent yields the same command count");
    for (std::size_t i = 0; i < a.size(); ++i) {
        Require(std::memcmp(&a[i].bounds, &b[i].bounds, sizeof(synth::ui::Bounds)) == 0,
                "draw geometry is node-local: identical extents at different "
                "positions produce byte-identical commands");
    }
}

static void TestEncoderDrawIsPositionIndependent()
{
    const auto state = RepresentativeEncoderState();
    const auto a = synth::BuildEncoderDrawCommands(state, {0,0,90,90});
    const auto b = synth::BuildEncoderDrawCommands(state, {300,200,90,90});
    for (std::size_t i = 0; i < a.size(); ++i) {
        Require(std::memcmp(&a[i].bounds, &b[i].bounds, sizeof(synth::ui::Bounds)) == 0,
                "encoder draw commands are identical regardless of node position");
    }
}
```

Use the real entry-point name from `EncoderDraw.hpp`.

- [ ] **Step 2: Run to verify they fail, then migrate `BuildScopeWaveformCommands`**

Run: `make -C projects/synth test 2>&1 | tail -20`

The function today offsets by `nodeBounds.x/y` (`:174-179`). Compute against the node's own box instead — the parameter keeps only its **extent**, so rename it to `nodeExtent`:

```cpp
    commands.push_back(DrawCommand::Fill({0.0f, 0.0f, nodeExtent.width, nodeExtent.height},
                                         Color::Rgb(12, 14, 16)));
    Bounds bounds{
        x_Inset, x_Inset,
        std::max(0.0f, nodeExtent.width  - x_Inset * 2.0f),
        std::max(0.0f, nodeExtent.height - x_Inset * 2.0f),
    };
```

Everything after that is already relative to `bounds`, so nothing else in the body changes.

- [ ] **Step 3: Sweep every other DrawCommand producer**

```bash
grep -rn "DrawCommand::" projects/synth --include="*.hpp" --include="*.cpp" | grep -v "/build/" | grep -v "PortableUI.hpp"
```

Work through every construction site. Convert any that offsets by a node origin or draws against `GetBounds()`. Expect: `BuildScopeWaveformCommands` (done), `Visualizer` subclasses — the base class keeps `SetBounds` for **placement** but `DrawVisible()` output becomes origin-based — and the miniapp and Braid encoder drawing. **Record every call site you inspected and its verdict in the commit message**, so the sweep's completeness is auditable (design.md OQ6).

For any producer relying on drawing beyond its node box: under v2 content clips to node bounds, so overdraw is now lost. **Grow that node's bounds** or redesign the drawing. Do not add a clipping exception.

Drawn pixels *within* each node must be identical — this is a re-expression, not a redesign.

- [ ] **Step 4: Convert the File page's nested browser rows**

Read `RuntimePages.hpp:679-750`. Its nested browser rows carry surface-absolute bounds and survive today only because `ExplicitBoundsAreParentLocal` rescues them. Subtract the parent's origin at the construction site. This is a **coordinate-only** change — leave the page's hand-rolled node assembly exactly as it is; Task 12 rebuilds it.

Confirm no other producer has the same problem:

```bash
grep -rn "ExplicitBoundsAreParentLocal\|explicitBoundsAreParentLocal" projects/synth/ | grep -v "/build/"
```

Then verify each producer emitting nested children with explicit bounds is already parent-local. `ControllersPageUI.hpp:2417-2420` already is; Sync and Audio emit flat children under an origin-zero root, so both spaces coincide for them.

- [ ] **Step 5: Run every suite**

Run: `make -C projects/synth test 2>&1 | tail -30`
Run: `make -C projects/synth/apps/miniapp test 2>&1 | tail -30`
Expected: PASS. Position pins fail where geometry intentionally moved — **re-pin to node-local and parent-relative values, never loosen.** A *drawn-content* assertion failing means the migration changed pixels: fix the migration, not the assertion.

- [ ] **Step 6: Commit**

```bash
git add projects/synth/include/synth/ projects/synth/apps/ projects/synth/tests/ projects/synth/juce/PortableDrawGeometryTests.cpp
git commit -m "refactor(portable-ui)!: emit node-local draw geometry and parent-relative File page bounds (sru-46)"
```

---

## Task 5: Shell composition places subtree roots

**OpenSpec:** 3.13 · **Requirements:** MODIFIED sprs-2

**Files:**
- Modify: `projects/synth/include/synth/RuntimeMainComponent.hpp` (the per-descendant translation at ~117-121)
- Test: `projects/synth/juce/RuntimeShellSessionTests.cpp`, `tests/runtime_main_component_tests.cpp`

**Interfaces:**
- Consumes: parent-relative bounds (Task 3), converted producers (Task 4).
- Produces: shell composition that places a subtree's root and lets descendants follow.

**Second ordering-constraint task.** The current loop adds the sidebar offset to *every* sidebar node. Under parent-relative semantics the sidebar root already carries it, so leaving the loop double-offsets every descendant. **Must land before Tasks 7-8.**

- [ ] **Step 0: Drop the surface-space origin terms from root-level page producers**

Found during Task 4's review, and it must land before Tasks 7-8 because it is part of
the "no producer left needing rescue" premise those deletions depend on.

`ControllersPageUI.hpp:2326-2327` computes `y = area.y + kPageMargin` and
`contentX = area.x + kPageMargin`; `BuildSyncPageTree` and `BuildAudioPageTree` do the
same (`RuntimePages.hpp:452,558`). Every root-level child then re-adds the root's own
origin. This is invisible in the shell, which always passes an origin-zero area
(`RuntimeMainComponent.hpp:65-70`) — but `ControllersHarnessApp.cpp:66-71` passes an
area after `removeFromTop(6)`, so `area.y == 6` and the entire page shifts down 6px
once translation is strictly parent-relative.

Drop the `area.x` / `area.y` terms so these producers emit root-relative coordinates,
one line per page. Then add a test that builds one of these pages against a
**non-origin-zero** area and asserts a root-level child's bounds are unchanged from the
origin-zero case — that is the assertion that would have caught this.

Run: `make -C projects/synth test 2>&1 | tail -20`
Expected: PASS, with the new non-origin-zero case failing before the fix.

- [ ] **Step 1: Write the failing test**

```cpp
static void TestPlacingASubtreeRootPlacesEveryDescendant()
{
    const synth::ui::NodeTree composite = BuildCompositeTree(900.0f, 560.0f);
    Require(NearlyEqual(FindNode(composite, "root").bounds.width, 996.0f),
            "runtime chrome is additive: 900 + 96");
    Require(NearlyEqual(FindNode(composite, "runtime.sidebar").bounds.x, 900.0f),
            "the sidebar root sits at x 900 relative to the composite root");
    for (const synth::ui::Node& node : composite.nodes) {
        if (IsSidebarDescendant(composite, node.id)) {
            Require(node.bounds.x < 96.0f,
                    "every sidebar descendant carries coordinates relative to its own "
                    "parent, never translated into the 900-996 band");
        }
    }
}

static void TestSubtreesArriveFullyResolved()
{
    const synth::ui::NodeTree composite = BuildCompositeTree(900.0f, 560.0f);
    for (const synth::ui::Node& node : composite.nodes) {
        if (node.kind == synth::ui::NodeKind::Root) { continue; }
        Require(node.bounds.width > 0.0f || IsDeliberatelyZeroExtent(node),
                "every node arrives laid out by the library, not by a backend");
    }
}
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `make -C projects/synth test 2>&1 | tail -20`

Replace the per-descendant translation with placing each subtree's root: the app subtree root stays at 0,0 with the app's declared dimensions; the sidebar root goes to x = app width. Descendants are untouched.

**Do not wrap or rebuild existing trees through `Builder`.** The pages and sidebar hand-place explicit bounds and do not go through `Builder` at all; Tasks 11-13 migrate them. So MODIFIED sprs-2's "every subtree arrives fully laid out" is satisfied trivially today — producers set their own bounds — and only becomes load-bearing once those producers move to the library. Wrapping hand-built trees here would be scope creep that collides with Tasks 11-13.

- [ ] **Step 3: Run and re-pin**

Run: `make -C projects/synth test 2>&1 | tail -30`
Run: `make -C projects/synth/apps/miniapp test 2>&1 | tail -40`
Expected: PASS. `RuntimeShellSessionTests.cpp` expectations move from surface space to parent-relative space — re-pin them.

- [ ] **Step 4: Commit**

```bash
git add projects/synth/include/synth/RuntimeMainComponent.hpp projects/synth/juce/RuntimeShellSessionTests.cpp projects/synth/tests/runtime_main_component_tests.cpp
git commit -m "refactor(shell): place subtree roots instead of translating descendants (sprs-2)"
```

---

## Task 6: The standard application layout and both app rebuilds

**OpenSpec:** 3.14, 3.15, 3.16, 4.7 · **Requirements:** sru-53, sru-50, sru-21

**Files:**
- Create: `projects/synth/include/synth/PortableUIStandardLayout.hpp`
- Modify: `apps/braid-4/Braid4UI.hpp`, `Braid4UiModel.hpp` (retire `Braid4PageLayout` 90-170, `Braid4EncoderGridLayout`)
- Modify: `apps/miniapp/MiniAppUI.hpp`, `MiniAppUiModel.hpp` (retire `MiniAppPageLayout` 96-165, `EncoderGridLayout`)
- Test: `tests/portable_ui_layout_tests.cpp`, `braid4_system_tests.cpp`, `miniapp_system_tests.cpp`, `juce/MiniAppJuceBackendParityTests.cpp`

**Interfaces:**
- Consumes: the resolver with fractional extents and min/max clamps and the in-flow `DrawFactory` (Task 2), node-local app geometry (Task 4).
- Produces: `StandardAppLayout` with node ids `<prefix>.title`, `.body`, `.visualizers`, `.slot.upper`, `.slot.lower`, `.encoders`, `.bay`. Task 14's assertions reference these — **do not rename them.**

**Two known residuals from Task 2's resolver that this task is the likely first consumer of.** Neither is a regression; both were reviewed and deliberately deferred. (a) `IntrinsicFromExtent` does not thread `knownCrossExtent` through nested intrinsic measurement, so a wrapping row measured from *two* levels up — an intrinsically-sized column containing it — is measured at its unwrapped natural width and the grandparent under-reserves. If the widget bay wraps its controls inside an intrinsic column, you will hit this; fix it in the resolver rather than working around it here. (b) `IntrinsicForWrappingRow`'s line-break computation is correct but pinned only by a relational assertion, so a wrong line break would go undetected — if you rely on wrap, add an assertion pinning the row's computed multi-line height.

**Third ordering-constraint task, and the reason it exists:** both apps append unbounded controls beneath `Root` that only the auto-flow cursor positions. Compilation shims preserve signatures, not layout. **Must land before Tasks 7-8.**

**Decided (design.md D10a, closing OQ4):** visualizer stack on the **left**, encoders to its right, in both apps — not mirrored. **Both** apps populate the widget bay, which is the declared home for every semantic control outside the slots and encoder region. The bay stays structurally optional (unsupplied → collapses). **Encoder frame behaviour is unchanged in both apps** — `EncoderDrawState::wantsFrame` already defaults to `true` and Braid leaves it true; the earlier proposal to "adopt Mini App's treatment" rested on a false premise and would have *removed* Braid frames.

**Proportions** from the arithmetic both apps already share (`MiniAppUiModel.hpp:96-165`, `Braid4UiModel.hpp:90-170`): margin 16, title 30, gap 14, stack `min(390, contentWidth * 0.46)`, encoders `min(462, remainder)`. Express as `Extent::Fraction(0.46f).Max(390.0f)` and `Extent::Weight(1.0f).Max(462.0f)` — **never** with arithmetic inside the layout. A plain weight is not a substitute: `width * 0.46` is a fraction of *content* width, while a weight divides only what is *left* after gaps. If the layout needs arithmetic of its own, the resolver is wrong (design.md D10a).

- [ ] **Step 1: Write the failing layout tests**

```cpp
static void TestSlotsAcceptArbitraryComponents()
{
    const auto fill = [](const char* id) {
        return [id](synth::ui::Builder& b) {
            b.Draw(id, LayoutMain(synth::ui::Extent::Weight(1.0f)),
                   [](synth::ui::Bounds e){ return std::vector<synth::ui::DrawCommand>{
                       synth::ui::DrawCommand::Fill(e, synth::Color::Rgb(1,1,1))}; });
        };
    };
    const auto grid = [&fill](synth::ui::Builder& b) {
        b.Row("cells", {}, [&fill](synth::ui::Builder& b) { fill("cell0")(b); fill("cell1")(b); });
    };
    for (const auto& upper : {synth::ui::Builder::Children(grid),
                              synth::ui::Builder::Children(fill("wave"))}) {
        const auto tree = BuildStandardLayout(900.0f, 560.0f, upper);
        Require(FindNode(tree, "app.slot.upper").bounds.width > 0.0f,
                "the upper slot resolves whatever component it is given");
    }
    Require(!SourceContains("projects/synth/include/synth/PortableUIStandardLayout.hpp", "cellCount"),
            "the standard layout contains no grid, cell-count, or content-kind logic");
}

static void TestStandardLayoutProportionsMatchBothApps()
{
    const auto tree = BuildStandardLayoutAt(900.0f, 560.0f);
    // contentWidth = 900 - 2*16 = 868; 868 * 0.46 = 399.28, capped at 390.
    Require(NearlyEqual(FindNode(tree,"app.visualizers").bounds.width, 390.0f),
            "the visualizer stack takes min(390, contentWidth * 0.46)");
    Require(NearlyEqual(FindNode(tree,"app.encoders").bounds.width, 462.0f),
            "the encoder region takes min(462, remainder)");
    Require(NearlyEqual(FindNode(tree,"app.title").bounds.height, 30.0f),
            "the title row is 30 high");
    Require(FindNode(tree,"app.visualizers").bounds.x < FindNode(tree,"app.encoders").bounds.x,
            "the visualizer stack is on the LEFT, encoders to its right");
}

static void TestEmptyWidgetBayCollapses()
{
    const auto with = BuildStandardLayoutWithBay(), without = BuildStandardLayoutWithoutBay();
    Require(NearlyEqual(FindNode(without,"app.bay").bounds.height, 0.0f),
            "an unsupplied widget bay occupies no space and renders no chrome");
    Require(FindNode(without,"app.visualizers").bounds.height
                > FindNode(with,"app.visualizers").bounds.height,
            "the regions above take the collapsed bay's extent");
}

static void TestStandardLayoutRedistributesAtDifferentExtents()
{
    const auto narrow = BuildStandardLayoutAt(700.0f, 560.0f);
    const auto wide   = BuildStandardLayoutAt(1400.0f, 560.0f);
    Require(FindNode(wide,"app.encoders").bounds.width
                >= FindNode(narrow,"app.encoders").bounds.width,
            "regions redistribute through the ordinary resolver at a wider extent");
    Require(NearlyEqual(FindNode(wide,"app.visualizers").bounds.width, 390.0f),
            "the capped stack stays at its maximum inside a real composition");
}
```

- [ ] **Step 2: Run to verify they fail, then implement the layout**

Run: `make -C projects/synth test 2>&1 | tail -20`

Create `PortableUIStandardLayout.hpp` with `StandardAppLayout` exactly as in Shared Interfaces. `Emit` composes ordinary containers and **nothing else** — no grid, cell-count, visualizer, or encoder logic. An empty slot still resolves; an empty `widgetBay` declares `Extent::Px(0.0f)`.

- [ ] **Step 3: Write the failing app-composition tests**

```cpp
static void TestBothAppsComposeTheStandardLayout()
{
    for (const auto& [tree, prefix] : {std::pair{BuildBraid4Tree(900,560), std::string("braid4")},
                                       std::pair{BuildMiniAppTree(900,560), std::string("miniapp")}}) {
        for (const char* suffix : {".title", ".slot.upper", ".slot.lower", ".encoders", ".bay"}) {
            Require(HasNode(tree, prefix + suffix), "region '" + prefix + suffix + "' exists");
        }
    }
    Require(!SourceContains("projects/synth/apps/braid-4/Braid4UiModel.hpp", "ScopeStackArea"),
            "Braid4PageLayout's surface-level arithmetic is retired");
    Require(!SourceContains("projects/synth/apps/miniapp/MiniAppUiModel.hpp", "ScopeStackArea"),
            "MiniAppPageLayout's surface-level arithmetic is retired");
}

static void TestEveryBraid4ControlHasARegion()
{
    const auto tree = BuildBraid4Tree(900.0f, 560.0f);
    for (const char* id : {Braid4NodeIds::kBankBraid, Braid4NodeIds::kBankMatrix,
                           Braid4NodeIds::kBankLfo, Braid4NodeIds::kBankLfoMatrix,
                           Braid4NodeIds::kSceneBlend}) {
        Require(IsDescendantOf(tree, id, "braid4.bay"),
                std::string("control '") + id + "' resolves inside the widget bay");
    }
}

static void TestEveryMiniAppControlHasARegion()
{
    const auto tree = BuildMiniAppTree(900.0f, 560.0f);
    const std::vector<std::string> controls = {
        MiniAppNodeIds::kBankVco, MiniAppNodeIds::kBankLfo, MiniAppNodeIds::kGestureToggle,
        MiniAppNodeIds::kReset, MiniAppNodeIds::kRandom, MiniAppNodeIds::kRandomMod,
        MiniAppNodeIds::kStart, MiniAppNodeIds::kStop,
        MiniAppNodeIds::kGestureValue, MiniAppNodeIds::kSceneBlend,
    };
    for (const auto& id : controls) {
        Require(IsDescendantOf(tree, id, "miniapp.bay"),
                "control '" + id + "' resolves inside the widget bay");
    }
    Require(NoTwoNodesOverlap(tree, controls), "no two app-supplied controls overlap");
    Require(FindNode(tree,"miniapp.bay").bounds.height > 0.0f,
            "Mini App now has a populated widget bay it did not have before");
}

static void TestEveryScopeStaysIndividuallyBounded()
{
    // sru-21: every scope remains individually addressable and independently
    // bounded. The grid is an app-side component; the layout knows nothing of it.
    const auto tree = BuildBraid4Tree(900.0f, 560.0f);
    const auto scopes = ScopeNodeIdsOf(tree);
    Require(!scopes.empty(), "the tree has scope nodes");
    for (const auto& id : scopes) {
        const auto b = FindNode(tree, id).bounds;
        Require(b.width > 0.0f && b.height > 0.0f, "scope '" + id + "' is independently bounded");
    }
    Require(NoTwoNodesOverlap(tree, scopes), "no two scopes overlap");
}
```

- [ ] **Step 4: Rebuild both apps**

Compose `StandardAppLayout` in `Braid4UI.hpp` and `MiniAppUI.hpp`, passing app-side component callables into each slot and region. Scope grids and encoder regions use Task 2's in-flow `DrawFactory` so they fill whatever extent the slot resolves to.

- **Braid 4** — VCO scope cells → upper slot; LFO scope cells → lower slot; sixteen encoders → encoder region; **four bank buttons + scene buttons + scene-blend slider → widget bay**.
- **Mini App** — waveform components → visualizer slots; sixteen encoders → encoder region; **two bank buttons + four toggles + scene buttons + Start/Stop + two sliders → widget bay**. Mini App's stack no longer runs full height; deliberate, re-baselined in Task 15.

Retire `Braid4PageLayout`, `Braid4EncoderGridLayout`, `MiniAppPageLayout`, and `EncoderGridLayout`'s surface-level position arithmetic. Within-cell drawing geometry stays app-owned. **Do not touch `wantsFrame` in either app.**

- [ ] **Step 5: Run every app suite**

Run: `make -C projects/synth test 2>&1 | tail -40`
Run: `make -C projects/synth/apps/miniapp test 2>&1 | tail -40`
Expected: PASS. `miniapp_system_tests.cpp`, `braid4_system_tests.cpp`, and `MiniAppJuceBackendParityTests.cpp` stay green **on behavior**; positions change deliberately (design.md D10 — these controls had no authored layout before) and are re-pinned here, re-baselined in Task 15.

- [ ] **Step 6: Commit**

```bash
git add projects/synth/include/synth/PortableUIStandardLayout.hpp projects/synth/apps/ projects/synth/tests/ projects/synth/juce/MiniAppJuceBackendParityTests.cpp
git commit -m "feat(apps): add the standard application layout and rebuild both apps on it (sru-53)"
```

---

## Task 7: The JUCE backend becomes a dumb renderer

**OpenSpec:** 3.5, 3.6, 3.7 · **Requirements:** sru-45, sru-46, sru-49, MODIFIED sprs-9

**Files:**
- Modify: `projects/synth/juce/PortableJuceBackend.hpp` — delete 65-130 (the `LooksLocal` family), the `nodeLocal` threading through ~15 sites in `PaintDrawCommand` (143-266), `commandsAreNodeLocal_` (503), `ExplicitBoundsAreParentLocal` (836-847) and its conditional at 825, `FlowCursor` (346-347), `DefaultSizeForNode` (590), `kControlMargin`/`kControlGap`, the lowest-`Draw` starting-y scan (766-780); demote `TextColourForNode`/`ButtonColourForNode` (1119-1158); simplify `m_resolvedByNodeId`, `SemanticHostFor` (850-880), `HostLocalBounds` (881)
- Test: `projects/synth/juce/PortableJuceBackendTests.cpp`, `PortableDrawGeometryTests.cpp`

**Interfaces:**
- Consumes: the coordinate contract (Task 3), converted producers (Tasks 4-6), the per-kind colour table, the `variant` residual (Task 3).
- Produces: a JUCE backend that positions each node at its wire bounds inside its resolved semantic host, paints draw commands untranslated, never flows or sizes, and renders carried appearance.

**Four deletions, not three.** The second — `ExplicitBoundsAreParentLocal` — was missed by the original design. Leaving it in is actively harmful: a legitimately parent-relative child whose bounds exceed its parent's extent (an overhanging overlay, a scroll-content row) would be silently reinterpreted as surface-absolute.

- [ ] **Step 1: Write the failing tests**

```cpp
// Under v1 this child would have been reclassified surface-absolute by
// ExplicitBoundsAreParentLocal, because its bounds do not fit the parent.
// Under v2 there is no classification: it is parent-relative, full stop.
static void TestOverhangingChildIsStillParentRelative()
{
    const auto resolved = RenderAndResolve(MakeTree({
        Root("root", {0,0,400,300}, {"parent"}),
        Section("parent", {50,40,100,50}, {"child"}),
        Label("child", {10,10,200,20}),      // wider than the parent
    }));
    Require(NearlyEqual(SurfaceBoundsOf(resolved,"child").getX(), 60.0f),
            "surface x is the parent's origin plus the child's own bounds, "
            "with no reclassification");
    Require(NearlyEqual(SurfaceBoundsOf(resolved,"child").getY(), 50.0f),
            "and surface y is likewise the simple fold");
}

static void TestNodeWithoutBoundsIsNotRescued()
{
    const auto resolved = RenderAndResolve(MakeTree({
        Root("root", {0,0,400,300}, {"parent"}),
        Section("parent", {50,40,200,100}, {"orphan"}),
        Label("orphan", {0,0,0,0}),
    }));
    const auto b = SurfaceBoundsOf(resolved, "orphan");
    Require(NearlyEqual(b.getX(), 50.0f) && NearlyEqual(b.getY(), 40.0f),
            "a node without resolved bounds renders at its parent's origin");
    Require(b.getWidth() == 0 && b.getHeight() == 0,
            "with zero-based extent, never flowed or sized by the backend");
}

static void TestCarriedColourBeatsTheVariantConstant()
{
    auto button = Button("styled", {0,0,80,24});
    button.variant = "primary";                    // the old appearance string
    button.color = synth::Color::Rgb(0, 200, 0);   // the carried value
    const auto r = RenderAndResolve(MakeTree({Root("root",{0,0,400,300},{"styled"}), button}));
    Require(FillColourOf(r,"styled") == juce::Colour::fromRGB(0,200,0),
            "the carried colour decides the button fill, not the variant constant");
}

static void TestGlyphColourComesFromTextStyleNotNodeColour()
{
    auto label = Label("lbl", {0,0,120,20});
    label.color = synth::Color::Rgb(10,10,10);     // the label's BACKGROUND
    label.textStyle = synth::ui::TextStyle{14.0f, synth::Color::Rgb(240,240,240),
                                           synth::ui::TextAlign::Left};
    const auto r = RenderAndResolve(MakeTree({Root("root",{0,0,400,300},{"lbl"}), label}));
    Require(TextColourOf(r,"lbl") == juce::Colour::fromRGB(240,240,240),
            "a label's glyphs take their colour from textStyle, never from node colour");
}

static void TestSelectedIsDerivedFromTheCarriedColour()
{
    auto a = Button("plain", {0,0,80,24});  a.color = synth::Color::Rgb(0,120,0);
    auto b = Button("sel",   {0,0,80,24});  b.color = synth::Color::Rgb(0,120,0); b.selected = true;
    const auto r = RenderAndResolve(MakeTree({Root("root",{0,0,400,300},{"plain","sel"}), a, b}));
    Require(FillColourOf(r,"sel") != FillColourOf(r,"plain"),
            "selected presentation differs from unselected");
    Require(IsDerivedFrom(FillColourOf(r,"sel"), juce::Colour::fromRGB(0,120,0)),
            "and is derived from the carried colour rather than substituted from a palette");
}
```

Implement `FillColourOf`, `TextColourOf`, and `IsDerivedFrom` against whatever the harness already exposes; read the file first.

- [ ] **Step 2: Run to verify they fail**

Run: `make -C projects/synth/apps/miniapp test 2>&1 | tail -20`
Expected: FAIL on all five.

- [ ] **Step 3: Deletion 1 — the draw-geometry classifier**

Remove `DrawBoundsLookLocal`, `DrawPointLooksLocal`, `DrawCommandLooksLocal`, `DrawCommandsLookLocal` (65-130) and `commandsAreNodeLocal_` (503). In `PaintDrawCommand` (143-266), remove the `nodeLocal` parameter from every `ResolveDrawBounds`/`ResolveDrawPoint` call and make both resolve node-local unconditionally — the resolution is now the identity. `RetainedDrawComponent` paints with no translation at all.

- [ ] **Step 4: Deletion 2 — the node-bounds classifier**

Remove `ExplicitBoundsAreParentLocal` (836-847) entirely and make the translation at 825 unconditional:

```cpp
    const juce::Rectangle<int> parentBounds = ResolveExplicitNode(*parentNode, visitState);
    bounds.translate(parentBounds.getX(), parentBounds.getY());
```

Then simplify the bookkeeping: with wire bounds unconditionally parent-relative, a child's position inside its parent **is** the wire datum. `m_resolvedByNodeId`'s surface-bounds bookkeeping reduces to accumulation only where an ancestor is not realized as a component, and `HostLocalBounds`'s subtract-what-we-just-added round trip disappears. Keep the host lookup itself.

- [ ] **Step 5: Deletion 3 — the auto-flow engine**

Remove `FlowCursor`, `DefaultSizeForNode`, `kControlMargin`, `kControlGap`, and the lowest-`Draw` starting-y scan at 766-780. A node whose bounds are all zero renders at its parent's origin with zero extent. **Do not add a fallback.**

- [ ] **Step 6: Deletion 4 — the colour policy**

Implement the per-kind colour meaning table from Shared Interfaces exactly. Derive selected, hover, pressed, and disabled presentation **from the carried colour** (brighten/dim/outline in the backend's own idiom) rather than substituting a palette colour. Demote `TextColourForNode`/`ButtonColourForNode` to the absent-value default only — consulted when `node.color` has no value and never otherwise. Delete the appearance-string branches Task 3 retired, keeping only the residual `variant` branches in `SetSemantics`.

- [ ] **Step 7: Run and re-pin**

Run: `make -C projects/synth/apps/miniapp test 2>&1 | tail -40`
Expected: PASS. Position assertions that encoded classifier or cursor behavior fail — re-pin each to the unconditional parent-relative fold. Never loosen.

- [ ] **Step 8: Verify every deleted symbol is gone**

Run: `grep -nE "LooksLocal|LookLocal|nodeLocal|commandsAreNodeLocal_|ExplicitBoundsAreParentLocal|FlowCursor|DefaultSizeForNode|kControlMargin|kControlGap" projects/synth/juce/PortableJuceBackend.hpp`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add projects/synth/juce/
git commit -m "refactor(juce-backend)!: delete both classifiers, auto-flow, and colour policy (sru-45, sru-46, sru-49)"
```

---

## Task 8: The browser backend becomes a dumb renderer

**OpenSpec:** 3.8 · **Requirements:** sru-45, sru-46, sru-49, MODIFIED sprs-6

**Files:**
- Modify: `projects/synth/browser/src/ui.ts` — delete the draw classifier mirror (465-501) and its sites (295-325), `explicitBoundsAreParentLocal` (382, 440), parent-origin subtraction (101-102) and the `parentBounds` plumbing, the auto-flow (`cursors` 33-34, `defaultSize` 448, `CONTROL_MARGIN`/`CONTROL_GAP`, starting-y scan 395-399)
- Modify: `projects/synth/browser/public/synth-browser.css`
- Test: `projects/synth/browser/tests/ui-backend.spec.ts`

**Interfaces:**
- Consumes: v2 decode (Task 3), the per-kind colour table, the coordinate contract.
- Produces: a browser backend positioning children directly from parent-relative bounds and rendering carried styles. Also emits `data-node-id` and `data-node-kind`, which Task 14's assertions require.

The browser's simplification is the identity: children are already real DOM children of their parent element, and absolutely-positioned DOM children are natively parent-relative. `bounds.x - (parentBounds?.x ?? 0)` at 101-102 becomes `bounds.x`.

- [ ] **Step 1: Write the failing tests**

Match the file's existing helper names and render harness; read it first.

```ts
test("a child's CSS offset is its wire bounds with no parent subtraction", () => {
  const surface = render(treeOf([
    root("root", { x: 0, y: 0, width: 400, height: 300 }, ["parent"]),
    section("parent", { x: 50, y: 40, width: 200, height: 100 }, ["child"]),
    label("child", { x: 10, y: 10, width: 80, height: 20 }),
  ]));
  const child = surface.querySelector('[data-node-id="child"]') as HTMLElement;
  expect(child.style.left).toBe("10px");
  expect(child.style.top).toBe("10px");
});

test("an overhanging child is still parent-relative", () => {
  // explicitBoundsAreParentLocal would have reclassified this as absolute.
  const surface = render(treeOf([
    root("root", { x: 0, y: 0, width: 400, height: 300 }, ["parent"]),
    section("parent", { x: 50, y: 40, width: 100, height: 50 }, ["child"]),
    label("child", { x: 10, y: 10, width: 200, height: 20 }),
  ]));
  expect((surface.querySelector('[data-node-id="child"]') as HTMLElement).style.left).toBe("10px");
});

test("a node without resolved bounds is not flowed", () => {
  const surface = render(treeOf([
    root("root", { x: 0, y: 0, width: 400, height: 300 }, ["parent"]),
    section("parent", { x: 50, y: 40, width: 200, height: 100 }, ["orphan"]),
    label("orphan", { x: 0, y: 0, width: 0, height: 0 }),
  ]));
  const orphan = surface.querySelector('[data-node-id="orphan"]') as HTMLElement;
  expect(orphan.style.left).toBe("0px");
  expect(orphan.style.width).toBe("0px");
});

test("carried colour and text style are rendered per the per-kind table", () => {
  const surface = render(treeOf([
    root("root", { x: 0, y: 0, width: 400, height: 300 }, ["btn", "lbl"]),
    button("btn", { x: 0, y: 0, width: 80, height: 24 },
           { color: { r: 0, g: 200, b: 0, a: 255 } }),
    label("lbl", { x: 0, y: 40, width: 120, height: 20 }, {
      color: { r: 10, g: 10, b: 10, a: 255 },
      textStyle: { size: 14, color: { r: 240, g: 240, b: 240, a: 255 }, align: "left" },
    }),
  ]));
  const btn = surface.querySelector('[data-node-id="btn"]') as HTMLElement;
  const lbl = surface.querySelector('[data-node-id="lbl"]') as HTMLElement;
  expect(getComputedStyle(btn).backgroundColor).toBe("rgb(0, 200, 0)");
  // The label's node colour backs it; its glyphs come from textStyle.
  expect(getComputedStyle(lbl).backgroundColor).toBe("rgb(10, 10, 10)");
  expect(getComputedStyle(lbl).color).toBe("rgb(240, 240, 240)");
});
```

- [ ] **Step 2: Run to verify they fail, then delete both classifiers and the subtraction**

Run: `make -C projects/synth/browser test 2>&1 | tail -20`

Delete the draw classifier mirror (465-501) and its sites (295-325); paint canvases node-local. Delete `explicitBoundsAreParentLocal` (382, 440) and its conditional. Replace `bounds.x - (parentBounds?.x ?? 0)` with `bounds.x` and remove the `parentBounds` parameter from every function that only threaded it.

- [ ] **Step 3: Delete the auto-flow**

Remove `cursors` (33-34), `defaultSize` (448), `CONTROL_MARGIN`, `CONTROL_GAP`, and the starting-y scan (395-399). Position every child directly from its parent-relative bounds; a zero-bounds node gets `left: 0; top: 0; width: 0; height: 0`.

- [ ] **Step 4: Render carried styles and emit test attributes**

Apply the per-kind colour table via inline styles or per-node CSS custom properties. Glyph colour from `textStyle.color`; node `color` never recolours glyphs. Derive `:hover`, `:active`, selected, and disabled from the carried colour. Update `synth-browser.css` so the flat per-kind look is the absent-value default rather than the sole styling.

Emit `data-node-id` and `data-node-kind` on every rendered element — Task 14's structural assertions require them.

Leave `surfaceScale` (278-287) and its pointer-delta division (176-177) **exactly** as they are.

- [ ] **Step 5: Run every browser suite**

Run: `make -C projects/synth browser-unit-test 2>&1 | tail -20`
Run: `make -C projects/synth/browser test 2>&1 | tail -40`
Expected: PASS. Re-pin position assertions; never loosen.

- [ ] **Step 6: Verify every deleted symbol is gone**

Run: `grep -nE "LooksLocal|explicitBoundsAreParentLocal|cursors|defaultSize|CONTROL_MARGIN|CONTROL_GAP|parentBounds" projects/synth/browser/src/ui.ts`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add projects/synth/browser/src/ui.ts projects/synth/browser/public/synth-browser.css projects/synth/browser/tests/ui-backend.spec.ts
git commit -m "refactor(browser-backend)!: delete classifiers, auto-flow, and flat styling (sru-45, sru-46, sru-49)"
```

---

## Task 9: Backend geometry property, parity, and re-pinning sprs-6/sprs-9

**OpenSpec:** 3.9, 3.11, 3.12, 4.2 · **Requirements:** sru-49, sru-50, MODIFIED sprs-6, MODIFIED sprs-9

**Files:**
- Modify: `projects/synth/juce/PortableDrawGeometryTests.cpp`, `MiniAppJuceBackendParityTests.cpp`
- Modify: `projects/synth/browser/tests/ui-backend.spec.ts`
- Modify: every suite asserting the retired sprs-6/sprs-9 behavior

**Interfaces:**
- Consumes: both rebuilt backends (Tasks 7-8).
- Produces: the sru-49 geometry property test in each backend suite, and a cross-backend parity assertion.

- [ ] **Step 1: Write the geometry property test in each backend suite**

The property: for **every** node of a representative rendered tree, rendered position equals the node's wire bounds folded over its ancestor origins, plus scroll offset and surface scale where applicable. Nothing else contributes.

```cpp
static void TestEveryNodePositionIsDerivableFromTheTreeAlone()
{
    // Representative: root, sections, rows, a scroll area, draw nodes, leaves,
    // and the no-bounds-not-rescued case from Tasks 7-8.
    const synth::ui::NodeTree tree = RepresentativeTree();
    const auto resolved = RenderAndResolve(tree);
    for (const synth::ui::Node& node : tree.nodes) {
        const juce::Point<float> expected = FoldAncestorOrigins(tree, node.id);
        const juce::Rectangle<int> actual = SurfaceBoundsOf(resolved, node.id.value);
        Require(NearlyEqual(static_cast<float>(actual.getX()), expected.x)
                    && NearlyEqual(static_cast<float>(actual.getY()), expected.y),
                "node '" + node.id.value + "' renders exactly at the fold of its "
                "ancestor origins over its own wire bounds");
    }
}
```

`FoldAncestorOrigins` walks from the root summing `bounds.x`/`bounds.y`, adding the scroll offset for a `ScrollArea` ancestor. Write the DOM equivalent in `ui-backend.spec.ts` using `getBoundingClientRect()` against the surface root's rect.

- [ ] **Step 2: Write the cross-backend parity assertion**

Extend `MiniAppJuceBackendParityTests.cpp` so the same tree with the same carried styles yields the same colour and text-style assignments **and** the same resolved geometry in JUCE and Chrome. Geometry parity is now trivially true — neither backend computes it — which is the point: assert it so a regression that reintroduces backend computation fails here.

- [ ] **Step 3: Re-pin the retired sprs-6 and sprs-9 assertions**

```bash
grep -rn "auto-flow\|autoflow\|surface-absolute\|LooksLocal\|absolute surface" projects/synth/juce projects/synth/browser/tests projects/synth/tests | grep -v "/build/"
```

Every suite asserting that the browser treats bounds as absolute surface coordinates, that unbounded controls resolve within their nearest nested root, that host height includes flowed content, that unbounded labels expand for their content, or that the `LooksLocal` draw rule holds, asserts behavior the **restated** sprs-6 and sprs-9 no longer require. Re-pin each. Read `openspec/changes/rebuild-portable-ui-component-library/specs/synth-portable-runtime-shell/spec.md` for exactly what each now says.

- [ ] **Step 4: Confirm resizing was not implemented**

Task 6 already asserts region redistribution at two extents. Additionally verify `surfaceScale` and host resize handling are untouched:

Run: `git diff main -- projects/synth/browser/src/ui.ts | grep -n "surfaceScale"`
Expected: no output. This change establishes the property; it does not implement window resizing.

- [ ] **Step 5: Run everything and commit**

Run: `make -C projects/synth test 2>&1 | tail -30`
Run: `make -C projects/synth/browser test 2>&1 | tail -40`
Run: `make -C projects/synth/apps/miniapp test 2>&1 | tail -40`
Expected: PASS.

```bash
git add projects/synth/juce/ projects/synth/browser/tests/ projects/synth/tests/
git commit -m "test(portable-ui): pin backend geometry as derivable from the tree alone (sru-49, sprs-6, sprs-9)"
```

---

## Task 10: Draw node click dispatch

**OpenSpec:** 4.3 · **Requirements:** sru-52

**Files:**
- Modify: `projects/synth/juce/PortableJuceBackend.hpp` (`RetainedDrawComponent`, `setInterceptsMouseClicks` ~506)
- Modify: `projects/synth/browser/src/ui.ts` (the `click` listener ~132)
- Test: `projects/synth/juce/PortableJuceBackendTests.cpp`, `projects/synth/browser/tests/ui-backend.spec.ts`

**Interfaces:**
- Consumes: `ControlStyle::action` (Task 1), both rebuilt backends (Tasks 7-8).
- Produces: `Draw` nodes dispatching a plain click in both backends.

`Node::action` already crosses the wire on every node; no backend reads it for `NodeKind::Draw`. The browser fix is one listener — `acceptsPointerEvents` (`ui.ts:503`) already lets a `Draw` node with an action through. JUCE derives the click from its existing drag bookkeeping.

**The double-click contract is parity with `Button`, not a literal count.** The browser attaches separate `click` and `dblclick` listeners so a native double-click delivers **two** click events before `dblclick`, while JUCE's mouse-up-derived click orders differently around `mouseDoubleClick`. Asserting a guessed number would be worse than deferring to the established behavior.

- [ ] **Step 1: Write the failing tests**

```cpp
static void TestDrawClickOnlyDispatchesOnce()
{
    auto n = DrawNode("canvas", {0,0,100,100});
    n.action = synth::ui::Action::Named("canvas.click");
    Require(SimulateClick(RenderAndResolve(TreeWith(n)), "canvas")
                == std::vector<std::string>{"canvas.click"},
            "a click-only Draw node dispatches exactly once on a single click");
}

static void TestDragDispatchesNoClick()
{
    auto n = DrawNode("canvas", {0,0,100,100});
    n.action = synth::ui::Action::Named("canvas.click");
    n.pointerDragAction = synth::ui::Action::Named("canvas.drag");
    const auto d = SimulateDragPastThreshold(RenderAndResolve(TreeWith(n)), "canvas");
    Require(std::find(d.begin(), d.end(), "canvas.click") == d.end(),
            "a drag past the threshold dispatches no click");
}

static void TestDisabledDrawDispatchesNothing()
{
    auto n = DrawNode("canvas", {0,0,100,100});
    n.action = synth::ui::Action::Named("canvas.click");
    n.enabled = false;
    Require(SimulateClick(RenderAndResolve(TreeWith(n)), "canvas").empty(),
            "a disabled Draw node dispatches nothing");
}

static void TestInertDrawInterceptsNothing()
{
    // sru-25: translucent visualizer underlays must keep passing clicks
    // through to the encoders above them.
    auto underlay = DrawNode("underlay", {0,0,100,100});   // no actions at all
    auto encoder  = DrawNode("encoder",  {0,0,100,100});
    encoder.action = synth::ui::Action::Named("encoder.click");
    Require(SimulateClick(RenderAndResolve(TreeWith(underlay, encoder)), "underlay")
                == std::vector<std::string>{"encoder.click"},
            "an inert Draw node intercepts no pointer input");
}

static void TestDoubleClickSequenceMatchesButtonExactly()
{
    auto d = DrawNode("canvas", {0,0,100,100});
    d.action = synth::ui::Action::Named("click");
    d.doubleClickAction = synth::ui::Action::Named("dbl");
    auto b = ButtonNode("btn", {0,0,100,100});
    b.action = synth::ui::Action::Named("click");
    b.doubleClickAction = synth::ui::Action::Named("dbl");

    const auto fromDraw   = SimulateDoubleClick(RenderAndResolve(TreeWith(d)), "canvas");
    const auto fromButton = SimulateDoubleClick(RenderAndResolve(TreeWith(b)), "btn");
    Require(fromDraw == fromButton,
            "a Draw node's double-click sequence is identical to a Button's, "
            "in both order and per-action count");
    Require(fromDraw.front() == "click" && fromDraw.back() == "dbl",
            "click first, double-click last");
    // Then pin the exact sequence as a literal, per Step 2.
}
```

Write the DOM equivalents in `ui-backend.spec.ts`.

- [ ] **Step 2: Run once, read the observed sequence, and pin it as a literal**

Run: `make -C projects/synth/apps/miniapp test 2>&1 | tail -20` and `make -C projects/synth/browser test 2>&1 | tail -20`

Read the actual sequence `SimulateDoubleClick` observes and replace the loose front/back assertions with a literal equality on that exact vector — **in each backend suite separately**, since the two backends may legitimately differ from each other while each matches its own `Button`.

- [ ] **Step 3: Implement JUCE click dispatch**

In `RetainedDrawComponent`, fire the click action from `mouseUp` when the pointer never exceeded the existing drag threshold, so a drag cannot also register as a click. Widen `setInterceptsMouseClicks` (~506) to include the case where `node.action` is present, while leaving the inert case **exactly** as it is.

- [ ] **Step 4: Implement browser click dispatch**

Attach a `click` listener for `NodeKind::Draw` routed through the existing `dispatchValue`, mirroring the `Button` path at ~132. `acceptsPointerEvents` already gates on an action being present — verify that with the inert test rather than assuming it.

- [ ] **Step 5: Run and commit**

Run: `make -C projects/synth/apps/miniapp test 2>&1 | tail -30` and `make -C projects/synth/browser test 2>&1 | tail -30`
Expected: PASS.

```bash
git add projects/synth/juce/ projects/synth/browser/src/ui.ts projects/synth/browser/tests/ui-backend.spec.ts
git commit -m "feat(portable-ui): dispatch a plain click from Draw nodes in both backends (sru-52)"
```

---

## Task 11: Page style constants, and the Sync and Audio page rebuilds

**OpenSpec:** 5.1, 5.2, 5.3, 5.4, 5.5 · **Requirements:** sru-47, sru-31, sru-3, sru-12

**Files:**
- Create: `projects/synth/include/synth/RuntimePageStyle.hpp`
- Modify: `projects/synth/include/synth/RuntimePages.hpp` (Sync and Audio tree construction)
- Test: `projects/synth/tests/portable_ui_tests.cpp`, `projects/synth/juce/RuntimePagesJuceTests.cpp`

**Interfaces:**
- Consumes: containers, resolver, form grid, `ControlStyle` and the `<controlId>.caption` id convention (Tasks 1-2), the `ComboBox::label` decision (Task 3).
- Produces: `namespace synth::pagestyle` — Tasks 12 and 13 both consume it.

Sync and Audio are the two simple form pages, staged first (design.md D12). Sync proves the form grid; Audio adds conditional rows and the captioned-selector fix.

- [ ] **Step 1: Extract the page style constants**

Read `PortableJuceBackend.hpp:1119-1158` and seed `RuntimePageStyle.hpp` from those exact RGB values so the pages start from today's look. **Fill in every value from the file you read; leave no placeholder.**

```cpp
#pragma once
#include "synth/PortableUI.hpp"

// The config pages' own appearance choices. Ordinary named constants passed to
// components — deliberately NOT a styling system, theme, or token vocabulary
// (design.md D5, Non-Goals). Seeded from the JUCE backend constants this change
// demotes to absent-value defaults.
namespace synth::pagestyle {
inline constexpr Color kPageBackground = /* read from PortableJuceBackend.hpp */;
inline constexpr Color kControlFill    = /* ... */;
inline constexpr Color kPrimaryFill    = /* was variant "primary" */;
inline constexpr Color kDangerFill     = /* was variant "danger" */;
inline constexpr ui::TextStyle kBodyText  = /* ... */;
inline constexpr ui::TextStyle kTitleText = /* was "title" */;
inline constexpr ui::TextStyle kMutedText = /* was "muted" */;
}
```

- [ ] **Step 2: Write the failing tests**

```cpp
static void TestSyncPageAlignsThroughTheFormGrid()
{
    const auto tree = BuildSyncPageTree({0,0,900,560});
    Require(AllEqual(ColumnXOffsetsOf(tree, "sync.form", 0)),
            "every Sync label starts at the same x-offset");
    Require(AllEqual(ColumnXOffsetsOf(tree, "sync.form", 1)),
            "every Sync control starts at the same x-offset");
}

static void TestPagesHaveNoOffsetArithmetic()
{
    Require(!SourceContains("projects/synth/include/synth/RuntimePages.hpp",
                            "y += Layout::kRowHeight"),
            "page-level offset accumulation is gone");
}

static void TestAudioSelectorsAreCaptionedWhileADeviceIsSelected()
{
    const auto tree = BuildAudioPageTree({0,0,900,560}, "Built-in Output",
                                         /*inputConfigured=*/true, "Built-in Microphone");
    Require(FindNode(tree,"audio.output.caption").text == "Output device",
            "the output selector shows a visible caption while a device is selected");
    Require(FindNode(tree,"audio.input.caption").text == "Input device",
            "the input selector shows a visible caption while a device is selected");
}

static void TestHiddenInputSelectorLeavesNoOrphanedCaption()
{
    const auto tree = BuildAudioPageTree({0,0,900,560}, "Built-in Output",
                                         /*inputConfigured=*/false, "");
    Require(!HasNode(tree,"audio.input.caption"), "no orphaned caption");
    Require(!HasNode(tree,"audio.input"), "and no orphaned control either");
}
```

- [ ] **Step 3: Run to verify they fail, then rebuild both pages**

Run: `make -C projects/synth test 2>&1 | tail -20`

**Sync:** a `formGrid` column of toggle and PPQN rows, a status region, colours from `synth::pagestyle`. Remove the manual `y += Layout::kRowHeight + Layout::kRowGap` accumulation and per-site pixel constants for this page.

**Audio:** a `formGrid` column whose rows are captioned selectors, with the input row emitted **only** when an input is configured — so caption and control appear and disappear together. Captions are library-emitted `Label` nodes, never `ComboBox::label`, which would recreate the `setTextWhenNothingSelected()` trap at `PortableJuceBackend.hpp:1262`.

- [ ] **Step 4: Run the behavior suites in both backends**

Run: `make -C projects/synth test 2>&1 | tail -30`
Run: `make -C projects/synth/apps/miniapp test 2>&1 | tail -30`
Run: `make -C projects/synth/browser test 2>&1 | tail -30`
Expected: PASS. sru-31 green for Sync; sru-3 and sru-12 green for Audio in **both** backends. Behavioral assertions stay unchanged in what they assert; only position expectations are re-pinned.

- [ ] **Step 5: Run the content audits**

For each page, list every string the rebuilt page no longer renders and classify it: (a) decorative chrome, (b) a label duplicating an adjacent label, (c) a leaked placeholder, or (d) **pinned by a spec scenario**. **Category (d) may not be dropped** — if the audit concludes such text is noise, that is a spec change to make explicitly first, not a rendering decision. Write both lists into `openspec/changes/rebuild-portable-ui-component-library/tasks.md` under tasks 5.3 and 5.5 for the Task 15 sign-off gate.

- [ ] **Step 6: Commit**

```bash
git add projects/synth/include/synth/RuntimePageStyle.hpp projects/synth/include/synth/RuntimePages.hpp projects/synth/tests/ projects/synth/juce/RuntimePagesJuceTests.cpp openspec/changes/rebuild-portable-ui-component-library/tasks.md
git commit -m "feat(runtime-pages): rebuild the Sync and Audio pages on the component library (sru-47)"
```

---

## Task 12: The File page rebuild and the spliced patch browser

**OpenSpec:** 5.6, 5.7 · **Requirements:** sru-47, sru-6, sru-13, sru-16, sru-17, sru-18

**Files:**
- Modify: `projects/synth/include/synth/RuntimePages.hpp` (`BuildFilePageTree` and the browser rows at 679-750)
- Test: `tests/portable_ui_tests.cpp`, `tests/runtime_file_service_tests.cpp`, `juce/FilePageSimulationTests.cpp`

**Interfaces:**
- Consumes: `Builder::Splice` and the rootless-subtree convention (Task 1), the parent-relative File bounds conversion (Task 4), `synth::pagestyle` (Task 11).
- Produces: the patch-browser subtree as a separately produced **rootless** `Subtree`. Task 13 produces the wizard subtree the same way.

Design.md originally claimed the File page already splices an externally produced patch-browser tree. **It does not** — its browser rows are constructed inline inside `BuildFilePageTree`. This task performs that extraction, which is why it is larger than it reads.

- [ ] **Step 1: Write the failing splice test**

```cpp
static void TestPatchBrowserSplicesAsARootlessSubtree()
{
    const auto browser = BuildPatchBrowserSubtree(RepresentativeBrowserState());
    for (const auto& n : browser.nodes) {
        Require(n.kind != synth::ui::NodeKind::Root,
                "the patch browser produces a rootless subtree");
    }
    const auto page = BuildFilePageTree({0,0,900,560}, RepresentativeBrowserState());
    std::size_t roots = 0;
    for (const auto& n : page.nodes) { if (n.kind == synth::ui::NodeKind::Root) ++roots; }
    Require(roots == 1, "the spliced page has exactly one root");
    Require(IsDescendantOf(page, FirstBrowserRowId(browser), "file.browser"),
            "the spliced nodes appear as descendants of the splice point");
}
```

- [ ] **Step 2: Run to verify it fails, then extract and rebuild**

Run: `make -C projects/synth test 2>&1 | tail -20`

Extract the browser-row construction out of `BuildFilePageTree` into a function returning a rootless `Subtree` via `BuildSubtree()`, and splice it through `Splice`. Rebuild the rest of the File page on the library. The rows' bounds are already parent-relative from Task 4.

- [ ] **Step 3: Run the File suites**

Run: `make -C projects/synth test 2>&1 | tail -30`
Run: `make -C projects/synth/apps/miniapp test 2>&1 | tail -30`
Expected: PASS. sru-6, sru-13, sru-16-sru-18 suites and the model-based File-page simulation (sru-17) stay green.

- [ ] **Step 4: Run the File content audit**

Same four categories and the same hard rule as Task 11 Step 5. Record the removal list in `tasks.md` under task 5.7.

- [ ] **Step 5: Commit**

```bash
git add projects/synth/include/synth/RuntimePages.hpp projects/synth/tests/ projects/synth/juce/FilePageSimulationTests.cpp openspec/changes/rebuild-portable-ui-component-library/tasks.md
git commit -m "feat(runtime-pages): rebuild the File page and splice the patch browser subtree (sru-47, sru-16)"
```

---

## Task 13: The Controllers page and the controller wizard

**OpenSpec:** 5.8, 5.9, 5.9a, 5.10 · **Requirements:** sru-47, sru-4 through sru-11, sru-15, sru-26 through sru-33

**Files:**
- Modify: `projects/synth/include/synth/ControllersPageUI.hpp` (3132 lines, 186 `ui::Node` sites), `:2219-2298` (the wizard splice site)
- Modify: `projects/synth/src/ControllerWizard.cpp:413-506`, `include/synth/ControllerWizard.hpp:20-46`
- Modify: `openspec/changes/rebuild-portable-ui-component-library/design.md` (spike findings under OQ7)
- Test: `tests/controllers_page_ui_tests.cpp`, `tests/controller_wizard_tests.cpp`, `juce/ControllersPageSimulationTests.cpp`

**Interfaces:**
- Consumes: everything from Tasks 1-2 and 11, plus `Splice`.
- Produces: Controllers page tree construction and the wizard subtree on the library. The view model, edit-session logic, and wizard state machine are **untouched**.

The highest-risk migration in the change, staged last (design.md D12). The wizard is here rather than in cleanup because it would otherwise surface *after* the visual baselines, when a layout-changing refactor is at its most expensive.

- [ ] **Step 1: Spike one subsection first**

Migrate a single subsection — the controller list rows are the natural choice. Then count: how much of the 186-node construction is tree **shape** versus view-model **presentation logic**? Record the ratio and its implication in design.md OQ7, and adjust your estimate for the rest of this task before continuing.

**If the spike shows presentation logic is entangled with node construction in a way this plan did not anticipate, STOP and report it** — that is a design defect, not an implementation problem.

- [ ] **Step 2: Write the failing tests**

```cpp
static void TestNoHandRolledNodesSurvive()
{
    for (const char* file : {"projects/synth/include/synth/ControllersPageUI.hpp",
                             "projects/synth/src/ControllerWizard.cpp"}) {
        Require(!SourceContainsFieldByFieldNodeInit(file),
                std::string(file) + " no longer initializes ui::Node structs field-by-field");
    }
}

static void TestControllersSectionsNestThroughContainers()
{
    const auto tree = BuildControllersPageTree({0,0,900,560}, RepresentativeControllersState());
    Require(FindNode(tree,"controllers.scroll").kind == synth::ui::NodeKind::ScrollArea,
            "the mapping list lives in a real scroll area");
    Require(!FindNode(tree,"controllers.scroll").children.empty(),
            "with real nested children, not a flat sibling list");
}

static void TestWizardEmitsALibraryBuiltRootlessSubtree()
{
    const auto subtree = BuildWizardSubtree(RepresentativeWizardState());
    for (const auto& n : subtree.nodes) {
        Require(n.kind != synth::ui::NodeKind::Root,
                "the wizard subtree is rootless and splices without a nested root");
    }
    Require(AllEqual(ColumnXOffsetsOf(subtree, "wizard.form", 0)),
            "MfTwisterConfigForm's labels align through the form grid");
}
```

Write `SourceContainsFieldByFieldNodeInit` in the test support directory (grep for `ui::Node ` declarations followed by `.field =` assignments) so Task 16 can reuse it.

- [ ] **Step 3: Run to verify they fail, then migrate both**

Run: `make -C projects/synth test 2>&1 | tail -20`

**Controllers:** move **only** the tree construction. Sections → `Section` containers, mapping lists → `ScrollArea` containers, rows → `Row` containers, per-row controls → library leaves with `ControlStyle` carrying `synth::pagestyle` colours. The view model and edit-session logic stay exactly as they are.

**Wizard:** rebuild its tree construction as a rootless `Subtree` via `BuildSubtree()`, with `MfTwisterConfigForm` and the wizard-session chrome on the form grid. The state machine and step logic are untouched.

- [ ] **Step 4: Run the dense behavioral suites, with sru-11 called out**

Run: `make -C projects/synth test 2>&1 | tail -40`
Run: `make -C projects/synth/apps/miniapp test 2>&1 | tail -40`
Expected: PASS. sru-4-sru-11, sru-15, sru-26-sru-33 unit and simulation suites green; sru-32 three-click flow and sru-33 parity green. **Explicitly re-run the sru-11 session-stability scenarios** and confirm no re-coalescing, stable rows, and session flush on collapse. Behavior assertions must not change what they assert.

- [ ] **Step 5: Run the Controllers content audit**

Same rules as Task 11 Step 5, covering both the page and the wizard. Record in `tasks.md` under task 5.10.

- [ ] **Step 6: Commit**

```bash
git add projects/synth/include/synth/ControllersPageUI.hpp projects/synth/include/synth/ControllerWizard.hpp projects/synth/src/ControllerWizard.cpp projects/synth/tests/ projects/synth/juce/ControllersPageSimulationTests.cpp openspec/changes/rebuild-portable-ui-component-library/
git commit -m "feat(controllers-page): rebuild the page and wizard on the component library (sru-47)"
```

---

## Task 14: Named visual criteria and structural assertions

**OpenSpec:** 1.4, 6.1, 6.2, 6.3 · **Requirements:** sru-48, sru-50

**Files:**
- Create: `projects/synth/browser/tests/visual-criteria.spec.ts`
- Modify: `projects/synth/tests/portable_ui_layout_tests.cpp`, `juce/ControllersPageSimulationTests.cpp`
- Modify: `openspec/changes/rebuild-portable-ui-component-library/tasks.md` (record the environment under task 1.4)

**Interfaces:**
- Consumes: every rebuilt page (Tasks 11-13), both rebuilt apps (Task 6), the `<controlId>.caption` id convention (Task 1), the standard-layout region ids (Task 6), `data-node-id`/`data-node-kind` (Task 8).
- Produces: the criteria checklist constant and the structural assertions. Task 15's loop iterates until these pass.

- [ ] **Step 1: Fix and record the verification environment**

sru-48 requires one named reference viewport, device scale factor, and deterministic fixture state under which every criterion is evaluated and every screenshot captured. Read `projects/synth/browser/playwright.config.*` for the existing viewport, then pin all three and record them in `tasks.md` under task 1.4. Without this, different implementers produce incompatible baselines and CI reports environment drift as visual regression.

- [ ] **Step 2: Write the criteria checklist constant**

```ts
// sru-48 named visual acceptance criteria. Every criterion is either asserted
// structurally in this file or checked by a human at the Task 15 sign-off gate.
// Do not add a criterion here without also adding its check.
export const VISUAL_CRITERIA = [
  "like-type controls share column positions",
  "all spacing drawn from the library's shared spacing metrics",
  "every form control has a visible caption",
  "no overlapping nodes and no container overflow on either axis",
  "every text element renders within its allocated extent",
  "text contrast meets WCAG AA 4.5:1 against its effective background",
  "no text conveys no information to the user",
] as const;
```

- [ ] **Step 3: Write the structural assertions**

**Containment is against the parent's *containing* rectangle** — which for a `ScrollArea` is its declared **scroll-content** rectangle, not its viewport. A Controllers row below the visible viewport is contained, not overflowing; that is required by sru-5 and sprs-10. Clipping and scroll-reachability are asserted separately. Declared overlays and overhangs (the sru-25 visualizer underlays) are exempt from both containment and intersection checks.

```ts
test("controls in the same form-grid column share an x-position", async ({ page }) => {
  await openPage(page, "sync");
  expect(new Set(await columnXPositions(page, "sync.form", 0)).size).toBe(1);
  expect(new Set(await columnXPositions(page, "sync.form", 1)).size).toBe(1);
});

test("no node overflows its parent's containing rectangle on either axis", async ({ page }) => {
  for (const surface of ALL_SURFACES) {
    await openPage(page, surface);
    const violations = await page.evaluate((declaredOverhangs) => {
      const out: string[] = [];
      document.querySelectorAll<HTMLElement>("[data-node-id]").forEach((el) => {
        const id = el.dataset.nodeId!;
        if (declaredOverhangs.includes(id)) return;
        const parent = el.parentElement?.closest<HTMLElement>("[data-node-id]");
        if (!parent) return;
        // A ScrollArea contains its declared content extent, not just its viewport.
        const p = parent.dataset.nodeKind === "ScrollArea"
          ? contentRectOf(parent)
          : parent.getBoundingClientRect();
        const c = el.getBoundingClientRect();
        if (c.left < p.left - 0.5 || c.right > p.right + 0.5 ||
            c.top < p.top - 0.5 || c.bottom > p.bottom + 0.5) {
          out.push(`${id} overflows ${parent.dataset.nodeId}`);
        }
      });
      return out;
    }, DECLARED_OVERHANGS);
    expect(violations, `${surface}: ${violations.join("; ")}`).toEqual([]);
  }
});

test("a scroll area clips its content and keeps it reachable", async ({ page }) => {
  await openPage(page, "controllers");
  const { clipped, reachableAfterScroll } = await scrollAreaBehaviour(page, "controllers.scroll");
  expect(clipped).toBe(true);
  expect(reachableAfterScroll).toBe(true);
});

test("no two siblings overlap except at declared overlays", async ({ page }) => {
  for (const surface of ALL_SURFACES) {
    await openPage(page, surface);
    const overlaps = await siblingOverlaps(page, DECLARED_OVERLAYS);
    expect(overlaps, `${surface}: ${overlaps.join("; ")}`).toEqual([]);
  }
});

test("every gap and padding is a shared spacing-metric value", async ({ page }) => {
  for (const surface of ALL_SURFACES) {
    await openPage(page, surface);
    const offenders = await stackedGapsNotInMetrics(page, SPACING_METRIC_VALUES);
    expect(offenders, `${surface}: ${offenders.join("; ")}`).toEqual([]);
  }
});

test("every text element fits its allocated extent", async ({ page }) => {
  for (const surface of ALL_SURFACES) {
    await openPage(page, surface);
    const tooTight = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll<HTMLElement>("[data-node-id]").forEach((el) => {
        if (!el.textContent?.trim()) return;
        if (el.scrollWidth > el.clientWidth + 0.5) {
          out.push(`${el.dataset.nodeId} (${el.scrollWidth} > ${el.clientWidth})`);
        }
      });
      return out;
    });
    // A failure names a too-tight metrics reservation, not a page bug.
    expect(tooTight, `${surface}: ${tooTight.join("; ")}`).toEqual([]);
  }
});

test("every form control has a caption", async ({ page }) => {
  for (const surface of CONFIG_PAGES) {
    await openPage(page, surface);
    const uncaptioned = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll<HTMLElement>(
        "[data-node-kind='ComboBox'],[data-node-kind='TextField']," +
        "[data-node-kind='Toggle'],[data-node-kind='Slider']"
      ).forEach((el) => {
        const id = el.dataset.nodeId!;
        if (!document.querySelector(`[data-node-id="${id}.caption"]`)) out.push(id);
      });
      return out;
    });
    expect(uncaptioned, `${surface}: ${uncaptioned.join("; ")}`).toEqual([]);
  }
});

test("text contrast meets WCAG AA 4.5:1", async ({ page }) => {
  for (const surface of ALL_SURFACES) {
    await openPage(page, surface);
    // Each failure names the element and both computed colours.
    const failures = await contrastFailures(page, 4.5);
    expect(failures, `${surface}: ${failures.join("; ")}`).toEqual([]);
  }
});

test("a different root extent redistributes weighted children", async ({ page }) => {
  await openPage(page, "sync");
  const narrow = await regionWidths(page, REFERENCE_VIEWPORT.width);
  const wide   = await regionWidths(page, REFERENCE_VIEWPORT.width * 2);
  expect(wide.weighted).toBeGreaterThan(narrow.weighted);
  expect(wide.fixed).toBeCloseTo(narrow.fixed, 1);
});
```

Implement `columnXPositions`, `contentRectOf`, `scrollAreaBehaviour`, `siblingOverlaps`, `stackedGapsNotInMetrics`, `contrastFailures`, and `regionWidths` as helpers in the same file. `contrastFailures` computes the WCAG relative-luminance ratio from `getComputedStyle` colour and the nearest non-transparent ancestor background.

- [ ] **Step 4: Write the headless equivalents**

Add the same alignment, containment (with the same `ScrollArea` content-rectangle rule), and sibling-overlap assertions over the **resolved portable tree** in `portable_ui_layout_tests.cpp` and `ControllersPageSimulationTests.cpp`. Bounds are in the tree, so these are assertable headlessly with no browser — this is how JUCE gets the structural subset (design.md D13).

- [ ] **Step 5: Run and commit**

Run: `make -C projects/synth/browser test 2>&1 | tail -40` and `make -C projects/synth test 2>&1 | tail -30`
Expected: the assertions run. Failures here are real defects in the rebuilt surfaces — **fix the surfaces, not the assertions.**

```bash
git add projects/synth/browser/tests/visual-criteria.spec.ts projects/synth/tests/ projects/synth/juce/ openspec/changes/rebuild-portable-ui-component-library/tasks.md
git commit -m "test(visual): add named criteria and structural assertions (sru-48)"
```

---

## Task 15: The screenshot loop, human sign-off, and baseline CI

**OpenSpec:** 6.4, 6.5, 6.6 · **Requirements:** sru-48

**Files:**
- Modify: `projects/synth/browser/tests/` (loop and baseline comparison), `projects/synth/Makefile`
- Create: `projects/synth/browser/tests/screenshots/` baselines (committed **only** after sign-off)
- Modify: `openspec/changes/rebuild-portable-ui-component-library/tasks.md` (record the sign-off)

**Interfaces:**
- Consumes: the criteria and assertions (Task 14), every rebuilt surface (Tasks 6, 11-13).
- Produces: approved baselines and a CI gate.

**This task contains a human gate. Do not commit baselines without recorded sign-off.**

- [ ] **Step 1: Run the iteration loop per surface**

For each config page (Sync, Audio, File, Controllers) and each app surface (Braid 4, Mini App): build → render in the browser backend at Task 14's fixed viewport, scale factor, and fixture state → capture under `projects/synth/browser/tests/screenshots/` → evaluate against `VISUAL_CRITERIA` → adjust colours in `RuntimePageStyle.hpp` or layout declarations in the producer → repeat.

Iterate until **every machine-checkable criterion passes**. Adjust producers, never the criteria.

- [ ] **Step 2: Present the sign-off package and STOP**

For each surface, present: the final screenshot; the criteria results, including any criterion that is human-judged rather than machine-checked; and the content-audit removal list from Tasks 11-13 with each string's category.

Then **wait for explicit approval**. Do not proceed without it.

- [ ] **Step 3: Spot-check JUCE text fit**

The one thing headless assertions cannot fully cover (design.md D4): render each surface in the JUCE backend and confirm no string is truncated inside its reservation. The metric is deliberately conservative, so ellipsis should be the exception. **If truncation is common, the metric in `PortableUIMetrics.hpp` is too tight — widen it and re-run Step 1** rather than accepting the truncation.

- [ ] **Step 4: Commit the baselines and record the sign-off**

Only after approval:

```bash
git add projects/synth/browser/tests/screenshots/
git commit -m "test(visual): commit approved screenshot baselines (sru-48)"
```

Record who approved, when, and which surfaces, in `tasks.md` under task 6.5.

- [ ] **Step 5: Wire baseline comparison into CI**

Add baseline comparison to the browser test target with a **stated pixel-diff tolerance** — write the number down, do not leave it implicit. An unapproved render diff must fail. Document the baseline-update-with-sign-off procedure in a README beside the suite: an intended visual change is expressed by updating the baseline in the same commit with renewed sign-off, so unapproved pixel drift is a regression by definition.

Run: `make synth-browser-test 2>&1 | tail -30`
Expected: PASS against the committed baselines.

- [ ] **Step 6: Commit**

```bash
git add projects/synth/Makefile projects/synth/browser/tests/ openspec/changes/rebuild-portable-ui-component-library/tasks.md
git commit -m "test(visual): gate CI on approved screenshot baselines (sru-48)"
```

---

## Task 16: Cleanup, layering enforcement, documentation, and publication

**OpenSpec:** 7.1 through 7.6 · **Requirements:** sru-43, sru-46, sru-49, sru-51, sbap-3

**Files:**
- Modify: `PortableUIBuilders.hpp` (delete shims), `RuntimePages.hpp`, `ControllersPageUI.hpp` (dead `Layout::` constants), `juce/PortableJuceBackend.hpp`, `browser/src/ui.ts` (dead variant branches), `scripts/check_ui_boundary.sh`, `docs/coverage.md`

**Interfaces:**
- Consumes: everything.
- Produces: the archive-ready change.

The change is not complete while two authoring dialects exist (design.md, Risks).

- [ ] **Step 1: Delete the shims**

Remove the old flat leaf signatures and the no-argument `Build()` overload. Note: the leaf "shims" were implemented as trailing default arguments on the live signatures, not as separate overloads — so deleting them means removing the defaults, not hunting for overloads that were never written. Every caller must already pass `ControlStyle` and a root extent.

Run: `make -C projects/synth test 2>&1 | tail -30`
Expected: compiles and passes. **A compile error here names a producer that was never migrated — migrate it, do not restore the shim.**

- [ ] **Step 2: Delete dead layout constants and verify no hand-rolled nodes**

Remove `Layout::kPageMargin`, `kRowGap`, row-height constants, and every remaining per-site pixel constant in the page sources.

Run: `grep -rn "ui::Node [a-zA-Z]" projects/synth/include/synth/RuntimePages.hpp projects/synth/include/synth/ControllersPageUI.hpp projects/synth/src/ControllerWizard.cpp`
Expected: no output. Any hit is page code initializing `ui::Node` field-by-field, which sru-43 forbids.

- [ ] **Step 3: Finish the variant residual**

Implement Task 3's OQ1 decision to completion: remove dead appearance-variant branches from both backends, document the residual set on the model.

Run: `grep -nE '"danger"|"primary"|"muted"|"muted-title"' projects/synth/juce/PortableJuceBackend.hpp projects/synth/browser/src/ui.ts`
Expected: no output.

- [ ] **Step 4: Extend the layering inspection**

Extend `projects/synth/scripts/check_ui_boundary.sh` (already run by `make -C projects/synth check-ui-boundary`) so it fails when:

1. a backend source includes `PortableUIBuilders.hpp`, `PortableUILayout.hpp`, `PortableUIMetrics.hpp`, or `PortableUIStandardLayout.hpp`;
2. a wire-codec source includes any library, page, or app header;
3. **any deleted policy symbol reappears** in the backends: `FlowCursor`, `DefaultSizeForNode`, `defaultSize`, `kControlMargin`, `kControlGap`, `CONTROL_MARGIN`, `CONTROL_GAP`, `LooksLocal`, `LookLocal`, `nodeLocal`, `ExplicitBoundsAreParentLocal`, `explicitBoundsAreParentLocal`, and the per-variant colour table symbols.

Add JUCE-free compile coverage for the library and producer layers alongside the existing sru-7/sru-14 compile tests.

Run: `make -C projects/synth check-ui-boundary`
Expected: PASS.

- [ ] **Step 5: Update coverage documentation**

Add sru-43 through sru-53 and MODIFIED sprs-2, sprs-6, sprs-9 to `projects/synth/docs/coverage.md`, each naming the suites that cover it. Document the version-2 wire format wherever v1 is documented.

- [ ] **Step 6: Publish as one whole-catalog publication**

Rebuild the shell bundle and every app package together and publish as one `sbap-3` whole-catalog, all-or-nothing publication. Rollback is redeploying the previous complete publication. Then build a package against version 1 (or stub its exported version to 1), confirm the shell rejects it with the explicit version error and renders no frame, and discard the stale artifact.

- [ ] **Step 7: Full verification pass**

Run: `make synth-test 2>&1 | tail -30`
Run: `make synth-browser-test 2>&1 | tail -30`
Run: `make -C projects/synth/apps/miniapp test 2>&1 | tail -30`
Run: `make -C projects/synth check-ui-boundary`
Expected: PASS on all four.

Then manually smoke all four config pages and both apps in **both** backends, and confirm the existing narrow-viewport shrink-to-fit behaves exactly as before (`surfaceScale` is untouched by design).

- [ ] **Step 8: Record results and commit**

Write the verification results into `tasks.md` under task 7.6 before requesting archive.

```bash
git add projects/synth/ openspec/changes/rebuild-portable-ui-component-library/tasks.md
git commit -m "refactor(portable-ui): delete shims, enforce layering, and document v2 coverage (sru-51)"
```

---

## Appendix: OpenSpec task → plan task map

| OpenSpec | Plan task |
|---|---|
| 1.1 | done during planning (recorded in tasks.md) |
| 1.2, 1.3 | 3 |
| 1.4 | 14 |
| 2.1, 2.5, 2.6 | 1 |
| 2.2, 2.2a, 2.3, 2.4, 2.7 | 2 |
| 3.1, 3.2, 3.2a, 3.3 | 3 |
| 3.4, 3.4a, 3.10 | 4 |
| 3.13 | 5 |
| 3.14, 3.15, 3.16, 4.7 | 6 |
| 3.5, 3.6, 3.7 | 7 |
| 3.8 | 8 |
| 3.9, 3.11, 3.12, 4.2 | 9 |
| 4.3 | 10 |
| 5.1–5.5 | 11 |
| 5.6, 5.7 | 12 |
| 5.8, 5.9, 5.9a, 5.10 | 13 |
| 6.1, 6.2, 6.3 | 14 |
| 6.4, 6.5, 6.6 | 15 |
| 7.1–7.6 | 16 |

**Execution order is the task order above.** Tasks 4, 5, and 6 must complete before Tasks 7 and 8 — see the Ordering Constraint section.
