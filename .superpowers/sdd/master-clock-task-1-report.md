# Synth Master Clock/MIDI Sync — Task 1 Implementer Report

## Summary

Implemented the JUCE-free Task 1 clock foundation from base
`be0da616f2d83a9d1facd6545086dbef1ea8f14e`:

- `Phasor2Tick` with silent priming, exact floored-cell change detection, safe
  invalid-input rejection, and allocation-free/noexcept processing.
- `SyncConfig`, transport/acquisition/source enums, coherent diagnostics value
  snapshot, compact affine plan descriptor, and immutable application-facing
  `ClockBlockPlan`.
- `MasterClock` prepare/config/manual-tempo/query/commit APIs, one future-only
  affine slope per block, exact adjacent anchors, and fixed-capacity plan
  history for delayed sample/timestamp queries.
- Isolated `AudioSampleTimeMapper` with a five-phase-error median, `1/32` EWMA,
  nominal-slope correction capped at `+/-500 ppm`, exact ordinary endpoint
  continuity, discontinuity generation reset, host-epoch forward/inverse
  mapping, bounded segment history, and observable diagnostics.

Transport transitions, external MIDI-clock PLL/acquisition, source arbitration,
and analytical crossing production remain intentionally unimplemented for Task
2, apart from the enum/value/API scaffolding required by this task.

## Files

Implementation commit:

- `projects/synth/include/synth/DspPhasor2Tick.hpp`
- `projects/synth/include/synth/MasterClock.hpp`
- `projects/synth/src/MasterClock.cpp`
- `projects/synth/tests/dsp_tests.cpp`
- `projects/synth/tests/master_clock_tests.cpp`
- `projects/synth/Makefile`

Metadata-only follow-up commit:

- `.superpowers/sdd/master-clock-task-1-report.md`

The pre-existing `.superpowers/sdd/task-1-report.md` remained byte-identical
(`git hash-object`: `ce137391f31483628a6b94bae49c453525c212fe`).

## RED Commands and Failures

Initial focused RED:

```text
make -C projects/synth dsp_tests master_clock_tests
```

Both requested targets exited `2` before production files existed. Make
reported:

```text
No rule to make target `include/synth/DspPhasor2Tick.hpp'
```

The independent master-clock contract compile was also run directly:

```text
clang++ -Iprojects/synth/include -std=c++20 -Wall -Wextra -Wpedantic \
  -fsyntax-only projects/synth/tests/master_clock_tests.cpp
```

It exited `1` with:

```text
fatal error: 'synth/MasterClock.hpp' file not found
```

Self-review diagnostic RED:

```text
make -C projects/synth master_clock_tests
```

After adding an assertion that a discontinuity retains its observed phase error,
the focused binary exited `1` with:

```text
[FAIL] audio_sample_time_mapper_resets_generation_on_host_discontinuity:
diagnostics.latestPhaseErrorMicros expected 10001 got 0
```

The minimal production fix preserved the just-observed error after clearing the
median/EWMA history; the same focused target then passed.

## GREEN Commands and Results

Fresh prescribed build and regression gate:

```text
make -C projects/synth -B dsp_tests master_clock_tests contract_tests engine_tests
```

Exit `0`. All sources rebuilt with C++20 `-Wall -Wextra -Wpedantic`; the complete
DSP binary, all 14 master-clock cases, all contract cases, and all engine cases
passed without compiler warnings.

Sanitizer verification:

```text
clang++ -Iprojects/synth/include -std=c++20 -Wall -Wextra -Wpedantic -O1 -g \
  -fsanitize=address,undefined projects/synth/tests/master_clock_tests.cpp \
  projects/synth/src/MasterClock.cpp -o /tmp/sheaf-master-clock-tests-asan
/tmp/sheaf-master-clock-tests-asan
```

Exit `0`; all 14 cases passed with no AddressSanitizer or UndefinedBehaviorSanitizer
diagnostics. A corresponding sanitized DSP binary also passed its full suite,
including all six `Phasor2Tick` cases.

Additional checks:

- `git diff --check`: exit `0` before staging.
- `git diff --cached --check`: exit `0` before the implementation commit.
- Staged path audit contained exactly the six implementation/test/Makefile paths
  listed above.

An additional `make -C projects/synth test` run passed every case reached before
one timing-only Braid sparse-modulation deadline threshold failed under host load.
An isolated source-unchanged rerun first failed a different 96 kHz timing
threshold, then an immediate second isolated rerun passed all five Braid deadline
cases. `MasterClock.o` is not referenced by that static-linked binary, and no
Braid/deadline source changed. This matches the repository's documented
host-scheduling sensitivity; no unrelated timing assertion or Braid code was
changed.

## Requirement-by-Requirement Evidence

### OpenSpec 1.1 — Failing Phasor2Tick DSP tests

`projects/synth/tests/dsp_tests.cpp` covers silent explicit priming, silent first
valid processing, same-cell silence, exact boundary changes, backward time,
multi-cell jumps, non-finite time, non-positive multiplier, product overflow,
state preservation after rejection, compile-time `noexcept`, and an intercepted
global-allocation counter across 10,000 process calls.

### OpenSpec 1.2 — Phasor2Tick implementation

`DspPhasor2Tick.hpp` is header-only and JUCE-free. Each valid call computes
`floor(multiplier * time)`, compares it with the retained floored product, emits
one boolean tick exactly on inequality, and retains the new cell. Invalid input
returns false, clears the observable tick for that call, and preserves primed
state/cell. The process path has no modulo, allocation, lock, or throw.

### OpenSpec 1.3 — JUCE-free clock contracts

`MasterClock.hpp` defines `SyncConfig` with all four flags false and PPQN 24,
validates `1..960`, defines all four transport states, all four acquisition
states, internal/external source identity, diagnostics, compact plan descriptor,
immutable const-query plan, mapper, time-point query, and `MasterClock` APIs.
The focused translation unit rejects JUCE headers and compile-time assertions
verify trivial-copy contracts, compact plan size, `noexcept` queries/commit, and
the const `CurrentPlan()` pointer type.

### OpenSpec 2.1 — Deterministic core tests

`master_clock_tests.cpp` covers deterministic default/prepared state, 120-BPM
conversion, invalid prepare/tempo transactionality, receive authority rejection,
manual 90-BPM restoration, stopped and constructed-running affine queries,
integer and fractional positions, half-open endpoint rejection, exact end
anchors, exact adjacent lifetime anchors, future-only tempo slope changes,
stable committed plan values, bounded history eviction, delayed timestamp
mapping, and long-run finite monotonic time mapping.

### OpenSpec 2.2 — Affine clock core

`MasterClock::CommitBlock` commits one compact descriptor over
`[startSample, endSample)`, retains an exact mathematical end anchor for the next
ordinary plan, selects only the pending finite-positive slope for a new plan,
and stores descriptors in a fixed 64-entry ring. Plan and history queries perform
direct affine evaluation; no per-sample clock buffer exists. The current plan is
exposed only through `const ClockBlockPlan*`, and manual changes cannot mutate its
stored descriptor.

### OpenSpec 7.5 — AudioSampleTimeMapper portion

The mapper starts at `1'000'000 / sampleRate`, anchors the first output sample to
the first callback timestamp, stores the latest five phase errors, takes their
median, filters with gain `1/32`, and derives the next segment slope from the
filtered phase error over the observation span while clamping it to nominal
`+/-500 ppm`. Ordinary new segments start at the prior mapping's exact value.
An error strictly larger than output lookahead resets filter history, increments
generation/discontinuity/late diagnostics, and anchors the new segment at
`max(observedTimestamp, priorMathematicalEnd)`. Forward rounded microsecond and
inverse fractional-sample queries use a fixed 64-entry segment ring. Tests cover
all constants, exact continuity, past immutability, epoch inversion, both slew
limits, discontinuity reset, retained discontinuity error, bounded eviction, and
10,000 long-run observations.

## Realtime, Allocation, and noexcept Analysis

- `Phasor2Tick::Prime` and `Process` are `noexcept`, constant-work arithmetic,
  and runtime allocation interception measured zero allocations.
- `ClockBlockPlan` queries are `noexcept` affine calculations over one descriptor.
- `MasterClock::CommitBlock`, history lookup, direct time queries, mapper
  observation, and mapper conversions are `noexcept` and use only inline state,
  `std::array`, scalar `std::optional`, and bounded ring scans.
- The only sort handles at most five inline doubles. History scans are bounded at
  64 descriptors/segments. Work is independent of audio block frame count; no
  per-sample loop exists.
- There are no mutexes, atomics that can block, heap containers, allocation,
  I/O, sleeping, or host/JUCE calls in production clock code. A global allocation
  probe measured zero allocations across 1,000 consecutive commit/map/query
  iterations after prepare.
- Invalid direct plan queries are programming-contract violations guarded by
  assertions; `Try*` queries provide the non-throwing checked realtime surface.

## Deviations and Risks

- No accepted timing semantic was weakened. Task 2 production behavior
  (transport commands, external PLL/source lock, detector ownership, analytical
  crossings, scheduled-event seam) is deliberately absent.
- Cross-thread diagnostics publication is not wired in Task 1. This task defines
  the coherent trivially-copyable snapshot; the later Engine/runtime integration
  task owns lock-free publication to UI consumers.
- Mapper slope correction uses the filtered phase error divided by the most
  recent observation's sample span, then clamps around nominal. The artifacts
  mandate the median, EWMA gain, future-only correction, and slew cap but do not
  prescribe a different loop-filter denominator.
- The full-suite Braid deadline benchmark remains host-load-sensitive as
  described under GREEN evidence. Focused required and compile-regression gates
  are clean, and the unmodified deadline binary passes in isolation.

## Commits

Implementation commit (exact):

`439a8d26d95625350582bf749fe3bde777edfd8c` — `feat(synth): add master clock foundations`

The follow-up commit containing this report is metadata-only and intentionally
does not alter the implementation hash recorded above.
