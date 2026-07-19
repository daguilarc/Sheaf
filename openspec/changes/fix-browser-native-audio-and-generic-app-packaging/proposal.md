## Why

The catalog launcher currently routes a click-acquired `AudioContext` through a timer-driven JavaScript sample producer, so production DSP under-runs instead of executing at the browser's real-time callback cadence. First-party publication is also hard-coded to Mini App, preventing an ordinary `SynthApplication` such as Braid 4 from being published by adding one declarative app record.

## What Changes

- **BREAKING** Advance the browser ABI from v1 to v2 for host-context adoption, remove the JavaScript timer/ring-buffer audio fallback and its runtime commands, and fail closed when a module cannot start the native Wasm AudioWorklet.
- Register the single click-acquired host `AudioContext` with the selected Emscripten module, then run the existing native `ProcessAudioWorklet` → `Runtime::Process` path unchanged.
- Require application construction and any Wasm memory growth to finish before native audio callback startup.
- Replace Mini App-specific entry sources, build targets, catalog templates, and publisher branches with one validated declarative app build manifest and generic compiler/packager.
- Migrate Mini App to the generic path and add Braid 4 as a second first-party catalog application without browser-specific application code.
- Apply one browser memory policy to every first-party app: 512 MiB initial memory, growth enabled, and a 2 GiB maximum.
- Extend browser and publication tests to prove native callback cadence, absence of fallback scheduling, generic app boundaries, deterministic multi-app output, and real Mini App/Braid 4 launches.

## Capabilities

### New Capabilities

- `synth-browser-app-packaging`: Declarative, application-agnostic compilation, immutable packaging, and first-party catalog publication for ordinary `SynthApplication` types.

### Modified Capabilities

- `synth-portable-runtime-shell`: Strengthen browser audio requirements so one-click host-context adoption must start the native runtime-owned Wasm AudioWorklet and no timer/ring producer is permitted.

## Impact

- Browser host and ABI: `projects/synth/browser/src`, `projects/synth/browser/cpp`, and `projects/synth/include/synth/browser`.
- Browser build/package/publication machinery, first-party catalog inputs, Cloudflare artifact, and GitHub Pages workflow.
- Mini App's handwritten browser entry is removed; Mini App application code is unchanged.
- Braid 4 is compiled and published through the generic app manifest; Braid 4 application code is unchanged.
- Browser TypeScript/Node/Playwright coverage, C++ browser contract tests, publication documentation, and synth coverage documentation are updated.
