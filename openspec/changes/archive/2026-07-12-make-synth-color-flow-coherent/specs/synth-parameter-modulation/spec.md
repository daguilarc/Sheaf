## MODIFIED Requirements

### Requirement: spm-2 — Ownership: manager, groups, parameters, banks, and slots
WHEN constructing the synth parameter system, THE system SHALL use a single `ParameterManager` to own global scene state, global gesture state, page state, parameter groups, banks, slots, and the global parameter ID space; the manager's gesture count SHALL default to zero and MAY be changed only before any group is created; `ParameterManager::CreateGroup` SHALL inject the manager's fixed gesture count and a non-owning manager pointer into each `ParameterGroup`; each `ParameterGroup` SHALL own its processing/storage config, `Modulators`, injected gesture count for arena sizing, non-owning manager pointer, and allocator, but SHALL NOT own gesture values, gesture selection, gesture metadata, parameter base colors, or parameter indicator palettes; each `Parameter` SHALL be allocated by exactly one group, own its resolved base/indicator appearance, and read runtime gesture values, selection, and metadata through the owning manager context rather than through group-local gesture state; banks and slots SHALL hold non-owning parameter pointers only.

#### Scenario: Parameter receives globally unique ID
- **WHEN** parameters are created across multiple groups
- **THEN** the manager assigns each parameter a unique global ID

#### Scenario: Bank does not own parameter lifetime
- **WHEN** a bank is populated with parameters from one or more groups
- **THEN** destroying or deselecting the bank does not destroy those parameters

#### Scenario: Gestures are manager-owned across groups
- **WHEN** parameters from two groups are edited while gesture 1 is selected
- **THEN** both parameters observe the same manager-owned gesture 1 selected state and gesture value

#### Scenario: Gesture count is fixed before groups
- **WHEN** a manager is configured with two gestures before any group is created
- **THEN** every subsequently created group sizes parameter gesture arrays from that count
- **AND** changing gesture count after group creation is not supported

#### Scenario: Default manager gesture count is zero
- **WHEN** a manager is default constructed and no gesture count is configured before group creation
- **THEN** subsequently created groups size parameter gesture arrays for zero gestures

#### Scenario: Group cannot carry independent gesture count
- **WHEN** a group is created through a manager configured with two gestures
- **THEN** the group receives gesture count `2` from the manager
- **AND** no `ParameterGroupConfig` field can override that count

#### Scenario: Group cannot carry parameter appearance
- **WHEN** two parameters share one group
- **THEN** each parameter can own a different base color and per-voice indicator palette
- **AND** no group field can override either appearance

### Requirement: spm-4 — Group config: dynamic shape and upfront allocation
WHEN a `ParameterGroup` is configured, THE group SHALL use runtime configuration for voice count, modulator count, scene count, maximum parameter count, process-lite alpha, target compute interval in samples, UI display-center alpha, and UI display-spread alpha; SHALL NOT accept parameter base colors, voice indicator colors, a voice color palette, or an independent gesture count in group configuration; the target compute interval SHALL default to 16 samples and SHALL be positive; SHALL size parameter per-scene/per-gesture arrays from the owning manager's gesture count injected by `ParameterManager::CreateGroup`; SHALL allocate per-parameter subarrays upfront through a group-owned allocator; and SHALL perform no heap allocation during `Compute`, per-sample parameter processing, `ProcessLite`, `GetRaw`, cached knob reads, routed reset-modifier press, routed random-modifier press, routed tick handling, or routed unmodified press handling after any needed modulation-depth parameters for that view have already been materialized. Routed unmodified press and random-mod modifier operations MAY lazily materialize missing modulation-depth parameter objects from preconfigured group capacity.

#### Scenario: Same-shaped group parameters
- **WHEN** two parameters are created in the same group
- **THEN** both parameters have subarrays sized from the same group shape and the owning manager's gesture count

#### Scenario: Allocation exhaustion
- **WHEN** creating a parameter would exceed the group allocator capacity
- **THEN** creation fails without registering a partial parameter in the manager or any bank

#### Scenario: Gesture count is not group-owned
- **WHEN** group configuration is inspected
- **THEN** it contains no independent gesture count field
- **AND** every parameter in the group uses the gesture count supplied by the manager

#### Scenario: Voice indicator colors are not group-owned
- **WHEN** group configuration is inspected
- **THEN** it contains no voice indicator palette
- **AND** parameter UI state obtains indicator colors from each parameter's resolved configuration

#### Scenario: Default target compute interval is 16 samples
- **WHEN** a group is created without overriding its target compute interval
- **THEN** the group configuration reports a target compute interval of 16 samples

#### Scenario: Target compute interval must be positive
- **WHEN** a group is configured with target compute interval `0`
- **THEN** group creation rejects the configuration

### Requirement: spm-19 — Color: UI-safe RGB and HSV helpers
WHEN external UI state or message-thread rendering needs colors from the synth parameter system, THE synth library SHALL provide one small trivially copyable 32-bit RGB/RGBA color type with equality, named basic colors, shared alpha/darkening/brightening helpers, `ToHsv` returning a unit-explicit `hueTurns` field, and separately named `FromHsvTurns` and `FromHsvDegrees` helpers, without requiring JUCE or Smart Grid headers; `FromHsvTurns` SHALL reject non-finite hue or hue outside `[0,1)`, `FromHsvDegrees` SHALL reject non-finite hue and wrap finite degrees modulo 360, and color UI-state storage SHALL be lock-free through one atomic 32-bit value or an equivalently lock-free representation.

#### Scenario: Convert color through hue turns
- **WHEN** a synth color is converted to HSV turns and back to RGB
- **THEN** the resulting color matches the original within one 8-bit channel step

#### Scenario: Degree and turn constructors agree
- **WHEN** one color is constructed at 120 degrees and another at one-third turn with equal saturation/value
- **THEN** the resulting RGB channels match within one 8-bit channel step

#### Scenario: Wrong hue unit fails loudly
- **WHEN** hue `120` is passed to `FromHsvTurns`
- **THEN** the call rejects the value rather than wrapping it to red

#### Scenario: Core color has no JUCE dependency
- **WHEN** the synth library is built without the miniapp target
- **THEN** public synth headers expose synth color types only
- **AND** do not include JUCE headers or expose `juce::Colour`
- **AND** portable UI drawing uses the same synth color type rather than a second RGBA struct

#### Scenario: Color atomics are lock-free
- **WHEN** color UI state is compiled on the supported build target
- **THEN** color storage is represented as a lock-free atomic 32-bit value or equivalent

### Requirement: spm-20 — UI State: parameter and visible-cell snapshots
WHEN a parameter or visible-cell UI snapshot is populated, THE synth parameter modulation system SHALL write a `Parameter::UIState` whose scalar fields are individually atomic and which contains the parameter base color and resolved per-voice indicator colors from `ParameterConfig`, connected state, bipolar flag, short name pointer or stable short name view, per-voice display center values, per-voice display spread values, per-voice minimum values, per-voice maximum values, per-voice switch bucket values, switch cardinality, synth-native modulator/gesture affecting bitmasks, source colors for the parameter's owning-group modulators, and manager-owned gesture colors; every color and count SHALL be inside the existing snapshot revision transaction; disconnected visible cells SHALL use `connected=false` with neutral values, zero spread, zero color counts, and off colors instead of a separate page/navigation role; bipolar parameter UI values and min/max values SHALL be reported in `[-1, 1]`, while unipolar parameter UI values and min/max values SHALL be reported in `[0, 1]`.

#### Scenario: Parameter UI state reports smoothed per-voice display values
- **WHEN** a parameter has two voices with different cached knob values
- **AND** `Parameter::PopulateUIState` is called after compute/process work
- **THEN** the UI state exposes the parameter's per-voice smoothed display center values
- **AND** it does not expose unsmoothed audio-rate cached knob values as the encoder indicator center

#### Scenario: Parameter UI state reports display spread
- **WHEN** audio-rate modulation causes a voice's cached knob value to vary around its smoothed display center
- **AND** `Parameter::PopulateUIState` is called after process work
- **THEN** the UI state exposes a non-negative per-voice display spread derived from the smoothed residual energy

#### Scenario: Parameter UI state reports configured base color
- **WHEN** a parameter is configured with base color `C`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** the UI state reports parameter base color `C`

#### Scenario: Parameter UI state reports parameter indicator colors
- **WHEN** a two-voice parameter resolves indicator colors `A` and `B`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** voice 0 indicator color is `A`
- **AND** voice 1 indicator color is `B`
- **AND** another parameter in the same group may report different colors

#### Scenario: Parameter UI state reports local source and global gesture colors
- **WHEN** a parameter's group has source colors `M0` and `M1` and its manager has gesture color `G0`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** the snapshot reports `M0`, `M1`, and `G0` in their indexed color arrays

#### Scenario: Bipolar UI state reports signed values
- **WHEN** a bipolar parameter has smoothed display center values `-0.5` and `0.75`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** the UI state reports the bipolar flag as true
- **AND** reports per-voice display center values `-0.5` and `0.75`
- **AND** reports minimum value `-1` and maximum value `1`

#### Scenario: Unipolar UI state reports unipolar values
- **WHEN** a unipolar parameter UI state is populated
- **THEN** the UI state reports the bipolar flag as false
- **AND** reports minimum value `0` and maximum value `1`

#### Scenario: Parameter UI state reports switch metadata
- **WHEN** a switch/discrete parameter UI state is populated
- **THEN** the UI state reports the parameter's switch cardinality
- **AND** reports each voice's precomputed switch bucket value using the same helper as `Parameter::GetSwitchVal(voiceIx)`
- **AND** reports display spread `0` for each voice

#### Scenario: Parameter UI state reports affecting masks
- **WHEN** a parameter has active or assigned modulation/gesture relationships that should be visible to the external encoder renderer
- **THEN** the UI state reports synth-native modulator and gesture affecting bitmasks
- **AND** those masks do not use Smart Grid `BitSet16` or Smart Grid enum types
- **AND** the masks cover the first 32 modulator and gesture indices only, omitting higher indices from badge rendering without constraining the underlying synth topology
- **AND** a modulator bit is set when the parameter has an assigned modulation-depth parameter for that modulator
- **AND** a gesture bit is set when the parameter has that gesture active in the manager's active scene selection: left scene only at blend 0, right scene only at blend 1, and both endpoint scenes for intermediate blends

#### Scenario: Unused UI state voices are disconnected or neutral
- **WHEN** a UI state has capacity for more voices than the parameter group uses
- **THEN** populated voice entries beyond the configured voice count are neutral and do not report stale values as connected
- **AND** their display spread values and indicator colors are zero/off

#### Scenario: Modulation target cell stays parameter-owned
- **WHEN** a visible bank cell is the target encoder in an open modulation view
- **AND** slot UI state is populated
- **THEN** that reserved `Parameter::UIState` reports `connected=true`
- **AND** it reports the target parameter's switch cardinality, per-voice switch buckets, affecting masks, base color, indicator colors, source colors, gesture colors, short name, bipolar flag, display center values, display spread values, and min/max values exactly as the target parameter would outside the modulation view
- **AND** renderers do not distinguish this cell from normal parameter cells through parameter UI-state page/navigation data

#### Scenario: Short name lifetime is stable
- **WHEN** a parameter UI state exposes a short name pointer or stable view
- **THEN** that reference remains valid for the lifetime of the owning manager topology
- **AND** UI state consumers do not retain it after the manager or parameter is destroyed

## ADDED Requirements

### Requirement: spm-69 — Parameter appearance registration
WHEN `ParameterManager` registers a parameter, THE manager SHALL resolve `ParameterConfig::indicatorColors` against the owning group's voice count by broadcasting the base color for an empty palette, broadcasting one explicit color, accepting exactly one color per voice, and rejecting any other nonzero cardinality atomically; modulation-depth parameters SHALL use their modulation source color as base and inherit their target parameter's resolved indicator colors.

#### Scenario: Invalid indicator cardinality preserves registration state
- **WHEN** a four-voice registration supplies two indicator colors
- **THEN** registration throws before parameter count, group allocation count, name registry, or bank mappings change
