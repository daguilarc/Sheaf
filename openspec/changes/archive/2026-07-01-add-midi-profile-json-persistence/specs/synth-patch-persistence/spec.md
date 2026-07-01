## ADDED Requirements

### Requirement: spp-1 — JSON: arena-backed tree
WHEN synth patch persistence needs JSON parsing or serialization, THE synth patch persistence system SHALL provide a JUCE-free arena-backed JSON library whose nodes, object members, array entries, object keys, and string values allocate only from a caller-owned `JsonArena`, whose build and read operations are null-tolerant after arena exhaustion, and whose parser and serializer round-trip standard patch JSON text.

#### Scenario: Arena builds object tree
- **WHEN** code builds an object with strings, integers, reals, booleans, arrays, and nested objects through `JsonArena`
- **THEN** all JSON nodes and stored strings are allocated from that arena
- **AND** the resulting tree can be serialized to valid JSON text

#### Scenario: Exhaustion is recoverable
- **WHEN** the arena is too small for a JSON build or parse
- **THEN** the arena records failure without crashing
- **AND** callers can grow/reset the arena and retry the same operation

### Requirement: spp-2 — Patch document format
WHEN a synth patch is saved, THE synth patch persistence system SHALL write a JSON object containing a synth patch schema identifier, schema version, patch name, recursive parameter values keyed by initialized parameter name, and the MIDI configuration profile, while excluding parameter definitions and synth topology from persisted JSON.

#### Scenario: Patch root has required sections
- **WHEN** a patch is serialized
- **THEN** the JSON root contains `schema`, `schemaVersion`, `patchName`, `parameterValues`, and `midiProfile`

#### Scenario: Patch root scopes to one initialized manager
- **WHEN** a patch document stores `parameterValues`
- **THEN** those values apply to exactly one initialized `ParameterManager`
- **AND** top-level parameter names are interpreted only within that manager's existing parameter-name uniqueness contract

#### Scenario: Definitions are not persisted
- **WHEN** the patch stores `parameterValues`
- **THEN** it stores value state for initialized parameters by name
- **AND** it does not store groups, pages, banks, slots, modules, parameter names, colors, ranges, polarity, modulation-source metadata, or modulation assignments

### Requirement: spp-3 — Patch file version history
WHEN synth patch persistence saves patch JSON to disk, THE system SHALL store each patch in its own directory under a configurable patches root and SHALL create one new sortable JSON version file per save without overwriting older versions.

#### Scenario: Save creates version file
- **WHEN** patch `BrightLead` is saved twice
- **THEN** both saves are written under `patches/BrightLead/`
- **AND** the second save does not overwrite the first save

#### Scenario: Save explicit patch directory creates version file
- **WHEN** a caller saves JSON text to an explicit patch directory
- **THEN** the persistence system creates one version file directly in that directory
- **AND** does not derive a second directory name from `patchName`

#### Scenario: Latest load uses sortable filename
- **WHEN** a patch directory contains multiple JSON version files
- **THEN** loading the latest patch version selects the alphanumerically greatest version filename

#### Scenario: Explicit version load
- **WHEN** a caller provides an explicit patch version file path under a patch directory
- **THEN** the persistence system loads that file rather than the latest version

### Requirement: spp-4 — Patch save and load APIs
WHEN application code requests synth patch save or load without a UI, THE synth patch persistence system SHALL expose JUCE-free library APIs to serialize initialized parameter values and MIDI configuration profile to JSON, parse patch JSON with a caller-owned arena, and apply only matching named parameter values to an already initialized parameter manager.

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
WHEN the synth miniapp uses persistence, THE synth patch persistence system SHALL let the miniapp initialize its modules, parameters, modulation assignments, and MIDI setup through ordinary code first, then save/load parameter values and MIDI configuration profile through library persistence APIs without requiring a new UI surface.

#### Scenario: Code-defined miniapp can be saved and reloaded
- **WHEN** the miniapp default VCO code-defined initialization is run, edited, saved to JSON, initialized fresh, and loaded from that JSON
- **THEN** matching parameter names receive the saved parameter values
- **AND** MIDI input and output setup can be reconstructed from the saved MIDI configuration profile

#### Scenario: Missing saved patch uses defaults
- **WHEN** the miniapp starts and no patch file exists
- **THEN** it initializes the default parameter values and MIDI selections without reporting a persistence failure

### Requirement: spp-6 — Patch lifecycle manager
WHEN synth patch lifecycle operations are requested, THE synth patch persistence system SHALL provide a JUCE-free library `PatchManager` that tracks the current patch directory as nullable state, orchestrates new/save/save-as/load/revert commands, and delegates state mutation/serialization through patch messages rather than app-specific persistence code.

#### Scenario: Current patch directory is nullable
- **WHEN** no patch has been loaded or saved-as
- **THEN** the patch manager reports no current patch directory
- **AND** save reports that a save-as path is required

#### Scenario: New patch clears current directory after reset
- **WHEN** new patch is requested
- **THEN** the patch manager dispatches a patch message requesting all values revert to defaults
- **AND** clears the current patch directory

#### Scenario: Save writes a new version for current patch
- **WHEN** the patch manager has a current patch directory
- **AND** save is requested
- **THEN** it dispatches a patch message requesting JSON serialization
- **AND** returns a pending status
- **AND** when `ProcessResponses` receives a serialized JSON response with the matching request id, it writes a new JSON version file in that directory without overwriting earlier versions

#### Scenario: Save is busy while serialization is pending
- **WHEN** save or save-as has already dispatched a serialization request that has not completed
- **THEN** another save or save-as request returns busy
- **AND** does not dispatch another serialization request

#### Scenario: Save-as requires a new directory
- **WHEN** save-as is requested with a directory path that does not exist
- **THEN** the patch manager dispatches a serialization request and returns pending
- **AND** when a matching serialized JSON response is received, it creates the directory, writes the first JSON version file there, and records that directory as the current patch
- **WHEN** save-as is requested with a target path that already exists as a file or directory
- **THEN** the patch manager rejects the request without overwriting existing patch history

#### Scenario: Load accepts directory or version path
- **WHEN** load is requested with a patch directory
- **THEN** the patch manager loads the latest sortable JSON version in that directory
- **AND** records that directory as the current patch
- **WHEN** load is requested with an explicit JSON version file
- **THEN** the patch manager loads that file
- **AND** records the containing directory as the current patch

#### Scenario: Load failure preserves current patch
- **WHEN** load is requested with a missing path, empty patch directory, corrupt JSON, unsupported patch schema, or a full patch-message queue
- **THEN** load reports failure
- **AND** the patch manager leaves its current patch directory unchanged

#### Scenario: Revert patch reloads current latest or defaults
- **WHEN** revert patch is requested and a current patch directory exists
- **THEN** the patch manager loads and dispatches the latest JSON version from that directory
- **AND** if the latest version cannot be read, parsed, validated, or dispatched, the current patch directory is left unchanged
- **WHEN** revert patch is requested and no current patch directory exists
- **THEN** it behaves like new patch by dispatching a full value reset and leaving the current directory unset

### Requirement: spp-7 — Patch message input/output buses
WHEN patch lifecycle operations interact with initialized synth state, THE synth patch persistence system SHALL provide patch-specific input messages for `LoadFromJSON`, `RevertAllToDefault`, and `SerializeToJSON`, and `MessageOut`/`MessageOutBus` types that can carry serialized JSON responses back to the patch manager.

#### Scenario: Load-from-JSON message carries a deserialized root
- **WHEN** a patch JSON version has been read and parsed successfully
- **THEN** the patch manager dispatches a `LoadFromJSON` message containing the already-deserialized JSON root
- **AND** the message retains ownership of the JSON arena until the message is consumed

#### Scenario: Serialize request produces JSON response
- **WHEN** initialized synth state receives a `SerializeToJSON` patch message
- **THEN** it serializes current parameter values, MIDI profile config, and MIDI endpoint state to a patch JSON object
- **AND** posts a `MessageOut` response containing the JSON object and the serialize request's monotonic `requestId`
- **AND** the response retains ownership of the JSON arena until the patch manager consumes it

#### Scenario: Patch buses are command queues
- **WHEN** patch input or output messages are queued
- **THEN** consumers drain them explicitly in control/app code
- **AND** the patch queues do not gate messages by musical timestamp

#### Scenario: Revert message does not alter topology
- **WHEN** initialized synth state receives a `RevertAllToDefault` patch message
- **THEN** it restores initialized values to defaults
- **AND** it does not create or remove parameters, banks, pages, slots, modulation sources, MIDI mappings, or profile definitions

#### Scenario: Library helper applies patch messages
- **WHEN** app code owns a `ParameterManager`, `MidiControllerProfileConfig`, `MidiEndpointState`, and `MessageOutBus`
- **THEN** library code provides a helper to apply `LoadFromJSON`, `RevertAllToDefault`, and `SerializeToJSON` messages to those objects
- **AND** app-specific work after a successful load is limited to side effects such as rebuilding JUCE MIDI processors

### Requirement: spp-8 — Miniapp patch manager integration
WHEN the synth miniapp is run without a patch-picker UI, THE miniapp SHALL instantiate the library patch manager and patch message buses, consume patch lifecycle messages after its ordinary initialization, and use a deterministic temporary patch directory for save-as/load demonstrations.

#### Scenario: Miniapp save-as writes under tmp
- **WHEN** the miniapp requests save-as without a file picker
- **THEN** it uses a deterministic directory under `/tmp`
- **AND** the JSON version file is written by library patch manager/file helpers

#### Scenario: Miniapp load/revert route through patch messages
- **WHEN** the miniapp loads or reverts a patch
- **THEN** patch JSON load is delivered through `LoadFromJSON` or `RevertAllToDefault` patch messages
- **AND** the miniapp rebuilds MIDI processors from the loaded MIDI profile config after consuming a load message
