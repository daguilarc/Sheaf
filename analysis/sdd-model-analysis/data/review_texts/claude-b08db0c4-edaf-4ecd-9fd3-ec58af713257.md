I have verified the complete change by reading the head-state source, tests, specs, and hand-computing the assignment math. Here is my review.

## Review: add-constant-modulator (cc0f2e2d..383dafff)

### Verification performed (by inspection, not execution)
Per the read-only constraint I did not run the build/test targets; I independently re-derived the math and cross-checked every assertion against head-state code rather than relying on the task reports.

### Greedy maximum-distance assignment — verified correct
I hand-evaluated `InitializeOutputs` (`DspConstant.hpp:35-57`) for n=1..7 against the test's expected table (`dsp_tests.cpp:221-239`) and the cyclic-distance property (`dsp_tests.cpp:241-264`):

- **Even** n=2→[0,1]; n=4→ranks[0,2,1,3]; n=6→ranks[0,3,1,4,2,5]. Cyclic distances 1, 8, 18 = ⌊n²/2⌋. ✓
- **Odd** n=3→ranks[0,1,2]; n=5→ranks[0,2,3,1,4]; n=7→ranks[0,3,4,1,5,2,6]. Distances 4, 12, 24 = ⌊n²/2⌋. ✓
- All ranks 0..n−1 covered exactly once in every case; `half = voices/2` gives the correct m for both parities; final entry pinned to `1.0f`. ✓

Code, design (`design.md:2`), and delta spec scenarios (`sdsp-39`) agree exactly.

### Other checks — all pass
- **Immutable/stable storage:** construction-only fill, `at()`-bounded `Output`, non-copyable+non-movable so registered pointers can't be invalidated (`DspConstant.hpp:24-27`). Zero-voice throws `std::invalid_argument`. ✓
- **Visualizer geometry:** range `[-0.1,1.1]`, kRange=1.2 → value 0 yields height h/12, value 1 leaves h/12 top margin (`ConstantBarVisualizer.hpp:34-51`); matches `spv-8` and tests. `barWidth = slotWidth − min(2, 0.2·slotWidth)` is provably positive for any slotWidth>0. Empty span / non-finite / non-positive bounds → no commands. One `Fill` per voice, no other draw command. ✓
- **Lifetime:** processor declared before visualizer (`MiniAppCore.hpp:354-356`); the borrowed `Outputs()` span outlives the visualizer under reverse-destruction order. ✓
- **MiniApp topology:** index 5 registered connected yellow `Constant`; indexes 0–4 untouched; `numModulators=6`, `maxParameters=84` (12+12·6), mod-view count 18 (`miniapp_system_tests.cpp:861`). ✓
- **No sample-path work:** `ProcessBlock` (`MiniAppCore.hpp:193-247`) calls `noiseModulator_.Process()` but no constant call/copy/branch; `UpdateModValues` simply dereferences the registered fixed pointers. The processor exposes no `Process()` (concept-asserted, `dsp_tests.cpp:80`). ✓
- **Integration with ganged/noise:** same `SetModulationSource` pointer-backed contract; distinct-visualizer test confirms mod5 ≠ mods 0–4 and equals `ConstantBarVisualizerInstance()`. ✓
- **OpenSpec traceability:** `sdsp-39/40`, `spv-8` added; `sdsp-13`/`sdsp-33` modified to six-slot/three-scope; coverage.md rows updated; Makefile lists both new headers as deps for all three test targets; tasks.md 12/12 checked. ✓

### Findings
None. No implementation or plan defects. Minor design notes (not defects): the visualizer's `std::clamp(…, 0, 1)` is defensive for a source that already emits [0,1]; the `min(2.0, …)` gap cap keeps bar width strictly positive across all bounds.

---

**SPEC VERDICT: PASS** — implementation matches the approved requirements, design, and plan; deltas are traceable and validated.

**QUALITY VERDICT: PASS** — closed-form O(n) construction, immutable/non-movable safety, minimal borrowing visualizer, thorough TDD assertions (exact values, rank coverage, cyclic-distance property, stable pointers, invalid-input safety, builder composition).

**READY TO MERGE: YES**