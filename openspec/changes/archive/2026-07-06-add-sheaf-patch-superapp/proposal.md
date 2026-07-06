## Why

Sheaf Patch is moving from a single miniapp executable toward a family of synth applications, but today each app is its own runtime entry point. A top-level Sheaf Patch launcher gives users one executable for discovering and starting synth apps while keeping app-specific runtime logic inside each app.

## What Changes

- Add a `sheaf-patch` top-level app that starts on a launcher page listing available synth apps.
- Add a typed app registration/manifest model for each synth app, including app name, author, category, and hardware requirements such as minimum encoder count.
- Add a runtime entry point that lets a selected app be constructed and run with almost no launcher-specific runtime logic.
- Move runtime configuration for apps launched by the Sheaf Patch superapp to `<sheaf-user-data-root>/synth/sheaf-patch/config` so Sheaf Patch-launched apps share MIDI/audio configuration without changing standalone app defaults. `<sheaf-user-data-root>` is resolved by the host backend and matches the standalone MiniApp data-root convention.
- Scope patches beneath `<sheaf-user-data-root>/synth/sheaf-patch/patches/<stable-app-id>` so patches are app-specific while sharing the same top-level Sheaf Patch data root.
- Keep the first version one-way: after launching a selected app, returning to the launcher requires quitting and restarting the process.
- Register the current miniapp as the first launcher-visible app in category `test`.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `synth-app-runtime`: Add app metadata/registration contracts, a top-level Sheaf Patch executable, and a launch entry point that constructs and runs a selected app runtime.
- `synth-patch-persistence`: Change runtime-owned data paths for Sheaf Patch-launched apps so configuration is shared under `<sheaf-user-data-root>/synth/sheaf-patch/config` and patches are scoped per app under `<sheaf-user-data-root>/synth/sheaf-patch/patches/<stable-app-id>`.
- `synth-runtime-ui`: Add the initial launcher page that lists registered apps and starts the selected app without in-app back navigation for this change.

## Impact

- Affected code: `projects/synth/include/synth` app/runtime contract headers, `projects/synth/runtime`, `projects/synth/apps/miniapp`, a new `projects/synth/apps/sheaf-patch` executable or equivalent app target, synth Makefiles, and synth runtime/UI tests.
- Data impact: runtime config/patch path resolution changes for apps launched by the Sheaf Patch executable; standalone app path behavior stays unchanged unless explicitly routed through Sheaf Patch.
- API impact: application definitions gain metadata/registration, and runtime hosting gains a callable "run this app" entry point usable by the launcher.
