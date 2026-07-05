## Context

The synth runtime already owns the engine, patch manager, MIDI connection lifecycle, audio device manager, shell pages, and async logger integration. The remaining mismatch is path and data ownership: `RuntimeConfig` is supplied by the application and currently carries `patchesRoot` and `logsRoot`, so the miniapp chooses a deterministic temp directory for real patch/log data.

Patch JSON also currently carries both synthesizer patch state and runtime configuration: parameter values, MIDI instrument/controller configuration, and audio device selection. That makes patch save/load responsible for hardware setup, which is the wrong lifecycle. The user expects patch save to save the sound, while MIDI/audio configuration persists as app configuration.

## Goals / Non-Goals

**Goals:**

- Resolve one long-lived app data root per runtime-hosted app.
- Store patches under `dataRoot/patches/`, logs under `dataRoot/logs/`, and runtime configuration in a separate file under the same root.
- Move production path ownership from applications to runtime hosts.
- Save patch documents with synthesizer patch data only.
- Save MIDI instrument/controller setup and audio device selection as runtime configuration, independent of patch save/load.
- Persist configuration when the user presses Back on Audio or Controllers pages.
- Replace OS-native patch save/load dialogs with an in-app browser rooted at `dataRoot/patches/`.
- Preserve test isolation with explicit scratch-path overrides.

**Non-Goals:**

- Add a general preferences UI beyond the existing Audio and Controllers pages.
- Add autosave on every controller/audio edit. Edits still apply live; Back is the durability boundary for this change.
- Design cloud sync, multi-user profiles, or preset libraries.
- Migrate every old temporary patch automatically into the new data directory.

## Decisions

1. Runtime hosts resolve data paths; applications do not.

`RuntimeConfig` should continue to describe the application and its audio/UI preferences, but it should no longer be the authority for patch or log roots. The JUCE runtime host resolves a `RuntimeDataPaths` value before engine initialization:

```text
dataRoot/
  config.json
  patches/
  logs/
```

For the desktop runtime, `dataRoot` is an OS-appropriate user application data location with stable lifetime. On macOS this should be under `~/Library/Application Support/Sheaf/<appName>/`; other platforms should use the equivalent user application data directory. Headless tests and rigs can inject a complete `RuntimeDataPaths` rooted in a scratch directory.

Alternative considered: keep path fields in `RuntimeConfig` and change only the miniapp defaults. That is smaller, but keeps persistence policy in app code and would repeat the same mistake for the next runtime-hosted app.

2. Patch JSON becomes synth patch state only.

New patch saves should include schema metadata, patch name, and parameter values. They should not include `midiInstrument` or `audioDevice`. Loading a patch changes parameter values only. New/Revert patch restores initialized parameter defaults or the current patch version without altering MIDI or audio configuration.

Alternative considered: keep MIDI/audio in patch JSON for backward compatibility and add a separate config file as an override. That would leave two authorities for the same hardware state. The new model is easier to reason about: patches are sounds; config is hardware/runtime setup.

3. Runtime configuration JSON owns MIDI and audio.

Add a JUCE-free runtime configuration persistence helper with a document shaped around:

```text
schema: "sheaf.synth.runtime-config"
schemaVersion: 1
midiInstrument: <existing MidiInstrumentConfig JSON>
audioDevice: { outputDeviceName, inputDeviceName }
```

On startup, the runtime initializes the application normally so defaults exist, then loads `config.json` if present. Missing config is not an error. A valid config replaces the live MIDI instrument and audio device state before MIDI processors are built, controller reconciliation starts, and the audio device is opened. Invalid config is ignored with an INFO log, preserving application defaults.

Alternative considered: use separate `midi.json` and `audio.json` files. That is slightly more granular, but both values are edited through runtime configuration pages and must be applied during the same startup window, so one small document is simpler.

4. Back on configuration pages is the persistence point.

The Audio and Controllers pages continue to apply edits live through the existing runtime paths. Their Back action should first ask the runtime to save the current configuration snapshot, then return to the application view. The save writes `config.json` atomically. A save failure should be logged and surfaced through existing page/runtime status text, but it should not require complex recovery UI for this change.

Alternative considered: save on every edit. That is more durable but noisier, couples mapping edits to disk IO, and is not what was requested.

5. Patch browsing is in-app and root-scoped.

The File page should stop using `juce::FileChooser` for patch save/load. It should provide an in-app patch browser inspired by The All Electric Smart Grid's `DirectoryExplorer`: a root-scoped tree/list view, relative navigation, deterministic sorting, explicit confirm/cancel actions, and no path escape above the configured root.

For this synth runtime, the root is always `RuntimeDataPaths::patchesRoot`. Save As creates a named patch directory directly under that root, then writes the first version file through `PatchManager::SavePatchAs`. Load selects an existing patch directory from the in-app list, then calls `PatchManager::LoadPatch` on that directory. The UI does not expose arbitrary absolute filesystem selection.

The browser can be implemented with a JUCE-free model similar to SmartGrid's `DirectoryExplorer`, with a thin JUCE page renderer in `FilePage`. It does not need a background IO thread for this change unless implementation shows directory scans are visibly slow; all patch browsing stays on the message side, never in the audio callback.

Alternative considered: keep OS chooser but set its initial directory to `patchesRoot`. That still lets users roam outside the app data directory and keeps the app dependent on platform file dialog behavior. The in-app browser gives us the exact persistence model we want.

6. Logger configuration follows runtime data paths.

The async logger remains a JUCE-free library with a configured directory. The runtime now configures it from `RuntimeDataPaths::logsRoot`, not from `RuntimeConfig::logsRoot`. If no log path is configured in a test harness, stdout-only logging remains valid.

## Risks / Trade-offs

- [Old patches contain MIDI/audio fields] -> New loaders can tolerate and ignore those fields during a transition, but new saves must omit them. Users who depended on patch-specific controller/audio setup will need to save their desired runtime config separately.
- [Back-triggered config save can fail] -> Write atomically via a temp file and rename; log failures via INFO and expose a concise status on the page.
- [Startup ordering is delicate] -> Load config after `App::Init` establishes defaults and before MIDI processor construction, controller reconciliation, and audio device opening. Add engine/runtime tests for that exact ordering.
- [OS data directory logic is platform-specific] -> Keep resolver behind a small runtime-host interface and verify miniapp resolves to a non-temp, user-data location in a JUCE-side test or narrow platform abstraction test.
- [Tests currently depend on static miniapp roots] -> Replace static miniapp path hooks with runtime/test-host data path overrides, and keep scratch directories explicit in rig tests.
- [In-app browser can accidentally become a general file manager] -> Keep scope narrow: browse patch directories under `patchesRoot`, create/select patch directories, and load/save patches. No arbitrary delete/move/copy behavior in this change.

## Migration Plan

1. Introduce data path and config persistence APIs without changing runtime behavior.
2. Update tests to use runtime/test-host data path overrides instead of app-owned patch/log roots.
3. Change patch serialization/load application to exclude MIDI/audio and update patch lifecycle tests.
4. Wire runtime startup to resolve paths, configure logging, load config, then load the startup patch.
5. Replace File page OS choosers with an in-app patch browser rooted at `patchesRoot`.
6. Wire Audio/Controllers Back actions to save runtime configuration.
7. Update miniapp README and specs to remove `/tmp` as the production persistence root and to document in-app patch browsing.

Rollback is straightforward while this is unreleased: restore patch documents as the sole persistence carrier and return path fields to `RuntimeConfig`. After release, rollback would require preserving `config.json` reads so user hardware setup is not lost.

## Open Questions

None. The intended behavior is direct: runtime owns long-lived data paths; patches save sound state under `patches/`; the File page uses an in-app root-scoped browser; runtime configuration saves MIDI/audio state; configuration pages save that file on Back.
