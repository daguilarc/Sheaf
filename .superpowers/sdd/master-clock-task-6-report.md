# Synth Master Clock/MIDI Sync — Task 6 Report

## Status and commits

DONE. Implemented Superpowers Task 6 / OpenSpec 9.1–9.4 from base
`a2a8e891f3607191775f5053cf87527d67a1ee0d` in implementation head
`f04bc84fc80f2e3071421eff955d945927a4a85b` (`feat(synth): add portable
runtime sync page`). This file is the sole path in the following metadata-only
report commit. OpenSpec task checkboxes, the plan, brief, and shared progress
ledger were intentionally not edited by this task.

## Implemented scope

- Added the shared portable Sync sidebar/page, stable `runtime.sync.*` nodes and
  actions, five-row sidebar geometry, adaptive narrow layout, four staged
  toggles, strict full-string PPQN validation, nonstandard-density warning, and
  every required read-only diagnostic.
- Added generic runtime routing and host-service operations for snapshot,
  status refresh, complete-config commit, persistence-on-successful-Back,
  rejected-commit error handling, fresh reopen, and staged-state preservation.
  Re-clicking an already-open Sync tab does not restart the edit.
- Added one packed `uint64_t` requested-config atomic and one audio-owned
  applied word. Valid release-published requests are acquire-loaded at the very
  beginning of `ProcessBlock`, applied before realtime routing/clock commit,
  and are latest-wins. Startup loading seeds both words, and saving snapshots
  the requested word so an immediate Back persists before another audio block.
- Added an Engine-owned coherent clock-diagnostics mirror using an odd/even
  sequence and always-lock-free primitive `uint64_t` atomics, including a
  bit-cast BPM word. It publishes at safe initialization/prepare points and
  immediately after the clock handles each audio block.
- Wired both JUCE and browser services exclusively through Engine snapshots.
  Active controller names are resolved from an instrument snapshot off the
  audio thread, with deterministic internal/no-source and out-of-range
  fallbacks.
- Added JUCE renderer/session, browser command-buffer/runtime, and real-Wasm
  Playwright parity for open/edit/validate/save/reopen, diagnostics, portable
  action dispatch, persistence dirtying, and narrow containment.

## TDD evidence

### Group A — JUCE-free page and main-component policy

Initial API RED:

```text
make -C projects/synth build/portable_ui_tests build/runtime_main_component_tests build/contract_tests
```

Exited `2` on the intentionally missing Sync IDs, surface, page, and policy.
After adding only compile seams, behavioral REDs were:

- portable UI exit `134` at `sidebar sync node`;
- runtime main exit `1` on Sync sidebar/routing/refresh/lifecycle assertions;
- contract exit `1` at `RuntimePageBackSavesConfiguration(Sync)`.

A later edge-case RED exited `1` at `clicking the already-open Sync tab does
not begin a second edit`; the existing handler re-snapshotted Engine state and
discarded the staged PPQN. Guarding `BeginEdit` on a real page transition made
the complete runtime-main suite GREEN (`15/15`). Portable UI and contract tests
also exit `0` (`18/18` contract cases).

### Group B — Engine handoff, publication, and host services

Initial API RED:

```text
make -C projects/synth build/engine_tests build/browser_runtime_contract_tests
```

Exited `2` on the intentionally missing `ClockDiagnosticsPublication`,
`RequestSyncConfiguration`, `SyncConfigurationSnapshot`, and
`ClockDiagnosticsSnapshot` APIs. With compile seams in place, behavioral RED
was exactly the three new Engine contracts (coherent tuple, requested
latest-wins/save, and prepared latency `5334`) plus browser exit `134` at
`browser Sync Back commits one complete requested config`.

The first diagnostics implementation exposed a real mixed tuple under stress:
metadata from one publication combined with the slot/BPM/counters from the
other. The cause was insufficient global ordering between separately relaxed
payload atomics and the sequence word. Using sequentially consistent operations
for the lock-free sequence and payload primitives made the Engine suite pass in
five sequential repetitions and the full focused run. Browser runtime contract
then exited `0`. Duplicate Engine binaries are not run concurrently because
existing test temp/singleton state is process-suite scoped.

### Group C — host/render parity

The JUCE host-state API RED exited `2` because `MainPane::Page` had no `Sync`.
After adding only that enum seam, the test built but behavioral RED exited `134`
at `JUCE host reports the portable Sync page as current`; the reverse mapping
fell through to `None`. Adding both mappings made the JUCE shell
open/edit-Back-save-reopen path GREEN. `RuntimePagesJuceTests` also exits `0`
with ToggleButton/TextEditor/read-only-label and portable-action assertions.

Browser command-buffer parity exits `0`. The first focused Playwright attempt
was blocked only by the sandbox denying the fixture's local bind
(`listen EPERM 127.0.0.1:4173`). The identical approved command used this
worktree's free 4173/4174 fixture, stopped no other server, and passed `4/4`.

## Threading and realtime proof

- Complete config is one coherent atomic word; invalid configs return false
  before mutation. The message/UI side only release-stores or acquire-loads
  that word.
- The audio side owns the non-atomic applied word. Its acquire/load/apply step
  is the first operation in `ProcessBlock`, before messages or `CommitBlock`.
- Diagnostics contain no strings and use only primitive atomics guarded by an
  odd/even sequence. `static_assert(std::atomic<uint64_t>::is_always_lock_free)`
  enforces the supported-build premise. Readers retry until one stable even
  sequence is observed.
- No audio-path mutex, allocation, queue, filesystem call, host call, or string
  work was added. Existing allocation and configuration-mutex Engine tests pass.
- Both service adapters read only Engine's requested config and coherent
  diagnostic mirrors; mutable MasterClock state is not read from the UI thread.

## Verification

All of the following exited `0` unless explicitly noted:

```text
make -C projects/synth contract_tests engine_tests browser-unit-test browser-command-buffer-test build/portable_ui_tests build/runtime_main_component_tests
projects/synth/build/portable_ui_tests
projects/synth/build/runtime_main_component_tests
projects/synth/apps/miniapp/build/runtime_pages_juce_tests
projects/synth/apps/miniapp/build/runtime_shell_session_tests
make -C projects/synth/browser browser-miniapp
make -C projects/synth/browser browser-fake-app-test
cd projects/synth/browser && npm test
make -C projects/synth test
openspec validate add-synth-master-clock-midi-sync --strict
git diff --check
git diff --cached --check
```

Results include all focused C++ tests, both real Wasm builds, browser Node
checks `12/12`, focused real-Wasm Playwright `4/4`, full Playwright `68/68`,
and the complete JUCE-free synth suite including every Braid deadline case.
Strict OpenSpec validation reported the change valid.

`make -C projects/synth/apps/miniapp test` is not a reliable aggregate at this
base: it exits `2` compiling unchanged `ControllersPageSimulationTests.cpp:359`
because that base file references nonexistent
`synth_runtime::ControllersTreeRenderer`. `rg` finds no definition, and the
same reference is present in base `a2a8e891`. The two relevant JUCE Task 6
binaries above compile and run independently GREEN; this unrelated pre-existing
aggregate defect was not worked around or changed.

## Changed paths

- `projects/synth/Makefile`
- `projects/synth/browser/Makefile`
- `projects/synth/browser/tests/fake-app.e2e.spec.ts`
- `projects/synth/browser/tests/screenshots/runtime-shell-desktop.png`
- `projects/synth/browser/tests/screenshots/runtime-shell-narrow.png`
- `projects/synth/include/synth/Engine.hpp`
- `projects/synth/include/synth/RuntimeMainComponent.hpp`
- `projects/synth/include/synth/RuntimePagePolicy.hpp`
- `projects/synth/include/synth/RuntimePages.hpp`
- `projects/synth/include/synth/browser/BrowserRuntimeMainServices.hpp`
- `projects/synth/juce/RuntimePagesJuceTests.cpp`
- `projects/synth/juce/RuntimeShellSessionTests.cpp`
- `projects/synth/runtime/JuceRuntimeMainServices.hpp`
- `projects/synth/runtime/MainPane.hpp`
- `projects/synth/tests/browser_command_buffer_tests.cpp`
- `projects/synth/tests/browser_runtime_contract_tests.cpp`
- `projects/synth/tests/contract_tests.cpp`
- `projects/synth/tests/engine_tests.cpp`
- `projects/synth/tests/portable_ui_tests.cpp`
- `projects/synth/tests/runtime_main_component_tests.cpp`

The two tracked screenshots were intentionally retained because the specified
visible sidebar gained the Sync row; both regenerated desktop and narrow images
were inspected and show the five-row sidebar contained without overlap.

## Risks and scope preservation

- The diagnostics mirror uses sequentially consistent atomics at one publish
  per audio block. This is stronger ordering than the minimum possible, but the
  operations remain bounded and always lock-free; it avoids the empirically
  observed mixed-tuple failure.
- The publication remains a single-writer contract. Initialization/prepare and
  audio publication occur in their established non-overlapping lifecycle
  phases, and the audio thread is the runtime writer after startup.
- No Task 7 MiniApp tempo/ADSR/oversampling work, Task 8 trace/docs work,
  OpenSpec checkbox, plan, shared progress, or brief edit was included.
- User-owned untracked `projects/synth/browser/package-lock.json` and
  `projects/synth/miniapp/` remain unmodified and uncommitted.
