# Task 6 Report: Braid4 Structural/Deadline Regression and Coverage Closure

## Scope

- Added one authoritative Braid4 work-counter case covering baseline,
  capacity-filled neutral local trees, one sparse active route, and 64
  configured inactive gestures for the same 32 host frames / 128 internal
  subframes.
- Added sparse-active deadline cases alongside the existing baseline cases at
  48 kHz host / 192 kHz internal and 96 kHz host / 384 kHz internal.
- Added precise `spm-20`, `spm-25`, `spm-72`, `spm-73`, and `spm-74` coverage
  mappings and documented deterministic counters as authoritative while timing
  remains platform-sensitive smoke evidence.

## TDD Evidence

RED was observed before fixture implementation:

```text
tests/braid4_system_tests.cpp:475:11: error: unknown type name 'Braid4WorkResult'
tests/braid4_system_tests.cpp:475:57: error: use of undeclared identifier 'Braid4WorkScenario'
...
8 errors generated.
make: *** [build/braid4_system_tests] Error 1
```

The first fixture implementation then produced a meaningful assertion RED:

```text
[FAIL] braid4_sparse_work_counters_bound_inactive_capacity:
requirement failed: materialized == availableBefore
```

That exposed that a first-level-only traversal could not fill every available
local slot in each Braid4 group. The fixture was corrected to traverse the real
materialized local tree breadth-first, after which all focused tests passed.

## Deterministic Work Contract

`braid4_sparse_work_counters_bound_inactive_capacity` verifies:

- all four scenarios process equal internal-subframe counts;
- all four scenarios make equal top-level `ProcessLite` calls;
- filling every materializable local slot with neutral nodes leaves zero active
  route visits;
- 64 configured inactive gestures produce zero active gesture visits;
- the sparse route case produces nonzero route visits below the dense configured
  theoretical visit count.

The 64-gesture fixture calls `SetGestureCount(64)` before `Engine::Initialize()`
creates Braid4's groups.

## Deadline Evidence

Focused run measurements (256-frame blocks, generous existing ceilings):

| Scenario | Host/internal rate | Average | p99 |
|---|---:|---:|---:|
| baseline | 48/192 kHz | 1.03810 ms | 1.06567 ms |
| sparse-active | 48/192 kHz | 1.04574 ms | 1.07104 ms |
| baseline | 96/384 kHz | 1.02816 ms | 1.04525 ms |
| sparse-active | 96/384 kHz | 1.04270 ms | 1.11071 ms |

No speedup ratio is asserted.

## Verification

- `make -C projects/synth build/braid4_system_tests build/braid4_deadline_tests`: PASS
- `projects/synth/build/braid4_system_tests`: PASS
- `projects/synth/build/braid4_deadline_tests`: PASS
- `make synth-test`: PASS (exit 0)
- `openspec validate scale-modulation-processing --strict`: PASS
- `git diff --check`: PASS
- `git diff --exit-code 5a1e9408 -- projects/synth/browser projects/synth/tests/browser_command_buffer_tests.cpp`: PASS; no browser format, version, payload, or command-buffer test change

## Commit

`baf2c608` — `test(synth): guard sparse modulation scaling`

The task brief and this report remain uncommitted. OpenSpec checkboxes and SDD
progress were intentionally not edited; the root agent owns Step 6 closure.
