## MODIFIED Requirements

### Requirement: spm-11 — Audio path: Get and ProcessLite
WHEN the audio engine samples a parameter, THE synth parameter modulation system SHALL provide `Parameter::GetRaw(voiceIx)` as the explicit normalized `[0, 1]` read path for every parameter polarity, returning the `[0, 1]`-clamped value `currentCenter * currentCenterScale[voiceIx] + currentNormalizationOffset[voiceIx] + group.modulators.Apply(voiceIx, currentDepthsForVoice)` without traversing manager, page, bank, slot, scene, gesture, or modulation route state; SHALL provide `ProcessLitePhase1()` to advance current center, current center scales, current normalization offsets, current min/max values, and current modulation depths toward targets using `current += alpha * (target - current)` and then sample each voice's normalized cached knob from `GetRaw(voiceIx)`; SHALL provide `ReplaceCachedKnobValue(voiceIx, normalizedValue)` to replace and `[0,1]`-clamp that cache entry without changing raw/current/target or UI smoothing state; SHALL provide `ProcessLitePhase2()` to update UI smoothing from the final cache; and SHALL retain `ProcessLite()` as the phase-1-then-phase-2 convenience operation. Per-sample parameter and group processing SHALL expose matching phase-1 and phase-2 operations, SHALL recompute target state from the owning manager's current scene when `sampleIndex % group.Config().targetComputeIntervalSamples == 0` before phase 1, and SHALL retain `ProcessSample()` as the uninterrupted phase-1-then-phase-2 convenience operation.

#### Scenario: GetRaw uses current state only
- **WHEN** `GetRaw(0)` is called after `Compute()` and `ProcessLite()`
- **THEN** it uses only the parameter's current center, current center scale for voice 0, current normalization offset for voice 0, the current depth row for voice 0, and the group's current modulator row for voice 0
- **AND** it returns a normalized value in `[0, 1]` regardless of bipolar presentation metadata

#### Scenario: Phase 1 slews center
- **WHEN** current center is `0.0`, target center is `1.0`, and alpha is `0.25`
- **THEN** one `ProcessLitePhase1()` call sets current center to `0.25`

#### Scenario: Phase 1 slews center scale
- **WHEN** current center scale for voice 0 is `1.0`, target center scale for voice 0 is `0.5`, and alpha is `0.25`
- **THEN** one `ProcessLitePhase1()` call sets current center scale for voice 0 to `0.875`

#### Scenario: Phase 1 samples cached knob value
- **WHEN** `ProcessLitePhase1()` has advanced the current center, center scale, normalization offset, and depth state for a voice
- **THEN** it stores that voice's normalized cached knob value from `GetRaw(voiceIx)` using the group's current modulator row
- **AND** it does not yet update that voice's UI display center or spread energy

#### Scenario: Application replaces phase-1 cache before phase 2
- **WHEN** phase 1 caches `0.8` for a voice and compile-time-known application code replaces it with `0.3` before phase 2
- **THEN** subsequent cached mapping reads return `0.3`
- **AND** phase 2 derives UI smoothing from `0.3`
- **AND** `GetRaw()` and the parameter's current and target state remain unchanged

#### Scenario: Cache replacement preserves normalized domain
- **WHEN** application code replaces a cached knob value with a value below `0` or above `1`
- **THEN** the stored replacement is respectively clamped to `0` or `1`

#### Scenario: Convenience ProcessLite preserves ordinary behavior
- **WHEN** a caller invokes `ProcessLite()` without an intervening cache replacement
- **THEN** phase 1 and phase 2 run consecutively
- **AND** its resulting audio cache and UI smoothing state match explicit consecutive calls to `ProcessLitePhase1()` and `ProcessLitePhase2()`

#### Scenario: Per-sample processing recomputes on configured interval
- **WHEN** a parameter's group target compute interval is 16 samples
- **AND** per-sample phase 1 is called with sample indexes 15 and 16
- **THEN** the sample 15 call runs lite phase 1 without recomputing targets
- **AND** the sample 16 call recomputes targets from the owning manager's current scene before running lite phase 1

#### Scenario: Per-sample processing recomputes on first sample
- **WHEN** a parameter's group target compute interval is 16 samples
- **AND** per-sample phase 1 is called with sample index 0
- **THEN** the call recomputes targets from the owning manager's current scene before running lite phase 1

#### Scenario: Per-sample recompute slews top-level target center
- **WHEN** a top-level parameter's group target compute interval is 16 samples
- **AND** the parameter has target center `0.0`, raw computed center `1.0`, and group target-center alpha `0.25`
- **AND** per-sample phase 1 is called with sample index `16`
- **THEN** the target recompute sets target center to `0.25` before lite phase 1 slews current center toward that target

#### Scenario: Per-sample group phases cover group parameters
- **WHEN** both per-sample phases are invoked for a parameter group at an absolute sample index
- **THEN** every top-level parameter owned by that group runs phase 1 once and phase 2 once

#### Scenario: Per-sample group processing refreshes modulation-depth targets
- **WHEN** a top-level group parameter has a materialized modulation-depth parameter
- **AND** per-sample group phase 1 recomputes targets for that group
- **THEN** the top-level parameter's modulation-depth target state reflects the owning manager's current scene through the same recursive compute path used by top-level `Compute()`

#### Scenario: Cached knob formalizes one-sample modulation delay
- **WHEN** mapped DSP reads consume a parameter after phase 1
- **AND** a modulation source updates the group's modulator row later in the same sample frame
- **THEN** mapped DSP reads continue to use the cached knob value sampled or replaced after the earlier phase-1 call
- **AND** the later modulator update is visible to the next sample frame's phase-1 cache refresh

#### Scenario: Cached knob is seeded before steady-state ProcessLite
- **WHEN** a parameter is constructed, snapped to target during initialization, loaded from patch values, or reverted through a snap-to-target path
- **THEN** each voice's cached normalized knob value is seeded from `GetRaw(voiceIx)`
- **AND** each voice's normalized UI display center is seeded to that cached knob value
- **AND** each voice's UI display spread energy is seeded to `0`

### Requirement: spm-66 — UI State: smoothed parameter center and modulation spread
WHEN `ProcessLitePhase2()` runs for a parameter, THE synth parameter modulation system SHALL update per-voice UI display smoothing state in normalized `[0, 1]` space from the final cached knob value by first applying a group-configured one-pole EMA to that value for display center, then applying a group-configured one-pole EMA to the squared normalized residual between the cached value and updated display center for spread energy; SHALL perform no UI smoothing update during phase 1 or cache replacement; and `Parameter::PopulateUIState` SHALL publish normalized center and square root of spread energy unchanged for unipolar parameters, SHALL publish `2 * center - 1` and twice the normalized spread for bipolar parameters, and SHALL publish zero display spread for switch/discrete parameters.

#### Scenario: Display center smooths final cached knob value
- **WHEN** a voice's normalized cached knob value jumps from `0.0` to `1.0`
- **AND** the group display-center alpha is `0.25`
- **THEN** one `ProcessLitePhase2()` update sets that voice's normalized display center to `0.25`

#### Scenario: Replacement precedes UI smoothing
- **WHEN** phase 1 caches `1.0`, application code replaces that cache with `0.5`, the prior display center is `0.0`, and display-center alpha is `0.25`
- **THEN** phase 2 sets the display center to `0.125`
- **AND** the superseded `1.0` value makes no contribution to that update

#### Scenario: Display spread uses updated center residual
- **WHEN** a unipolar voice's normalized cached knob value is `1.0`
- **AND** its prior normalized display center is `0.0`
- **AND** its prior spread energy is `0.0`
- **AND** the group display-center alpha is `0.25`
- **AND** the group display-spread alpha is `0.5`
- **THEN** one `ProcessLitePhase2()` update sets that voice's normalized display center to `0.25`
- **AND** sets that voice's normalized spread energy to `0.28125`
- **AND** `Parameter::PopulateUIState` publishes display spread `sqrt(0.28125)` within numeric tolerance

#### Scenario: Bipolar display converts center and spread
- **WHEN** a bipolar voice has normalized display center `0.25` and normalized display spread `0.125`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** the UI state publishes signed display center `-0.5`
- **AND** publishes display spread `0.25`

#### Scenario: Static parameter spread decays
- **WHEN** a voice's normalized cached knob value remains equal to its normalized display center
- **AND** the group spread alpha is greater than zero
- **THEN** repeated `ProcessLitePhase2()` calls decay that voice's spread energy toward `0`

#### Scenario: Switch parameter spread is zero
- **WHEN** a switch/discrete parameter has a nonzero cached knob residual relative to its display center
- **AND** `Parameter::PopulateUIState` is called
- **THEN** the UI state publishes display spread `0` for that switch/discrete parameter voice

#### Scenario: Encoder can render blur from UI state
- **WHEN** a connected encoder cell has a nonzero UI display spread
- **THEN** the JUCE encoder renderer can draw the voice indicator as a display center with a spread-proportional blur or cloud without reading live audio-rate parameter state

### Requirement: spm-72 — Processing: sparse top-level and modulation-route traversal
WHEN a parameter group performs per-sample processing, THE synth parameter modulation system SHALL run phase 1 and phase 2 only for manager-registered top-level parameters, SHALL update materialized local modulation-depth parameters only through the recursive control-rate compute rooted at those top-level parameters, SHALL allow application code to operate between group phases without adding local nodes to either traversal, and SHALL maintain a stable-source active-route permutation whose contiguous active prefix contains every route with non-zero target depth or non-zero current depth still settling toward zero so per-sample depth slew and modulation application do not visit inactive routes.

#### Scenario: Materialized local depth does not add phased work
- **WHEN** a group contains `N` registered top-level parameters
- **AND** any number of local modulation-depth parameters have been materialized beneath them
- **THEN** one group per-sample processing step invokes phase 1 and phase 2 exactly `N` times each
- **AND** invokes both phases zero times on local modulation-depth parameters

#### Scenario: Recursive compute still refreshes local depth state
- **WHEN** a top-level parameter has a materialized modulation-depth subtree
- **AND** the configured target-compute sample arrives
- **THEN** recursive compute evaluates that subtree before deriving the top-level target depths
- **AND** seeds local cached/UI state without adding local nodes to either per-sample processing phase
- **AND** local display center is seeded from the recursively computed value and local display spread is reset to zero at compute cadence rather than filtered per sample

#### Scenario: Inactive routes are outside the active prefix
- **WHEN** a parameter has allocated modulation sources whose current and target depths are zero
- **THEN** those source identities remain available for editing and persistence
- **AND** their routes are outside the active prefix
- **AND** per-sample depth slew and modulation application do not visit them

#### Scenario: Route returning to zero remains active while settling
- **WHEN** an active route's target depth becomes zero while its current depth remains non-zero
- **THEN** the route remains in the active prefix while its one-pole state settles
- **AND** it leaves the active prefix only after current and target depth are zero within the system's modulation-neutral tolerance

#### Scenario: Active permutation preserves source identity
- **WHEN** active routes are reordered or swap-removed inside the active prefix
- **THEN** each route continues to read the modulation source, metadata, UI color, and persisted JSON key belonging to its original modulator index
