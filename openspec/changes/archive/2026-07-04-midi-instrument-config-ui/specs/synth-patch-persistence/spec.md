# synth-patch-persistence Delta

Project: `projects/synth`. ID prefix: `spp`.

## MODIFIED Requirements

### Requirement: spp-2 — Patch document format
WHEN a synth patch is saved, THE synth patch persistence system SHALL write a JSON object containing a synth patch schema identifier, schema version, patch name, recursive parameter values keyed by initialized parameter name, the MIDI instrument configuration (the ordered, uniquely named controller slots of smi-2, replacing the former single `midiProfile` section and separate endpoint state), and the audio device selection state, while excluding parameter definitions and synth topology from persisted JSON; a patch document without a `midiInstrument` section SHALL fail validation (an instrument section with zero controllers is valid).

#### Scenario: Patch root has required sections
- **WHEN** a patch is serialized
- **THEN** the JSON root contains `schema`, `schemaVersion`, `patchName`, `parameterValues`, and `midiInstrument`
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

#### Scenario: Missing instrument section rejects load
- **WHEN** a patch document without a `midiInstrument` section (including any pre-instrument legacy document) is loaded
- **THEN** the load fails validation and current state is unchanged

#### Scenario: Empty instrument is valid
- **WHEN** a patch document contains a `midiInstrument` section with zero controllers
- **THEN** the load succeeds and the instrument configuration becomes empty

### Requirement: spp-4 — Patch save and load APIs
WHEN application code requests synth patch save or load without a UI, THE synth patch persistence system SHALL expose JUCE-free library APIs to serialize initialized parameter values and the MIDI instrument configuration to JSON, parse patch JSON with a caller-owned arena, and apply only matching named parameter values to an already initialized parameter manager.

#### Scenario: Programmatic save returns JSON
- **WHEN** tests, reusable synth callers, or miniapp code request a patch save for an initialized synth instance
- **THEN** the persistence API returns or writes a JSON patch document without requiring a visible UI

#### Scenario: Programmatic load tolerates app changes
- **WHEN** patch JSON contains a parameter name that no longer exists in the initialized application
- **THEN** load ignores that saved parameter value
- **AND** continues loading values for other matching parameter names

#### Scenario: Missing saved value keeps default
- **WHEN** an initialized parameter has no saved value in patch JSON
- **THEN** that parameter keeps the value established by initialization

### Requirement: spp-5 — Miniapp consumes library persistence
WHEN the synth miniapp uses persistence, THE synth patch persistence system SHALL let the miniapp initialize its modules, parameters, modulation assignments, and MIDI setup through ordinary code first, then save/load parameter values and the MIDI instrument configuration through library persistence APIs without requiring a new UI surface.

#### Scenario: Code-defined miniapp can be saved and reloaded
- **WHEN** the miniapp default VCO code-defined initialization is run, edited, saved to JSON, initialized fresh, and loaded from that JSON
- **THEN** matching parameter names receive the saved parameter values
- **AND** MIDI input and output setup can be reconstructed from the saved MIDI instrument configuration

#### Scenario: Missing saved patch uses defaults
- **WHEN** the miniapp starts and no patch file exists
- **THEN** it initializes the default parameter values and MIDI selections without reporting a persistence failure

### Requirement: spp-7 — Patch message input/output buses
WHEN patch lifecycle operations interact with initialized synth state, THE synth patch persistence system SHALL provide patch-specific input messages for `LoadFromJSON`, `RevertAllToDefault`, and `SerializeToJSON`, and `MessageOut`/`MessageOutBus` types that can carry serialized JSON responses back to the patch manager.

#### Scenario: Load-from-JSON message carries a deserialized root
- **WHEN** a patch JSON version has been read and parsed successfully
- **THEN** the patch manager dispatches a `LoadFromJSON` message containing the already-deserialized JSON root
- **AND** the message retains ownership of the JSON arena until the message is consumed

#### Scenario: Serialize request produces JSON response
- **WHEN** initialized synth state receives a `SerializeToJSON` patch message
- **THEN** it serializes current parameter values and the MIDI instrument configuration (including per-controller endpoint identifiers) to a patch JSON object
- **AND** posts a `MessageOut` response containing the JSON object and the serialize request's monotonic `requestId`
- **AND** the response retains ownership of the JSON arena until the patch manager consumes it

#### Scenario: Patch buses are command queues
- **WHEN** patch input or output messages are queued
- **THEN** consumers drain them explicitly in control/app code
- **AND** the patch queues do not gate messages by musical timestamp

#### Scenario: Revert message does not alter topology
- **WHEN** initialized synth state receives a `RevertAllToDefault` patch message
- **THEN** it restores initialized values and the default instrument configuration
- **AND** it does not create or remove parameters, banks, pages, slots, modulation sources, MIDI mappings, or profile definitions beyond restoring the default instrument

#### Scenario: Library helper applies patch messages
- **WHEN** app code owns a `ParameterManager`, `MidiInstrumentConfig`, and `MessageOutBus`
- **THEN** library code provides a helper to apply `LoadFromJSON`, `RevertAllToDefault`, and `SerializeToJSON` messages to those objects
- **AND** app-specific work after a successful load is limited to side effects such as rebuilding JUCE MIDI processors and reconciling controller connections

### Requirement: spp-8 — Miniapp patch manager integration
WHEN the synth miniapp is run without a patch-picker UI, THE synth application runtime hosting the miniapp SHALL instantiate the library patch manager and patch message buses, consume patch lifecycle messages after the application's ordinary initialization, and use the deterministic temporary patch directory declared by the miniapp's runtime configuration for save-as/load demonstrations.

#### Scenario: Miniapp save-as writes under tmp
- **WHEN** the miniapp requests save-as without a file picker
- **THEN** it uses a deterministic directory under `/tmp` declared as the miniapp's configured patches root
- **AND** the JSON version file is written by library patch manager/file helpers

#### Scenario: Miniapp load/revert route through patch messages
- **WHEN** the miniapp loads or reverts a patch
- **THEN** patch JSON load is delivered through `LoadFromJSON` or `RevertAllToDefault` patch messages
- **AND** the runtime rebuilds MIDI processors from the loaded MIDI instrument configuration and reconciles controller connections after consuming a load message
