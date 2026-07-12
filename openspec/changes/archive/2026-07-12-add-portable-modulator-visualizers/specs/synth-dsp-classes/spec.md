## ADDED Requirements

### Requirement: sdsp-33 — MiniApp: per-modulator scope visualizer instances
WHEN MiniApp initializes its three pointer-backed modulation sources, THE application SHALL construct three visible, address-stable portable scope visualizer instances; SHALL assign distinct VCO visualizer instances to modulators `0` and `1`; SHALL assign one LFO visualizer instance to modulator `2`; SHALL bind the two VCO visualizers to the stable app-owned VCO module UI state and the LFO visualizer to the stable app-owned LFO module UI state; and SHALL retain all visualizers and referenced UI state through application teardown.

#### Scenario: VCO modulators do not alias component identity
- **WHEN** MiniApp initialization completes
- **THEN** modulator `0` and modulator `1` have non-null visualizer pointers with different addresses
- **AND** both visualizers render from the MiniApp VCO UI-state collection

#### Scenario: LFO modulator uses LFO state
- **WHEN** MiniApp opens a modulation view containing modulator `2`
- **THEN** its depth encoder has an LFO scope visualizer beneath it
- **AND** the visualizer reads the MiniApp LFO module's published UI state

#### Scenario: MiniApp visualizers remain portable
- **WHEN** MiniApp visualizer initialization and drawing are compiled in the JUCE-free synth test targets
- **THEN** they require no backend header or backend-specific component implementation
