## ADDED Requirements

### Requirement: spm-70 — UI topology: optional modulator visualizer publication
WHEN a modulation source is registered, THE synth parameter modulation system SHALL allow its `ModulatorMetadata` to carry a nullable non-owning portable `Visualizer*`; SHALL copy that association into the corresponding materialized modulation-depth parameter configuration; SHALL publish it atomically through that parameter's `Parameter::UIState` within the existing snapshot transaction; and SHALL publish null for disconnected cells, ordinary parameters, and modulators configured without a visualizer.

#### Scenario: Modulation-depth cell publishes its source visualizer
- **WHEN** modulator `1` is initialized with a non-null visualizer and a parameter's modulation view materializes depth control `1`
- **THEN** the visible depth control's UI state publishes the same visualizer address
- **AND** no visualizer ownership is transferred to the parameter or UI snapshot

#### Scenario: Null visualizer remains null
- **WHEN** a modulator is initialized without a visualizer and its depth control becomes visible
- **THEN** that control's UI state publishes a null visualizer pointer

#### Scenario: Disconnected cell clears visualizer topology
- **WHEN** a previously populated visible cell is set disconnected
- **THEN** its UI state publishes a null visualizer pointer with the other neutral disconnected fields

#### Scenario: Visualizer topology is not patch state
- **WHEN** parameter values are saved and loaded
- **THEN** no visualizer pointer, visibility flag, bounds, or model address is serialized or restored
