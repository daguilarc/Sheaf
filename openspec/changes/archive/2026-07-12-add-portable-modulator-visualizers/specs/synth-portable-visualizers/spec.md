## ADDED Requirements

### Requirement: spv-1 — Component: backend-agnostic visualizer contract
WHEN synth UI content needs a reusable visual component, THE synth portable UI system SHALL provide a JUCE-free polymorphic `Visualizer` class with instance-owned bounds, intrinsic visible/hidden state that defaults to visible at construction, and portable draw-command production; SHALL keep its public headers free of backend toolkit types; and SHALL make visualizer instances non-copyable and non-movable so their registered addresses remain stable.

#### Scenario: Visualizer is host independent
- **WHEN** a JUCE-free test includes and derives from the visualizer contract
- **THEN** it can set bounds, change visibility, and produce portable drawing commands
- **AND** no JUCE, browser, DOM, canvas, or other host-backend type is required

#### Scenario: Visualizer identity is stable
- **WHEN** compile-time traits inspect the visualizer base and a concrete visualizer
- **THEN** visualizer instances cannot be copied or moved

### Requirement: spv-2 — Component: one instance has one placement
WHEN an application registers visualizers into its static synth topology, THE application SHALL use one distinct visualizer instance for each component placement, SHALL NOT assign one visualizer pointer to multiple modulator placements, and MAY construct multiple visualizer instances that read the same address-stable UI model state.

#### Scenario: Equivalent content appears twice
- **WHEN** two modulators must display the same VCO state in two encoder cells
- **THEN** the application constructs two visualizer instances with distinct addresses
- **AND** both instances may retain pointers to the same VCO UI-state objects

### Requirement: spv-3 — Lifetime: visualizer model pointers are non-owning
WHEN a concrete visualizer is initialized with pointers to DSP or module UI state, THE application SHALL retain ownership of those state objects and the visualizer, SHALL keep their addresses valid from registration through the last UI refresh and teardown, and SHALL NOT transfer ownership through modulator metadata or parameter UI snapshots.

#### Scenario: Stable app-owned model is read at draw time
- **WHEN** an app-owned module publishes new atomic UI-state values after visualizer construction
- **THEN** the visualizer reads the new values from the same retained model addresses on its next draw
- **AND** it does not copy, delete, or rebind ownership of those model objects

### Requirement: spv-4 — Visibility: hidden visualizers emit no component
WHEN portable UI composition encounters a visualizer, THE portable UI system SHALL emit a draw node using the visualizer's current bounds and commands only if its intrinsic state is visible, and SHALL emit no visualizer node or commands while it is hidden.

#### Scenario: Visible visualizer is placed
- **WHEN** a visualizer is visible and has positive bounds
- **THEN** portable composition emits one draw node at exactly those bounds with that visualizer's commands

#### Scenario: Hidden visualizer is absent
- **WHEN** the same visualizer is hidden
- **THEN** portable composition emits no node for it

#### Scenario: Visualizer is visible by default
- **WHEN** a visualizer has just been constructed
- **THEN** its intrinsic state is visible
- **AND** portable composition may emit its draw node without an explicit show call

### Requirement: spv-5 — Scope visualizer: typed UI-state adaptation
WHEN scope-backed DSP state is displayed through a visualizer, THE synth portable UI system SHALL provide a reusable concrete or templated scope visualizer that retains typed non-owning UI-state pointers, snapshots their atomic connection, color, scope-writer, and channel fields at draw time, and delegates bounded waveform geometry to the shared scope-waveform command builder using construction-time y-range, sample-window, and marker settings.

#### Scenario: Scope state changes without reconstruction
- **WHEN** a connected scope UI state publishes a different channel or color after its visualizer is initialized
- **THEN** the next visualizer draw uses the newly published channel or color
- **AND** the visualizer instance and model pointer remain unchanged

#### Scenario: Missing scope layer is skipped
- **WHEN** one configured UI-state layer is disconnected or has a null scope writer
- **THEN** the scope visualizer omits that layer without failing or producing out-of-bounds geometry
