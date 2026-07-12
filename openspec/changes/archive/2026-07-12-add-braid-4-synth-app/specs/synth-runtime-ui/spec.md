## ADDED Requirements

### Requirement: sru-21 — Portable UI: reusable scope-waveform drawing
WHEN a synth application needs to draw scope-backed waveforms, THE runtime UI layer SHALL provide JUCE-free shared portable drawing logic that converts a scope writer/channel, connection state, color, and target bounds into bounded waveform draw commands, and SHALL allow multiple applications to use that logic without including another application's headers or depending on a JUCE waveform component.

#### Scenario: MiniApp preserves waveform behavior
- **WHEN** MiniApp migrates from its app-local scope draw math to the shared helper
- **THEN** equivalent scope snapshots and bounds produce equivalent waveform paths, colors, and clipping behavior

#### Scenario: Braid uses independent waveform bounds
- **WHEN** Braid supplies audible and LFO scope channels with non-overlapping panel bounds
- **THEN** the helper produces independently bounded waveform command sets for every supplied channel
- **AND** it does not overlay one channel into another channel's panel

#### Scenario: Shared helper remains JUCE-free
- **WHEN** a synth test includes the shared waveform builder and constructs commands from a fake scope snapshot
- **THEN** it compiles and runs without JUCE headers

### Requirement: sru-22 — Braid 4: waveform and encoder main screen
WHEN the Braid 4 application surface is visible, THE runtime UI SHALL show four audible VCO waveform panels in a 2x2 grid stacked above four LFO waveform panels in a second 2x2 grid, all sixteen cells of its unique bank slot in a 4x4 encoder grid, and one compact global scene strip with selectors for scenes `0/1` plus the shared blend fader; SHALL bind encoder cells in row-major order to slot `0` positions `0..15`; SHALL reflect the currently selected Braid, matrix, LFO, or LFO matrix bank through the existing slot UI state; and SHALL keep both complete waveform grids, the encoder grid, and the scene strip visible without scrolling at the default application size.

#### Scenario: Four waveforms occupy a 2x2 grid
- **WHEN** Braid's default screen is built
- **THEN** oscillator 1, 2, 3, and 4 draw in the top-left, top-right, bottom-left, and bottom-right waveform panels respectively
- **AND** each panel reads its corresponding published VCO UI state and scope channel

#### Scenario: Four LFO waveforms occupy a second 2x2 grid
- **WHEN** Braid's default screen is built
- **THEN** LFO oscillator 1, 2, 3, and 4 draw in a second 2x2 grid below the audible VCO grid
- **AND** each panel reads its corresponding published LFO UI state and scope channel

#### Scenario: Sixteen encoders occupy a 4x4 grid
- **WHEN** Braid's default screen is built
- **THEN** it contains sixteen encoder nodes arranged as four rows of four
- **AND** node `n` dispatches turns and pushes to slot `0`, position `n`

#### Scenario: Reserved positions use shared disconnected encoder state
- **WHEN** the Braid bank is active
- **THEN** encoder nodes `2` and `3` remain present and interactive for slot `0` positions `2` and `3`
- **AND** they use the shared encoder renderer's empty disconnected draw-command state
- **AND** the remaining fourteen nodes render their parameter names, configured color, value state, and native voice indicators

#### Scenario: All four banks reuse the same encoder grid
- **WHEN** any of the audible Braid, audible matrix, LFO Braid, or LFO matrix banks becomes active through the existing bank-selection message path
- **THEN** all sixteen encoder nodes update to the active bank's parameters
- **AND** no second encoder slot or second encoder grid is created

#### Scenario: Scene strip remains global across banks
- **WHEN** the user selects either scene or changes blend and then switches between Braid and matrix banks
- **THEN** the same scene endpoints and blend remain displayed and active
- **AND** the UI creates no bank-local scene selector or fader

#### Scenario: Visual treatment carries astronomical character
- **WHEN** Braid's surface draws its default background and panels
- **THEN** it uses a near-black deep-space treatment with red audible VCO waveform/control accents, green LFO waveform/control accents, orange audible matrix accents, and yellow/green-yellow LFO matrix accents
- **AND** all text and control state remain legible through the portable UI backend
