## Context

The portable synth UI already separates DSP publication (`ScopeWriter` and module `UIState` objects), host-neutral drawing commands, semantic `NodeTree` nodes, and backend adapters. Scope widgets are currently assembled as app-specific draw-state values plus free functions that require bounds at every call. Modulation-source metadata contains names, colors, and connection state, but a visible modulation-depth cell cannot identify a source-specific visual component.

MiniApp owns its VCO and LFO module UI states as address-stable app-core members. The parameter manager separately owns a stable UI snapshot tree whose atomic cell fields are populated from live parameters. The proposed visualizer association crosses those trees by non-owning pointer and must therefore have an explicit initialization and lifetime contract.

## Goals / Non-Goals

**Goals:**

- Introduce a JUCE-free, backend-agnostic component object with identity, bounds, visibility, and portable drawing behavior.
- Give every non-null visualizer exactly one placement while allowing separate instances to observe the same stable DSP UI state.
- Carry an optional visualizer association from modulator initialization through the corresponding modulation-depth parameter and published cell UI state.
- Compose a visible modulator visualizer and encoder in the same square with deterministic visualizer-below-encoder stacking.
- Demonstrate the abstraction with two independent MiniApp VCO visualizers and one MiniApp LFO visualizer.
- Preserve null visualizer behavior for Braid 4 and all other existing clients.

**Non-Goals:**

- Add or modify JUCE, browser, DOM, canvas, or other backend adapter code.
- Add visualizer input handling, focus, accessibility actions, animation scheduling, or ownership of UI refresh cadence.
- Change DSP processing, modulation values, parameter persistence, scope capture, or existing standalone waveform panels.
- Generalize all DSP UI state behind one polymorphic state hierarchy.

## Decisions

### 1. Make the visualizer the polymorphic boundary

Add a JUCE-free abstract `synth::ui::Visualizer` whose concrete instance owns its current `Bounds` and visible flag and whose protected virtual drawing operation produces portable `DrawCommand` values for those bounds. Constructed visualizers are visible by default; the public draw path returns no content while hidden. The base is non-copyable and non-movable so its address is stable and its identity cannot accidentally be duplicated during topology setup.

Concrete visualizers retain typed, non-owning pointers to the UI-state objects they read. This keeps the existing module UI states intact and places polymorphism at the component boundary. A polymorphic UI-state hierarchy was rejected because VCO, LFO, transfer-function, and future DSP state have legitimately different contracts. A type-erased callback was rejected because it obscures identity and lifetime.

### 2. Treat every instance as one placed component

A non-null `Visualizer*` may identify only one visualizer placement. Applications that need the same content in two positions construct two visualizer instances; those instances may read the same model state. The application owns each instance and every model it references, and keeps both alive and address-stable from modulation-source registration through the final UI refresh and teardown.

The contract is explicit rather than implemented with a global pointer registry. Global registration would add mutable process-wide state and would still not express application teardown correctly. MiniApp tests prove distinct instance addresses for its first two modulators.

### 3. Represent a visible visualizer as an ordinary portable draw node

Extend the JUCE-free portable builder with a visualizer composition helper. When a visualizer is visible, the helper emits one `NodeKind::Draw` node using the visualizer's stored bounds and current portable commands; when hidden, it emits no visualizer node. This uses the existing portable node contract, so current backends can render the node without backend changes.

Each app surface's `BuildTree()` loop assigns the encoder square to the visualizer through the helper, appends the visualizer node first, and appends the interactive encoder node second. Tree order is the portable stacking contract: later overlapping draw nodes are above earlier ones. A stable visualizer node ID is derived from the encoder cell ID so repeated tree builds preserve identity.

Visualizer visibility is an intrinsic enable/disable property. Cell visibility remains structural: a visualizer is emitted only while the associated modulation-depth cell is in the current tree. Leaving a modulation view therefore needs no mutation of the visualizer's intrinsic visible flag.

### 4. Publish the association through parameter UI state

Add nullable `synth::ui::Visualizer*` fields to `ModulatorMetadata`, `ParameterConfig`, and `Parameter::UIState`, using a forward declaration in the parameter header. `Parameter::ModulationDepthConfig(modIx)` copies the pointer from the corresponding modulator metadata when the local depth parameter is materialized. `PopulateUIState` publishes that stable pointer atomically with the rest of the snapshot; disconnected state and ordinary top-level parameters publish null.

The pointer is topology, not patch data. It is never serialized, restored, allocated, or changed by the audio path. Existing callers that omit it retain null behavior.

### 5. Build scope visualizers over stable typed state

Provide a reusable portable scope visualizer implementation that reads a configured collection of stable VCO- or LFO-style UI-state pointers, snapshots their atomic connection/scope/channel/color fields at draw time, and delegates geometry generation to the existing shared scope-waveform command builder. Its construction also fixes the y range, sample window, and marker policy.

MiniApp owns three visualizer objects after the module UI-state members they reference. Modulators 0 and 1 receive distinct VCO visualizer pointers, while modulator 2 receives the LFO visualizer pointer. The two VCO instances may observe the same VCO UI-state collection but never share component identity. Braid 4 passes no visualizer pointers.

### 6. Keep the first version display-only

The initial abstraction has no action or pointer-event contract. The encoder remains the interactive node above the visualizer and continues receiving drag and double-click gestures across the shared square. Adding visualizer interaction later requires a separate specification of hit testing and event propagation.

## Risks / Trade-offs

- **[Dangling non-owning pointers]** → Require app-owned visualizers and model states to be address-stable for the registered topology lifetime; use non-copyable/non-movable visualizers and tests that exercise refresh after initialization.
- **[Accidental instance aliasing]** → State the one-instance/one-placement contract and verify MiniApp registers distinct addresses for modulators 0 and 1. Avoid a global registry whose own lifetime would be harder to reason about.
- **[Concurrent pointer publication]** → Publish the topology pointer atomically inside the existing parameter UI snapshot transaction and never mutate it during steady-state audio processing.
- **[Encoder readability over a waveform]** → Preserve existing encoder commands and draw them last; visual tuning beyond command order is deferred until implementation tests show it is necessary.
- **[Backend stacking differences]** → Use existing ordered portable draw nodes and add JUCE-free tree/command ordering tests; backend-specific fixes are explicitly outside this change.
- **[Visualizers disappear outside modulation views]** → Treat cell presence as structural visibility and intrinsic `Visualizer::visible` as an independent opt-out, avoiding stale show/hide state during bank transitions.

## Migration Plan

Introduce nullable fields with null defaults so existing source registrations and parameter construction continue to compile and render as before. Add the portable abstraction and tests, propagate the pointer through parameter state, add a portable builder helper and adopt it in the MiniApp and Braid 4 `BuildTree()` loops, then opt MiniApp into the feature. Keep Braid 4 explicitly null and run the complete JUCE-free synth suite. Rollback consists of removing the MiniApp registrations and nullable propagation; no stored data or backend migration is involved.

## Open Questions

None. Pointer ownership, instance identity, input behavior, stacking, MiniApp wiring, Braid 4 behavior, and backend scope are fixed by this design.
