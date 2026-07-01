## Why

The synth library now has enough parameter and MIDI controller state that callers need a shared persistence layer rather than app-specific save code. Smart Grid already solved the adjacent problem with arena-backed JSON, recursive value serialization by parameter name, and patch-directory version history; adapting that approach gives Sheaf synth persistence without making JSON a second source of parameter definitions.

## What Changes

- Add arena-backed JSON support to `projects/synth`, modeled after Smart Grid's `private/src/Json.hpp`, with build/parse operations that allocate from a caller-owned arena.
- Add recursive parameter-value serialization and load APIs that walk the initialized `ParameterManager` and `Parameter` tree, saving top-level values by parameter name and modulation-depth subtrees by live modulation slot index.
- Keep load value-only for app/module definitions: JSON may update values for top-level parameters that were already defined during initialization and may materialize local modulation-depth controls from live code-defined modulator slots, but must not create groups, top-level parameters, pages, banks, slots, controller mappings, modulation sources, modulation assignments, colors, names, polarity, or JSON-defined parameter definitions.
- Persist the MIDI configuration profile through library JSON helpers so input and output MIDI setup can be fully reconstructed from the saved MIDI profile.
- Add patch file persistence with Smart Grid-style version history: each patch gets its own directory under a synth patches root, each save writes a timestamped JSON version file, and load can read either latest or an explicit version file. No UI is required in this change.
- Add a library `PatchManager` sibling to `ParameterManager` that tracks the current patch directory, dispatches patch lifecycle messages, receives serialized JSON through an output bus, and implements new/save/save-as/load/revert orchestration without owning app file pickers.
- Add patch lifecycle messages for loading already-deserialized JSON into initialized synth state, reverting all parameter values to defaults, and requesting JSON serialization; add a `MessageOutBus` carrying serialized JSON responses back to the patch manager.
- Add segmented parameter storage reinforcement for recursive modulation-depth controls so opening nested modulation pages is all-or-nothing and existing parameter storage is not moved when new batches arrive.
- Include a schema/version field in saved JSON and reject or ignore unsupported sections conservatively so older patches can still load missing optional fields.

## Capabilities

### New Capabilities
- `synth-patch-persistence`: JSON arena library, synth patch document format, file versioning, parameter-value save/load APIs, MIDI configuration profile persistence, and app integration hooks.

### Modified Capabilities
- `synth-parameter-modulation`: Add recursive value-only serialization/loading for parameter state and MIDI controller profile config persistence requirements.

## Impact

- Affected code: `projects/synth/include/synth/ParameterModulation.hpp`, `projects/synth/src/ParameterModulation.cpp`, `projects/synth/include/synth/MidiController.hpp`, `projects/synth/src/MidiController.cpp`, library persistence files under `projects/synth`, `projects/synth/miniapp` as a consumer, `projects/synth/tests`, and synth Makefiles.
- New code: an arena JSON header/source in `projects/synth`, a library parameter-value/MIDI-profile persistence layer, focused miniapp integration hooks, and tests/fixtures for round-trip behavior.
- The save format intentionally stores values separately from initialization/configuration definitions. Loading cannot add or remove top-level app parameters, but it can restore recursive local modulation-depth value branches using code-defined modulator slots.
- Disk I/O remains outside audio/sample processing. The miniapp should use the library patch manager and can use a fixed `/tmp` patch location instead of a picker while the higher-level app surface is still absent.
