# Native Browser Audio and Generic App Packaging Design

## Context

The browser catalog launcher correctly discovers trusted catalogs, verifies
immutable application packages, and consumes the catalog-selection click as the
single audio/MIDI activation gesture. Its first implementation nevertheless
introduced two architectural regressions.

First, the launcher-created `AudioContext` selects a JavaScript ring-buffer
producer driven by `setInterval`. The AudioWorklet consumes that ring on the
browser callback, but DSP production is not callback-driven. At 48 kHz a
128-frame block is required every 2.667 ms while the timer is rounded to 3 ms,
so the producer is intrinsically too slow even before normal main-thread jitter.
The pre-launcher Mini App instead used Emscripten's native Wasm AudioWorklet,
whose real-time callback invokes `Runtime::Process` directly.

Second, first-party publication is hard-coded around Mini App. It has a
handwritten browser entry translation unit, a dedicated Make target, and a
catalog assembler that accepts exactly `miniapp.js` and `miniapp.wasm`. That
turns an otherwise ordinary `SynthApplication` into a browser special case and
makes adding Braid 4 require duplicated browser plumbing.

The corrected architecture keeps one-click activation and catalog federation,
but makes startup context adoption the only difference from the original
runtime. Once audio begins, application execution is the existing native Wasm
AudioWorklet path. Every first-party app is built and published by one generic
manifest-driven pipeline.

## Goals

- Preserve one catalog-selection click as the only audio and MIDI activation
  gesture, even though package download and verification are asynchronous.
- Run DSP exclusively from the existing Emscripten Wasm AudioWorklet callback;
  `Runtime::Process` remains the callback's direct processing target.
- Delete the timer/ring-buffer audio fallback rather than retain it as a
  degraded mode.
- Fail closed with a clear diagnostic when a module cannot adopt the activated
  context or start its native callback.
- Keep application DSP, UI, lifecycle, and persistence behavior unchanged once
  the runtime is launched.
- Make any `SynthApplication` publishable by adding one declarative record to a
  first-party app build manifest.
- Migrate Mini App to the generic path and add Braid 4 without checked-in
  app-specific browser source, build recipes, catalog branches, or tests.
- Start each application module with 512 MiB of Wasm memory, permit growth to
  2 GiB, and complete application construction and any memory growth before
  starting the real-time callback.

## Non-Goals

- No dynamic compilation of arbitrary repository source in the browser.
- No stable C++ library ABI or dynamic linking against a launcher-owned Sheaf
  library; every package remains self-contained.
- No simultaneous application sessions or in-page app switching.
- No per-app browser adapter API, audio engine, runtime branch, or hand-authored
  Emscripten entry source.
- No Braid 4 DSP, portable UI, scope, or persistence redesign.
- No timer, animation-frame, worker-message, or ScriptProcessor substitute for
  real-time DSP callback scheduling.

## Architecture

### One-click activation with native context adoption

The catalog row's synchronous event handler creates and resumes one host
`AudioContext` and requests Web MIDI, producing an activation lease exactly as
today. Package fetch, hashing, object-URL materialization, and module
instantiation then occur asynchronously.

After the Emscripten module factory resolves, the generic module facade calls
the module-local `emscriptenRegisterAudioObject` runtime method exported by the
common linker contract, registering the leased JavaScript `AudioContext` and
receiving an `EMSCRIPTEN_WEBAUDIO_T` handle. Browser ABI v2 starts the runtime's
Wasm AudioWorklet using that handle. The native
startup method obtains sample rate and render quantum from the registered
context, prepares the engine, creates the Wasm AudioWorklet processor and node,
and connects it to that context's destination.

Only context ownership changes. The existing `ProcessAudioWorklet` callback,
deadline metering, block counting, peak metering, and direct call to
`Runtime::Process` remain the production path. The direct non-catalog path may
continue to let the runtime create its own context from an in-app gesture, but
it uses the same callback implementation.

The v2 host-context registration surface is part of the generic browser module
contract, not an application contract. A self-contained package built with a
compatible Sheaf fork exposes the same narrow module hook. If it does not, the
launcher rejects it before audio startup. There is no fallback.

### Delete the timer audio transport

The following production concepts are removed:

- `configure-audio` and `render-audio` runtime commands;
- audio render intervals and block-duration rounding;
- audio sample `SharedRingBuffer` production and underflow concealment;
- the JavaScript ring-buffer AudioWorklet processor and its package role when
  it exists solely for that fallback;
- tests that treat a leased context as a reason to bypass the native callback.

Shared memory required by Emscripten's Wasm AudioWorklet and pthread support is
not removed. Only the host-produced sample ring is removed.

### One declarative first-party app build manifest

One checked-in first-party app build manifest is the authoritative input to
browser compilation and catalog generation. Each record contains declarative
metadata such as:

```json
{
  "appId": "braid-4",
  "displayName": "Braid 4",
  "author": "Sheaf",
  "category": "synth",
  "header": "Braid4.hpp",
  "cppType": "synth_braid4::Braid4",
  "includeDirs": ["../apps/braid-4"]
}
```

The header, C++ type, and include directories are compile-time build identity,
not browser behavior. Records may not select different runtime sources,
exports, audio paths, packaging algorithms, or publication layouts.

A generic build tool validates the whole manifest, then for each app generates
a transient build-directory translation unit containing the configured include
and `SYNTH_BROWSER_APP(<cppType>)`. It invokes one Emscripten recipe with the
same runtime sources, ABI exports, sidecar policy, memory policy, and compiler
flags for every app. The generated translation unit is not checked in.

The same tool or its structured output feeds the generic package assembler.
Each app's emitted files are validated, hashed, placed under
`packages/<app-id>/<build-id>/`, and appended to one deterministic catalog.
Catalog versioning reflects the complete ordered set of application package
records rather than one privileged package.

Mini App and Braid 4 are both entries in this manifest. The handwritten
`miniapp_entry.cpp`, Mini App-only catalog template shape, filename checks, and
special Make recipes are removed. Adding another ordinary app requires one
manifest record and no browser source changes.

### Memory policy

All first-party browser apps use the same memory policy:

- `INITIAL_MEMORY=536870912` (512 MiB);
- `ALLOW_MEMORY_GROWTH=1`;
- `MAXIMUM_MEMORY=2147483648` (2 GiB).

Application construction, scope allocation, filesystem initialization, and
any heap growth complete before the native AudioWorklet is started. The
real-time callback must not allocate or trigger memory growth. Braid 4 is built
unchanged and tested against this policy; memory pressure is a launch failure,
not a reason for an app-specific reduced-scope build.

## Data Flow

1. The launcher cheaply fetches source lists and catalogs; no package bytes are
   fetched.
2. The user selects an application once.
3. The synchronous handler acquires/resumes audio and requests MIDI.
4. The selected immutable package is downloaded, verified, and materialized.
5. The generic Emscripten factory loads the app-specific module.
6. The generic module facade registers the leased context with the module.
7. The runtime initializes the app and finishes all allocations.
8. The runtime starts the native Wasm AudioWorklet on the registered context.
9. Browser pull callbacks invoke the unchanged native processing path.

## Error Handling

- Missing host-context registration or native AudioWorklet exports is a
  compatibility failure before runtime activation.
- Context registration, preparation, worklet creation, or connection failure
  stops the launch, disposes the package and activation lease, and shows a
  retryable diagnostic.
- No failure path starts timer-driven audio or reports audio online without
  observing native callback progress.
- Invalid app build-manifest records fail the build before compiling any
  publication artifact.
- One app's compilation or packaging failure fails the complete first-party
  catalog build; partial catalogs are never published.

## Verification

- Static generic-boundary tests reject app IDs, app type names, and per-app
  branches in generic runtime/build/publisher sources outside the declarative
  manifest and generated outputs.
- Contract tests prove a registered host context reaches native Wasm
  AudioWorklet startup and that the callback still calls `Runtime::Process`.
- Tests prove timer/ring-buffer audio commands and scheduling are absent.
- A generic fixture app proves the manifest-driven compiler and packager
  without Mini App or Braid 4 assumptions.
- Real Chromium smoke tests launch Mini App and Braid 4 from the same catalog
  with one selection click and observe increasing native callback block counts,
  nonzero output where appropriate, and valid deadline metrics.
- Publication tests prove deterministic two-app catalog ordering, immutable
  content-addressed packages, correct media types/hashes, and both Cloudflare
  launcher and GitHub Pages publisher artifacts.
- Existing native synth, browser runtime, persistence, MIDI, UI, catalog,
  cross-origin package, and deployment validation suites remain green.

## Migration and Rollback

The correction replaces the unpublished feature branch's timer path and
first-party Mini App special cases before landing. There is no persisted data
migration. Existing patch namespaces remain `<publisher-id>/<app-id>`.

Rollback remains a static deployment rollback to the previous known-good site.
Because packages are immutable and content-addressed, publishing the corrected
catalog adds new build directories rather than mutating an older build.

## Decisions Confirmed

- One catalog selection click must acquire audio and MIDI.
- Once launched, app execution is the original native callback architecture.
- Degraded timer audio is worse than silence and is forbidden.
- Mini App and Braid 4 use one generic manifest-driven build and publication
  path; neither is special.
- All apps start with 512 MiB and may grow to a 2 GiB maximum before audio.
