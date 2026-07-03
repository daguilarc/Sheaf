## MODIFIED Requirements

### Requirement: sar-11 — Miniapp: runtime-hosted reference application
WHEN the miniapp is ported to the runtime, THE miniapp application at `projects/synth/apps/miniapp` SHALL contain only application-specific content — runtime config, duophonic group and VCO/LFO module setup, page/bank/slot layout, scope wiring, per-sample block processing, and its bespoke widgets — SHALL preserve the existing specced miniapp behaviors (encoder grid, pages, scenes, gestures, MIDI controller configuration, patch commands, waveform pane), SHALL expose the LFO page as five module-backed parameters, and SHALL write its processed VCO output to the negotiated audio device outputs using the device-provided sample rate.

#### Scenario: Miniapp init is application content only
- **WHEN** the miniapp sources are inspected
- **THEN** manager/bus/patch-manager construction, message pumping, MIDI device glue, and patch orchestration are absent, provided instead by the runtime

#### Scenario: Miniapp produces audible output
- **WHEN** the miniapp runs with an output-capable audio device
- **THEN** the summed VCO voices are written to the device output channels
- **AND** the VCO module uses the negotiated device sample rate

#### Scenario: Miniapp LFO page is module-backed
- **WHEN** the miniapp LFO page is active
- **THEN** the selected slot exposes Frequency, Shape, Phase Offset, Skew, and Exponent from `BasicLfoModule<2>`
- **AND** the LFO modulation source is produced by that module during per-sample block processing

#### Scenario: Behavior parity with the probe app
- **WHEN** the ported miniapp runs
- **THEN** the existing miniapp scenarios for encoders, modulation views, scenes, gestures, MIDI configuration, and patch save/load continue to hold

### Requirement: sar-14 — Miniapp: headless system-test coverage
WHEN the miniapp is ported, THE miniapp SHALL be structured as a JUCE-free application core plus a thin UI wrapper, and THE synth test suite SHALL include a rig-hosted miniapp system test that initializes the core through the engine, runs blocks, drives encoder and scene/gesture messages, verifies audio output renders without NaN with nonzero peak when the VCO volume is raised, verifies the module-backed LFO page exposes and routes five parameters, and round-trips a patch save/load through the production message flow.

#### Scenario: Miniapp core tests run JUCE-free
- **WHEN** a developer runs `make -C projects/synth test`
- **THEN** the rig-hosted miniapp system test builds without JUCE and passes as part of the suite

#### Scenario: Headless LFO page routes five parameters
- **WHEN** the rig selects the LFO page
- **THEN** the selected slot contains Frequency, Shape, Phase Offset, Skew, and Exponent controls
- **AND** turning each visible LFO control changes the corresponding parameter value through the production message path

#### Scenario: Headless patch round-trip
- **WHEN** the rig test edits parameters, saves a patch, perturbs state, and loads the saved patch
- **THEN** the loaded parameter values match the saved values through the production patch message flow
