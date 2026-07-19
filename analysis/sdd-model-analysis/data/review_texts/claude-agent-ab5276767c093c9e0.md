All five findings are fixed, verified, and documented. Final summary:

**Status:** Complete. All 5 reviewer findings fixed with TDD where applicable.

**Commit:** `228526e` — `fix(synth-runtime): controllers page VM delegation, rebuild subscription, focus-safe refresh` (on branch `claude/silly-meninsky-138d3d`, working tree clean).

**Test summary:** `make -C projects/synth build test` → 394 `[PASS]`, 0 `[FAIL]`, 0 warnings (11 net new tests). `make -C projects/synth apps` → clean forced rebuild, 0 warnings/errors. Launch smoke (`timeout 8`) ran clean three times with no crash indicators.

**Finding 3 "(none)" close-path check:** Confirmed via TDD that the planner had a real gap — `PlanEndpointPass` in `src/MidiReconcile.cpp` treated any unconfigured ref as fully inert regardless of connection status, so clearing a device to "(none)" while it was online never closed it. Wrote 3 failing tests first in `tests/reconcile_tests.cpp`, then fixed `PlanEndpointPass` so an unconfigured ref that's currently `Online` now emits `Close*` + `Mark*Offline` (an unconfigured ref that's already `Offline`/`Unconfigured` stays inert, unchanged). All new and pre-existing reconcile tests pass.

**ManualOpen\* deletion:** `ManualOpenInput`/`ManualOpenOutput`/`ManualCloseInput`/`ManualCloseOutput`/`IsInputOpen`/`IsOutputOpen`/`InputDeviceName`/`OutputDeviceName`/`InputLastError`/`OutputLastError` were all confirmed dead (grepped `runtime/`, `tests/`, `apps/` after removing `ControllersPage`'s usage — nothing else referenced them) and **deleted** from `runtime/MidiConnectionManager.hpp`, along with the now-unused `EnsureStateSlot` private helper. `ControllersPage`'s device combo now goes exclusively through `SetEndpointRef` → `engine.EditInstrument`.

Fix report appended to `/Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p4-task-4-report.md`.