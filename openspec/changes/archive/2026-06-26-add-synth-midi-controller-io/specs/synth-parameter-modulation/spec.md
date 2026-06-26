## ADDED Requirements

### Requirement: spm-29 — MIDI: Basic message model
WHEN synth MIDI code exchanges raw MIDI messages, THE synth parameter modulation system SHALL provide a JUCE-free `BasicMidi` value type with timestamp, raw MIDI bytes, message size, status/channel/data accessors, CC/note/realtime constructors, and no route field.

#### Scenario: CC message exposes status and data
- **WHEN** a CC message is created for timestamp `10`, channel `2`, CC `7`, and value `99`
- **THEN** `BasicMidi` reports timestamp `10`
- **AND** reports status `0xB0`
- **AND** reports channel `2`
- **AND** reports CC `7`
- **AND** reports value `99`
- **AND** reports size `3`

#### Scenario: Realtime messages are one byte
- **WHEN** a supported realtime status such as MIDI clock is created
- **THEN** `BasicMidi` reports the realtime status byte
- **AND** reports size `1`
- **AND** does not require route metadata

### Requirement: spm-30 — MIDI input: chainable processor contract
WHEN MIDI input is converted into synth external-control messages, THE synth parameter modulation system SHALL provide an abstract `MidiInProcessor` that is not called on the audio thread, owns or references a `MessageInBus*`, exposes `Process(BasicMidi)`, supports a configurable bus-domain timestamp provider for created `MessageIn` values, and supports an optional thru processor that implementations use for supported-but-unused messages.

#### Scenario: Processor pushes to message bus
- **WHEN** a concrete MIDI input processor converts a `BasicMidi` message to a `MessageIn`
- **THEN** it pushes the created message to the configured `MessageInBus`
- **AND** stamps the created message with the configured bus-domain timestamp rather than raw JUCE or wall-clock MIDI time

#### Scenario: Immediate timestamp drains next process
- **WHEN** a MIDI input processor's timestamp provider returns `0`
- **AND** it converts a MIDI message to a `MessageIn`
- **THEN** the created message is visible to the next `MessageInBus::Process` call without waiting for a wall-clock timestamp

#### Scenario: Unused message passes to thru
- **WHEN** a MIDI input processor receives a valid MIDI message that it does not consume
- **AND** a thru processor is configured
- **THEN** it passes the original `BasicMidi` to the thru processor exactly once

#### Scenario: Unused message without thru is ignored
- **WHEN** a MIDI input processor receives a message it does not consume
- **AND** no thru processor is configured
- **THEN** the message is dropped without mutating `MessageInBus`

### Requirement: spm-31 — MIDI input: encoder mapping
WHEN encoder MIDI input is processed, THE synth parameter modulation system SHALL map configured turn and pushbutton channel/CC pairs to `MessageIn` commands addressed by `(slotIx, position)`, scale decoded turn ticks by a configured normalized `turnStep`, and allow one controller to map multiple slots or leave some physical controls unmapped.

#### Scenario: Turn CC maps to parameter inc/dec
- **WHEN** an encoder input config maps channel `0` CC `5` to slot `1` position `2`
- **AND** the processor receives a CC on channel `0` CC `5` with value `65`
- **THEN** it pushes `MessageIn::ParamIncDec` for slot `1` position `2`

#### Scenario: Signed relative mode uses value minus 64
- **WHEN** a mapped turn CC is configured for signed-7-bit relative mode
- **AND** the turn step is `0.01`
- **AND** the processor receives values `63` and `66`
- **THEN** it sends normalized deltas `-0.01` and `0.02` respectively

#### Scenario: Direction-only mode ignores magnitude
- **WHEN** a mapped turn CC is configured for direction-only relative mode
- **AND** the turn step is `0.01`
- **AND** the processor receives values `1`, `64`, and `127`
- **THEN** it sends normalized deltas `-0.01`, no message, and `0.01` respectively

#### Scenario: Default turn step is small
- **WHEN** an encoder input config is created without an explicit turn step
- **THEN** it uses a default turn step of `1 / 128`

#### Scenario: Pushbutton nonzero value maps to push
- **WHEN** an encoder input config maps pushbutton channel `1` CC `5` to slot `1` position `2`
- **AND** the processor receives a CC on channel `1` CC `5` with value `127`
- **THEN** it pushes `MessageIn::ParamPush` for slot `1` position `2`

#### Scenario: Pushbutton zero value is not consumed as a parameter command
- **WHEN** an encoder input config maps pushbutton channel `1` CC `5`
- **AND** the processor receives a CC on channel `1` CC `5` with value `0`
- **THEN** it does not push a parameter command

### Requirement: spm-32 — MIDI input: controller presets
WHEN synth code requests built-in encoder MIDI configs, THE synth parameter modulation system SHALL provide `TwisterDefault` and `WrldBldrDefault` presets with Smart Grid-compatible encoder defaults: turn channel `0`, pushbutton channel `1`, CCs `0..15`, row-major 4x4 positions, and signed-7-bit relative turn mode.

#### Scenario: Twister default maps first 4x4 grid
- **WHEN** the Twister default config is created for slot `0`
- **THEN** turn channel `0` CC `0` maps to slot `0` position `0`
- **AND** turn channel `0` CC `15` maps to slot `0` position `15`
- **AND** pushbutton channel `1` CC `0` maps to slot `0` position `0`
- **AND** pushbutton channel `1` CC `15` maps to slot `0` position `15`

#### Scenario: WrldBldr default matches Smart Grid encoder rows
- **WHEN** the Wrld.Bldr default config is created for slot `0`
- **THEN** encoder turn input uses channel `0`
- **AND** encoder pushbutton input uses channel `1`
- **AND** CCs `0..15` map to slot positions `0..15` in row-major order
- **AND** the mapping is verified against Smart Grid's Wrld.Bldr MIDI input adapter before implementation completion

#### Scenario: Default config can be trimmed for incomplete slots
- **WHEN** a caller builds a preset for a slot with fewer than 16 exposed positions
- **THEN** the caller can remove unmapped CC entries without changing the meaning of remaining channel/CC mappings

### Requirement: spm-33 — MIDI JUCE: input handler
WHEN the JUCE synth layer connects MIDI input devices, THE system SHALL provide a `MidiInHandler` that owns a `MidiInProcessor`, registers as a JUCE MIDI input callback, opens and closes devices by identifier, reports device/open state, and converts supported JUCE MIDI messages to `synth::BasicMidi` while preserving the source MIDI timestamp only in `BasicMidi`.

#### Scenario: Three-byte JUCE MIDI is forwarded
- **WHEN** the handler receives a 3-byte JUCE MIDI message from an open device
- **THEN** it converts the raw bytes and timestamp to `BasicMidi`
- **AND** calls the owned processor's `Process`

#### Scenario: Realtime JUCE MIDI is forwarded
- **WHEN** the handler receives a supported one-byte realtime JUCE MIDI message
- **THEN** it converts the status and timestamp to `BasicMidi`
- **AND** calls the owned processor's `Process`

#### Scenario: Open failure is observable
- **WHEN** opening a JUCE MIDI input device fails
- **THEN** the handler reports that it is not open
- **AND** keeps the owned processor available for a later successful open

### Requirement: spm-34 — MIDI output: sender and processor contract
WHEN synth code mirrors parameter UI state to MIDI hardware, THE synth parameter modulation system SHALL provide a sender queue and a `MidiOutProcessor` abstraction whose implementations read `ParameterManager::UIState` using the `Parameter::UIState::revision` snapshot protocol, debounce changed mapped encoder cells, and enqueue outgoing `BasicMidi` to a MIDI sender from message-thread or UI refresh code.

#### Scenario: Sender drains queued MIDI to sink
- **WHEN** a `BasicMidi` message is enqueued to a MIDI sender with an output sink
- **THEN** the sender thread eventually delivers the same message to the sink in FIFO order
- **AND** MIDI device I/O is not performed by the caller that enqueued the message

#### Scenario: Processor uses stable UI snapshots
- **WHEN** a MIDI output processor reads a mapped cell whose UI-state revision is odd or changes during the read
- **THEN** it retries the cell snapshot before comparing or emitting MIDI feedback

#### Scenario: Unstable UI snapshot skips cell
- **WHEN** a MIDI output processor cannot obtain a stable mapped-cell UI snapshot after its bounded retry count
- **THEN** it emits no MIDI feedback for that cell during the current process call
- **AND** it does not update that cell's debounce cache

#### Scenario: Output processor skips unchanged state
- **WHEN** a MIDI output processor processes a UI-state snapshot twice without relevant mapped-cell changes
- **THEN** the second process call emits no duplicate encoder feedback messages

#### Scenario: Output reset re-renders state
- **WHEN** a MIDI output processor is reset after previously sending feedback
- **AND** it processes the same connected UI-state snapshot again
- **THEN** it emits the feedback required to restore hardware state

#### Scenario: Unmapped and disconnected cells are silent
- **WHEN** a UI-state cell is not included in the output mapping
- **OR** the mapped UI-state cell is disconnected
- **THEN** the MIDI output processor does not emit value or color feedback for that cell

### Requirement: spm-35 — MIDI output: Twister encoder feedback
WHEN Twister encoder MIDI output is processed, THE synth parameter modulation system SHALL provide a Twister output processor that maps configured slot positions to controller CCs and emits separate CC feedback for encoder value, parameter color, and connected brightness using the Smart Grid Twister channel conventions.

#### Scenario: Twister value feedback uses channel 0
- **WHEN** a mapped connected cell has voice-0 normalized value `0.5`
- **THEN** the Twister output processor emits a channel `0` CC for that cell with a value near `64`

#### Scenario: Twister color feedback uses channel 1
- **WHEN** a mapped connected cell's parameter-level color changes
- **THEN** the Twister output processor emits a channel `1` CC for that cell using the Twister color code derived from synth color

#### Scenario: Twister brightness feedback uses channel 2
- **WHEN** a mapped cell becomes connected
- **THEN** the Twister output processor emits a channel `2` CC for that cell using the Smart Grid full-brightness animation value

### Requirement: spm-36 — MIDI output: Wrld.Bldr encoder feedback
WHEN Wrld.Bldr encoder MIDI output is processed, THE synth parameter modulation system SHALL provide a Wrld.Bldr output processor that maps configured slot positions to controller CCs, emits voice-0 encoder value feedback as CC messages, emits parameter-level button color and voice-0 indicator color through Yaeltex-compatible SysEx color packets, and verifies those packet bytes against Smart Grid source-derived golden data.

#### Scenario: WrldBldr value feedback uses encoder CC channel
- **WHEN** a mapped connected cell has voice-0 normalized value `0.25`
- **THEN** the Wrld.Bldr output processor emits an encoder value CC for that cell with a value near `32`

#### Scenario: WrldBldr encoder colors use SysEx packets
- **WHEN** a mapped connected cell's parameter-level button color or voice-0 indicator color changes
- **THEN** the Wrld.Bldr output processor emits a Yaeltex-compatible SysEx color packet for that cell

#### Scenario: WrldBldr output applies cooldown budget
- **WHEN** many mapped cell colors change at once
- **THEN** the Wrld.Bldr output processor respects its per-process output budget and cooldown state
- **AND** continues emitting remaining changed cells on later process calls

### Requirement: spm-37 — Miniapp: MIDI controller configuration
WHEN the synth miniapp runs with the MIDI controller change, THE miniapp SHALL expose a simple configuration page that lets the user choose a controller preset, choose MIDI input and output devices, open or close those devices, register the real synth MIDI processors against a MIDI-specific `MessageInBus` and `ParameterManager::UIState`, and shut down MIDI sender/device resources cleanly.

#### Scenario: Miniapp preset controls visible encoders
- **WHEN** the user selects the Twister or Wrld.Bldr preset and opens a matching MIDI input device
- **AND** the hardware sends a mapped encoder turn CC for a visible miniapp slot position
- **THEN** the miniapp processes a scaled `ParamIncDec` through the MIDI input bus on the next timer tick
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
- **AND** the timer drains both buses into the same parameter manager

#### Scenario: Miniapp shuts MIDI down cleanly
- **WHEN** the miniapp closes or the user disables MIDI output
- **THEN** the MIDI sender stops and joins its worker thread
- **AND** open JUCE MIDI input and output devices are closed
