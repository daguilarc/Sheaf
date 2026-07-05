# synth-patch-persistence Delta

Project: `projects/synth`. ID prefix: `spp`.

## MODIFIED Requirements

### Requirement: spp-2 — Patch document format
WHEN a synth patch is saved, THE synth patch persistence system SHALL write a JSON object containing a synth patch schema identifier, schema version, patch name, and recursive parameter values keyed by initialized parameter name, while excluding MIDI instrument/controller configuration, audio device selection state, parameter definitions, and synth topology from persisted patch JSON; if legacy patch JSON contains MIDI or audio configuration sections, patch validation SHALL tolerate those extra sections without applying them as patch state.

#### Scenario: Patch root has required sections
- **WHEN** a patch is serialized
- **THEN** the JSON root contains `schema`, `schemaVersion`, `patchName`, and `parameterValues`
- **AND** does not contain `midiInstrument` or `audioDevice`

#### Scenario: Patch root scopes to one initialized manager
- **WHEN** a patch document stores `parameterValues`
- **THEN** those values apply to exactly one initialized `ParameterManager`
- **AND** top-level parameter names are interpreted only within that manager's existing parameter-name uniqueness contract

#### Scenario: Definitions are not persisted
- **WHEN** the patch stores `parameterValues`
- **THEN** it stores value state for initialized parameters by name
- **AND** it does not store groups, pages, banks, slots, modules, parameter names, colors, ranges, polarity, modulation-source metadata, or modulation assignments

#### Scenario: Legacy configuration sections are ignored
- **WHEN** a patch document contains legacy `midiInstrument` or `audioDevice` sections
- **THEN** patch validation succeeds if the patch schema and parameter values are otherwise valid
- **AND** loading the patch leaves current MIDI instrument configuration and audio device state unchanged

### Requirement: spp-4 — Patch save and load APIs
WHEN application code requests synth patch save or load without a UI, THE synth patch persistence system SHALL expose JUCE-free library APIs to serialize initialized parameter values to JSON, parse patch JSON with a caller-owned arena, and apply only matching named parameter values to an already initialized parameter manager.

#### Scenario: Programmatic save returns JSON
- **WHEN** tests, reusable synth callers, or miniapp code request a patch save for an initialized synth instance
- **THEN** the persistence API returns or writes a JSON patch document without requiring a visible UI
- **AND** the patch document excludes MIDI instrument/controller configuration and audio device selection

#### Scenario: Programmatic load tolerates app changes
- **WHEN** patch JSON contains a parameter name that no longer exists in the initialized application
- **THEN** load ignores that saved parameter value
- **AND** continues loading values for other matching parameter names

#### Scenario: Missing saved value keeps default
- **WHEN** an initialized parameter has no saved value in patch JSON
- **THEN** that parameter keeps the value established by initialization

### Requirement: spp-5 — Miniapp consumes library persistence
WHEN the synth miniapp uses persistence, THE synth patch persistence system SHALL let the miniapp initialize its modules, parameters, modulation assignments, and MIDI setup through ordinary code first, then save/load parameter values through library patch persistence APIs without requiring a new UI surface; MIDI and audio setup SHALL be saved and loaded through the separate runtime configuration document.

#### Scenario: Code-defined miniapp patch can be saved and reloaded
- **WHEN** the miniapp default VCO code-defined initialization is run, edited, saved to patch JSON, initialized fresh, and loaded from that JSON
- **THEN** matching parameter names receive the saved parameter values
- **AND** MIDI input/output setup and audio device setup are not changed by loading the patch

#### Scenario: Missing saved patch uses defaults
- **WHEN** the miniapp starts and no patch file exists
- **THEN** it initializes the default parameter values without reporting a patch persistence failure

### Requirement: spp-7 — Patch message input/output buses
WHEN patch lifecycle operations interact with initialized synth state, THE synth patch persistence system SHALL provide patch-specific input messages for `LoadFromJSON`, `RevertAllToDefault`, and `SerializeToJSON`, and `MessageOut`/`MessageOutBus` types that can carry serialized JSON responses back to the patch manager.

#### Scenario: Load-from-JSON message carries a deserialized root
- **WHEN** a patch JSON version has been read and parsed successfully
- **THEN** the patch manager dispatches a `LoadFromJSON` message containing the already-deserialized JSON root
- **AND** the message retains ownership of the JSON arena until the message is consumed

#### Scenario: Serialize request produces JSON response
- **WHEN** initialized synth state receives a `SerializeToJSON` patch message
- **THEN** it serializes current parameter values to a patch JSON object
- **AND** posts a `MessageOut` response containing the JSON object and the serialize request's monotonic `requestId`
- **AND** the response retains ownership of the JSON arena until the patch manager consumes it

#### Scenario: Patch buses are command queues
- **WHEN** patch input or output messages are queued
- **THEN** consumers drain them explicitly in control/app code
- **AND** the patch queues do not gate messages by musical timestamp

#### Scenario: Revert message does not alter topology or runtime configuration
- **WHEN** initialized synth state receives a `RevertAllToDefault` patch message
- **THEN** it restores initialized parameter values to defaults
- **AND** it does not create or remove parameters, banks, pages, slots, modulation sources, MIDI mappings, profile definitions, MIDI instrument configuration, or audio device selection

#### Scenario: Library helper applies patch messages
- **WHEN** app code owns a `ParameterManager` and `MessageOutBus`
- **THEN** library code provides a helper to apply `LoadFromJSON`, `RevertAllToDefault`, and `SerializeToJSON` messages to those objects
- **AND** app-specific work after a successful load is limited to side effects caused by parameter changes

### Requirement: spp-8 — Miniapp patch manager integration
WHEN the synth miniapp is hosted by the synth application runtime, THE runtime SHALL instantiate the library patch manager and patch message buses, consume patch lifecycle messages after the application's ordinary initialization, and use the runtime-owned persistent patches directory for save-as/load operations.

#### Scenario: Miniapp save-as writes under runtime patches root
- **WHEN** the miniapp requests save-as through the runtime File page
- **THEN** it creates or selects a patch directory under the runtime-owned `patches/` directory
- **AND** the JSON version file is written by library patch manager/file helpers

#### Scenario: Miniapp load/revert route through patch messages
- **WHEN** the miniapp loads or reverts a patch
- **THEN** patch JSON load is delivered through `LoadFromJSON` or `RevertAllToDefault` patch messages
- **AND** MIDI instrument configuration and audio device selection are left unchanged by the patch message

## ADDED Requirements

### Requirement: spp-9 — Runtime configuration document
WHEN synth runtime configuration is saved, THE synth persistence system SHALL provide JUCE-free helpers that write a JSON object containing a runtime configuration schema identifier, schema version, MIDI instrument/controller configuration, and audio device selection state to an explicit configuration file path, and SHALL load that document into scratch state before mutating the caller's live configuration.

#### Scenario: Runtime configuration root has required sections
- **WHEN** runtime configuration is serialized
- **THEN** the JSON root contains `schema`, `schemaVersion`, `midiInstrument`, and `audioDevice`
- **AND** it does not contain patch parameter values or patch identity

#### Scenario: Invalid configuration leaves live state unchanged
- **WHEN** a runtime configuration document is missing required sections, has an unsupported schema, contains invalid MIDI instrument JSON, or contains invalid audio device JSON
- **THEN** loading fails
- **AND** the caller's live MIDI instrument and audio device state are unchanged

#### Scenario: Configuration save is atomic
- **WHEN** runtime configuration is saved to disk
- **THEN** the helper writes through a temporary file and renames it into place
- **AND** a failed write leaves the previous configuration file intact when one existed
