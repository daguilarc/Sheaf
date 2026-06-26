## MODIFIED Requirements

### Requirement: spm-5 — Modulators: flat per-voice values and metadata
WHEN a group owns modulators, THE `Modulators` struct SHALL store current modulator values in one flat row-major array indexed as `voiceIx * numModulators + modulatorIx`, store per-modulator metadata including name, short name, color, and connected flag, and provide an `Apply(voiceIx, depths)` function that returns only the dot product of that voice's modulator row and the supplied depth row.

#### Scenario: Metadata is not per voice
- **WHEN** a modulator name, short name, or color is changed
- **THEN** the changed metadata applies to that modulator for every voice

### Requirement: spm-15 — Banks and slots: press, shift-press, and tick routing
WHEN a bank handles a press on a mapped physical encoder, THE bank SHALL populate the pressed parameter's visible modulation-depth cells from its modulation-depth parameter array, SHALL materialize missing modulation-depth parameters as bipolar default-zero parameters when group capacity allows, SHALL initialize lazily materialized modulation-depth parameter name, short name, and color from the corresponding modulator metadata, and SHALL place the selected top-level parameter in the final visible cell as the return cell. Pressing a modulation cell SHALL open that modulation parameter's modulation view; pressing the return cell SHALL restore the top-level bank; shift-press SHALL revert the pressed parameter to default; and routed manager/slot APIs SHALL dispatch press, shift-press, and tick/inc-dec events by physical encoder ID to the selected bank.

#### Scenario: Lazy depth metadata follows modulator
- **WHEN** opening a modulation view materializes a missing depth parameter for modulator `0`
- **AND** modulator `0` has name `Filter Env`, short name `Env`, and color `Cyan`
- **THEN** the created depth parameter has name `Filter Env`
- **AND** has short name `Env`
- **AND** has color `Cyan`

### Requirement: spm-34 — MIDI output: sender and processor contract
WHEN synth code mirrors parameter UI state to MIDI hardware, THE synth parameter modulation system SHALL provide a sender queue and a `MidiOutProcessor` abstraction whose implementations read `ParameterManager::UIState` using the `Parameter::UIState::revision` snapshot protocol, debounce changed mapped encoder cells, enqueue outgoing `BasicMidi` to a MIDI sender from message-thread or UI refresh code, and actively blank mapped disconnected cells by emitting zero value, off color, and zero brightness feedback as appropriate for the selected controller.

#### Scenario: Disconnected mapped cell blanks hardware
- **WHEN** a mapped UI-state cell is disconnected
- **THEN** the MIDI output processor emits the controller-specific blank feedback for that cell on the next output process call
- **AND** repeated process calls without state changes emit no duplicate blank feedback

### Requirement: spm-37 — Miniapp: MIDI controller configuration
WHEN the synth miniapp runs with the MIDI controller change, THE miniapp SHALL expose a simple configuration page that lets the user choose a controller preset, choose MIDI input and output devices, open or close those devices, register the real synth MIDI processors against a MIDI-specific `MessageInBus` and `ParameterManager::UIState`, shut down MIDI sender/device resources cleanly, and render disconnected slot positions as empty space rather than inactive controller chrome.

#### Scenario: Unassigned slot position leaves space
- **WHEN** a visible slot position has no assigned parameter
- **THEN** the miniapp leaves that encoder position visually empty
- **AND** does not draw the encoder controller body for that position
