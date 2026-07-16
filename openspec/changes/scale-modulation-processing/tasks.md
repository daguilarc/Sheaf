## 1. Establish Sparse-Work Test Infrastructure

- [x] 1.1 Add test-only processing counters or observers for top-level `ProcessLite` calls, local recursive computes, active route visits, and active gesture visits without adding production audio-thread allocation.
- [x] 1.2 Add a deliberately source-indexed full-scan modulation/gesture oracle that can be compared sample-by-sample with the future sparse implementation.
- [x] 1.3 Add failing regression tests proving that materializing local modulation-depth nodes must not increase group-level `ProcessLite` call count and that nested local targets still recompute on cadence.

## 2. Implement 64-Bit Sparse Gestures

- [x] 2.1 Add boundary tests for gesture counts 0, 1, 32, 33, 64, and rejected 65, including indices 0, 31, 32, and 63.
- [x] 2.2 Replace manager gesture selection and per-parameter/per-scene gesture-active byte scans with `std::uint64_t` selectors and set-bit iteration while preserving selection-versus-activation and scene-blend semantics.
- [x] 2.3 Widen parameter snapshots, encoder/portable draw state, and controller gesture-affecting selectors to 64 bits; give gestures 16–63 distinct one-based numeric badge labels and add bit-63 snapshot/render tests. Browser command buffers need no layout/version work because they contain rendered commands, not masks.
- [x] 2.4 Extend gesture edit-distribution, message-bus, UI snapshot, and patch round-trip tests through gesture 63, including deterministic assertions that inactive configured gestures are not visited.

## 3. Restore the Top-Level Audio Processing Boundary

- [x] 3.1 Add an explicit dense top-level processing list to `ParameterGroup` and register only manager-owned top-level parameters in it.
- [x] 3.2 Change group per-sample processing to iterate the top-level list while retaining recursive control-rate compute; seed local cached/UI center state and reset local display spread at compute cadence, with tests pinning that intentional display-only behavior.
- [x] 3.3 Update parameter-group and Braid4 structural tests to prove that local materialization no longer changes per-sample parameter count or audio output semantics.

## 4. Implement Active Modulation Route Prefixes

- [x] 4.1 Add fixed-capacity route permutation, inverse-position, source-index, and active-count storage with debug/test invariants proving a valid stable-source bijection.
- [x] 4.2 Update recursive target compute to activate/reorder each parameter's across-voice route union and maintain contiguous current/target depth state while preserving indexed editing, metadata, masks, and JSON keys.
- [x] 4.3 Add an explicit `Modulators::ApplyActive(voiceIx, activeDepths, sourceIndices)` compact/source-index API and update `ProcessLite`, `GetRaw`, and production modulation application to visit only the active prefix, retaining routes whose current depth is still settling on any voice and removing them only after neutral snap at a control boundary.
- [x] 4.4 Add zero/sparse/dense, swap-removal, scene-change, nested-route, and return-to-zero tests that compare every step with the full-scan oracle.
- [x] 4.5 Extend the randomized parameter oracle with active permutations and assert source identity, inverse-map integrity, current/target depths, cached values, and UI masks after every action.

## 5. Recycle Neutral Local Modulation Nodes

- [ ] 5.1 Define and test the local-node collection boundary/pinning API so open modulation views and active control operations cannot retain recycled pointers.
- [ ] 5.2 Implement bottom-up eligibility checks covering all scenes, latent/default gesture state, active gestures, current/target/normalization state, child routes, and visibility pins.
- [ ] 5.3 Add a group-owned free list keyed by backing store and slot index, include recycled slots in `AvailableParameterSlots`/`CanAllocate`, and centralize full in-place local reinitialization; make local creation reuse a compatible recycled slot before requesting another asynchronous storage batch while retaining high-water `parameterCount_`/storage-index semantics.
- [ ] 5.4 Invoke collection after safe view-close/deselect, reset/revert, and patch-load boundaries without adding allocation, deallocation, locking, or collection traversal to the per-sample path.
- [ ] 5.5 Add lifecycle tests for retained non-neutral/child/visible nodes, recursive neutral-subtree collapse, parent detachment with route settling, distinct-parent slot reuse, and bounded capacity across repeated edit/collect cycles.
- [ ] 5.6 Add semantic JSON comparisons before/after collection and patch round trips proving that non-default nested topology is preserved and eligible neutral nodes remain omitted.

## 6. Performance Regression and Verification

- [ ] 6.1 Extend the Braid4 rig/deadline tests with structural work assertions for baseline, materialized-neutral, sparse-active, and 64-inactive-gesture configurations.
- [ ] 6.2 Run Braid4 deadline smoke measurements at 48 kHz host/192 kHz internal and 96 kHz host/384 kHz internal with generous platform-appropriate ceilings, recording before/after average and p99 results.
- [ ] 6.3 Run parameter modulation, module, persistence, portable UI, browser command-buffer, MIDI/controller, Braid4 system, Braid4 deadline, randomized oracle, and full synth test targets.
- [ ] 6.4 Add `spm-20`, `spm-72`, `spm-73`, `spm-74`, and modified `spm-25` rows/scenarios to `projects/synth/docs/coverage.md`, including deterministic complexity guards, 64-bit randomized UI-mask coverage, and timing-test limitations.
