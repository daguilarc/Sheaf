# Synth Master Clock/MIDI Sync — Task 6 Prescriptive Brief

## Assignment

Implement Superpowers plan Task 6 / OpenSpec 9.1–9.4 from base `a2a8e891`.
Use strict TDD and finish with exactly two commits: one implementation commit,
then one metadata-only report commit adding
`.superpowers/sdd/master-clock-task-6-report.md`. Do not edit the plan,
OpenSpec task checkboxes, progress file, or this brief. Stay available for the
same-context Opus review and any small review fixes.

This is one coarse task. Own the portable page, Engine handoff/publication,
both host services, and parity tests together; do not split architecture among
other agents. The decisions below are resolved. Implement them rather than
inventing a competing synchronization or page-state model.

## Required Scope

- OpenSpec 9.1–9.4 only: portable Sync page, staged editing, audio-safe live
  commit, persistence-on-Back, coherent status publication, source-name
  resolution, JUCE/browser parity, and layout.
- Expected production files include:
  - `projects/synth/include/synth/RuntimePages.hpp`
  - `projects/synth/include/synth/RuntimePagePolicy.hpp`
  - `projects/synth/include/synth/RuntimeMainComponent.hpp`
  - `projects/synth/include/synth/Engine.hpp`
  - `projects/synth/runtime/JuceRuntimeMainServices.hpp`
  - `projects/synth/include/synth/browser/BrowserRuntimeMainServices.hpp`
- Expected test/build dependency files include focused core tests under
  `projects/synth/tests/`, JUCE tests under `projects/synth/juce/`, browser
  tests under `projects/synth/browser/tests/`, and Makefile dependencies only
  where an actual new include/source dependency requires them.
- Do not implement MiniApp ADSR/tempo/oversampling work (Task 7), whole-system
  traces/docs (Task 8), or unrelated UI redesign.

## Fixed Architecture: Audio-Safe Sync Configuration

1. Add an Engine host API that accepts a complete `SyncConfig`, rejects it
   without mutation unless `IsValid()`, and publishes it as one coherent
   latest-value command. Encode all four booleans and PPQN into one atomic
   integer word; do not use a mutex, heap allocation, queue, or separately
   published fields. Provide an acquire-load message-thread snapshot API that
   decodes the same word.
2. Keep one audio-thread-only applied word. At the very beginning of each
   `ProcessBlock`, acquire-load the requested word; if it differs, decode and
   call `MasterClock::ApplySyncConfig` before routing realtime messages or
   committing the block, then update the applied word. Valid UI commits must
   therefore take effect no later than the next audio block and latest-wins if
   several edits arrive before a block.
3. Startup loading remains single-threaded: after a valid loaded config is
   applied to MasterClock, seed both requested and applied words to that exact
   value. Defaults remain four false flags and PPQN 24. Invalid input must not
   alter either word or MasterClock.
4. `Engine::SaveRuntimeConfiguration` must serialize the requested/snapshot
   config, not read mutable MasterClock state from the message thread. Saving
   immediately after Sync Back must persist the new config even if the audio
   thread has not yet processed another block.
5. Preserve existing startup ordering, v1-to-v2 migration, and direct
   single-threaded MasterClock tests. Do not make application code responsible
   for this handoff.

## Fixed Architecture: Coherent UI Diagnostics

1. UI services must never directly read mutable MasterClock DSP fields.
   Publish the required UI subset as a coherent Engine-owned lock-free mirror:
   acquisition/lock state, source kind, active-source presence and slot,
   current BPM, output latency, ignored-input count, late-event count, and
   dropped-output count.
2. Use an odd/even sequence plus atomic payload words (including bit-cast BPM)
   or an equivalently coherent lock-free atomic design. Plain concurrently
   read/written struct fields, mutexes on the audio path, and a large
   potentially-locking `std::atomic<ClockDiagnostics>` are forbidden. Assert
   the chosen primitive atomics are always lock-free on supported builds.
3. Publish on the audio thread after MasterClock has handled the block and at
   safe pre-audio initialization/prepare points so the UI has sensible initial
   state. The reader must retry until it observes one stable even sequence;
   it must never combine source/slot/BPM/counters from different publications.
4. Both host services consume only this published snapshot. They may take an
   `InstrumentSnapshot()` on their message/UI thread and resolve an active
   external slot to `MidiControllerSlot::name` there. No string work belongs
   on the audio thread. Use a deterministic fallback for an out-of-range active
   slot, and show Internal/no external source when none is active.

## Fixed Portable Page Model and Actions

1. Add `RuntimePageKind::Sync` and `RuntimeMainPage::Sync`.
   `RuntimePageBackSavesConfiguration(Sync)` is true; File remains false.
2. Sidebar order and geometry are fixed:
   Audio, Controllers, Sync, File, deadline; each occupies one 40 px row in
   the existing 96 px sidebar. The root becomes five rows high. Preserve the
   configured application content width/height and the existing sidebar x
   offset/intrinsic-width contract.
3. Add stable `runtime.sync.*` node IDs and actions for:
   Back, send clock, receive clock, send transport, receive transport, PPQN,
   validation, nonstandard warning, BPM, lock, source, output latency, ignored
   input, late events, and dropped output. Add `runtime.sidebar.sync`.
4. `SyncPageSurface` owns a staged `SyncConfig`. Opening Sync from the sidebar
   calls a `BeginEdit`-style operation exactly once with the host's current
   config snapshot. Periodic `Refresh()` updates status/diagnostic fields only;
   it must not reset staged toggles, PPQN, validation, or warning.
5. Toggle actions accept the backend contract values `"1"` and `"0"` and
   update only staged state. PPQN uses strict full-string decimal integer
   parsing (no partial parse, float, exponent, or overflow), accepts 1..960,
   and otherwise retains the prior valid PPQN while showing inline validation
   text. A later valid PPQN clears validation.
6. PPQN 24 shows no nonstandard warning. Every other valid value shows an
   explicit warning that MIDI peers must use the same nonstandard pulse
   density. The warning follows staged state immediately, before Back.
7. Back first commits the complete staged config through generic services. On
   success it saves runtime configuration exactly once and returns to the app.
   On defensive commit rejection it remains on Sync, does not save, and shows
   an apply error. Reopening starts from the last committed Engine snapshot.
8. Use one portable tree/model in both hosts; no host backend may contain sync
   policy. Use vertical/adaptive rows that remain within the application content
   bounds at the repository's narrow browser/JUCE test widths. Read-only status
   text must include recovered/current BPM, Internal/Acquiring/Locked/FreeRun,
   active source name, output latency, ignored input, late events, and dropped
   output with stable human-readable labels.

## Fixed Generic Service Contract

Extend `RuntimeMainServices` with only the generic operations required by the
shared component:

- snapshot current requested `SyncConfig` for `BeginEdit`;
- refresh a status-only Sync diagnostics value;
- commit one complete staged `SyncConfig` and return success/failure.

Implement those operations in both `JuceRuntimeMainServices` and
`BrowserRuntimeMainServices` through Engine. Keep persistence behavior in their
existing `SaveRuntimeConfiguration` path; browser success must still set its
persistence-dirty signal. Do not duplicate parsing, staging, warnings,
navigation, or save policy in either host.

## Mandatory TDD Evidence

Observe and record meaningful RED before production implementation for all
three groups below. Compile failures from missing APIs are acceptable only for
the first test in a group; add behavioral REDs before GREEN.

### A. JUCE-free page/main-component policy

- Sidebar Sync node/order/root geometry and unchanged composite app bounds.
- All four staged toggles and exact actions.
- PPQN default, boundaries 1/960, invalid values (empty, partial, float,
  exponent, signed/out-of-range/overflow), retained prior value, cleared error,
  and non-24 warning.
- Status node text for every required field and narrow bounds containment.
- Refresh cannot overwrite edits; Back commits exactly once then saves once;
  failed commit stays open/no save; reopen uses committed state; File Back still
  never saves.

### B. Engine threading and host services

- Invalid request is atomic/no mutation; valid request is not applied before
  an audio block, is applied at the next block, and multiple pre-block requests
  are latest-wins.
- Immediate save after request writes the requested v2 sync config before the
  next block; startup-loaded config seeds both snapshots and first block.
- Coherent diagnostics stress test reads while publications change and proves
  only whole known tuples are observed; no audio-path lock/allocation is added.
- Active source slot resolves to the configured controller name off audio path,
  with no-source and out-of-range fallbacks.
- JUCE and browser services share the same snapshot/commit/status semantics;
  browser Sync Back marks persistence dirty.

### C. Host/render parity

- Browser command-buffer/real-Wasm Playwright opens Sync, edits toggles/PPQN,
  observes staged warning/validation, presses Back, saves, reopens with committed
  values, refreshes diagnostics, and stays usable at narrow width.
- JUCE portable/runtime-page tests prove the same nodes become correct
  ToggleButton/TextEditor/read-only status components and dispatch the same
  portable actions; add a shell/session open-edit-Back-reopen path if needed to
  prove generic routing and persistence rather than backend-only rendering.
- Existing Audio/Controllers/File navigation, File Back non-save, controller
  editing, browser persistence, and application bounds remain green.

## Verification Floor

Run and report exact commands/results for:

- focused `contract_tests`, `portable_ui_tests`, `runtime_main_component_tests`,
  `engine_tests`, and `browser_runtime_contract_tests` targets;
- the relevant JUCE runtime page/shell tests (and `make -C
  projects/synth/apps/miniapp test` if that is the reliable aggregate);
- browser TypeScript/Node checks, both real Wasm builds when headers/exports are
  affected, and the focused then full Playwright suite on the canonical fixture;
- full `make -C projects/synth test`, isolated Braid deadline verification if
  the aggregate benchmark is load-sensitive, strict OpenSpec validation, both
  diff checks, and an exact changed-path audit.

Restore Playwright-generated tracked screenshots unless an intentional visual
change is proven and documented. Never stop another worktree's process; use the
established isolated fixture if canonical ports are occupied.

## Scope and Safety

- Preserve and do not stage user-owned untracked
  `projects/synth/browser/package-lock.json` and `projects/synth/miniapp/`.
- Do not weaken tests, timing contracts, UI structural validation, or browser
  isolation headers to obtain GREEN.
- No audio-thread locks, allocation, strings, filesystem work, or host API
  calls. No direct message-thread reads of mutable MasterClock state.
- The implementation commit contains product/tests only. The report commit
  contains only the report and must list base/head commits, exact paths,
  RED/GREEN evidence, threading proof, host parity, deviations, and risks.
