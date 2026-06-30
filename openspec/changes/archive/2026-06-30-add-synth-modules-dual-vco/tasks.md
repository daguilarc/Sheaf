## 1. Parameter Registration And Lookup

- [x] 1.1 Add manager-owned global parameter list storage and zero-based `ParameterId` lookup helpers.
- [x] 1.2 Implement `ParameterManager::RegisterParameter(ParameterGroup&, ParameterConfig)` as the new validated creation path, including group membership, effective-name validation, duplicate-name rejection, and no-partial-registration behavior.
- [x] 1.3 Route `CreateParameter` through the global-list registration path for top-level parameters, while keeping modulation-depth controls parent-owned and outside the manager global list.
- [x] 1.4 Update unit tests for zero-based parameter IDs, stable lookup, duplicate-name rejection, invalid ID lookup, allocation exhaustion, and compatibility with existing group ownership.

## 2. Parameter Mapping Helpers

- [x] 2.1 Add manager-level linear mapping helpers that read by `(voiceIx, parameterId)` and map endpoints exactly.
- [x] 2.2 Add exponential geometric mapping helpers for positive `minValue` and `maxValue`, including endpoint and midpoint-ish behavior tests.
- [x] 2.3 Add zero-based exponential mapping helpers using `(maxValue, midpointValue)` with tests for `0`, `0.5`, and `1`.
- [x] 2.4 Add bipolar variants for linear, exponential, and zero-based exponential mappings with signed-center tests.
- [x] 2.5 Verify all mapping helpers use `Parameter::Get(voiceIx)` so scene, gesture, and modulation state affect mapped values.

## 3. Modulation Source Update System

- [x] 3.1 Add group-owned modulation-source registration that stores per-voice `float*` pointers plus source metadata as the source of truth for that modulator.
- [x] 3.2 Add group-level `UpdateModValues` that dereferences registered source pointers into flat per-voice modulator values without heap allocation or value transformation.
- [x] 3.3 Add manager-level update API that delegates to one group or all groups.
- [x] 3.4 Add tests for metadata storage, per-sample value refresh, invalid pointer counts, null connected pointers, and preserving previous configuration after failed registration.

## 4. Bank Registration Safety

- [x] 4.1 Add durable bank/slot association so each bank can know one `BankSlot`, multiple page banks can share a slot layout, and module registration derives capacity from the associated slot's physical layout.
- [x] 4.2 Implement duplicate visible-name, duplicate slot, out-of-range offset, and insufficient-capacity checks as coding errors.
- [x] 4.3 Ensure failed module bank registration leaves bank mappings unchanged.
- [x] 4.4 Add tests for successful offset registration, capacity from slot layout, missing-slot rejection, and each failure mode.

## 5. Module Pattern And Dual Wavetable VCO

- [x] 5.1 Add a JUCE-free module header/source for the structural module pattern and module utility types where useful.
- [x] 5.2 Implement a duophonic dual wavetable VCO module that owns two default 12-bit `WavetableVco` processors and stable per-voice raw output plus normalized modulation-source member storage.
- [x] 5.3 Implement module parameter registration for Tune, Phase, Shape, and Volume, including optional effective-name prefixes.
- [x] 5.4 Implement module bank registration for the four visible parameters.
- [x] 5.5 Implement module input mapping: Tune 32 Hz to 3000 Hz exponentially then to cycles per sample, Shape linearly to wavetable position, Phase unipolar-linearly to `0..1` cycle offset, and Volume unipolar-linearly to `0..1` gain.
- [x] 5.6 Implement module processing, raw per-voice output publication, normalized direct/swapped modulation-source float publication, scope/UI-state publication, and modulation-source pointer registration helpers.
- [x] 5.7 Add tests for parameter registration, prefix uniqueness, repeated-registration errors, bank mapping, natural-unit input mapping, processing, output scaling, and UI state for both VCOs.

## 6. Miniapp Integration

- [x] 6.1 Replace ad hoc VCO parameter creation in `projects/synth/miniapp/Main.cpp` with the dual wavetable VCO module registration flow.
- [x] 6.2 Replace ad hoc VCO bank mapping with module `RegisterToBank` while preserving the VCO and LFO pages, one bank slot, four encoders, scenes, gestures, shift behavior, MIDI profile, and waveform pane.
- [x] 6.3 Replace direct VCO parameter-to-input formulas in the miniapp sample loop with module `SetInput`/`Process` calls.
- [x] 6.4 Register VCO-derived direct and swapped normalized source floats through the pointer-backed modulation-source API and call manager/group update-mod-values once per sample.
- [x] 6.5 Keep the existing LFO speed parameter/page behavior and connect the LFO source through the new update system.
- [x] 6.6 Update miniapp helper tests for module-backed VCO processing, modulation-source update behavior, LFO speed, and scope/UI publication.

## 7. Verification

- [x] 7.1 Run `openspec validate add-synth-modules-dual-vco`.
- [x] 7.2 Run `make -C projects/synth test`.
- [x] 7.3 Run `make -C projects/synth/miniapp test`, or record the missing-JUCE output.
- [x] 7.4 Run `make -C projects/synth miniapp`, or record the missing-JUCE output.
- [x] 7.5 Run `openspec status --change add-synth-modules-dual-vco` and confirm the change is apply-ready or implementation-complete as appropriate.
