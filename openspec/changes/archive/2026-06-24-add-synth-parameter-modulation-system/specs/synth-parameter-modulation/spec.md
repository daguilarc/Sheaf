## ADDED Requirements

### Requirement: spm-1 — Project: C++ synth library
WHEN the synth parameter modulation capability is implemented, THE repository SHALL contain a `projects/synth` C++20 project with library sources, public headers, a project Makefile exposing `all`, `build`, `test`, and `clean`, and root Makefile targets that include `synth` in normal project build and test flows.

#### Scenario: Project builds through root Makefile
- **WHEN** a developer runs the root `make synth-build`
- **THEN** the synth library builds from `projects/synth`

#### Scenario: Project tests through root Makefile
- **WHEN** a developer runs the root `make synth-test`
- **THEN** the synth parameter modulation test suite runs from `projects/synth`

### Requirement: spm-2 — Ownership: manager, groups, parameters, banks, and slots
WHEN constructing the synth parameter system, THE system SHALL use a single `ParameterManager` to own global scene state, page state, parameter groups, banks, slots, and the global parameter ID space; each `ParameterGroup` SHALL own its config, `Modulators`, `Gestures`, and allocator; each `Parameter` SHALL be allocated by exactly one group and hold a non-owning pointer to that group; banks and slots SHALL hold non-owning parameter pointers only.

#### Scenario: Parameter receives globally unique ID
- **WHEN** parameters are created across multiple groups
- **THEN** the manager assigns each parameter a unique global ID

#### Scenario: Bank does not own parameter lifetime
- **WHEN** a bank is populated with parameters from one or more groups
- **THEN** destroying or deselecting the bank does not destroy those parameters

### Requirement: spm-3 — Pages: assignment and active UI page
WHEN parameters are assigned to pages, THE manager SHALL maintain page ordinals within the manager, allow each parameter to be assigned to zero or more pages, and expose exactly one active page for UI routing without changing parameter audio values, scene values, gesture values, or modulation routes.

#### Scenario: Active page changes routing only
- **WHEN** the active page changes
- **THEN** subsequent routed UI actions target the new page mapping
- **AND** existing parameter center, depth, scene, gesture, and modulator values remain unchanged

### Requirement: spm-4 — Group config: dynamic shape and upfront allocation
WHEN a `ParameterGroup` is configured, THE group SHALL use runtime configuration for voice count, modulator count, gesture count, scene count, maximum parameter count, and process-lite alpha, and SHALL allocate parameter objects and per-parameter subarrays upfront through a group-owned allocator with no heap allocation during `Compute`, `ProcessLite`, `Get`, routed press, routed shift-press, or routed tick handling.

#### Scenario: Same-shaped group parameters
- **WHEN** two parameters are created in the same group
- **THEN** both parameters have subarrays sized from the same group shape

#### Scenario: Allocation exhaustion
- **WHEN** creating a parameter would exceed the group allocator capacity
- **THEN** creation fails without registering a partial parameter in the manager or any bank

### Requirement: spm-5 — Modulators: flat per-voice values and metadata
WHEN a group owns modulators, THE `Modulators` struct SHALL store current modulator values in one flat row-major array indexed as `voiceIx * numModulators + modulatorIx`, store per-modulator metadata including name, color, and connected flag, and provide an `Apply(voiceIx, depths)` function that returns only the dot product of that voice's modulator row and the supplied depth row.

#### Scenario: Apply computes a voice-local dot product
- **WHEN** a group has `numModulators = 3`, voice 2 values `[0.25, -0.5, 1.0]`, and supplied depths `[0.4, 0.2, -0.1]`
- **THEN** `Apply(2, depths)` returns `(0.25 * 0.4) + (-0.5 * 0.2) + (1.0 * -0.1)`

#### Scenario: Metadata is not per voice
- **WHEN** a modulator name or color is changed
- **THEN** the changed metadata applies to that modulator for every voice

### Requirement: spm-6 — Gestures: values, selection, metadata, and active flags
WHEN a group owns gestures, THE `Gestures` struct SHALL store global gesture values, selected flags, and per-gesture metadata, while each parameter SHALL store per-scene/per-gesture gesture values and active flags; gesture values and active flags SHALL NOT be stored per voice.

#### Scenario: Gesture selection is global to group
- **WHEN** gesture 1 is selected for a group
- **THEN** all parameters in the group observe gesture 1 as selected for edit routing

#### Scenario: Parameter gesture state is per scene
- **WHEN** a gesture is active for scene 0 on one parameter
- **THEN** the same gesture can remain inactive for scene 1 and for other parameters

### Requirement: spm-7 — Parameter data: metadata, scene state, modulation routes, and runtime state
WHEN a `Parameter` is created, THE parameter SHALL store name, short name, global ID, recursion depth, default normalized value, bipolar flag, group pointer, current center value, target center value, current center scale for each voice, target center scale for each voice, current modulation depths for each voice/modulator pair, target modulation depths for each voice/modulator pair, nullable modulation-depth parameter pointers for each modulator, scene center values, and per-scene/per-gesture gesture values and active flags.

#### Scenario: Default parameter state
- **WHEN** a parameter is created with default value `0.3`
- **THEN** its scene center values, current center, and target center are initialized to `0.3`
- **AND** its current and target center scales are initialized to `1.0`
- **AND** its modulation-depth pointers are null
- **AND** its current and target modulation depths are zero

### Requirement: spm-8 — Compute: scene and gesture interpolation
WHEN `Parameter::Compute()` calculates a target center, THE parameter SHALL first compute the base scene value as `sceneCenter[leftScene] * (1 - blend) + sceneCenter[rightScene] * blend`; SHALL compute each gesture's blended gesture value from the parameter's scene gesture values; SHALL compute each gesture's effective weight from the group gesture value where that gesture is active in the blended scenes; SHALL use the base scene value when no effective gesture weight is active; and SHALL otherwise use the weighted average of `base * (1 - weight) + gestureValue * weight` across active gestures.

#### Scenario: Scene blend without active gestures
- **WHEN** left scene center is `0.2`, right scene center is `0.8`, blend is `0.25`, and no gesture has effective weight
- **THEN** the raw target center is `0.35`

#### Scenario: Active gesture blends from base to gesture value
- **WHEN** base is `0.4`, one gesture has blended gesture value `0.9`, and its effective weight is `0.5`
- **THEN** the raw target center is `0.65`

### Requirement: spm-9 — Compute: nested modulation depth routes and normalization
WHEN `Parameter::Compute()` updates modulation targets, THE parameter SHALL call `Compute()` on each non-null modulation-depth parameter before reading that depth parameter with `Get(voiceIx)` for each voice, SHALL derive signed normalized target modulation depths from those returned depth values, SHALL clamp or normalize the target center to the parameter's normalized range, SHALL compute each voice's modulation weight sum from the absolute values in that voice's target depth row, SHALL set that voice's target center scale to `1 - sum` when the sum is less than `1`, and SHALL set that voice's target center scale to `0` and divide that voice's target depth row by the sum when the sum is greater than or equal to `1`.

#### Scenario: Non-null depth parameter is computed first
- **WHEN** a parameter has modulator 2 assigned to a depth parameter
- **THEN** `Compute()` calls the depth parameter's `Compute()` before reading the depth parameter with `Get(voiceIx)` for modulator 2

#### Scenario: Weight sum below one preserves center contribution
- **WHEN** a voice target depth row contains signed depth values whose absolute values sum to `0.25`
- **THEN** the parameter sets that voice's target center scale to `0.75`
- **AND** leaves that voice's target depth row unchanged

#### Scenario: Weight sum at or above one normalizes depths
- **WHEN** a voice target depth row contains signed depth values whose absolute values sum to `2.0`
- **THEN** the parameter sets that voice's target center scale to `0`
- **AND** divides that voice's target depth row by `2.0`

### Requirement: spm-10 — Compute: nested route slew bypass
WHEN a parameter's recursion depth is greater than zero, THE parameter SHALL set its current center, current center scales, and current modulation depths directly to the computed target values during `Compute()` instead of waiting for its own `ProcessLite()` slew.

#### Scenario: Depth parameter updates immediately
- **WHEN** a modulation-depth parameter with recursion depth `1` computes a new target depth value
- **THEN** reading that parameter in the same control-rate pass returns the newly computed value

### Requirement: spm-11 — Audio path: Get and ProcessLite
WHEN the audio engine reads a parameter, THE parameter's `Get(voiceIx)` SHALL return the clamped normalized value `currentCenter * currentCenterScale[voiceIx] + group.modulators.Apply(voiceIx, currentDepthsForVoice)` without traversing manager, page, bank, slot, scene, gesture, or modulation route state; and `ProcessLite()` SHALL advance current center, current center scales, and current modulation depths toward targets using the one-pole formula `current += alpha * (target - current)` with the owning group's configured alpha.

#### Scenario: Get uses current state only
- **WHEN** `Get(0)` is called after `Compute()` and `ProcessLite()`
- **THEN** it uses only the parameter's current center, current center scale for voice 0, the current depth row for voice 0, and the group's current modulator row for voice 0

#### Scenario: ProcessLite slews center
- **WHEN** current center is `0.0`, target center is `1.0`, and alpha is `0.25`
- **THEN** one `ProcessLite()` call sets current center to `0.25`

#### Scenario: ProcessLite slews center scale
- **WHEN** current center scale for voice 0 is `1.0`, target center scale for voice 0 is `0.5`, and alpha is `0.25`
- **THEN** one `ProcessLite()` call sets current center scale for voice 0 to `0.875`

### Requirement: spm-12 — Edits: HandleIncDec scene and gesture distribution
WHEN `Parameter::HandleIncDec(delta)` is called, THE parameter SHALL apply the delta to the active scene center value when blend is at one scene endpoint, SHALL distribute the delta across the two active scene center values when blend is between scenes using the Smart Grid scene distribution formula, SHALL activate selected gestures for active scenes before editing gesture values, SHALL snapshot the parent scene value into a newly activated gesture value, and SHALL distribute the delta between active selected gesture values and base scene values according to effective gesture weights.

#### Scenario: Endpoint scene edit
- **WHEN** blend is `0`, left scene is active, and `HandleIncDec(0.1)` is called
- **THEN** only the left scene center value is incremented and clamped to the parameter range

#### Scenario: Selected gesture activation
- **WHEN** a selected gesture is inactive for the current scene and `HandleIncDec(delta)` is called
- **THEN** the gesture becomes active for that scene before the edit is applied
- **AND** its gesture value starts from the current parent scene value

### Requirement: spm-13 — Revert: defaults and modulation clearing
WHEN a parameter is reverted to default for the current scene selection, THE parameter SHALL clear all modulation-depth parameter assignments, zero current and target modulation depth arrays, set applicable scene center values to the default normalized value, set applicable scene gesture active flags to false, and update current/target center consistently with the owning group's slew and recursion-depth rules.

#### Scenario: Shift reset clears modulation
- **WHEN** a routed shift-press resets a parameter
- **THEN** the parameter has no non-null modulation-depth parameter pointers
- **AND** `Get(voiceIx)` returns the default-centered value after compute/process settling with zero modulators

### Requirement: spm-14 — Banks and slots: physical control mapping
WHEN banks and bank slots are configured, THE system SHALL allow each bank to list parameter pointers and physical encoder IDs, allow banks to include parameters from different groups, allow each slot to select one bank at a time, and require slot bank selection to deselect any modulation view open on the previously selected bank before showing the newly selected bank.

#### Scenario: Mixed-group bank
- **WHEN** a bank contains parameters from two groups
- **THEN** routed encoder actions dispatch to each parameter through its own owning group

#### Scenario: Slot bank switch deselects prior view
- **WHEN** a slot selects a new bank while the previous bank is showing a modulation-depth view
- **THEN** the previous bank returns to its top-level parameter view before the new bank is selected

### Requirement: spm-15 — Banks and slots: press, shift-press, and tick routing
WHEN a bank handles a press on a mapped physical encoder, THE bank SHALL populate the pressed parameter's visible modulation-depth cells from its modulation-depth parameter array, SHALL materialize missing modulation-depth parameters as bipolar default-zero parameters when group capacity allows, and SHALL place the selected top-level parameter in the final visible cell as the return cell. If the bank has fewer visible cells than `numModulators + 1`, THE bank SHALL reserve the final available visible cell for the return cell and show only the depth cells that fit before it. Pressing a modulation cell SHALL open that modulation parameter's modulation view; pressing the return cell SHALL restore the top-level bank; tick and shift-press on the return cell SHALL be ignored; shift-press SHALL revert the pressed non-return parameter to default; and routed manager/slot APIs SHALL dispatch press, shift-press, and tick/inc-dec events by physical encoder ID to the selected bank.

#### Scenario: Press opens modulation view
- **WHEN** a bank is showing top-level parameters and the user presses a parameter encoder
- **THEN** the bank shows that parameter's modulation-depth cells plus the selected parameter as the final return cell

#### Scenario: Undersized bank reserves return
- **WHEN** a bank has fewer visible cells than the pressed parameter's modulation-depth cells plus a return cell
- **THEN** the final visible cell is the return cell
- **AND** excess modulation-depth cells are omitted from that view

#### Scenario: Return cell closes modulation view
- **WHEN** a bank is showing modulation-depth cells and the user presses the return cell
- **THEN** the bank restores the top-level parameter mapping

#### Scenario: Tick routes to selected bank
- **WHEN** the manager receives a tick for a physical encoder ID owned by a slot's selected bank
- **THEN** the manager routes the delta through the slot and bank to the mapped parameter's `HandleIncDec`

### Requirement: spm-16 — Gesture API: external selection and values
WHEN external code controls gestures, THE parameter manager or group API SHALL expose functions to select and deselect gestures, set gesture values, read gesture selected state, read gesture values, and clear a gesture's active flags across parameters for the active scene selection.

#### Scenario: External select gesture
- **WHEN** external code selects gesture 3
- **THEN** subsequent parameter edits in the group treat gesture 3 as selected

#### Scenario: External change gesture value
- **WHEN** external code sets gesture 3 value to `0.75`
- **THEN** the next control-rate `Compute()` uses `0.75` as gesture 3's weight where that gesture is active

### Requirement: spm-17 — Graph safety: cycles and invalid indices
WHEN assigning modulation-depth parameters or routing physical controls, THE system SHALL reject direct and indirect modulation cycles, out-of-range voice indices, out-of-range modulator indices, out-of-range gesture indices, out-of-range scene indices, and unmapped physical encoder IDs without corrupting existing state.

#### Scenario: Direct cycle rejected
- **WHEN** parameter A is assigned as its own modulation-depth parameter
- **THEN** the assignment fails and A's existing modulation routes remain unchanged

#### Scenario: Unmapped physical encoder ignored
- **WHEN** the manager receives a routed press or tick for a physical encoder ID that no selected slot owns
- **THEN** the event is ignored without changing parameter state

### Requirement: spm-18 — Tests: deterministic randomized simulation oracle
WHEN automated tests cover the synth parameter modulation system, THE test suite SHALL include deterministic randomized simulation tests that repeatedly choose actions from encoder turns, encoder presses, shift presses, gesture select/deselect, gesture value changes, page changes, bank selection, scene changes, blend changes, modulator value changes, compute, and process-lite, and SHALL verify after each action against an independent oracle rather than duplicating implementation internals.

#### Scenario: Random action loop checks invariants
- **WHEN** a randomized simulation test runs one seed
- **THEN** every action is followed by checks for expected page, bank, slot, scene, gesture, parameter, modulation-route, target, current, and `Get(voiceIx)` state

#### Scenario: Failure is reproducible
- **WHEN** the randomized simulation detects a mismatch
- **THEN** the failure output includes seed, step number, action, affected parameter or physical encoder ID, and the mismatched expected and actual values

#### Scenario: Default and stress modes
- **WHEN** the normal synth test suite runs
- **THEN** randomized tests use a bounded fixed seed set suitable for routine automation
- **AND** the test binary provides an opt-in way to run larger seed and step counts locally

## Contracts

### Normalized ranges

Unipolar parameter centers are clamped to `[0, 1]`. Bipolar parameter centers
are clamped to `[-1, 1]`. Modulation depths are signed normalized values.
Modulation depth weights use absolute value for Smart Grid range accounting
while preserving the signed depth for the audio-rate dot product.

### Modulation normalization

For a parameter voice, `rawDepth[m]` is the recursively computed signed depth
for modulator `m`, read by calling the depth parameter's `Get(voiceIx)` after
that depth parameter has computed. `weight(rawDepth[m]) = abs(rawDepth[m])`.

```text
sum = sum(weight(rawDepth[m]))

if sum < 1:
  targetCenterScale[voice] = 1 - sum
  targetDepth[voice][m] = rawDepth[m]
else:
  targetCenterScale[voice] = 0
  targetDepth[voice][m] = rawDepth[m] / sum

Get(voice) =
  clamp(currentCenter * currentCenterScale[voice] +
        dot(modulatorValues[voice], currentDepths[voice]))
```

### Scene blend

For a manager state `(leftScene, rightScene, blend)`, with `blend` clamped to
`[0, 1]`:

```text
Blend(sceneValues) =
  sceneValues[leftScene] * (1 - blend) +
  sceneValues[rightScene] * blend
```

### Gesture target center

For a parameter:

```text
base = Blend(sceneCenter)
gestureValue[g] = Blend(parameterGestureValues[g])
weight[g] =
  (active[leftScene][g] ? groupGestureValue[g] : 0) * (1 - blend) +
  (active[rightScene][g] ? groupGestureValue[g] : 0) * blend

if sum(weight[g]) == 0:
  rawCenter = base
else:
  rawCenter =
    sum(weight[g] * (base * (1 - weight[g]) + gestureValue[g] * weight[g])) /
    sum(weight[g])
```

### Smart Grid scene edit distribution without tracks

For a delta applied to center values, Synth SHALL match Smart Grid's
`StateEncoderCell::IncrementInternal` scene distribution with tracks removed.
At intermediate blend values, when neither proposed scene value saturates, the
two scene values are moved by `delta * (1 - blend)` and `delta * blend`; the
resulting blended value therefore moves by `delta * ((1 - blend)^2 + blend^2)`.
The `targetBlended` value is used only to solve the opposite scene value when a
proposed endpoint saturates.

```text
if blend <= 0:
  leftSceneValue = clamp(leftSceneValue + delta)
else if blend >= 1:
  rightSceneValue = clamp(rightSceneValue + delta)
else:
  targetBlended = clamp(Blend(sceneCenter) + delta)
  proposedLeft = leftSceneValue + delta * (1 - blend)
  proposedRight = rightSceneValue + delta * blend
  if proposedLeft is outside range:
    leftSceneValue = clamp(proposedLeft)
    rightSceneValue = (targetBlended - leftSceneValue * (1 - blend)) / blend
  else if proposedRight is outside range:
    rightSceneValue = clamp(proposedRight)
    leftSceneValue = (targetBlended - rightSceneValue * blend) / (1 - blend)
  else:
    leftSceneValue = proposedLeft
    rightSceneValue = proposedRight
```

The solved opposite scene value in the saturation branches SHALL NOT be
re-clamped after solving; this preserves Smart Grid compatibility.

Gesture edit distribution uses the same scene distribution against the selected
gesture values after activation, with the remaining edit applied to base scene
values according to effective gesture weights.
