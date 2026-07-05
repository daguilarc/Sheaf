# Decouple Synth UI From JUCE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move synth application and runtime-page UI production onto a JUCE-free portable UI contract while keeping the existing JUCE desktop miniapp behavior and preserving Controllers page functionality.

**Architecture:** Add a synth-owned portable UI model for semantic controls plus canvas-like draw commands, then make the JUCE desktop app a backend consumer of that model. Keep JUCE in `projects/synth/juce` plus explicit desktop host files, keep runtime/audio/MIDI/file I/O in the JUCE runtime, and keep Controllers behavior rooted in the existing JUCE-free `MidiConfigViewModel`.

**Tech Stack:** C++20, existing Makefile build, synth core headers under `projects/synth/include/synth`, desktop backend under `projects/synth/juce`, OpenSpec change `decouple-synth-ui-from-juce`, xagent implementer subagents, Claude Opus spec/code reviewers.

---

## Source Of Truth

- OpenSpec proposal: `openspec/changes/decouple-synth-ui-from-juce/proposal.md`
- OpenSpec design: `openspec/changes/decouple-synth-ui-from-juce/design.md`
- Runtime spec deltas: `openspec/changes/decouple-synth-ui-from-juce/specs/synth-runtime-ui/spec.md`
- Application runtime spec deltas: `openspec/changes/decouple-synth-ui-from-juce/specs/synth-app-runtime/spec.md`
- OpenSpec tasks: `openspec/changes/decouple-synth-ui-from-juce/tasks.md`

## Execution Rules

- Use xagent for implementation tasks. Use a fresh subagent for each task and do not dispatch overlapping tasks in parallel.
- Use Claude Opus through xagent for every spec compliance review and every code quality review:

```bash
plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "<review prompt>"
```

- Review order is mandatory for each task: implementer self-review, Claude Opus spec review, fixes, Claude Opus code-quality review, fixes, verification.
- Update OpenSpec task checkboxes only after the corresponding implementation task is complete, reviewed, and verified.
- Do not move DSP, patch persistence, audio callback ownership, MIDI device ownership, or file chooser ownership into the portable UI layer.

## File Structure

- Create `projects/synth/include/synth/PortableUI.hpp`: JUCE-free geometry, color, text, draw commands, input events, semantic nodes, stable IDs, surface/action sink contracts.
- Create `projects/synth/include/synth/PortableUIBuilders.hpp`: small helpers for building semantic node trees without exposing backend concerns.
- Create `projects/synth/tests/portable_ui_tests.cpp`: JUCE-free compile and behavior tests for primitives, controls, draw commands, and application concept checks.
- Create `projects/synth/apps/miniapp/MiniAppUI.hpp`: JUCE-free miniapp UI surface, layout, action routing, UI-state refresh model, and draw/control descriptions.
- Modify `projects/synth/apps/miniapp/MiniApp.hpp`: make `MiniApp` expose `PortableSurface()` and remove all direct `juce::` usage from application-facing miniapp UI.
- Create `projects/synth/juce/PortableJuceBackend.hpp`: JUCE component adapter for portable surfaces, semantic controls, repaint, focus, geometry, and event dispatch.
- Create `projects/synth/juce/MiniAppJuceSurface.hpp`: JUCE adapter registration/helpers for miniapp-specific draw nodes if the generic backend needs widget-specific paint behavior.
- Create `projects/synth/include/synth/RuntimePages.hpp`: JUCE-free sidebar, page selection, Audio page, File page, and page-action presentation models.
- Create `projects/synth/juce/RuntimePagesJuce.hpp`: JUCE renderer/backend handoff for main pane, sidebar, Audio page, and File page.
- Create `projects/synth/include/synth/ControllersPagePresentation.hpp` and `projects/synth/src/ControllersPagePresentation.cpp`: DOM-friendly semantic tree over `MidiConfigViewModel`.
- Create `projects/synth/juce/ControllersPageComponent.hpp`: JUCE renderer for the Controllers semantic tree.
- Modify `projects/synth/runtime/MainPane.hpp`, `AudioConfigPage.hpp`, `FilePage.hpp`, and `ControllersPage.hpp`: turn old runtime UI headers into either deleted/moved code or thin JUCE-owned compatibility includes, with real renderer code under `projects/synth/juce`.
- Modify `projects/synth/runtime/Runtime.hpp` and `Shell.hpp`: host portable app surfaces through the JUCE backend while keeping JUCE audio/MIDI/timer lifecycle.
- Create `projects/synth/scripts/check_ui_boundary.sh`: source-boundary check for disallowed JUCE includes/usages.
- Modify `projects/synth/Makefile`, `projects/synth/apps/miniapp/Makefile`, and `projects/synth/runtime/juce_build.mk`: add new tests, sources, and backend headers.
- Update `projects/synth/README.md` or create it if missing, plus miniapp docs if present, to explain the portable UI contract and Wasm/browser boundary.

## Task 1: Portable UI Contract

Implements OpenSpec tasks 1.1, 1.2, 1.3, and most of 1.4.

**Files:**
- Create: `projects/synth/include/synth/PortableUI.hpp`
- Create: `projects/synth/include/synth/PortableUIBuilders.hpp`
- Create: `projects/synth/tests/portable_ui_tests.cpp`
- Modify: `projects/synth/include/synth/AppConcepts.hpp`
- Modify: `projects/synth/Makefile`
- Modify: `projects/synth/README.md` or create it

- [ ] **Step 1: Add a failing portable UI test**

Add `projects/synth/tests/portable_ui_tests.cpp` with these checks:

```cpp
#include "synth/AppConcepts.hpp"
#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"

#include <stdexcept>
#include <string>

#ifdef JUCE_MAJOR_VERSION
#error "portable UI tests must not see JUCE"
#endif

namespace {

void Require(bool condition, const char* label) {
    if (!condition) {
        throw std::runtime_error(label);
    }
}

struct TestApp {
    static synth::RuntimeConfig Config() { return {}; }
    void Init(synth::AppContext*) {}
    void ProcessBlock(synth::AudioBlock&) {}
    synth::ui::Surface& PortableSurface() { return surface; }
    synth::ui::Surface surface;
};

}  // namespace

int main() {
    static_assert(synth::SynthApplication<TestApp>);
    static_assert(!synth::ui::kPortableUiUsesJuce);

    synth::ui::Builder builder;
    builder.Root("root", synth::ui::Bounds{0.0f, 0.0f, 640.0f, 480.0f})
        .Label("title", "Synth Params")
        .Button("start", "Start", synth::ui::Action::Named("start"))
        .Toggle("gesture", "Gesture", true, synth::ui::Action::Named("gesture.toggle"))
        .Slider("blend", "Blend", 0.25f, 0.0f, 1.0f, 0.001f, synth::ui::Action::Named("blend.set"))
        .ComboBox("device", "Device", {{"a", "Built In"}, {"b", "External"}}, "a",
                  synth::ui::Action::Named("device.select"))
        .TextField("value", "Value", "64", synth::ui::Action::Named("value.commit"))
        .Draw("scope", synth::ui::Bounds{10.0f, 10.0f, 100.0f, 80.0f},
              {synth::ui::DrawCommand::Fill(synth::ui::Color::Rgb(24, 26, 28)),
               synth::ui::DrawCommand::Line({0.0f, 0.0f}, {100.0f, 80.0f}, synth::ui::Color::Rgb(255, 255, 255), 1.0f)});

    const synth::ui::NodeTree tree = builder.Build();
    Require(tree.nodes.size() == 8, "tree should contain root plus seven children");
    Require(tree.nodes[0].id == synth::ui::NodeId("root"), "root id");
    Require(tree.nodes[7].drawCommands.size() == 2, "draw commands");
    return 0;
}
```

- [ ] **Step 2: Run the failing test target**

Run: `make -C projects/synth build/portable_ui_tests`

Expected: fail because `PortableUI.hpp`, `PortableUIBuilders.hpp`, and `PortableSurface()` concept support do not exist yet.

- [ ] **Step 3: Implement portable primitives**

Create `PortableUI.hpp` with:

```cpp
#pragma once

#include "synth/AppContext.hpp"

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

namespace synth::ui {

inline constexpr bool kPortableUiUsesJuce = false;

struct NodeId {
    std::string value;
    NodeId() = default;
    explicit NodeId(std::string v) : value(std::move(v)) {}
    NodeId(const char* v) : value(v) {}
    friend bool operator==(const NodeId&, const NodeId&) = default;
};

struct Point {
    float x = 0.0f;
    float y = 0.0f;
};

struct Bounds {
    float x = 0.0f;
    float y = 0.0f;
    float width = 0.0f;
    float height = 0.0f;
};

struct Color {
    std::uint8_t r = 0;
    std::uint8_t g = 0;
    std::uint8_t b = 0;
    std::uint8_t a = 255;
    static constexpr Color Rgb(std::uint8_t red, std::uint8_t green, std::uint8_t blue) {
        return Color{red, green, blue, 255};
    }
    static constexpr Color Rgba(std::uint8_t red, std::uint8_t green, std::uint8_t blue, std::uint8_t alpha) {
        return Color{red, green, blue, alpha};
    }
};

enum class TextAlign { Left, Center, Right };

struct TextStyle {
    float size = 14.0f;
    Color color = Color::Rgb(255, 255, 255);
    TextAlign align = TextAlign::Left;
};

struct Action {
    std::string name;
    std::string value;
    static Action Named(std::string actionName) { return Action{std::move(actionName), {}}; }
    static Action WithValue(std::string actionName, std::string actionValue) {
        return Action{std::move(actionName), std::move(actionValue)};
    }
};

struct ControlOption {
    std::string id;
    std::string label;
};

struct DrawCommand {
    enum class Kind { Fill, StrokeRect, Line, Arc, Text };
    Kind kind = Kind::Fill;
    Bounds bounds{};
    Point from{};
    Point to{};
    Color color{};
    float strokeWidth = 1.0f;
    float startRadians = 0.0f;
    float endRadians = 0.0f;
    std::string text;
    TextStyle textStyle{};

    static DrawCommand Fill(Color color);
    static DrawCommand StrokeRect(Bounds bounds, Color color, float strokeWidth);
    static DrawCommand Line(Point from, Point to, Color color, float strokeWidth);
    static DrawCommand Arc(Bounds bounds, float startRadians, float endRadians, Color color, float strokeWidth);
    static DrawCommand Text(Bounds bounds, std::string text, TextStyle style);
};

enum class NodeKind { Root, Row, Section, ScrollArea, Label, Button, Toggle, Slider, ComboBox, TextField, StatusText, Draw };

struct Node {
    NodeId id;
    NodeKind kind = NodeKind::Label;
    Bounds bounds{};
    std::string label;
    std::string text;
    bool checked = false;
    float value = 0.0f;
    float minValue = 0.0f;
    float maxValue = 1.0f;
    float step = 0.001f;
    std::vector<ControlOption> options;
    std::string selectedOption;
    std::optional<Action> action;
    std::vector<NodeId> children;
    std::vector<DrawCommand> drawCommands;
};

struct NodeTree {
    std::vector<Node> nodes;
};

class Surface {
public:
    using ActionHandler = std::function<void(const Action&)>;
    virtual ~Surface() = default;
    virtual NodeTree BuildTree() = 0;
    virtual void SetActionHandler(ActionHandler handler) = 0;
};

}  // namespace synth::ui
```

Put inline factory bodies either in the same header below the declarations or in a private inline section in `PortableUIBuilders.hpp`.

- [ ] **Step 4: Implement the builder helper**

Create `PortableUIBuilders.hpp` with a simple append-only `Builder` that stores nodes in preorder, appends children to the current root, and returns `NodeTree`. The API must match the test in Step 1.

- [ ] **Step 5: Update the application concept**

Modify `projects/synth/include/synth/AppConcepts.hpp` so `SynthApplication` requires `app.PortableSurface()` returning `synth::ui::Surface&`. Include `synth/PortableUI.hpp`. Keep `SynthApplicationCore` unchanged.

- [ ] **Step 6: Wire the test into the Makefile**

Add:

```make
PORTABLE_UI_TEST_BIN := $(BUILD_DIR)/portable_ui_tests

$(PORTABLE_UI_TEST_BIN): tests/portable_ui_tests.cpp include/synth/PortableUI.hpp include/synth/PortableUIBuilders.hpp include/synth/AppConcepts.hpp $(LIB)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(LIB) -o $@
```

Add `$(PORTABLE_UI_TEST_BIN)` to the `test` prerequisites and execute list.

- [ ] **Step 7: Run verification**

Run: `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`

Expected: executable prints no output and exits 0.

- [ ] **Step 8: Document the contract**

Add a `Portable UI Contract` section to `projects/synth/README.md` explaining:

- portable UI headers are JUCE-free;
- `Surface::BuildTree()` runs on the host UI/message thread;
- action handlers run on the host UI/message thread;
- app actions that affect DSP enqueue `synth::MessageIn` through `AppContext::uiBus` with `AppContext::now`;
- bespoke widgets use bounded draw commands;
- form pages use semantic nodes so a browser backend can map them to DOM controls.

- [ ] **Step 9: Commit**

```bash
git add projects/synth/include/synth/PortableUI.hpp \
        projects/synth/include/synth/PortableUIBuilders.hpp \
        projects/synth/include/synth/AppConcepts.hpp \
        projects/synth/tests/portable_ui_tests.cpp \
        projects/synth/Makefile \
        projects/synth/README.md
git commit -m "feat(synth): add portable UI contract"
```

## Task 2: Miniapp Portable Surface

Implements OpenSpec tasks 3.1, 3.3, 3.4, and part of 3.5.

**Files:**
- Create: `projects/synth/apps/miniapp/MiniAppUI.hpp`
- Modify: `projects/synth/apps/miniapp/MiniApp.hpp`
- Modify: `projects/synth/tests/miniapp_system_tests.cpp`
- Modify: `projects/synth/juce/EncoderComponentGeometryTests.cpp`

- [ ] **Step 1: Add failing JUCE-free miniapp UI assertions**

In `projects/synth/tests/miniapp_system_tests.cpp`, include `MiniAppUI.hpp` and add a test that constructs `synth_miniapp::MiniAppUiSurface`, attaches a fake `AppContext` with a `MessageInBus`, builds the tree, and asserts node IDs for:

```cpp
"miniapp.root"
"miniapp.title"
"miniapp.encoder.0"
"miniapp.encoder.6"
"miniapp.vco.scope"
"miniapp.lfo.scope"
"miniapp.bank.vco"
"miniapp.bank.lfo"
"miniapp.gesture.toggle"
"miniapp.scene.0"
"miniapp.scene.1"
"miniapp.scene.2"
"miniapp.reset"
"miniapp.random"
"miniapp.random_mod"
"miniapp.start"
"miniapp.stop"
"miniapp.gesture.value"
"miniapp.scene.blend"
```

Also assert that invoking actions named `miniapp.start`, `miniapp.stop`, `miniapp.bank.select`, and `miniapp.gesture.value` pushes messages onto `uiBus`.

- [ ] **Step 2: Run the failing system test**

Run: `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`

Expected: fail because `MiniAppUI.hpp` and portable actions do not exist.

- [ ] **Step 3: Extract miniapp layout and action surface**

Create `MiniAppUI.hpp` that:

- includes only `MiniAppCore.hpp`, `synth/PortableUI.hpp`, and `synth/PortableUIBuilders.hpp`;
- defines JUCE-free `EncoderGridLayout` using `synth::ui::Bounds`;
- defines `MiniAppUiSurface final : public synth::ui::Surface`;
- stores `synth::AppContext* context_`;
- stores pointers to `MiniAppCore` UI state as needed;
- implements `BuildTree()` using the IDs listed in Step 1;
- implements `SetActionHandler()` by accepting an optional outer handler while still handling miniapp action names internally;
- implements actions by pushing the existing `synth::MessageIn` variants to `context_->uiBus` using `context_->now`.

Preserve the current layout constants: encoder count 7, first row count 4, column width 132, row height 150, total height 300, inset 10.

- [ ] **Step 4: Refactor `MiniApp.hpp`**

Remove `#include "EncoderComponent.hpp"`, `#include "WaveformComponents.hpp"`, and `<juce_gui_basics/juce_gui_basics.h>` from `MiniApp.hpp`. Make the app own `MiniAppUiSurface ui_;`, return `synth::ui::Surface& PortableSurface()`, and call `ui_.Attach(context, this)` from `Init()`.

- [ ] **Step 5: Keep geometry tests portable**

Update `projects/synth/juce/EncoderComponentGeometryTests.cpp` so encoder-grid bounds come from `synth_miniapp::EncoderGridLayout` in `MiniAppUI.hpp` and compare `synth::ui::Bounds` values, not `juce::Rectangle` for the portable layout part.

- [ ] **Step 6: Run verification**

Run:

```bash
make -C projects/synth test
make -C projects/synth/apps/miniapp test
```

Expected: core tests pass; miniapp JUCE test may fail at compile until Task 3 provides the JUCE backend host, but it must not fail because `MiniApp.hpp` includes JUCE.

- [ ] **Step 7: Commit**

```bash
git add projects/synth/apps/miniapp/MiniAppUI.hpp \
        projects/synth/apps/miniapp/MiniApp.hpp \
        projects/synth/tests/miniapp_system_tests.cpp \
        projects/synth/juce/EncoderComponentGeometryTests.cpp
git commit -m "feat(miniapp): expose portable UI surface"
```

## Task 3: JUCE Portable Backend And Runtime Host

Implements OpenSpec tasks 2.1, 2.2, 2.3, 3.5, and part of 6.1.

**Files:**
- Create: `projects/synth/juce/PortableJuceBackend.hpp`
- Create: `projects/synth/juce/MiniAppJuceSurface.hpp`
- Modify: `projects/synth/runtime/Runtime.hpp`
- Modify: `projects/synth/runtime/MainPane.hpp`
- Modify: `projects/synth/runtime/Shell.hpp` if needed
- Modify: `projects/synth/runtime/juce_build.mk`

- [ ] **Step 1: Add a backend smoke path**

Add a minimal JUCE backend class:

```cpp
namespace synth_juce {

class PortableComponent final : public juce::Component {
public:
    explicit PortableComponent(synth::ui::Surface& surface);
    void RefreshFromSurface();
    void resized() override;
    void paint(juce::Graphics& g) override;

private:
    synth::ui::Surface& surface_;
    synth::ui::NodeTree tree_;
    std::vector<std::unique_ptr<juce::Component>> controls_;
};

}  // namespace synth_juce
```

The first implementation must render labels/buttons/toggles/sliders/combo boxes/text fields/status text as JUCE controls and draw nodes in `paint()`. Toolkit translation helpers (`ToJuceColour`, `ToJuceRect`, text alignment, action-to-event dispatch) live in this header or a private companion under `projects/synth/juce`.

- [ ] **Step 2: Adapt runtime app hosting**

In `Runtime<App>`, replace `AppComponent()` with `AppSurface()`:

```cpp
synth::ui::Surface& AppSurface() { return engine_.Application().PortableSurface(); }
```

In `MainPane<App>`, own:

```cpp
synth_juce::PortableComponent appComponent_;
```

Initialize it from `runtime.AppSurface()` and use `appComponent_` where the old code used `runtime_.AppComponent()`.

- [ ] **Step 3: Preserve repaint ordering**

Ensure `ShellComponent::RepaintAll()` or the equivalent timer repaint path calls the portable component refresh before repainting. The backend must not touch the parameter manager directly; it consumes the app surface tree and dispatches actions.

- [ ] **Step 4: Update build includes**

Move portable backend includes into `SYNTH_JUCE_HEADERS` in `runtime/juce_build.mk`. Keep `MiniApp.hpp` app-facing and JUCE-free; include backend headers from runtime/UI host files only.

- [ ] **Step 5: Run verification**

Run:

```bash
make -C projects/synth test
make -C projects/synth/apps/miniapp test
make -C projects/synth/apps/miniapp
```

Expected: all core tests and JUCE geometry tests pass, and the miniapp app bundle builds.

- [ ] **Step 6: Commit**

```bash
git add projects/synth/juce/PortableJuceBackend.hpp \
        projects/synth/juce/MiniAppJuceSurface.hpp \
        projects/synth/runtime/Runtime.hpp \
        projects/synth/runtime/MainPane.hpp \
        projects/synth/runtime/Shell.hpp \
        projects/synth/runtime/juce_build.mk
git commit -m "feat(synth): host portable UI through JUCE backend"
```

## Task 4: Portable Draw Commands For Miniapp Widgets

Implements OpenSpec tasks 2.4 and 3.2.

**Files:**
- Create: `projects/synth/apps/miniapp/MiniAppDraw.hpp`
- Modify: `projects/synth/apps/miniapp/MiniAppUI.hpp`
- Modify: `projects/synth/juce/EncoderComponent.hpp`
- Modify: `projects/synth/juce/FourteenSegmentDisplayComponent.hpp`
- Modify: `projects/synth/juce/WaveformComponents.hpp`
- Modify: `projects/synth/juce/PathDrawer.hpp`
- Modify: `projects/synth/juce/EncoderComponentGeometryTests.cpp`

- [ ] **Step 1: Add draw-command geometry tests**

Extend `EncoderComponentGeometryTests.cpp` to assert that portable encoder draw generation emits arc, line, text, and fill commands with the same angle and bounds math currently tested on `synth_juce::EncoderComponent`.

- [ ] **Step 2: Extract JUCE-free draw math**

Create `MiniAppDraw.hpp` with functions such as:

```cpp
std::vector<synth::ui::DrawCommand> BuildEncoderDrawCommands(const EncoderDrawState&, synth::ui::Bounds);
std::vector<synth::ui::DrawCommand> BuildFourteenSegmentCommands(std::string_view text, synth::ui::Bounds);
std::vector<synth::ui::DrawCommand> BuildVcoWaveformCommands(const VcoWaveformDrawState&, synth::ui::Bounds);
std::vector<synth::ui::DrawCommand> BuildLfoWaveformCommands(const LfoWaveformDrawState&, synth::ui::Bounds);
```

Move pure math from JUCE widgets into these functions. Leave JUCE event handling and painting adapters under `projects/synth/juce`.

- [ ] **Step 3: Make miniapp surface emit draw nodes**

Update `MiniAppUiSurface::BuildTree()` so encoder/scope nodes carry bounded `DrawCommand` vectors instead of assuming JUCE widgets.

- [ ] **Step 4: Make JUCE widgets consume portable commands**

Update existing JUCE widgets to either delegate to portable command builders or become thin paint adapters around them. Keep behavior and geometry unchanged.

- [ ] **Step 5: Run verification**

Run:

```bash
make -C projects/synth/apps/miniapp test
make -C projects/synth/apps/miniapp
```

Expected: geometry tests pass and miniapp bundle builds.

- [ ] **Step 6: Commit**

```bash
git add projects/synth/apps/miniapp/MiniAppDraw.hpp \
        projects/synth/apps/miniapp/MiniAppUI.hpp \
        projects/synth/juce/EncoderComponent.hpp \
        projects/synth/juce/FourteenSegmentDisplayComponent.hpp \
        projects/synth/juce/WaveformComponents.hpp \
        projects/synth/juce/PathDrawer.hpp \
        projects/synth/juce/EncoderComponentGeometryTests.cpp
git commit -m "feat(miniapp): render widgets as portable draw commands"
```

## Task 5: Runtime Pages As Portable Semantic Nodes

Implements OpenSpec tasks 4.1 through 4.4, excluding Controllers details handled in Task 6.

**Files:**
- Create: `projects/synth/include/synth/RuntimePages.hpp`
- Create: `projects/synth/juce/RuntimePagesJuce.hpp`
- Modify: `projects/synth/runtime/MainPane.hpp`
- Modify: `projects/synth/runtime/AudioConfigPage.hpp`
- Modify: `projects/synth/runtime/FilePage.hpp`
- Modify: `projects/synth/tests/portable_ui_tests.cpp`

- [ ] **Step 1: Add runtime page model tests**

In `portable_ui_tests.cpp`, add tests for sidebar nodes (`runtime.sidebar.audio`, `runtime.sidebar.controllers`, `runtime.sidebar.file`, `runtime.sidebar.deadline`) and Audio/File page semantic nodes for device selection, status text, patch name, New/Save/Save As/Load/Revert, and Back.

- [ ] **Step 2: Implement page producers**

Create `RuntimePages.hpp` with JUCE-free builders for:

- sidebar and deadline readout;
- page selection state;
- Audio page model and actions;
- File page model and actions;
- backend handoff descriptors for file chooser actions, leaving actual file chooser ownership in the JUCE runtime.

- [ ] **Step 3: Move JUCE rendering under `projects/synth/juce`**

Create `RuntimePagesJuce.hpp` and move JUCE component construction, combo population, file chooser triggering, status-label updating, and back-button rendering out of runtime page producer headers.

- [ ] **Step 4: Wire MainPane**

Keep `MainPane` as the desktop host layout if needed, but make it host portable page surfaces through `RuntimePagesJuce.hpp`. Runtime host files may include JUCE; page producers must not.

- [ ] **Step 5: Run verification**

Run:

```bash
make -C projects/synth test
make -C projects/synth/apps/miniapp test
```

Expected: runtime page model tests pass and desktop backend tests still build.

- [ ] **Step 6: Commit**

```bash
git add projects/synth/include/synth/RuntimePages.hpp \
        projects/synth/juce/RuntimePagesJuce.hpp \
        projects/synth/runtime/MainPane.hpp \
        projects/synth/runtime/AudioConfigPage.hpp \
        projects/synth/runtime/FilePage.hpp \
        projects/synth/tests/portable_ui_tests.cpp
git commit -m "feat(synth): express runtime pages as portable nodes"
```

## Task 6: Controllers Semantic Presentation And JUCE Renderer

Implements OpenSpec tasks 5.1 through 5.6.

**Files:**
- Create: `projects/synth/include/synth/ControllersPagePresentation.hpp`
- Create: `projects/synth/src/ControllersPagePresentation.cpp`
- Create: `projects/synth/juce/ControllersPageComponent.hpp`
- Modify: `projects/synth/runtime/ControllersPage.hpp`
- Modify: `projects/synth/tests/viewmodel_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify: `projects/synth/runtime/juce_build.mk`

- [ ] **Step 1: Add semantic presentation tests**

Extend `viewmodel_tests.cpp` with workflow tests that construct the presentation layer over `MidiConfigViewModel` and assert semantic actions for:

- add controller;
- endpoint selection;
- mapping edit acceptance and refusal;
- add/delete row;
- add/delete block;
- empty group add affordance;
- launchpad variant selection;
- dirty refresh after out-of-band rebuild.

- [ ] **Step 2: Implement the presentation layer**

Create `ControllersPagePresentation.hpp/.cpp` that:

- derives a stable semantic node tree from `MidiConfigViewModel`;
- gives every controller row, section, mapping row, block row, add/delete affordance, endpoint selector, status line, and validation message a stable `NodeId`;
- routes actions to existing `MidiConfigViewModel` APIs;
- returns commit requests as `synth::MidiInstrumentConfig` values for the runtime to apply through `engine.EditInstrument`;
- exposes focus/edit lifecycle hints so refresh can defer while text edits are active.

- [ ] **Step 3: Move JUCE renderer**

Create `ControllersPageComponent.hpp` under `projects/synth/juce`. It should render the semantic tree with clearer grouping, spacing, headers, and form controls while preserving all workflows. Existing nested JUCE editor classes in `runtime/ControllersPage.hpp` should move here or be replaced by renderer-local equivalents.

- [ ] **Step 4: Keep runtime host thin**

Make `runtime/ControllersPage.hpp` either a compatibility include to the JUCE renderer or a thin host wrapper that contains no page behavior beyond runtime callback wiring.

- [ ] **Step 5: Run verification**

Run:

```bash
make -C projects/synth build/viewmodel_tests && projects/synth/build/viewmodel_tests
make -C projects/synth/apps/miniapp test
```

Expected: presentation workflow tests pass and the JUCE renderer compiles.

- [ ] **Step 6: Commit**

```bash
git add projects/synth/include/synth/ControllersPagePresentation.hpp \
        projects/synth/src/ControllersPagePresentation.cpp \
        projects/synth/juce/ControllersPageComponent.hpp \
        projects/synth/runtime/ControllersPage.hpp \
        projects/synth/tests/viewmodel_tests.cpp \
        projects/synth/Makefile \
        projects/synth/runtime/juce_build.mk
git commit -m "feat(synth): render controllers from semantic tree"
```

## Task 7: Boundary Check, Docs, And Final Verification

Implements OpenSpec tasks 6.1 through 6.6 and completes any remaining task checkboxes.

**Files:**
- Create: `projects/synth/scripts/check_ui_boundary.sh`
- Modify: `projects/synth/Makefile`
- Modify: `projects/synth/apps/miniapp/Makefile`
- Modify: `projects/synth/README.md`
- Modify: `openspec/changes/decouple-synth-ui-from-juce/tasks.md`

- [ ] **Step 1: Add the boundary script**

Create `projects/synth/scripts/check_ui_boundary.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

allowed_regex='^(juce/|runtime/Runtime.hpp$|runtime/Shell.hpp$|runtime/MidiConnectionManager.hpp$|runtime/juce_build.mk$|apps/miniapp/Main.cpp$)'

while IFS= read -r file; do
  rel="${file#./}"
  if [[ "$rel" =~ $allowed_regex ]]; then
    continue
  fi
  if grep -E '#include[ <"].*juce_|juce::|JUCE_' "$file" >/dev/null; then
    echo "Disallowed JUCE reference in $rel" >&2
    exit 1
  fi
done < <(find . -path './build' -prune -o -path './apps/miniapp/build' -prune -o \( -name '*.hpp' -o -name '*.cpp' -o -name '*.mm' -o -name '*.mk' \) -print)
```

- [ ] **Step 2: Wire boundary check into tests**

Add a `check-ui-boundary` phony target in `projects/synth/Makefile` and include it in `test`. If miniapp has a separate useful target, add it there too or call the synth target from the miniapp test.

- [ ] **Step 3: Run all verification**

Run:

```bash
openspec validate decouple-synth-ui-from-juce --type change --strict
make -C projects/synth test
make -C projects/synth/apps/miniapp test
make -C projects/synth/apps/miniapp
projects/synth/scripts/check_ui_boundary.sh
```

Expected:

- OpenSpec strict validation passes.
- Synth core tests pass.
- Miniapp JUCE tests pass.
- Miniapp desktop app bundle builds.
- Boundary script exits 0.

- [ ] **Step 4: Manual smoke**

Launch the miniapp bundle from `projects/synth/apps/miniapp/build/SynthMiniapp.app`. Verify:

- default app UI appears beside the sidebar;
- encoder grid, waveform panels, bank buttons, scene controls, gesture slider, blend slider, reset/random modifiers, and start/stop controls are visible and interact;
- Audio page opens, shows device/status controls, and Back returns to app UI;
- File page opens, patch actions remain available, and Back returns to app UI;
- Controllers page opens, supports add controller, endpoint selection, mapping edits, add/delete rows, block rows, empty-group add, and Back returns to app UI;
- exiting/relaunching preserves runtime lifecycle behavior.

- [ ] **Step 5: Update OpenSpec task checkboxes**

Mark each task complete in `openspec/changes/decouple-synth-ui-from-juce/tasks.md` only after the corresponding implementation, reviews, and verification have passed.

- [ ] **Step 6: Commit**

```bash
git add projects/synth/scripts/check_ui_boundary.sh \
        projects/synth/Makefile \
        projects/synth/apps/miniapp/Makefile \
        projects/synth/README.md \
        openspec/changes/decouple-synth-ui-from-juce/tasks.md
git commit -m "chore(synth): verify portable UI boundary"
```

## Final Review

- [ ] Dispatch Claude Opus final spec compliance review over the whole branch.
- [ ] Dispatch Claude Opus final code-quality review over the whole branch.
- [ ] Fix all Critical and Important findings.
- [ ] Re-run final verification commands.
- [ ] Use `superpowers:finishing-a-development-branch` to present completion options.
