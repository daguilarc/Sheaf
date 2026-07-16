# Scale Modulation Processing Final Cleanup Report

Commit: `092a64d2` (`chore(synth): polish sparse modulation invariants`)

## Scope completed

- Added `ParameterGroup::TopLevelParameterCount()` and changed the Braid4 structural test to compare the direct registered-root count against high-water storage after local materialization.
- Replaced side-effect-only `SceneGestureIndex` casts with the explicitly named `ValidateSceneGestureIndices` helper while preserving the indexed accessor helper.
- Restored standard-library include order and centralized the shared `1e-6` modulation-neutral tolerance.
- Batched reset-bank collection: all unique mapped top-level parameters are reset first, then each distinct affected group is collected once. A work-count regression uses the existing processing observer boundary and also verifies all reset values.
- Centralized and documented `0.5` as the normalized bipolar knob center representing zero modulation depth.
- Added a three-level nested modulation-view regression proving pins retain the entire visible ancestry, deselection collapses the neutral subtree, and a later parent reuses one of those slots without growing high-water storage.
- Renamed and documented Task 6's dense-route comparison as the currently materialized top-level dense-route upper bound, not a full-capacity bound.

The deliberately excluded constructor binding helper was not added, and the symmetric oracle loops were retained unchanged.

## TDD evidence

1. Initial RED build failed because `ParameterProcessingObserver::neutralCollectionPasses` did not exist.
2. Separate Braid4 RED build failed because `ParameterGroup::TopLevelParameterCount()` did not exist.
3. After adding only the requested observability/API plumbing, the parameter suite ran and the new reset batching test failed specifically at `work.neutralCollectionPasses == 1`, demonstrating the old once-per-control collection behavior.
4. After batching the collection boundary, both focused binaries passed. The nested-view regression was then added as direct coverage of already-intended pin/reuse behavior and passed without additional production behavior changes.

## Verification

- `make -C projects/synth build/parameter_modulation_tests build/braid4_system_tests`
- `projects/synth/build/parameter_modulation_tests`
- `projects/synth/build/braid4_system_tests`
- `make synth-test`
- `openspec validate scale-modulation-processing --strict`
- `git diff --check`

All commands completed successfully. Strict OpenSpec validation reported `Change 'scale-modulation-processing' is valid`.

## Skips / risks

No requested cleanup item was skipped as invasive. The cleanup does not alter patch JSON, browser/controller protocol, source or gesture identity, or audio-rate traversal behavior. Collection observability adds only a null-checked counter increment at the existing control-boundary collection entry point.
