## ADDED Requirements

### Requirement: smi-9 — Instrument config: note-addressed button validation

WHEN instrument configuration validates a controller profile, THE synth system SHALL permit CC or note addresses for encoder push mappings and for Generic
controller system-message control mappings, SHALL require encoder turns and
analog mappings to remain CC-addressed, and SHALL reject note addresses in
controller-specific system-message address schemes that do not declare note
support.

#### Scenario: Generic note buttons are valid

- **WHEN** a Generic controller profile contains a note-addressed encoder push and a note-addressed system-message control
- **THEN** instrument configuration validation accepts those mappings

#### Scenario: Note encoder turn is invalid

- **WHEN** a controller profile contains a note-addressed encoder turn mapping
- **THEN** instrument configuration validation rejects the profile

#### Scenario: Controller-specific note system address is invalid

- **WHEN** a WRLD.Bldr or MF Twister profile contains a note-addressed system-message control
- **THEN** instrument configuration validation rejects the profile

#### Scenario: Existing CC profiles remain valid

- **WHEN** an existing controller profile contains only CC addresses
- **THEN** instrument configuration validation preserves its prior validity
