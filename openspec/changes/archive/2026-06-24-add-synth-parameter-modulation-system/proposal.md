## Why

Sheaf needs a reusable C++ synthesizer foundation with a parameter system that can support audio-rate modulation, dynamic modulation routing, scenes, gestures, and hardware control mapping without coupling DSP reads to UI tree traversal. The first `synth` project should establish the ownership model and computation contracts before synth modules depend on them.

## What Changes

- Add a new `projects/synth` C++ project for synthesizer libraries and utilities.
- Introduce a parameter and modulation system with `ParameterManager`, `ParameterGroup`, `Parameter`, `Modulators`, `Gestures`, `Bank`, and `BankSlot` concepts.
- Maintain one manager-owned global parameter ID space, scene metadata, active page state, and routed hardware control entry points.
- Store per-group voice count, modulation data, gesture data, process-lite slew configuration, and a group-local upfront allocator for same-shaped parameters.
- Support per-voice modulation values and per-voice modulation depths while keeping gesture and scene parameter data global rather than per voice.
- Support scene and gesture interpolation, normalized target computation, slow control-rate `Compute`, and audio-rate `Get(voiceIx)`/`ProcessLite` paths.
- Support bank and slot routing for physical encoders, including press-to-edit-modulation, press-to-return-to-top-level, shift-press reset, tick/inc-dec routing, page selection, and external gesture selection APIs.
- Add randomized simulation tests that repeatedly perform encoder turns, presses, shift presses, gesture selection, gesture value changes, and page changes while checking state against an oracle.

## Capabilities

### New Capabilities

- `synth-parameter-modulation`: A new C++ synth parameter, modulation, scene, gesture, page, bank, slot, allocation, and randomized simulation test capability for `projects/synth`.

### Modified Capabilities

None.

## Impact

- Adds a new project under `projects/synth`.
- Adds a new OpenSpec capability under `openspec/specs/synth-parameter-modulation` once archived.
- Introduces C++ source, headers, build/test configuration, and deterministic randomized tests for the new project.
- Does not modify existing Sheaf Chat, Conductor, Dictator, Quest Runner, Web, Realtime Agent, Agents, or XAgent behavior.
