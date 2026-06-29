## Why

Sheaf synth currently has parameter and MIDI infrastructure, but no reusable DSP
library layer for oscillators, filters, scopes, math tables, or UI waveform
rendering. Porting the Smart Grid DSP patterns into a Sheaf-native capability
lets the miniapp become a real use of the library instead of a parameter demo.

## What Changes

- Add a documented DSP class pattern: each DSP class owns its processing state,
  exposes an `Input` struct for per-sample or per-block inputs, and processes
  through `Process(Input&)` while publishing output state on the instance.
- Add reusable synth DSP headers/sources for table-based math, n-ary number
  types, one-pole low-pass and high-pass filters, rational tanh saturation,
  phase incrementing, mipmapped adaptive wavetables, morphing wavetables, and a
  wavetable VCO.
- Add Smart Grid-derived scope writer/reader utilities adapted to a flat channel
  allocation model where owners reserve channel blocks at synth initialization
  through `ReserveChans(numChans)`.
- Add DSP UI-state conventions where applicable: DSP classes may expose a
  thread-safe `UIState` plus `PopulateUIState`, and filter-like UI states inherit
  from a transfer-function interface for response visualization.
- Add JUCE waveform drawing helpers, including a ported path drawer and a
  `DrawWaveformFromScope` function that renders a scope reader with a color,
  y-range, and optional current-position indicator.
- Add a `VcoWaveformComponent` that draws one or more VCO UI states in the same
  pane.
- Replace the synth miniapp placeholder parameter demo with a duophonic
  wavetable-VCO patch: one parameter group, polyphony two, first page containing
  Tune, Phase, Shape, and Volume, and second page containing the existing
  ad-hoc sine LFO speed.
- Add two duophonic modulators derived from the VCO outputs, one direct and one
  swapped, while keeping the existing sine/cosine LFO as a third modulator.
- Display a waveform pane containing both VCOs and publish scope indices from
  the miniapp so the UI can render current waveforms.

## Capabilities

### New Capabilities

- `synth-dsp-classes`: reusable Sheaf synth DSP class patterns, math,
  multichannel values, filters, scopes, wavetables, VCOs, waveform UI drawing,
  and miniapp integration behavior.

### Modified Capabilities

- `synth-parameter-modulation`: update the existing synth miniapp probe
  requirement so the demo's visible parameter sets, modulators, and waveform
  pane match the new DSP-backed VCO patch instead of the previous placeholder
  parameter/modulation demo.

## Impact

- Affected code: new `projects/synth/include/synth` and `projects/synth/src`
  DSP modules, `projects/synth/juce` drawing/components, synth tests, miniapp
  tests, `projects/synth/Makefile`, `projects/synth/miniapp/Makefile`, and
  `projects/synth/miniapp/Main.cpp`.
- Public API impact: additive DSP library APIs for math, numbers, filters,
  scopes, wavetables, VCOs, UI state, and JUCE waveform rendering.
- Dependencies: no new runtime dependencies beyond the existing C++20 and JUCE
  miniapp setup.
- Source reference: algorithms and UI patterns are source-derived from
  `/Users/joyo/theallelectricsmartgrid`, especially `Math.hpp`,
  `BasicWaveTable.hpp`, `AdaptiveWaveTable.hpp`, `MorphingWaveTable.hpp`,
  `Filter.hpp`, `ScopeWriter.hpp`, `PathDrawer.hpp`, and `ScopeComponent.hpp`.
