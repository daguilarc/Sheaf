## MODIFIED Requirements

### Requirement: spm-4 — Group config: dynamic shape and upfront allocation
WHEN a `ParameterGroup` is configured, THE group SHALL use runtime configuration for voice count, modulator count, scene count, maximum parameter count, process-lite alpha, UI display-center alpha, UI display-spread alpha, and an optional voice indicator color palette; SHALL NOT accept an independent gesture count in group configuration; SHALL size parameter per-scene/per-gesture arrays from the owning manager's gesture count injected by `ParameterManager::CreateGroup`; SHALL allocate per-parameter subarrays upfront through a group-owned allocator; and SHALL perform no heap allocation during `Compute`, `ProcessLite`, `GetRaw`, cached knob reads, routed reset-modifier press, routed random-modifier press, routed tick handling, or routed unmodified press handling after any needed modulation-depth parameters for that view have already been materialized. Routed unmodified press and random-mod modifier operations MAY lazily materialize missing modulation-depth parameter objects from preconfigured group capacity.

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

#### Scenario: Voice indicator colors come from group palette
- **WHEN** a group is configured with explicit voice indicator colors
- **THEN** parameter UI state for parameters in that group uses those colors for voice 0 and voice 1 indicators

#### Scenario: Default voice indicator colors are deterministic
- **WHEN** a group has more voices than configured voice indicator colors
- **THEN** missing colors are filled from a deterministic default palette

### Requirement: spm-11 — Audio path: Get and ProcessLite
WHEN the audio engine samples a parameter, THE synth parameter modulation system SHALL provide `Parameter::GetRaw(voiceIx)` as the explicit raw normalized read path that returns the clamped value `currentCenter * currentCenterScale[voiceIx] + currentNormalizationOffset[voiceIx] + group.modulators.Apply(voiceIx, currentDepthsForVoice)` without traversing manager, page, bank, slot, scene, gesture, or modulation route state; `ProcessLite()` SHALL advance current center, current center scales, current normalization offsets, current min/max values, and current modulation depths toward targets using the one-pole formula `current += alpha * (target - current)` with the owning group's configured alpha, then SHALL sample and store each voice's current cached knob value from `GetRaw(voiceIx)`.

#### Scenario: GetRaw uses current state only
- **WHEN** `GetRaw(0)` is called after `Compute()` and `ProcessLite()`
- **THEN** it uses only the parameter's current center, current center scale for voice 0, current normalization offset for voice 0, the current depth row for voice 0, and the group's current modulator row for voice 0

#### Scenario: ProcessLite slews center
- **WHEN** current center is `0.0`, target center is `1.0`, and alpha is `0.25`
- **THEN** one `ProcessLite()` call sets current center to `0.25`

#### Scenario: ProcessLite slews center scale
- **WHEN** current center scale for voice 0 is `1.0`, target center scale for voice 0 is `0.5`, and alpha is `0.25`
- **THEN** one `ProcessLite()` call sets current center scale for voice 0 to `0.875`

#### Scenario: ProcessLite samples cached knob value
- **WHEN** `ProcessLite()` has advanced the current center, center scale, normalization offset, and depth state for a voice
- **THEN** it stores that voice's cached knob value from `GetRaw(voiceIx)` using the group's current modulator row

#### Scenario: Cached knob formalizes one-sample modulation delay
- **WHEN** mapped DSP reads consume a parameter after `ProcessLite()`
- **AND** a modulation source updates the group's modulator row later in the same sample frame
- **THEN** mapped DSP reads continue to use the cached knob value sampled by the earlier `ProcessLite()` call
- **AND** the later modulator update is visible to the next sample frame's `ProcessLite()` cache refresh

#### Scenario: Cached knob is seeded before steady-state ProcessLite
- **WHEN** a parameter is constructed, snapped to target during initialization, loaded from patch values, or reverted through a snap-to-target path
- **THEN** each voice's cached knob value is seeded from `GetRaw(voiceIx)`
- **AND** each voice's UI display center is seeded to that cached knob value
- **AND** each voice's UI display spread energy is seeded to `0`

### Requirement: spm-13 — Revert: defaults and modulation clearing
WHEN a parameter is reverted to default for the current scene selection, THE parameter SHALL clear all modulation-depth parameter assignments, zero current and target modulation depth arrays, set applicable scene center values to the default normalized value, set applicable scene gesture active flags to false, and update current/target center consistently with the owning group's slew and recursion-depth rules.

#### Scenario: Reset modifier clears modulation
- **WHEN** a routed reset-modifier press resets a parameter
- **THEN** the parameter has no non-null modulation-depth parameter pointers
- **AND** `GetRaw(voiceIx)` returns the default-centered value after compute/process settling with zero modulators
- **AND** the cached knob value is seeded or slewed consistently with the current raw value through the applicable snap or `ProcessLite` path

### Requirement: spm-18 — Tests: deterministic randomized simulation oracle
WHEN automated tests cover the synth parameter modulation system, THE test suite SHALL include deterministic randomized simulation tests that repeatedly choose actions from encoder turns, encoder presses, reset/random/random-mod modifier presses and releases, manager-owned gesture select/deselect, manager-owned gesture value changes, page changes, bank selection, modified bank actions, scene changes, blend changes, modulator value changes, compute, and process-lite, and SHALL verify after each action against a separate deterministic oracle model maintained outside the production parameter classes.

#### Scenario: Random action loop checks invariants
- **WHEN** a randomized simulation test runs one seed
- **THEN** every action is followed by checks for expected page, bank, slot, scene, manager-owned gesture, modifier, parameter, modulation-route, target, current, `GetRaw(voiceIx)`, cached knob value, UI display center, and UI display spread state

#### Scenario: Cross-group gesture invariants are checked
- **WHEN** the randomized simulation includes parameters from multiple groups
- **THEN** the oracle checks that gesture selection and gesture values are manager-owned and observed consistently by all groups

#### Scenario: Modifier invariants are checked
- **WHEN** the randomized simulation chooses reset, random, random-mod, press, or bank-selection actions
- **THEN** the oracle checks the effective modifier precedence and the resulting single modifier behavior

#### Scenario: Failure is reproducible
- **WHEN** the randomized simulation detects a mismatch
- **THEN** the failure output includes seed, step number, action, affected parameter or physical encoder ID, random samples consumed for that action, and the mismatched expected and actual values

#### Scenario: Default and stress modes
- **WHEN** the test suite runs the randomized simulation in normal mode
- **THEN** it runs a short deterministic seed set suitable for routine test runs
- **WHEN** the stress environment is enabled
- **THEN** it runs a larger deterministic seed set

### Requirement: spm-20 — UI State: parameter and visible-cell snapshots
WHEN a parameter or visible-cell UI snapshot is populated, THE synth parameter modulation system SHALL write a `Parameter::UIState` whose scalar fields are individually atomic and which contains the parameter color from `ParameterConfig`, connected state, bipolar flag, short name pointer or stable short name view, per-voice display center values, per-voice display spread values, per-voice minimum values, per-voice maximum values, per-voice switch bucket values, switch cardinality, synth-native modulator/gesture affecting bitmasks, and per-voice indicator colors from the owning group's voice indicator palette for every configured voice; disconnected visible cells SHALL use `connected=false` with neutral values, zero spread, and off colors instead of a separate page/navigation role; bipolar parameter UI values and min/max values SHALL be reported in `[-1, 1]`, while unipolar parameter UI values and min/max values SHALL be reported in `[0, 1]`.

#### Scenario: Parameter UI state reports smoothed per-voice display values
- **WHEN** a parameter has two voices with different cached knob values
- **AND** `Parameter::PopulateUIState` is called after compute/process work
- **THEN** the UI state exposes the parameter's per-voice smoothed display center values
- **AND** it does not expose unsmoothed audio-rate cached knob values as the encoder indicator center

#### Scenario: Parameter UI state reports display spread
- **WHEN** audio-rate modulation causes a voice's cached knob value to vary around its smoothed display center
- **AND** `Parameter::PopulateUIState` is called after process work
- **THEN** the UI state exposes a non-negative per-voice display spread derived from the smoothed residual energy

#### Scenario: Parameter UI state reports configured color
- **WHEN** a parameter is configured with color `C`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** the UI state reports parameter color `C`

#### Scenario: Parameter UI state reports group voice indicator colors
- **WHEN** a parameter belongs to a group whose voice indicator palette contains colors `A` and `B`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** voice 0 indicator color is `A`
- **AND** voice 1 indicator color is `B`

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
- **AND** their display spread values are zero

#### Scenario: Modulation target cell stays parameter-owned
- **WHEN** a visible bank cell is the target encoder in an open modulation view
- **AND** slot UI state is populated
- **THEN** that reserved `Parameter::UIState` reports `connected=true`
- **AND** it reports the target parameter's switch cardinality, per-voice switch buckets, affecting masks, color, short name, bipolar flag, display center values, display spread values, and min/max values exactly as the target parameter would outside the modulation view
- **AND** renderers do not distinguish this cell from normal parameter cells through parameter UI-state page/navigation data

#### Scenario: Short name lifetime is stable
- **WHEN** a parameter UI state exposes a short name pointer or stable view
- **THEN** that reference remains valid for the lifetime of the owning manager topology
- **AND** UI state consumers do not retain it after the manager or parameter is destroyed

### Requirement: spm-25 — Tests: message-driven randomized UI-state simulation
WHEN automated tests cover the external synth parameter control surface, THE test suite SHALL include a deterministic randomized simulation that drives the existing operation set and reset/random/random-mod modifier operations through `MessageInBus`, includes unmodified and modified bank selection as message-driven operations, periodically populates UI state, and verifies UI-state atomics against the separate deterministic oracle model.

#### Scenario: Bus random test matches model
- **WHEN** the message-driven randomized simulation runs one seed
- **THEN** every applied visible message leaves manager, parameter, bank, slot, gesture, scene, modifier, and modulation state matching the oracle

#### Scenario: UI state checks match oracle
- **WHEN** the randomized simulation calls `PopulateUIState`
- **THEN** every connected visible parameter UI cell matches the oracle's expected visible parameter, per-voice display center values, per-voice display spread values, per-voice switch buckets when switch metadata is configured, bipolar flag, signed bipolar or unipolar min/max values, color, indicator colors, modulator/gesture affecting masks for the first 32 visible indices, manager-owned gesture values, selected flags, scene selection, scene blend, reset-held state, random-held state, and random-mod-held state

#### Scenario: Modifier random samples are modeled
- **WHEN** a random or random-mod modifier action consumes random samples
- **THEN** the randomized simulation oracle consumes the same number of samples in the same order

#### Scenario: Existing randomized oracle is migrated to manager-owned gestures
- **WHEN** the randomized simulation creates parameters in multiple groups
- **THEN** its oracle stores gesture values and selection at manager scope rather than group scope

#### Scenario: Cross-group randomized scenes are compatible
- **WHEN** the randomized simulation includes auxiliary-group parameters in cross-group checks
- **THEN** the auxiliary group has scene capacity compatible with the manager scene endpoint range used by the simulation
- **AND** scene endpoint changes go through the manager's validated setter

#### Scenario: Failure output is reproducible
- **WHEN** the message-driven randomized simulation detects a mismatch
- **THEN** the failure output includes seed, step number, message/action, random samples consumed for that action, and the mismatched expected and actual UI or model field

### Requirement: spm-28 — Switch/discrete parameter UI state
WHEN synth parameters represent discrete or switch-like values, THE synth parameter modulation system SHALL expose the switch cardinality and per-voice switch bucket in parameter config, parameter API, and atomic UI state without introducing a separate discrete parameter type in this change; switch/discrete parameters SHALL keep switch bucket computation based on the display-normalized unslewed target value and SHALL publish zero display spread.

#### Scenario: Parameter exposes switch value
- **WHEN** a parameter has `switchValues <= 1`
- **THEN** `Parameter::IsSwitch()` is false
- **AND** `Parameter::GetSwitchVal(voiceIx)` returns 0
- **WHEN** a parameter has `switchValues > 1`
- **THEN** `Parameter::IsSwitch()` is true
- **AND** `Parameter::GetSwitchVal(voiceIx)` rounds the display-normalized unslewed target value to `[0, switchValues - 1]`

#### Scenario: UI state carries switch values
- **WHEN** `Parameter::PopulateUIState` populates a connected parameter cell
- **THEN** `Parameter::UIState::switchValues` stores that parameter's switch cardinality
- **AND** per-voice switch bucket atomics store the values returned by `Parameter::GetSwitchVal(voiceIx)`
- **AND** per-voice display spread atomics store `0` for switch parameters
- **WHEN** a cell is disconnected or empty
- **THEN** `switchValues` and per-voice switch bucket atomics are reset to 0

#### Scenario: Switch values remain JUCE-free
- **WHEN** switch metadata is added to the synth core
- **THEN** it is represented only by core C++ parameter config/API/UI-state fields

### Requirement: spm-47 — Parameters: normalized mapping helpers
WHEN modules map normalized parameter values into natural units from their `SetInput` functions, THE synth parameter modulation system SHALL provide manager-level helpers that read a parameter by voice ID and parameter ID and return mapped values for linear interpolation, exponential geometric interpolation, zero-based exponential interpolation with a specified midpoint value, and bipolar variants of each supported mapping; those helpers SHALL map the parameter's cached knob value sampled by the most recent `ProcessLite()` call for that voice.

#### Scenario: Linear mapping reaches endpoints
- **WHEN** a unipolar parameter's cached knob value is `0`
- **AND** code calls `GetLinear(minValue, maxValue, voiceIx, parameterId)`
- **THEN** the helper returns `minValue`
- **WHEN** the same parameter's cached knob value is `1`
- **THEN** the helper returns `maxValue`

#### Scenario: Exponential mapping reaches endpoints
- **WHEN** a unipolar parameter's cached knob value is `0`
- **AND** code calls `GetExponential(minValue, maxValue, voiceIx, parameterId)` with positive endpoint values
- **THEN** the helper returns `minValue`
- **WHEN** the same parameter's cached knob value is `1`
- **THEN** the helper returns `maxValue`

#### Scenario: Zero-based exponential honors midpoint
- **WHEN** a unipolar parameter's cached knob value is `0`
- **AND** code calls `GetZeroBasedExponential(maxValue, midpointValue, voiceIx, parameterId)`
- **THEN** the helper returns `0`
- **WHEN** the same parameter's cached knob value is `0.5`
- **THEN** the helper returns `midpointValue` within numeric tolerance
- **WHEN** the same parameter's cached knob value is `1`
- **THEN** the helper returns `maxValue`

#### Scenario: Bipolar mapping returns signed values
- **WHEN** a bipolar mapping helper is called for cached knob values below and above the center point
- **THEN** values below center map to negative natural-unit values
- **AND** values above center map to positive natural-unit values
- **AND** the center point maps to zero within numeric tolerance

#### Scenario: Mapping helper uses cached ProcessLite value
- **WHEN** a mapped parameter has current modulation applied for a voice
- **AND** `ProcessLite()` has sampled that voice's cached knob value
- **THEN** each mapping helper maps the cached knob value rather than recomputing the raw expression at helper-call time

### Requirement: spm-64 — Parameters: centered bipolar exponential mapping
WHEN modules map signed bipolar parameter values into positive multiplicative natural units around a center, THE synth parameter modulation system SHALL provide a manager-level helper that reads a parameter by voice ID and parameter ID and returns a positive exponential value where signed cached knob value `-1` maps to the supplied left value, signed cached knob value `0` maps to the supplied center value, and signed cached knob value `1` maps to the supplied right value.

#### Scenario: Centered bipolar exponential reaches left endpoint
- **WHEN** a signed bipolar parameter cached knob value is `-1`
- **AND** code calls the centered bipolar exponential helper with left `0.2`, center `1`, and right `5`
- **THEN** the helper returns `0.2` within numeric tolerance

#### Scenario: Centered bipolar exponential maps center
- **WHEN** a signed bipolar parameter cached knob value is `0`
- **AND** code calls the centered bipolar exponential helper with left `0.2`, center `1`, and right `5`
- **THEN** the helper returns `1` within numeric tolerance

#### Scenario: Centered bipolar exponential reaches right endpoint
- **WHEN** a signed bipolar parameter cached knob value is `1`
- **AND** code calls the centered bipolar exponential helper with left `0.2`, center `1`, and right `5`
- **THEN** the helper returns `5` within numeric tolerance

#### Scenario: Centered bipolar exponential interpolates geometrically on each side
- **WHEN** a signed bipolar parameter cached knob value is `-0.5`
- **AND** code calls the centered bipolar exponential helper with left `0.25`, center `2`, and right `32`
- **THEN** the helper returns `2 * sqrt(0.25 / 2)` within numeric tolerance
- **WHEN** a signed bipolar parameter cached knob value is `0.5`
- **THEN** the helper returns `2 * sqrt(32 / 2)` within numeric tolerance

#### Scenario: Centered bipolar exponential uses cached ProcessLite value
- **WHEN** a mapped parameter has current modulation applied for a voice
- **AND** `ProcessLite()` has sampled that voice's cached knob value
- **THEN** the centered bipolar exponential helper maps the cached knob value rather than only the scene center value or a raw expression recomputed at helper-call time

#### Scenario: Invalid centered values are rejected
- **WHEN** code calls the centered bipolar exponential helper with a left, center, or right value less than or equal to `0`
- **THEN** the helper raises a coding error rather than returning an invalid mapping

### Requirement: spm-65 — Parameters: signed bipolar zero-based exponential mapping
WHEN modules map signed bipolar parameter values into signed zero-centered natural units with exponential magnitude, THE synth parameter modulation system SHALL provide a manager-level helper that reads a parameter by voice ID and parameter ID and returns `sign(knob) * ZeroBasedExponential(abs(knob), maxAbsValue, midpointAbsValue)` for signed cached knob values in `[-1, 1]`.

#### Scenario: Signed zero-based bipolar exponential reaches endpoints
- **WHEN** a signed bipolar parameter cached knob value is `-1`
- **AND** code calls the signed zero-based bipolar exponential helper with max absolute value `1` and midpoint absolute value `0.1`
- **THEN** the helper returns `-1` within numeric tolerance
- **WHEN** the signed bipolar parameter cached knob value is `1`
- **THEN** the helper returns `1` within numeric tolerance

#### Scenario: Signed zero-based bipolar exponential reaches midpoints
- **WHEN** a signed bipolar parameter cached knob value is `-0.5`
- **AND** code calls the signed zero-based bipolar exponential helper with max absolute value `1` and midpoint absolute value `0.1`
- **THEN** the helper returns `-0.1` within numeric tolerance
- **WHEN** the signed bipolar parameter cached knob value is `0.5`
- **THEN** the helper returns `0.1` within numeric tolerance

#### Scenario: Signed zero-based bipolar exponential maps center to zero
- **WHEN** a signed bipolar parameter cached knob value is `0`
- **AND** code calls the signed zero-based bipolar exponential helper
- **THEN** the helper returns `0` within numeric tolerance

#### Scenario: Signed zero-based bipolar exponential uses cached ProcessLite value
- **WHEN** a mapped parameter has current modulation applied for a voice
- **AND** `ProcessLite()` has sampled that voice's cached knob value
- **THEN** the signed zero-based bipolar exponential helper maps the cached knob value rather than a raw expression recomputed at helper-call time

## ADDED Requirements

### Requirement: spm-66 — UI State: smoothed parameter center and modulation spread
WHEN `ProcessLite()` samples cached knob values for a parameter, THE synth parameter modulation system SHALL update per-voice UI display smoothing state by first applying a group-configured one-pole EMA to the cached knob value for display center, then applying a group-configured one-pole EMA to the squared residual between the cached knob value and the updated display center for spread energy, and publishing the display center plus the square root of spread energy through `Parameter::UIState`; switch/discrete parameters SHALL publish zero display spread.

#### Scenario: Display center smooths cached knob value
- **WHEN** a voice's cached knob value jumps from `0.0` to `1.0`
- **AND** the group display-center alpha is `0.25`
- **THEN** one `ProcessLite()` update sets that voice's display center to `0.25`

#### Scenario: Display spread uses updated center residual
- **WHEN** a voice's cached knob value is `1.0`
- **AND** its prior display center is `0.0`
- **AND** its prior spread energy is `0.0`
- **AND** the group display-center alpha is `0.25`
- **AND** the group display-spread alpha is `0.5`
- **THEN** one `ProcessLite()` update sets that voice's display center to `0.25`
- **AND** sets that voice's spread energy to `0.28125`
- **AND** `Parameter::PopulateUIState` publishes display spread `sqrt(0.28125)` within numeric tolerance

#### Scenario: Static parameter spread decays
- **WHEN** a voice's cached knob value remains equal to its display center
- **AND** the group spread alpha is greater than zero
- **THEN** repeated `ProcessLite()` calls decay that voice's spread energy toward `0`

#### Scenario: Switch parameter spread is zero
- **WHEN** a switch/discrete parameter has a nonzero cached knob residual relative to its display center
- **AND** `Parameter::PopulateUIState` is called
- **THEN** the UI state publishes display spread `0` for that switch/discrete parameter voice

#### Scenario: Encoder can render blur from UI state
- **WHEN** a connected encoder cell has a nonzero UI display spread
- **THEN** the JUCE encoder renderer can draw the voice indicator as a display center with a spread-proportional blur or cloud without reading live audio-rate parameter state
