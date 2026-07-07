## MODIFIED Requirements

### Requirement: spm-4 — Group config: dynamic shape and upfront allocation
WHEN a `ParameterGroup` is configured, THE group SHALL use runtime configuration for voice count, modulator count, scene count, maximum parameter count, process-lite alpha, target compute interval in samples, UI display-center alpha, UI display-spread alpha, and an optional voice indicator color palette; the target compute interval SHALL default to 16 samples and SHALL be positive; SHALL NOT accept an independent gesture count in group configuration; SHALL size parameter per-scene/per-gesture arrays from the owning manager's gesture count injected by `ParameterManager::CreateGroup`; SHALL allocate per-parameter subarrays upfront through a group-owned allocator; and SHALL perform no heap allocation during `Compute`, per-sample parameter processing, `ProcessLite`, `GetRaw`, cached knob reads, routed reset-modifier press, routed random-modifier press, routed tick handling, or routed unmodified press handling after any needed modulation-depth parameters for that view have already been materialized. Routed unmodified press and random-mod modifier operations MAY lazily materialize missing modulation-depth parameter objects from preconfigured group capacity.

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

#### Scenario: Default target compute interval is 16 samples
- **WHEN** a group is created without overriding its target compute interval
- **THEN** the group configuration reports a target compute interval of 16 samples

#### Scenario: Target compute interval must be positive
- **WHEN** a group is configured with target compute interval `0`
- **THEN** group creation rejects the configuration

### Requirement: spm-11 — Audio path: Get and ProcessLite
WHEN the audio engine samples a parameter, THE synth parameter modulation system SHALL provide `Parameter::GetRaw(voiceIx)` as the explicit raw normalized read path that returns the clamped value `currentCenter * currentCenterScale[voiceIx] + currentNormalizationOffset[voiceIx] + group.modulators.Apply(voiceIx, currentDepthsForVoice)` without traversing manager, page, bank, slot, scene, gesture, or modulation route state; `ProcessLite()` SHALL advance current center, current center scales, current normalization offsets, current min/max values, and current modulation depths toward targets using the one-pole formula `current += alpha * (target - current)` with the owning group's configured alpha, then SHALL sample and store each voice's current cached knob value from `GetRaw(voiceIx)`; and per-sample parameter processing SHALL recompute targets from the owning manager's current scene when `sampleIndex % group.Config().targetComputeIntervalSamples == 0` before running `ProcessLite()`.

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
