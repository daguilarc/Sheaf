## 1. Project Setup

- [x] 1.1 Create `projects/synth` with `include/synth/`, `src/`, `tests/`, and a project `Makefile` exposing `all`, `build`, `test`, and `clean`.
- [x] 1.2 Add root Makefile support for `synth`, `synth-build`, `synth-test`, and `synth-clean`.
- [x] 1.3 Add a minimal C++20 test executable and one smoke test proving the synth project builds and runs through `make synth-test`.
- [x] 1.4 Add project documentation stub describing the parameter/modulation library boundary and the Smart Grid-style modulation normalization model.

## 2. Core Types and Allocation

- [x] 2.1 Define core value types for normalized ranges, colors, IDs, scene state, page descriptors, and error/status returns.
- [x] 2.2 Implement `ParameterGroupConfig` with voice, modulator, gesture, scene, max-parameter, and alpha fields plus validation.
- [x] 2.3 Implement a group-owned upfront allocator that creates stable `Parameter` objects and shaped subarrays without hot-path allocation.
- [x] 2.4 Implement `ParameterManager` ownership of groups, banks, slots, page state, scene state, and the global parameter ID counter.
- [x] 2.5 Add unit tests for group shape validation, unique global IDs, allocator exhaustion, and stable parameter pointers.

## 3. Modulators and Gestures

- [x] 3.1 Implement `Modulators` with voice-major flat value storage, per-modulator metadata, connected flags, setters/getters, and `Apply(voiceIx, depths)`.
- [x] 3.2 Implement `Gestures` with values, selection flags, metadata, selected-state APIs, value APIs, and clear APIs.
- [x] 3.3 Add unit tests for modulator array indexing, dot-product behavior, metadata sharing across voices, gesture selection, and gesture value updates.

## 4. Parameter State and Compute

- [x] 4.1 Implement `Parameter` metadata, scene center storage, per-scene/per-gesture value and active storage, nullable modulation-depth route storage, current/target center, current/target center scale arrays, and current/target depth arrays.
- [x] 4.2 Implement normalized clamp helpers for unipolar and bipolar parameter centers.
- [x] 4.3 Implement Smart Grid-inspired scene blending and no-track gesture target-center interpolation.
- [x] 4.4 Implement modulation-depth route assignment with direct and indirect cycle rejection.
- [x] 4.5 Implement `Parameter::Compute()` for recursive depth computation, target center normalization, Smart Grid-style per-voice center-scale/depth normalization, and nested route slew bypass.
- [x] 4.6 Implement `Parameter::ProcessLite()` and `Parameter::Get(voiceIx)` with no graph traversal or allocation.
- [x] 4.7 Add unit tests for scene blend, gesture activation math, signed depth route recursion through `Get(voiceIx)`, weight-sum center scaling, depth-row division when weights exceed one, nested slew bypass, process-lite EMA, and `Get` clamping.

## 5. Editing Semantics

- [x] 5.1 Implement `Parameter::HandleIncDec(delta)` scene endpoint edits and two-scene Smart Grid distribution without tracks.
- [x] 5.2 Implement selected gesture activation, gesture value snapshotting from parent scene values, and weighted gesture/base edit distribution.
- [x] 5.3 Implement revert-to-default for active scene selection, including route clearing, depth zeroing, gesture deactivation, and center reset.
- [x] 5.4 Add unit tests for endpoint edits, Smart Grid-compatible blended scene edits including mid-blend attenuation and saturation solve behavior, selected gesture activation, gesture edit distribution, and default reset.

## 6. Pages, Banks, Slots, and Routing

- [x] 6.1 Implement manager pages with ordinals, parameter assignment, active page selection, and routing-only page changes.
- [x] 6.2 Implement `Bank` with physical encoder IDs, top-level parameter mapping, modulation-depth view population, return-cell behavior, and shift-press reset.
- [x] 6.3 Implement `BankSlot` with selected-bank ownership, bank switching that deselects prior modulation views, and physical encoder dispatch.
- [x] 6.4 Implement manager-routed press, shift-press, and tick/inc-dec APIs that dispatch by physical encoder ID through slots and selected banks.
- [x] 6.5 Add unit tests for page routing, mixed-group banks, modulation view nesting, return-cell deselection, slot bank switching, unmapped encoder safety, and routed tick dispatch.

## 7. Randomized Simulation Tests

- [x] 7.1 Build a deterministic simulation fixture with multiple groups, voices, scenes, gestures, pages, banks, slots, and connected modulators.
- [x] 7.2 Implement an independent oracle that models expected scene, gesture, page, bank, slot, route, target, current, and `Get(voiceIx)` state without using implementation compute/index helpers.
- [x] 7.3 Add random actions for encoder turns, presses, shift presses, gesture select/deselect, gesture value changes, page changes, bank selection, scene changes, blend changes, modulator value changes, compute, and process-lite.
- [x] 7.4 Check oracle expectations after every random action and report seed, step, action, affected IDs, expected values, and actual values on failure.
- [x] 7.5 Provide bounded default seeds for routine `make synth-test` and an opt-in stress mode for larger seed and step counts.

## 8. Verification and Cleanup

- [x] 8.1 Run `make synth-test` and fix any failures.
- [x] 8.2 Run root-level `make synth-build` and `make synth-test` to verify Makefile integration.
- [x] 8.3 Review headers for public API clarity, ownership comments, and hot-path allocation constraints.
- [x] 8.4 Confirm the implementation satisfies every `synth-parameter-modulation` requirement and update docs for any intentional final naming differences.
