## ADDED Requirements

### Requirement: spm-80 — MIDI input: note-addressed controller buttons

WHEN a controller profile configures an encoder push or Generic system-message control address, THE synth parameter modulation system SHALL allow the address
to select CC or note while retaining numeric channel and message-number fields,
SHALL match the configured message type as part of the address, SHALL classify
CC nonzero and note-on positive velocity as press, and SHALL classify CC zero,
note-on zero velocity, and note-off as release.

#### Scenario: Note encoder push emits parameter push

- **WHEN** an encoder push maps note `60` on channel `1` to slot `2` position `3`
- **AND** the input processor receives note-on for channel `1`, note `60`, and positive velocity
- **THEN** it pushes `MessageIn::ParamPush` for slot `2` position `3`

#### Scenario: Note encoder release does not emit another push

- **WHEN** an encoder push maps note `60` on channel `1`
- **AND** the input processor receives raw note-on with zero velocity or note-off with nonzero release velocity for that address
- **THEN** it does not push a parameter command

#### Scenario: Generic note system message emits press and release

- **WHEN** a Generic system-message association maps note `42` on channel `4` to configured press and release messages
- **AND** the processor receives note-on with positive velocity followed by note-off for that address
- **THEN** it emits the configured press message followed by the configured release message

#### Scenario: Zero-velocity note-on is release

- **WHEN** a Generic note system-message association has a configured release message
- **AND** the processor receives note-on with velocity `0` for the mapped channel and note number
- **THEN** it emits the configured release message

#### Scenario: Note system message emits no CC feedback

- **WHEN** a Generic system-message association uses a note control address and has output feedback enabled
- **AND** profile output processors are built and process its derived state
- **THEN** no CC or note feedback message is emitted for that association

#### Scenario: Message type participates in matching

- **WHEN** a profile maps a note address and receives a CC with the same channel and numeric value
- **THEN** that mapping does not consume the CC as its press or release

#### Scenario: Typed addresses round trip

- **WHEN** a profile containing note-addressed encoder pushes and Generic system messages is serialized and loaded
- **THEN** the loaded mappings preserve note message type, channel, and numeric value

#### Scenario: Existing addresses default to CC

- **WHEN** profile JSON contains an existing control address without a message type
- **THEN** loading treats that address as CC and preserves its existing behavior
