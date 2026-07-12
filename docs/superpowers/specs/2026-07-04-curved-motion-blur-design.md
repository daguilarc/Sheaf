# Curved Motion Blur Indicator Design

## Goal

Make audio-rate parameter motion visibly read as motion without adding extra
fake value indicators, and fix local modulation-depth knobs whose UI value dot
can lag or freeze because their cached UI center is not sampled by the normal
top-level `ProcessLite()` pass.

## Current Problem

`Parameter::PopulateUIState()` now publishes `UIDisplayCenter()` as the knob
value and `UIDisplaySpread()` as the motion amount. That is correct for
top-level parameters that receive per-sample `ProcessLite()`, but local
modulation-depth parameters are computed recursively from their parent and are
not included in miniapp's explicit top-level per-sample `ProcessLiteParameters`
list. Their min/max state can update while their UI center cache stays at an
older value, producing a false fixed value dot plus a moving collapsed min/max
cap.

The current blur visual is also too subtle: it draws a faint spread arc around
the smoothed value, but heavily modulated parameters already show large min/max
range arcs, so the spread cue disappears into the range visualization.

## Design

### Recursive Depth UI State

When `Parameter::ComputeAtDepth()` is called with `recursionDepth > 0`, the
parameter is a nested/local modulation-depth parameter being evaluated as part
of another parameter's modulation graph. These nested depth parameters should
not accumulate motion blur. After their target/current state is snapped inside
the recursive branch, they should call the existing
`SeedCachedKnobAndUiDisplayState()` helper. This sets:

- `currentKnobValues_[voice] = GetRaw(voice)`
- `uiDisplayCenters_[voice] = currentKnobValues_[voice]`
- `uiDisplaySpreadEnergies_[voice] = 0`

This makes local modulation-depth knobs publish the true current knob value
immediately and prevents stale center state. It also keeps their UI simple:
sub-audio and recursively computed depth controls look like normal knobs.

### Curved Melted Dot Blur

The encoder should continue to draw voice rings and min/max range arcs. The
motion cue should move from a separate spread arc into the value indicator
itself:

- At rest or very low motion, each voice shows today's crisp circular value dot
  with a black outline.
- As `spreadValues[voice]` increases, the dot elongates along the knob arc,
  centered on the smoothed UI value.
- The elongation follows the same angular curve as the knob indicator path.
- The black outline fades slowly as motion increases.
- At high audio-rate motion, the indicator becomes a melted gradient: a wide
  low-alpha outer curved stroke, a medium-alpha middle stroke, and a brighter
  curved core. The center remains visually readable because the brightest core
  is still centered at the UI value.

The renderer should not sample random positions at paint time. Any busy texture
must be deterministic, or omitted. The selected design is the smooth "B" visual:
curved, gradient, no speckle cloud.

### Motion Mapping

`spreadValues[]` remains a normalized display spread. For non-bipolar
parameters it is already in `0..1`; for bipolar parameters the renderer should
continue to halve the display spread because the display normalizes `-1..1`
into `0..1`.

The visual mapping should be monotonic and clamped:

- `motion = clamp(displaySpread / fullBlurSpread, 0, 1)`
- Dot arc half-width grows from a circular dot equivalent at `motion = 0` to a
  broad curved smear at `motion = 1`.
- Black outline alpha fades from its current value to near-zero over the same
  `motion` range, but should fade slowly enough that low/sub-audio modulation
  still looks like the current crisp dot.
- At `motion = 0`, the resting appearance is preserved: arc half-width matches
  today's dot radius `jlimit(3, 8, radius * 0.11)` and outline alpha remains
  `0.55`.
- The blur helpers consume the already-display-normalized spread. Bipolar
  spread is halved once before helper calls, matching the existing display
  normalization.

The exact constants can be tuned in the shared `synth::ui` encoder draw helper
and covered by portable draw geometry tests rather than exposed as
parameter-group config.

## Files

- `projects/synth/src/ParameterModulation.cpp`
  - Update recursive `ComputeAtDepth()` behavior so nested parameters seed UI
    center/spread from their true raw value.
- `projects/synth/include/synth/EncoderDraw.hpp`
  - Replace separate spread-arc drawing with curved melted-dot drawing.
  - Add small pure helper functions for motion normalization, arc width, and
    outline alpha.
- `projects/synth/juce/PortableDrawGeometryTests.cpp`
  - Replace the obsolete `DisplaySpreadToStrokeWidth` assertions with coverage
    for monotonic blur width and outline fade.
- `projects/synth/tests/parameter_modulation_tests.cpp`
  - Cover that nested modulation-depth UI state publishes the true knob value
    and zero spread on the steady-state `ComputeAllTargets()` path. The test
    must establish a baseline, perturb a child depth parameter, call
    `ComputeAllTargets()` without `SnapCurrentToTarget()`, and assert the child
    depth's `UIDisplayCenter(0) == GetRaw(0)` plus `UIDisplaySpread(0) == 0`.

## Testing

Run targeted tests first:

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
make -C projects/synth/apps/miniapp test
```

Then run the synth suite:

```bash
make -C projects/synth test
```

## Non-Goals

- No random paint-time dot sampling.
- No new parameter-group UI blur configuration.
- No change to DSP mapping semantics.
- No change to min/max range arc semantics.
- No attempt to blur nested/local depth parameters that are themselves
  modulated; by design they publish true recursive values with zero motion.
