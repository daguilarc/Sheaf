I have everything needed to answer. Note one detail: the report/review-package diff shows a field named `denseConfiguredRouteVisits`, but the current committed test file renamed it to `materializedTopLevelDenseRouteVisitUpperBound` (a later polish commit). That doesn't affect the answers.

## 1. EQUAL-WORK COUNTERS — YES, structural work assertions present

The authoritative test is `braid4_sparse_work_counters_bound_inactive_capacity` (braid4_system_tests.cpp:584-602). It uses `ParameterProcessingObserver` counters wired per-group via `SetProcessingObserverForTests` (lines 184-187), aggregating `topLevelProcessLiteCalls`, `activeRouteVisits`, `activeGestureVisits` (lines 202-206).

All four required configurations are covered via the `Braid4WorkScenario` enum (lines 109-114: `Baseline`, `MaterializedNeutral`, `SparseActive`, `Inactive64Gestures`) and measured at lines 585-588.

The equal-work assertions proving materialized-neutral does NOT change per-sample parameter work vs baseline (braid4_system_tests.cpp:590-601):
```cpp
REQUIRE_TRUE(neutral.topLevelProcessLiteCalls == baseline.topLevelProcessLiteCalls);   // 590
REQUIRE_TRUE(neutral.internalSubframesProcessed == baseline.internalSubframesProcessed); // 593
REQUIRE_TRUE(neutral.materializedLocalCount > 0);          // 596 (proves neutrals really materialized)
REQUIRE_TRUE(neutral.remainingMaterializableSlots == 0);   // 597 (every slot filled)
REQUIRE_TRUE(neutral.activeRouteVisits == 0);              // 598 (neutrals cost zero route work)
REQUIRE_TRUE(inactive64.activeGestureVisits == 0);         // 599
REQUIRE_TRUE(sparse.activeRouteVisits > 0);                // 600
REQUIRE_TRUE(sparse.activeRouteVisits < sparse.materializedTopLevelDenseRouteVisitUpperBound); // 601
```
The `sparse`/`inactive64` scenarios get the same top-level and subframe equalities (lines 591-592, 594-595).

A second complementary test, `braid4_parameter_processing_ignores_materialized_local_depths` (lines 552-582), materializes local depths then asserts top-level `ProcessLite` visits equal the root count (`visited == rootCount`, line 581), confirming materialized local nodes are skipped by top-level traversal.

Minor gap worth flagging: baseline's own `activeRouteVisits` is never directly asserted equal to neutral's; the neutral==0 assertion carries the claim. The equal per-sample-work claim rests on `topLevelProcessLiteCalls`/`internalSubframesProcessed` equality plus `activeRouteVisits==0`, which is sound but slightly indirect.

## 2. DEADLINE EVIDENCE — both rates present; numbers recorded in report, not in test

Tests (braid4_deadline_tests.cpp): 48kHz host/192kHz internal baseline at line 241-243, sparse-active at 249-251; 96kHz host/384kHz internal baseline at 245-247, sparse-active at 253-255 (internal = `sampleRate * 4`, printed at line 229). A 44100Hz case also exists (237-239).

Timing ceilings (braid4_deadline_tests.cpp:225-226):
```cpp
REQUIRE_TRUE(stats.averageSeconds <= stats.blockSeconds * 0.60);
REQUIRE_TRUE(stats.p99Seconds <= stats.blockSeconds * 0.80);
```
with `blockSeconds = 256 / sampleRate` (line 195). So avg ceiling = 60% of block, p99 ceiling = 80% of block (e.g. 48kHz block = 5.33ms → 3.20ms avg / 4.27ms p99; 96kHz block = 2.67ms → 1.60ms avg / 2.13ms p99).

Before/after avg and p99: the test itself only prints via `std::cout` (lines 228-232) and does NOT record baseline-vs-sparse numbers or assert any comparison between them. The recorded numbers live in task-6-report.md:57-62:
```
| baseline      | 48/192 kHz | 1.03810 ms | 1.06567 ms |
| sparse-active | 48/192 kHz | 1.04574 ms | 1.07104 ms |
| baseline      | 96/384 kHz | 1.02816 ms | 1.04525 ms |
| sparse-active | 96/384 kHz | 1.04270 ms | 1.11071 ms |
```
"No speedup ratio is asserted" (report line 64).

Treated as secondary: Yes. task-6-report.md:12-13 documents "deterministic counters as authoritative while timing remains platform-sensitive smoke evidence"; coverage.md:369-371 states the ceilings "are platform-sensitive smoke evidence; they do not assert a speedup ratio and do not replace the deterministic work-count contract above."

## 3. GATING — NOT gated/skipped; they always run (and always hard-assert)

No env var, no release-only guard, no skip. Registration is unconditional: the `TEST_CASE` macro emits a static `Register` that pushes into `Registry()` at load (braid4_deadline_tests.cpp:35-44), and `main()` iterates and runs every entry unconditionally (lines 257-279). The only conditional in the file is `#error` if JUCE headers leak (line 6), a compile guard, not a runtime skip.

Note the opposite risk: the ceilings at lines 225-226 are hard `REQUIRE_TRUE` assertions, so on a slow/loaded machine these timing tests can *fail* the suite (they are not soft/skipped). That is a flakiness surface, though the ceilings are generous (report measurements sit well under them).

## 4. COVERAGE.MD ACCURACY

- Sparse-Modulation Timing Evidence section (coverage.md:361-371): accurate. All four named deadline tests exist verbatim in the file; the "print baseline and sparse-active average/p99" claim matches the `std::cout` at braid4_deadline_tests.cpp:228-232; the host/internal rate labels match. Limitation language is present and correct ("platform-sensitive smoke evidence… do not assert a speedup ratio… do not replace the deterministic work-count contract").
- `spm-72` (coverage.md:33 and 302-319): the two braid4 test names (`braid4_parameter_processing_ignores_materialized_local_depths`, `braid4_sparse_work_counters_bound_inactive_capacity`) exist and do compare equal internal-subframe counts across all four scenarios as described; "Observer visit counts are the authoritative complexity contract" is accurate.

Flags / unverifiable within scope:
- `spm-72`, `spm-73`, `spm-74`, `spm-20`, `spm-25` rows also cite many tests in `parameter_modulation_tests.cpp`, `instrument_tests.cpp`, and `portable_ui_tests.cpp` (e.g. `active_modulation_routes_randomized_full_scan_oracle_and_work_bound`, `randomized_message_bus_ui_state_simulation`, `neutral_local_collection_*`). Those files were not in the read set, so the existence/behavior of those specific named cases is unverified here — the braid4-side claims are the only ones I confirmed against source.
- The coverage "Primary exact coverage" one-liner for `spm-72` (line 33) omits `braid4_parameter_processing_ignores_materialized_local_depths` from the summary column but includes it in the detailed mapping (line 314-315); minor, not a coverage overclaim.

No row was found claiming braid4-side coverage that the braid4 tests do not actually provide. The deadline section is careful not to overclaim (explicitly downgrades timing to smoke evidence).