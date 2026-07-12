## MODIFIED Requirements

### Requirement: spm-4 — Group config: dynamic shape and upfront allocation
WHEN a `ParameterGroup` is configured, THE group SHALL use runtime configuration for voice count, modulator count, scene count, maximum parameter count, process-lite alpha, target-center alpha, target compute interval in samples, UI display-center alpha, UI display-spread alpha, and an optional voice indicator color palette; the target-center alpha SHALL default to a 50 Hz-style one-pole alpha at the default target-compute cadence; the target compute interval SHALL default to 16 samples and SHALL be positive; process-lite alpha, target-center alpha, UI display-center alpha, and UI display-spread alpha SHALL be in `[0, 1]`; SHALL NOT accept an independent gesture count in group configuration; SHALL size parameter per-scene/per-gesture arrays from the owning manager's gesture count injected by `ParameterManager::CreateGroup`; SHALL allocate per-parameter subarrays upfront through a group-owned allocator; and SHALL perform no heap allocation during `Compute`, per-sample parameter processing, `ProcessLite`, `GetRaw`, cached knob reads, routed reset-modifier press, routed random-modifier press, routed tick handling, or routed unmodified press handling after any needed modulation-depth parameters for that view have already been materialized. Routed unmodified press and random-mod modifier operations MAY lazily materialize missing modulation-depth parameter objects from preconfigured group capacity.

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

#### Scenario: Default target center alpha is configured
- **WHEN** a group is created without overriding its target-center alpha
- **THEN** the group configuration reports the default target-center alpha

#### Scenario: Target center alpha must be normalized
- **WHEN** a group is configured with target-center alpha less than `0` or greater than `1`
- **THEN** group creation rejects the configuration

#### Scenario: Default target compute interval is 16 samples
- **WHEN** a group is created without overriding its target compute interval
- **THEN** the group configuration reports a target compute interval of 16 samples

#### Scenario: Target compute interval must be positive
- **WHEN** a group is configured with target compute interval `0`
- **THEN** group creation rejects the configuration

### Requirement: spm-8 — Compute: scene, gesture interpolation, and target-center smoothing
WHEN `Parameter::Compute()` calculates target state, THE parameter SHALL first compute the raw center as `sceneCenter[leftScene] * (1 - blend) + sceneCenter[rightScene] * blend`; SHALL compute each gesture's blended gesture value from the parameter's scene gesture values; SHALL compute each gesture's effective weight from the manager-owned gesture value where that gesture is active in the blended scenes; SHALL use the base scene value as the raw center when no effective gesture weight is active; SHALL otherwise use the weighted average of `base * (1 - weight) + gestureValue * weight` across active gestures as the raw center; SHALL slew a top-level parameter's `targetCenter` toward the raw center using the owning group's target-center alpha and the one-pole formula `targetCenter += alpha * (rawCenter - targetCenter)`; and SHALL keep recursive modulation-depth computations assigning `targetCenter` from the raw center before snapping current state to target for parent consumption.

#### Scenario: Scene blend without active gestures
- **WHEN** left scene center is `0.2`, right scene center is `0.8`, blend is `0.25`, and no gesture has effective weight
- **THEN** the raw computed center is `0.35`

#### Scenario: Active gesture blends from base to gesture value
- **WHEN** base is `0.4`, one gesture has blended gesture value `0.9`, and its manager-owned effective weight is `0.5`
- **THEN** the raw computed center is `0.65`

#### Scenario: Cross-group parameters use the same gesture weight
- **WHEN** two parameters in different groups have gesture 1 active
- **AND** the manager-owned gesture 1 value is `0.5`
- **THEN** both parameters compute gesture 1's effective weight from the same manager-owned value

#### Scenario: Top-level compute slews target center
- **WHEN** a top-level parameter has target center `0.0`, raw computed center `1.0`, and group target-center alpha `0.25`
- **THEN** one `Compute()` call sets target center to `0.25`

#### Scenario: Target center alpha one snaps top-level target center
- **WHEN** a top-level parameter has target center `0.0`, raw computed center `1.0`, and group target-center alpha `1.0`
- **THEN** one `Compute()` call sets target center to `1.0`

#### Scenario: Recursive modulation-depth compute remains immediate
- **WHEN** a modulation-depth parameter is computed recursively for a parent parameter
- **THEN** the modulation-depth parameter assigns its target center from the raw computed center for that recursive compute
- **AND** the modulation-depth parameter snaps current center, center scales, normalization offsets, min/max values, and modulation depths to target before the parent reads the depth value

### Requirement: spm-11 — Audio path: Get and ProcessLite
WHEN the audio engine samples a parameter, THE synth parameter modulation system SHALL provide `Parameter::GetRaw(voiceIx)` as the explicit raw normalized read path that returns the clamped value `currentCenter * currentCenterScale[voiceIx] + currentNormalizationOffset[voiceIx] + group.modulators.Apply(voiceIx, currentDepthsForVoice)` without traversing manager, page, bank, slot, scene, gesture, or modulation route state; `ProcessLite()` SHALL advance current center, current center scales, current normalization offsets, current min/max values, and current modulation depths toward targets using the one-pole formula `current += alpha * (target - current)` with the owning group's configured process-lite alpha, then SHALL sample and store each voice's current cached knob value from `GetRaw(voiceIx)`; and per-sample parameter processing SHALL recompute target state from the owning manager's current scene when `sampleIndex % group.Config().targetComputeIntervalSamples == 0` before running `ProcessLite()`, including target-center smoothing for top-level parameters.

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
- **THEN** each voice's cached knob value is seeded from `GetRaw(voiceIx)`
- **AND** each voice's UI display center is seeded to that cached knob value
- **AND** each voice's UI display spread energy is seeded to `0`
