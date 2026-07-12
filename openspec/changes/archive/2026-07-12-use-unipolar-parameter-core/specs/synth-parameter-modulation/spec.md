## ADDED Requirements

### Requirement: spm-70 — Parameters: unipolar core value domain
WHEN parameter state is configured, edited, computed, smoothed, cached, or serialized, THE synth parameter modulation system SHALL represent defaults, scene centers, gesture values, current and target centers, cached knob values, dynamic min/max values, and modulation-depth control values in normalized `[0, 1]` space regardless of bipolar presentation metadata; SHALL use bipolar metadata only when validating bipolar mapping helpers or converting normalized values for signed consumption and UI publication; and SHALL preserve the existing bounded crossfade modulation law and signed overfull-depth normalization in normalized space.

#### Scenario: Bipolar neutral is stored at normalized center
- **WHEN** a bipolar parameter represents signed neutral `0`
- **THEN** its internal default, scene, current, target, and cached knob values are `0.5`

#### Scenario: Positive full-depth crossfade reaches the source
- **WHEN** a parameter has effective depth `1` from one modulation route
- **THEN** its center scale is `0`
- **AND** its normalized result equals that route's unipolar modulation source
- **AND** a bipolar read maps the resulting source range `0..1` to `-1..1`

#### Scenario: Negative full-depth crossfade reaches the inverted source
- **WHEN** a parameter has effective depth `-1` from one modulation route
- **THEN** its center scale is `0`
- **AND** its normalization offset is `1`
- **AND** its normalized result equals `1 - source`
- **AND** a bipolar read maps that result to the negated signed source

#### Scenario: Bipolar UI conversion occurs at publication
- **WHEN** a bipolar parameter has normalized display center `0.25` and normalized min/max values `0` and `1`
- **AND** `Parameter::PopulateUIState` publishes its snapshot
- **THEN** the snapshot reports signed display center `-0.5` and signed min/max values `-1` and `1`

#### Scenario: Serialized parameter values use the core domain
- **WHEN** parameter value JSON is saved after this change
- **THEN** bipolar parameter values and modulation-depth control values are serialized in normalized `[0, 1]` space

## MODIFIED Requirements

### Requirement: spm-10 — Compute: dynamic modulation min/max
WHEN `Parameter::Compute()` calculates per-voice modulation state, THE parameter SHALL also compute per-voice target minimum and maximum values in normalized `[0, 1]` space representing the audio-rate range reachable from unipolar `[0, 1]` modulation sources; SHALL slew current minimum and maximum values in normalized space in `ProcessLite`; and SHALL publish those values through `Parameter::UIState::minValues` and `Parameter::UIState::maxValues`, converting them to `[-1, 1]` only when the parameter has bipolar presentation metadata. If `sum(abs(rawDepth[voice][modIx])) > 1`, the normalized target min/max SHALL be the full `0..1` range. Otherwise, min/max SHALL be computed from the current effective formula as `base + sum(min(0, effectiveDepth))` and `base + sum(max(0, effectiveDepth))`, clamped to `[0, 1]`, where `base = center * centerScale + normalizationOffset`.

#### Scenario: UI state publishes dynamic underfull min/max
- **WHEN** a unipolar parameter with center `0.5` has raw depths `+0.25` and `-0.5`
- **THEN** its UI-state minimum is `0.125`
- **AND** its UI-state maximum is `0.875`

#### Scenario: UI state publishes signed full range for overfull bipolar depths
- **WHEN** a bipolar parameter has `sum(abs(rawDepths)) > 1`
- **THEN** its normalized internal minimum and maximum are `0` and `1`
- **AND** its UI-state minimum is `-1.0`
- **AND** its UI-state maximum is `1.0`

### Requirement: spm-11 — Audio path: Get and ProcessLite
WHEN the audio engine samples a parameter, THE synth parameter modulation system SHALL provide `Parameter::GetRaw(voiceIx)` as the explicit normalized `[0, 1]` read path for every parameter polarity, returning the `[0, 1]`-clamped value `currentCenter * currentCenterScale[voiceIx] + currentNormalizationOffset[voiceIx] + group.modulators.Apply(voiceIx, currentDepthsForVoice)` without traversing manager, page, bank, slot, scene, gesture, or modulation route state; `ProcessLite()` SHALL advance current center, current center scales, current normalization offsets, current min/max values, and current modulation depths toward targets using the one-pole formula `current += alpha * (target - current)` with the owning group's configured process-lite alpha, then SHALL sample and store each voice's normalized cached knob value from `GetRaw(voiceIx)`; and per-sample parameter processing SHALL recompute target state from the owning manager's current scene when `sampleIndex % group.Config().targetComputeIntervalSamples == 0` before running `ProcessLite()`, including target-center smoothing for top-level parameters.

#### Scenario: GetRaw uses current state only
- **WHEN** `GetRaw(0)` is called after `Compute()` and `ProcessLite()`
- **THEN** it uses only the parameter's current center, current center scale for voice 0, current normalization offset for voice 0, the current depth row for voice 0, and the group's current modulator row for voice 0
- **AND** it returns a normalized value in `[0, 1]` regardless of bipolar presentation metadata

#### Scenario: ProcessLite slews center
- **WHEN** current center is `0.0`, target center is `1.0`, and alpha is `0.25`
- **THEN** one `ProcessLite()` call sets current center to `0.25`

#### Scenario: ProcessLite slews center scale
- **WHEN** current center scale for voice 0 is `1.0`, target center scale for voice 0 is `0.5`, and alpha is `0.25`
- **THEN** one `ProcessLite()` call sets current center scale for voice 0 to `0.875`

#### Scenario: ProcessLite samples cached knob value
- **WHEN** `ProcessLite()` has advanced the current center, center scale, normalization offset, and depth state for a voice
- **THEN** it stores that voice's normalized cached knob value from `GetRaw(voiceIx)` using the group's current modulator row

#### Scenario: Per-sample processing recomputes on configured interval
- **WHEN** a parameter's group target compute interval is 16 samples
- **AND** per-sample parameter processing is called with sample indexes 15 and 16
- **THEN** the sample 15 call runs `ProcessLite()` without recomputing targets
- **AND** the sample 16 call recomputes targets from the owning manager's current scene before running `ProcessLite()`

#### Scenario: Per-sample processing recomputes on first sample
- **WHEN** a parameter's group target compute interval is 16 samples
- **AND** per-sample parameter processing is called with sample index 0
- **THEN** the call recomputes targets from the owning manager's current scene before running `ProcessLite()`

#### Scenario: Per-sample recompute slews top-level target center
- **WHEN** a top-level parameter's group target compute interval is 16 samples
- **AND** the parameter has target center `0.0`, raw computed center `1.0`, and group target-center alpha `0.25`
- **AND** per-sample parameter processing is called with sample index `16`
- **THEN** the target recompute sets target center to `0.25` before `ProcessLite()` slews current center toward that target

#### Scenario: Per-sample group processing covers group parameters
- **WHEN** per-sample processing is invoked for a parameter group at an absolute sample index
- **THEN** every top-level parameter owned by that group runs the same per-sample parameter processing step for that sample index

#### Scenario: Per-sample group processing refreshes modulation-depth targets
- **WHEN** a top-level group parameter has a materialized modulation-depth parameter
- **AND** per-sample group processing recomputes targets for that group
- **THEN** the top-level parameter's modulation-depth target state reflects the owning manager's current scene through the same recursive compute path used by top-level `Compute()`

#### Scenario: Cached knob formalizes one-sample modulation delay
- **WHEN** mapped DSP reads consume a parameter after `ProcessLite()`
- **AND** a modulation source updates the group's modulator row later in the same sample frame
- **THEN** mapped DSP reads continue to use the cached knob value sampled by the earlier `ProcessLite()` call
- **AND** the later modulator update is visible to the next sample frame's `ProcessLite()` cache refresh

#### Scenario: Cached knob is seeded before steady-state ProcessLite
- **WHEN** a parameter is constructed, snapped to target during initialization, loaded from patch values, or reverted through a snap-to-target path
- **THEN** each voice's cached normalized knob value is seeded from `GetRaw(voiceIx)`
- **AND** each voice's normalized UI display center is seeded to that cached knob value
- **AND** each voice's UI display spread energy is seeded to `0`

### Requirement: spm-47 — Parameters: normalized mapping helpers
WHEN modules map normalized parameter values into natural units from their `SetInput` functions, THE synth parameter modulation system SHALL provide manager-level helpers that read a parameter by voice ID and parameter ID and return mapped values for linear interpolation, exponential geometric interpolation, zero-based exponential interpolation with a specified midpoint value, and bipolar variants of each supported mapping; those helpers SHALL map the normalized cached knob value sampled by the most recent `ProcessLite()` call for that voice, and bipolar helpers SHALL first convert it with `bipolar = 2 * normalized - 1`.

#### Scenario: Linear mapping reaches endpoints
- **WHEN** a parameter's normalized cached knob value is `0`
- **AND** code calls `GetLinear(minValue, maxValue, voiceIx, parameterId)`
- **THEN** the helper returns `minValue`
- **WHEN** the same parameter's normalized cached knob value is `1`
- **THEN** the helper returns `maxValue`

#### Scenario: Exponential mapping reaches endpoints
- **WHEN** a parameter's normalized cached knob value is `0`
- **AND** code calls `GetExponential(minValue, maxValue, voiceIx, parameterId)` with positive endpoint values
- **THEN** the helper returns `minValue`
- **WHEN** the same parameter's normalized cached knob value is `1`
- **THEN** the helper returns `maxValue`

#### Scenario: Zero-based exponential honors midpoint
- **WHEN** a parameter's normalized cached knob value is `0`
- **AND** code calls `GetZeroBasedExponential(maxValue, midpointValue, voiceIx, parameterId)`
- **THEN** the helper returns `0`
- **WHEN** the same parameter's normalized cached knob value is `0.5`
- **THEN** the helper returns `midpointValue` within numeric tolerance
- **WHEN** the same parameter's normalized cached knob value is `1`
- **THEN** the helper returns `maxValue`

#### Scenario: Bipolar mapping converts normalized values
- **WHEN** a bipolar mapping helper is called for normalized cached knob values `0`, `0.5`, and `1`
- **THEN** it interprets them as signed values `-1`, `0`, and `1` before applying its natural-unit mapping

#### Scenario: Mapping helper uses cached ProcessLite value
- **WHEN** a mapped parameter has current modulation applied for a voice
- **AND** `ProcessLite()` has sampled that voice's normalized cached knob value
- **THEN** each mapping helper maps the cached knob value rather than recomputing the raw expression at helper-call time

### Requirement: spm-64 — Parameters: centered bipolar exponential mapping
WHEN modules map bipolar parameter values into positive multiplicative natural units around a center, THE synth parameter modulation system SHALL provide a manager-level helper that reads a normalized cached parameter value, converts it with `bipolar = 2 * normalized - 1`, and returns a positive exponential value where normalized `0` maps to the supplied left value, normalized `0.5` maps to the supplied center value, and normalized `1` maps to the supplied right value.

#### Scenario: Centered bipolar exponential reaches left endpoint
- **WHEN** a bipolar parameter's normalized cached knob value is `0`
- **AND** code calls the centered bipolar exponential helper with left `0.2`, center `1`, and right `5`
- **THEN** the helper returns `0.2` within numeric tolerance

#### Scenario: Centered bipolar exponential maps center
- **WHEN** a bipolar parameter's normalized cached knob value is `0.5`
- **AND** code calls the centered bipolar exponential helper with left `0.2`, center `1`, and right `5`
- **THEN** the helper returns `1` within numeric tolerance

#### Scenario: Centered bipolar exponential reaches right endpoint
- **WHEN** a bipolar parameter's normalized cached knob value is `1`
- **AND** code calls the centered bipolar exponential helper with left `0.2`, center `1`, and right `5`
- **THEN** the helper returns `5` within numeric tolerance

#### Scenario: Centered bipolar exponential interpolates geometrically on each side
- **WHEN** a bipolar parameter's normalized cached knob value is `0.25`
- **AND** code calls the centered bipolar exponential helper with left `0.25`, center `2`, and right `32`
- **THEN** the helper returns `2 * sqrt(0.25 / 2)` within numeric tolerance
- **WHEN** the normalized cached knob value is `0.75`
- **THEN** the helper returns `2 * sqrt(32 / 2)` within numeric tolerance

#### Scenario: Centered bipolar exponential uses cached ProcessLite value
- **WHEN** a mapped parameter has current modulation applied for a voice
- **AND** `ProcessLite()` has sampled that voice's normalized cached knob value
- **THEN** the centered bipolar exponential helper maps the cached knob value rather than only the scene center value or a raw expression recomputed at helper-call time

#### Scenario: Invalid centered values are rejected
- **WHEN** code calls the centered bipolar exponential helper with a left, center, or right value less than or equal to `0`
- **THEN** the helper raises a coding error rather than returning an invalid mapping

### Requirement: spm-65 — Parameters: signed bipolar zero-based exponential mapping
WHEN modules map bipolar parameter values into signed zero-centered natural units with exponential magnitude, THE synth parameter modulation system SHALL provide a manager-level helper that reads a normalized cached parameter value, converts it with `bipolar = 2 * normalized - 1`, and returns `sign(bipolar) * ZeroBasedExponential(abs(bipolar), maxAbsValue, midpointAbsValue)`.

#### Scenario: Signed zero-based bipolar exponential reaches endpoints
- **WHEN** a bipolar parameter's normalized cached knob value is `0`
- **AND** code calls the signed zero-based bipolar exponential helper with max absolute value `1` and midpoint absolute value `0.1`
- **THEN** the helper returns `-1` within numeric tolerance
- **WHEN** the normalized cached knob value is `1`
- **THEN** the helper returns `1` within numeric tolerance

#### Scenario: Signed zero-based bipolar exponential reaches midpoints
- **WHEN** a bipolar parameter's normalized cached knob value is `0.25`
- **AND** code calls the signed zero-based bipolar exponential helper with max absolute value `1` and midpoint absolute value `0.1`
- **THEN** the helper returns `-0.1` within numeric tolerance
- **WHEN** the normalized cached knob value is `0.75`
- **THEN** the helper returns `0.1` within numeric tolerance

#### Scenario: Signed zero-based bipolar exponential maps center to zero
- **WHEN** a bipolar parameter's normalized cached knob value is `0.5`
- **AND** code calls the signed zero-based bipolar exponential helper
- **THEN** the helper returns `0` within numeric tolerance

#### Scenario: Signed zero-based bipolar exponential uses cached ProcessLite value
- **WHEN** a mapped parameter has current modulation applied for a voice
- **AND** `ProcessLite()` has sampled that voice's normalized cached knob value
- **THEN** the signed zero-based bipolar exponential helper maps the cached knob value rather than a raw expression recomputed at helper-call time

### Requirement: spm-66 — UI State: smoothed parameter center and modulation spread
WHEN `ProcessLite()` samples normalized cached knob values for a parameter, THE synth parameter modulation system SHALL update per-voice UI display smoothing state in normalized `[0, 1]` space by first applying a group-configured one-pole EMA to the cached knob value for display center, then applying a group-configured one-pole EMA to the squared normalized residual between the cached knob value and the updated display center for spread energy; `Parameter::PopulateUIState` SHALL publish the normalized center and square root of spread energy unchanged for unipolar parameters, SHALL publish `2 * center - 1` and twice the normalized spread for bipolar parameters, and SHALL publish zero display spread for switch/discrete parameters.

#### Scenario: Display center smooths cached knob value
- **WHEN** a voice's normalized cached knob value jumps from `0.0` to `1.0`
- **AND** the group display-center alpha is `0.25`
- **THEN** one `ProcessLite()` update sets that voice's normalized display center to `0.25`

#### Scenario: Display spread uses updated center residual
- **WHEN** a unipolar voice's normalized cached knob value is `1.0`
- **AND** its prior normalized display center is `0.0`
- **AND** its prior spread energy is `0.0`
- **AND** the group display-center alpha is `0.25`
- **AND** the group display-spread alpha is `0.5`
- **THEN** one `ProcessLite()` update sets that voice's normalized display center to `0.25`
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
- **THEN** repeated `ProcessLite()` calls decay that voice's spread energy toward `0`

#### Scenario: Switch parameter spread is zero
- **WHEN** a switch/discrete parameter has a nonzero cached knob residual relative to its display center
- **AND** `Parameter::PopulateUIState` is called
- **THEN** the UI state publishes display spread `0` for that switch/discrete parameter voice

#### Scenario: Encoder can render blur from UI state
- **WHEN** a connected encoder cell has a nonzero UI display spread
- **THEN** the JUCE encoder renderer can draw the voice indicator as a display center with a spread-proportional blur or cloud without reading live audio-rate parameter state

### Requirement: spm-67 — Compute: curved modulation-depth target mapping
WHEN `Parameter::Compute()` calculates per-voice modulation depths from recursively computed modulation-depth parameters, THE synth parameter modulation system SHALL convert each existing depth parameter's normalized `[0, 1]` knob value to signed travel with `signedKnob = 2 * normalized - 1`, then convert that signed value into a raw depth target with a bipolar zero-based exponential curve before applying signed depth normalization, using maximum absolute depth `1.0`, halfpoint absolute depth `0.25` at absolute signed knob travel `0.5`, and a precomputed mapping base derived from that maximum and halfpoint.

#### Scenario: Quarter and three-quarter depth positions map to one-quarter magnitude
- **WHEN** a modulation-depth parameter's recursively computed normalized knob value is `0.75`
- **THEN** the parent parameter's raw target depth for that modulator is `0.25` within numeric tolerance
- **WHEN** the modulation-depth parameter's recursively computed normalized knob value is `0.25`
- **THEN** the parent parameter's raw target depth for that modulator is `-0.25` within numeric tolerance

#### Scenario: Center and extremes remain anchored
- **WHEN** a modulation-depth parameter's recursively computed normalized knob value is `0.5`
- **THEN** the parent parameter's raw target depth for that modulator is `0` within numeric tolerance
- **WHEN** the normalized knob value is `1`
- **THEN** the parent parameter's raw target depth for that modulator is `1` within numeric tolerance
- **WHEN** the normalized knob value is `0`
- **THEN** the parent parameter's raw target depth for that modulator is `-1` within numeric tolerance

#### Scenario: Curved depth participates in existing normalization
- **WHEN** two modulation-depth parameters on a parent have recursively computed normalized knob values `1.0` and `0.0`
- **THEN** their curved raw depth targets are `1.0` and `-1.0`
- **AND** the parent parameter normalizes those effective depths to `0.5` and `-0.5`
- **AND** derives the normalization offset from the normalized negative effective depth

#### Scenario: Audio-rate modulation remains a linear dot product
- **WHEN** a modulation-depth parameter's recursively computed normalized knob value is `0.75`
- **AND** the modulator value for the same voice is `0.8`
- **THEN** the modulation contribution from that route is `0.8 * 0.25` before final range clamping
- **AND** no exponential mapping is applied to the modulator value itself
