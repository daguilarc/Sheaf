## Why

The synth parameter/modulation core now has internal scene, gesture, bank, slot, and modulation behavior, but it has no external control surface for message-thread UI, MIDI input, or interactive validation. This change adds the Smart Grid-style UI-state and message-in layer so the core can be safely observed and driven from UI/MIDI code without coupling JUCE or hardware concerns into the parameter model.

## What Changes

- Add lightweight synth color support, including RGB/HSV conversion and brightness helpers, with UI-state colors stored through a 32-bit lock-free atomic representation and no dependency on JUCE color types.
- Add `ParameterConfig` color support and group voice-indicator color palettes so UI colors have explicit model-owned sources with deterministic defaults.
- Add caller-owned, pre-sized atomic UI state structs parallel to the parameter model: per-parameter UI state, per-slot/bank UI state, manager gesture UI state, and manager-level UI state, with empty visible positions represented by disconnected parameter UI-state cells rather than page/navigation roles.
- Add `PopulateUIState` methods that copy current control-rate parameter, slot, bank, scene, gesture, and modulation state into the UI-state tree once per frame.
- Add a timestamped `MessageIn` struct for external commands: parameter inc/dec, parameter push, shift toggle, gesture select toggle, parameter bank select, start, stop, clock, gesture value set, scene select, and scene blend set.
- Add a `MessageInBus` queue modeled on Smart Grid's message bus. It accepts messages from UI/MIDI producers, pops timestamp-visible messages, and applies supported messages directly to `ParameterManager`; clock/transport messages are represented but not implemented beyond safe receipt in this change.
- Move gesture ownership from `ParameterGroup` to `ParameterManager`, including default gesture count zero, a pre-group setup API for gesture count, `CreateGroup` injection of manager context, gesture values, selection flags, metadata, UI state, message routing, compute, edit, and active-flag clearing behavior.
- Extend manager-owned scene/UI interaction state as needed, including shift-held state, validated scene endpoint setting, Smart Grid-style less-selected endpoint scene selection, scene blend, and selected bank state for slots.
- Add randomized test coverage that migrates the existing oracle to manager-owned gestures, includes cross-group gesture coherence, drives the existing parameter/model operations through `MessageInBus`, occasionally populates UI state, and checks UI-state atomics against the separate deterministic oracle model.
- Add switch/discrete parameter metadata and UI state, including Smart Grid-compatible switch-value derivation and switch-gap encoder rendering.
- Add a segregated reusable JUCE encoder component layer modeled mechanically on Smart Grid's encoder renderer, including bipolar display support and the 14-segment short-name display hardcoded on. The miniapp must use that component rather than its own ad hoc encoder.
- Add a `projects/synth/miniapp` JUCE mini app that shows encoders, buttons, and sliders for two voices, at least two banks, scenes, gestures, and one sine-wave modulation source with 90-degree per-voice offset. The mini app uses the message bus for interaction, converts synth colors to JUCE colors at the boundary, and defaults to a developer-local `~/JUCE` checkout like Smart Grid.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-parameter-modulation`: adds the external UI-state, message input, message bus routing, and JUCE miniapp behavior for the existing synth parameter/modulation system.

## Impact

- Affected project: `projects/synth`.
- Affected public API: `include/synth/ParameterModulation.hpp` gains color helpers, UI-state types, message input types, message bus APIs, and `PopulateUIState` entry points; gesture ownership migration removes the group-local gesture count/config contract and requires current direct gesture call sites to move to manager-owned APIs.
- Affected implementation: `src/ParameterModulation.cpp`, `tests/parameter_modulation_tests.cpp`, and build files for library/test/miniapp integration.
- New JUCE UI code stays segregated under `projects/synth/juce` and `projects/synth/miniapp`; core parameter code must not include JUCE headers or expose JUCE types.
- External precedent: `/Users/joyo/theallelectricsmartgrid/private/src/EncoderUIState.hpp`, `MessageIn.hpp`, `MessageInBus.hpp`, `Color.hpp`, `HSV.hpp`, `SmartBus.hpp`, and `JUCE/SmartGridOne/Source/EncoderComponent.hpp`.
