## ADDED Requirements

### Requirement: sru-24 — Modulation view: visualizer beneath encoder
WHEN a portable encoder grid renders a connected modulation-depth cell whose complete `Parameter::UIState` publishes a non-null visible visualizer, THE runtime UI layer SHALL assign that visualizer bounds exactly equal to the encoder cell's square, append a stable visualizer draw node before the encoder node, and append the existing interactive encoder node above it using the portable tree contract that later overlapping nodes draw above earlier overlapping nodes; WHEN the published pointer is null or the visualizer is intrinsically hidden, THE runtime UI layer SHALL render only the existing encoder node.

#### Scenario: Visualizer and encoder share a square
- **WHEN** a visible modulation-depth cell has square encoder bounds and a visible visualizer
- **THEN** the portable tree contains a visualizer draw node with exactly the encoder bounds
- **AND** the encoder draw node follows it in stacking order with the same bounds

#### Scenario: Encoder remains interactive above visualizer
- **WHEN** a visualizer is rendered beneath an encoder
- **THEN** the encoder retains its existing drag and double-click actions
- **AND** the display-only visualizer exposes no competing pointer action

#### Scenario: Missing visualizer preserves existing rendering
- **WHEN** a visible modulation-depth cell publishes a null visualizer pointer
- **THEN** the tree contains the same encoder node and encoder commands as before this capability
- **AND** contains no visualizer node for that cell

#### Scenario: Top-level cells do not infer source visualizers
- **WHEN** the encoder grid shows an ordinary top-level parameter rather than a materialized modulation-depth control
- **THEN** it renders the encoder without looking up or inferring a visualizer from group topology
