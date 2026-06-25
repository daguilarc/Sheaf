## Context

Sheaf does not currently have a C++ synthesizer project. The new `projects/synth`
project will start with a reusable parameter and modulation library that can be
used by later synth engines without binding audio-rate parameter reads to UI
state traversal.

The closest local precedent is The All Electric Smart Grid's encoder bank
system in `/Users/joyo/theallelectricsmartgrid/private/src/EncoderBank.hpp`,
`Encoder.hpp`, `EncoderBankBank.hpp`, and the gesture/fuzzer tests. Useful
patterns to keep are:

- manager-owned scene state and shared parameter state;
- group/mode-local modulator values and gesture values;
- scene values blended as `sceneA * (1 - blend) + sceneB * blend`;
- gesture cells that become active when a selected gesture receives an edit;
- gesture interpolation that blends between base and gesture values using
  active gesture weights;
- press-to-open modulation cells, a final cell to return, and shift-press reset;
- deterministic randomized tests with seed reporting.

Synth deliberately differs from Smart Grid in two structural ways. It has no
tracks, and voice data is per group. The audio-rate path still stays compact:
`Parameter::Get(voiceIx)` returns `currentCenter * currentCenterScale[voiceIx] +
dot(modulatorValues, currentModDepthsForVoice)`, with the center scale and depth
row already normalized by the control-rate Smart Grid-style weight rules.

## Goals / Non-Goals

**Goals:**

- Add `projects/synth` as a C++20 library/test project integrated into the repo
  Makefile.
- Define clear ownership for `ParameterManager`, `ParameterGroup`, `Parameter`,
  `Modulators`, `Gestures`, `Bank`, and `BankSlot`.
- Allocate parameters and their shaped subarrays upfront through group-owned
  allocators.
- Support dynamic group shapes: number of voices, modulators, gestures, scenes,
  and allocated parameters are runtime configuration values.
- Keep audio-rate `Get(voiceIx)` and `ProcessLite()` free of tree traversal,
  heap allocation, hash lookup, and virtual dispatch.
- Support slow control-rate `Compute()` that updates target center and target
  modulation depths, including nested modulation-depth parameters.
- Support scenes, selected gestures, gesture values, gesture active flags,
  pages, banks, slots, and routed physical encoder actions.
- Build deterministic randomized simulation tests with an independent oracle.

**Non-Goals:**

- No DSP oscillator/filter/envelope modules in this change.
- No serialization format beyond in-memory scene/gesture state required by the
  parameter system.
- No UI renderer, MIDI integration, or hardware driver.
- No tracks. Any Smart Grid behavior whose only purpose is track selection is
  intentionally omitted.
- No runtime growth during audio/control processing. Exhausting preallocation is
  reported as a creation failure, not handled by allocating in the hot path.

## Decisions

### Project and build shape

`projects/synth` will be a C++20 project with headers under `include/synth/`,
implementation under `src/`, and tests under `tests/`. The project Makefile
will expose `all`, `build`, `test`, and `clean`, and the root Makefile will add
`synth` and `synth-build`/`synth-test`/`synth-clean` targets.

Alternative considered: keep the first version header-only. That would shorten
the initial setup but tends to hide ownership and test boundaries. A small
library plus tests keeps compile units focused while still allowing inline hot
path methods where needed.

### Ownership graph

`ParameterManager` owns global scene/page state, all groups, all banks, all
slots, and the global parameter ID counter. `ParameterGroup` owns group config,
its `Modulators`, its `Gestures`, and its allocator. `Parameter` instances are
allocated from exactly one group allocator and hold a non-owning pointer back to
that group. Banks and slots never own parameters; they hold non-owning pointers
for UI/hardware routing.

Alternative considered: have the manager own one global arena for every
parameter. Group-local arenas are preferable because all parameters in a group
share the same shape, so per-parameter subarrays can be carved with predictable
stride and teardown is group-local.

### Parameter shape and allocation

A group config fixes the shape for all parameters created in that group:
`numVoices`, `numModulators`, `numGestures`, `numScenes`, `maxParams`, and
`processLiteAlpha`. Allocation creates the `Parameter` object plus these
subarrays:

- scene center values: `numScenes`;
- scene gesture values: `numScenes * numGestures`;
- scene gesture active flags: `numScenes * numGestures`;
- modulation-depth parameter pointers: `numModulators`, nullable;
- current center scales: `numVoices`;
- target center scales: `numVoices`;
- current modulation depths: `numVoices * numModulators`;
- target modulation depths: `numVoices * numModulators`.

All arrays are contiguous and addressed by explicit row-major index helpers.
No parameter object may be moved after creation because banks, slots, and
modulation routes hold stable pointers.

Alternative considered: use `std::vector` inside every `Parameter`. That is
simple but fragments allocation and makes it easy to accidentally allocate
during setup paths. A group allocator makes the contract visible.

### Modulator values

`Modulators` stores current modulator values as one flat array laid out
voice-major then modulator-major:
`values[voiceIx * numModulators + modIx]`. This makes each voice's modulator
row contiguous for `Apply(voiceIx, depths)`.

Each modulator also has per-modulator metadata: name, short name if useful,
color, and connected flag. Metadata is not per voice. `Apply` performs only the
dot product of the current voice row and the supplied depth row. It does not
inspect parameters, scenes, gestures, banks, or slots.

Alternative considered: modulator-major layout. That can be good when updating
one modulator across all voices, but `Parameter::Get(voiceIx)` needs one
parameter's voice-local dot product in the audio loop. Voice-major layout keeps
the read path tight.

### Gestures and scene computation

`Gestures` stores global gesture values, selection flags, and metadata. Gesture
values are not per voice. A `Parameter` stores scene-owned center values and,
for every scene/gesture pair, a gesture value plus an active flag.

At control rate, `Parameter::Compute()` calculates a raw center using the Smart
Grid-inspired formula mapped to no-track data:

1. `base = sceneCenter[leftScene] * (1 - blend) + sceneCenter[rightScene] * blend`.
2. For each gesture `g`, compute a blended gesture value from the parameter's
   scene gesture values.
3. For each gesture `g`, compute an effective weight from the group gesture
   value only where that gesture is active in the blended scenes.
4. If no gesture weight is active, raw center is `base`.
5. Otherwise raw center is the weighted average of each per-gesture mix:
   `mix_g = base * (1 - weight_g) + gestureValue_g * weight_g`.

`HandleIncDec(delta)` uses the same distribution as Smart Grid, with tracks
removed. If no selected gesture has active weight, it increments the current
scene value(s). If selected gestures exist, it activates each selected gesture
for the active scene(s), snapshots the parent scene value into newly activated
gesture values, and distributes the edit between selected gesture values and
base scene values using the current effective gesture weights.

Alternative considered: make gestures pure offsets from the base. Absolute
gesture values match Smart Grid better and make "activate gesture by touching a
selected encoder" predictable because activation can copy the parent value.

### Smart Grid-style modulation normalization

Synth keeps the hot path as `Get(voiceIx) = currentCenter *
currentCenterScale[voiceIx] + Modulators::Apply(voiceIx,
currentDepthsForVoice)`, and `Compute()` prepares the center scale and the
depth rows using the same normalization shape as Smart Grid's modulator mix:

- Compute the raw scene/gesture center once.
- For each voice, recursively compute each non-null modulation-depth parameter
  and read that parameter's depth value with `Get(voiceIx)`.
- Sum that voice's modulation weights.
- If the sum is less than `1`, set that voice's target center scale to
  `1 - sum` and leave target depths unchanged.
- If the sum is greater than or equal to `1`, set that voice's target center
  scale to `0` and divide the target depth row by the sum.

The result matches the Smart Grid range-preservation rule: center contribution
plus modulation contribution always spans the parameter range rather than
growing beyond it. The scalar `targetCenter` remains the unmodulated
scene/gesture value; the per-voice center scale carries the voice-specific
normalization.

Modulation depths are signed normalized values, so inverse modulation is
supported. The Smart Grid weight sum uses `abs(depth)` for range accounting and
the signed depth is preserved in the audio-rate dot product.

Alternative considered: normalize by a separate configured depth limit. That
does not match Smart Grid and makes the effective modulation range a separate
configuration concept. The Smart Grid rule is better here because it derives
the range from the parameter itself.

### Control-rate compute and sample-rate process

`Parameter::Compute()` is slow/control-rate work. It may walk nullable
modulation-depth parameters, recurse through nested depth routes, read scene and
gesture state, normalize values, and update targets. Parameters carry a
`depth` field that represents recursion depth in the modulation graph. When
`depth > 0`, `Compute()` writes current center/depth values directly to target
values, so nested modulation-depth parameters do not slew themselves. The
top-level parameter's `ProcessLite()` then slews the audible effect of those
target changes at sample rate.

`ProcessLite()` applies one-pole EMA slew with the group alpha:
`current += alpha * (target - current)` for the scalar center, every per-voice
center scale, and every voice/modulator depth. It performs no allocation and no
graph traversal.

Alternative considered: slew every nested parameter independently. That is more
general but makes fast modulation of modulation depth expensive and harder to
reason about. Sampling nested routes at control rate is an intentional trade-off.

### Pages, banks, slots, and routing

Pages are manager-level UI groupings with ordinals and one active page. A
parameter can be assigned to zero or more pages. Active page selection affects
UI routing only; it does not affect audio values or scene data.

Banks group parameter pointers for physical controls. Each bank declares the
physical encoder IDs it owns and should be mutually exclusive with other banks
assigned to the same slot. A `BankSlot` owns one currently selected bank and
the physical encoder IDs it can route. Selecting a bank deselects any modulation
view currently open in the previous bank and populates the selected bank.

`Bank::HandlePress(encoderId)` opens the pressed parameter's modulation-depth
view by materializing its modulation-depth parameter pointers and populating the
slot-visible bank with those modulators; the selected top-level parameter is
placed in the final cell as the return cell. Pressing a modulator opens that
modulator parameter's modulation view. Pressing the return cell restores the
top-level bank. `HandleShiftPress` reverts the pressed parameter to default.
Manager and slot methods provide routed versions of press, shift-press, and
tick/inc-dec events.

Alternative considered: let pages own physical routing. Banks and slots are the
cleaner split: pages describe UI sets, banks describe hardware mappings, and
slots describe physical encoder routing.

### Testing strategy

Unit tests cover each contract directly: allocation shape, scene interpolation,
gesture activation and edit distribution, modulator apply layout, Smart
Grid-style modulation normalization, process-lite slew, bank/slot routing, and
reset behavior.

A randomized simulation test builds a small manager with multiple groups,
voices, scenes, gestures, pages, banks, and slots. Each step chooses an action:
turn encoder, press encoder, shift press, select/deselect gesture, change
gesture value, change page, select bank, change scene, change blend, update a
modulator value, run compute, or run process-lite. An independent oracle stores
expected scene/gesture/bank/page state and recomputes expected parameter values
without using the implementation's indexing helpers or compute functions.
Failures report seed, step, action, target IDs, and mismatched fields.

Alternative considered: only example-based tests. This system has too many
interacting state transitions for examples alone; randomized model testing is
part of the required design, not a stretch goal.

## Risks / Trade-offs

- The Smart Grid weight rule introduces voice-dependent center scaling when
  modulation weights differ by voice -> Store the needed center scale explicitly
  as a per-voice runtime row.
- Recursive modulation-depth routes can form cycles -> Creation or route
  assignment must reject cycles or compute must cap recursion and report an
  error; tests should cover both direct and indirect cycles.
- Group-local preallocation may be exhausted -> Creation APIs return failure
  with no partial parameter registration, and tests cover exhaustion.
- Randomized tests can become flaky or slow -> Use deterministic seeds and
  bounded default steps, with an opt-in stress seed count for local runs.
- Smart Grid scene editing attenuates mid-blend deltas when neither scene value
  saturates -> Document this as intentional compatibility behavior and cover it
  in the oracle tests.

## Migration Plan

This is a new project and has no runtime migration. Implementation should add
`projects/synth`, wire it into the root Makefile, and add the new tests. Rollback
is removing `projects/synth` and the Makefile entries before any downstream
project depends on it.

## Open Questions

- None. The first implementation should use Smart Grid-style modulation weight
  normalization so modulation always stays in the parameter range.
