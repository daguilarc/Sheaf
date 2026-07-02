# synth-dsp-classes Delta

## MODIFIED Requirements

### Requirement: sdsp-1 — Project: synth DSP modules
WHEN the synth DSP classes capability is implemented, THE repository SHALL provide JUCE-free C++20 synth DSP modules under `projects/synth/include/synth` and `projects/synth/src`, SHALL include those modules in the `projects/synth` library build, and SHALL keep JUCE-dependent waveform rendering in `projects/synth/juce`, `projects/synth/runtime`, or `projects/synth/apps` rather than in JUCE-free DSP headers.

#### Scenario: DSP code builds in synth library
- **WHEN** a developer runs `make -C projects/synth build`
- **THEN** the synth library builds the DSP source files and public DSP headers without including JUCE headers

#### Scenario: DSP tests run in synth suite
- **WHEN** a developer runs `make -C projects/synth test`
- **THEN** the DSP unit tests run as part of the synth test suite

#### Scenario: JUCE waveform code stays outside core DSP
- **WHEN** a JUCE-free synth test includes every public DSP header
- **THEN** the test compiles without seeing `JUCE_MAJOR_VERSION`
