## ADDED Requirements

### Requirement: spm-75 — Message input: grid command model and routing
WHEN external UI or MIDI code sends grid commands, THE synth message system SHALL represent grid press, grid release, grid pressure-change, and grid-select as timestamped `MessageIn` variants; SHALL carry a grid-slot index and signed x/y on cell events, an unsigned MIDI-range velocity on press and pressure-change, and a grid-slot index plus grid index on selection; and SHALL let one `MessageInBus` route parameter messages only to its attached `ParameterManager` and grid messages only to its attached `GridManager` while preserving the existing bounded SPSC timestamp and FIFO contract.

#### Scenario: Grid messages preserve signed coordinates and velocity
- **WHEN** grid-slot `1` receives press `(-1,7,100)`, pressure-change `(-1,7,64)`, and release `(-1,7)` messages
- **THEN** JSON and in-memory round trips preserve slot `1`, x `-1`, y `7`, and both velocity bytes exactly

#### Scenario: Grid selection carries a distinct grid index
- **WHEN** a grid-select message targets grid slot `2` and grid `5`
- **THEN** bus processing requests grid `5` in grid slot `2`
- **AND** no parameter bank selection occurs even if parameter bank or slot `2` or `5` exists

#### Scenario: Mixed messages retain FIFO order
- **WHEN** one bus contains timestamp-visible parameter and grid messages in an interleaved order
- **THEN** it applies each message to the appropriate attached manager in insertion order

#### Scenario: Invalid external grid target is ignored
- **WHEN** a grid message targets a missing manager, slot, grid, or coordinate
- **THEN** bus processing does not throw or mutate either manager

### Requirement: spm-76 — MIDI input: polyphonic pressure mappings
WHEN a MIDI controller profile configures polyphonic pressure, THE synth MIDI system SHALL provide an input mapping from controller channel/note addresses to grid pressure-change messages, SHALL recognize MIDI status `0xA0`, SHALL stamp the shared runtime timestamp and incoming pressure byte into the mapped message, SHALL push matched messages to the shared `MessageInBus`, and SHALL pass unmatched messages to thru exactly once.

#### Scenario: Mapped aftertouch becomes grid pressure
- **WHEN** channel `3` note `42` is mapped to grid slot `1` coordinate `(-1,7)`
- **AND** the processor receives polyphonic aftertouch value `88` at that address
- **THEN** it pushes one `GridPressureChange` for slot `1`, `(-1,7)`, velocity `88` with the runtime timestamp

#### Scenario: Unmapped aftertouch passes through
- **WHEN** a polyphonic-aftertouch message does not match any configured address
- **AND** a thru processor is configured
- **THEN** the processor pushes no grid message
- **AND** passes the original MIDI message to thru exactly once

#### Scenario: Other MIDI statuses are not consumed
- **WHEN** the pressure processor receives note-on, note-off, CC, channel pressure, pitch bend, or realtime MIDI
- **THEN** it pushes no pressure message
- **AND** passes the original MIDI message to thru when thru is configured

#### Scenario: Profile factory chains pressure input
- **WHEN** a controller profile contains encoder, analog, system-button, and polyphonic-pressure input configuration
- **THEN** the profile factory creates one thru chain containing all configured processors with the same message bus and timestamp provider

### Requirement: spm-77 — MIDI profiles: grid mapping persistence and canonical pairing
WHEN controller profiles persist grid mappings, THE synth MIDI system SHALL store grid press/release/feedback as ordinary system-message associations and their polyphonic-pressure behavior as separate pressure-input entries, SHALL serialize and parse every new grid message field and pressure mapping, SHALL accept the previous profile schema with pressure configuration absent, SHALL emit the new profile schema on save, and SHALL provide deterministic normalization keys that preserve canonical semantic round trips including signed coordinates.

#### Scenario: Old profile loads without pressure mappings
- **WHEN** a valid previous-version controller profile has no pressure-input field
- **THEN** the new reader loads it with an empty pressure mapping list
- **AND** preserves its encoder, analog, system-message, and output configuration

#### Scenario: New profile round-trips grid mapping
- **WHEN** a profile contains paired grid press/release/feedback and pressure entries at a negative coordinate
- **THEN** serialize then parse preserves the physical address, grid slot, signed x/y, output-feedback flag, and pressure target

#### Scenario: Normalization is deterministic
- **WHEN** semantically identical grid and pressure mappings are authored in different array orders
- **THEN** normalization produces the same order by logical grid target and physical address

#### Scenario: Instrument schema delegates nested profile version
- **WHEN** an instrument contains a controller using the new profile schema
- **THEN** the instrument and runtime-configuration envelopes parse it through the nested profile reader without changing patch persistence

### Requirement: spm-78 — MIDI output: grid feedback from global UI state
WHEN a system-message output association uses a grid feedback message, THE synth MIDI output system SHALL resolve the addressed cell from the runtime's global UI snapshot without reading the live grid tree, SHALL return the cell RGB plus `isOn=true` when its packed final byte is nonzero and `isOn=false` otherwise, SHALL return off/false for missing or disconnected targets, and SHALL feed that state through the existing controller-specific output processors without changing their MIDI wire protocols.

#### Scenario: Colored grid feedback uses RGB
- **WHEN** a mapped grid cell publishes packed color `(10,20,30,1)`
- **THEN** Launchpad or WRLD.Bldr system output uses RGB `(10,20,30)` through its existing color protocol
- **AND** output info reports `isOn=true`

#### Scenario: Monochrome grid feedback uses on/off
- **WHEN** a mapped grid cell publishes a nonzero RGB color with final byte `0`
- **THEN** output info reports `isOn=false`
- **AND** an existing monochrome system output path can emit its ordinary off state without inferring on/off from RGB

#### Scenario: Missing grid target is blank
- **WHEN** feedback names an out-of-range grid slot or coordinate
- **THEN** output info returns off color and `isOn=false`
- **AND** no live manager or grid object is read

#### Scenario: Existing output protocols remain stable
- **WHEN** equivalent non-grid parameter, bank, scene, gesture, or modifier feedback is processed before and after this change
- **THEN** the emitted MIDI bytes, caching, reset behavior, and output budgets are unchanged
