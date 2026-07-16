## Context

Braid4 owns 60 manager-registered top-level parameters (88 voice lanes) and runs parameter processing at four times the host sample rate. `ParameterGroup::ProcessSample` currently walks every group-owned `Parameter`, including lazily materialized local modulation-depth controls, even though local controls are intended to be evaluated recursively only when a top-level target is recomputed. The resulting audio-rate work grows with editor-created topology rather than DSP-visible top-level parameters.

Modulation and gesture storage also use configured-width arrays. `Modulators::Apply`, depth slew, `ComputeRawCenter`, edit distribution, and UI affecting-mask generation scan fixed capacities or all configured gestures. This is acceptable for two sources and a handful of gestures but not for the expected 2–4× top-level parameter count, more sources, and 64 gestures.

Local modulation-depth controls are lazily allocated and omitted from JSON when default, but their group-owned objects are never reclaimed. Bank modulation views hold raw non-owning pointers, so reclamation must be explicit and cannot invalidate a visible control. The audio path must remain allocation- and deallocation-free.

The Smart Grid implementation provides the useful model: stable indexed ownership, a compact active-index permutation/count, swap removal, bottom-up neutral-node garbage collection, and sparse traversal. Sheaf will adopt those principles without importing Smart Grid types.

## Goals / Non-Goals

**Goals:**

- Make audio-rate parameter work proportional to top-level parameters and active/settling routes, not allocated local controls or configured inactive capacity.
- Support exactly 0–64 gestures with 64-bit selection, activation, and UI-affecting selectors.
- Recycle semantically empty local modulation-depth controls safely and reuse their storage.
- Preserve source indices, gesture indices, recursive audio modulation behavior, slew behavior, patch JSON, and top-level pointer/ID stability.
- Prove both semantic equivalence and scaling behavior with deterministic tests, using timing tests only as secondary evidence.

**Non-Goals:**

- Moving UI min/max or display center/spread filtering to a slower cadence.
- SIMD/SoA parameter batching, nonlinear natural-unit mapping optimization, or changes to Braid4's oversampling factor.
- Supporting more than 64 gestures in this iteration.
- Returning recycled arena memory to the operating system on the audio thread.
- Changing the patch JSON schema or the public meaning of modulator and gesture indices.

## Decisions

### 1. Give groups an explicit top-level processing set

`ParameterManager::RegisterParameter` will register the new parameter in both the manager's ID table and its group's dense top-level processing list. Local controls created by `EnsureModulationDepth` will be group-owned but will never enter that list. `ParameterGroup::ProcessSample` will iterate only the top-level list; on target-compute samples each top-level root will recursively compute its local subtree before running top-level `ProcessLite()`.

Local recursive compute will seed current, cached, and UI center state from the recursively computed value and reset local display spread at compute cadence. Local controls therefore remain editable and audio-equivalent for recursive depth derivation, but no longer accumulate audio-rate UI center/spread history between compute samples. That display-only change is intentional because nothing consumes local modulation-depth values at audio rate.

Alternative considered: retain the existing all-parameter loop and branch on the local sentinel ID. That avoids local `ProcessLite()` but still makes audio work proportional to allocated topology and leaves a branch and pointer lookup for every local node.

### 2. Compact active route state while preserving source identity

Each parameter will retain its stable source-index-to-local-control mapping for editing, metadata, masks, and JSON. Separately, it will own a fixed-capacity route permutation plus inverse positions and an `activeRouteCount`. The prefix is per `Parameter`, and a route occupies it when any voice is active or settling; voices that are neutral keep zero depth values within that shared slot. Per-voice current and target depth state will be arranged by route slot, with active routes occupying `[0, activeRouteCount)`. Activation appends or swaps a source into the prefix; removal swap-removes it and updates the inverse position.

The route slot carries its original source index, so `GetRaw` and modulation application use the correct group source row even after compaction. A new `Modulators::ApplyActive(voiceIx, activeDepths, sourceIndices)` API will consume the compact depths and their stable source identities explicitly; the old full-width `Apply` remains only as a test-oracle helper or is removed once all production callers are migrated. `ProcessLite` slews depth state only across the active prefix. An active route remains in the prefix while either its target depth or its current depth is non-zero for any voice. When targets return to zero, current depths continue through the existing one-pole trajectory; once all voices' current and target values are within the existing `1e-6` neutral tolerance, control-rate maintenance snaps them to exact zero and removes the route. This avoids discontinuities while eliminating permanently neutral lanes.

The active prefix is rebuilt or incrementally maintained only at target-compute or topology-mutation boundaries using fixed storage. No allocation, locking, or object-graph traversal is added to the per-sample path.

Alternative considered: keep source-indexed depth arrays and iterate a compact vector of indices. That is simpler but adds gathers to each voice/route operation and makes future SIMD batching harder. Compact route slots make the hot range contiguous while the inverse permutation preserves indexed APIs.

### 3. Use 64-bit masks as the gesture sparse representation

The manager will store selected gestures in one `std::uint64_t`. Each parameter will store one active-gesture mask per scene instead of one byte per scene/gesture. Gesture values and metadata remain indexed arrays because their values must persist independently of selection.

Compute obtains the relevant scene mask (or the union of left and right masks during a blend) and iterates set bits with `std::countr_zero`/`mask &= mask - 1`. Edit arming iterates the manager selection mask; edit distribution iterates the active scene union. Existing blend-weight math and the distinction between globally selected and per-parameter active gestures remain unchanged.

`SetGestureCount` accepts 0–64 and rejects larger values before group creation. Parameter snapshots and encoder/portable draw consumers use `std::uint64_t` gesture-affecting masks. Badge labels retain the existing numeric labels for gestures 0–7 and directional labels for 8–15; gestures 16–63 use their one-based numeric labels (`17` through `64`) so high indices never collapse to the same badge. Browser command buffers serialize already-rendered draw commands and require no mask field or wire-layout change. The per-gesture `bankAffectingMask` remains a bank selector and therefore remains sized according to the separate bank-mask contract; it is not a gesture selector.

Alternative considered: maintain per-scene vectors of active gesture indices. A 64-bit mask is smaller, has deterministic mutation cost, naturally represents union/intersection across scene endpoints, and directly satisfies UI selection needs.

### 4. Reclaim local controls through bottom-up slot recycling

Garbage collection will operate only on local modulation-depth controls and only at explicit safe control boundaries such as closing/deselecting a modulation view, completing reset/revert operations, and completing patch load. It will never run from `GetRaw`, `ProcessLite`, or ordinary per-sample traversal.

A local node is reclaimable when all of the following hold:

- every scene center and persisted latent gesture value is at the local control's neutral/default value;
- no gesture is active on the node;
- current/target route state, scale, and normalization state are neutral within the existing tolerance;
- it has no child modulation-depth assignment after children have been visited bottom-up;
- it is not present in a live bank/slot modulation view or otherwise pinned by the current control operation.

Collection detaches the parent's stable source mapping, leaves any parent route that is still settling in the active prefix until its current depth reaches zero, resets the local object's state, and returns its group slot to a free list keyed by its backing-store identity and slot index. `AvailableParameterSlots`/`CanAllocate` count both recycled entries and never-used slots. `CreateLocalParameter` consumes a compatible recycled entry before requesting another storage batch and performs complete in-place construction/reinitialization with the new config, parent, source index, scene state, gesture state, route state, cached/UI state, and metadata. Top-level parameters are never recycled.

`parameterCount_` remains the high-water count of constructed storage slots, and `ParameterByLocalIndex` remains a storage-slot inspection API rather than a live-topology enumeration API. Live top-level processing and live-local ownership are tracked separately; recycled slots are neutral and detached until reused. Tests use explicit live-local/free-slot counters when asserting collection rather than interpreting the high-water count as a live-node count.

This design intentionally defines raw pointers returned for local modulation controls as topology-lifetime references: they are valid until a documented collection boundary. Bank/slot code pins visible locals across such a boundary. Top-level `Parameter*` and `ParameterId` lifetimes remain unchanged.

Alternative considered: destroy local `unique_ptr`s and compact group storage. Destruction can deallocate on a real-time thread, compaction invalidates spans and pointers, and either behavior conflicts with the current arena design. Recycling gives the capacity benefit without those hazards.

### 5. Keep JSON structural and backward compatible

Serialization continues to walk manager-registered top-level roots recursively and emit only non-default `modDepths` entries keyed by stable source index. An eligible GC node already contributes no serialized state, so collecting it does not change value JSON. Loading continues to materialize only entries present in JSON; after load, bottom-up collection may recycle any redundant default nodes created by legacy or malformed-but-accepted input.

### 6. Test semantics and work bounds separately

Correctness tests will compare sparse behavior against a deliberately simple full-scan oracle. Performance regressions will primarily be guarded by deterministic counters/visited-index assertions, because wall-clock deadline tests are useful evidence but too noisy to prove complexity.

The implementation test plan is:

1. **Top-level boundary tests:** instrument group processing and verify that `N` top-level parameters produce exactly `N` `ProcessLite` calls regardless of materialized local-node count; verify recursive target recompute plus compute-cadence cached/UI center seeding and zero local display spread for nested local controls.
2. **Route equivalence tests:** exercise zero, sparse, dense, activation, swap removal, scene changes, nested modulation, and return-to-zero settling; compare every current/target depth and `GetRaw` result with a source-indexed full-scan oracle after each sample/control step.
3. **Gesture boundary tests:** cover counts 0, 1, 32, 33, and 64; explicitly exercise indices 0, 31, 32, and 63 through selection, activation, scene blending, edits, messages, UI snapshots, distinct encoder badges, and persistence; verify 65 is rejected.
4. **Sparse-work tests:** with 64 configured inactive gestures, assert zero gesture contributions are visited; with selected/active masks, assert the visit count equals `popcount(mask)`. Do the analogous check for active modulation routes.
5. **GC lifecycle tests:** prove each eligibility guard, visible-node pinning, bottom-up collection, parent detachment, active-route settling after detachment, complete state reset on reuse, and bounded storage across repeated materialize/neutralize/collect cycles.
6. **Persistence tests:** compare semantic JSON before/after GC, round-trip non-default nested routes and gestures 32/63, and verify lazy rematerialization produces identical outputs.
7. **Randomized oracle tests:** extend the existing deterministic state-machine oracle with active permutations, 64-bit masks, collection boundaries, slot reuse, and stale-state checks after every action.
8. **Braid4 regression tests:** add structural counters to the rig showing that materializing neutral local routes does not change per-sample parameter work; run 48 kHz/192 kHz-internal and 96 kHz/384 kHz-internal deadline smoke cases for baseline, sparse active routes, and 64 inactive gestures. Keep generous platform-appropriate timing ceilings while treating the deterministic work assertions as authoritative.
9. **Verification commands:** run the parameter, module, persistence, portable UI, browser command-buffer, MIDI/controller, Braid4 system, and Braid4 deadline targets, followed by the repository synth test target.

## Risks / Trade-offs

- **[Risk] Active permutation bugs associate a depth with the wrong source.** → Store source index in every route slot, maintain an inverse permutation, assert the bijection in tests/debug builds, and compare against a full-scan oracle.
- **[Risk] Removing a route too early changes the one-pole tail.** → Keep current-nonzero routes active until the neutral tolerance is reached, then snap and remove only at a control boundary.
- **[Risk] GC invalidates a visible or externally retained local pointer.** → Pin bank-visible nodes, collect only at documented boundaries, never recycle top-level nodes, and test view close/reopen and slot reuse. Document local pointer lifetime explicitly in the public API.
- **[Risk] Recycling leaks stale scene, gesture, metadata, or UI state.** → Centralize full local-slot reinitialization and test reuse with deliberately distinct old/new parents, sources, names, colors, scenes, and gesture masks.
- **[Risk] High gesture indices become ambiguous in compact encoder badges.** → Preserve the existing 0–15 labels and render gestures 16–63 with distinct one-based numeric labels, with explicit index-63 coverage.
- **[Trade-off] Recycled storage is not returned to the OS.** → Peak arena memory remains high-water-mark based, but repeated editing stops growing capacity and no real-time deallocation is introduced.
- **[Trade-off] Dense 64-gesture patches still perform dense work.** → This change makes sparse patches scale with active count; SIMD/batched dense evaluation remains a later optimization.

## Migration Plan

1. Introduce 64-bit gesture types and compile-time consumer updates with behavior-preserving tests.
2. Add top-level processing lists and active route permutations behind assertions while retaining full-scan test oracles.
3. Switch the hot paths to sparse traversal after equivalence tests pass.
4. Add local-slot free lists and explicit collection boundaries, then enable reuse.
5. Run patch compatibility, randomized, UI/controller, and Braid4 regression suites before removing transitional assertions or counters not intended for production.

Rollback is source-only: patch JSON is unchanged, so reverting the implementation does not require data migration.

## Open Questions

None. Browser command buffers carry rendered commands rather than gesture masks, and the repository can change its internal browser-synth representation atomically while it remains unshipped.
