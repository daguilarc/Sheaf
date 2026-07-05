## Why

The synth miniapp currently saves patches and logs under a deterministic temporary directory, which is convenient for tests but wrong for real user data. Patch documents also mix synthesizer state with MIDI/audio configuration, making "save this sound" and "remember my hardware setup" the same operation when they should have different lifecycles.

## What Changes

- Add runtime-owned persistent app data paths rooted in an OS-appropriate long-lived data directory, with `patches/` and `logs/` subdirectories.
- Move path authority out of application code: applications identify themselves and declare audio/UI preferences, while runtime hosts resolve and provide persistence paths.
- Keep patch save/load focused on synthesizer patch data only: parameter values and patch identity.
- Add a separate runtime configuration document for MIDI instrument/controller setup and audio device selection.
- Load runtime configuration during startup before controller reconciliation and audio-device selection.
- Save runtime configuration when the user presses Back on Audio or Controllers configuration pages.
- Replace OS file explorer usage on the File page with an in-app patch browser rooted at the runtime-owned `patches/` directory, following the root-scoped relative navigation pattern used by The All Electric Smart Grid's `DirectoryExplorer`.
- Save patches directly under the runtime-owned `patches/` directory; users choose or name patch directories within that in-app browser rather than selecting arbitrary filesystem locations.
- Configure the async logger from the runtime-owned `logs/` directory rather than from application-owned config.
- Update miniapp tests and documentation so production runs no longer use `/tmp` as their real patch/log location, while tests retain scratch-directory overrides.
- **BREAKING**: Existing patch documents that rely on embedded MIDI/audio configuration no longer define persistent runtime configuration. Transitional loading may tolerate old fields for migration, but new saves must write MIDI/audio to the configuration document instead.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-app-runtime`: runtime configuration and lifecycle requirements change so the runtime owns persistent data paths, loads/saves runtime configuration separately from patch state, and no longer receives patch/log roots from application code.
- `synth-patch-persistence`: patch document and patch manager requirements change so patch saves contain synth patch data only, with MIDI/audio configuration removed from patch JSON.
- `synth-async-logging`: logger configuration requirements change so the runtime supplies the log directory from its persistent data paths.
- `synth-runtime-ui`: Audio and Controllers page dismissal behavior changes so pressing Back persists runtime configuration before returning to the application view, and the File page changes from OS file choosers to an in-app patch browser rooted at the runtime `patches/` directory.

## Impact

- Affected code includes `projects/synth/include/synth/AppContext.hpp`, `projects/synth/include/synth/Engine.hpp`, `projects/synth/include/synth/PatchPersistence.hpp`, `projects/synth/src/PatchPersistence.cpp`, `projects/synth/include/synth/AsyncLogger.hpp`, `projects/synth/runtime/Runtime.hpp`, `projects/synth/runtime/AudioConfigPage.hpp`, `projects/synth/runtime/ControllersPage.hpp`, `projects/synth/runtime/FilePage.hpp`, and `projects/synth/apps/miniapp/*`.
- New or revised JUCE-free helpers will be needed for runtime data path resolution and configuration JSON read/write.
- Existing tests that set `RuntimeConfig::patchesRoot` or `logsRoot` will move to host/test data-path overrides.
- Patch JSON compatibility must be handled deliberately: new patch saves should omit MIDI/audio configuration, and runtime configuration should round-trip through its own file.
