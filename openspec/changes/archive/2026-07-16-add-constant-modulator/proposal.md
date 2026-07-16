## Why

Synth applications need a reusable way to spread polyphonic voices across a
fixed unipolar modulation range without rebuilding assignment and stable-pointer
plumbing in each app. MiniApp should demonstrate that source in its remaining
sixth modulator slot with a compact view of every voice's constant magnitude.

## What Changes

- Add a runtime-sized, JUCE-free constant modulator processor that computes one
  immutable normalized value per voice during construction and exposes
  address-stable outputs for modulation-source registration.
- Assign values using the greedy lexicographically smallest permutation that
  maximizes cyclic adjacent distance, normalized as `x[j] / (n - 1)`, with a
  single voice assigned zero.
- Add a portable, unlabeled bar visualizer that renders one bar per voice in
  voice order over a `[-0.1, 1.1]` vertical range so zero remains visible and
  one remains below the top edge.
- Expand MiniApp to six connected modulator slots and register the two-voice
  constant source plus its retained visualizer at index `5`, without adding
  per-sample recomputation.
- Add JUCE-free DSP, portable UI, MiniApp system, backend-parity, and requirement
  coverage for the processor, visualization, and final six-slot topology.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-dsp-classes`: Add the reusable polyphonic constant modulator contract
  and make MiniApp publish it from modulator index `5` in a six-slot group.
- `synth-portable-visualizers`: Add an immutable-value bar visualizer with one
  minimal bar per voice and explicit zero/top framing margins.

## Impact

- Affected synth library code includes a focused DSP processor header, a
  portable visualizer header, shared build dependencies, and JUCE-free tests
  under `projects/synth`.
- MiniApp topology under `projects/synth/apps/miniapp` gains a retained
  two-voice constant processor and visualizer at modulator index `5`; existing
  sources at indexes `0` through `4` remain unchanged.
- The group grows from five to six modulators and its twelve-parameter capacity
  grows from 72 to 84 modulation-aware values.
- The public API adds a runtime-sized immutable source with stable-pointer
  lifetime requirements, but adds no third-party dependency, processing cost,
  persistence format, parameter, bank, page, scope channel, or audio routing.
- This change builds on the active `add-noise-modulator` topology and reserves
  the next append-only requirement IDs after that change.
