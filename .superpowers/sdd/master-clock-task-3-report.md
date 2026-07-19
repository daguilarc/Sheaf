# Synth Master Clock/MIDI Sync — Task 3 Implementer Report

## Summary and Commit Range

Implemented OpenSpec tasks 4.1–4.4, 5.1–5.4, and 6.1–6.3 from exact base:

- base: `7a5383f587c1f7db10ebfdbbf81e8d3ef2b08130`
- implementation head: `38ba6ef85b3128563fb659d5fe5c1c2c251d265f`
- implementation commit: `feat(synth): integrate master clock runtime`
- task head: the metadata-only commit containing this report (its hash cannot
  be embedded in its own contents without changing that hash)

The implementation adds exact realtime MIDI ingress, deterministic Engine
dispatch into the Task 2 `MasterClock`, stable application clock/plan contracts,
deterministic SynthRig clock support, and atomic runtime-config schema v2 sync
persistence. It does not implement the concrete scheduled `MidiSender` lane,
JUCE/browser timestamped output, the Sync page, or application ADSR/tempo
consumption owned by later tasks.

## Paths

Implementation and tests commit (`38ba6ef8`):

- `projects/synth/Makefile`
- `projects/synth/include/synth/AppContext.hpp`
- `projects/synth/include/synth/Engine.hpp`
- `projects/synth/include/synth/MidiConfigBlocks.hpp`
- `projects/synth/include/synth/MidiConfigViewModel.hpp`
- `projects/synth/include/synth/MidiController.hpp`
- `projects/synth/include/synth/ParameterModulation.hpp`
- `projects/synth/include/synth/PatchPersistence.hpp`
- `projects/synth/src/MidiConfigBlocks.cpp`
- `projects/synth/src/MidiConfigViewModel.cpp`
- `projects/synth/src/MidiController.cpp`
- `projects/synth/src/ParameterModulation.cpp`
- `projects/synth/src/PatchPersistence.cpp`
- `projects/synth/tests/blocks_tests.cpp`
- `projects/synth/tests/browser_runtime_contract_tests.cpp`
- `projects/synth/tests/contract_tests.cpp`
- `projects/synth/tests/engine_tests.cpp`
- `projects/synth/tests/instrument_tests.cpp`
- `projects/synth/tests/parameter_modulation_tests.cpp`
- `projects/synth/tests/rig_tests.cpp`
- `projects/synth/tests/support/SynthRig.hpp`
- `projects/synth/tests/viewmodel_tests.cpp`

Metadata-only follow-up commit:

- `.superpowers/sdd/master-clock-task-3-report.md`

The additional MidiConfig blocks/view-model paths are required exhaustive
catalog, sort, description, edit, and switch consumers of `MessageIn::Continue`.
The browser contract test is an existing runtime-config API call site; no Task 5
browser functionality was added. The parent-owned progress ledger, task brief,
OpenSpec/plan checkboxes, untracked browser lockfile, and untracked
`projects/synth/miniapp/` were not edited or staged.

## Semantics Checkpoint

Before implementation, the following dispatch semantics were recorded with the
parent and accepted:

- total realtime order is timestamp, Internal before ExternalMidi, external
  controller slot ascending, then stable arrival order; because UI is drained
  before MIDI, otherwise-exact cross-bus ties retain UI-before-MIDI order;
- one 256-entry fixed-capacity batch spans both buses, retains the earliest
  messages under that total order, drops the latest/newest ordered overflow,
  and increments an observable counter;
- Internal Start/Continue/Stop always reach MasterClock, ExternalMidi realtime
  messages retain exact `BasicMidi::timestamp` and controller slot, external
  receive/source policy remains inside MasterClock, and Internal Clock is inert;
- loaded sync must be visible at initial processor rebuild, Prepare, and the
  first committed block.

## RED Evidence

### MIDI ingress RED

```text
(cd projects/synth && make -B build/instrument_tests build/contract_tests)
```

Exited `2`. The new focused contracts did not compile because `MessageIn` had
no `Continue`, `Origin`, external slot identity, or realtime terminal processor.

### Engine/AppContext/SynthRig RED

```text
(cd projects/synth && make -B build/engine_tests build/rig_tests)
```

Exited `2`. The new tests failed on the intended absent contracts, including
`AppContext::masterClock`, `AudioBlock::clockPlan`, Engine clock/sink access,
and timestamped SynthRig clock helpers.

### Runtime-config RED

```text
(cd projects/synth && make -B build/parameter_modulation_tests)
```

Exited `2`. Runtime configuration still exposed the schema-v1 instrument/audio
API and had no `SyncConfig` serialization, migration, or atomic load argument.

No production implementation was added before these missing-contract failures
were observed. The first focused Engine GREEN then passed, and the existing
processor-chain assertions were reconciled only by explicitly asserting the new
terminal processor type and position.

## GREEN and Verification Evidence

Fresh forced affected build and run:

```text
make -C projects/synth -B \
  contract_tests engine_tests \
  build/instrument_tests build/rig_tests \
  build/parameter_modulation_tests build/blocks_tests \
  build/viewmodel_tests build/browser_runtime_contract_tests
projects/synth/build/instrument_tests
projects/synth/build/rig_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/blocks_tests
projects/synth/build/viewmodel_tests
projects/synth/build/browser_runtime_contract_tests
```

Exit `0`. All affected sources rebuilt under C++20
`-Wall -Wextra -Wpedantic -O2` without compiler warnings, and every focused
contract, ingress/controller, Engine, SynthRig, persistence, block/view-model,
and browser runtime-contract case passed.

An exact missing-v2-`sync`-member atomicity case was added during the final
report audit; a subsequent forced `build/parameter_modulation_tests` rebuild and
complete binary run also exited `0` before the implementation commit was
finalized.

Direct sanitizer build and run:

```text
make -C projects/synth -B \
  BUILD_DIR=/tmp/sheaf-master-clock-task3-asan \
  CXX=clang++ \
  CXXFLAGS='-std=c++20 -Wall -Wextra -Wpedantic -O1 -g \
    -fsanitize=address,undefined -fno-omit-frame-pointer' \
  /tmp/sheaf-master-clock-task3-asan/instrument_tests \
  /tmp/sheaf-master-clock-task3-asan/engine_tests \
  /tmp/sheaf-master-clock-task3-asan/rig_tests \
  /tmp/sheaf-master-clock-task3-asan/parameter_modulation_tests
/tmp/sheaf-master-clock-task3-asan/instrument_tests
/tmp/sheaf-master-clock-task3-asan/engine_tests
/tmp/sheaf-master-clock-task3-asan/rig_tests
/tmp/sheaf-master-clock-task3-asan/parameter_modulation_tests
```

Exit `0`; all four complete sanitized binaries passed with no AddressSanitizer
or UndefinedBehaviorSanitizer diagnostic.

Full regression and specification validation:

```text
make -C projects/synth test
openspec validate add-synth-master-clock-midi-sync --strict
```

Both exited `0`. The entire synth suite passed, including all five Braid 4
deadline cases, and OpenSpec reported the change valid.

Scope and formatting checks:

- `git diff --check`: exit `0` before staging.
- `git diff --cached --check`: exit `0` before the implementation commit.
- staged audit contained exactly the 22 implementation/test paths listed
  above; the only tracked unstaged path was the parent-owned progress ledger.
- exact-base review used
  `git diff --name-status 7a5383f587c1f7db10ebfdbbf81e8d3ef2b08130`.

## Evidence Area 1 — MIDI Ingress and Deterministic Dispatch

`MessageIn` now has `Continue`, explicit `Origin { Internal, ExternalMidi }`,
and external controller-slot identity. Existing factories retain Internal
defaults. Equality, named JSON, catalogs, sort keys, view-model editing and
descriptions, and exhaustive switches include the new state. Internal JSON
omits provenance for compatibility; explicit external provenance round-trips
with its required slot.

Every profile chain, including an otherwise-empty profile, now ends in
`RealtimeMidiInProcessor`. It consumes only exact one-byte `F8`, `FA`, `FB`, and
`FC`, converting them to distinct ExternalMidi Clock, Start, Continue, and Stop
messages with the untouched integer-microsecond `BasicMidi::timestamp` and the
source slot. Multi-byte lookalikes, unsupported realtime status, and ordinary
MIDI pass through unchanged exactly once. Existing mapped processors keep their
prior order and behavior.

Engine drains due UI then MIDI messages. Ordinary parameter/grid messages are
applied normally; realtime messages enter one inline insertion-sorted array.
Tests prove an earlier MIDI timestamp outranks UI drain order, external slot 2
outranks slot 9 at equal time, exact ties remain stable, and the 257th ordered
input increments the drop counter while the earliest 256 are retained. Routing
calls MasterClock's external clock/transport APIs with original timestamp and
slot, while internal transport bypasses receive gating.

## Evidence Area 2 — Engine/AppContext/SynthRig Integration

Engine owns one inline `MasterClock` for its full lifetime, wires its stable
address into `AppContext` before application `Init`, prepares it first from the
negotiated output sample rate/block size, and exposes sink injection plus direct
clock inspection. Each block routes due input, assigns the prior sample-counter
value to `block.startSample`, attempts exactly one plan/crossing commit, assigns
the exact `MasterClock::CurrentPlan()` pointer to `block.clockPlan` on success,
then invokes the optional frame hook and exactly one application block callback.
The nullable edge contract and review fix are recorded below. The application
fixture captures the descriptor before/after work, observes sink enqueue before
delegation, and verifies exact adjacent `[0,64)` / `[64,128)` anchors.

SynthRig supports negotiated sample rate/block size, explicit block timestamps,
Internal and ExternalMidi transport/clock injection, current-plan and direct
sample/timestamp queries, and a fixed 16,384-entry newest-drop scheduled-event
sink. Tests exercise internal Start/Continue/Stop, raw empty-profile external
Start/Clock, external Stop/Continue/reactivation, equal sample time under 7- and
13-frame partitions, the Braid convention
`block.startSample + internalIndex / 4.0`, 2,000 long-run blocks with finite
monotonic lifetime time, finite audio, and bounded completion.

Realtime instrumentation intercepts allocation globally after warmup and
observes zero allocations across 128 full Engine blocks at PPQN 960, including
plan commit, fractional direct/plan queries, analytical crossings, and sink
enqueue. A second test holds the Engine configuration mutex on another thread
and proves a steady-state ProcessBlock completes before release under a bounded
two-second deadline. Production realtime storage is `std::array`/scalar state;
the dispatch path performs no I/O, sleep, heap operation, or per-audio-frame
clock loop.

## Evidence Area 3 — Runtime Config v2 and Startup Ordering

Runtime config now always writes schema version 2 and a `sync` object containing
exactly `sendClock`, `receiveClock`, `sendTransport`, `receiveTransport`, and
integer `ppqn`. All booleans require JSON Boolean values; PPQN requires an
integer in `1..960`. Valid non-default values round-trip. Schema-v1 documents
load with `SyncConfig{}` (four false flags, PPQN 24), and subsequent save uses
v2.

Parsing uses scratch instrument, audio, and sync values and assigns only after
all three succeed. Tests reject a missing sync object, each missing field, a
wrong type for each boolean, non-object/extra-field shapes, non-integer PPQN,
negative/zero/961 PPQN, invalid instrument, invalid audio, invalid schema, and
missing/invalid files without changing any caller-owned field. Patch JSON
remains parameter-only and explicitly has no sync member.

Engine startup loads all three scratch values, applies the validated sync policy
before installing instrument/audio state and before the initial processor
rebuild. The order test observes loaded sync in the pre-rebuild callback, then
verifies the same policy at clock Prepare and on the first committed block,
including its scheduled output. Runtime save snapshots current instrument,
audio device, and MasterClock sync state into v2.

## Deviations and Remaining Boundaries

- No accepted Task 3 semantic was weakened and no production behavior remains
  knowingly incomplete within tasks 4.1–4.4, 5.1–5.4, or 6.1–6.3.
- Braid 4 and MiniApp do not consume the clock yet. Per the brief, SynthRig and
  Engine fixtures prove the integer/fractional query contract without modifying
  application DSP or prematurely implementing Task 7.
- The scheduled sink is injected and tested here, but concrete `MidiSender`
  scheduling, host delivery, mapper integration completion, and worker lifecycle
  remain Task 4. Browser timestamped delivery remains Task 5; Sync UI remains
  Task 6.
- Runtime sync is applied during single-threaded startup here. The later Sync
  page owns the audio-safe live-update handoff, staged editing, and host-service
  wiring.

## Review Fix — Nullable `AudioBlock::clockPlan`

Opus review returned specification-compliance PASS and code-quality PASS with
one minor documentation finding: Engine delegates to the application even when
`MasterClock::CommitBlock` returns null, but the app-facing field did not state
when null is possible.

Implementation review-fix commit:

`d256256f69d9e370361c0b76d9c6ccd35e94130f` —
`fix(synth): define nullable audio clock plan`

The existing runtime behavior was preserved. `AudioBlock::clockPlan` now states
that it is the non-owning exact `MasterClock::CurrentPlan()` only for a
successful prepared, nonzero, contiguous commit; it is null for default views,
before successful clock preparation, for zero-frame callbacks, or any rejected
commit. Applications must null-check it and must not retain it as an immutable
snapshot across callbacks because the next successful commit replaces the
pointed-to plan. Engine's block-order contract now explicitly says delegation
still occurs exactly once when the commit is rejected.

The focused Engine characterization
`engine_delegates_with_null_clock_plan_before_prepare_and_for_zero_frame_blocks`
proves both null cases, exact once-per-block delegation, no current plan, zero
sample-position consumption for the zero-frame callback, and successful
recovery with the following `[0,64)` block. No runtime branch or clock behavior
changed.

Fresh review-fix verification:

```text
make -C projects/synth -B contract_tests engine_tests
git diff --check
git diff --cached --check
```

The forced rebuild and both complete focused suites exited `0` without compiler
warnings; diff checks were clean. The follow-up commit containing this section
is metadata-only.
