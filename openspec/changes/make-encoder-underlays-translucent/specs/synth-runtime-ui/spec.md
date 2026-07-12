## ADDED Requirements

### Requirement: sru-25 — Encoder grid: translucent visualizer underlays
WHEN a portable encoder grid renders an encoder node above a visible visualizer underlay, THE runtime UI layer SHALL request the shared encoder draw builder to use an underlay-aware body style whose central body fill is partially translucent while preserving the encoder's existing strokes, arcs, badges, labels, and pointer actions; WHEN no visible visualizer underlay is present, THE runtime UI layer SHALL preserve the existing opaque encoder body style.

#### Scenario: Underlay-backed encoder body is translucent
- **WHEN** a connected encoder draw state indicates a visible visualizer underlay
- **THEN** the encoder draw commands use a partially transparent central body fill
- **AND** retain the existing readable encoder outline and value commands

#### Scenario: Ordinary encoder body remains opaque
- **WHEN** a connected encoder draw state does not indicate a visible visualizer underlay
- **THEN** the encoder draw commands preserve the existing opaque central body fill

#### Scenario: Hidden visualizer does not affect encoder style
- **WHEN** a cell publishes a visualizer pointer whose visualizer is hidden
- **THEN** the portable encoder grid renders no visualizer node
- **AND** requests the ordinary opaque encoder body style

#### Scenario: Underlay styling is shared, not MiniApp drawing
- **WHEN** MiniApp or Braid 4 builds an encoder cell with a visible visualizer pointer
- **THEN** the app surface only marks the shared encoder draw state as having an underlay
- **AND** the alpha choice remains inside shared portable encoder drawing code
