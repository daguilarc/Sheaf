## Context

The completed catalog-launcher implementation acquires audio and MIDI from the catalog-selection gesture before asynchronous package loading. It currently hands that activated context to a JavaScript ring-buffer AudioWorklet whose DSP producer is driven by `setInterval`, while the former direct Mini App path used Emscripten's native Wasm AudioWorklet callback. The timer path cannot meet 128-frame callback cadence and is therefore a production regression.

First-party browser compilation and publication are also Mini App-specific. A handwritten `miniapp_entry.cpp`, dedicated Make recipe, single-app catalog template, and filename-specific assembler prevent Braid 4 from being published as an ordinary `SynthApplication`.

The constraints are one catalog click, no package download before selection, self-contained app/Sheaf modules, no degraded audio mode, zero app-specific browser code, and identical native application execution after startup. The approved design is recorded in `docs/superpowers/specs/2026-07-19-native-browser-audio-and-generic-app-packaging-design.md`.

## Goals / Non-Goals

**Goals:**

- Adopt the click-acquired host `AudioContext` into the selected Emscripten module and use the existing native Wasm AudioWorklet callback.
- Remove timer/ring-buffer DSP scheduling and fail closed when native callback startup is unavailable.
- Drive compilation, immutable packaging, and catalog generation for Mini App, Braid 4, and later apps from one declarative list.
- Give every first-party module the same 512 MiB initial, growable-to-2 GiB memory policy and finish growth before audio starts.
- Prove both real apps through the same one-click launcher and publication artifacts.

**Non-Goals:**

- No application-specific browser adapter, alternate Braid 4 build, or Braid 4 DSP/UI change.
- No dynamic browser compilation, launcher-owned Sheaf dynamic library, simultaneous apps, or hot switching.
- No timer, animation-frame, message-loop, or ScriptProcessor audio substitute.

## Decisions

### D1 — Register the activated context inside each self-contained Emscripten module

The selection handler keeps acquiring and resuming one JavaScript `AudioContext` before any await. Once the verified Emscripten factory resolves, a generic module runtime method calls the module-local `emscriptenRegisterAudioObject` helper and returns its `EMSCRIPTEN_WEBAUDIO_T` handle. A browser ABI export starts `Runtime<App>` on that registered handle.

`Runtime<App>` factors context-independent worklet startup into a method that accepts a valid handle. The existing direct path may create its own context and then call the same method. Sample rate, render quantum, engine preparation, worklet-thread creation, processor/node creation, connection, block/peak/deadline metrics, and `ProcessAudioWorklet` remain native and shared.

Alternatives rejected: retaining the ring producer cannot meet cadence; downloading all packages before selection violates cheap discovery; requiring a second click violates the product requirement.

### D2 — Delete the JavaScript sample transport

The production `configure-audio` and `render-audio` commands, audio render interval, sample ring, underflow behavior, and JavaScript ring-buffer worklet are removed. Shared Wasm memory needed by Emscripten workers remains. Modules without context registration and native start support are rejected with a launch diagnostic; no fallback is attempted.

This is intentionally fail-closed because silence is preferable to unstable cadence and because an apparent `audio:online` state must mean the native callback is advancing.

### D3 — Generate compile-time app binding from one manifest

One checked-in JSON app-build manifest contains catalog metadata plus the C++ header, qualified app type, and include directories required to instantiate the template. A generic Node build tool validates every record and emits transient translation units under the build directory. Each generated unit includes the declared header and invokes `SYNTH_BROWSER_APP(<type>)`.

All records use one Emscripten recipe, runtime source set, ABI export list, sidecar policy, and memory configuration. A record cannot select custom runtime code or audio behavior. The handwritten Mini App entry and per-app Make recipes are removed. The unavoidable compile-time type identity is data, not an adapter.

Alternatives rejected: checked-in entry files duplicate plumbing; a runtime registry cannot instantiate arbitrary C++ templates after compilation; app-local browser hooks violate application portability.

### D4 — Build the catalog from the same manifest and structured emissions

The generic builder produces a structured list of successful app emissions. The first-party catalog assembler iterates the manifest in deterministic order, validates each app's expected Emscripten files, packages them under `packages/<app-id>/<build-id>/`, and writes one catalog containing all records. Catalog versioning hashes or otherwise deterministically represents the complete ordered app package set.

Mini App and Braid 4 are the initial records. Cloudflare and GitHub Pages publication continue consuming the same validated site/pages artifacts, so neither deployment workflow names an app.

### D5 — Use one pre-audio memory policy

Every first-party module links with `INITIAL_MEMORY=536870912`, `ALLOW_MEMORY_GROWTH=1`, and `MAXIMUM_MEMORY=2147483648`. App construction, Braid 4's existing scope allocation, persistence initialization, and any growth finish before native callback startup. The callback performs no allocation or growth.

A uniform policy avoids a hidden Braid 4 variant. If an app cannot initialize within the maximum, launch fails rather than mutating its behavior.

### D6 — Test architecture, not merely audible output

Tests observe native AudioWorklet block counters and deadline/peak metrics after one launcher click for both real apps. Static checks reject concrete app identities outside the manifest and generated/test artifacts, reject timer audio scheduling and deleted commands, and prove that the generic fixture, Mini App, and Braid 4 follow the same compiler/packager path.

The real-app tests also verify visible portable UI and deterministic two-app publication, ensuring a green test cannot be obtained by starting an unrelated silent context.

## Risks / Trade-offs

- [Emscripten runtime helpers are module-local and may be omitted by dead-code elimination] → Export one tested generic module registration hook and include it in the common linker contract.
- [A registered context handle may be destroyed twice] → Give the activation lease ownership until runtime teardown, transfer the module-local handle explicitly, and make teardown idempotent.
- [Growable shared memory complicates stale JavaScript heap views] → Read `Module.HEAP*` at operation time, enable the common growth-aware build, and finish expected growth before callback startup.
- [Braid 4's roughly 200 MiB scope reservation may pressure low-memory browsers] → Start at 512 MiB, allow growth to 2 GiB, test the unmodified app, and surface allocation failure without an app-specific reduced build.
- [Manifest metadata can drift from desktop registration metadata] → Validate IDs/metadata against existing registration contracts where practical and make divergence a test/build failure.
- [One broken app could block catalog publication] → Fail the complete first-party build rather than publish a partial or internally inconsistent catalog.

## Migration Plan

1. Add failing native-context adoption and no-fallback contract tests.
2. Add the module-local context registration/start boundary and preserve direct startup through the same native helper.
3. Delete the timer/ring transport and update runtime clients/tests.
4. Introduce the manifest-driven generic compiler/packager with a fixture, then migrate Mini App.
5. Add Braid 4 to the manifest and prove its unchanged application through real Chromium.
6. Generalize publication, CI, documentation, and coverage for the deterministic two-app catalog.
7. Run native, Node, Playwright, publication, strict OpenSpec, and live-deployment-ready gates plus whole-change review.

Rollback is a static deployment rollback to the previous known-good artifact. Immutable package paths prevent the corrected publication from mutating older builds. No persisted data path or patch identity changes.

## Open Questions

None. One-click activation, native callback-only execution, zero app-specific builds, Mini App migration, Braid 4 publication, and the uniform memory policy are approved.
