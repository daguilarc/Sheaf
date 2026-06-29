## MODIFIED Requirements

### Requirement: spm-26 — Miniapp: JUCE external control probe
WHEN the synth external UI/message layer and DSP miniapp integration are implemented, THE repository SHALL contain a `projects/synth/miniapp` JUCE application that demonstrates the parameter system, MIDI message routing, DSP-backed parameters, scope UI-state snapshots, and reusable JUCE components while keeping JUCE code outside core synth library headers and sources.

#### Scenario: Miniapp shows current feature set
- **WHEN** the miniapp runs
- **THEN** it displays reusable synth JUCE encoder components, buttons, sliders, one parameter group with two voices, page-bank controls for Tune, Phase, Shape, Volume, and LFO Speed, three scene selection buttons, scene blend, visible left/right scene endpoint state, gesture selection, gesture value, latching shift state, three modulation sources, and one waveform pane containing both VCO traces

#### Scenario: Miniapp uses local JUCE checkout
- **WHEN** the miniapp target is built in this repository layout
- **THEN** it uses the developer-local `~/JUCE` checkout by default or documents the missing local dependency precisely

#### Scenario: Miniapp double-click creates modulation view
- **WHEN** the user double-clicks an encoder representing a top-level parameter
- **THEN** the miniapp sends a parameter push message through `MessageInBus`
- **AND** the visible UI updates to show modulation-depth controls for that parameter and the target parameter at the final visible position

#### Scenario: Miniapp modulator uses DSP and LFO sources
- **WHEN** the miniapp processing step advances modulation sources
- **THEN** modulator 0 receives the two VCO outputs mapped by voice and normalized into `[0, 1]`
- **AND** modulator 1 receives the two VCO outputs swapped by voice and normalized into `[0, 1]`
- **AND** modulator 2 receives the existing sine/cosine LFO values for the two voices

#### Scenario: Miniapp converts colors at JUCE boundary
- **WHEN** the miniapp paints synth UI state
- **THEN** it converts `synth::Color` to `juce::Colour` in miniapp code
- **AND** core synth files remain free of JUCE includes
