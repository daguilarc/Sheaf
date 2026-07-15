# Ganged Random LFO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, correlated two-voice random LFO, coherent predictive visualization, and MiniApp integration as modulation source 3.

**Architecture:** Pure DSP math and a randomness-free voice live in synth core headers; a fixed-size gang owns sampling, state, and an odd/even revision snapshot. A JUCE-free visualizer analytically reconstructs the shared round, while MiniApp retains one underlay visualizer and separately builds the third main panel from the same snapshot.

**Tech Stack:** C++20 header-only synth DSP, fixed `std::array` storage, atomics, portable draw commands, JUCE/backend parity tests, browser command-buffer tests, Make.

## Global Constraints

- `ShapedInterpolate(float source, float target, float shape, double t)` clamps shape and `t` to `[0,1]`, retains double `t` until the float evaluation boundary, and computes `smoothT = 0.5f - 0.5f * DefaultDspMath::Cos2Pi(0.5f * float(t))` before crossfading linear and smooth time.
- Timing sampling is center seconds normal, then reciprocal center hertz, then per-voice rate normal in hertz, then positive double cycles per sample; the floor is exactly `1.0 / (sampleRate * 3600.0)`.
- Logical RNG order is waiting center, waiting voice rates, moving center, moving voice rates, target center, target deviations, shapes; each per-voice group is ascending voice order and each shape is uniform on `[0,1]`.
- `Process` performs no allocation, locking, logging, or I/O. Fixed arrays and pre-seeded/injected draws are required.
- The slowest voice gates the next round. The process call completing the final voice returns the completed outputs, then resets all voices together for the following call.
- Snapshot publication is one coherent odd/even atomic revision transaction; readers retry a bounded count and fail closed rather than combine revisions.
- Visual durations use `ceil(1.0 / increment)`. Every voice shares the present x-coordinate, and each dot y-coordinate is analytically reconstructed from the path, never copied from snapshot `output`.
- Every generic `GangedRandomLfoProcessor<VoiceCount>` exposes assignable per-voice colors and publishes them in gang/snapshot state; neither the command builder nor its immediate visualizer caller supplies colors. MiniApp assigns cyan to voice 0 and orange to voice 1, but those are application configuration rather than generic processor defaults.
- MiniApp waiting and moving configuration is `(2.0 seconds, 0.5 seconds, 0.125 hertz)` and target internal sigma is `0.1`.
- The gang is the fourth source at index `3`; existing sources remain indexes `0`, `1`, and `2`, with no parameter/page/bank/scene/gesture topology changes.
- Retain one address-stable visualizer for modulation-depth underlays. The third main waveform panel is built separately and directly from the gang snapshot.
- Do not touch or stage any untracked file under `projects/synth/miniapp/`.

## Global Workflow Gate

After each task's native implementation and verification pass, obtain Claude approval for that task, then have the controller update only that task's mapped checkboxes in `openspec/changes/add-ganged-random-lfo/tasks.md` and record the implementation, command output, and review evidence. Never defer completed-task checkbox updates to Task 7 and never batch-close another task's mappings.

---

### Task 1: Shaped interpolation and correlated increment sampling

**Files:** Modify `projects/synth/include/synth/DspMath.hpp`; create `projects/synth/include/synth/DspRandomLfo.hpp`; modify `projects/synth/tests/dsp_tests.cpp`.

**Interfaces:** Produce `float ShapedInterpolate(float source, float target, float shape, double t)`, `RandomTimingConfig { double muSeconds; double sigmaSeconds; double internalSigmaHz; }`, and `template<size_t N, class DrawSource> std::array<double, N> SampleCorrelatedIncrements(double sampleRate, const RandomTimingConfig&, DrawSource&)`. `DrawSource` exposes `double Normal(double mean, double sigma)` and `float Uniform01()` so tests observe logical draws independently of standard-library engine consumption.

- [ ] **Task 1 — implement OpenSpec 1.1–1.4 (`sdsp-34`) test-first.**

  1. Add focused tests named `shaped_interpolate_endpoints_and_landmarks`, `shaped_interpolate_preserves_double_progress`, `correlated_increments_use_reciprocal_center_and_hz_sigma`, `correlated_increments_floor_near_zero_rate`, and `correlated_increments_reject_invalid_config`. The scripted draw source must record calls and return a center-seconds draw followed immediately by N rate draws.
  2. Red: run `make -C projects/synth build/dsp_tests`; expect compilation failure because the APIs are absent.
  3. Implement the helper in `DspMath.hpp` using a double-clamped `t`, one explicit float narrowing for `Cos2Pi`/output math, and no mutation of caller progress. Implement validation for finite positive sample rate, finite parameters, and nonnegative sigmas; calculate `centerSeconds = max(1/sampleRate, abs(N(muSeconds,sigmaSeconds)))`, `centerRateHz = 1/centerSeconds`, then each increment as `max(1/(sampleRate*3600), abs(N(centerRateHz,internalSigmaHz))/sampleRate)`.
  4. Green: run `make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests`; expect all named tests PASS, including a mathematical assertion that the epsilon increment yields a phase duration of `ceil(1.0 / epsilonIncrement) == ceil(sampleRate * 3600.0)` process calls without iterating through that duration.
  5. Commit only these files: `git add projects/synth/include/synth/DspMath.hpp projects/synth/include/synth/DspRandomLfo.hpp projects/synth/tests/dsp_tests.cpp && git commit -m "feat(synth): add random LFO math primitives"`.

### Task 2: Deterministic voice and fixed-size gang processor

**Files:** Extend `projects/synth/include/synth/DspRandomLfo.hpp` created by Task 1; modify `projects/synth/tests/dsp_tests.cpp`.

**Interfaces:** Produce `GangedRandomLfoVoice::State { Waiting, Moving, Done }`, `VoiceInput { double waitingIncrement; double movingIncrement; float shape; }`, `void Reset(float newTarget)`, `float Process(const VoiceInput&)`, and `template<size_t VoiceCount, class DrawSource = DefaultRandomDrawSource> class GangedRandomLfoProcessor`. The gang exposes `Prepare(double sampleRate)`, `Process(const GangedRandomLfoInput&)`, `float Output(size_t voice) const`, and fixed arrays of voices/inputs; its input contains waiting/moving `RandomTimingConfig` and `float targetInternalSigma`.

- [ ] **Task 2 — implement OpenSpec 2.1–2.5 (`sdsp-35`, processor portion of `sdsp-36`) test-first.**

  1. Add state-transition tests for default Done, Reset source chaining, waiting hold/crossing, shaped move, overshoot, exact target, and Done hold. Add gang tests whose injected draws assert the canonical sequence `waiting center, waiting rates[0..N), moving center, moving rates[0..N), target center, target deviations[0..N), shapes[0..N)`; cover `[0,1]` target clamp, uniform shapes, first-call seeding, fixed-seed reproduction, epsilon-bound heavy tails, and slowest-voice gating.
  2. Red: run `make -C projects/synth build/dsp_tests`; expect missing voice/gang APIs.
  3. Implement the randomness-free voice with double progress and state comparisons and float source/target/shape/output. Implement the gang with `std::array`, validated setup/config, double round-elapsed samples, fixed/injected RNG, process-all-voices-before-all-done detection, and post-output round sampling/reset. Target center and shapes use `Uniform01`; targets use clamped normals around the shared center.
  4. Add a repeated-turnover allocation guard/structural test and static assertions for fixed storage; confirm `Process` contains no allocation, locks, I/O, logging, or distribution construction. Green: run `make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests`; expect PASS and reproducible outputs.
  5. Commit: `git add projects/synth/include/synth/DspRandomLfo.hpp projects/synth/tests/dsp_tests.cpp && git commit -m "feat(synth): add ganged random LFO processor"`.

### Task 3: Coherent odd/even gang snapshot

**Files:** Extend `projects/synth/include/synth/DspRandomLfo.hpp` created by Task 1; modify `projects/synth/tests/dsp_tests.cpp`; use the established transaction semantics documented by `projects/synth/src/ParameterModulation.cpp` and `projects/synth/include/synth/EncoderDraw.hpp` without coupling DSP to UI/backend types.

**Interfaces:** Produce `GangedRandomLfoVoiceSnapshot` with state, double progress, float source/target/output/shape, double waiting/moving increments, and portable color; `GangedRandomLfoSnapshot<VoiceCount>` with double sample rate and round-elapsed samples; `PublishUiState()` and `bool ReadSnapshot(GangedRandomLfoSnapshot&, unsigned maxRetries = 4) const`. Writer revision is odd during copy and even when committed, with release/acquire ordering.

- [ ] **Task 3 — implement OpenSpec 3.1–3.2 (snapshot portion of `sdsp-36`) test-first.**

  1. Add tests for every gang/voice field, arbitrary distinct assignable per-voice colors surviving publication, odd revision rejection, revision-change retry, bounded retry exhaustion, coherent success, and a type-level assertion that snapshots contain no scope buffer/history. Assert the generic gang does not hardcode MiniApp's cyan/orange choices.
  2. Red: run `make -C projects/synth build/dsp_tests`; expect snapshot/publication APIs to be absent.
  3. Add the fixed snapshot payload and atomic revision beside the gang. Publish by incrementing to odd, copying every field, then storing the next even revision with release ordering. Read revision-copy-revision with acquire ordering, accepting only equal even revisions within four attempts.
  4. Green: run `make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests`; expect all snapshot tests PASS under forced odd and changing revisions.
  5. Commit: `git add projects/synth/include/synth/DspRandomLfo.hpp projects/synth/tests/dsp_tests.cpp && git commit -m "feat(synth): publish coherent random LFO snapshots"`.

### Task 4: Portable predictive visualizer and backend parity

**Files:** Create `projects/synth/include/synth/GangedRandomLfoVisualizer.hpp`; modify `projects/synth/tests/portable_ui_tests.cpp`; modify `projects/synth/juce/MiniAppJuceBackendParityTests.cpp`; modify `projects/synth/tests/browser_command_buffer_tests.cpp`.

**Interfaces:** Produce a non-owning `template<size_t VoiceCount> GangedRandomLfoVisualizer` referencing retained gang UI state and `BuildGangedRandomLfoCommands(snapshot, bounds, commandBuffer)`. Geometry uses existing polyline commands with caller-clipped point lists plus existing filled-ellipse commands, a fixed point/segment ceiling independent of audio duration, and the shared `ShapedInterpolate`. Path and dot colors come exclusively from each coherent voice snapshot.

- [ ] **Task 4 — implement OpenSpec 3.3–3.5 (`spv-6`) test-first.**

  1. Add portable tests for `ceil(1/increment)` wait/move counts, maximum shared duration, source/wait/move/target-hold evaluation, shared present x, reconstructed dot y, solid past, alternating bounded future segments, discarded-remainder tolerance, independent colors, clipping/resizing, bounded command count, and invalid/unstable snapshots producing background/axis only. Add JUCE and browser parity assertions that consume the same existing polyline/ellipse commands with no protocol extension.
  2. Red: run `make -C projects/synth build/portable_ui_tests`; expect missing builder/visualizer symbols. Run `make -C projects/synth browser-command-buffer-test`, `make -C projects/synth/apps/miniapp test`, and `make -C projects/synth/browser browser-miniapp`; expect the new browser/JUCE parity assertions to fail until the portable commands are implemented.
  3. Implement analytic `ceil`-based durations and value reconstruction, clamp the shared elapsed time to the axis, split each fixed-resolution path at that x, emit complete solid polylines before it and alternating short polyline segments after it, then emit a voice-colored filled ellipse at the reconstructed value for precisely that x. Fail closed on incoherent/nonfinite inputs.
  4. Green: run `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`, `make -C projects/synth browser-command-buffer-test`, `make -C projects/synth/apps/miniapp test`, and `make -C projects/synth/browser browser-miniapp`; expect PASS and an unchanged command schema.
  5. Commit: `git add projects/synth/include/synth/GangedRandomLfoVisualizer.hpp projects/synth/tests/portable_ui_tests.cpp projects/synth/juce/MiniAppJuceBackendParityTests.cpp projects/synth/tests/browser_command_buffer_tests.cpp && git commit -m "feat(synth): visualize ganged random LFO rounds"`.

### Task 5: MiniApp core DSP integration

**Files:** Modify `projects/synth/apps/miniapp/MiniAppCore.hpp`; modify `projects/synth/tests/miniapp_system_tests.cpp`.

**Interfaces:** `MiniAppCore` owns `GangedRandomLfoProcessor<2>` and one address-stable `GangedRandomLfoVisualizer<2>`. `PrepareToPlay` supplies the negotiated sample rate; the per-sample loop calls gang `Process` before `UpdateModValues`; source 3 publishes outputs in voice order and the gang snapshot at the existing block boundary.

- [ ] **Task 5 — implement OpenSpec 4.1–4.2 core behavior (`spm-71`) test-first.**

  1. Add system tests asserting four sources, preserved indexes 0–2, two voice outputs at source 3, exact waiting/moving `(2.0,0.5,0.125)` and target `0.1`, negotiated sample rate, process-before-mod-update ordering, cyan/orange assignment, retained visualizer address, capacity growth, block-boundary publication, and unchanged parameter/page/bank/scene/gesture counts and mappings.
  2. Red: run `make -C projects/synth build/miniapp_system_tests`; expect source-count/index/config failures.
  3. Add the processor and retained underlay visualizer members, initialize colors/config once, increase only group modulator/depth capacity, register source 3 after existing sources, prepare at host rate, process once per sample, and publish at the established block boundary. Do not expose metaparameters or create objects during audio/UI refresh.
  4. Green: run `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`; expect PASS with indexes 0–2 unchanged and source 3 in voice order.
  5. Commit only tracked app/test files: `git add projects/synth/apps/miniapp/MiniAppCore.hpp projects/synth/tests/miniapp_system_tests.cpp && git commit -m "feat(miniapp): add ganged random modulation source"`.

### Task 6: MiniApp third main panel and portable UI integration

**Files:** Modify `projects/synth/apps/miniapp/MiniAppUiModel.hpp`; modify `projects/synth/apps/miniapp/MiniAppDraw.hpp`; modify `projects/synth/apps/miniapp/MiniAppUI.hpp`; modify `projects/synth/tests/portable_ui_tests.cpp`; modify `projects/synth/tests/miniapp_system_tests.cpp`; modify `projects/synth/juce/MiniAppJuceBackendParityTests.cpp`; modify `projects/synth/tests/browser_command_buffer_tests.cpp`.

**Interfaces:** `MiniAppUiModel` carries the retained gang UI-state address/snapshot access. `MiniAppDraw` divides the waveform row into three bounded panels and directly calls the shared command builder for the third; `MiniAppUI` continues to expose the distinct retained visualizer only for modulation-depth underlays.

- [ ] **Task 6 — implement OpenSpec 4.3–4.4 (remaining `spm-71`) test-first.**

  1. Add portable UI tests at default and resized bounds asserting bounded VCO, ordinary-LFO, and gang panels, cyan/orange full-round paths and dots, and no aliasing of the retained underlay visualizer as a second placement. Add JUCE/browser parity tests for three-panel command consumption and unchanged controls/topology.
  2. Red: run `make -C projects/synth build/portable_ui_tests`, `make -C projects/synth build/miniapp_system_tests`, `make -C projects/synth/apps/miniapp test`, and `make -C projects/synth/browser browser-miniapp`; expect two-panel layout or new JUCE/browser parity failures.
  3. Thread snapshot access through the UI model, calculate three clipped panel rectangles at all supported sizes, keep existing VCO/LFO rendering, and build the gang panel directly from the coherent snapshot. Preserve the separately owned address-stable underlay visualizer and add no control or serialization surface.
  4. Green: run `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`, `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`, `make -C projects/synth/apps/miniapp test`, `make -C projects/synth/browser browser-miniapp`, and `make -C projects/synth check-ui-boundary`; expect PASS, with the boundary target proving no core-header JUCE dependency. Separately inspect the new core headers' includes and types to prove browser-freedom structurally; do not claim `check-ui-boundary` verifies browser dependencies.
  5. Commit: `git add projects/synth/apps/miniapp/MiniAppUiModel.hpp projects/synth/apps/miniapp/MiniAppDraw.hpp projects/synth/apps/miniapp/MiniAppUI.hpp projects/synth/tests/portable_ui_tests.cpp projects/synth/tests/miniapp_system_tests.cpp projects/synth/juce/MiniAppJuceBackendParityTests.cpp projects/synth/tests/browser_command_buffer_tests.cpp && git commit -m "feat(miniapp): draw ganged random LFO panel"`.

### Task 7: Build wiring, coverage mapping, and complete verification

**Files:** Modify `projects/synth/Makefile`; modify `projects/synth/runtime/juce_build.mk`; modify `projects/synth/browser/Makefile`; modify `projects/synth/browser/package.json` only if an existing test import requires a declared browser dependency; modify `projects/synth/docs/coverage.md`.

**Interfaces:** Existing focused targets must compile the new headers/tests in DSP, portable, JUCE, MiniApp, and browser builds without adding a draw protocol or a production core JUCE dependency.

- [ ] **Task 7 — implement and close only OpenSpec 5.1–5.3.**

  1. Red/build discovery: run `make -C projects/synth build/dsp_tests`, `make -C projects/synth build/portable_ui_tests`, `make -C projects/synth build/miniapp_system_tests`, and `make -C projects/synth browser-command-buffer-test`; expect any unwired new header/import to fail.
  2. Wire only the required test/header dependencies in the synth Makefile, JUCE build fragment, and browser build/dependency files. Map `sdsp-34`, `sdsp-35`, `sdsp-36`, `spv-6`, and `spm-71` in `projects/synth/docs/coverage.md` to the named DSP, snapshot, portable geometry, JUCE/browser backend, MiniApp system, and MiniApp UI tests.
  3. Green/focused verification: run `make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests`, `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`, `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`, `make -C projects/synth browser-command-buffer-test`, `make -C projects/synth check-ui-boundary`, `make -C projects/synth/apps/miniapp test`, and `make -C projects/synth/browser browser-miniapp`; expect every command to exit 0.
  4. Full verification: run `make -C projects/synth test`, `openspec validate add-ganged-random-lfo --strict`, and `git diff --check`; expect all exit 0. Run `rg -n 'TODO|TBD|implement later|fill in details' projects/synth/include/synth/DspMath.hpp projects/synth/include/synth/DspRandomLfo.hpp projects/synth/include/synth/GangedRandomLfoVisualizer.hpp projects/synth/apps/miniapp projects/synth/docs/coverage.md`; expect no introduced placeholder hit. Run `git status --short projects/synth/miniapp/`; confirm every pre-existing untracked entry is untouched and unstaged.
  5. After Task 7 verification and Claude approval, update only OpenSpec checkboxes 5.1–5.3 and record their verification/review evidence; Tasks 1–6 must already have updated their own mappings through the Global Workflow Gate. Commit tracked build/docs/OpenSpec files without staging the untracked MiniApp directory: `git add projects/synth/Makefile projects/synth/runtime/juce_build.mk projects/synth/browser/Makefile projects/synth/browser/package.json projects/synth/docs/coverage.md openspec/changes/add-ganged-random-lfo/tasks.md && git commit -m "test(synth): verify ganged random LFO coverage"`.

## OpenSpec Coverage Map

- Task 1: `1.1`, `1.2`, `1.3`, `1.4`; requirement `sdsp-34`.
- Task 2: `2.1`, `2.2`, `2.3`, `2.4`, `2.5`; requirements `sdsp-35` and processor/real-time portions of `sdsp-36`.
- Task 3: `3.1`, `3.2`; coherent snapshot portions of `sdsp-36`.
- Task 4: `3.3`, `3.4`, `3.5`; requirement `spv-6`.
- Task 5: `4.1`, `4.2`; DSP/source-registration portions of `spm-71`.
- Task 6: `4.3`, `4.4`; main-panel/underlay portions of `spm-71`.
- Task 7: `5.1`, `5.2`, `5.3`; coverage and verification for all requirements.
