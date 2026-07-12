## ADDED Requirements

### Requirement: d4-9 — Modulators: visualizer slots remain empty
WHEN Braid 4 initializes its stereo, quad, and mono modulation sources, THE application SHALL leave every modulator's optional visualizer pointer null and SHALL continue rendering Braid 4 modulation-depth cells as encoder-only cells until a later change explicitly assigns visualizer instances.

#### Scenario: All Braid 4 groups use null visualizers
- **WHEN** Braid 4 initialization completes
- **THEN** both modulators in the stereo group publish null visualizer pointers
- **AND** both modulators in the quad group publish null visualizer pointers
- **AND** both modulators in the mono group publish null visualizer pointers

#### Scenario: Braid modulation view remains encoder-only
- **WHEN** a Braid 4 modulation-depth view is rendered
- **THEN** every visible depth cell contains its existing encoder node
- **AND** no modulator visualizer node is added
