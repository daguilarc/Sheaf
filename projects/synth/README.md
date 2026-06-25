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
        + dot(modulatorValues[voice], currentDepths[voice]))
```

Modulation follows the Smart Grid-style range-preserving weight rule. A
modulation depth is a signed normalized value. For range accounting, the weight
is `abs(depth)`; for audio-rate modulation, the signed depth remains in the dot
product.

```text
sum = sum(abs(rawDepth[m]))

if sum < 1:
  centerScale[voice] = 1 - sum
  depth[voice][m] = rawDepth[m]
else:
  centerScale[voice] = 0
  depth[voice][m] = rawDepth[m] / sum
```

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
cell is reserved as the return cell, so an undersized bank shows as many depth
cells as fit before the return cell. Return cells handle press only; tick and
shift-press are ignored.

The randomized simulation test runs bounded default seeds during
`make synth-test`. Larger runs can be requested with:

```text
SYNTH_RANDOM_SEEDS=0x51A7,0xC0FFEE SYNTH_RANDOM_STEPS=5000 make synth-test
```
