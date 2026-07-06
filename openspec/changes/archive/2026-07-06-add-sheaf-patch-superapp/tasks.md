## 1. App Metadata and Registry

- [x] 1.1 Add JUCE-free app manifest and hardware requirement types under `projects/synth/include/synth`.
- [x] 1.2 Add a typed app registration helper that requires `synth::SynthApplication` and binds manifest metadata to a launch callable.
- [x] 1.3 Register the miniapp with stable app id `miniapp`, category `test`, author metadata, and minimum encoder requirement.
- [x] 1.4 Add unit/compile tests proving valid registrations compile, missing app contracts fail through the existing concept checks, and registered app ids are non-empty/path-safe.

## 2. Runtime Launch Boundary

- [x] 2.1 Add a reusable launch helper around `synth_runtime::Runtime<App>` and shell construction so callers can start a selected app without app-specific runtime code.
- [x] 2.2 Let the launch helper accept explicit `RuntimeDataPaths` for the selected app.
- [x] 2.3 Keep the existing standalone miniapp entry point building through the current runtime macro.
- [x] 2.4 Add tests or a small harness that launches a registered app through the typed binding and verifies the selected app runtime receives its supplied data paths.

## 3. Sheaf Patch Data Paths

- [x] 3.1 Generalize `RuntimeDataPaths` construction so config file and patches root can be supplied independently.
- [x] 3.2 Add a Sheaf Patch data path resolver that maps Sheaf Patch-launched app config to `<sheaf-user-data-root>/synth/sheaf-patch/config`, selected app patches to `<sheaf-user-data-root>/synth/sheaf-patch/patches/<stable-app-id>`, and logs to `<sheaf-user-data-root>/synth/sheaf-patch/logs`.
- [x] 3.3 Route Sheaf Patch-launched miniapp runtime configuration saves to the shared config path.
- [x] 3.4 Route Sheaf Patch-launched miniapp patch startup discovery and save/load flows to the miniapp patch root only.
- [x] 3.5 Add persistence tests for Sheaf Patch-launched shared config, per-app patch roots, ignoring another app's patch directory during startup discovery, and unchanged standalone app defaults.

## 4. Launcher UI and Executable

- [x] 4.1 Add a `sheaf-patch` app target or equivalent executable under `projects/synth/apps`.
- [x] 4.2 Implement the initial launcher page listing registered apps sorted by stable app id with name, author, category, and minimum encoder requirement.
- [x] 4.3 Wire app row activation to the selected registration's launch binding.
- [x] 4.4 Ensure the launcher has no Back/Home affordance after an app is running; returning to the launcher requires process restart.
- [x] 4.5 Add UI tests or harness coverage for listing the miniapp, showing category `test`, showing the advisory minimum encoder requirement, and activating the miniapp row without hardware gating.

## 5. Verification

- [x] 5.1 Run `make -C projects/synth build test`.
- [x] 5.2 Run the relevant JUCE synth app/runtime tests for the launcher and runtime shell.
- [x] 5.3 Build the standalone miniapp target and the new `sheaf-patch` target.
- [x] 5.4 Manually smoke-test that `sheaf-patch` opens to the launcher, starts the miniapp, and only returns to the launcher after quitting and restarting.
