### Spec Compliance

- ✅ **Fixed.** The blocker was that `MeterSnapshot::rms` carried mean-square, not linear RMS. `DspMetering.hpp:26` renames the smoothing state to `meanSquare`, and `DspMetering.hpp:66` now returns `.rms = std::sqrt(std::max(0.0f, meanSquare))`, a true linear RMS amplitude with a non-negativity clamp guarding `sqrt`. `RmsDbFS` (`DspMetering.hpp:69-71`) is retyped to accept a linear RMS and uses `20*log10`, consistent with `PeakDbFS`. This satisfies the OpenSpec scenario "a UI-readable snapshot can report linear and dBFS values" (`add-smartgrid-dsp-processors/specs/synth-dsp-classes/spec.md:96`). The math is numerically equivalent to the old `10*log10(meanSquare)` while making input semantics linear and self-consistent.

I verified there are **no production consumers** of `.rms` or `RmsDbFS` outside `DspMetering.hpp` and `dsp_tests.cpp` (`grep` across `projects/`), so the semantic change breaks no callers. The new test `meter_snapshot_rms_is_linear_amplitude_and_db_helpers_use_linear_inputs` (`dsp_tests.cpp:220-233`) pins both behaviors; the reported red run (`got 0.0002` vs `expected 0.0141421`) is exactly the pre-fix squared value, confirming genuine red→green. Existing meter tests still hold (ordering is preserved under `sqrt`).

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)
None. The incidental changes in the diff are safe:
- `DspSpectral.hpp` removes `m_frequencies`/`m_logFrequencies` and the `ResidualModel` constructor — confirmed unreferenced anywhere; `GetEnvelope`/`Process` read only `m_magnitudes`. Pure dead-state removal.
- `DspOla.hpp` and `Meter::Snapshot` additions are comments only, no behavior change.

#### Minor (Nice to Have)
- Spec scenario `spec.md:101` calls for gain reduction reportable "in linear and dB-normalized forms"; `reduction` is exposed linear but has no dB helper. **Pre-existing**, not introduced by this fix, and correctly left deferred per the fix report.
- Deferred items (Butterworth/LR coefficient recomputation, resynth phase wrapping, rolling-buffer extrema defaults, spectral distortion thresholds) are broader behavioral edits unrelated to the blocker — correctly nonblocking.

### Assessment

**Ready to merge?** Yes

**Reasoning:** The RMS/dB blocker is fully resolved with correct `sqrt`/`20·log10` semantics, a clamp guard, red/green test coverage, and no affected production callers; the accompanying cleanup is dead-code removal plus comments, introducing no new Critical or Important issues, and the deferred minors are appropriately nonblocking.