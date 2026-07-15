## 1. Pure Math and Correlated Timing

- [x] 1.1 Add failing JUCE-free DSP tests for shaped-interpolation endpoints, linear/cosine landmarks, double-progress clamping, narrowing only at the float cosine/output boundary, and agreement with `DefaultDspMath::Cos2Pi`.
- [x] 1.2 Implement the pure `ShapedInterpolate` helper in the synth DSP layer and make the interpolation tests pass.
- [x] 1.3 Add failing deterministic tests for center-time draws, reciprocal center-rate conversion, per-voice normal rate draws using hertz internal sigma, cycles-per-sample conversion, the concrete `1 / (sampleRate * 3600)` epsilon and one-hour phase bound, double precision, and invalid configuration rejection.
- [x] 1.4 Implement the correlated center-time/per-voice-increment helper with an injectable deterministic draw path and make its tests pass.

## 2. Voice and Ganged Processor

- [x] 2.1 Add failing state-machine tests for default-done construction, reset chaining, waiting holds/crossing, shaped movement, overshoot clamping, exact done output, and done holds.
- [x] 2.2 Implement the randomness-free `GangedRandomLfoVoice` with explicit waiting, moving, and done state and make its tests pass.
- [x] 2.3 Add failing ganged-processor tests for shared waiting/moving centers, shared target center, independent `[0,1]` uniform shapes, canonical logical RNG order (waiting center/rates, moving center/rates, target center/targets, shapes, each per-voice group in voice order), unipolar target clamping, heavy-tail epsilon bounds, slowest-voice round gating, first-process seeding, and reproducibility from a fixed test seed/source.
- [x] 2.4 Implement the fixed-array `GangedRandomLfoProcessor<VoiceCount>`, sample-rate/config validation, round elapsed tracking, random engine/test hook, and unipolar output accessors without a module wrapper.
- [x] 2.5 Add allocation/real-time structural coverage for repeated per-sample processing and round turnover, then remove any lock, I/O, logging, dynamic storage, or process-time allocation found.

## 3. Coherent UI State and Predictive Visualizer

- [x] 3.1 Add failing snapshot tests for complete per-gang/per-voice actual state, assigned voice colors, odd/even revision publication, stable-read retry, and absence of scope/history storage.
- [x] 3.2 Implement gang UI-state publication and the bounded coherent snapshot reader, and publish all state required to reconstruct the current round.
- [x] 3.3 Add failing JUCE-free geometry tests for `ceil(1 / increment)` max-duration x scaling, wait/move/early-finish path evaluation, shared present x, reconstructed-path dots at that x, solid-past/dashed-future segmentation, sub-sample/drawing tolerance at discarded-remainder state boundaries, per-voice colors, clipping, fixed geometry bounds, and invalid/unstable snapshot handling.
- [x] 3.4 Implement the shared predictive command builder and non-owning `GangedRandomLfoVisualizer` using existing polyline and ellipse commands plus the shared shaped-interpolation helper.
- [x] 3.5 Verify the predictive visualizer compiles and produces equivalent portable geometry through the existing JUCE and browser command consumers without extending the draw protocol.

## 4. MiniApp Integration

- [x] 4.1 Add failing MiniApp system tests for four modulation sources with existing indexes preserved, two ganged outputs at index `3`, the requested waiting/moving/target configuration, negotiated sample-rate setup, per-sample processing order, and unchanged parameter/page/bank/scene/gesture topology.
- [x] 4.2 Integrate one `GangedRandomLfoProcessor<2>` into `MiniAppCore`, register its cyan/orange outputs and retained address-stable modulation-depth visualizer, recalculate group capacity, and publish its UI state at the existing block boundary.
- [ ] 4.3 Add failing portable MiniApp UI tests for bounded VCO, ordinary LFO, and ganged-random-LFO main panels at default and resized bounds, including cyan/orange full-round paths and present dots.
- [ ] 4.4 Update the MiniApp layout/model/surface to render the third main panel directly from the gang snapshot while retaining a distinct owned visualizer placement for modulation-depth underlays.

## 5. Verification and Documentation

- [ ] 5.1 Update `projects/synth/docs/coverage.md` to map `sdsp-34..36`, `spv-6`, and `spm-71` to their DSP, portable-geometry, backend, and MiniApp system tests.
- [ ] 5.2 Run the focused synth DSP, portable UI/geometry, and MiniApp system test targets and fix all failures without weakening existing assertions.
- [ ] 5.3 Run the full relevant synth test suite plus repository formatting/static checks, confirm no production JUCE dependency entered core headers, and verify the worktree contains no unintended changes to the existing untracked MiniApp artifacts.
