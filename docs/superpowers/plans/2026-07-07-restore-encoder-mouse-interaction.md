# Restore Encoder Mouse Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the pre-abstraction mouse drag and double-click behavior for miniapp encoders rendered through the portable JUCE backend.

**Architecture:** Add minimal host-neutral pointer drag metadata to portable draw nodes, mark miniapp encoder draw nodes with drag and double-click actions, keep synth message creation in the JUCE-free miniapp surface, and let the JUCE backend translate toolkit mouse events into portable actions through transparent retained overlays.

**Tech Stack:** C++20, synth portable UI headers, miniapp JUCE-free UI/model code, JUCE desktop backend tests, OpenSpec `restore-encoder-mouse-interaction`.

## Global Constraints

- Requirement `sru-18`: WHEN a miniapp encoder is rendered through the portable UI layer on the JUCE desktop backend, THE runtime UI layer SHALL preserve the pre-abstraction encoder mouse interaction behavior: mouse drag over the encoder dispatches a relative parameter increment/decrement for that encoder's bound slot and position using the existing `(deltaX - deltaY) * sensitivity` gesture mapping, and mouse double-click dispatches the encoder push action for that same slot and position; the portable tree producer SHALL remain JUCE-free and the JUCE backend SHALL only translate toolkit mouse events into portable actions.
- The portable UI model and miniapp encoder tree builder must compile without JUCE headers.
- The JUCE backend may translate mouse events, but it must not push `synth::MessageIn` directly.
- Preserve the old `EncoderComponent` constants: drag sensitivity `0.0025f` and drag threshold `0.001f`.
- Do not change encoder visuals, miniapp layout, controller-page behavior, patch formats, MIDI profile formats, DSP, or engine message semantics.

---

## File Structure

- Modify `projects/synth/include/synth/PortableUI.hpp`: add `pointerDragAction` metadata to `synth::ui::Node`.
- Modify `projects/synth/include/synth/PortableUIBuilders.hpp`: add a builder overload for interactive draw nodes while keeping existing `Draw(...)` overloads intact.
- Modify `projects/synth/apps/miniapp/MiniAppUiModel.hpp`: add encoder action names, gesture value helpers, and `DispatchMiniAppAction` cases for encoder drag/push messages.
- Modify `projects/synth/apps/miniapp/MiniAppUI.hpp`: mark encoder draw nodes with pointer drag and double-click actions.
- Modify `projects/synth/tests/miniapp_system_tests.cpp`: add JUCE-free contract and action-routing regressions.
- Modify `projects/synth/juce/PortableJuceBackend.hpp`: add transparent overlay components for interactive draw nodes and route mouse gestures through `Surface::DispatchAction`.
- Modify `projects/synth/juce/MiniAppJuceBackendParityTests.cpp`: add active JUCE backend mouse gesture regression coverage.
- Modify `openspec/changes/restore-encoder-mouse-interaction/tasks.md`: check off tasks only after implementation, review, and verification.

### Task 1: Portable Contract and JUCE-Free Miniapp Tests

**Files:**
- Modify: `projects/synth/include/synth/PortableUI.hpp`
- Modify: `projects/synth/include/synth/PortableUIBuilders.hpp`
- Modify: `projects/synth/apps/miniapp/MiniAppUiModel.hpp`
- Modify: `projects/synth/tests/miniapp_system_tests.cpp`

**Interfaces:**
- Produces: `synth::ui::Node::pointerDragAction`, an `std::optional<synth::ui::Action>`.
- Produces: `synth::ui::Builder::DrawInteractive(std::string id, Bounds bounds, std::vector<DrawCommand> commands, Action pointerDragAction, std::optional<Action> doubleClickAction)`.
- Produces: `synth_miniapp::MiniAppActions::kEncoderDrag`, `synth_miniapp::MiniAppActions::kEncoderPush`, `synth_miniapp::FormatEncoderGestureValue(std::size_t slotIx, std::size_t position, float delta)`, and `synth_miniapp::ParseEncoderGestureValue(const std::string&, std::size_t&, std::size_t&, float&)`.
- Later tasks consume these exact names.

- [ ] **Step 1: Write failing JUCE-free tests**

Add these helpers near existing test helpers in `projects/synth/tests/miniapp_system_tests.cpp`:

```cpp
void RequireAction(const std::optional<synth::ui::Action>& action, const char* expectedName)
{
    REQUIRE_TRUE(action.has_value());
    REQUIRE_TRUE(action->name == expectedName);
}
```

Extend `miniapp_portable_surface_exposes_stable_ids_and_routes_actions` after the existing encoder node ID checks:

```cpp
const synth::ui::Node* encoder0 = FindNodeById(tree, "miniapp.encoder.0");
REQUIRE_TRUE(encoder0 != nullptr);
REQUIRE_TRUE(encoder0->kind == synth::ui::NodeKind::Draw);
RequireAction(encoder0->pointerDragAction, synth_miniapp::MiniAppActions::kEncoderDrag);
RequireAction(encoder0->doubleClickAction, synth_miniapp::MiniAppActions::kEncoderPush);
std::size_t encodedSlot = 999;
std::size_t encodedPosition = 999;
float encodedDelta = 999.0f;
REQUIRE_TRUE(synth_miniapp::ParseEncoderGestureValue(
    synth_miniapp::FormatEncoderGestureValue(0, 0, 0.25f),
    encodedSlot,
    encodedPosition,
    encodedDelta));
REQUIRE_TRUE(encodedSlot == 0);
REQUIRE_TRUE(encodedPosition == 0);
REQUIRE_NEAR(encodedDelta, 0.25f, 1e-6f);
```

Add these action-routing checks after the existing `"miniapp.random_mod"` assertion in the same test:

```cpp
surface.DispatchAction(synth::ui::Action::WithValue(
    synth_miniapp::MiniAppActions::kEncoderDrag,
    synth_miniapp::FormatEncoderGestureValue(0, 3, 0.125f)));
REQUIRE_TRUE(PopNextMessage(uiBus, message));
REQUIRE_TRUE(message.type == synth::MessageIn::Type::ParamIncDec);
REQUIRE_TRUE(message.slotIx == 0);
REQUIRE_TRUE(message.position == 3);
REQUIRE_NEAR(message.delta, 0.125f, 1e-6f);
REQUIRE_TRUE(message.timestamp == 1010);

surface.DispatchAction(synth::ui::Action::WithValue(
    synth_miniapp::MiniAppActions::kEncoderPush,
    synth_miniapp::FormatEncoderGestureValue(0, 3, 0.0f)));
REQUIRE_TRUE(PopNextMessage(uiBus, message));
REQUIRE_TRUE(message.type == synth::MessageIn::Type::ParamPush);
REQUIRE_TRUE(message.slotIx == 0);
REQUIRE_TRUE(message.position == 3);
REQUIRE_TRUE(message.timestamp == 1011);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`

Expected: compile failure mentioning missing `pointerDragAction`, `kEncoderDrag`, `kEncoderPush`, `FormatEncoderGestureValue`, or `ParseEncoderGestureValue`.

- [ ] **Step 3: Add portable metadata and helpers**

In `projects/synth/include/synth/PortableUI.hpp`, add this field to `struct Node` immediately after `std::optional<Action> action;`:

```cpp
std::optional<Action> pointerDragAction;
```

In `projects/synth/include/synth/PortableUIBuilders.hpp`, add this method below the existing `Draw(std::string id, Bounds bounds, std::vector<DrawCommand> commands)` overload:

```cpp
Builder& DrawInteractive(std::string id,
                         Bounds bounds,
                         std::vector<DrawCommand> commands,
                         Action pointerDragAction,
                         std::optional<Action> doubleClickAction = std::nullopt) {
    Node node;
    node.id = NodeId(std::move(id));
    node.kind = NodeKind::Draw;
    node.bounds = bounds;
    node.drawCommands = std::move(commands);
    node.pointerDragAction = std::move(pointerDragAction);
    node.doubleClickAction = std::move(doubleClickAction);
    AppendChild(node);
    return *this;
}
```

Add `#include <optional>` to `PortableUIBuilders.hpp`.

In `projects/synth/apps/miniapp/MiniAppUiModel.hpp`, add these action names inside `namespace MiniAppActions`:

```cpp
inline constexpr const char* kEncoderDrag = "miniapp.encoder.drag";
inline constexpr const char* kEncoderPush = "miniapp.encoder.push";
```

Add these helpers near `ParseFloat`:

```cpp
inline std::string FormatEncoderGestureValue(std::size_t slotIx, std::size_t position, float delta)
{
    return std::to_string(slotIx) + ":" + std::to_string(position) + ":" + std::to_string(delta);
}

inline bool ParseEncoderGestureValue(const std::string& value,
                                     std::size_t& slotIx,
                                     std::size_t& position,
                                     float& delta)
{
    const std::size_t first = value.find(':');
    if (first == std::string::npos)
    {
        return false;
    }
    const std::size_t second = value.find(':', first + 1);
    if (second == std::string::npos)
    {
        return false;
    }

    const std::string slotToken = value.substr(0, first);
    const std::string positionToken = value.substr(first + 1, second - first - 1);
    const std::string deltaToken = value.substr(second + 1);
    const std::size_t parsedSlot = ParseSize(slotToken, std::numeric_limits<std::size_t>::max());
    const std::size_t parsedPosition = ParseSize(positionToken, std::numeric_limits<std::size_t>::max());
    const float parsedDelta = ParseFloat(deltaToken, std::numeric_limits<float>::quiet_NaN());
    if (parsedSlot == std::numeric_limits<std::size_t>::max() ||
        parsedPosition == std::numeric_limits<std::size_t>::max() ||
        !std::isfinite(parsedDelta))
    {
        return false;
    }

    slotIx = parsedSlot;
    position = parsedPosition;
    delta = parsedDelta;
    return true;
}
```

Add `#include <cmath>` and `#include <limits>` to `MiniAppUiModel.hpp`.

- [ ] **Step 4: Run test to verify current partial implementation still fails only on missing encoder node metadata/routing**

Run: `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`

Expected: compile passes, then runtime fails on the metadata assertions because Task 2 has not marked encoder nodes interactive yet.

- [ ] **Step 5: Commit**

Run:

```bash
git add projects/synth/include/synth/PortableUI.hpp \
        projects/synth/include/synth/PortableUIBuilders.hpp \
        projects/synth/apps/miniapp/MiniAppUiModel.hpp \
        projects/synth/tests/miniapp_system_tests.cpp
git commit -m "test: define portable encoder pointer actions"
```

### Task 2: Miniapp Encoder Action Routing

**Files:**
- Modify: `projects/synth/apps/miniapp/MiniAppUI.hpp`
- Modify: `projects/synth/apps/miniapp/MiniAppUiModel.hpp`
- Modify: `projects/synth/tests/miniapp_system_tests.cpp`

**Interfaces:**
- Consumes: `Node::pointerDragAction`, `Builder::DrawInteractive(...)`, `MiniAppActions::kEncoderDrag`, `MiniAppActions::kEncoderPush`, and encoder gesture helper functions from Task 1.
- Produces: miniapp encoder draw nodes with drag/push actions and `DispatchMiniAppAction` routes to `MessageIn::ParamIncDec` / `MessageIn::ParamPush`.

- [ ] **Step 1: Confirm failing test from Task 1**

Run: `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`

Expected: failure because encoder nodes are not yet interactive or encoder actions do not yet push messages.

- [ ] **Step 2: Mark encoder nodes interactive**

In `projects/synth/apps/miniapp/MiniAppUI.hpp`, replace:

```cpp
builder.Draw(MiniAppNodeIds::Encoder(ix), encoderBounds, std::move(drawCommands));
```

with:

```cpp
builder.DrawInteractive(
    MiniAppNodeIds::Encoder(ix),
    encoderBounds,
    std::move(drawCommands),
    synth::ui::Action::WithValue(
        MiniAppActions::kEncoderDrag,
        FormatEncoderGestureValue(0, ix, 0.0f)),
    synth::ui::Action::WithValue(
        MiniAppActions::kEncoderPush,
        FormatEncoderGestureValue(0, ix, 0.0f)));
```

- [ ] **Step 3: Route encoder actions to synth messages**

In `DispatchMiniAppAction` in `projects/synth/apps/miniapp/MiniAppUiModel.hpp`, add these cases before the final `return false;`:

```cpp
if (action.name == MiniAppActions::kEncoderDrag)
{
    std::size_t slotIx = 0;
    std::size_t position = 0;
    float delta = 0.0f;
    if (!ParseEncoderGestureValue(action.value, slotIx, position, delta) || std::fabs(delta) < 0.001f)
    {
        return false;
    }
    pushMessage(synth::MessageIn::ParamIncDec(timestamp, slotIx, position, delta));
    return true;
}
if (action.name == MiniAppActions::kEncoderPush)
{
    std::size_t slotIx = 0;
    std::size_t position = 0;
    float delta = 0.0f;
    if (!ParseEncoderGestureValue(action.value, slotIx, position, delta))
    {
        return false;
    }
    pushMessage(synth::MessageIn::ParamPush(timestamp, slotIx, position));
    return true;
}
```

- [ ] **Step 4: Run JUCE-free miniapp tests**

Run: `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`

Expected: `miniapp_system_tests passed`.

- [ ] **Step 5: Commit**

Run:

```bash
git add projects/synth/apps/miniapp/MiniAppUI.hpp \
        projects/synth/apps/miniapp/MiniAppUiModel.hpp \
        projects/synth/tests/miniapp_system_tests.cpp
git commit -m "fix: route portable encoder actions"
```

### Task 3: JUCE Backend Interactive Draw Overlay

**Files:**
- Modify: `projects/synth/juce/PortableJuceBackend.hpp`
- Modify: `projects/synth/juce/MiniAppJuceBackendParityTests.cpp`

**Interfaces:**
- Consumes: `Node::pointerDragAction` and `Node::doubleClickAction`.
- Produces: `PortableComponent::FindByNodeId(...)` returns the transparent overlay component for interactive draw nodes.
- Produces: JUCE mouse drag values using `(deltaX - deltaY) * 0.0025f`, ignoring `std::abs(delta) < 0.001f`.

- [ ] **Step 1: Write failing JUCE backend test**

In `projects/synth/juce/MiniAppJuceBackendParityTests.cpp`, after the scene blend slider assertion, add:

```cpp
auto* encoder = component.FindByNodeId(synth_miniapp::MiniAppNodeIds::Encoder(0));
Require(encoder != nullptr, "encoder interactive overlay is hosted");
const juce::Point<float> downPoint(20.0f, 20.0f);
const juce::Point<float> dragPoint(30.0f, 10.0f);
juce::MouseEvent downEvent(juce::MouseInputSource(),
                           downPoint,
                           juce::ModifierKeys::leftButtonModifier,
                           1.0f,
                           1.0f,
                           1.0f,
                           1.0f,
                           1.0f,
                           encoder,
                           encoder,
                           juce::Time::getCurrentTime(),
                           downPoint,
                           juce::Time::getCurrentTime(),
                           1,
                           false);
encoder->mouseDown(downEvent);
juce::MouseEvent dragEvent(juce::MouseInputSource(),
                           dragPoint,
                           juce::ModifierKeys::leftButtonModifier,
                           1.0f,
                           1.0f,
                           1.0f,
                           1.0f,
                           1.0f,
                           encoder,
                           encoder,
                           juce::Time::getCurrentTime(),
                           downPoint,
                           juce::Time::getCurrentTime(),
                           1,
                           false);
encoder->mouseDrag(dragEvent);
Require(uiBus.Pop(message, std::numeric_limits<std::uint64_t>::max()), "encoder drag message is queued");
Require(message.type == synth::MessageIn::Type::ParamIncDec, "encoder drag routes inc/dec");
Require(message.slotIx == 0, "encoder drag slot");
Require(message.position == 0, "encoder drag position");
RequireNear(message.delta, 0.05f, 0.0001f, "encoder drag delta");
Require(message.timestamp == 503, "encoder drag uses timestamp provider");

encoder->mouseDoubleClick(downEvent);
Require(uiBus.Pop(message, std::numeric_limits<std::uint64_t>::max()), "encoder push message is queued");
Require(message.type == synth::MessageIn::Type::ParamPush, "encoder double-click routes push");
Require(message.slotIx == 0, "encoder push slot");
Require(message.position == 0, "encoder push position");
Require(message.timestamp == 504, "encoder push uses timestamp provider");
```

If the local JUCE version rejects this `MouseEvent` constructor, inspect nearby tests for the accepted constructor and adapt only the event construction, not the assertions or expected behavior.

- [ ] **Step 2: Run test to verify it fails**

Run: `make -C projects/synth/apps/miniapp build/miniapp_juce_backend_parity_tests && projects/synth/apps/miniapp/build/miniapp_juce_backend_parity_tests`

Expected: failure because `FindByNodeId("miniapp.encoder.0")` returns null or a non-interactive component.

- [ ] **Step 3: Add interactive draw component**

In `projects/synth/juce/PortableJuceBackend.hpp`, no new include should be needed for this task; existing `<cmath>`, `<string>`, `<functional>`, and `<optional>` coverage is sufficient.

Inside `PortableComponent`, add these constants near the default size constants:

```cpp
static constexpr float kPointerDragSensitivity = 0.0025f;
static constexpr float kPointerDragThreshold = 0.001f;
```

Add this nested class below `SemanticTextButton`:

```cpp
class InteractiveDrawComponent final : public juce::Component
{
public:
    explicit InteractiveDrawComponent(std::function<void(const synth::ui::NodeId&, float)> dragDispatch,
                                      std::function<void(const synth::ui::NodeId&)> doubleClickDispatch)
        : dragDispatch_(std::move(dragDispatch))
        , doubleClickDispatch_(std::move(doubleClickDispatch))
    {
        setInterceptsMouseClicks(true, true);
        setPaintingIsUnclipped(true);
    }

    void SetNodeId(synth::ui::NodeId id)
    {
        id_ = std::move(id);
    }

    void paint(juce::Graphics&) override {}

    void mouseDown(const juce::MouseEvent& event) override
    {
        lastMousePosition_ = event.position;
    }

    void mouseDrag(const juce::MouseEvent& event) override
    {
        const auto deltaPoint = event.position - lastMousePosition_;
        const float delta = (deltaPoint.x - deltaPoint.y) * kPointerDragSensitivity;
        if (std::abs(delta) < kPointerDragThreshold)
        {
            return;
        }
        if (dragDispatch_)
        {
            dragDispatch_(id_, delta);
        }
        lastMousePosition_ = event.position;
    }

    void mouseDoubleClick(const juce::MouseEvent&) override
    {
        if (doubleClickDispatch_)
        {
            doubleClickDispatch_(id_);
        }
    }

private:
    synth::ui::NodeId id_;
    juce::Point<float> lastMousePosition_;
    std::function<void(const synth::ui::NodeId&, float)> dragDispatch_;
    std::function<void(const synth::ui::NodeId&)> doubleClickDispatch_;
};
```

- [ ] **Step 4: Make draw nodes renderable only when interactive**

In `IsRenderableKind`, add `Draw` only through node inspection, not globally. Do not return true for all `Draw` nodes. Instead, in `RebuildControls`, after `CollectRenderableDescendants(*root);`, append interactive draw node IDs to `m_renderedNodeIds`.

Add helper:

```cpp
bool IsInteractiveDrawNode(const synth::ui::Node& node) const
{
    return node.kind == synth::ui::NodeKind::Draw &&
           (node.pointerDragAction.has_value() || node.doubleClickAction.has_value());
}
```

In `CollectRenderableDescendants`, when `node->kind == synth::ui::NodeKind::Draw`, keep the existing `m_drawNodeIndices.push_back(...)`, and add:

```cpp
if (IsInteractiveDrawNode(*node))
{
    m_renderedNodeIds.push_back(node->id);
}
```

In `IsRenderableKind`, include:

```cpp
case synth::ui::NodeKind::Draw:
    return true;
```

This is acceptable because only interactive draw IDs are added to `m_renderedNodeIds`.

- [ ] **Step 5: Create and update interactive draw controls**

In `CreateControlForNode`, add this case:

```cpp
case synth::ui::NodeKind::Draw:
{
    auto overlay = std::make_unique<InteractiveDrawComponent>(
        [this](const synth::ui::NodeId& id, float delta) {
            DispatchCurrentNodePointerDragAction(id, delta);
        },
        [this](const synth::ui::NodeId& id) {
            DispatchCurrentNodeDoubleClickAction(id);
        });
    overlay->SetNodeId(node.id);
    return overlay;
}
```

Add this method near `DispatchCurrentNodeActionWithValue`:

```cpp
void DispatchCurrentNodePointerDragAction(const synth::ui::NodeId& id, float delta)
{
    const synth::ui::Node* node = FindNode(id);
    if (node == nullptr || !node->pointerDragAction.has_value())
    {
        return;
    }
    synth::ui::Action dispatched = *node->pointerDragAction;
    if (!dispatched.value.empty())
    {
        const std::size_t lastColon = dispatched.value.rfind(':');
        if (lastColon != std::string::npos)
        {
            dispatched.value = dispatched.value.substr(0, lastColon + 1) + std::to_string(delta);
        }
    }
    DispatchBackendAction(dispatched);
}
```

In `UpdateControlFromNode`, add:

```cpp
case synth::ui::NodeKind::Draw:
{
    auto& overlay = static_cast<InteractiveDrawComponent&>(component);
    overlay.SetNodeId(node.id);
    break;
}
```

- [ ] **Step 6: Run JUCE backend test**

Run: `make -C projects/synth/apps/miniapp build/miniapp_juce_backend_parity_tests && projects/synth/apps/miniapp/build/miniapp_juce_backend_parity_tests`

Expected: `MiniApp JUCE backend parity tests passed`.

- [ ] **Step 7: Run portable backend test**

Run: `make -C projects/synth/apps/miniapp build/portable_juce_backend_tests && projects/synth/apps/miniapp/build/portable_juce_backend_tests`

Expected: `PortableJuceBackendTests passed`.

- [ ] **Step 8: Commit**

Run:

```bash
git add projects/synth/juce/PortableJuceBackend.hpp \
        projects/synth/juce/MiniAppJuceBackendParityTests.cpp
git commit -m "fix: restore JUCE encoder mouse gestures"
```

### Task 4: Verification and OpenSpec Progress Sync

**Files:**
- Modify: `openspec/changes/restore-encoder-mouse-interaction/tasks.md`

**Interfaces:**
- Consumes: implementation from Tasks 1-3.
- Produces: verified task checkboxes and a clean working implementation.

- [ ] **Step 1: Run full JUCE-free synth tests**

Run: `make -C projects/synth test`

Expected: all listed test binaries complete successfully, including `miniapp_system_tests`, `portable_ui_tests`, and `controllers_page_ui_tests`.

- [ ] **Step 2: Run JUCE miniapp/backend tests**

Run: `make -C projects/synth/apps/miniapp test`

Expected: all listed JUCE test binaries complete successfully, including `encoder_component_geometry_tests`, `portable_juce_backend_tests`, and `miniapp_juce_backend_parity_tests`.

- [ ] **Step 3: Run UI boundary check**

Run: `make -C projects/synth check-ui-boundary`

Expected: boundary script exits 0 and reports no JUCE include leaks.

- [ ] **Step 4: Update OpenSpec task checkboxes**

In `openspec/changes/restore-encoder-mouse-interaction/tasks.md`, mark all 19 task checkboxes complete only after Steps 1-3 pass.

- [ ] **Step 5: Confirm OpenSpec status**

Run: `openspec instructions apply --change "restore-encoder-mouse-interaction" --json`

Expected: `"complete": 19` and `"remaining": 0` in the `progress` object.

- [ ] **Step 6: Commit verification sync**

Run:

```bash
git add openspec/changes/restore-encoder-mouse-interaction/tasks.md
git commit -m "chore: mark encoder interaction OpenSpec tasks complete"
```

---

## Self-Review

- Spec coverage: Task 1 covers host-neutral metadata and JUCE-free inspectability; Task 2 covers `ParamIncDec` and `ParamPush` routing; Task 3 covers JUCE mouse event translation and old drag math; Task 4 covers verification and OpenSpec progress.
- Placeholder scan: no TBD/TODO/fill-in-later instructions remain. The only constructor caveat is bounded to local JUCE API compatibility and preserves the same asserted behavior.
- Type consistency: `pointerDragAction`, `DrawInteractive`, `kEncoderDrag`, `kEncoderPush`, `FormatEncoderGestureValue`, and `ParseEncoderGestureValue` are introduced before use and referenced with matching names across tasks.
