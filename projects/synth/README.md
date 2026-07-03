# Synth

`projects/synth` contains the synth-side C++ utilities for the parameter and
modulation system.

The parameter/modulation library owns normalized parameter state, scene and
gesture interpolation, per-voice modulation values, per-voice modulation depths,
and physical-control routing helpers. It does not own oscillator/filter DSP,
MIDI or hardware drivers, UI rendering, patch serialization, or audio-device
I/O.

The audio-rate read path is designed to stay compact:

```text
Get(voice) =
  clamp(currentCenter * currentCenterScale[voice]
        + currentNormalizationOffset[voice]
        + dot(modulatorValues[voice], currentDepths[voice]))
```

Modulation follows the Smart Grid-style range-preserving weight rule. A
modulation depth is a signed normalized value. For range accounting, the weight
is `abs(depth)`; for audio-rate modulation, the signed depth remains in the dot
product.

```text
sum = sum(abs(rawDepth[m]))

centerScale[voice] = max(0, 1 - sum)

if sum > 1:
  depth[voice][m] = rawDepth[m] / sum
else:
  depth[voice][m] = rawDepth[m]

normalizationOffset[voice] = -sum(min(0, depth[voice][m]))

if sum > 1:
  minValue[voice] = rangeMin
  maxValue[voice] = 1
else:
  base = center * centerScale[voice] + normalizationOffset[voice]
  minValue[voice] = clamp(base + sum(min(0, depth[voice][m])))
  maxValue[voice] = clamp(base + sum(max(0, depth[voice][m])))
```

`ProcessLite` slews center scale, normalization offset, depths, and min/max
values. Parameter UI state publishes the slewed current min/max values for the
encoder range arcs.

The minimal initial API includes range clamping:

```text
ClampToRange(value, Unipolar) -> clamp(value, 0, 1)
ClampToRange(value, Bipolar)   -> clamp(value, -1, 1)
```

Scene and gesture compute happens at control rate. First compute the blended
scene center:

```text
blend = clamp(scene.blend, 0, 1)
base = sceneCenter[left] * (1 - blend) + sceneCenter[right] * blend
```

Each active gesture contributes an effective weight based on whether it is
active in the blended scenes:

```text
effectiveWeight[g] =
  (active[left][g]  ? gestureWeight[g] * (1 - blend) : 0)
  + (active[right][g] ? gestureWeight[g] * blend       : 0)

gestureValue[g] =
  value[left][g] * (1 - blend) + value[right][g] * blend

mix[g] = base * (1 - effectiveWeight[g])
         + gestureValue[g] * effectiveWeight[g]

rawCenter =
  sum(effectiveWeight[g] * mix[g]) / sum(effectiveWeight[g])
```

If no gestures are active, `rawCenter = base`.

Encoder deltas use the Smart Grid scene distribution rule without tracks. At an
endpoint, the active scene is clamped after adding the full delta. In a blended
scene, the proposed edits are:

```text
targetBlended = clamp(base + delta)
left' = left + delta * (1 - blend)
right' = right + delta * blend
```

If neither proposal exceeds the parameter range, both proposals are used. If one
side saturates, that side is clamped and the opposite side is solved so the
audible blended value reaches `targetBlended`.

Banks map physical encoders to parameters. Pressing a mapped parameter opens a
modulation-depth view; missing depth parameters are materialized as bipolar
parameters with default `0` when group capacity allows. The final visible bank
cell is the selected target parameter, so an undersized bank shows as many depth
cells as fit before the target. While the modulation view is open, the owning
bank treats pressing that target cell as close-view navigation; tick and
reset-press continue to route to the visible target parameter normally.

The randomized simulation test runs bounded default seeds during
`make synth-test`. Larger runs can be requested with:

```text
SYNTH_RANDOM_SEEDS=0x51A7,0xC0FFEE SYNTH_RANDOM_STEPS=5000 make synth-test
```

## External UI State And Messages

The external control layer mirrors the parameter tree with caller-owned UI
state populated once per frame. UI-state structs contain atomics and are sized
up front through `ParameterManager::CreateUIState()`; `PopulateUIState` only
stores into existing memory.

`Parameter::UIState` reports:

- connected state, bipolar flag, color, and stable short name pointer;
- per-voice value, min/max range, and indicator color.

Disconnected slot positions are represented by `connected=false` with neutral
values and off colors; parameter UI state does not encode page/navigation roles.

`BankSlot::UIState` exposes visible cells in `AddPhysicalEncoder` order and a
`showingModulationView` flag. `ParameterManager::UIState` includes slot state,
manager-owned gesture values/selection, scene endpoints/blend, and reset,
random, and random-modifier held state. Core synth code uses `synth::Color`;
JUCE color conversion is only for app/UI code (e.g.
`projects/synth/apps/miniapp/MiniApp.hpp`).

External actions are represented as timestamped `MessageIn` values. The
bounded `MessageInBus` is single-producer/single-consumer: one producer may
`Push`, one consumer may `Process(timestamp)`, and callers with multiple
producers must serialize before pushing. The bus applies parameter turns and
pushes through slot position, bank selection through manager bank index,
gesture messages through manager-owned gestures, and scene messages through the
manager scene API. A `SceneSelect(sceneIx)` message selects one scene ordinal;
the manager writes it to the less-selected endpoint of the current blend
(`blend <= 0.5` updates right, `blend > 0.5` updates left) and leaves blend
unchanged. `Clock`, `Start`, and `Stop` are accepted and drained but
intentionally inert in this change.

Gestures are manager-owned. `ParameterManager::SetGestureCount(count)` must be
called before groups are created when gestures are needed; the default gesture
count is zero. Groups receive the fixed manager gesture count for arena sizing,
and direct gesture calls should use manager APIs.

Scene endpoint changes should use `SetSceneEndpoints(left, right)`, which
rejects endpoints that are invalid for any existing group and leaves prior
scene state unchanged. `SetSceneBlend(blend)` clamps and updates blend
independently.

## Layout: runtime vs apps

`projects/synth/runtime/` is the shared, app-agnostic JUCE application
runtime (`synth_runtime::Runtime<App>`, `synth_runtime::ShellComponent<App>`,
`synth_runtime::MidiPanel<App>`, the `SYNTH_RUNTIME_MAIN` macro). It owns the
audio device, the message-thread tick, the MIDI device panel, and the
patch-command chrome (New/Save/Save As/Load/Revert) that every app built on
it gets for free.

`projects/synth/apps/<name>/` holds one runtime application each. An app
provides a JUCE-free core satisfying `synth::SynthApplicationCore` (so it can
also run headless under `synth_rig::SynthRig` in tests) plus a JUCE-facing UI
wrapper satisfying `synth::SynthApplication` (adds `UIComponent()`), and a
`Main.cpp` that is just `SYNTH_RUNTIME_MAIN(AppType)`. The app's own UI
component should contain only its bespoke widgets; patch buttons and MIDI
device selection are runtime-owned chrome, not app code (see
`projects/synth/apps/miniapp/README.md` for a concrete example).

Patch command results (New/Save/Save As/Load/Revert) are logged by the
runtime itself, at INFO level through `synth::AsyncLogQueue`
(`synth_runtime::Runtime::LogPatchCommand`) — apps do not write their own
patch log files.

The shell chrome also shows the current patch's name (the patch directory's
filename, or "(no patch)" when none is current), read fresh every repaint
tick from `Runtime::GetEngine().Patches().CurrentPatchDirectory()` — the
message-side `PatchManager`'s own state, never cached elsewhere and never
touched from the audio thread. The Save button checks the same state before
dispatching: with no current patch it falls through to the Save As chooser
instead of sending a `SavePatch()` doomed to return `NeedsSaveAsPath`
(that status is still logged as a backstop if it ever occurs).

Build an app from `projects/synth`:

```text
make -C apps/<name>
```

or, for the miniapp specifically, via the root Makefile's convenience
targets:

```text
make miniapp   # delegates to `make -C apps/miniapp`
make apps      # same thing, explicit about the apps/ layout
```

Building any app requires a local JUCE checkout (`JUCE_DIR`, defaulting to
`~/JUCE`); `make all`/`make test` at this directory's root do not require
JUCE, since the JUCE-free library and test binaries build independently of
any app.
