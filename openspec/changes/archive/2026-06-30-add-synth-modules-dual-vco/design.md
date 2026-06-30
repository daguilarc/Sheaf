## Context

The current synth stack has two adjacent layers:

- `ParameterModulation` owns groups, parameters, modulators, banks, pages, slots, scene state, gestures, and UI snapshots.
- DSP classes such as `WavetableVco` own audio state and process natural DSP inputs such as cycles per sample, wavetable position, and phase offset.

The synth mini app currently bridges those layers directly in `Main.cpp`: it creates the VCO parameters, creates modulation-depth parameters, maps controls into banks, reads normalized parameter values, converts tune to frequency, writes VCO-derived modulators, and populates VCO UI state. That works for one demo patch, but it does not establish a reusable pattern for future components.

This change introduces modules as the intended composition layer between parameter/UI routing and internal DSP processors. A module is a pattern and contract, not necessarily a required base class: it registers its parameters, stores parameter IDs, registers those parameters to bank slots, maps normalized values into natural input units, processes internal DSP processors, publishes UI state, and may contain child modules.

## Goals / Non-Goals

**Goals:**

- Keep DSP processors internal, reusable, and expressed in natural DSP units.
- Add stable parameter registration that returns `ParameterId` values suitable for future indexed lookup.
- Make initialization failures explicit coding errors rather than silent truncation or ignored duplicate mappings.
- Add parameter mapping helpers for standard linear, exponential, zero-based exponential, and bipolar conversions.
- Add pointer-backed modulation sources that can be updated every sample without re-registering metadata.
- Define a module lifecycle that is deterministic during initialization and allocation-free during sample processing.
- Implement the first module, a duophonic dual wavetable VCO, and use it in the mini app.

**Non-Goals:**

- Do not require a common module base class or inheritance tree.
- Do not make DSP processors know about knobs, banks, UI pages, or controller layouts.
- Do not introduce dynamic module reconfiguration after parameter registration begins.
- Do not replace the existing scene, gesture, bank, slot, or modulation-depth semantics.
- Do not add new external dependencies.

## Decisions

1. Treat modules as a structural pattern, not a mandatory class hierarchy.

   A module SHALL expose functions equivalent to `RegisterParameters(ParameterManager&, std::string_view prefix = {})`, `RegisterToBank(Bank&, std::size_t offset)`, `SetInput(ParameterManager&, Input&)`, `Process(...)`, and `PopulateUIState(...)` where relevant. Concrete modules may use those exact names without deriving from a common interface.

   Alternative considered: define an abstract `Module` base class. That would make homogeneous storage easier, but it would force every module into one virtual interface before the system has enough module examples to justify it.

2. Use a module-topology lock to separate initialization from runtime.

   `ParameterManager` and module code may allocate and wire dynamically before and during registration. Once registration begins, module topology is considered finalized: modules may not add/remove child modules or change declared visible parameter sets. The manager's global parameter list contains only top-level parameters intended for module/application lookup, so existing `ParameterId` indices stay stable. Modulation-depth controls are parent-owned local controls and do not append to the manager global list.

   Alternative considered: support runtime module creation/removal. That belongs in a later patch once audio-thread handoff and UI synchronization requirements are known.

3. Make `ParameterId` a true parameter-list index.

   `ParameterManager` will maintain a global parameter list and return the list index from `RegisterParameter`. This likely changes the first real parameter ID from `1` to `0`; tests that asserted one-based IDs should be updated to assert list-index behavior instead. This is a small breaking API clarification, but it removes a hidden translation layer from all module code.

   Alternative considered: keep one-based IDs and reserve list index `0` as a sentinel. That preserves current incidental behavior but violates the requested “index into the param list” contract and invites off-by-one bugs in modules.

4. Keep `CreateParameter` as a compatibility wrapper over `RegisterParameter`.

   `RegisterParameter` takes a group plus the existing `ParameterConfig`, applies required group/name validation, appends the created top-level parameter to the manager's global parameter list, and returns the assigned ID. `CreateParameter` must use that same top-level path. Lazily materialized modulation-depth controls deliberately do not receive global `ParameterId` values because modules should only refer directly to top-level module parameters.

   Alternative considered: create a richer descriptor type carrying mapping metadata. That is unnecessary for this change because natural-unit mapping belongs in each module's `SetInput`, not in parameter registration metadata.

5. Put reusable normalized-to-natural mapping helpers on `ParameterManager`, while modules own mapping policy.

   The manager already knows how to look up a parameter by ID and voice. Mapping helpers such as `GetLinear`, `GetExponential`, `GetZeroBasedExponential`, and bipolar variants should live there so module `SetInput` functions can express input mapping compactly and consistently. The manager supplies mapping primitives; each module decides which helper and range applies to each parameter.

   For zero-based exponential mapping, use `(maxValue, midpointValue)` where normalized `0` maps to `0`, normalized `0.5` maps near `midpointValue`, and normalized `1` maps to `maxValue`. The exact curve should be monotonic, continuous, clamp input to the parameter range, and avoid denormal/NaN behavior.

6. Represent modulation sources as metadata plus per-voice float pointers copied without transform.

   A `ParameterGroup` owns a modulation manager that stores source metadata and one pointer per voice. `SetModulationSource(modIx, sourcePointers, metadata)` is the single source of truth for that modulator's metadata and pointers: it validates pointer count and metadata, stores the pointers, and marks the source connected. `UpdateModValues` dereferences the stored pointers into the existing flat modulator values without applying normalization, scaling, or voice swapping. Producers such as modules therefore publish stable source floats that are already in the desired modulation range; the dual VCO module publishes raw per-voice audio outputs separately from normalized direct and swapped VCO modulation-source member values.

   Alternative considered: have modules write directly into `Modulators::Value` each sample. That is simple but repeats metadata/pointer wiring in every caller and makes source ownership less explicit.

7. Module bank registration infers capacity from the bank's associated slot layout and fails loudly.

   A bank can be durably associated with exactly one `BankSlot`, and multiple page banks may share the same slot layout. Selection remains a separate runtime routing concern: a slot may select one associated bank at a time, but a bank does not need to be the currently selected bank to use the slot layout during initialization. A module's `RegisterToBank(bank, offset)` registers its visible parameters into consecutive positions starting at `offset`, using the associated slot layout to determine available capacity. If the bank has no associated slot layout, if a parameter name is duplicated within the bank view, if the offset is out of range, or if the module needs more slots than the slot layout provides, the function throws a coding error such as `std::logic_error`.

   Alternative considered: pass capacity explicitly to module registration. That keeps `RegisterToBank` stateless but duplicates layout knowledge outside the bank/slot relationship and makes it easier for caller-supplied capacity to disagree with the physical controls.

8. The dual wavetable VCO module owns two `WavetableVco` processors and exposes four parameters.

   The module registers Tune, Phase, Shape, and Volume to preserve the miniapp's existing physical encoder order. Tune maps exponentially from 32 Hz to 3000 Hz and then to cycles per sample using the configured sample rate. Phase maps unipolar-linearly from `0` to `1` cycle of phase offset. Shape maps linearly to wavetable morph position. Volume maps unipolar-linearly from `0` to `1` gain. The module is duophonic and processes one VCO per voice, publishing per-voice raw audio outputs, normalized direct/swapped modulation-source floats, and VCO UI state. It does not need to publish a mixed audio output in this first version.

   Alternative considered: one VCO module instantiated twice. That remains compatible with the pattern, but the mini app already presents a paired dual VCO patch with cross-voice modulation sources, so a dedicated first module keeps the demo simple.

## Risks / Trade-offs

- Parameter ID indexing may break tests or callers that assume IDs start at `1` -> update tests and route `CreateParameter` through the new registration path so no split ID scheme exists.
- Pointer-backed modulation sources can dangle if modules outlive source storage -> sources must be registered only from stable module members, and tests should cover source pointer updates after repeated processing.
- Throwing coding errors during initialization can terminate the mini app on bad wiring -> this is intentional for initialization bugs; tests should assert the error paths.
- Bank capacity becomes dependent on an associated slot layout -> initialization must associate page banks with their slot after physical encoders are configured and before module bank registration.
- Zero-based exponential mapping can be numerically sensitive near zero -> clamp normalized inputs and document the curve with tests for endpoints and midpoint.

## Migration Plan

1. Add parameter-manager registration, lookup, mapping, and modulation-source APIs with focused unit tests.
2. Add module pattern helpers and a dual wavetable VCO module with JUCE-free tests.
3. Refactor the mini app to instantiate and register the module, leaving MIDI, pages, encoders, gestures, and scene controls intact.
4. Update existing tests that asserted one-based `ParameterId` values.
5. Run `openspec validate add-synth-modules-dual-vco`, `make -C projects/synth test`, `make -C projects/synth/miniapp test`, and `make -C projects/synth miniapp` where JUCE is available.

Rollback is source-level: revert the module integration and continue using the existing mini app direct wiring. No persisted data migration is involved.

## Open Questions

None.
