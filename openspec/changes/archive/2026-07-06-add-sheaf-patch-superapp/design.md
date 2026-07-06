## Context

The synth runtime already has the right low-level shape for this change: `synth_runtime::Runtime<App>` is a template over the selected app type, applications expose a JUCE-free `RuntimeConfig`, and app entry points can be very small through `SYNTH_RUNTIME_MAIN(App)`. The missing layer is a top-level product executable that can present a catalog of apps before constructing a concrete runtime.

The current runtime resolves data paths from the selected app's `RuntimeConfig::appName`, which makes sense for standalone apps but not for a Sheaf Patch superapp. The requested product should share MIDI/audio configuration across apps launched by Sheaf Patch while keeping patch histories separated by app.

## Goals / Non-Goals

**Goals:**
- Provide one Sheaf Patch executable that launches into an app list.
- Register apps with typed metadata: name, author, category, and hardware requirements including minimum encoders.
- Keep the launcher thin: once an app is selected, it constructs the selected app runtime and transfers control to that runtime.
- Keep app addition straightforward: add app metadata plus one typed launch binding, without editing runtime internals.
- Store configuration for Sheaf Patch-launched apps at `<sheaf-user-data-root>/synth/sheaf-patch/config` and their app patches under `<sheaf-user-data-root>/synth/sheaf-patch/patches/<stable-app-id>`, where the Sheaf user data root matches the standalone MiniApp host convention.
- Register the current miniapp as the first app in category `test`.

**Non-Goals:**
- Returning from a running app back to the launcher without quitting.
- Running multiple synth apps in one process at the same time.
- Hot-loading apps from external shared libraries.
- Migrating old standalone miniapp data into the new Sheaf Patch paths.
- Designing final category taxonomy beyond the initial `test` category.

## Decisions

### Decision 1: Use compile-time app registrations with manifest-shaped metadata

Introduce a JUCE-free app metadata type, for example `synth::SynthAppManifest`, with fields for stable app id, display name, author, category, and `SynthHardwareRequirements{minEncoders}`. The stable app id is the path key for patches and is separate from display text. Each app exports a small descriptor binding that metadata to its concrete app type.

The manifest can be represented as C++ data first, with optional JSON serialization or a checked JSON fixture later if we want external inspection. The important contract is manifest-shaped metadata, not runtime JSON parsing.

Alternatives considered:
- Pure JSON manifests plus a dynamic factory registry. This is attractive for external plugins but over-scopes the first in-tree superapp and introduces factory/string validation before there are multiple apps.
- Put metadata inside `RuntimeConfig`. This would blur runtime device configuration with catalog/product metadata, and it would not express hardware requirements cleanly.

### Decision 2: Keep launch typed at the boundary

The launcher should not own a variant of app internals. A registry entry exposes a callable launch function that constructs `synth_runtime::Runtime<App>`, injects Sheaf Patch data paths, and calls `Start()` through the existing shell/runtime path. The top-level app list stores only metadata plus that callable.

To preserve type safety, app registration can be templated:

```cpp
template <synth::SynthApplication App>
SynthAppRegistration MakeSynthAppRegistration(SynthAppManifest manifest);
```

Alternatives considered:
- A common virtual `SynthRuntime` base with `Runtime<App> : SynthRuntime`. This would work, but it risks pulling common lifecycle methods into a base class before the runtime actually needs polymorphism beyond "launch and run".
- A launcher that switches directly on app ids and constructs concrete runtimes inline. That keeps first code short but makes each new app edit the launcher rather than only adding a registration.

### Decision 3: Add an explicit runtime run entry point

`Runtime<App>::Start()` starts audio/MIDI/timers, but the process-level shell owns JUCE application/window lifetime. This change should add a function or macro-level helper that the launcher can call with an app type and data-path policy, such as `RunSynthApplication<App>(RuntimeDataPaths paths)` or a `SYNTH_RUNTIME_LAUNCHABLE(App)` adapter.

The helper should encapsulate the details of constructing `Runtime<App>` and the matching shell component, so the launcher only calls the selected registration's launch function.

Alternatives considered:
- Reuse only the existing standalone app macro. Macros are fine for one process entry point, but they are awkward as a runtime-selected launch target.
- Move the launcher inside `Runtime<App>`. That would invert ownership and make every runtime know about app selection, which is the opposite of the requested thin top-level app.

### Decision 4: Use one Sheaf Patch data root with shared config and per-app-id patches for Sheaf Patch launches

The Sheaf Patch executable resolves a product data root under the host's stable Sheaf user application data root, matching the standalone MiniApp convention. The product-relative layout is fixed. Under it:
- `config` is a JSON file containing the shared runtime configuration document for MIDI/audio state.
- `patches/<stable-app-id>` is the selected app's patch root, where `<stable-app-id>` is the manifest id from the app registration.
- `logs` is the log root for apps launched by the Sheaf Patch executable.

This requires `RuntimeDataPaths` to support a config file path and a patches root that are not siblings of one app-specific data root in the old shape. Standalone apps keep their existing default path behavior unless they are intentionally launched through Sheaf Patch.

Alternatives considered:
- Keep one config per app. This defeats the user's main goal: all apps should share controller/audio configuration.
- Store patches all together with patch metadata indicating app ownership. Per-app directories are simpler, more inspectable, and avoid accidental loading across incompatible parameter sets.

### Decision 5: The first launcher is one-way

After the user launches an app, the selected app owns the runtime window/session until process exit. No in-app Back/Home affordance is required for this change.

Alternatives considered:
- Keep the launcher resident and allow returning. That needs runtime teardown/reinitialization, device ownership handoff, and UI state transitions that are better handled after the app registry and path contracts exist.

## Risks / Trade-offs

- [Runtime teardown assumptions leak into launcher] -> Avoid in-process back navigation in this change; launch once and let normal process shutdown clean up.
- [App id/display name/path ambiguity] -> Require a stable filesystem-safe app id for patch directories and keep display name separate for UI.
- [Manifest JSON becomes stale from typed registration] -> If JSON files are added, generate or validate them from the typed registration in tests rather than hand-maintaining two sources of truth.
- [Shared configuration contains mappings invalid for a future app] -> Treat hardware/controller config as Sheaf Patch product state for apps launched through Sheaf Patch and let each app's initialized parameter topology ignore or safely reject mappings that do not apply.
- [Launcher starts apps that current hardware cannot control well] -> Surface minimum encoder requirements in the list as advisory metadata; do not block launch in this version.

## Migration Plan

1. Add manifest/registration contract types and tests for registering the miniapp.
2. Add runtime launch helper around `Runtime<App>` and shell construction.
3. Generalize `RuntimeDataPaths` so config and patches roots can be supplied independently.
4. Add the `sheaf-patch` launcher executable and its app list UI.
5. Register the miniapp and route its launched runtime to `<sheaf-user-data-root>/synth/sheaf-patch/config` plus `<sheaf-user-data-root>/synth/sheaf-patch/patches/miniapp`.
6. Keep the standalone miniapp target working unless explicitly removed later.

Rollback is straightforward before archive: remove the new launcher target and app registry, leaving existing standalone miniapp runtime entry unchanged.

## Resolved Questions

- Patch directories use the stable app id, not the display name, to avoid path churn when display names change.
- Hardware requirements are advisory in this change: the launcher displays minimum encoder requirements but does not block launch based on connected hardware.
