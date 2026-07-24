## Why

Controllers can select an absolute parameter bank, but they cannot move relative to the bank currently shown without dedicating one control per bank. Relative next/previous messages make compact controller layouts practical while preserving the existing reset, random, and random-mod bank workflow.

## What Changes

- Add next-bank and previous-bank `MessageIn` operations whose only argument is the parameter-bank slot.
- Navigate forward or backward through the manager's valid bank indices and wrap at both ends.
- When reset, random, or random-mod is active, apply the effective modifier to the addressed slot's current bank without changing bank selection.
- Treat an invalid slot, an empty bank collection, or a slot without a current bank as a no-op.
- Expose the messages through MIDI profile serialization, controller configuration, and message descriptions.
- Add focused and deterministic randomized coverage for navigation, wrapping, modifier behavior, validation, and configuration round trips.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-parameter-modulation`: Add relative next/previous parameter-bank message contracts, wrapped navigation, current-bank modifier behavior, serialization, and message-bus coverage.
- `synth-runtime-ui`: Add controller-configuration choices and slot argument editing for the two relative bank messages.

## Impact

- Affected code: `projects/synth/include/synth/ParameterModulation.hpp`, `projects/synth/src/ParameterModulation.cpp`, MIDI controller serialization/output helpers, controller configuration view-model code, and synth tests.
- Affected APIs: `MessageIn::Type`, `MessageIn` factories, parameter-manager bank routing, serialized message type names, and controller-system-message catalogs.
- No new dependencies or persisted data fields are required.
