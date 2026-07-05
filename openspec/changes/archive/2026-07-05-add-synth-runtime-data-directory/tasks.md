## 1. Runtime Data Paths

- [x] 1.1 Add a JUCE-free `RuntimeDataPaths` contract with `dataRoot`, `patchesRoot`, `logsRoot`, and `configFile` paths.
- [x] 1.2 Add runtime/test host hooks so headless tests can inject scratch `RuntimeDataPaths`.
- [x] 1.3 Add JUCE runtime path resolution for production apps using an OS-appropriate user application data root under Sheaf and the app name.
- [x] 1.4 Remove production `patchesRoot`, `logsRoot`, and persistent audio preference ownership from application `RuntimeConfig` and miniapp defaults.
- [x] 1.5 Update contract tests for `RuntimeConfig` and data path defaults.

## 2. Runtime Configuration Persistence

- [x] 2.1 Add JUCE-free runtime configuration JSON helpers for schema, schema version, `midiInstrument`, and `audioDevice`.
- [x] 2.2 Implement runtime configuration load through scratch state so invalid files do not mutate live instrument or audio state.
- [x] 2.3 Implement atomic runtime configuration save through temp-file write and rename.
- [x] 2.4 Add persistence tests for valid round-trip, missing file, invalid schema, invalid MIDI, invalid audio, and atomic-save behavior.

## 3. Patch Persistence Split

- [x] 3.1 Change patch JSON serialization to omit `midiInstrument` and `audioDevice`.
- [x] 3.2 Change patch JSON validation/load to tolerate legacy `midiInstrument` and `audioDevice` sections while ignoring them.
- [x] 3.3 Change patch message application so load/revert/new mutate parameter values only and never reset MIDI instrument or audio device state.
- [x] 3.4 Update patch persistence, engine, rig, and miniapp system tests for patch-only save/load behavior.

## 4. Runtime Startup And Logging Wiring

- [x] 4.1 Wire runtime startup to resolve/create data paths before configuring logging or initializing the engine.
- [x] 4.2 Configure `AsyncLogQueue` from `RuntimeDataPaths::logsRoot` and log runtime configuration load/save outcomes.
- [x] 4.3 Load runtime configuration after application init/default setup and before MIDI processor construction, startup reconciliation, and audio device opening.
- [x] 4.4 Load the startup patch from `RuntimeDataPaths::patchesRoot` after runtime configuration has been applied.
- [x] 4.5 Add ordering tests proving config load drives MIDI/audio startup and patch load does not change runtime configuration.

## 5. In-App Patch Browser

- [x] 5.1 Add a JUCE-free root-scoped patch browser model inspired by SmartGrid `DirectoryExplorer` with deterministic listing and relative navigation under `patchesRoot`.
- [x] 5.2 Add path validation that rejects absolute paths, `..`, and any save/load target outside `patchesRoot`.
- [x] 5.3 Replace `juce::FileChooser` in the File page with the in-app browser for Save As and Load.
- [x] 5.4 Implement Save As creation of a named patch directory under `patchesRoot` and first-version save through `PatchManager`.
- [x] 5.5 Implement Load selection of an existing patch directory under `patchesRoot`.
- [x] 5.6 Add UI/model tests for deterministic listing, root escape rejection, Save As path creation, and Load path selection.

## 6. Configuration Page Back Saves

- [x] 6.1 Add a runtime method that snapshots current MIDI instrument and audio device state and saves runtime configuration.
- [x] 6.2 Wire Audio page Back to save runtime configuration before returning to the application view.
- [x] 6.3 Wire Controllers page Back to save runtime configuration before returning to the application view.
- [x] 6.4 Ensure File page Back returns without saving runtime configuration solely because the File page was dismissed.
- [x] 6.5 Add tests covering Audio Back save, Controllers Back save, and File Back no-config-save behavior.

## 7. Documentation And Verification

- [x] 7.1 Update miniapp README and runtime comments to describe the persistent data root, `patches/`, `logs/`, `config.json`, and in-app patch browser.
- [x] 7.2 Remove stale references to production `/tmp` patch/log roots from synth docs and tests.
- [x] 7.3 Run targeted synth persistence/runtime/UI tests.
- [x] 7.4 Run `make -C projects/synth test`.
- [x] 7.5 Run OpenSpec validation/status checks for `add-synth-runtime-data-directory`.
