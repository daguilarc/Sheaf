## Task 1: Clock Primitives, Affine Plans, and Time Mapping (Sol)

**OpenSpec Tasks Covered:** 1.1–1.3, 2.1–2.2, mapper portion of 7.5

**Primary Files:**

- Create `projects/synth/include/synth/DspPhasor2Tick.hpp`.
- Create `projects/synth/include/synth/MasterClock.hpp` and `projects/synth/src/MasterClock.cpp` (or keep small value types header-only when justified).
- Modify `projects/synth/Makefile` for library objects and focused tests.
- Modify `projects/synth/tests/dsp_tests.cpp`.
- Create `projects/synth/tests/master_clock_tests.cpp`.

**Required interfaces and behavior:**

- [ ] Add failing `Phasor2Tick` tests for silent priming, cell-boundary tick, same-cell silence, backward time, jumps, invalid multiplier/time, `noexcept`, and allocation-free processing.
- [ ] Implement a double-time/integer-multiplier processor whose tick is true exactly when `floor(multiplier * time)` differs from the primed previous cell. Define safe invalid-input behavior explicitly and test it.
- [ ] Define `SyncConfig`, transport/acquisition/source enums, coherent diagnostics snapshot, immutable `ClockBlockPlan`, compact bounded plan history descriptors, and `MasterClock` query/prepare/config API without JUCE types.
- [ ] Make a plan expose lifetime and transport quarter-note phase at integer and fractional output positions by affine evaluation, plus exact start/end anchors and range metadata. No per-sample storage is permitted.
- [ ] Add an isolated `AudioSampleTimeMapper` implementing the five-error median, `1/32` EWMA, `±500 ppm` future slew, exact ordinary continuity, discontinuity reset rule, epoch mapping, and observable diagnostics.
- [ ] Test default/prepare state, BPM-to-slope conversion, invalid tempo, receive-authority rejection, manual restoration, stopped/running queries, half-open endpoints, exact adjacent anchors, immutable current plan, bounded timestamp/history queries, future-only slope changes, discontinuity handling, and long-run finite monotonic behavior.
- [ ] Run `make -C projects/synth dsp_tests master_clock_tests` (add named phony targets if the Makefile convention requires them) and the existing contract/engine compile tests affected by the new types.
- [ ] Commit only the task files after review and verification.
