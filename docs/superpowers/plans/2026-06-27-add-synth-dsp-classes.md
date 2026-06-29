# Add Synth DSP Classes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sheaf-native reusable synth DSP classes by porting the relevant Smart Grid math, filters, scopes, wavetables, waveform drawing, and miniapp usage into `projects/synth`.

**Architecture:** Keep core DSP JUCE-free under `projects/synth/include/synth` and `projects/synth/src`. Put JUCE drawing helpers under `projects/synth/juce` or `projects/synth/miniapp`. A DSP class owns its state, defines a nested `Input`, processes via `Process(Input&)` or `Process(const Input&)`, exposes output state on the instance, and optionally publishes a nested `UIState` through `PopulateUIState`.

**Tech Stack:** C++20, custom synth test harness, Makefile builds, optional local `~/JUCE` miniapp build, OpenSpec, xagent + Claude Opus reviews.

---

## Source Of Truth

- OpenSpec change: `openspec/changes/add-synth-dsp-classes/`
- Design: `openspec/changes/add-synth-dsp-classes/design.md`
- Main delta spec: `openspec/changes/add-synth-dsp-classes/specs/synth-dsp-classes/spec.md`
- Miniapp delta spec: `openspec/changes/add-synth-dsp-classes/specs/synth-parameter-modulation/spec.md`
- Tasks: `openspec/changes/add-synth-dsp-classes/tasks.md`
- Accepted xagent spec review: `xrun_20260627023718820_08d2a126` (`PASS`)

Smart Grid source references:

- `/Users/joyo/theallelectricsmartgrid/private/src/Math.hpp`
- `/Users/joyo/theallelectricsmartgrid/private/src/StereoUtils.hpp`
- `/Users/joyo/theallelectricsmartgrid/private/src/QuadUtils.hpp`
- `/Users/joyo/theallelectricsmartgrid/private/src/Filter.hpp`
- `/Users/joyo/theallelectricsmartgrid/private/src/ScopeWriter.hpp`
- `/Users/joyo/theallelectricsmartgrid/private/src/BasicWaveTable.hpp`
- `/Users/joyo/theallelectricsmartgrid/private/src/AdaptiveWaveTable.hpp`
- `/Users/joyo/theallelectricsmartgrid/private/src/MorphingWaveTable.hpp`
- `/Users/joyo/theallelectricsmartgrid/JUCE/SmartGridOne/Source/PathDrawer.hpp`
- `/Users/joyo/theallelectricsmartgrid/JUCE/SmartGridOne/Source/ScopeComponent.hpp`

Baseline and final expected commands:

```bash
openspec validate add-synth-dsp-classes
make -C projects/synth test
make -C projects/synth/miniapp test
make -C projects/synth miniapp
```

If `~/JUCE` is unavailable, record the exact missing-dependency output for the miniapp commands.

## Files

- Create: `projects/synth/include/synth/DspMath.hpp`
- Create: `projects/synth/include/synth/DspNumbers.hpp`
- Create: `projects/synth/include/synth/DspTransferFunction.hpp`
- Create: `projects/synth/include/synth/DspFilters.hpp`
- Create: `projects/synth/include/synth/DspScope.hpp`
- Create: `projects/synth/include/synth/DspWavetable.hpp`
- Create: `projects/synth/include/synth/DspOscillators.hpp`
- Create: `projects/synth/src/DspWavetable.cpp` or another focused non-template source for defaults if needed
- Create: `projects/synth/tests/dsp_tests.cpp`
- Create: `projects/synth/juce/PathDrawer.hpp`
- Create: `projects/synth/juce/WaveformComponents.hpp`
- Modify: `projects/synth/Makefile`
- Modify: `projects/synth/miniapp/DemoModulation.hpp`
- Modify: `projects/synth/miniapp/DemoModulationTests.cpp`
- Modify: `projects/synth/miniapp/Main.cpp`
- Modify: `projects/synth/miniapp/Makefile`
- Modify: `openspec/changes/add-synth-dsp-classes/tasks.md`

## Review Protocol

After implementation and passing local verification, run Claude Opus with xagent:

```bash
printf '%s\n' '{"type":"control.exit"}' | node projects/xagent/dist/src/main.js run --harness claude_code --model opus --subagent "<prompt>"
```

Prompt requirements:

- Name `add-synth-dsp-classes`.
- Include changed file list and verification output.
- Ask for findings first.
- Ask for verdict `APPROVED` or `CHANGES_REQUESTED`.
- Request checks against both OpenSpec delta specs, JUCE-free core DSP boundaries, DSP class pattern, scope semantics, wavetable behavior, miniapp page-bank routing, and VCO-derived modulators.

If xagent reports `CHANGES_REQUESTED`, fix the issues, rerun affected tests, and rerun the review.

## Task 1: Build Wiring And DSP Test Harness

**Files:**
- Modify: `projects/synth/Makefile`
- Create: `projects/synth/tests/dsp_tests.cpp`
- Create initial DSP headers listed above

- [ ] Add empty/minimal DSP headers with `#pragma once` and `namespace synth`.
- [ ] Add a separate `dsp_tests` binary or aggregate DSP tests into the existing test target.
- [ ] Add a JUCE-free include smoke test that includes all public DSP headers and fails if `JUCE_MAJOR_VERSION` is visible.
- [ ] Run `make -C projects/synth test`.
- [ ] Check off OpenSpec tasks 1.1-1.5 only after the test harness runs.

## Task 2: Math, N-Ary Numbers, Transfer Interface, Filters

**Files:**
- Implement: `DspMath.hpp`, `DspNumbers.hpp`, `DspTransferFunction.hpp`, `DspFilters.hpp`
- Test: `projects/synth/tests/dsp_tests.cpp`

- [ ] Port Smart Grid table-backed math as a precision-parameterized template, including sine, cosine, tangent, polar, roots of unity, Hann window, and Hann kernel.
- [ ] Implement `NaryNumber<T, Size>` with indexed access, elementwise arithmetic, scalar arithmetic, `ModOne`, `Sum`, and `Average`; add stereo/quad float/double aliases.
- [ ] Add `TransferFunction` with `FrequencyResponse` and `TransferFunctionValue` hooks for filter UI state.
- [ ] Implement one-pole low-pass, one-pole high-pass, and cubic rational tanh using the DSP class pattern.
- [ ] Add tests for multi-precision math, periodic trig, Hann kernel, n-ary arithmetic, filter convergence/rejection, transfer helpers, and tanh clamping/formula.
- [ ] Run `make -C projects/synth test`.
- [ ] Check off OpenSpec tasks 2.1-3.5.

## Task 3: Flat Scope Writer And Readers

**Files:**
- Implement: `DspScope.hpp`
- Test: `projects/synth/tests/dsp_tests.cpp`

- [ ] Port scope writer/holder/reader/factory behavior using a flat channel namespace.
- [ ] Implement `ReserveChans(numChans)` as contiguous block allocation with holder base channel, holder channel count, and relative-channel bounds checks.
- [ ] Implement sample writes, relative writes, circular index advance, publish index, start markers, and end markers.
- [ ] Implement scope readers that use the latest published index and marker history to align cycles and expose a transfer sample for drawing.
- [ ] Add tests for reservation order, relative writes, wraparound, publish stability, marker alignment, empty readers, and invalid reservations.
- [ ] Run `make -C projects/synth test`.
- [ ] Check off OpenSpec tasks 4.1-4.5.

## Task 4: Wavetables And Defaults

**Files:**
- Implement: `DspWavetable.hpp`
- Maybe implement: `projects/synth/src/DspWavetable.cpp`
- Test: `projects/synth/tests/dsp_tests.cpp`

- [ ] Port a basic wrapped wavetable with interpolation, writes, amplitude/RMS helpers, normalization, and shape-generation helpers.
- [ ] Port DFT/adaptive mipmapped wavetable generation using `DspMath<Bits>`.
- [ ] Implement adaptive level selection from oscillator frequency and max frequency.
- [ ] Implement n-way `MorphingWavetable` with clamped `[0, 1]` position and adjacent-table interpolation.
- [ ] Add default 12-bit sine, triangle, saw, square adaptive wavetables and default morphing order sine -> triangle -> saw -> square.
- [ ] Add tests for wrapped lookup, shape invariants, DFT reconstruction or harmonic filtering behavior, adaptive level selection, morph endpoints/crossfade, and defaults.
- [ ] Run `make -C projects/synth test`.
- [ ] Check off OpenSpec tasks 5.1-6.3.

## Task 5: Incrementer And Wavetable VCO

**Files:**
- Implement: `DspOscillators.hpp`
- Test: `projects/synth/tests/dsp_tests.cpp`

- [ ] Implement total-phase `Incrementer` with `Input { double freq; }`, `m_phase`, `m_wrappedPhase`, and `m_top`.
- [ ] Set `m_top` when the previous increment crosses an integer boundary; keep total phase unwrapped and do not add alias protection.
- [ ] Implement `WavetableVco` owning an incrementer and using a morphing wavetable.
- [ ] Add VCO `Input` for `freq`, `phaseOffset`, `wavetablePosition`, and `maxFreq`.
- [ ] Add nullable `ScopeWriterHolder*`, color metadata, `UIState`, and `PopulateUIState`.
- [ ] Write scope samples and top markers when a holder is connected.
- [ ] Add tests for phase offset, position selection, scope writes, top markers, null-scope safety, and UI-state publication.
- [ ] Run `make -C projects/synth test`.
- [ ] Check off OpenSpec tasks 7.1-7.6.

## Task 6: JUCE Waveform Rendering

**Files:**
- Create: `projects/synth/juce/PathDrawer.hpp`
- Create: `projects/synth/juce/WaveformComponents.hpp`
- Modify: `projects/synth/miniapp/Makefile`
- Test: miniapp geometry/rendering tests if `~/JUCE` is present

- [ ] Port Smart Grid path drawing into the synth JUCE layer.
- [ ] Implement `DrawWaveformFromScope` taking a scope reader, color, min/max y values, indicator flag, graphics, and bounds.
- [ ] Implement `VcoWaveformComponent` whose constructor accepts a list of `WavetableVco::UIState*` and paints all connected VCO waveforms.
- [ ] Add JUCE-side geometry/rendering checks for y mapping, indicator placement, multi-VCO drawing, and missing-scope skip behavior where practical.
- [ ] Run `make -C projects/synth/miniapp test`, or record the missing-JUCE output.
- [ ] Check off OpenSpec tasks 8.1-8.5.

## Task 7: Miniapp DSP Integration And Modulators

**Files:**
- Modify: `projects/synth/miniapp/Main.cpp`
- Modify: `projects/synth/miniapp/DemoModulation.hpp`
- Modify: `projects/synth/miniapp/DemoModulationTests.cpp`
- Modify: `projects/synth/miniapp/Makefile`

- [ ] Replace placeholder Cutoff/Shape/Level/Spread/Fold/Tone setup with one two-voice parameter group and three modulators.
- [ ] Increase visible encoders from three to four and update WRLD.Bldr profile visible encoder count.
- [ ] Add page one Tune, Phase, Shape, Volume; Shape is wavetable morph position.
- [ ] Add page two LFO Speed only, with remaining encoder cells disconnected.
- [ ] Implement page selection by selecting the corresponding page bank into the existing single bank slot.
- [ ] Instantiate two VCOs using the default morphing wavetable and reserve two flat scope channels.
- [ ] Process both VCOs from parameter values, publish scope, populate VCO UI states, and display one waveform pane with both traces.
- [ ] Publish modulator 0 from direct VCO outputs and modulator 1 from swapped VCO outputs, both normalized and clamped to `[0, 1]`.
- [ ] Keep the existing sine/cosine LFO as modulator 2 and drive its speed from page two LFO Speed.
- [ ] Add/update miniapp helper tests for LFO-speed mapping, VCO modulator normalization, group/page counts, and scope publication helpers.
- [ ] Run `make -C projects/synth test` and `make -C projects/synth/miniapp test` if possible.
- [ ] Check off OpenSpec tasks 9.1-10.5.

## Task 8: Final Verification, OpenSpec Status, xagent Review

**Files:**
- Modify: `openspec/changes/add-synth-dsp-classes/tasks.md`

- [ ] Run `openspec validate add-synth-dsp-classes`.
- [ ] Run `openspec status --change add-synth-dsp-classes`.
- [ ] Run `make -C projects/synth test`.
- [ ] Run `make -C projects/synth/miniapp test`, or record the missing-JUCE output.
- [ ] Run `make -C projects/synth miniapp`, or record the missing-JUCE output.
- [ ] Mark completed OpenSpec tasks in `tasks.md`.
- [ ] Run xagent Claude Opus implementation review using the Review Protocol.
- [ ] Fix any requested changes and repeat verification/review until approved.
