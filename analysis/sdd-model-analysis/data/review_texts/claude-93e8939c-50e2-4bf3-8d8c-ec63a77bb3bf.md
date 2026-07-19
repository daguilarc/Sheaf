All 65 tests pass on a clean rebuild, no failures. Analysis confirms the fixes:

- **Coarse-history analyzability**: with `AutoScopeTestConfig` (levelCapacity 512, 3 levels, decimation ×4/level, analysisWindow 256, maxLag 64 → history threshold 321), 8000 raw samples give level0=8000, level1=2000, level2=500 samples — all ≥321, so the new test's initial full-work assertions are genuinely exercising all three levels rather than skipping coarse ones as invalid/insufficient.
- **RED/GREEN evidence**: `autoscope-low-frequency-task-1-report.md` documents real RED failures (missing `Configuration()`, missing `CandidateCacheSizeForTesting()`, `evaluatedLags==0` assertions) and a final GREEN run (65/65 pass, verified independently above), matching the actual test names in the diff.
- **Cache sizing pinned**: `candidateCache_(config_.buffer.numLevels)` in the constructor init list plus `CandidateCacheSizeForTesting()` and the assertion in `auto_scope_defaults_and_outer_api_are_pinned` pin construction-time sizing.

Also checked spec requirement sdsp-38 (openspec/changes/optimize-autoscope-low-frequency-tracking/specs/synth-dsp-classes/spec.md): construction-time allocation, invalidation on reset and captured-input discontinuity (`InvalidateCapturedTimeline` wired into `Reset()` and the transfer-overflow path only, not ordinary phase failures), and reuse of both valid and invalid candidates are all correctly implemented. No new gap found.

PASS