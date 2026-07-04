## MODIFIED Requirements

### Requirement: sar-11 — Miniapp: runtime-hosted reference application
WHEN the miniapp is ported to the runtime, THE miniapp application at `projects/synth/apps/miniapp` SHALL contain only application-specific content — runtime config, duophonic group and VCO/LFO/filter module setup, page/bank/slot layout, scope wiring, per-sample block processing, and its bespoke widgets — SHALL preserve the existing specced miniapp behaviors (encoder grid, pages, scenes, gestures, MIDI controller configuration, patch commands, waveform pane), SHALL expose the VCO page as module-backed VCO controls plus filter Cutoff, Resonance, and Blend controls, SHALL expose the LFO page as five module-backed parameters, and SHALL write its filtered VCO output to the negotiated audio device outputs using the device-provided sample rate.

#### Scenario: Miniapp init is application content only
- **WHEN** the miniapp sources are inspected
- **THEN** manager/bus/patch-manager construction, message pumping, MIDI device glue, and patch orchestration are absent, provided instead by the runtime

#### Scenario: Miniapp produces audible filtered output
- **WHEN** the miniapp runs with an output-capable audio device
- **THEN** the filtered VCO voices are written to the device output channels
- **AND** the VCO and filter modules use the negotiated device sample rate

#### Scenario: Miniapp VCO page exposes filter controls
- **WHEN** the miniapp VCO page is active
- **THEN** the selected slot exposes Tune, Phase, Shape, Volume, Cutoff, Resonance, and Blend in that visible order
- **AND** Cutoff, Resonance, and Blend come from `ClassicSvfModule<2>`

#### Scenario: Miniapp LFO page is module-backed
- **WHEN** the miniapp LFO page is active
- **THEN** the selected slot exposes Frequency, Shape, Phase Offset, Skew, and Exponent from `BasicLfoModule<2>`
- **AND** the LFO modulation source is produced by that module during per-sample block processing

#### Scenario: Behavior parity with the probe app
- **WHEN** the ported miniapp runs
- **THEN** the existing miniapp scenarios for encoders, modulation views, scenes, gestures, MIDI configuration, and patch save/load continue to hold
