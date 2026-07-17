# Absolute Encoder Feedback Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make absolute-encoder feedback causally follow the normalized pre-modulation control center, suppress the exact hardware echo only after DSP acknowledgement, and correct the MF Twister primary-ring protocol without changing relative feedback.

**Architecture:** Add one engine-owned, fixed-capacity `AbsoluteFeedbackCoordinator` that survives MIDI processor rebuilds and linearizes absolute input alerts against position output. Carry its globally increasing epochs through the existing MIDI bus into per-slot processed-epoch state, publish that state coherently with a normalized raw knob center in each visible cell, and let absolute output resolve a compact pending/acknowledged state machine while relative output continues reading the post-modulation display value.

**Tech Stack:** C++20, atomics and the existing UI-state revision transaction, the synth library's in-file test registries, Make, OpenSpec.

## Global Constraints

- Treat `openspec/changes/synchronize-absolute-encoder-feedback/{proposal.md,design.md,specs/**,tasks.md}` as normative, including all seven invariants and proofs in `design.md`.
- Work in the existing harness-managed detached worktree. Do not create a nested worktree and do not touch the user's untracked `projects/synth/miniapp/` directory.
- Use strict TDD for every behavior change: add the named test first, capture its real RED compile/assertion failure before production edits, then capture GREEN in the task report.
- Keep the implementation allocation-free and lock-free on the audio thread. The only coordinator guard is the bounded per-route MIDI-input/message-output critical section described in the design; never acquire it from `MessageInBus::Apply`, parameter routing, or UI publication.
- Epoch `0` remains an untracked compatibility value. Tracked epochs are globally increasing, nonzero `std::uint64_t` values for the runtime lifetime; comparisons and stored acknowledgements are monotonic.
- The coordinator is keyed by `(controllerSlot, parameterSlot, position)`, has exactly 4096 compile-time route records, persists keys across profile rebuilds, and must not use a concrete input-to-output processor pointer. Profile construction reserves routes. On exhaustion, an unreservable absolute mapping consumes matching turns without queueing `ParamSetAbsolute`, and its output uses ordinary raw-center debounce; never apply an untracked hardware event that could be overwritten by stale feedback.
- Publish an expectation before the epoch-bearing message is visible to DSP. If `MessageInBus::Push` fails, conditionally restore the exact prior expectation only when no newer event has superseded it.
- Every valid addressed slot position acknowledges an epoch after its apply-or-reject decision, including modifier rejection, a disconnected/empty visible cell, and bank/modulation-view routing changes. Acknowledgement records processing, not successful mutation.
- `rawKnobValue` is one normalized `[0,1]` scene/gesture center from production `ComputeRawCenter(scene)`, before modulation, target/display smoothing, bipolar presentation, or switch presentation. Existing `values` retain their current post-modulation display semantics.
- Read `rawKnobValue`, `processedAbsoluteEpoch`, connectivity, and display data from one stable cell revision or make no position decision. A torn read cannot resolve a coordinator expectation or alter the value cache.
- While pending with published `A < E`, absolute output sends no position and does not mutate its position cache. At `A >= E`, quantize `V = round(127 * clamp(X, 0, 1))`: suppress when `V == B`, otherwise enqueue `V` once as a correction. A failed correction enqueue leaves the expectation and cache unresolved for retry.
- Preserve both relative input modes exactly. Relative output ignores the coordinator/raw center and continues quantizing post-modulation `values[0]`.
- Twister primary encoder/ring position uses zero-based channel `0` only. Retain RGB color `1`, RGB brightness `2`, and ring brightness `5`; remove channel `4` primary-position traffic and its cache member. Initial/blank feedback is four messages.
- Use fresh native Codex implementers sequentially. After each task, package the exact base-to-head diff and require an xagent Claude reviewer to return both `SPEC COMPLIANCE: PASS` and `CODE QUALITY: PASS`; resolve and re-review every blocking finding before checking OpenSpec work complete.

---

### Task 1: Add the persistent coordinator and transactional absolute input alert

**OpenSpec mapping:** 1.1

**Files:**

- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`

- [ ] Add focused tests for globally monotonic nonzero epochs across two controller routes, independent route state for controllers sharing one cell, latest-expectation replacement, guarded snapshot/resolve behavior, conditional rollback of a failed event, and rollback refusal after a newer event supersedes it. Pin `kMaxRoutes == 4096`; fill the table and prove an unreservable route leaves coordinator state unchanged and consumes matching mapped input without queueing. Defer its ordinary raw-center output behavior to Task 3.
- [ ] Extend `EncoderMidiInProcessor` tests so absolute CC input publishes `(epoch, rawByte)` for `(controllerSlot, slotIx, position)` before the bus push, embeds the same epoch in `ParamSetAbsolute`, and restores prior state when a deliberately full `MessageInBus` rejects the push. Prove relative modes neither allocate an epoch nor alter coordinator state.
- [ ] Run RED: `make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests`. Expect missing coordinator/epoch APIs or new assertions to fail.
- [ ] Add a 4096-record, fixed open-addressed `AbsoluteFeedbackCoordinator` with an atomic global epoch allocator and route reservation during profile construction. Route methods must offer a short atomic guard that makes input alert/rollback and output inspect/resolve linearizable without locks or allocation on the audio thread. Use explicit reservation/result types so invalid/capacity-exhausted routes cannot masquerade as tracked epoch `0`; retain keys across rebuilds so matching pending state survives.
- [ ] Add the minimal runtime vehicle needed by this task: `MessageIn` stores `std::uint64_t absoluteEpoch = 0`, and `ParamSetAbsolute` accepts an optional epoch while all existing call sites remain source-compatible. Do not change apply/acknowledgement behavior yet, and do not persist runtime epochs in controller-profile JSON.
- [ ] Give `EncoderMidiInProcessor` a non-owning coordinator pointer plus controller-slot identity. In absolute mode, allocate `E`, save/publish unresolved `(E,B)` under the route guard, release the guard, push `ParamSetAbsolute(..., B/127, E)`, and conditionally roll back on failure. Keep the original relative branch and push/thru behavior unchanged.
- [ ] Run GREEN twice: `make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests`. Expect exit 0 both times.
- [ ] Commit: `feat(synth): coordinate absolute encoder input epochs`

### Task 2: Acknowledge absolute events and publish the coherent raw control center

**OpenSpec mapping:** 1.2, 2.1

**Files:**

- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/src/MidiController.cpp` only if a runtime-epoch omission assertion requires clarifying existing `MessageIn` JSON handling
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`

- [ ] Add message tests proving `ParamSetAbsolute` carries its epoch through queue pop/apply but runtime epochs are deliberately omitted from persisted controller associations, whose loaded messages retain epoch `0`. Include an externally constructed/controller-association `ParamSetAbsolute` with epoch `0` that still applies or rejects normally, creates no coordinator expectation, and does not advance the slot acknowledgement.
- [ ] Add routing tests proving a valid slot position records the latest processed epoch after successful apply and after rejection by each modifier, an empty/disconnected visible cell, bank selection change, and modulation-view routing change. Prove older and epoch-0 messages cannot move the recorded acknowledgement backward.
- [ ] Add UI snapshot tests for unipolar and bipolar parameters, scene endpoints/intermediate blend, gestures, modulation, target-center smoothing, switches, connected modulation-view cells, and disconnected cells. Assert `rawKnobValue` is normalized pre-modulation/pre-smoothing state and `processedAbsoluteEpoch` belongs to the same stable revision while existing `values`, colors, spreads, and presentation ranges remain unchanged.
- [ ] Run RED: `make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests`. Expect missing epoch fields/acknowledgement or raw snapshot assertions to fail.
- [ ] Carry the Task 1 `MessageIn::absoluteEpoch` through `MessageInBus` into the slot-position route. Refactor absolute apply so the slot records `max(previous,E)` after the final apply-or-reject decision; modifier rejection must pass through this path rather than being dropped before acknowledgement. Do not change relative modifier behavior.
- [ ] Add a processed-epoch array to `BankSlot`, sized alongside physical positions before realtime processing. Thread `ParameterManager::Scene()` and the position epoch through `ParameterManager::PopulateUIState` → `BankSlot::PopulateUIState` → `Parameter::PopulateUIState` (and disconnected publication) so `rawKnobValue` and that slot epoch are written inside the same odd/even revision transaction. Compute the raw value with production `ComputeRawCenter(scene)` and clamp it in normalized core space; publish disconnected raw value `0` without erasing its processed epoch.
- [ ] Add a stable snapshot reader test that forces an odd/changing revision and proves consumers reject it rather than mixing epoch and value generations.
- [ ] Run GREEN twice: `make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests`. Expect exit 0 both times.
- [ ] Commit: `feat(synth): publish acknowledged absolute control state`

### Task 3: Implement causal absolute output and correct Twister primary-ring traffic

**OpenSpec mapping:** 3.1, 3.2

**Files:**

- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`
- Test: `projects/synth/tests/midi_sender_tests.cpp` only if deterministic enqueue-failure coverage needs the bounded sender fixture

- [ ] Add table-driven output tests for both Twister and WRLD.Bldr absolute mappings: pending `A<E` gates position but not independent color/brightness; stable `A>=E` suppresses exact byte; a rejected/different actual value forces one correction even when it equals the old cache; the next pass debounces; rapid `E1..E3` resolves only `E3`; disconnected routes resolve against blank `0`; and an unstable revision changes neither coordinator resolution nor cache.
- [ ] Add enqueue-failure coverage showing correction failure leaves pending/cache state untouched and a later pass retries successfully. Add a narrow test-only synchronization seam modeled on `midi_sender_tests.cpp`'s `BlockingSink`/`WaitEntered`/`Release` pattern, then exercise a concurrent alert-vs-output interleaving and prove a position enqueue linearizes either before the alert or after acknowledgement, never stale after alert. Keep the seam out of production hot paths when tests are not using it.
- [ ] Add relative regression tests showing both relative modes continue following post-modulation `values[0]`, do not read `rawKnobValue`/epochs, and still animate while an absolute route sharing the cell is gated.
- [ ] Fill/exhaust coordinator route storage and prove an unreservable absolute output mapping uses ordinary raw-center debounce without creating or waiting for an expectation, completing the fail-closed capacity scenario begun in Task 1.
- [ ] Replace Twister protocol expectations with named zero-based channel constants and exactly four initial/blank messages: channel `0` `encoderRingValue`, channel `1` `rgbColor`, channel `2` `rgbBrightness`, and channel `5` `ringBrightness`. Assert no channel `4` message is emitted and subsequent passes debounce all four fields.
- [ ] Run RED: `make -C projects/synth build/parameter_modulation_tests build/midi_sender_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/midi_sender_tests`. Expect causal-output/Twister assertions to fail.
- [ ] Extend `CellSnapshot` with coherent raw value and processed epoch. Give encoder output processors their controller-slot identity, feedback mode, and non-owning coordinator pointer; only `EncoderMode::Absolute` selects the raw/epoch state machine. Keep color/brightness processing outside the position gate.
- [ ] Implement the guarded absolute position decision exactly: inspect latest `(E,B,P)`; gate without cache mutation when `A<E`; at `A>=E` quantize raw `X`, suppress and resolve when equal, otherwise enqueue correction while guarded and resolve/cache only on success, conditional on `E` still being latest. With no pending expectation, ordinary debounce uses raw `X`. Relative mode retains the existing display-value path.
- [ ] Remove Twister's channel-4 `indicatorValue` send/cache state, introduce the four clear protocol names/constants, and update initial/blank/reset behavior without adding shifted-encoder support.
- [ ] Run GREEN twice: `make -C projects/synth build/parameter_modulation_tests build/midi_sender_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/midi_sender_tests && projects/synth/build/parameter_modulation_tests`. Expect exit 0.
- [ ] Commit: `feat(synth): synchronize absolute encoder feedback`

### Task 4: Wire engine lifetime and prove rebuild/multi-controller integration

**OpenSpec mapping:** 4.1

**Files:**

- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/include/synth/Engine.hpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`
- Test: `projects/synth/tests/engine_tests.cpp`
- Test: `projects/synth/tests/rig_tests.cpp`

- [ ] Add profile-factory tests proving controller-slot identity, coordinator pointer, and encoder input mode reach matching input/output processors; relative or output-only profiles remain uncoordinated and retain post-modulation feedback.
- [ ] Add engine/rig tests for the real callback → `midiBus_` → audio `ProcessBlock` → coherent UI publication → `MessageThreadTick` path. Cover applied exact suppression, modifier rejection correction, modulation-free absolute feedback, modulation-aware relative feedback, and rapid input before a UI publish.
- [ ] Add two-controller shared-cell coverage: independent pending state per controller, globally ordered epochs, final-input echo suppression on its controller, and correction of the other controller to the acknowledged actual center.
- [ ] Add a live `RebuildMidiProcessors()` test that establishes a pending expectation, replaces processor chains before DSP acknowledgement, and proves the rebuilt output remains gated then resolves from the persistent coordinator. Include a bank or modulation-view route change between input and publication.
- [ ] Run RED: `make -C projects/synth build/parameter_modulation_tests build/engine_tests build/rig_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/engine_tests && projects/synth/build/rig_tests`. Expect missing factory/engine lifetime wiring or integration assertions to fail.
- [ ] Add one `AbsoluteFeedbackCoordinator` member to `Engine`, constructed once and never replaced by `RebuildMidiProcessors`. Thread its non-owning interface and the loop's controller slot through `CreateMidiControllerProfile`; derive output feedback mode from the profile's encoder input mode so relative and absolute routes are explicit and output-only compatibility remains relative.
- [ ] Reconcile configured routes without clearing matching coordinator expectations. Do not retain processor pointers in the coordinator, and do not broaden `MessageInBus` producer ownership or alter sender sink routing.
- [ ] Run GREEN: `make -C projects/synth build/parameter_modulation_tests build/engine_tests build/rig_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/engine_tests && projects/synth/build/rig_tests`. Expect exit 0.
- [ ] Commit: `feat(synth): retain absolute feedback across rebuilds`

### Task 5: Complete verification and OpenSpec evidence

**OpenSpec mapping:** 4.2

**Files:**

- Modify: `projects/synth/docs/coverage.md`
- Modify: `openspec/changes/synchronize-absolute-encoder-feedback/tasks.md`

- [ ] Update `projects/synth/docs/coverage.md` for modified/added requirements `sar-7`, `spm-20`, `spm-35`, `spm-62`, `spm-68`, and `spm-77`, naming the exact focused and end-to-end tests.
- [ ] Run focused tests twice where concurrency/retry is exercised: `make -C projects/synth build/parameter_modulation_tests build/midi_sender_tests build/engine_tests build/rig_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/midi_sender_tests && projects/synth/build/engine_tests && projects/synth/build/rig_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/engine_tests`. Expect exit 0.
- [ ] Run `make -C projects/synth check-ui-boundary` and `make -C projects/synth test`. Expect exit 0.
- [ ] Run `openspec validate synchronize-absolute-encoder-feedback --strict`. Expect the change to be valid.
- [ ] Run `git diff --check`, scan changed production/tests/docs for `TBD|TODO|FIXME|HACK|placeholder`, inspect `git status --short`, and verify the user's untracked `projects/synth/miniapp/` remains untouched.
- [ ] Obtain the final xagent Claude Opus whole-change review over the exact implementation base-to-head diff. Require explicit PASS verdicts for spec compliance and code quality, including realtime/concurrency safety, queue rollback, snapshot coherence, retry semantics, relative isolation, Twister channel correctness, rebuild persistence, multi-controller behavior, and test adequacy. Resolve and re-review every Critical/Important finding.
- [ ] Only after all focused/full verification and reviews pass, mark OpenSpec tasks 1.1 through 4.2 complete and rerun strict validation.
- [ ] Commit: `test(synth): verify absolute feedback synchronization`
