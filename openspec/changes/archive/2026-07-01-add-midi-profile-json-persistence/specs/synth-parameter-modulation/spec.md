## ADDED Requirements

### Requirement: spm-50 — Persistence: recursive parameter value JSON
WHEN synth parameter values are saved, THE synth parameter modulation system SHALL provide recursive JSON serialization for an initialized `ParameterManager` that stores each top-level parameter's value state keyed by parameter name, including scene centers, parameter-owned per-scene gesture values, parameter-owned per-scene gesture active flags, and each non-default modulation-depth parameter subtree keyed by that depth parameter's live modulation slot index.

#### Scenario: Top-level parameter values are saved
- **WHEN** a parameter has non-default scene center values and gesture values
- **THEN** parameter JSON contains those scene and gesture values under that parameter's initialized name

#### Scenario: Modulation-depth subtree is saved by live slot
- **WHEN** a parameter has an attached modulation-depth parameter for modulator `1` with non-default value state
- **THEN** the parent parameter JSON contains a child value object under `modDepths["1"]`
- **AND** that child object recursively stores its own scene, gesture, and modulation-depth values

#### Scenario: Default modulation-depth subtree is omitted
- **WHEN** a modulation-depth parameter exists only because a modulation page was opened
- **AND** that depth parameter and its recursive children remain at their code-defined default value state
- **THEN** save omits that branch from `modDepths`

#### Scenario: Derived modulation arrays are not authoritative
- **WHEN** parameter JSON is saved
- **THEN** the saved value state is sufficient to recompute current/target modulation depths, min/max values, center scales, and normalization offsets after load
- **AND** those derived arrays are not required as independent patch fields

#### Scenario: Parameter metadata is not saved
- **WHEN** parameter JSON is saved
- **THEN** it does not store parameter names as definitions, short names, colors, ranges, polarity, switch metadata, modulation-source metadata, or bank/page placement

### Requirement: spm-51 — Persistence: value-only parameter load
WHEN synth parameter values are loaded from JSON, THE synth parameter modulation system SHALL first reset all initialized top-level parameter values and existing modulation-depth parameter values to their code-defined defaults, then match saved entries to initialized parameters by parameter name, apply values only to matching parameters and modulation-depth controls addressed by live code-defined modulator slots, leave missing initialized parameters at their initialization defaults, ignore saved parameters that no longer exist, and SHALL NOT create, delete, rename, or reconfigure groups, top-level parameters, pages, banks, slots, modulation sources, MIDI mappings, modulation assignments, colors, polarity, ranges, or parameter configs during value load.

#### Scenario: Load replaces existing parameter values
- **WHEN** JSON contains values for an already registered parameter name
- **THEN** load replaces that parameter's scene center, gesture value, gesture active, and recursive modulation-depth value state

#### Scenario: Deleted parameter is ignored
- **WHEN** JSON contains values for a parameter that does not exist in the initialized manager
- **THEN** load does not create that parameter
- **AND** load continues applying other matching parameter values

#### Scenario: Added parameter keeps default
- **WHEN** the initialized manager contains a parameter name that is absent from JSON
- **THEN** load leaves that parameter at its initialized default value

#### Scenario: Missing modulation-depth branch resets to default
- **WHEN** an existing modulation-depth branch has dirty live values
- **AND** the loaded JSON does not contain that branch under `modDepths`
- **THEN** load leaves that branch's existing parameter values at their code-defined defaults
- **AND** a subsequent save omits that default branch

#### Scenario: Saved modulation-depth branch materializes from code-defined slot
- **WHEN** JSON contains a modulation-depth child for a live parent parameter whose corresponding `modulationDepths_[modIx]` `Parameter*` pointer is null
- **THEN** load materializes that local depth parameter using the live code-defined modulator slot metadata
- **AND** load applies the saved child values recursively
- **AND** load does not read parameter definitions, names, colors, ranges, polarity, or modulation assignments from the JSON child

#### Scenario: Missing modulation-depth storage skips without partial topology
- **WHEN** JSON contains a modulation-depth child for a live parent parameter but no storage is available for the corresponding local depth parameter
- **THEN** load leaves that child branch unapplied
- **AND** load continues applying other matching parameter values

#### Scenario: Saved value array shape mismatch keeps initialized values
- **WHEN** JSON contains a matching parameter name but its saved scene-center, gesture-value, or gesture-active array length differs from the live initialized parameter shape
- **THEN** load skips the mismatched array
- **AND** leaves the corresponding live values at their code-defined defaults from the load reset
- **AND** continues applying other matching arrays, recursive depth values, and other matching parameters

### Requirement: spm-54 — Persistence: manager-wide value reset
WHEN patch lifecycle code requests a full value reset, THE synth parameter modulation system SHALL reset every initialized top-level parameter and every existing modulation-depth parameter to its code-defined default value state without creating, deleting, renaming, recoloring, rerouting, or reconfiguring any parameter topology.

#### Scenario: Full reset clears top-level values
- **WHEN** initialized parameters have edited scene centers, gesture values, gesture active flags, shift state, gesture selections, and scene blend
- **THEN** a full value reset restores parameter values to each parameter config's default value
- **AND** clears gesture-active flags and gesture selections
- **AND** restores scene selection/blend and shift state to a captured manager default control state, or the manager's constructor defaults if no app default has been captured

#### Scenario: Full reset clears existing modulation depths
- **WHEN** a parameter has existing modulation-depth parameters with non-default values
- **THEN** a full value reset restores those existing depth parameter values to their neutral defaults
- **AND** does not create missing modulation-depth parameters
- **AND** does not change modulation source metadata or assignments

### Requirement: spm-55 — Recursive modulation view storage
WHEN a bank opens a modulation-depth view for a parameter, THE synth parameter modulation system SHALL populate all visible modulator-depth controls for that page as one atomic operation using code-defined modulator slot metadata, SHALL leave the current bank view unchanged if storage is not sufficient for the whole page, and SHALL request additional parameter storage when the unused storage count falls below twice the group's modulator count.

#### Scenario: Page open materializes all depth controls
- **WHEN** a parameter has missing modulation-depth controls and storage is available for every modulator in the group
- **THEN** opening that parameter's modulation view materializes the missing controls from live modulator metadata
- **AND** the bank shows every modulator-depth cell plus the return/target cell

#### Scenario: Page open is no-op when storage is short
- **WHEN** a parameter has missing modulation-depth controls and storage is not available for every missing control required by the page
- **THEN** opening that parameter's modulation view leaves the selected bank, visible cells, and selected parameter unchanged
- **AND** it does not create a partial set of modulation-depth controls

#### Scenario: Low storage requests reinforcement
- **WHEN** a group's unused parameter storage falls below twice its modulator count
- **THEN** the parameter system emits a message requesting another parameter storage batch
- **AND** a caller can provide that batch without moving or invalidating existing parameter storage

### Requirement: spm-52 — Persistence: MIDI profile config JSON
WHEN MIDI controller profile configuration is saved, THE synth parameter modulation system SHALL provide library JSON serialization and loading helpers for `MidiControllerProfileConfig` and nested encoder input, encoder output, analog input, and system-message association config structs so a profile's input and output processors can be rebuilt from config outside any specific app.

#### Scenario: Encoder mappings round trip
- **WHEN** a MIDI profile config contains encoder turn, push, and output mappings
- **THEN** serializing and loading that config preserves channel, CC, slot index, position, relative mode, turn step, and output color-budget fields

#### Scenario: System associations round trip
- **WHEN** a MIDI profile config contains system message associations with press, optional release, feedback, and WRLD.Bldr positions
- **THEN** serializing and loading that config preserves the messages and controller addresses needed to rebuild equivalent input and output processors

#### Scenario: Profile factory uses loaded config
- **WHEN** a loaded MIDI profile config is passed to the profile factory
- **THEN** the factory builds the same processor categories as it would from the original config
- **AND** JUCE MIDI device handlers remain outside the profile factory

### Requirement: spm-53 — Persistence: MIDI device selection
WHEN app MIDI endpoint state is saved, THE synth parameter modulation system SHALL persist generic selected input and output endpoint identifiers separately from processor profile config and SHALL return those selections on load without requiring unavailable devices to open successfully.

#### Scenario: Device identifiers restore selection
- **WHEN** saved MIDI state contains input and output device identifiers that are present on the current machine
- **THEN** an app such as the miniapp can select those devices for later open/close operations

#### Scenario: Missing device remains closed
- **WHEN** saved MIDI state references a device identifier that is not present
- **THEN** load preserves the saved identifier as best-effort state where possible
- **AND** it leaves the corresponding MIDI handler closed rather than failing patch value load
