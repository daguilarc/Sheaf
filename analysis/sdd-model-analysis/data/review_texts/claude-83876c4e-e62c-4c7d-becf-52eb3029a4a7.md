I've completed a thorough read of the Task 7 implementation, tests, docs, OpenSpec brief/report, and the underlying density implementation paths. Here's my review.

## PASS

The Task 7 implementation is correct, well-structured, and the tests, benchmark, and documentation are internally consistent. I verified the areas the brief flagged as risk-prone and found no blocking defects. Findings below are minor/non-blocking observations.

---

### Verification of high-risk areas (all clean)

**Timer contamination / clock use** — The four timed regions (`producerStart/End`, `maintenanceStart/End`, `rebuildStart/End`, `hitStart/End`) each wrap only their intended operation. Diagnostics snapshots (`autoscope_benchmark.cpp:502-510`), frame validation/checksumming (`:542-543,554`), byte-identity comparison (`:556`), and browser serialization (`:581-610`) all happen **outside** the timed regions. `steady_clock` is used consistently; timing accumulates only for `frame >= kWarmupFrames` (`:565`).

**Checksum / DCE prevention** — `ChecksumCommand` mixes every raster alpha byte (`:263-266`), the checksum flows to `ProfileResult::checksum` and is printed (`:946`), so the optimizer cannot elide the timed `Draw()` work. Observable use of `changed`/`unchanged` after timing acts as an effective barrier. Report's claim verified.

**Serializer delta correctness** — `BrowserDensityBytes` diffs complete-vs-without-density trees over an *identical* node structure (`:376-385`), correctly isolating raster contribution and cancelling node-id overhead. The aggregate check `browserDensityBytes == browserBytesPerRaster * rasterCount` (`:608-610`) is a genuine additivity integrity check, not a baked-in wrong assumption. 16,417 = 16,384 + 33 bytes overhead, below the 16,448 ceiling — consistent.

**Storage accounting (no double-count / no omission)** — `DensityAnalysisStorageBytesForTesting` (`DspAutoScope.hpp:706-717`) sums exactly the 10 density-analysis vectors (`:2636-2645`) and correctly excludes `densityRaster_` (reported separately). The dominant term is `densityAccumulator_` (rasterW×rasterH doubles = 8× raster bytes), which makes the `densityAnalysisBytes > rasterStorageBytes` assertion (`autoscope_tests.cpp:1852`) robustly true. Scalar-LSAB, summary (via `SummaryStorageBytes()` accessor), YIN-scratch, candidate-cache, density-analysis, and raster categories are disjoint — no double count. `sizeof(AutoScope)` in the approximate total is inline footprint only; heap payloads are counted separately.

**Reset/overflow invalidation** — `InvalidateDensityTimeline` (`DspAutoScope.hpp:2200-2219`) clears template validity, raster-cache validity, diagnostics (`empty=true`), and zeroes the template. It is reached from both `Reset()` (`:435`) and the overflow fast-forward path (`:470` via `InvalidateCapturedTimeline`). The test `auto_scope_density_reset_and_overflow_clear_template_cache_and_diagnostics` exercises both paths precisely.

**Cache/hidden-maintenance evidence via diagnostics (not timing)** — `SameDensityDiagnostics`/`SameLegacyDiagnostics` snapshot-compare across `ProcessUiFrame` (`:518-524`) proves maintenance leaves analysis untouched; `ValidateDensityWork(false/true)` (`:733-772`) proves changed rebuild does full alpha work and the immediate hit does zero descriptor/alignment/accumulation/alpha work with byte-identical output. The brief's "prove invalidation/reuse through diagnostics, do not assert bytes change" instruction is honored.

**Topology assertions** — Production 14 (`4+2+1` VCO twice as LFO), 6 visualizers, 7/7 audio/LFO; stress 100, 43 visualizers, 51/49 — all asserted in the constructor (`:438-467`) and `main` (`:957-978`). Exact-density fixture (`auto_scope_density_actual_center_sampling_and_column_alpha_are_exact`) pins a 2×3 raster to exact bytes plus normalized template `[-1,1]` and accumulation/alpha counts — high-quality exact test.

**Documentation-number consistency** — I cross-checked report ↔ `autoscope-performance.md` ↔ benchmark assertions. All timings, budget percentages (recomputed: 1.544/33.333 = 4.632%, 14.834/33.333 = 44.501%, etc.), storage MiB (summary 15.75 MiB = 7×0.75 + 7×1.5, verified), encoded bytes (16,417×14 = 229,838; ×100 = 1,641,700), alpha evals (14×16384×30 = 6,881,280), and checksums all agree. `sdsp-39`, `spv-6/7`, `sprs-9`, `d4-11` coverage mappings updated without dropping prior coverage.

**Legacy-reader hardening** (`portable_ui_tests.cpp:613-668`) — Concrete `AutoScope::CreateReader(257,1)` path with a fractional period (161.5) exercises coarse-detect/fine-render level split, fractional wavelength, transfer-boundary polyline split, fixed point budget, and empty-reader emptiness. Legitimate concrete-path hardening, isolated from the density work.

---

### Minor / non-blocking observations

1. **Hand-computed storage formulas duplicate internal layout** (`autoscope_benchmark.cpp:318-332`). `scalarLsabFloats` and `yinScratchDoubles` recompute buffer/YIN allocation by hand rather than via accessors (unlike summary/candidate/density/raster, which use accessors). If internal layout drifts, these numbers become silently wrong with no failing assertion. This is *pre-existing* (the `K*C+(K-1)*(2T+4⌈T/4⌉)` formula predates Task 7); Task 7 correctly added accessors for the new density/summary storage. Worth a future accessor for the scalar/YIN categories, but not a Task 7 regression. `file:autoscope_benchmark.cpp:321`

2. **Vector-move inside the rebuild/hit timers** (`:538,550`). `changed.push_back(visualizer->Draw())` includes a 3-pointer vector move in the timed region. `changed`/`unchanged` are `reserve`d (`:534,546`) so there's no reallocation, and the contamination is symmetric across both regions, so it does not bias the changed-vs-hit comparison. Negligible.

3. **No explicit compiler barrier** (e.g. `DoNotOptimize`). Relies on observable use of results for the DCE barrier, which is sound here given the non-inlined library calls and the checksum consumption. Standard practice; noting for completeness.

4. **Conservative worst-case only** — the benchmark measures all-populated, all-six-visualizers-visible. This is intentional per the brief and clearly disclosed in both the doc ("deliberately conservative") and report. Not a gap.

Uncertainty: I did not (and per reviewer scope must not) re-run the suite or the exact-fixture raster arithmetic; I verified the fixtures are internally self-consistent and relied on the report's GREEN/verification-matrix evidence for runtime pass/fail. The exact 2×3 alpha fixture and the requested-cycle span-scaling tolerances I confirmed as plausible and self-consistent but did not independently recompute the DSP math.