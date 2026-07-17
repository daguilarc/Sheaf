# Generic JUCE Portable UI Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `synth_juce::PortableComponent` render the shared portable UI hierarchy and scroll areas correctly so the desktop Controllers page matches the browser path.

**Architecture:** Port the browser backend's validated parent-map, nearest-root, explicit-bound, and auto-flow resolution rules into the generic JUCE adapter. Retained JUCE components are reparented into semantic row/section hosts or a scroll area's viewport content host, and draw nodes become retained hosted painters so JUCE supplies clipping and coordinate conversion. Production shell and Controllers harness tests then exercise only this generic path.

**Tech Stack:** C++20, JUCE `Component`/`Viewport`, existing `synth::ui::NodeTree`, Make, TypeScript browser parity tests, OpenSpec.

## Global Constraints

- Preserve stable component identity, focus, uncommitted text drafts, current actions, drawing, and pointer behavior across refreshes.
- Match `projects/synth/browser/src/ui.ts::resolveFrameBounds`: validate one parentless root, reject unknown/multiply-parented/cyclic graphs, resolve explicit bounds parent-before-child, and add a parent origin only when the child bounds fit the parent's coordinate extent.
- For a `ScrollArea`, use `max(bounds.width, scrollContentWidth)` and `max(bounds.height, scrollContentHeight)` as the parent coordinate extent; keep the node bounds as the visible viewport.
- Resolve unbounded controls in nearest-root surface coordinates before translating them into their actual semantic JUCE host.
- Keep `PortableJuceBackend.hpp` generic: no Controllers node IDs, action names, page types, or application-specific branches.
- Do not change the portable node protocol, browser behavior, persistence formats, MIDI/audio behavior, or add dependencies.
- Remove `ControllersTreeRenderer` and its alternate host/tests only after equivalent generic-backend, runtime-shell, simulation, and harness coverage passes.

---

### Task 1: Hierarchical resolution, semantic hosting, and hosted drawing

**Files:**
- Modify: `projects/synth/juce/PortableJuceBackend.hpp`
- Modify: `projects/synth/juce/PortableJuceBackendTests.cpp`

**Interfaces:**
- Produces: `PortableComponent::ResolvedNode { juce::Rectangle<int> surfaceBounds; std::optional<NodeId> parentId; NodeId nearestRootId; }` stored by node ID after each refresh.
- Produces: `PortableComponent::SurfaceBoundsForNode(const std::string&) const -> juce::Rectangle<int>` for black-box production assertions.
- Produces: one retained JUCE component for every renderable `Row`, `Section`, `ScrollArea`, label/control, and `Draw` node; `FindByNodeId` continues returning that retained component.
- Consumes: `synth::ui::NodeTree`, `HasExplicitBounds`, `UiToJuceRect`, and the exact `explicitBoundsAreParentLocal` rule in `projects/synth/browser/src/ui.ts`.

- [ ] **Step 1: Add surface-space and hierarchy test helpers**

Add this helper beside `Require` in `PortableJuceBackendTests.cpp` so assertions remain correct after controls become host-local:

```cpp
juce::Rectangle<int> SurfaceBoundsOf(const juce::Component& surface,
                                     const juce::Component& child)
{
    return surface.getLocalArea(&child, child.getLocalBounds());
}
```

Add a mutable-tree fixture containing `root -> section -> row.a/row.b -> text fields`, a nested absolute `sidebar.root`, an unbounded button under `row.a`, and a nested interactive draw node. Assert:

```cpp
Require(rowA->getParentComponent() == section, "row A is hosted by its semantic section");
Require(fieldA->getParentComponent() == rowA, "field A is hosted by its semantic row");
Require(SurfaceBoundsOf(component, *fieldA).getY() !=
            SurfaceBoundsOf(component, *fieldB).getY(),
        "parent-local row fields occupy distinct surface rows");
Require(SurfaceBoundsOf(component, *sidebarButton).getX() == 912,
        "absolute sidebar offset is applied exactly once");
Require(SurfaceBoundsOf(component, *flowButton) == component.SurfaceBoundsForNode("flow"),
        "root-flow bounds survive translation into the semantic host");
Require(draw->getParentComponent() == rowA, "draw node is hosted by its semantic row");
```

Focus the text editor, replace its text with `draft`, refresh once with the same parent and once after moving its node ID to `row.b`, and assert pointer identity, `hasKeyboardFocus(true)`, and draft text are preserved.

- [ ] **Step 2: Run the new backend test and capture the expected failure**

Run:

```bash
make -C projects/synth/apps/miniapp test
```

Expected before implementation: `portable_juce_backend_tests` fails because every component is parented directly to `PortableComponent`, raw parent-local bounds overlap, and non-interactive draw nodes are not hosted components.

- [ ] **Step 3: Port the browser resolution algorithm without page branches**

In `PortableComponent`, add these records and helpers with the stated signatures:

```cpp
struct ResolvedNode
{
    juce::Rectangle<int> surfaceBounds;
    std::optional<synth::ui::NodeId> parentId;
    synth::ui::NodeId nearestRootId;
};

void ResolveTree();
juce::Rectangle<int> ResolveExplicitNode(const synth::ui::Node& node,
                                         std::unordered_map<std::string, int>& visitState);
bool ExplicitBoundsAreParentLocal(const synth::ui::Node& node,
                                  const synth::ui::Node& parent) const;
juce::Component* SemanticHostFor(const ResolvedNode& resolved);
juce::Rectangle<int> HostLocalBounds(const ResolvedNode& resolved,
                                     const juce::Component& host) const;
```

`ResolveTree()` must build and validate `m_parentByNodeId`, assign `m_nearestRootByNodeId`, resolve explicit nodes recursively exactly like `resolveFrameBounds`, then flow unbounded nodes per nearest root. Store all final surface bounds in `m_resolvedByNodeId`; `SurfaceBoundsForNode` returns the stored rectangle or `{}`.

- [ ] **Step 4: Reparent retained controls and turn draw nodes into hosted painters**

Replace root-only attachment in `RebuildControls()` with semantic attachment after all retained components have been collected. Add a retained draw component whose update contract is:

```cpp
void SetNode(synth::ui::NodeId id,
             std::vector<synth::ui::DrawCommand> commands,
             bool acceptsDrag,
             bool acceptsDoubleClick);
```

Its `paint()` calls `PaintDrawCommand(graphics, command, getLocalBounds().toFloat())`, and its existing drag/double-click callbacks dispatch by stable node ID. Every draw node, interactive or not, must be included by `IsRenderableKind`; remove root-level `m_drawNodeIndices` painting. Attach rows/sections to their nearest semantic component host, attach ordinary descendants likewise, preserve sibling order with `toFront(false)`, and set bounds through `HostLocalBounds`.

When reparenting a focused retained component, hold a `SafePointer`, call `host->addAndMakeVisible(component)`, set host-local bounds, and restore keyboard focus only if JUCE dropped it. Do not call `setText` for a focused `TextEditor`.

- [ ] **Step 5: Run hierarchy regression coverage**

Run:

```bash
make -C projects/synth/apps/miniapp test
```

Expected: `PortableJuceBackendTests passed`, existing encoder drag/current-action assertions pass, and all other miniapp JUCE tests remain green.

- [ ] **Step 6: Commit Task 1**

```bash
git add projects/synth/juce/PortableJuceBackend.hpp projects/synth/juce/PortableJuceBackendTests.cpp
git commit -m "fix(synth): preserve portable JUCE hierarchy"
```

---

### Task 2: Generic JUCE scroll-area viewport

**Files:**
- Modify: `projects/synth/juce/PortableJuceBackend.hpp`
- Modify: `projects/synth/juce/PortableJuceBackendTests.cpp`

**Interfaces:**
- Consumes: Task 1's `ResolvedNode`, semantic-host selection, stable component reuse, and `SurfaceBoundsForNode`.
- Produces: `PortableScrollAreaComponent`, a retained host exposing `ContentComponent()`, `Viewport()`, and `SetContentExtent(int width, int height)`.
- Produces: retained viewport position for a stable scroll node ID/kind, clamped by JUCE when its content extent shrinks.

- [ ] **Step 1: Add failing two-axis viewport tests**

Add a separate scroll fixture whose node has bounds `{20, 30, 180, 90}`, `scrollContentWidth = 420`, and `scrollContentHeight = 360`, with two row children and a final button at `{330, 300, 72, 28}`. Assert the rows are hosted by the viewed content component, then assert:

```cpp
auto* viewport = dynamic_cast<juce::Viewport*>(scroll->getChildComponent(0));
Require(viewport != nullptr, "scroll area owns a JUCE viewport");
Require(SurfaceBoundsOf(component, *scroll) == juce::Rectangle<int>(20, 30, 180, 90),
        "viewport keeps declared visible bounds");
Require(viewport->getViewedComponent()->getWidth() == 420 &&
            viewport->getViewedComponent()->getHeight() == 360,
        "scroll content uses declared two-axis extent");
Require(!SurfaceBoundsOf(component, *viewport).intersects(
            SurfaceBoundsOf(component, *finalButton)),
        "final button begins outside the visible viewport");
viewport->setViewPosition(240, 270);
Require(viewport->getViewPositionX() > 0 && viewport->getViewPositionY() > 0,
        "viewport scrolls on both axes");
Require(SurfaceBoundsOf(component, *viewport).intersects(
            SurfaceBoundsOf(component, *finalButton)),
        "final button is reachable after scrolling");
```

Refresh the same tree after scrolling and assert both view positions survive. Then shrink both extents to the viewport size, refresh, and assert JUCE clamps both positions to zero.

- [ ] **Step 2: Run the test and verify the viewport assertions fail**

Run:

```bash
make -C projects/synth/apps/miniapp test
```

Expected before implementation: the scroll component has no `juce::Viewport`, no distinct content extent, and cannot move to the final button.

- [ ] **Step 3: Implement the retained generic scroll host**

Add this nested component contract:

```cpp
class PortableScrollAreaComponent final : public juce::Component
{
public:
    PortableScrollAreaComponent();
    juce::Component& ContentComponent() noexcept;
    juce::Viewport& Viewport() noexcept;
    void SetSemantics(std::string variant, bool selected);
    void SetContentExtent(int width, int height);
    void resized() override;

private:
    SemanticPanelComponent content_;
    juce::Viewport viewport_;
};
```

The constructor calls `viewport_.setViewedComponent(&content_, false)`, enables both scrollbars, and adds the viewport. `resized()` fills the host with the viewport. `SetContentExtent` saves the current view position, sets content to `max(getWidth(), width)` by `max(getHeight(), height)`, then restores the saved position through `setViewPosition`, allowing JUCE to clamp it.

Create this class only for `NodeKind::ScrollArea`; in `SemanticHostFor`, return its `ContentComponent()` for direct scroll descendants. `UpdateControlFromNode` passes the node variant/selection and rounded declared extents. Keep the scroll host itself at the resolved viewport bounds.

- [ ] **Step 4: Run backend and complete JUCE coverage**

Run:

```bash
make -C projects/synth/apps/miniapp test
```

Expected: all generic hierarchy, drawing, focus, viewport extent, two-axis scrolling, refresh retention, and existing miniapp JUCE cases pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add projects/synth/juce/PortableJuceBackend.hpp projects/synth/juce/PortableJuceBackendTests.cpp
git commit -m "feat(synth): add generic JUCE scroll areas"
```

---

### Task 3: Production Controllers migration, obsolete renderer removal, and coverage

**Files:**
- Modify: `projects/synth/juce/RuntimeShellSessionTests.cpp`
- Modify: `projects/synth/juce/ControllersPageHarness.hpp`
- Modify: `projects/synth/juce/ControllersPageSimulationTests.cpp`
- Modify: `projects/synth/juce/ControllersHarnessApp.cpp`
- Modify: `projects/synth/apps/miniapp/Makefile`
- Modify: `projects/synth/runtime/juce_build.mk`
- Modify: `projects/synth/scripts/check_ui_boundary.sh`
- Modify: `projects/synth/apps/controllers_harness/README.md`
- Modify: `projects/synth/apps/miniapp/README.md`
- Modify: `projects/synth/README.md`
- Modify: `projects/synth/runtime/Runtime.hpp`
- Modify: `projects/synth/include/synth/Engine.hpp`
- Delete: `projects/synth/juce/ControllersPageJuce.hpp`
- Delete: `projects/synth/juce/ControllersPageJuceTests.cpp`
- Delete: `projects/synth/runtime/ControllersPage.hpp`
- Modify: `projects/synth/docs/coverage.md`

**Interfaces:**
- Consumes: production `synth_juce::PortableComponent`, `FindByNodeId`, `SurfaceBoundsForNode`, and JUCE viewport access from Tasks 1-2.
- Produces: one shared `SurfaceBoundsOf(surface, child)` helper wherever test code compares controls with different JUCE parents.
- Removes: `synth_runtime::ControllersTreeRenderer`, `ControllersPageHost`, the unused `runtime/ControllersPage.hpp` alias, and the `controllers_page_juce_tests` Make target.

- [ ] **Step 1: Add the real runtime-shell Controllers regression**

In `RuntimeShellSessionTests.cpp`, click `NodeIds::kSidebarControllers`, then require the shared renderer exposes Back, controller rows, Add row, status, and scroll. Compare `renderer.SurfaceBoundsForNode(...)` rectangles, not raw `getBounds()`, to prove the header controls end above the scroll viewport and controller rows have distinct surface y positions.

Obtain the viewport from the generic scroll component, assert `scrollContentHeight > viewport height`, move to the maximum vertical range with:

```cpp
viewport->setViewPosition(viewport->getViewPositionX(),
                          viewport->getViewedComponent()->getHeight() - viewport->getHeight());
```

Then assert the final mapping control's surface bounds intersect the viewport's surface bounds and the control remains enabled/editable.

- [ ] **Step 2: Run the shell test before migration**

Run:

```bash
make -C projects/synth/apps/miniapp test
```

Expected before completing the remaining migration: the new real-shell regression passes on the generic backend, while the suite still contains the obsolete specialized Controllers renderer test.

- [ ] **Step 3: Move harness and simulation to the production renderer**

Replace `#include "ControllersPageJuce.hpp"` with `#include "PortableJuceBackend.hpp"`. Change renderer members and parameters from `synth_runtime::ControllersTreeRenderer` to `synth_juce::PortableComponent`; construct with the existing `ControllersPageSurface`, set size, and call `RefreshFromSurface()` after fixture actions.

In simulation overlap checks, compute every rectangle as:

```cpp
const juce::Rectangle<int> bounds =
    renderer.getLocalArea(component, component->getLocalBounds());
```

This reconstructs common surface-space bounds across rows, viewport content, and root-hosted controls. Keep the seeded action sequence and all existing action/commit assertions.

- [ ] **Step 4: Remove the alternate renderer and update build/docs**

Delete `ControllersPageJuce.hpp`, `ControllersPageJuceTests.cpp`, and the unused `runtime/ControllersPage.hpp` alias. Remove the deleted runtime header from `runtime/juce_build.mk` and `scripts/check_ui_boundary.sh`. Remove `CONTROLLERS_PAGE_JUCE_TEST_SRC`, `CONTROLLERS_PAGE_JUCE_TEST`, its build rule, and its execution line from the miniapp Makefile. Update the harness README to state it uses `PortableComponent` over the real `ControllersPageSurface` on the production desktop path.

Replace stale references to the deleted files/renderer in `projects/synth/README.md`, `projects/synth/apps/miniapp/README.md`, `projects/synth/runtime/Runtime.hpp`, `projects/synth/include/synth/Engine.hpp`, and existing `projects/synth/docs/coverage.md` entries with the shared `ControllersPageSurface` plus generic `PortableComponent` production path.

Add `sprs-9`, `sprs-10`, and `sprs-11` coverage sections to `projects/synth/docs/coverage.md`, naming the exact backend, runtime-shell, and simulation test cases added in this change.

- [ ] **Step 5: Run the full verification matrix**

Run each command independently and require exit code zero:

```bash
make -C projects/synth test
make -C projects/synth/apps/miniapp test
make -C projects/synth/apps/controllers_harness
make -C projects/synth/browser test
bash projects/synth/scripts/check_ui_boundary.sh
openspec validate complete-generic-juce-ui-backend
```

Also run:

```bash
rg -n "ControllersTreeRenderer|ControllersPageHost|ControllersPageJuce|runtime/ControllersPage.hpp" projects/synth
rg -n "runtime_ui::NodeIds|ControllersLayout|ControllersPage" projects/synth/juce/PortableJuceBackend.hpp
```

Expected: both searches return no matches; the first proves the alternate renderer is gone, and the second proves the generic boundary has no Controllers-specific branches.

- [ ] **Step 6: Mark OpenSpec tasks complete and commit Task 3**

Change all six checkboxes in `openspec/changes/complete-generic-juce-ui-backend/tasks.md` to checked only after the commands in Step 5 pass, then commit:

```bash
git add projects/synth/juce projects/synth/runtime projects/synth/scripts/check_ui_boundary.sh projects/synth/include/synth/Engine.hpp projects/synth/apps/miniapp projects/synth/apps/controllers_harness/README.md projects/synth/README.md projects/synth/docs/coverage.md openspec/changes/complete-generic-juce-ui-backend/tasks.md
git commit -m "test(synth): verify generic JUCE Controllers path"
```
