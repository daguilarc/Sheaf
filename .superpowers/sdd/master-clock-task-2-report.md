# Synth Master Clock/MIDI Sync — Task 2 Implementer Report

## Summary

Implemented Task 2 from base
`abfc1d6edcf5cbeaf03352b25605a02bac646a0c` in implementation commit
`3d110a33e4c4c5c922f7677315fbfd2470ab43e8`:

- committed-plan-visible `Stopped`, `ArmedStart`, `ArmedContinue`, and `Running`
  transport state, with boundary-timed internal commands and original-timestamp
  external transitions;
- timestamped first-clock activation, current-run (not song-position) Continue,
  output-only activation/Stop splices, detector priming, phase generations, and
  exact due-time cutoffs;
- an isolated fixed-state external estimator/PLL with the accepted median,
  EWMA, missed-pulse, phase-correction, hard-reacquire, and dropout policies;
- deterministic controller-slot provisional/locked ownership, foreign-source
  rejection, timeout, takeover, and coherent diagnostics;
- analytical stopped-lifetime/running-transport crossing enumeration through
  the owned `Phasor2Tick`, including half-open endpoints, fractional deadlines,
  PPQN reprime, tick-zero deduplication, and bounded overflow;
- a JUCE-free trivially-copyable `ScheduledMidiEvent` and non-owning
  `IScheduledMidiEventSink::TryEnqueue(...) noexcept` producer boundary.

Review-fix implementation commit
`758f005347c116205a68715ffbb33302628d3508` adds one explicit 4096-candidate
budget across an entire retained-history splice, documents the uncorrected
tempo-versus-corrected-slope contract, and documents the safe fallback for an
activation outside retained committed history.

Engine/`MessageIn`, concrete `MidiSender`, host delivery, persistence, UI,
browser, and application integration remain outside this task.

## Files

Implementation commit:

- `projects/synth/include/synth/MasterClock.hpp`
- `projects/synth/src/MasterClock.cpp`
- `projects/synth/tests/master_clock_tests.cpp`
- `projects/synth/Makefile`

This follow-up report commit contains only:

- `.superpowers/sdd/master-clock-task-2-report.md`

The existing progress ledger, OpenSpec artifacts/checklists, Task 1 metadata,
untracked `projects/synth/miniapp/`, and
`projects/synth/browser/package-lock.json` were not edited or staged.

## RED Commands and Results

Initial Task 2 RED:

```text
make -C projects/synth -B master_clock_tests
```

Exited `2`. The new tests failed to compile on the intended missing contracts,
including:

```text
no member named 'ScheduledMidiEvent' in namespace 'synth'
no member named 'HandleInternalTransport' in 'synth::MasterClock'
no member named 'HandleExternalTransport' in 'synth::MasterClock'
no member named 'HandleExternalClock' in 'synth::MasterClock'
```

Self-review arbitration RED:

```text
make -C projects/synth master_clock_tests
```

Exited `2` after the focused binary failed
`master_clock_repeated_provisional_owner_transport_refreshes_its_timeout` at
`sourceTimeoutCount == 0`. Root cause: a same-slot repeated Start/Continue was
accepted but did not refresh the provisional owner's activity timestamp. The
minimal fix updates activity only for an accepted provisional Start/Continue;
locked source health remains driven only by accepted clocks.

Self-review authority RED:

```text
make -C projects/synth master_clock_tests
```

Exited `2` after the focused binary failed
`master_clock_transport_only_external_input_keeps_internal_tempo_authority` at
`acquisition == Internal`. Root cause: the shared ownership helper conflated a
provisional transport-controller owner with external tempo authority. The
minimal fix retains `Internal` acquisition/source diagnostics while
receive-clock is disabled, without weakening deterministic transport ownership.

The first compiled GREEN attempt also exposed two incorrect test-fixture
assumptions: integer-microsecond rounding crossed the strict `> 2`-pulse
reacquire threshold one observation earlier than assumed, and a five-entry test
sink had not filled. The fixtures were corrected to issue a deliberate
two-pulse jump and use a genuinely full four-entry sink; no production policy
was weakened for those corrections.

Review-fix composite-bound RED:

```text
make -C projects/synth master_clock_tests
```

Exited `2` after the new
`master_clock_delayed_splice_has_one_total_crossing_iteration_budget` case
failed its total-budget assertion; the other 36 cases passed. Root cause: the
4096-candidate affine limit was reset independently for every one of the 64
retained plan descriptors, permitting 262,144 candidate iterations in one
delayed splice.

## GREEN Commands and Results

Focused Task 2 test:

```text
make -C projects/synth master_clock_tests
```

Exit `0`; all 36 clock/mapper/transport/PLL/crossing cases passed.

Fresh affected build/regression gate:

```text
make -C projects/synth -B dsp_tests master_clock_tests contract_tests engine_tests
```

Exit `0`; all sources rebuilt under C++20 `-Wall -Wextra -Wpedantic`, all DSP
tests, all 36 master-clock tests, all contract tests, and all engine tests
passed without compiler warnings.

Sanitizer gate after the final self-review fix:

```text
clang++ -Iprojects/synth/include -std=c++20 -Wall -Wextra -Wpedantic -O1 -g \
  -fsanitize=address,undefined projects/synth/tests/master_clock_tests.cpp \
  projects/synth/src/MasterClock.cpp \
  -o /tmp/sheaf-master-clock-task2-final-asan
/tmp/sheaf-master-clock-task2-final-asan
```

Exit `0`; all 36 cases passed with no AddressSanitizer or
UndefinedBehaviorSanitizer diagnostics.

Full synth regression:

```text
make -C projects/synth test
```

Exit `0`; the entire core suite passed. All five load-sensitive Braid deadline
cases passed in this full run, including both 96 kHz cases, so no isolated
retry was needed.

Additional verification:

- `git diff --check`: exit `0`.
- `git diff --cached --check`: exit `0` before the implementation commit.
- Exact-base and staged-path audits contained only the four implementation
  paths listed above.
- A source audit found no heap container, mutex, allocation, I/O, sleep, or
  per-audio-frame loop in the production clock path.

Review-fix GREEN and fresh verification:

- `make -C projects/synth master_clock_tests`: exit `0`, 37/37 cases passed.
- `make -C projects/synth -B dsp_tests master_clock_tests contract_tests
  engine_tests`: exit `0`, with all sources rebuilt warning-free and all
  affected suites passing.
- Direct `clang++` AddressSanitizer plus UndefinedBehaviorSanitizer build/run:
  exit `0`, 37/37 cases passed with no diagnostics.
- `make -C projects/synth test`: exit `0`; the complete synth suite and all
  five Braid deadline cases passed.
- The staged implementation-fix audit contained only `MasterClock.hpp`,
  `MasterClock.cpp`, and `master_clock_tests.cpp`; diff checks passed.

## State-Transition Table

| Accepted input | Clock authority | Effective application state | Transport anchor / epoch | Output action |
|---|---|---|---|---|
| Internal Start | Internal | `Running` at next plan boundary | zero; epoch increments | boundary cutoff, optional `FA`, explicit zero `F8`, detector primed at zero |
| Internal Continue | Internal | `Running` at next plan boundary | zero; epoch increments; no song-position restore | as above with optional `FB` |
| Internal Start/Continue | External receive | matching `Armed*` at next plan boundary | zero; epoch waits for activation | optional boundary transport; if previously Running, switch/prime lifetime grid |
| External Start/Continue | External receive | matching `Armed*` in next committed plan | zero while armed | optional transport at original timestamp plus latency; first accepted owner clock activates |
| Accepted clock while Armed | External receive | `Running` in next committed plan | tick zero at original timestamp; projected to next block start; epoch increments | timestamp cutoff, explicit zero `F8`, transport-grid splice, next detector pulse at `1/PPQN` |
| External Start/Continue | Internal clock | `Running` in next committed plan | zero at original timestamp, projected forward; epoch increments | timestamp cutoff, optional `FA`/`FB`, explicit zero `F8`, transport-grid splice |
| Internal Stop | Either | `Stopped` at next plan boundary | zero; lifetime unchanged; epoch unchanged | boundary cutoff if Running, optional `FC`, lifetime detector prime, no switch tick |
| External Stop | Either | `Stopped` in next committed plan | zero; lifetime unchanged; epoch unchanged | original-timestamp cutoff/splice if Running, optional `FC`, lifetime detector prime, no switch tick |
| Repeated Start/Continue | As above | re-arms or starts a new zero-based run | later activation increments a new epoch | accepted transport intent remains distinct |
| Repeated Stop | Any | remains `Stopped` | remains zero | idempotent state; optional accepted `FC` still emitted |

External messages failing receive gating or healthy-source ownership are inert
and increment `ignoredInputCount`. Internal transport bypasses receive-transport
gating. `MasterClock::TransportState()` continues to expose the immutable
current plan between message handling and the next commit, so a delayed splice
never mutates the application-visible prior plan.

## PLL Equations and Constants

For accepted source timestamps `t_i`, filtered pulse period `P`, configured
`q = PPQN`, and output sample rate `F_s`:

1. Raw interval: `delta = t_i - t_(i-1)` in integer microseconds. Non-positive
   time is rejected.
2. With an estimate, infer
   `k = clamp(round(delta / P), 1, 8)` and normalize
   `d = delta / k`. Accept only when `abs(d - P) / P <= 0.25`; this rejects
   early duplicates/outliers and counts `k - 1` inferred missed pulses.
   Without an estimate, the first positive interval uses `k = 1` and seeds it.
3. Retain the latest five normalized intervals and compute `M = median(last 5)`
   (or the available prefix during acquisition). The first interval sets
   `P = d`; later intervals apply exactly `P <- P + (M - P) / 8`.
4. Recovered tempo is `BPM = 60,000,000 / (q * P)`, and the uncorrected future
   slope is `I_base = 1,000,000 / (q * P * F_s)` quarter notes per sample.
5. The target input-tick phase is `Q_target = A + n / q`. Measured phase error
   in pulse periods is `e = (Q_target - Q_lifetime(t_i)) * q`.
6. If `abs(e) > 2`, hard reacquire re-seeds
   `A = Q_lifetime(t_i) - n / q` without changing a committed anchor. Otherwise
   `c = clamp(e / 4, -1/4, +1/4)` and
   `I_next = I_base * (1 + c)`. This is one quarter of measured phase error,
   capped at one quarter pulse and spread across one pulse horizon. Therefore
   the corrected slope remains finite positive in `[0.75, 1.25] * I_base`.

The first clock establishes source/phase without replacing the prior tempo;
the first positive interval seeds period; acquisition becomes `Locked` after
two valid intervals. Exact rounded 120-BPM/24-PPQN input is within `0.1 BPM`
after 64 intervals. Timeout leaves `activeBpm_` and the last positive pending
slope intact, yielding `FreeRun` rather than stopping or snapping.

`activeBpm_`, `TempoBpm()`, and diagnostics `currentBpm` expose the manual or
filtered-estimator tempo from `P`; they deliberately exclude the transient
bounded phase correction. `QuarterNotesPerSample()` exposes the future slope
and may therefore differ from the uncorrected BPM conversion while correction
is active.

## Source Arbitration

- External clock is accepted only with receive-clock enabled; external
  transport is accepted only with receive-transport enabled.
- The first valid clock claims its controller slot deterministically.
- With no clock owner, the first accepted Start/Continue may claim a provisional
  controller slot. Repeated accepted Start/Continue from that same provisional
  owner refreshes the provisional timeout.
- While an owner is healthy, foreign clocks and transport are rejected and do
  not alter tick index, estimator, BPM, phase, or transport.
- Locked health is refreshed only by accepted owner clocks. The timeout is
  `max(500,000 us, ceil(4 * P))`; before a period exists, the retained active BPM
  supplies the equivalent pulse period.
- Timeout clears ownership and interval/phase acquisition state, reports
  `FreeRun`, but retains BPM, future slope, transport, and accumulator
  continuity. The next valid clock can claim a new slot and re-seeds phase while
  retaining tempo until its first positive interval.
- Transport-only provisional ownership does not claim external tempo authority
  when receive-clock is disabled; diagnostics remain `Internal`.

## OpenSpec Evidence

### 2.3–2.4 — Transport tests and state machine

The focused suite covers boundary-timed internal Start/Continue/Stop,
external timestamp-separated Start and first clock, Armed states, original-time
tick zero, first-plan projection, repeated Stop and provisional Continue,
immutable prior plans, epoch increments, zero-on-Continue current-run semantics,
receive gating, and distinct `FA`/`FB`/`FC` intent. Production staging keeps
internal effects at the next commit and external effects at normalized
timestamps while exposing only committed state to applications.

### 2.5–2.6 — Analytical crossings and scheduled producer seam

Tests cover stopped lifetime and running transport grids, fractional sample and
microsecond deadlines, exact half-open ownership, explicit zero deduplication,
Start/Continue ordering, output-only activation/Stop fill, Stop reprime without
an immediate tick, lifetime resumption, PPQN reprime without a synthetic tick,
phase generation/cutoff values, overflow observation, and send+receive
regeneration. `ScheduledMidiEvent` carries due time, sequence, broadcast intent,
equal-time ordering intent, phase generation, invalidated generation, and exact
cutoff. Transport uses generation zero so a grid cutoff cannot discard the
command that caused it. The sink is non-owning and `TryEnqueue` is `noexcept`.

Analytical enumeration solves integer PPQN cells from affine segment endpoints,
maps the fractional crossing through `AudioSampleTimeMapper`, and adds fixed
latency. Candidates alone are fed in order to the owned `Phasor2Tick`; it is
primed on every grid/source switch and remains the last-cell/dedup authority.

### 3.1–3.2 — External estimator/PLL

Timestamp traces cover exact recovery, exact median/`1/8` values, alternating
jitter, duplicate/out-of-order and 40%-late outlier rejection, elapsed-pulse
multiples `2..8`, positive and negative bounded correction, strict hard
reacquisition beyond two pulse periods, immutable committed slopes, and dropout
free-run. The estimator is inline fixed state with a five-entry ring; no public
estimator API or heap ownership was added.

### 3.3–3.4 — Multi-controller arbitration and diagnostics

Tests cover deterministic first source, provisional Start ownership, repeated
owner refresh, foreign clock/transport rejection, the 500-ms floor, a larger
four-period timeout, takeover, retained BPM, lifetime continuity, PPQN lock
reset, and coherent source/acquisition/counter diagnostics.

### Clock-side 7.5 — Mapper-derived latency and crossing deadlines

Task 1's mapper remains unchanged. Task 2 consumes its fractional forward and
inverse maps, adds `max(2 * block duration, 5 ms)`, preserves original external
transport/zero timestamps, publishes a new phase generation on transitions and
mapper discontinuities, and validates fractional deadline rounding, spacing,
half-open ownership, splice handoff, overflow, and fixed-offset regeneration.
The external splice trace produces the first post-zero 24-PPQN crossing at
`1,230,833 us` from a `1,010,000 us` zero plus `200,000 us` latency, within the
required integer-microsecond rounding bound.

## Realtime Complexity, Allocation, and noexcept Proof

- `HandleInternalTransport`, `HandleExternalTransport`, `HandleExternalClock`,
  and `CommitBlock` are compile-time checked `noexcept`.
- Estimator history is a five-double ring and median sort is bounded to five
  inline values. Source arbitration is scalar constant work.
- Pending internal transport storage is fixed at 16 entries; plan/splice scans
  are bounded at the existing 64 descriptors.
- Crossing work is analytical and proportional to musical crossings, never
  output frames or oversampled frames. Ordinary current-plan production
  processes at most 4096 candidate cells per affine segment. A delayed splice
  scans at most 64 fixed descriptors and shares one 4096-candidate iteration
  budget across the complete scan. Excess newer events are counted as dropped,
  while detector authority advances analytically to each final crossed cell.
- The production path contains no dynamic container, `new`, mutex, lock, I/O,
  sleep, host/JUCE call, or per-audio-sample loop.
- A global allocation interceptor measured zero allocations across 1,000
  consecutive external-clock observations, block commits, affine queries,
  candidate detection, and fixed-capacity sink enqueues.
- Sink rejection implements newest-drop behavior at the producer boundary and
  increments `droppedOutputCount`; the audio producer never retries or waits.
- `ScheduledMidiEvent` and all coherent diagnostic/config/plan values are
  trivially copyable and JUCE-free.

## Deviations and Risks

- No Task 3–8 integration was implemented. In particular, this task defines
  but does not implement the concrete SPSC `MidiSender` lane or worker-side
  cutoff filtering; Task 4 owns that consumer.
- To reconcile finite realtime work with an otherwise unbounded positive core
  tempo, ordinary analytical production caps one affine segment at 4096
  candidates, and delayed splice reconstruction caps the entire retained
  history at 4096 candidate iterations. Excess newest crossings are observable
  drops and the detector advances so later blocks do not replay stale cells.
  This is far above valid musical rates/block sizes but should remain aligned
  with the concrete lane capacity chosen in Task 4.
- Exact output-only splice fill requires the normalized timestamp to remain in
  the existing bounded mapper/plan history. The specified fixed latency keeps
  normal handoff within that window. If this latency contract is violated, the
  intentional safe fallback starts the next committed run at zero and skips
  retroactive reconstruction rather than extrapolating an unknown evicted
  output phase.
- Sync configuration has no timestamp in the Task 2 public seam, so send-clock
  and PPQN detector reconfiguration is committed at the next plan boundary.
- Physical delivery accuracy and worker late-event handling remain Task 4 host
  concerns; this task verifies computed producer deadlines only.

## Exact Commits

Base commit:

`abfc1d6edcf5cbeaf03352b25605a02bac646a0c`

Task 2 implementation commit:

`3d110a33e4c4c5c922f7677315fbfd2470ab43e8` — `feat(synth): add clock transport and external sync`

Initial metadata-only report commit:

`394d42b90911869f3c79ad60767790513259ddc3` — `docs(synth): report master clock task 2`

Review-fix implementation commit:

`758f005347c116205a68715ffbb33302628d3508` — `fix(synth): bound delayed clock splices`

The follow-up commit updating this report is metadata-only and intentionally
does not alter either implementation hash recorded above.
