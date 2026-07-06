## 1. Parameter Cadence

- [x] 1.1 Add parameter modulation tests for `ParameterGroupConfig::targetComputeIntervalSamples`: default is 16, zero is invalid, and configured positive values are preserved.
- [x] 1.2 Add parameter processing tests proving per-sample processing recomputes at sample index 0, skips target recompute before the configured interval, and recomputes from the owning manager scene at `sampleIndex % targetComputeIntervalSamples == 0`.
- [x] 1.3 Add group-level processing tests proving all top-level parameters in a group are processed for the same absolute sample index and modulation-depth child targets refresh through the recursive compute path.
- [x] 1.4 Implement `targetComputeIntervalSamples` on `ParameterGroupConfig`, validation, and default construction.
- [x] 1.5 Implement per-sample parameter and group processing helpers while leaving `ProcessLite()` as the slew-only helper.

## 2. Runtime Sample Position

- [x] 2.1 Add engine or rig tests proving consecutive `AudioBlock` values expose monotonic `startSample` values, including a block size that is not a multiple of 16.
- [x] 2.2 Add or update engine tests proving steady-state `Engine::ProcessBlock()` no longer runs `ComputeAllTargets()` once per host block.
- [x] 2.3 Update the `ProcessFrame()` hook test/contract so it only asserts post-message-drain, pre-`ProcessBlock()` ordering and no longer depends on freshly computed parameter targets.
- [x] 2.4 Add `AudioBlock::startSample` and set it from the engine's sample counter before application delegation.
- [x] 2.5 Remove the steady-state `ComputeAllTargets()` call from the engine block pump while preserving patch/UI/MIDI drain ordering, app delegation, sample-counter publication, and UI-state throttling.

## 3. Mini App Migration

- [ ] 3.1 Update the mini app parameter helper to use the new group-level per-sample processing API with `block.startSample + frame`.
- [ ] 3.2 Remove mini app reliance on runtime once-per-block target computation without changing module order, modulator update order, scope writing, or output writing.
- [ ] 3.3 Update mini app system tests to assert the default target compute interval is 16 samples and that the mini app still initializes, routes pages/banks, produces finite nonzero output, and round-trips patches.

## 4. Verification

- [ ] 4.1 Run the focused synth parameter modulation, engine, rig, and mini app system tests.
- [ ] 4.2 Run the full synth test target from `projects/synth`.
- [ ] 4.3 Run `openspec status --change decouple-encoder-block-rate` and confirm all proposal artifacts are complete.
