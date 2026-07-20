# Master Clock Task 8 Report

Implementation base: `822b8096`

Scoped implementation commit: `0c1054bf1659985021017ac02eafccc2792830e1`

## Outcome

Task 8 adds four deterministic acceptance traces, repairs both specified JUCE
aggregate fixtures, documents the complete master-clock/MIDI-sync contract, and
maps every changed OpenSpec requirement to concrete tests. No production source
was changed: the traces passed against the existing runtime after test-only
fixture repairs.

## Files Changed

- `projects/synth/tests/master_clock_tests.cpp`: fixed-capacity trace helper and
  internal timeline, external acquisition, and mapper/output calculation traces.
- `projects/synth/tests/midi_sender_tests.cpp`: fixed-capacity concrete sender
  broadcast/reconnect/cutoff/fallback trace.
- `projects/synth/juce/ControllersPageSimulationTests.cpp`: replace the stale
  removed renderer with `synth_juce::PortableComponent`.
- `projects/synth/juce/MiniAppJuceBackendParityTests.cpp`: supply the required
  local `GridManager` through `AppContext`.
- `projects/synth/README.md`: current realtime routing, master-clock summary,
  Sync page, runtime config schema v2, and architecture-document link.
- `projects/synth/docs/master-clock-and-midi-sync.md`: focused ownership,
  timeline, transport, epoch, mapper, scheduling, threading, persistence,
  diagnostics, and fallback contracts.
- `projects/synth/docs/coverage.md`: explicit changed-requirement rows and
  scenario-to-test audit.

## RED And GREEN Evidence

The required MiniApp aggregate fixture sequence was reproduced before repair:

1. `make -C projects/synth/apps/miniapp test` exited `2` while compiling
   `ControllersPageSimulationTests.cpp:359`: removed
   `synth_runtime::ControllersTreeRenderer` did not exist.
2. After only the renderer repair, the same command exited `2` because
   `MiniAppJuceBackendParityTests` aborted with
   `MiniApp requires an initialization-time grid manager`.
3. After adding a local `synth::GridManager` to that handcrafted context, the
   unchanged aggregate command exited `0`; all seven JUCE executables passed,
   including both repaired fixtures.

The new acceptance cases were developed in the existing deterministic C++
harnesses. Test-construction compile/projection assumptions were corrected only
in test code. All four traces then passed without any production edit, so no
production behavior defect or production RED/fix cycle was present.

## Deterministic Trace Results

- Internal timeline:
  `[trace] internal_timeline plans=5 endpoint_due_us=1375000 fractional_tick_due_us=1527778 epochs=0,0,1,2,2`
  covers stopped lifetime, half-open endpoint ownership, exact anchors,
  boundary tempo change, fractional query/crossing, Start, Continue, Stop, and
  equal-deadline transport-before-clock ordering.
- External acquisition:
  `[trace] external_acquisition records=10 bpm_error=0.00191994 jitter_filtered_us=20876.8 ignored=3 missed=2 takeover_slot=4`
  covers 64 stable intervals, alternating jitter, invalid input, missed pulses,
  dropout/free-run, provisional ownership, foreign rejection, armed Start and
  Continue activation, Stop, regeneration, timeout, and takeover. Recovered
  120-BPM error was `0.00191994 BPM <= 0.1 BPM`.
- Mapper/output calculation:
  `[trace] mapper_output deadline_max_us=0.5 spacing_max_us=10.6667 slew_allowance_us=10.4167 fixed_offset_max_us=0 median_us=50 generation=2`
  directly checks `0.5 us <= 1 us` deadline error, `10.6667 us <= 2 us +
  10.4167 us` spacing allowance with the 500-ppm component calculated
  separately, and `0 us <= 1 us` fixed-offset error. It also checks the
  independent five-error median, `1/32` EWMA, ordinary continuity, both
  500-ppm slope signs, fractional crossings, and discontinuity generation.
- Concrete sender:
  `[trace] concrete_sender records=13 broadcast_deadlines=5 stale_drops=1 reconnect_first_us=200000 fallback=1`
  covers identical ordered deadlines at two timestamped sinks, offline
  non-stall, future-only reconnect, equal-deadline ordering, exact generation
  cutoff, and the observable immediate-only fallback lane.

These are deadline calculation, queue ordering, and host-submission contracts;
they intentionally do not claim physical thread wakeup or MIDI-device delivery
within one microsecond.

## Requirement-To-Test Audit

`projects/synth/docs/coverage.md` now has an explicit summary row and detailed
mapping for every required ID:

- `sdsp-42`: six `phasor2tick_*` cases cover silent priming/same-cell work,
  crossings, discontinuities, validation, and allocation-free processing.
- `smc-1` through `smc-5`: Engine stable ownership/current-plan tests, the
  internal-timeline trace, focused clock-plan/history/tempo-authority cases,
  transport cases, gate/PPQN cases, and Braid fractional 4x queries.
- `smc-6` through `smc-8`: external-acquisition trace, focused source/PLL/
  dropout/splice cases, Engine timestamp ordering, and cross-sender regeneration.
- `smc-9`: mapper/output and concrete-sender traces plus focused mapper,
  half-open, lateness, overflow, reconnect, generation, and cutoff cases.
- `smc-10` and `smc-11`: schema v1/v2 migration, atomic validation,
  patch exclusion, coherent diagnostics publication, and portable host status.
- `smi-10` through `smi-12`: terminal realtime factory/processor/profile/Rig
  paths; sender realtime-lane tests; browser epoch/scheduling tests; JUCE
  scheduling-capability, epoch, and future-deadline adapter assertions.
- `sar-3`, `sar-6`, `sar-11`, `sar-18`: Engine preparation/block/config paths,
  Rig clock surface, MiniApp ADSR/tempo cases, Braid oversampling, and host save.
- `sru-2`, `sru-12`, `sru-30`: shared sidebar/deadline, save-on-Back policy,
  portable Sync model, JUCE shell, browser contract, and Playwright acceptance.

No OpenSpec scenario remained without deterministic or concrete-host evidence.
The coverage document explicitly separates calculation/submission guarantees
from OS, cable, and physical-device delivery quality.

## Documentation Audit

`projects/synth/docs/master-clock-and-midi-sync.md` records all required exact
semantics:

- stable JUCE-free Engine ownership, timestamp-ordered drain, one immutable
  half-open plan per block, analytical crossings, and once-per-block app call;
- no phase buffer/per-sample callback, fractional positions, 4x conversion,
  exact adjacent anchors, stopped lifetime, and current-run transport epochs;
- all audio/input/UI/sender/JUCE-output/browser-main thread responsibilities and
  the fixed-capacity SPSC/no-lock boundary;
- unsigned host-local microsecond epoch, JUCE normalization, browser
  `performance.timeOrigin`, and Web MIDI millisecond conversion only at send;
- nominal mapper period, five-error median, `1/32` EWMA, positive/negative
  500-ppm slew, ordinary continuity, and discontinuity generation;
- base lookahead formula, additive browser 25-ms horizon, JUCE 1-ms lead,
  maximum sink-lead snapshot, stored deadlines, and explicit fallback quality;
- four independent gates, source ownership/takeover, Start/Continue first-clock
  activation, Stop, regeneration, and equal-deadline ordering;
- distinct Continue wire intent with new current-run phase and explicit Song
  Position Pointer/retained-song-position exclusion;
- runtime config v2/v1 migration/atomic rejection/patch exclusion, all-off
  defaults, PPQN `1..960`, and the non-24 interoperability warning; and
- tempo authority/restoration, PLL constants/dropout, diagnostics, and operator
  interpretation.

The README removes the stale inert-realtime claim and links this contract.

## Verification Matrix

Every required command was run from the shared worktree. Status is the process
exit status.

| Command | Status | Concise result |
|---|---:|---|
| `make -C projects/synth master_clock_tests` | 0 | All focused clock tests and three new trace cases passed with the summaries above. |
| `make -C projects/synth build/midi_sender_tests build/parameter_modulation_tests build/engine_tests build/rig_tests build/miniapp_system_tests build/braid4_system_tests build/braid4_deadline_tests` | 0 | All focused binaries built. |
| `projects/synth/build/midi_sender_tests` | 0 | All sender tests and the concrete-sender trace passed. |
| `projects/synth/build/parameter_modulation_tests` | 0 | Full parameter/config/persistence binary passed. |
| `projects/synth/build/engine_tests` | 0 | Full Engine clock/config/integration binary passed. |
| `projects/synth/build/rig_tests` | 0 | Full deterministic Rig binary passed. |
| `projects/synth/build/miniapp_system_tests` | 0 | Full MiniApp system binary passed. |
| `projects/synth/build/braid4_system_tests` | 0 | Full Braid system binary passed. |
| `projects/synth/build/braid4_deadline_tests` | 1 | Known wall-clock-sensitive binary: only baseline 44.1-kHz p99 case failed; all other cases passed. |
| `projects/synth/build/braid4_deadline_tests` (isolated rerun 1) | 1 | Variable host-load result: baseline 96-kHz and sparse 48-kHz p99 cases failed; other cases passed. |
| `projects/synth/build/braid4_deadline_tests` (isolated rerun 2) | 1 | Variable host-load result: only sparse 48-kHz p99 case failed; other cases passed. |
| `make -C projects/synth test` | 0 | Full serial core passed, including the unchanged complete Braid deadline binary. |
| `make -C projects/synth/apps/miniapp test` | 0 | All JUCE aggregates passed; benign unavailable-CoreMIDI/XPC diagnostics only. |
| `make -C projects/synth/apps/miniapp` | 0 | MiniApp application build passed. |
| `make -C projects/synth/apps/sheaf-patch test` | 0 | Launcher harness built and passed for MiniApp and Braid; benign unavailable-CoreMIDI diagnostic only. |
| `make -C projects/synth/apps/sheaf-patch` | 0 | Sheaf Patch executable/app bundle build passed. |
| `make -C projects/synth/browser browser-fake-app` | 0 | Fake browser application artifact selected successfully. |
| `make -C projects/synth/browser browser-miniapp` | 0 | MiniApp WASM/browser artifact built successfully; only Emscripten deprecation warning. |
| `make -C projects/synth/browser test` (sandbox) | 2 | TypeScript/generic scan and 12 Node tests passed; Playwright server bind failed with sandbox `listen EPERM 127.0.0.1:4173`. |
| `make -C projects/synth/browser test` (approved unsandboxed rerun) | 0 | Identical command passed 12 Node tests and all 68 Playwright tests. |
| `make -C projects/synth check-ui-boundary` | 0 | UI boundary scan passed. |
| `openspec validate add-synth-master-clock-midi-sync --strict` | 0 | Change is valid. |
| `python3 -m unittest tests/openspec_requirement_ids_test.py` | 1 | Pre-existing live-spec duplicate `spm-80` at lines 2213 and 2629; the file is byte-identical to task base. |
| `git diff --check` | 0 | Diff hygiene passed. |

Base confirmation for the requirement-ID concern:

- `git diff --exit-code 822b8096 -- openspec/specs/synth-parameter-modulation/spec.md`
  exited `0`.
- `git show 822b8096:openspec/specs/synth-parameter-modulation/spec.md | rg -n '^### Requirement: spm-80'`
  shows the same two base requirements at lines `2213` and `2629`.

## Production Changes

None. No file under `projects/synth/include`, `projects/synth/src`, runtime,
browser runtime code, or application production code changed in Task 8.

## Self-Review

The complete staged Task 8 delta was reviewed before commit. It contained only
the seven files listed above, passed `git diff --cached --check`, and contained
no production or acceptance-metadata edit. Browser screenshot changes and
Python bytecode produced by verification were removed before commit.

## Concerns

- The standalone Braid wall-clock deadline binary is demonstrably
  host-load-sensitive: three isolated runs failed varying p99 cases, while the
  exact unchanged binary passed completely inside the required full serial
  suite. No assertion was weakened.
- The repository-wide requirement-ID test is blocked by a duplicate `spm-80`
  already present at the Task 8 base. Task 8 did not edit live OpenSpec specs.
- Browser Playwright requires permission to bind its local test server; the
  identical approved unsandboxed run is green.

## Preserved Worktree State

Immediately before creating this report, `git status --short` was exactly:

```text
 M .superpowers/sdd/progress.md
?? projects/synth/browser/package-lock.json
?? projects/synth/miniapp/
```

The controller-owned progress edit and both pre-existing unrelated untracked
paths were not modified by Task 8 and were never staged.
