# synth-parameter-modulation Delta

## MODIFIED Requirements

### Requirement: spm-26 — Miniapp: JUCE external control probe
WHEN the synth external UI/message layer, DSP miniapp integration, and module-backed VCO patch are implemented, THE repository SHALL contain a `projects/synth/apps/miniapp` JUCE application, hosted by the synth application runtime, that demonstrates the parameter system, MIDI message routing, DSP-backed module parameters, scope UI-state snapshots, and reusable JUCE components while keeping JUCE code outside core synth library headers and sources.

#### Scenario: Miniapp shows current feature set
- **WHEN** the miniapp runs
- **THEN** it displays reusable synth JUCE encoder components, buttons, sliders, one parameter group with two voices, module-backed page-bank controls for Tune, Phase, Shape, Volume, and LFO Speed, three scene selection buttons, scene blend, visible left/right scene endpoint state, gesture selection, gesture value, latching shift state, three modulation sources, and one waveform pane containing both VCO traces

#### Scenario: Miniapp uses local JUCE checkout
- **WHEN** the miniapp target is built in this repository layout
- **THEN** it uses the developer-local `~/JUCE` checkout by default or documents the missing local dependency precisely

#### Scenario: Miniapp double-click creates modulation view
- **WHEN** the user double-clicks an encoder representing a top-level parameter
- **THEN** the miniapp sends a parameter push message through `MessageInBus`
- **AND** the visible UI updates to show modulation-depth controls for that parameter and the target parameter at the final visible position

#### Scenario: Miniapp modulator uses module and LFO sources
- **WHEN** the miniapp processing step advances modulation sources
- **THEN** modulator 0 receives the dual VCO module's direct normalized source floats for the two voices
- **AND** modulator 1 receives the dual VCO module's swapped normalized source floats for the two voices
- **AND** modulator 2 receives the existing sine/cosine LFO values for the two voices

#### Scenario: Miniapp converts colors at JUCE boundary
- **WHEN** the miniapp paints synth UI state
- **THEN** it converts `synth::Color` to `juce::Colour` in miniapp code
- **AND** core synth files remain free of JUCE includes

### Requirement: spm-37 — Miniapp: MIDI controller configuration
WHEN the synth miniapp runs with the MIDI controller change, THE miniapp SHALL expose, through the synth application runtime's shell, a simple configuration page that lets the user choose a controller preset, choose MIDI input and output devices, open or close those devices, register the real synth MIDI processors against a MIDI-specific `MessageInBus` and `ParameterManager::UIState`, shut down MIDI sender/device resources cleanly, and render disconnected slot positions as empty space rather than inactive controller chrome.

#### Scenario: Miniapp preset controls visible encoders
- **WHEN** the user selects the Twister or Wrld.Bldr preset and opens a matching MIDI input device
- **AND** the hardware sends a mapped encoder turn CC for a visible miniapp slot position
- **THEN** the miniapp processes a scaled `ParamIncDec` through the MIDI input bus on the next runtime bus-processing pass
- **AND** the visible encoder value changes according to the selected bank and slot-position mapping

#### Scenario: Miniapp push opens modulation view
- **WHEN** the user opens a MIDI input device with a selected preset
- **AND** the hardware sends a mapped pushbutton CC for a top-level miniapp parameter
- **THEN** the miniapp processes a `ParamPush` through `MessageInBus`
- **AND** the visible encoder grid updates to the modulation view

#### Scenario: Miniapp output follows UI state
- **WHEN** the user opens a MIDI output device with a selected preset
- **AND** miniapp UI-state values or colors change
- **THEN** the registered MIDI output processor enqueues the corresponding hardware feedback messages through the MIDI sender

#### Scenario: Miniapp remains usable without MIDI hardware
- **WHEN** no MIDI input or output device is opened
- **THEN** the existing on-screen miniapp controls continue to work through `MessageInBus`
- **AND** the app reports the MIDI devices as closed rather than failing to start

#### Scenario: Miniapp keeps bus producers isolated
- **WHEN** the miniapp has both on-screen controls and MIDI input enabled
- **THEN** on-screen controls push only to the existing UI message bus
- **AND** MIDI callbacks push only to the MIDI input bus
- **AND** the runtime's audio-thread pump drains both buses into the same parameter manager

#### Scenario: Unassigned slot position leaves space
- **WHEN** a visible slot position has no assigned parameter
- **THEN** the miniapp leaves that encoder position visually empty
- **AND** does not draw the encoder controller body for that position

#### Scenario: Miniapp shuts MIDI down cleanly
- **WHEN** the miniapp closes or the user disables MIDI output
- **THEN** the MIDI sender stops and joins its worker thread
- **AND** open JUCE MIDI input and output devices are closed
