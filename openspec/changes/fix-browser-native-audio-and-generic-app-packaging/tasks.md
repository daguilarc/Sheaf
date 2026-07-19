## 1. Native One-Click Audio

- [x] 1.1 Add focused failing C++ and browser tests proving a click-acquired host context is registered with the selected module and starts the existing native Wasm AudioWorklet callback.
- [x] 1.2 Advance the browser ABI to v2, export the generic module-local Emscripten context-registration method, and refactor `Runtime<App>` startup to accept either the registered context or its existing direct-path-created context while preserving one `ProcessAudioWorklet` implementation.
- [x] 1.3 Remove the JavaScript audio render interval, sample ring, `configure-audio`/`render-audio` commands, fallback AudioWorklet processor, and tests that permit degraded audio.
- [x] 1.4 Verify native block, peak, and deadline diagnostics advance from one launcher selection without a second context or second application runtime.

## 2. Declarative Generic App Builder

- [x] 2.1 Add failing manifest-validation and generated-binding tests covering required metadata, compile identity, duplicate IDs, path safety, unsupported fields, and generic-boundary enforcement.
- [x] 2.2 Introduce one first-party app build manifest and a generic builder that emits transient `SYNTH_BROWSER_APP` translation units and structured app emissions.
- [x] 2.3 Apply the uniform 512 MiB initial, growable-to-2 GiB memory policy and common runtime sources/exports/worker settings to every manifest record.
- [x] 2.4 Replace handwritten Mini App entry/build plumbing with a Mini App manifest record and prove application code remains unchanged.

## 3. Generic Multi-App Packaging

- [ ] 3.1 Add failing deterministic multi-app catalog/package tests that contain no privileged application assumptions.
- [ ] 3.2 Generalize first-party catalog assembly to iterate structured app emissions, validate every file, package every app immutably, and derive catalog version from the complete ordered package set.
- [ ] 3.3 Remove the single-app catalog template shape, Mini App filename checks, special package branches, and publication assumptions.
- [ ] 3.4 Preserve atomic site/pages artifact replacement so any app failure leaves the prior validated output untouched.

## 4. Braid 4 as an Ordinary App

- [ ] 4.1 Add Braid 4 only as a declarative app-manifest record and verify static checks find no Braid 4 browser source, branch, adapter, or custom build recipe.
- [ ] 4.2 Compile and package the unchanged Braid 4 `SynthApplication` under the common memory/runtime policy and validate its immutable package metadata.
- [ ] 4.3 Add a real Chromium Braid 4 launch proving portable UI rendering, one-click native callback progress, finite deadline data, non-silent output, and isolated persistence.

## 5. Shared Launcher and Publication Acceptance

- [ ] 5.1 Update generic launcher/runtime tests so Mini App and Braid 4 independently launch from the same deterministic two-app catalog through the same activation and package path.
- [ ] 5.2 Update Cloudflare and GitHub Pages artifact tests and deployed-origin validation for the complete catalog and both immutable packages without changing their host-specific responsibilities.
- [ ] 5.3 Update CI build targets to compile and validate all configured apps generically and retain live GitHub Pages CORS/MIME/browser gates.

## 6. Documentation and Completion Gates

- [ ] 6.1 Update browser publisher/runtime documentation and synth coverage records for native-only audio, declarative app onboarding, two-app publication, and the common memory policy.
- [ ] 6.2 Run focused C++ contract, TypeScript/Node, generic-boundary, real-Wasm Chromium, two-origin, publication, and workflow tests.
- [ ] 6.3 Run the full synth and browser suites, rebuild both publication artifacts, validate the OpenSpec change strictly, and confirm `git diff --check` is clean.
- [ ] 6.4 Complete spec-compliance, code-quality, and fresh whole-change release-risk reviews; resolve every actionable finding and re-run affected verification.
