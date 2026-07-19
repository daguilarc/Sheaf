Committed cleanly, working tree clean.

## Summary

**Status: complete.** Commit `e5c5c64` on `claude/silly-meninsky-138d3d`.

**Fix 1 (blocking, smi-4):** Restructured `MidiConnectionManager::OnTimerTick()` in `projects/synth/runtime/MidiConnectionManager.hpp`. It now returns immediately if the poller isn't dirty; if dirty, it re-enumerates via `detail::EnumerateDevices()`, compares against `lastEnumerated_`, and consults a new pure helper `synth::PlanMidiTickResponse(pollerDirty, listChanged, rebuildPending)` (`include/synth/MidiReconcile.hpp` / `src/MidiReconcile.cpp`) — reconciliation planning/execution runs only when the list changed or a rebuild reconcile is genuinely in flight (wired from the existing `reconciling_` guard, defensive since `Runtime::timerCallback()`'s ordering means a rebuild reconcile for the tick always completes before `OnTimerTick()` runs). `StartupReconcile()` and `OnInstrumentRebuilt()` are untouched — both still reconcile unconditionally on their own paths, so the gate applies only to poll-tick passes, matching the "must NOT skip instrument-rebuild-triggered reconciles" caution. Added four headless `TEST_CASE`s in `projects/synth/tests/reconcile_executor_tests.cpp` (`tick_response_*`) mirroring the existing `rebuild_response_*` pattern.

**Fix 2 (minor):** Rewrote the stale "shell chrome"/"patch-command chrome" paragraph in `projects/synth/README.md` (~line 158-202) to describe `MainPane`'s right sidebar (Audio/Controllers/File + deadline readout), with patch commands/identity on `FilePage` and MIDI device/controller config on `ControllersPage`.

**Verification:** `make -C projects/synth build test` — all suites green, zero warnings. `make -C projects/synth apps` — miniapp links cleanly. Launch smoke (`timeout 8`) started cleanly, logged one startup reconcile, prepared audio, no crash, no repeated log noise.

Fix note written to `/Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p4-task-6-report.md` (this directory is gitignored by design, so it's local-only, not part of the commit).

Note: `openspec/specs/synth-midi-instrument/spec.md` and its change-dir counterpart were already modified in the working tree before I started (the smi-4 update referenced in the task) — I included those pre-existing edits in this commit since they're the spec this fix implements against, not new spec authoring on my part.