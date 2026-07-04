## Context

`Parameter::Compute()` delegates to `ComputeAtDepth()`, which first computes the parameter's own target center, then recursively computes any local modulation-depth parameters, then reads each depth parameter with `GetRaw(voiceIx)` to populate `targetDepths`. The existing modulation path treats those target depths as signed normalized weights: it normalizes by `sum(abs(depth))` when needed, slews the current depths in `ProcessLite()`, and `GetRaw()` applies the modulator row as a linear dot product.

The parameter library already exposes zero-based exponential primitives:

- `ZeroBasedExponentialBaseFromMidpoint(midpointValue, maxValue)`
- `ZeroBasedExponentialMap(normalized, base, maxValue)`
- `ParameterManager::GetBipolarZeroBasedExponential(maxAbsValue, midpointAbsValue, voiceIx, id)`

This change applies the same signed zero-based exponential shape to local modulation-depth controls during recursive compute, but it should not route through the manager-level cached mapping helper because depth computation needs the freshly computed child parameter value during recursion.

## Goals / Non-Goals

**Goals:**

- Convert recursively computed modulation-depth knob positions into signed exponential target depths.
- Use a fixed curve where absolute knob travel `0.5` maps to absolute depth `0.125`, and absolute knob travel `1.0` maps to absolute depth `1.0`.
- Compute the mapping base from the halfpoint once as a constant, then reuse that base for all depth target computations.
- Leave the modulation dot product, depth normalization, min/max accounting, smoothing, persistence, and UI storage of knob positions intact.

**Non-Goals:**

- Do not change how top-level parameter mapping helpers work for module natural-unit reads.
- Do not migrate stored patches; stored depth knob positions remain the source of truth.
- Do not make modulation sources exponential or nonlinear. Only the depth coefficient is curved before the existing linear dot product.
- Do not change modulation-depth parameter range, materialization, naming, or ownership.

## Decisions

1. Add a dedicated modulation-depth mapping helper near the existing zero-based exponential helpers.

   The helper should clamp a signed bipolar knob value to `[-1, 1]`, map `abs(knob)` through `ZeroBasedExponentialMap(absKnob, kBase, 1.0f)`, and reapply the original sign. This mirrors `GetBipolarZeroBasedExponential()` without requiring a `ParameterManager` lookup or midpoint-to-base conversion.

   Alternative considered: call `ParameterManager::GetBipolarZeroBasedExponential(1.0f, 0.125f, voiceIx, depthId)`. This is awkward because local modulation-depth parameters are intentionally not manager-registered top-level parameters, and the manager helper maps cached `ProcessLite()` values rather than the recursive compute result needed here.

2. Define curve constants for depth target mapping.

   Use `maxAbs = 1.0f`, `halfpointAbs = 0.125f`, and `base = ZeroBasedExponentialBaseFromMidpoint(halfpointAbs, maxAbs)`. For these values the base is `49`, so `ZeroBasedExponentialMap(0.5, 49, 1.0) == 0.125`.

   Alternative considered: pass `(1.0f, 0.125f)` through `ZeroBasedExponentialMapFromMidpoint()` on each depth read. That preserves behavior but repeats the base derivation inside the hottest recursive compute loop.

3. Apply the mapping exactly where `ComputeAtDepth()` converts child depth parameter values into `targetDepths`.

   The existing recursive ordering remains correct: child depth parameters are computed before their values are read. The only change is replacing the direct assignment from `depthParameter->GetRaw(voiceIx)` with the mapped signed depth value.

   Alternative considered: curve modulation-depth parameter `GetRaw()` itself. That would leak depth-specific semantics into ordinary parameter reads and would incorrectly affect UI state, persistence-oriented tests, and any future non-depth use of bipolar parameters.

## Risks / Trade-offs

- Existing patches with nonzero depth knobs will sound less modulated near center. -> This is the intended ergonomic change; extremes and center remain anchored.
- Tests and docs using literal depth values may assume linear depth targets. -> Update focused parameter modulation tests and the deterministic oracle to distinguish knob position from effective depth.
- A helper exposed in the public header could look like a general mapping API. -> Name it specifically for modulation-depth target mapping if it is public, or keep it private to the implementation with tests covering externally visible behavior.
- Floating-point tolerance around the midpoint may obscure the exact `1/8` contract. -> Test the canonical points `-1`, `-0.5`, `0`, `0.5`, and `1` with tight tolerances.

## Migration Plan

No stored data migration is required. Patch JSON continues to store modulation-depth parameter knob positions. Rollback is the inverse code change: return `ComputeAtDepth()` to assigning `depthParameter->GetRaw(voiceIx)` directly into `targetDepths`.

## Open Questions

None.
