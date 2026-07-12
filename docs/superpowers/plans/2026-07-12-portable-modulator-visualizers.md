# Portable Modulator Visualizers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `add-portable-modulator-visualizers` OpenSpec change: backend-agnostic visualizer objects, optional modulator visualizer publication, modulation-grid composition below encoders, MiniApp visualizer topology, Braid 4 null topology, and coverage docs.

**Architecture:** Put polymorphism at the portable component boundary: `synth::ui::Visualizer` owns bounds/visibility and produces portable draw commands, while concrete scope visualizers read typed app-owned DSP UI-state pointers. Publish a non-owning `synth::ui::Visualizer*` through modulator metadata, materialized depth-parameter config, and `Parameter::UIState`; app surfaces set bounds and use a portable builder helper to append the visualizer node before the existing interactive encoder node. No backend adapter changes are allowed.

**Tech Stack:** C++20, synth JUCE-free portable UI headers, existing `projects/synth/Makefile` test executables, OpenSpec, native Codex implementer subagents, xagent Claude reviewers.

## Global Constraints

- Backend scope: do not add or modify files under `projects/synth/juce`, `projects/synth/browser`, DOM, canvas, or other backend adapter implementation directories.
- Dependency scope: keep public visualizer headers free of JUCE, browser, DOM, canvas, and host-backend types.
- Ownership: visualizer pointers are non-owning topology pointers; parameter metadata, parameter UI snapshots, and patch persistence never own, allocate, serialize, restore, or delete visualizers.
- Identity: a non-null `Visualizer*` may identify only one visualizer placement; showing equivalent content twice requires two distinct visualizer instances.
- Lifetime: the app owns visualizers and every model UI-state object they reference and keeps all addresses valid from registration through final UI refresh and teardown.
- Visibility: constructed visualizers are visible by default; hidden visualizers emit no node or commands.
- Stacking: portable tree order is the stacking contract; later overlapping nodes draw above earlier overlapping nodes.
- Interaction: the first version is display-only; the existing encoder node remains the interactive node and retains drag and double-click actions.
- MiniApp topology: construct three visible address-stable visualizers; modulators `0` and `1` get distinct VCO visualizer instances reading stable VCO UI state; modulator `2` gets one LFO visualizer reading stable LFO UI state.
- Braid 4 topology: every stereo, quad, and mono modulator visualizer pointer remains null and Braid 4 modulation-depth cells remain encoder-only.
- OpenSpec source of truth: implement only behavior described in `openspec/changes/add-portable-modulator-visualizers`.
- Review route: implementation tasks use native Codex subagents; task and final reviews use xagent Claude reviewers. Run spec-compliance review before code-quality review for each task.
- TDD: no production code without a failing test first.

---

## File Structure

- Modify `projects/synth/include/synth/PortableUI.hpp`: define `synth::ui::Visualizer`.
- Modify `projects/synth/include/synth/PortableUIBuilders.hpp`: add `ScopeVisualizer`/typed scope adapter and `Builder::Visualizer(...)`.
- Modify `projects/synth/include/synth/ParameterModulation.hpp`: forward-declare `synth::ui::Visualizer`; add nullable pointer fields to `ModulatorMetadata`, `ParameterConfig`, and atomic `Parameter::UIState`.
- Modify `projects/synth/src/ParameterModulation.cpp`: reset, copy, and publish visualizer pointers; keep JSON persistence untouched.
- Modify `projects/synth/apps/miniapp/MiniAppCore.hpp`: own three visualizer instances and register pointers with VCO/LFO modulators after UI-state members exist.
- Modify `projects/synth/apps/miniapp/MiniAppUI.hpp`: call builder helper before encoder node when a cell publishes an eligible visualizer.
- Modify `projects/synth/apps/braid-4/Braid4UI.hpp`: call the same helper; null pointers preserve existing output.
- Modify `projects/synth/tests/portable_ui_tests.cpp`: contract, scope visualizer, and portable tree-order tests.
- Modify `projects/synth/tests/parameter_modulation_tests.cpp`: metadata/config/UI-state/persistence/null/disconnected tests.
- Modify `projects/synth/tests/miniapp_system_tests.cpp`: MiniApp topology and visualizer-under-encoder tests.
- Modify `projects/synth/tests/braid4_system_tests.cpp`: Braid 4 null visualizer and encoder-only tree tests.
- Modify `projects/synth/docs/coverage.md`: map `spv-1` through `spv-5`, `spm-70`, `sru-24`, `sdsp-33`, and `d4-9`.
- Modify `openspec/changes/add-portable-modulator-visualizers/tasks.md`: mark checkboxes only after matching implementation, review, and verification pass.

---

### Task 1: Portable Visualizer Contract And Scope Visualizer

**Files:**
- Modify: `projects/synth/include/synth/PortableUI.hpp`
- Modify: `projects/synth/include/synth/PortableUIBuilders.hpp`
- Test: `projects/synth/tests/portable_ui_tests.cpp`
- OpenSpec checkboxes covered: 1.1, 1.2, 1.3, 1.4

**Interfaces:**
- Produces: `class synth::ui::Visualizer` with `SetBounds(Bounds)`, `const Bounds& GetBounds() const`, `SetVisible(bool)`, `bool Visible() const`, and `std::vector<DrawCommand> Draw() const`.
- Produces: `template <typename LayerState> class synth::ui::ScopeVisualizer`.
- Produces: `Builder& Visualizer(std::string id, synth::ui::Visualizer* visualizer)`.
- Later tasks consume `synth::ui::Visualizer*` only; no ownership transfer.

- [ ] **Step 1: Write failing visualizer contract tests**

Add a local concrete test visualizer near the existing helpers in `portable_ui_tests.cpp`:

```cpp
struct TestVisualizer final : synth::ui::Visualizer
{
    std::vector<synth::ui::DrawCommand> DrawVisible() const override
    {
        return {synth::ui::DrawCommand::Fill(GetBounds(), synth::Color::Cyan)};
    }
};
```

Add checks in `main()` after the current portable static assertions:

```cpp
static_assert(!std::is_copy_constructible_v<synth::ui::Visualizer>);
static_assert(!std::is_copy_assignable_v<synth::ui::Visualizer>);
static_assert(!std::is_move_constructible_v<synth::ui::Visualizer>);
static_assert(!std::is_move_assignable_v<synth::ui::Visualizer>);
TestVisualizer visualizer;
Require(visualizer.Visible(), "visualizer is visible by default");
visualizer.SetBounds({11.0f, 12.0f, 44.0f, 45.0f});
RequireNear(visualizer.GetBounds().x, 11.0f, 0.0001f, "visualizer stores bounds x");
RequireNear(visualizer.GetBounds().height, 45.0f, 0.0001f, "visualizer stores bounds height");
Require(visualizer.Draw().size() == 1, "visible visualizer emits commands");
visualizer.SetVisible(false);
Require(visualizer.Draw().empty(), "hidden visualizer emits no commands");
visualizer.SetVisible(true);
synth::ui::Builder visualizerBuilder;
visualizerBuilder.Root("viz.root", {0.0f, 0.0f, 100.0f, 100.0f})
    .Visualizer("viz.node", &visualizer);
const synth::ui::NodeTree visualizerTree = visualizerBuilder.Build();
const synth::ui::Node* visualizerNode = FindNodeById(visualizerTree, "viz.node");
Require(visualizerNode != nullptr, "visible visualizer node exists");
Require(visualizerNode->kind == synth::ui::NodeKind::Draw, "visualizer node is a draw node");
RequireNear(visualizerNode->bounds.width, 44.0f, 0.0001f, "visualizer node uses stored bounds");
Require(visualizerNode->drawCommands.size() == 1, "visualizer node uses draw commands");
visualizer.SetVisible(false);
synth::ui::Builder hiddenBuilder;
hiddenBuilder.Root("viz.hidden.root", {0.0f, 0.0f, 100.0f, 100.0f})
    .Visualizer("viz.hidden.node", &visualizer);
Require(FindNodeById(hiddenBuilder.Build(), "viz.hidden.node") == nullptr, "hidden visualizer node absent");
```

- [ ] **Step 2: Run the failing test**

Run: `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`

Expected: compile failure because `synth::ui::Visualizer` and `Builder::Visualizer` do not exist.

- [ ] **Step 3: Implement the portable visualizer base and builder helper**

In `PortableUI.hpp`, include `<vector>` already exists; add:

```cpp
class Visualizer {
public:
    Visualizer() = default;
    virtual ~Visualizer() = default;
    Visualizer(const Visualizer&) = delete;
    Visualizer& operator=(const Visualizer&) = delete;
    Visualizer(Visualizer&&) = delete;
    Visualizer& operator=(Visualizer&&) = delete;

    void SetBounds(Bounds bounds) { bounds_ = bounds; }
    const Bounds& GetBounds() const { return bounds_; }
    void SetVisible(bool visible) { visible_ = visible; }
    bool Visible() const { return visible_; }

    std::vector<DrawCommand> Draw() const
    {
        if (!visible_)
        {
            return {};
        }
        return DrawVisible();
    }

protected:
    virtual std::vector<DrawCommand> DrawVisible() const = 0;

private:
    Bounds bounds_{};
    bool visible_ = true;
};
```

In `PortableUIBuilders.hpp`, add `Builder::Visualizer` before `Draw(...)`:

```cpp
Builder& Visualizer(std::string id, synth::ui::Visualizer* visualizer) {
    if (visualizer == nullptr || !visualizer->Visible()) {
        return *this;
    }
    return Draw(std::move(id), visualizer->GetBounds(), visualizer->Draw());
}
```

- [ ] **Step 4: Verify Task 1 base contract is green**

Run: `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`

Expected: PASS with exit code 0.

- [ ] **Step 5: Write failing scope visualizer tests**

Add a local layer type near test helpers:

```cpp
struct TestScopeLayerState
{
    std::atomic<bool> connected{false};
    std::atomic<const synth::ScopeWriter*> scope{nullptr};
    std::atomic<std::size_t> scopeChannel{0};
    synth::AtomicColor scopeColor;
};
```

Add checks in `main()` after existing waveform helper checks:

```cpp
TestScopeLayerState layerA;
TestScopeLayerState layerB;
layerA.connected.store(true);
layerA.scope.store(&scope);
layerA.scopeChannel.store(0);
layerA.scopeColor.Store(synth::Color::Red);
layerB.connected.store(false);
layerB.scope.store(&scope);
layerB.scopeChannel.store(1);
layerB.scopeColor.Store(synth::Color::Green);
std::array<TestScopeLayerState*, 2> scopeLayers{&layerA, &layerB};
synth::ui::ScopeVisualizer<TestScopeLayerState> scopeVisualizer(scopeLayers, -1.1f, 1.1f, 64, true);
scopeVisualizer.SetBounds({50.0f, 60.0f, 140.0f, 90.0f});
const auto scopeVisualizerCommands = scopeVisualizer.Draw();
RequireWaveformGeometryInside(scopeVisualizerCommands, scopeVisualizer.GetBounds(),
                              "scope visualizer geometry stays inside bounds");
const bool sawRed = std::any_of(scopeVisualizerCommands.begin(), scopeVisualizerCommands.end(),
                                [](const synth::ui::DrawCommand& command) {
                                    return command.kind == synth::ui::DrawCommand::Kind::Polyline &&
                                           command.color == synth::Color::Red;
                                });
Require(sawRed, "scope visualizer reads connected layer color");
const bool sawGreen = std::any_of(scopeVisualizerCommands.begin(), scopeVisualizerCommands.end(),
                                  [](const synth::ui::DrawCommand& command) {
                                      return command.kind == synth::ui::DrawCommand::Kind::Polyline &&
                                             command.color == synth::Color::Green;
                                  });
Require(!sawGreen, "scope visualizer skips disconnected layer");
layerA.scopeChannel.store(1);
layerA.scopeColor.Store(synth::Color::Yellow);
const auto updatedScopeCommands = scopeVisualizer.Draw();
const bool sawYellow = std::any_of(updatedScopeCommands.begin(), updatedScopeCommands.end(),
                                   [](const synth::ui::DrawCommand& command) {
                                       return command.kind == synth::ui::DrawCommand::Kind::Polyline &&
                                              command.color == synth::Color::Yellow;
                                   });
Require(sawYellow, "scope visualizer reads updated atomic color without reconstruction");
```

- [ ] **Step 6: Run the failing scope test**

Run: `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`

Expected: compile failure because `synth::ui::ScopeVisualizer` does not exist.

- [ ] **Step 7: Implement `ScopeVisualizer`**

In `PortableUIBuilders.hpp`, include `<array>` if required by tests only not header. Add after `BuildScopeWaveformCommands`:

```cpp
template <typename LayerState>
class ScopeVisualizer final : public Visualizer
{
public:
    ScopeVisualizer(std::span<LayerState* const> layers,
                    float minY,
                    float maxY,
                    std::size_t numSamples,
                    bool drawMarkers)
        : layers_(layers.begin(), layers.end()),
          minY_(minY),
          maxY_(maxY),
          numSamples_(numSamples),
          drawMarkers_(drawMarkers)
    {}

protected:
    std::vector<DrawCommand> DrawVisible() const override
    {
        std::vector<WaveformLayerDrawState> snapshots;
        snapshots.reserve(layers_.size());
        for (const LayerState* layer : layers_)
        {
            if (layer == nullptr)
            {
                continue;
            }
            snapshots.push_back({
                .connected = layer->connected.load(std::memory_order_relaxed),
                .scopeColor = layer->scopeColor.Load(std::memory_order_relaxed),
                .scope = layer->scope.load(std::memory_order_relaxed),
                .scopeChannel = layer->scopeChannel.load(std::memory_order_relaxed),
            });
        }
        return BuildScopeWaveformCommands(snapshots, GetBounds(), minY_, maxY_, numSamples_, drawMarkers_);
    }

private:
    std::vector<LayerState*> layers_;
    float minY_ = -1.0f;
    float maxY_ = 1.0f;
    std::size_t numSamples_ = 0;
    bool drawMarkers_ = true;
};
```

- [ ] **Step 8: Verify Task 1 complete**

Run: `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`

Expected: PASS with exit code 0.

---

### Task 2: Parameter Modulation Visualizer Publication

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`
- OpenSpec checkboxes covered: 2.1, 2.2, 2.3

**Interfaces:**
- Consumes: `synth::ui::Visualizer` from Task 1.
- Produces: `ModulatorMetadata::visualizer`, `ParameterConfig::visualizer`, and `Parameter::UIState::visualizer`.
- Later tasks read `Parameter::UIState::visualizer.load(std::memory_order_relaxed)`.

- [ ] **Step 1: Write failing metadata-to-depth tests**

In `parameter_modulation_tests.cpp`, include `synth/PortableUI.hpp` if not already included. Add a local `TestVisualizer`:

```cpp
struct TestVisualizer final : synth::ui::Visualizer
{
    std::vector<synth::ui::DrawCommand> DrawVisible() const override { return {}; }
};
```

Add a test near existing UI snapshot tests:

```cpp
TEST_CASE(modulation_depth_publishes_source_visualizer_topology) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 2,
        .numScenes = 1,
        .maxParameters = 4,
    });
    TestVisualizer visualizer;
    group.GetModulators().Metadata(0).sourceColor = synth::Color::Cyan;
    group.GetModulators().Metadata(0).visualizer = &visualizer;
    auto& carrier = manager.CreateParameter(group, {.name = "Carrier"});

    synth::Parameter* depth0 = carrier.EnsureModulationDepth(0);
    REQUIRE_TRUE(depth0 != nullptr);
    synth::Parameter::UIState depthState(1, 2, 0);
    depth0->PopulateUIState(depthState);
    REQUIRE_TRUE(depthState.visualizer.load(std::memory_order_relaxed) == &visualizer);

    synth::Parameter* depth1 = carrier.EnsureModulationDepth(1);
    REQUIRE_TRUE(depth1 != nullptr);
    synth::Parameter::UIState nullDepthState(1, 2, 0);
    depth1->PopulateUIState(nullDepthState);
    REQUIRE_TRUE(nullDepthState.visualizer.load(std::memory_order_relaxed) == nullptr);

    depthState.SetDisconnected();
    REQUIRE_TRUE(depthState.visualizer.load(std::memory_order_relaxed) == nullptr);
}
```

Add persistence assertion to an existing save/load test or a new focused test:

```cpp
TEST_CASE(visualizer_topology_is_not_serialized) {
    synth::JsonArena arena;
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 1, .maxParameters = 4});
    TestVisualizer visualizer;
    group.GetModulators().Metadata(0).visualizer = &visualizer;
    auto& carrier = manager.CreateParameter(group, {.name = "Carrier"});
    REQUIRE_TRUE(carrier.EnsureModulationDepth(0) != nullptr);
    const std::string json = synth::Stringify(carrier.ToValueJSON(arena));
    REQUIRE_TRUE(json.find("visualizer") == std::string::npos);
    REQUIRE_TRUE(json.find("Visualizer") == std::string::npos);
}
```

- [ ] **Step 2: Run the failing parameter tests**

Run: `make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests`

Expected: compile failure because the visualizer fields do not exist.

- [ ] **Step 3: Add nullable pointer fields**

In `ParameterModulation.hpp`, forward-declare before `namespace synth` or inside it:

```cpp
namespace synth::ui {
class Visualizer;
}
```

Add fields:

```cpp
struct ModulatorMetadata {
    std::string name;
    std::string shortName;
    Color sourceColor;
    synth::ui::Visualizer* visualizer = nullptr;
    bool connected = false;
};
```

```cpp
struct ParameterConfig {
    std::string name;
    std::string shortName;
    float defaultValue = 0.0f;
    RangeKind range = RangeKind::Unipolar;
    std::size_t switchValues = 0;
    Color baseColor = Color::Grey;
    synth::ui::Visualizer* visualizer = nullptr;
    std::vector<Color> indicatorColors;
};
```

```cpp
std::atomic<synth::ui::Visualizer*> visualizer{nullptr};
```

- [ ] **Step 4: Publish and clear pointer**

In `Parameter::UIState::SetDisconnected()`:

```cpp
visualizer.store(nullptr, std::memory_order_relaxed);
```

In `Parameter::PopulateUIState()` before final `connected.store(true, ...)`:

```cpp
state.visualizer.store(config_.visualizer, std::memory_order_relaxed);
```

In `Parameter::ModulationDepthConfig(std::size_t modIx)`:

```cpp
.visualizer = modulator.visualizer,
```

Do not modify `ToValueJSON` or `LoadValuesFromJSON`.

- [ ] **Step 5: Verify Task 2 complete**

Run: `make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests`

Expected: PASS with exit code 0.

---

### Task 3: Encoder Composition In Portable App Surfaces

**Files:**
- Modify: `projects/synth/apps/miniapp/MiniAppUI.hpp`
- Modify: `projects/synth/apps/braid-4/Braid4UI.hpp`
- Test: `projects/synth/tests/portable_ui_tests.cpp`
- Test: `projects/synth/tests/miniapp_system_tests.cpp`
- Test: `projects/synth/tests/braid4_system_tests.cpp`
- OpenSpec checkboxes covered: 3.1, 3.2, 3.3

**Interfaces:**
- Consumes: `Parameter::UIState::visualizer`.
- Consumes: `Builder::Visualizer(id, visualizer)`.
- Produces visualizer node IDs by appending `.visualizer` to the encoder node ID.

- [ ] **Step 1: Write failing portable composition tests**

In `portable_ui_tests.cpp`, after the builder smoke test, add:

```cpp
TestVisualizer stackingVisualizer;
stackingVisualizer.SetBounds({20.0f, 20.0f, 64.0f, 64.0f});
synth::ui::Builder stackingBuilder;
stackingBuilder.Root("stack.root", {0.0f, 0.0f, 120.0f, 120.0f})
    .Visualizer("stack.encoder.0.visualizer", &stackingVisualizer)
    .DrawInteractive("stack.encoder.0",
                     stackingVisualizer.GetBounds(),
                     {synth::ui::DrawCommand::StrokeEllipse(stackingVisualizer.GetBounds(), synth::Color::White, 1.0f)},
                     synth::ui::Action::Named("drag"),
                     synth::ui::Action::Named("push"));
const synth::ui::NodeTree stackingTree = stackingBuilder.Build();
const synth::ui::Node* stackingRoot = FindNodeById(stackingTree, "stack.root");
Require(stackingRoot != nullptr, "stacking root exists");
Require(stackingRoot->children.size() == 2, "visualizer and encoder both appended");
Require(stackingRoot->children[0] == synth::ui::NodeId("stack.encoder.0.visualizer"),
        "visualizer precedes encoder");
Require(stackingRoot->children[1] == synth::ui::NodeId("stack.encoder.0"),
        "encoder follows visualizer");
const synth::ui::Node* stackingEncoder = FindNodeById(stackingTree, "stack.encoder.0");
Require(stackingEncoder != nullptr && stackingEncoder->pointerDragAction.has_value(),
        "encoder retains drag action");
Require(stackingEncoder != nullptr && stackingEncoder->doubleClickAction.has_value(),
        "encoder retains double-click action");
```

- [ ] **Step 2: Run the portable composition test**

Run: `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`

Expected: PASS if Task 1 helper exists; this is a guard before app surface integration.

- [ ] **Step 3: Add failing app-surface tests**

In `miniapp_system_tests.cpp`, add helpers to find node order if not present:

```cpp
std::size_t NodeIndexById(const synth::ui::NodeTree& tree, const std::string& id) {
    for (std::size_t ix = 0; ix < tree.nodes.size(); ++ix) {
        if (tree.nodes[ix].id == synth::ui::NodeId(id)) {
            return ix;
        }
    }
    throw std::runtime_error("missing node " + id);
}
```

Add a test that manually injects a visualizer into the published UI-state cell so Task 3 can prove the surface composition behavior without depending on Task 4's MiniApp topology:

```cpp
struct TestVisualizer final : synth::ui::Visualizer
{
    std::vector<synth::ui::DrawCommand> DrawVisible() const override
    {
        return {synth::ui::DrawCommand::Fill(GetBounds(), synth::Color::Cyan)};
    }
};

TEST_CASE(miniapp_modulation_view_draws_visualizer_beneath_encoder) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(
        64,
        UseScratchRuntimeDataPaths("miniapp_modulation_view_draws_visualizer_beneath_encoder"));
    rig.RunBlocks(4);
    auto& manager = rig.Engine().Manager();
    auto ui = manager.CreateUIState();
    manager.BankSlotAt(kSlotIx)->FocusEncoder(kTunePosition);
    manager.PopulateUIState(*ui);
    TestVisualizer injectedVisualizer;
    ui->slots[0].cells[kTunePosition].visualizer.store(&injectedVisualizer, std::memory_order_relaxed);

    synth::AppContext context = rig.Engine().Context();
    context.uiState = ui.get();
    synth_miniapp::MiniAppUiSurface surface;
    surface.Attach(&context, &rig.Engine().Application());
    const synth::ui::NodeTree tree = surface.BuildTree();

    const std::string encoderId = synth_miniapp::MiniAppNodeIds::Encoder(kTunePosition);
    const std::string visualizerId = encoderId + ".visualizer";
    const synth::ui::Node* encoder = FindNodeById(tree, encoderId);
    const synth::ui::Node* visualizer = FindNodeById(tree, visualizerId);
    REQUIRE_TRUE(encoder != nullptr);
    REQUIRE_TRUE(visualizer != nullptr);
    REQUIRE_TRUE(visualizer->kind == synth::ui::NodeKind::Draw);
    REQUIRE_TRUE(visualizer->pointerDragAction == std::nullopt);
    REQUIRE_TRUE(visualizer->doubleClickAction == std::nullopt);
    REQUIRE_TRUE(encoder->pointerDragAction.has_value());
    REQUIRE_TRUE(encoder->doubleClickAction.has_value());
    REQUIRE_TRUE(visualizer->bounds.x == encoder->bounds.x);
    REQUIRE_TRUE(visualizer->bounds.y == encoder->bounds.y);
    REQUIRE_TRUE(visualizer->bounds.width == encoder->bounds.width);
    REQUIRE_TRUE(visualizer->bounds.height == encoder->bounds.height);
    REQUIRE_TRUE(NodeIndexById(tree, visualizerId) < NodeIndexById(tree, encoderId));
}
```

In `braid4_system_tests.cpp`, add an encoder-only tree test:

```cpp
TEST_CASE(braid4_modulation_view_remains_encoder_only_without_visualizers) {
    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(
        64,
        UseScratchRuntimeDataPaths("braid4_modulation_view_remains_encoder_only_without_visualizers"));
    rig.RunBlocks(4);
    auto& manager = rig.Engine().Manager();
    auto ui = manager.CreateUIState();
    manager.BankSlotAt(0)->FocusEncoder(0);
    manager.PopulateUIState(*ui);

    synth::AppContext context = rig.Engine().Context();
    context.uiState = ui.get();
    synth_braid4::Braid4UiSurface surface;
    surface.Attach(&context, &rig.Engine().Application());
    const synth::ui::NodeTree tree = surface.BuildTree();
    const std::string encoderId = synth_braid4::Braid4NodeIds::Encoder(0);
    REQUIRE_TRUE(FindNodeById(tree, encoderId) != nullptr);
    REQUIRE_TRUE(FindNodeById(tree, encoderId + ".visualizer") == nullptr);
}
```

- [ ] **Step 4: Run failing app-surface tests**

Run: `make -C projects/synth build/miniapp_system_tests build/braid4_system_tests && projects/synth/build/miniapp_system_tests && projects/synth/build/braid4_system_tests`

Expected: MiniApp composition test fails because `MiniAppUiSurface::BuildTree()` does not yet read `Parameter::UIState::visualizer`; Braid 4 test should pass or compile after helper adoption.

- [ ] **Step 5: Adopt builder helper in app surfaces**

In both `MiniAppUI.hpp` and `Braid4UI.hpp`, before `DrawInteractive`, load a cell visualizer:

```cpp
synth::ui::Visualizer* visualizer = nullptr;
if (/* cell is available */)
{
    visualizer = cell.visualizer.load(std::memory_order_relaxed);
}
if (visualizer != nullptr)
{
    visualizer->SetBounds(encoderBounds);
    builder.Visualizer(EncoderId(ix) + ".visualizer", visualizer);
}
builder.DrawInteractive(...);
```

Use the existing app-specific encoder ID functions:

```cpp
const std::string encoderId = MiniAppNodeIds::Encoder(ix);
```

and

```cpp
const std::string encoderId = Braid4NodeIds::Encoder(ix);
```

In MiniApp, reuse the existing `slotState.cells[ix]`. In Braid 4, `SnapshotUiState(context_)` currently discards the raw cells; load from `context_->uiState->slots[0].cells[ix]` if present before drawing the encoder.

- [ ] **Step 6: Verify Task 3 focused tests**

Run: `make -C projects/synth build/portable_ui_tests build/miniapp_system_tests build/braid4_system_tests && projects/synth/build/portable_ui_tests && projects/synth/build/miniapp_system_tests && projects/synth/build/braid4_system_tests`

Expected: portable UI, MiniApp composition, and Braid tests pass with exit code 0.

---

### Task 4: MiniApp Visualizer Topology

**Files:**
- Modify: `projects/synth/apps/miniapp/MiniAppCore.hpp`
- Test: `projects/synth/tests/miniapp_system_tests.cpp`
- OpenSpec checkboxes covered: 4.1, 4.2

**Interfaces:**
- Consumes: `synth::ui::ScopeVisualizer<MiniAppCore::VcoModule::Voice::UIState or equivalent UI state type>` if module UI states expose arrays of layer states. If exact nested type names differ, use the concrete VCO/LFO UI-state element type already returned by `VcoModule::UIState` and `LfoModule::UIState`.
- Produces: three address-stable member visualizers retained by `MiniAppCore`.

- [ ] **Step 1: Write failing MiniApp topology tests**

In `miniapp_system_tests.cpp`, add:

```cpp
TEST_CASE(miniapp_registers_distinct_scope_visualizers_for_modulators) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(
        64,
        UseScratchRuntimeDataPaths("miniapp_registers_distinct_scope_visualizers_for_modulators"));
    auto* group = rig.Engine().Application().Group();
    REQUIRE_TRUE(group != nullptr);
    const auto& modulators = group->GetModulators();
    synth::ui::Visualizer* mod0 = modulators.Metadata(0).visualizer;
    synth::ui::Visualizer* mod1 = modulators.Metadata(1).visualizer;
    synth::ui::Visualizer* mod2 = modulators.Metadata(2).visualizer;
    REQUIRE_TRUE(mod0 != nullptr);
    REQUIRE_TRUE(mod1 != nullptr);
    REQUIRE_TRUE(mod2 != nullptr);
    REQUIRE_TRUE(mod0 != mod1);
    REQUIRE_TRUE(mod0->Visible());
    REQUIRE_TRUE(mod1->Visible());
    REQUIRE_TRUE(mod2->Visible());
}
```

Keep the Task 3 MiniApp tree test as the render proof.

- [ ] **Step 2: Run the failing MiniApp topology test**

Run: `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`

Expected: failure because MiniApp modulator visualizers are null.

- [ ] **Step 3: Construct and retain three visualizers**

In `MiniAppCore.hpp`, include `<memory>` or prefer direct member storage. Add member storage after UI-state members so destruction order keeps visualizers before referenced state if needed. Prefer direct members with pointer-vector constructor setup in `Init()`:

```cpp
std::unique_ptr<synth::ui::ScopeVisualizer<VcoUiLayerType>> vcoVisualizer0_;
std::unique_ptr<synth::ui::ScopeVisualizer<VcoUiLayerType>> vcoVisualizer1_;
std::unique_ptr<synth::ui::ScopeVisualizer<LfoUiLayerType>> lfoVisualizer_;
```

Resolve `VcoUiLayerType`/`LfoUiLayerType` from the actual module UI-state containers. If `VcoModule::UIState` is a `std::array<WavetableVco::UIState, kVoiceCount>`, the pointer span should point at its elements:

```cpp
std::array<VcoUiLayerType*, kVoiceCount> vcoLayers;
for (std::size_t ix = 0; ix < vcoLayers.size(); ++ix) {
    vcoLayers[ix] = &vcoUiStates_[ix];
}
vcoVisualizer0_ = std::make_unique<synth::ui::ScopeVisualizer<VcoUiLayerType>>(
    vcoLayers, synth_miniapp::VcoWaveformDrawState::x_MinY, synth_miniapp::VcoWaveformDrawState::x_MaxY,
    synth_miniapp::VcoWaveformDrawState::x_NumSamples, true);
vcoVisualizer1_ = std::make_unique<synth::ui::ScopeVisualizer<VcoUiLayerType>>(
    vcoLayers, synth_miniapp::VcoWaveformDrawState::x_MinY, synth_miniapp::VcoWaveformDrawState::x_MaxY,
    synth_miniapp::VcoWaveformDrawState::x_NumSamples, true);
```

Do the same for `lfoUiStates_` using `LfoWaveformDrawState` constants.

Register pointers after constructing visualizers:

```cpp
group.GetModulators().Metadata(0).visualizer = vcoVisualizer0_.get();
group.GetModulators().Metadata(1).visualizer = vcoVisualizer1_.get();
group.GetModulators().Metadata(2).visualizer = lfoVisualizer_.get();
```

Do this after `vcoModule_.RegisterModulationSources(...)` and `lfoModule_.RegisterModulationSource(...)` so module metadata names/colors remain intact.

- [ ] **Step 4: Verify MiniApp topology and render**

Run: `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`

Expected: PASS with exit code 0.

---

### Task 5: Braid 4 Null Path And Cross-App Regression

**Files:**
- Modify: `projects/synth/tests/braid4_system_tests.cpp`
- Inspect only unless required: `projects/synth/apps/braid-4/Braid4Core.hpp`
- OpenSpec checkboxes covered: 4.3, 4.4

**Interfaces:**
- Consumes: `ModulatorMetadata::visualizer`.
- Produces no Braid 4 visualizer instances.

- [ ] **Step 1: Write failing Braid metadata tests**

In `braid4_system_tests.cpp`, add:

```cpp
TEST_CASE(braid4_modulator_visualizer_pointers_remain_null) {
    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(
        64,
        UseScratchRuntimeDataPaths("braid4_modulator_visualizer_pointers_remain_null"));
    const synth::ParameterGroup* groups[] = {
        rig.Engine().Application().StereoGroup(),
        rig.Engine().Application().QuadGroup(),
        rig.Engine().Application().MonoGroup(),
    };
    for (const synth::ParameterGroup* group : groups) {
        REQUIRE_TRUE(group != nullptr);
        REQUIRE_TRUE(group->Config().numModulators == 2);
        REQUIRE_TRUE(group->GetModulators().Metadata(0).visualizer == nullptr);
        REQUIRE_TRUE(group->GetModulators().Metadata(1).visualizer == nullptr);
    }
}
```

- [ ] **Step 2: Run Braid tests**

Run: `make -C projects/synth build/braid4_system_tests && projects/synth/build/braid4_system_tests`

Expected: PASS once Task 2 introduced null defaults and Task 3 adopted the helper without adding Braid visualizers. If it fails, fix only the null-default path; do not construct Braid visualizers.

- [ ] **Step 3: Verify no backend files changed**

Run: `git status --short -- projects/synth/juce projects/synth/browser`

Expected: no output.

---

### Task 6: Coverage Docs, OpenSpec Progress, And Full Verification

**Files:**
- Modify: `projects/synth/docs/coverage.md`
- Modify: `openspec/changes/add-portable-modulator-visualizers/tasks.md`
- OpenSpec checkboxes covered: 5.1, 5.2, 5.3 and any earlier completed boxes not yet checked.

**Interfaces:**
- Consumes test names added by Tasks 1-5.
- Produces updated OpenSpec task checkboxes after implementation, reviews, and verification.

- [ ] **Step 1: Update coverage documentation**

Add rows in `projects/synth/docs/coverage.md` for:

```markdown
| `spv-1` | covered | `projects/synth/tests/portable_ui_tests.cpp` visualizer contract checks: bounds, default visible, hide/show, non-copyable/non-movable, JUCE-free compile |
| `spv-2` | covered | `projects/synth/tests/miniapp_system_tests.cpp` distinct MiniApp VCO visualizer addresses |
| `spv-3` | covered | `projects/synth/tests/portable_ui_tests.cpp` scope visualizer reads updated atomic model state without reconstruction; MiniApp retains app-owned instances |
| `spv-4` | covered | `projects/synth/tests/portable_ui_tests.cpp` `Builder::Visualizer` emits visible node and omits hidden node |
| `spv-5` | covered | `projects/synth/tests/portable_ui_tests.cpp` scope visualizer snapshots connected/color/scope/channel fields and keeps waveform geometry in bounds |
| `spm-70` | covered | `projects/synth/tests/parameter_modulation_tests.cpp` visualizer topology flows metadata -> depth config -> UI state, clears on disconnect, and stays out of JSON |
| `sru-24` | covered | `projects/synth/tests/miniapp_system_tests.cpp` visualizer node shares encoder bounds, precedes encoder, and encoder actions remain; null/hidden paths in portable/Braid tests |
| `sdsp-33` | covered | `projects/synth/tests/miniapp_system_tests.cpp` MiniApp constructs visible distinct VCO visualizers and one LFO visualizer |
| `d4-9` | covered | `projects/synth/tests/braid4_system_tests.cpp` all Braid 4 modulator visualizers are null and modulation view is encoder-only |
```

Use the existing table style exactly.

- [ ] **Step 2: Run focused verification**

Run:

```bash
make -C projects/synth build/portable_ui_tests build/parameter_modulation_tests build/miniapp_system_tests build/braid4_system_tests
projects/synth/build/portable_ui_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/miniapp_system_tests
projects/synth/build/braid4_system_tests
```

Expected: all four commands exit 0.

- [ ] **Step 3: Run full JUCE-free synth verification**

Run:

```bash
make -C projects/synth test
make -C projects/synth check-ui-boundary
openspec validate add-portable-modulator-visualizers --strict
```

Expected: all exit 0.

- [ ] **Step 4: Confirm backend files unchanged**

Run:

```bash
git status --short -- projects/synth/juce projects/synth/browser
```

Expected: no output.

- [ ] **Step 5: Mark OpenSpec tasks complete**

After Tasks 1-6 have passed implementation review and verification, update every checkbox in `openspec/changes/add-portable-modulator-visualizers/tasks.md` from `[ ]` to `[x]`.

- [ ] **Step 6: Final diff and review package**

Run:

```bash
git status --short
git diff --stat
```

Expected: only expected OpenSpec, synth portable/app/test/docs, `.superpowers` scratch, and plan/report files changed. Do not include unrelated `projects/synth/miniapp/` changes unless a prior task intentionally touched them.
