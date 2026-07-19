I have enough to render a verdict.

---

## Review: Task 3 — Mini App Migration

**Base:** `2f2756ee` **Head:** `5edfc0d2`

---

### Checklist

| Item | Status |
|------|--------|
| Helper uses `ParameterGroup::ProcessSample` | ✅ `DemoModulation.hpp:9` delegates directly to `group.ProcessSample(sampleIndex)` |
| Called once per frame with `block.startSample + frame` before module processing | ✅ `MiniAppCore.hpp:203` — first statement in the frame loop |
| Module order preserved (VCO → filter → LFO → `UpdateModValues` → output write → scope advance) | ✅ Lines 204–224 match the spec exactly |
| Mini app no longer relies on runtime once-per-block `ComputeAllTargets` | ✅ Old `ProcessLiteParameters` that relied on the runtime's pre-computed targets is gone; the report confirms the test caught the gap before the fix |
| System test asserts `targetComputeIntervalSamples == 16` | ✅ `miniapp_system_tests.cpp:460` |
| Initialization, page/bank routing, finite nonzero output, patch roundtrip tests remain | ✅ All four present: `miniapp_rig_initializes_headlessly_and_runs`, `miniapp_portable_surface_exposes_stable_ids_and_routes_actions`, `miniapp_rig_raising_volume_yields_nonzero_output_peak`, `miniapp_rig_patch_save_perturb_load_round_trip` |
| OpenSpec tasks 3.1–3.3 remain unmarked | ✅ All three are `[ ]` |
| Untracked `projects/synth/miniapp/` untouched | ✅ Not in the diff |

---

### Findings

**Minor — magic constant comment removed (`miniapp_system_tests.cpp:458`)**

The diff drops the trailing comment `// one-pole 1 kHz cutoff at 48 kHz` from the `expectedDefaultAlpha` line. The value `0.1226942309f` is not derivable by inspection — the comment documented the formula/context (IIR filter, 1 kHz at 48 kHz), which is exactly the kind of non-obvious WHY that earns a comment. Its removal leaves the constant opaque to future readers who adjust the sample rate or cutoff.

Suggestion: restore the comment on the same line, or add it above the declaration.

---

## Verdict: APPROVE WITH MINORS

Implementation is correct and complete. One minor: restore the `// one-pole 1 kHz cutoff at 48 kHz` comment on the `expectedDefaultAlpha` line before merging.