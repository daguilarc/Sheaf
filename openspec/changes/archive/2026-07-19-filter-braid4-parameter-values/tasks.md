## 1. Two-Phase Parameter Processing

- [x] 1.1 Add focused parameter-modulation tests for phase-1 slewing/cache sampling, cache replacement and clamping, phase-2 UI smoothing, wrapper equivalence, cadence-controlled per-sample phase 1, and top-level-only group phase traversal.
- [x] 1.2 Add `Parameter` lite/per-sample phase APIs and normalized cached-knob replacement, retaining `ProcessLite()` and `ProcessSample()` as consecutive two-phase wrappers.
- [x] 1.3 Add matching `ParameterGroup` phase traversal APIs, preserve processing-observer/top-level visit semantics, and update the deterministic simulation oracle and randomized coverage for the split contract.

## 2. Reusable One-Pole Hot Path

- [x] 2.1 Add DSP tests proving low-pass precomputed-alpha processing matches cutoff processing, independent instances can share one alpha, and reset seeds output deterministically.
- [x] 2.2 Extend `OnePoleLowPass` with `ProcessWithAlpha(value, alpha)` and `Reset(output)`, delegating the existing cutoff-bearing `Process` path without changing its response or UI-state contract.

## 3. Braid Module Control Migration

- [x] 3.1 Update module tests first for four oscillator-indexed Mod LPF Cutoff IDs/names/defaults, unchanged positions and registration counts, unchanged oscillator Frequency ranges, unshifted LFO cutoff range, and direct Phase-to-phase-offset mapping.
- [x] 3.2 Replace `Braid4VcoModule` PM Index IDs/input/cache fields and labels with Mod LPF Cutoff controls in the same monophonic registration slots, expose the cutoff IDs, and remove the phase-depth multiplier.
- [x] 3.3 Update matrix module tests and naming comments so `[row][column]` unambiguously means `[output][input]` and shared mono-group expectations refer to Cutoff/Frequency rather than PM Index/Frequency.

## 4. Braid 4 Oscillator-Owned Filtering

- [x] 4.1 Add Braid system tests that identify all 80 filtered states and prove ownership for every audible/LFO quad voice, Cutoff/Frequency control, and every matrix row/column entry while proving only X/Y and nested modulation-depth parameters are excluded.
- [x] 4.2 Add response tests proving each oscillator computes cutoff from its pre-Mod-LPF phase-1 cutoff cache after ordinary parameter-state slew over the exponential `0.1..20000 Hz` range at the internal sample rate, reuses that one alpha across its ten independent states including the cutoff itself and all four owned matrix entries, and does not apply the LFO frequency octave shift to cutoff.
- [x] 4.3 Add integration tests proving phase-1 raw caches are replaced before phase 2, DSP mappings and UI smoothing observe the same filtered cache, phase offset has no outside damping, and filter reset seeds current caches without a zero-origin transient.
- [x] 4.4 Implement compile-time-sized audible/LFO oscillator filter bundles and explicit parameter-ID ownership tables in Braid 4, including output-row matrix ownership and cache seeding during initialization/prepare/reset.
- [x] 4.5 Split Braid's internal parameter step around coefficient calculation and cache filtering, preserving standard-modulator ordering, exact one-internal-sample matrix feedback publication timing, allocation-free processing, and existing debug-counter observability.
- [x] 4.6 Update Braid bank, color, UI snapshot, persistence, and old-saved-value coverage for Cutoff controls at positions `8..11` with stable parameter count/order and new semantics.

## 5. Verification and Documentation

- [x] 5.1 Run the focused DSP, parameter-modulation, module, Braid system, portable-UI, and persistence test targets and resolve all regressions.
- [x] 5.2 Run Braid's release deadline tests at 44.1, 48, and 96 kHz and confirm the existing average and p99 callback budgets with all 80 filters active.
- [x] 5.3 Run the full synth test suite and public-header/JUCE-free build checks.
- [x] 5.4 Update `projects/synth/docs/coverage.md` and any affected architecture/control documentation to map `sdsp-6`, `spm-11`, `spm-66`, `spm-72`, `smod-9..11`, and `d4-1`, `d4-2`, `d4-7`, `d4-8`, `d4-10` to their focused tests.
