## Why

Synth color state currently has overlapping authorities: parameter base color is parameter-owned, indicator color is group-owned, portable surfaces inject modulator and gesture palettes out of band, and Braid 4 additionally rewrites indicator colors after snapshot construction. Braid 4 also supplied degree-valued hues to a normalized-hue API, silently collapsing all oscillator and LFO shades to red; the combination let metadata-oriented tests pass while the rendered application was visibly wrong.

## What Changes

- **BREAKING** Replace the ambiguous HSV constructor with unit-explicit hue-turn and hue-degree entry points, and give converted HSV values a unit-explicit hue field.
- **BREAKING** Move voice indicator colors from `ParameterGroupConfig` to `ParameterConfig`; a parameter owns its base encoder color and its complete per-voice indicator palette independently of group topology.
- **BREAKING** Rename semantic color fields and accessors at parameter, bank, modulation-source, gesture, and scope boundaries so their role is explicit; retain generic `DrawCommand::color` only as the final renderer payload.
- Publish parameter base color, per-voice indicator colors, relevant modulation-source colors, and relevant gesture colors together in each visible parameter UI snapshot. Portable encoder construction consumes that snapshot directly and accepts no app-supplied palette overrides.
- Remove Braid 4's active-bank indicator-color rewrite and all other dead-end, duplicate, or fallback color paths that can override semantic owners.
- Define and verify Braid 4's independent bank, parameter-base, parameter-indicator, modulation-source, and scope palettes: audible controls/scopes use four distinct red shades, LFO controls/scopes use four distinct green shades, audible matrix cells use orange/yellow, and LFO matrix cells use yellow/green-yellow.
- Migrate MiniApp to the same parameter-owned color contract without app-local encoder color plumbing.
- Add end-to-end tests from semantic configuration through parameter UI state, portable draw commands, scope draw commands, and hardware feedback snapshots.

## Capabilities

### New Capabilities
- `synth-color-flow`: Defines independent semantic color roles, their single ownership points, unit-safe color construction, and end-to-end propagation through Braid 4 and MiniApp.

### Modified Capabilities
- `synth-parameter-modulation`: Removes group voice palettes, makes base and per-voice indicator colors parameter-owned, and publishes parameter-local modulation/gesture colors in visible-cell UI state.
- `synth-runtime-ui`: Makes portable encoders consume complete color state from visible parameter snapshots without app palette injection or post-snapshot overrides.
- `synth-modules`: Makes reusable module color options distinguish parameter base colors, per-voice indicator palettes, modulation-source colors, and scope-trace colors.

## Impact

The change touches the JUCE-free parameter/modulation API, portable encoder and scope draw-state builders, MIDI feedback snapshot naming, oscillator UI-state naming, reusable synth module registration APIs, Braid 4 and MiniApp initialization/surfaces, OpenSpec contracts, and their unit/system/portable-UI tests. No JUCE-specific styling authority is introduced; JUCE remains a mechanical renderer of portable draw commands.
