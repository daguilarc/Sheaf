All probes pass: no throws, no non-finite values, no sanitizer diagnostics across a wide sweep of wavelengths, cycle counts, x-sample counts, and out-of-range/non-finite x inputs. Production-mode header compiles clean; 42/42 tests pass under ASan/UBSan.

Here is my independent review.

---

# Task 4 Review — Fine-LOD Refinement, Phase Tracker, and Reader

**Verdict: PASS** (no Critical or Important findings; four Minor notes below)

## Verification performed (read-only)
- Read brief, report, OpenSpec change (sdsp-34..37, tasks §4), full `DspAutoScope.hpp`, `DspLogStructuredBuffer.hpp`, and the test file.
- Recompiled tests with `-fsanitize=address,undefined`: **42/42 pass, zero diagnostics**.
- Production-mode syntax check (no `SYNTH_AUTOSCOPE_TESTING`, `-Wall -Wextra -Wpedantic`): clean.
- Wrote an independent range-safety fuzz probe sweeping wavelengths {13, 40, 40.5, 63.9, 160.5, 640.5} × cycles {1,2,3,5} × x-samples {1,2,17,256,1024}, driving `Get` over x∈[−5, N+5] plus NaN/∞, and an unpitched sweep: **no throw, no non-finite, no ASan/UBSan error**. Report claims are accurate.

## Spec-compliance audit (all satisfied)
- **Independent detection vs render selection** (`CreateReader:170-181`): render level chosen by lowest level whose retained half-open range ≥ `wavelength*numCycles + 2` endpoints (`RetainsDisplaySpan:305-317`), independent of hysteretic `detectionLevel`. ✓ (sdsp-37 "Coarse acquisition renders retained higher detail")
- **Stepwise D‑1..R five-candidate refinement** (`183-192`, `RefineWavelength:319-378`): descends one 4:1 level at a time, `predicted = prior*4`, evaluates exactly `round(pred)+{-2..+2}`, parabolic fit of interior min, rejects `best∈{0,4}` (`363-365`). Test observes exactly 2 stages / 10 candidates and ≤0.25-sample error for 640.5 and 160.5. ✓
- **±2 radius covers ≤0.5-sample incoming uncertainty before ×4** — offset clamped to [−1,1], result within [center−2, center+2]. ✓
- **Base-rate wavelength mapping** — `refinedBase = renderWavelength * LevelStride` (`194`); fractional, never grid-rounded. ✓
- **Delay-compensated phase coordinates** — `BaseToLocal` (`380-383`) is the exact algebraic inverse of `EffectiveBaseIndex` (buffer `254-256`); anchors and inverse projection share the accumulated FIR group delay. ✓
- **Strongest positive mean crossing + derivative fallback** (`AcquireCrossing:385-445`): mean over newest cycle, linear-interpolated positive-going crossing scored by slope (initial) or slope/(1+distance) (tracking), falls back to max positive derivative. ✓
- **PLL** (`UpdatePhase:447-474`): nearest-whole-cycle prediction, ⅛-period search radius, 1/10-period correction clamp, α=0.2 smoothing, coast via Task-3 lost-lock hold, clear on `InvalidatePhase`/`ClearLock`. ✓
- **≤1/32-cycle transition continuity** — verified for both render-level and detection-level changes. ✓
- **Reader snapshot/range safety** — `Get` clamps x and final index to snapshotted `[oldestIndex_, newestIndex_]`, then `buffer_.Read` re-validates (`55-77`); confirmed no OOB by fuzz. Partial-cycle stitch maps x∈[0,transfer]→newest partial cycle and x∈[transfer,N]→phase-corresponding older window; the split is monotonic in phase and the transfer point is a clean pen-lift. ✓
- **One/two-cycle scaling, unpitched fallback, empty-until-two-endpoints, public API/signature** (incl. `static_assert` on `Get`) — all present and passing. ✓
- **Scope containment** — diff touches only `DspAutoScope.hpp`, `autoscope_tests.cpp`, and the report; no Writer/transfer-ring/UI work. ✓

## Findings

**Minor 1 — Locked reader reports `Empty()` when newest sample lands exactly on a cycle boundary.**
`DspAutoScope.hpp:216-233`. When `elapsed == 0.0` (newest exactly at phase 0), `startIndex_ == endIndex_ == newest`, so `empty_ = (endIndex_ <= startIndex_)` becomes true even though a full older window is retained. Impact: a single blank frame in the measure-zero case; self-corrects next frame. Fix: when `hasTransfer_`, base `empty_` on the older-window extent (`continuationStart_ < startIndex_`) rather than only `endIndex_ > startIndex_`.

**Minor 2 — Stale `diagnostics_` render fields when a locked analysis fails phase acquisition.**
`DspAutoScope.hpp:196-203`. If `Analyze()` locks but `UpdatePhase` cannot find a crossing (`!phaseValid_`), `CreateReader` returns an unpitched Reader *before* updating `diagnostics_.renderLevel/renderWavelength/phaseBase`, leaving prior values while `diagnostics_.locked` stays true. The returned `Reader` is self-consistent (unlocked, renderLevel 0), so only the separate `Diagnostics()` accessor is briefly inconsistent. Fix: reset those three diagnostics fields on the unpitched early-return.

**Minor 3 — Sub-pixel mapping compression from denominator clamps.**
`DspAutoScope.hpp:65-71`. When `transferXSample_ < 1` or `numXSamples_ − transferXSample_ < 1`, the `std::max(1.0, …)` clamps distort the linear map so the partial cycle no longer reaches `endIndex_`. Only affects sub-pixel segments (invisible); the clamp is correct as div-by-zero protection. No action needed; noted for completeness.

**Minor 4 — Test-coverage gap vs OpenSpec tasks §4.5.**
tasks.md 4.5 enumerates deterministic tests for *gradual frequency drift*, *noisy crossings*, and *steady multi-read phase*; the delivered suite covers magnification correction, level-change continuity, crossing-free fallback, and discontinuity reacquisition, but not drift/noise/steady-hold tracking. The binding task-4 **brief** Step 1 list is fully satisfied, and the PLL machinery (α-smoothing, bounded correction, nearest-cycle prediction) exists to handle drift — but its drift/noise robustness is unproven by a dedicated test. Recommend adding a drifting-wavelength and a noisy-crossing phase test in a follow-up.

## Conclusion
The implementation is correct, range-safe, allocation-free on the read path, JUCE-free, and faithful to sdsp-35/37 and the task-4 brief. All required tests exist and pass, including under sanitizers, and my independent fuzzing found no boundary/OOB defects. The four notes are all Minor (edge-case cosmetics and a coverage suggestion). **PASS.**