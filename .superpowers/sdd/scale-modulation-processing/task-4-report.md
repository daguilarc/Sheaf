# Task 4 Report: Safe Bottom-Up Local Node Collection and Slot Reuse

## Scope

Implemented Task 4 only. The change adds explicit control-boundary collection of neutral local modulation-depth nodes, storage-slot reuse, view pinning, live/free/high-water accounting, and patch/revert integration. No OpenSpec checkboxes or progress files were edited.

## TDD Evidence

### RED

Lifecycle tests were added before production APIs. The required RED command was:

```text
make -C projects/synth build/parameter_modulation_tests
```

It failed at compile time because `ParameterGroup::CollectNeutralLocalParameters`, `LiveLocalParameterCount`, and `FreeLocalParameterSlotCount` did not exist. This was the expected missing-feature failure.

### GREEN and refactor

The minimal group collection/free-list APIs were implemented, followed by pinning, complete reset, safe-boundary wiring, persistence coverage, and lifecycle hardening. After each failure, production or contract-obsolete tests were corrected and the complete parameter suite was rerun. The final parameter suite is green.

Two existing tests intentionally changed to honor the new local-pointer lifetime contract:

- A closed neutral modulation view may no longer assume its lazy local pointer remains attached; the test reopens the view and validates metadata after storage reuse.
- The randomized recursive patch lifecycle no longer retains raw local pointers across load/revert collection boundaries; it reacquires omitted/default lazy topology through its parents before inspecting it.

No test dereferences a collected pointer.

## Implementation

### Ownership and accounting

- `ParameterGroup::parameterCount_` remains the constructed-storage high-water mark.
- `ParameterByLocalIndex` continues to enumerate the same storage objects after collection and reuse.
- `liveLocalParameterCount_` counts currently attached local-ID objects.
- `recycledLocalSlots_` stores each detached object's pointer, backing `ParameterStorageBatch*`, backing slot index, and stable storage-local index.
- `AvailableParameterSlots` includes never-used initial slots, never-used batch slots, and recycled local slots.
- Only local-ID creation consumes recycled slots; later manager top-level registration cannot accidentally turn a recycled local into a root.
- Reuse validates backing batch, slot, storage-local identity, and batch/group compatibility before reset.

### Eligibility and bottom-up detach

`CollectNeutralLocalParameters` starts from the dense top-level roots and visits children bottom-up. A child is detached only when it is a local parameter and all of the following are true:

- no live view pin;
- no child route remains;
- all scenes and latent gesture values are at the config default;
- no gesture is active;
- current/target center is both config-default and bipolar modulation-neutral;
- current/target center-scale, normalization, min/max, and depth state is neutral;
- no active route remains;
- cached knob, UI center, and UI spread state is neutral.

The parent source pointer is cleared before the child is placed on the reusable list. Parent active-route state is not cleared by collection, so a current nonzero route can continue its one-pole tail after its neutral child is detached.

### Pinning and raw-pointer lifetime

- Opening a modulation view pins each visible local depth control.
- A selected local target in a nested modulation view is pinned once; a manager top-level target's pin operation is a no-op.
- Nested view transitions release old pins and establish new pins without collecting between the two operations.
- Deselect removes/restores visible mappings, releases pins, clears `selected_`, and only then invokes collection.
- Local pointers are topology-lifetime references. Tests reacquire topology through the parent after a collection boundary.

### Central reset and reuse

`ResetLocalForReuse` performs an in-place reset without changing the backing spans or storage identity. It replaces the ID/config and resets:

- recursion and view-pin scalars;
- current/target centers;
- center scales and normalization offsets;
- current/target min and max values;
- current/target depth spans;
- route source permutation, inverse map, and active count;
- cached knob, UI center, and UI spread spans;
- child pointers;
- scene centers;
- all gesture values and active masks.

Metadata is resolved before entering reset and moved into the recycled object. Tests reuse a deliberately different old config under a distinct parent/source and verify name, short name, color, switch metadata, gestures 32/63, route identity, UI values/masks, and all exposed numeric state.

### Safe boundaries

Collection is invoked only from control paths:

- bank modulation-view close/deselect;
- bank reset operation completion;
- manager-wide revert completion;
- successful patch load after values/topology are applied.

An audit of all call sites confirms there is no collection call from `ProcessSample`, `ProcessLite`, `GetRaw`, `ComputeAtDepth`, modulation application, or any per-sample path.

## Test Coverage Added or Updated

- neutral leaf collection and live/free/high-water accounting;
- stable root addresses and stable `ParameterByLocalIndex` identity through reuse;
- every retention reason: non-default scene, inactive latent gesture, active gesture, unsnapped center state, nonzero normalization, non-collectible child, and open-view pin;
- recursive bottom-up subtree collapse;
- child detach while the parent active route finishes settling;
- nested-view and close/reopen pointer lifetime behavior;
- manager revert boundary collection;
- repeated edit/collect/reuse beyond `maxParameters`, including extra-batch backing;
- deterministic randomized collection/reuse across distinct parents and sources;
- semantic (key-order-independent) JSON equality before/after eligible collection;
- patch load retaining nested gestures 32 and 63 while collecting an omitted/default branch;
- lazy rematerialization of the omitted branch with identical output and fully reset state/metadata;
- randomized patch lifecycle reacquiring topology rather than retaining stale pointers.

## Verification

Build command:

```text
make -C projects/synth build/parameter_modulation_tests build/engine_tests build/miniapp_system_tests
```

Result: exit 0.

Test binaries:

```text
projects/synth/build/parameter_modulation_tests  # exit 0
projects/synth/build/engine_tests                # exit 0
projects/synth/build/miniapp_system_tests        # exit 0
```

`git diff --check` also exits 0.

## Commit

Commit hash: `dda1aeee` (`perf(synth): recycle neutral modulation controls`).
