## 1. Catalog and compatibility contracts

- [x] 1.1 Add TypeScript catalog/source/package types, supported schema/ABI/UI/runtime-config version constants, and strict validation for IDs, metadata, relative URLs, immutable build IDs, media types, and SHA-256 digests.
- [x] 1.2 Add catalog validation fixtures and unit tests covering valid multi-app catalogs, unsupported versions, malformed identities, missing files, invalid relative URLs, and traversal-like input.
- [x] 1.3 Add deterministic catalog registry merging with `<publisher-id>/<app-id>` identities, configured-source precedence, duplicate diagnostics, and display-name/global-ID sorting, with unit tests.
- [x] 1.4 Expose browser ABI, UI command-buffer, and runtime-config versions from the generic C++/Emscripten adapter before runtime creation, and test compatible and incompatible facade negotiation.

## 2. Trusted catalog discovery and launcher UI

- [x] 2.1 Implement `catalog-sources.json` loading and concurrent cached catalog fetches with independent success, incompatibility, network-failure, and retry status.
- [x] 2.2 Build the generic SheafPatch launcher view with application rows showing app, publisher, author, category, compatibility, loading, and error state, without concrete miniapp branches.
- [x] 2.3 Add launcher tests proving manifests load without package requests, one source failure preserves other apps, retry refreshes a stable catalog URL, and a newly listed app appears without launcher JavaScript changes.
- [x] 2.4 Enforce one active application per page navigation and provide reload/navigation behavior for returning from a running app to the launcher.

## 3. Immutable package build and remote materialization

- [x] 3.1 Add a deterministic package assembler that inventories the Emscripten entry, WASM, pthread/worker, AudioWorklet, and other required sidecars under `packages/<app-id>/<build-id>`, computes SHA-256 values, and emits catalog file records.
- [x] 3.2 Implement CORS package fetching with media-type and SHA-256 verification that refuses to import the entry when any declared file is missing or inconsistent.
- [x] 3.3 Implement typed object-URL materialization, lifetime cleanup, and explicit Emscripten `locateFile` plus `mainScriptUrlOrBlob`/equivalent mappings for WASM and worker/AudioWorklet sidecars.
- [x] 3.4 Add package-loader unit tests for valid builds, stale WASM, missing workers, wrong media types, hash mismatch, object-URL cleanup, and accidental document-relative sidecar resolution.
- [x] 3.5 Extend the two-origin browser test server and generic fake app acceptance path to prove a cross-origin package starts inside a cross-origin-isolated launcher before miniapp tests run.

## 4. Selection activation and runtime ownership

- [ ] 4.1 Refactor browser audio startup so the launcher selection handler creates/resumes the host-owned audio context before awaiting package work and the loaded generic runtime attaches its WASM AudioWorklet to that activated context instead of creating a second context.
- [ ] 4.2 Refactor Web MIDI startup so the same selection handler begins sysex permission acquisition once and passes the resulting host-owned MIDI access into the selected runtime manager.
- [ ] 4.3 Add activation-lease tests with delayed package download/compilation proving the first selection gesture starts audio and MIDI without a second click.
- [ ] 4.4 Add retry and cleanup behavior for denied audio/MIDI activation, failed package loading, runtime initialization failure, and page unload without leaving duplicate contexts, ports, or runtime instances.
- [ ] 4.5 Preserve the generic fake-app-first gate and update real miniapp audio/MIDI smoke tests to select it through the launcher rather than auto-launching a module URL.

## 5. Shared configuration and app persistence isolation

- [ ] 5.1 Extend the browser initialization boundary to accept validated publisher/app identity and derive shared SheafPatch data/config roots plus `patches/<publisher-id>/<app-id>` paths.
- [ ] 5.2 Update IDBFS persistence mounting/sync behavior to preserve the shared runtime config across compatible apps while isolating patch discovery and writes by global app identity.
- [ ] 5.3 Add persistence tests proving build updates retain an app's patch root, different publishers using the same local app ID cannot see each other's patches, and incompatible runtime-config versions cannot write shared config.

## 6. First-party launcher, catalog, and Cloudflare publication

- [ ] 6.1 Add the repository-owned `sheaf` catalog source/package metadata and generate its initial immutable miniapp build through the generic package assembler.
- [ ] 6.2 Replace the production browser HTML auto-launch marker with launcher bootstrap and configure the first catalog source to resolve back to the deployed first-party catalog.
- [ ] 6.3 Update the deterministic Cloudflare publish step to include launcher assets, `catalog-sources.json`, first-party catalog, immutable miniapp package, runtime modules, and existing COOP/COEP/MIDI/WASM headers.
- [ ] 6.4 Update publish validation/tests to reject missing or inconsistent catalog/package references and prove the deployed first-party miniapp is reached only through the generic catalog path.
- [ ] 6.5 Retain a rollback-capable direct miniapp artifact until launcher end-to-end gates pass, then remove production dependence on `dist/wasm/app.js` and document static deployment rollback.

## 7. GitHub Actions and GitHub Pages publisher path

- [ ] 7.1 Add a pinned GitHub Actions workflow that installs Node and Emscripten, builds/tests the browser launcher and packages, and creates a GitHub Pages artifact containing publisher catalogs and immutable app packages.
- [ ] 7.2 Configure the workflow's official `configure-pages`, `upload-pages-artifact`, and `deploy-pages` jobs with required permissions, default-branch/environment gating, concurrency, and manual dispatch support.
- [ ] 7.3 Add post-deploy validation that checks catalog CORS access, `.wasm` `application/wasm` delivery, catalog/package consistency, and the deployed build ID.
- [ ] 7.4 Add a production-like Chromium smoke job that launches the GitHub Pages generic package from a cross-origin-isolated host and fails readiness when remote entry, WASM, worker, AudioWorklet, or audio startup fails.
- [ ] 7.5 Document the one-time repository Pages setting, published catalog URL, publisher build contract, GitHub Pages limits, and why the Cloudflare site remains the top-level launcher.

## 8. Final verification and contract documentation

- [ ] 8.1 Document catalog schema version 1, application package layout, browser ABI/version policy, trusted-publisher model, update/cache behavior, and instructions for a second repository that publishes multiple apps.
- [ ] 8.2 Update synth browser coverage/architecture documentation to map `sbac-1` through `sbac-12` and modified `sprs-12` to unit, native contract, Playwright, publish, and deployed-origin tests.
- [ ] 8.3 Run the complete synth native contract/system suite and browser TypeScript/unit suite, fixing every regression introduced by the catalog and activation boundaries.
- [ ] 8.4 Run generic fake-app two-origin acceptance, real miniapp launcher smoke, audio deadline/non-silence, bidirectional sysex MIDI, persistence, desktop/narrow UI, and Cloudflare publish tests in the required order.
- [ ] 8.5 Inspect the final production artifact to confirm the root page is only the launcher, startup fetches catalogs but no package bytes, the first entry points back to this repository's miniapp package, and no app-specific launcher code remains.
