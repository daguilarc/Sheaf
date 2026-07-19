All three reviewer findings fixed, verified, and committed.

Status: Complete.

- **Finding 1** (planner Offline semantics): `PlanEndpointPass` in `projects/synth/src/MidiReconcile.cpp` now emits `Mark*Offline` for a configured ref with no matching present device from both `Online` (Close+Offline, unchanged) and `Unconfigured` (Offline only, no Close — nothing open) connection status. Fixed test-first: flipped `startup_shaped_reconcile_one_of_two_controllers_present_no_failure` in `projects/synth/tests/reconcile_tests.cpp`, watched it fail, then fixed the planner. Audited all other truth-table tests — no other case had the configured-ref+Unconfigured+absent shape; the "unconfigured ref is inert" test (empty ref) is correctly untouched.
- **Finding 2** (rebuild gate pinning): Added `synth::PlanMidiRebuildResponse(bool started, size_t oldCount, size_t newCount)` returning `{resizePlan, reconcile}` to `include/synth/MidiReconcile.hpp` / `src/MidiReconcile.cpp`, pinned by 3 new cases in `projects/synth/tests/reconcile_executor_tests.cpp`. `MidiConnectionManager::OnInstrumentRebuilt()` in `projects/synth/runtime/MidiConnectionManager.hpp` now consumes it instead of an untested inline `!started_` check.
- **Finding 3** (log noise): Added `operator==` to `MidiDeviceInfoRef`/`MidiDeviceList`, plus `lastEnumerated_`/`hasLastEnumerated_` members on `MidiConnectionManager`. `Reconcile()` now skips its `INFO` line only when the plan is empty and the device list is unchanged since the last pass; documented the choice to keep planning/execution unconditional (cheap, already idempotent) rather than adding a second short-circuit.

Test summary: `make -C projects/synth build test` — 342 assertions, 0 failures, 0 warnings. `make -C projects/synth apps` — clean rebuild, links with 0 warnings/errors.

Commit: `e0c8d24e4f2e9e7c8f7973c781e6154e3ff2c0e7`

Fix report appended to `/Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p3-task-3-report.md` (note: that directory has its own `.gitignore` excluding report files from version control — this is pre-existing repo convention, not an oversight).