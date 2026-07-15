## ADDED Requirements

### Requirement: spv-6 — Noise visualizer: model-free redraw noise
WHEN a noise modulation source needs an illustrative portable waveform, THE synth portable UI system SHALL provide a JUCE-free `NoiseWaveformVisualizer` that owns its own non-cryptographic pseudorandom state, requires no DSP or UI-state model, and emits one newly generated monophonic polyline on every visible draw with a random y position inside its bounds for every integer horizontal pixel column across positive drawing bounds.

#### Scenario: Noise trace covers horizontal pixel positions
- **WHEN** the noise visualizer draws into positive finite bounds
- **THEN** it emits one monophonic polyline spanning the bounds from left to right
- **AND** the polyline contains one independently generated y position for every integer horizontal pixel column it covers
- **AND** every point remains inside the assigned bounds

#### Scenario: Every UI draw regenerates the trace
- **WHEN** the same visible noise visualizer draws twice with unchanged bounds
- **THEN** the second draw advances the visualizer's private pseudorandom stream and produces a newly generated waveform rather than reusing the first path

#### Scenario: Visualization is independent from audible noise
- **WHEN** an application constructs and draws the noise visualizer
- **THEN** no processor output pointer, scope writer, scope reader, `UIState`, or polyphonic voice collection is required
- **AND** the drawn trace makes no claim to reproduce the noise samples that actually modulated DSP

#### Scenario: Explicit visualizer seed supports geometry tests
- **WHEN** two noise visualizers receive the same explicit seed and identical bounds
- **THEN** their corresponding draw sequences contain identical geometry
- **AND** normal visualizer construction may choose a seed once during initialization without using entropy during drawing
