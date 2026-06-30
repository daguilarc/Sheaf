## Why

The synth mini app is beginning to outgrow direct, ad hoc parameter and DSP wiring: DSP processors should remain internal units expressed in natural DSP units, while reusable instrument pieces need parameter registration, bank placement, mappings, UI state, and interaction behavior. Introducing a module pattern now gives future synth components a precise initialization contract before more processors and mini app patches accrete local conventions.

## What Changes

- Add a reusable synth module pattern that sits above DSP processors without requiring a class hierarchy.
- Define module initialization phases: finalize construction/configuration, register parameters, then register visible parameters into banks.
- Add manager-level parameter registration by group plus `ParameterConfig`, returning a stable `ParameterId` that indexes the manager parameter list.
- Add parameter lookup and normalized-to-natural mapping helpers for linear, exponential, zero-based exponential, and bipolar variants.
- Add coding-error behavior for duplicate parameter names, invalid IDs, duplicate bank slot registration, and attempts to overrun available bank slots.
- Add modulation-source registration through a group-owned modulation manager using per-voice float pointers, plus manager/group update APIs that dereference those sources each sample.
- Add a duophonic dual wavetable VCO module with tune, phase, shape, and volume parameters, module-owned parameter IDs, module input mapping, nested UI state, and VCO modulation-source publication.
- Refactor the synth mini app so the VCO patch is registered and processed through the module rather than hand-wired parameter and bank code in the app.

## Capabilities

### New Capabilities
- `synth-modules`: Reusable synth module pattern for parameter registration, bank registration, input mapping, UI state, nesting, and a first dual wavetable VCO module.

### Modified Capabilities
- `synth-parameter-modulation`: Add parameter-list IDs, registration helpers, parameter lookup/mapping helpers, bank registration error semantics, and pointer-backed modulation-source update APIs.
- `synth-dsp-classes`: Clarify that DSP processors remain internal, UI-agnostic, and use natural DSP units while modules provide knob/UI mappings and mini app composition.

## Impact

- Affected code: `projects/synth/include/synth/ParameterModulation.hpp`, `projects/synth/src/ParameterModulation.cpp`, new synth module headers/sources under `projects/synth/include/synth` and `projects/synth/src`, `projects/synth/tests`, `projects/synth/miniapp`, and synth Makefiles.
- Public API additions: `ParameterManager::RegisterParameter`, parameter ID lookup, mapping helpers, modulation-source registration/update functions, module registration/process/UI-state contracts, and dual wavetable VCO module APIs.
- Behavioral impact: initialization failures caused by invalid module/bank registration become explicit coding errors rather than silent truncation or ignored mappings.
- No new third-party dependencies are expected.
