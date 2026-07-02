# synth-patch-persistence Delta

## MODIFIED Requirements

### Requirement: spp-2 — Patch document format
WHEN a synth patch is saved, THE synth patch persistence system SHALL write a JSON object containing a synth patch schema identifier, schema version, patch name, recursive parameter values keyed by initialized parameter name, the MIDI configuration profile, and the audio device selection state, while excluding parameter definitions and synth topology from persisted JSON.

#### Scenario: Patch root has required sections
- **WHEN** a patch is serialized
- **THEN** the JSON root contains `schema`, `schemaVersion`, `patchName`, `parameterValues`, and `midiProfile`
- **AND** contains the audio device selection when one is set

#### Scenario: Patch root scopes to one initialized manager
- **WHEN** a patch document stores `parameterValues`
- **THEN** those values apply to exactly one initialized `ParameterManager`
- **AND** top-level parameter names are interpreted only within that manager's existing parameter-name uniqueness contract

#### Scenario: Definitions are not persisted
- **WHEN** the patch stores `parameterValues`
- **THEN** it stores value state for initialized parameters by name
- **AND** it does not store groups, pages, banks, slots, modules, parameter names, colors, ranges, polarity, modulation-source metadata, or modulation assignments

#### Scenario: Audio device state loads tolerantly
- **WHEN** a patch without an audio device section is loaded
- **THEN** the load succeeds and the current audio device state is unchanged

### Requirement: spp-8 — Miniapp patch manager integration
WHEN the synth miniapp is run without a patch-picker UI, THE synth application runtime hosting the miniapp SHALL instantiate the library patch manager and patch message buses, consume patch lifecycle messages after the application's ordinary initialization, and use the deterministic temporary patch directory declared by the miniapp's runtime configuration for save-as/load demonstrations.

#### Scenario: Miniapp save-as writes under tmp
- **WHEN** the miniapp requests save-as without a file picker
- **THEN** it uses a deterministic directory under `/tmp` declared as the miniapp's configured patches root
- **AND** the JSON version file is written by library patch manager/file helpers

#### Scenario: Miniapp load/revert route through patch messages
- **WHEN** the miniapp loads or reverts a patch
- **THEN** patch JSON load is delivered through `LoadFromJSON` or `RevertAllToDefault` patch messages
- **AND** the runtime rebuilds MIDI processors from the loaded MIDI profile config after consuming a load message
