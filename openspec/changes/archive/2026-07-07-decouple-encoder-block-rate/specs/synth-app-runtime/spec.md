## MODIFIED Requirements

### Requirement: sar-6 — Audio: device ownership and block delegation
WHEN audio is running, THE runtime SHALL own the JUCE audio device and its callback, and per device block SHALL apply pending patch messages (using an engine-owned preallocated patch serialization context whose arena growth and retry are owned by the message thread), process the UI and MIDI message buses into the parameter manager, and call the application's block-processing function exactly once with a JUCE-free audio block view exposing input pointers, output pointers, actual channel counts, frame count, and the block's monotonic starting audio sample index; THE runtime SHALL NOT use host audio block boundaries as the steady-state parameter target recomputation cadence, SHALL NOT call `Process` on any DSP module, and SHALL NOT perform per-sample parameter processing — per-sample work (parameter target refresh through the parameter system's configured sample interval, parameter `ProcessLite`, modulation-source updates, module processing, output writes) SHALL be owned by the application's block-processing function.

#### Scenario: Runtime pumps then delegates
- **WHEN** an audio device block is processed
- **THEN** queued patch, UI, and MIDI messages are applied to the manager before the application's block-processing function is called
- **AND** the application's block-processing function is called exactly once for that block

#### Scenario: Control edits slew rather than snap
- **WHEN** an encoder message changes a parameter target while audio runs
- **THEN** the parameter's audible value approaches the new target through the parameter system's per-sample processing and `ProcessLite` slewing over subsequent samples rather than jumping in one block

#### Scenario: Application owns per-sample processing
- **WHEN** the application's block-processing function runs
- **THEN** module processing, per-sample parameter processing, and modulation-source updates are invoked by application code, not by runtime code

#### Scenario: Block view is JUCE-free
- **WHEN** the application's block-processing code is compiled in a JUCE-free translation unit
- **THEN** the audio block view type compiles without JUCE headers

#### Scenario: Block view exposes monotonic sample position
- **WHEN** the runtime calls the application's block-processing function for consecutive blocks
- **THEN** the second block's starting sample index equals the first block's starting sample index plus the first block's frame count

### Requirement: sar-11 — Miniapp: runtime-hosted reference application
WHEN the miniapp is ported to the runtime, THE miniapp application at `projects/synth/apps/miniapp` SHALL contain only application-specific content — runtime config, duophonic group and VCO/LFO/filter module setup, page/bank/slot layout, scope wiring, per-sample block processing, and its bespoke widgets — SHALL preserve the existing specced miniapp behaviors (encoder grid, pages, scenes, gestures, MIDI controller configuration, patch commands, waveform pane), SHALL process its parameter group through the synth parameter system's group-level per-sample processing API using the audio block's monotonic sample index, SHALL expose the VCO page as module-backed VCO controls plus filter Cutoff, Resonance, and Blend controls, SHALL expose the LFO page as five module-backed parameters, and SHALL write its filtered VCO output to the negotiated audio device outputs using the device-provided sample rate.

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

#### Scenario: Miniapp uses parameter-owned compute cadence
- **WHEN** the miniapp's per-sample block processing is inspected
- **THEN** it calls the synth parameter system's group-level per-sample processing API with `block.startSample + frame`
- **AND** it does not separately schedule steady-state `Compute()` or `ComputeAllTargets()` from host block size

#### Scenario: Behavior parity with the probe app
- **WHEN** the ported miniapp runs
- **THEN** the existing miniapp scenarios for encoders, modulation views, scenes, gestures, MIDI configuration, and patch save/load continue to hold
