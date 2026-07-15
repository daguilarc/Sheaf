## 1. Noise DSP Processor

- [ ] 1.1 Add failing JUCE-free DSP tests for positive runtime voice-count construction, zero-voice rejection, non-copyable/non-movable lifetime, deterministic explicit seeding, strict `(0, 1)` values, one stream advance per voice, fixed-seed distribution sanity, and stable output/source-pointer addresses across processing.
- [ ] 1.2 Implement a compact seedable PCG32-style generator and `NoiseModulatorProcessor` in a focused synth DSP header, including one-time normal seeding, the upper-23-bit open-interval conversion, constructor-only output/pointer allocation, bounds-checked inspection accessors, and allocation-free `Process()`.
- [ ] 1.3 Add a pointer-backed modulation integration test proving the processor's source-pointer span registers directly with an equal-voice-count `ParameterGroup` and publishes the latest per-voice values without processor knowledge of group topology.

## 2. Portable Noise Visualizer

- [ ] 2.1 Add failing portable UI tests for a model-free `NoiseWaveformVisualizer`: explicit-seed reproducibility, one monophonic polyline, one bounded random y position per covered integer x column, empty/invalid-bounds safety, and different geometry on consecutive draws.
- [ ] 2.2 Implement the JUCE-free noise visualizer with retained color and private UI-only fast random state, fresh per-pixel geometry on every `DrawVisible()` call, no processor/UI-state/scope dependency, and no backend-specific types.
- [ ] 2.3 Verify the visualizer continues to obey the base component contracts for stable identity, intrinsic visibility, exact assigned bounds, and draw-node composition beneath modulation-depth encoders.

## 3. MiniApp Fifth Modulator

- [ ] 3.1 Add failing MiniApp system tests requiring a five-slot two-voice group, connected `Noise` metadata and two stable processor pointers at index `4`, a distinct retained noise visualizer at index `4`, and audio-rate per-voice value changes visible through the production modulation update path; do not encode a requirement that index `3` remain disconnected after parallel work lands.
- [ ] 3.2 Update `MiniAppCore` to retain a two-voice noise processor and one noise visualizer, configure five modulator slots, register the processor outputs and visualizer only at index `4`, and process noise once per sample before `UpdateModValues` without adding parameters, banks, pages, scopes, or audio routing.
- [ ] 3.3 Update existing MiniApp topology and visualizer tests so they preserve `sdsp-33` coverage for exactly three scope-backed VCO/LFO visualizers while separately covering the reserved index `3` integration boundary and model-free noise visualizer at index `4`.

## 4. Verification and Documentation

- [ ] 4.1 Update `projects/synth/docs/coverage.md` to map modified `sdsp-13` and `sdsp-33` plus new `sdsp-34`, `sdsp-35`, and `spv-6` to the DSP, portable UI, and MiniApp system tests.
- [ ] 4.2 Run the focused DSP, portable UI, and MiniApp system test binaries during development, then run `make -C projects/synth test` and confirm the UI-boundary check and full JUCE-free suite pass.
- [ ] 4.3 Run `openspec validate add-noise-modulator --strict` and `openspec status --change add-noise-modulator`, confirming every proposal artifact is valid and the change is apply-ready.
