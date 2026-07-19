Committed successfully.

Status: Complete, all findings fixed.
Commit: `3f615af` — `fix(synth): observe tick-consumed patch results in rig save pump`
Tests: `build/rig_tests` (5/5 pass, incl. new save-as/Written/file-exists case) and `build/engine_tests` (15/15 pass) rebuilt and run directly; full `make -C projects/synth test` afterward: 194 `[PASS]`, 0 `[FAIL]`, exit 0, zero warnings.
Concerns: none — all three findings (save-pump race via `ConsumeLastTickPatchResult()`, removed `SawNullMidiInputProcessor()`, new rig test) addressed; load/revert pumps also updated for the same double-consume hazard.