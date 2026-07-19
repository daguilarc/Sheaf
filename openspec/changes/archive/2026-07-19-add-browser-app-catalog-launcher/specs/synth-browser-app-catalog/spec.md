## ADDED Requirements

### Requirement: sbac-1 — Discovery: preconfigured trusted catalog sources
WHEN the browser SheafPatch launcher starts, THE launcher SHALL fetch a static preconfigured list of trusted HTTPS catalog URLs concurrently, apply normal HTTP cache validation, and present the union of compatible applications without fetching any application package file before selection.

#### Scenario: One catalog exposes multiple applications
- **WHEN** one configured catalog contains two valid compatible application records
- **THEN** the launcher lists both applications from that single catalog fetch

#### Scenario: Catalog startup remains cheap
- **WHEN** the launcher has fetched its source list and catalog JSON files but the user has not selected an application
- **THEN** no application entry module, WASM binary, worker, AudioWorklet, or package sidecar has been fetched

#### Scenario: One source is unavailable
- **WHEN** one configured catalog times out or returns a non-success response while another catalog is valid
- **THEN** applications from the valid catalog remain selectable
- **AND** the failed source has a retryable diagnostic that identifies its catalog URL

### Requirement: sbac-2 — Contract: versioned catalog validation and relative URLs
WHEN a catalog response is processed, THE launcher SHALL require supported schema and catalog versions, valid publisher and app identifiers, display metadata, immutable build identity, browser ABI/UI/runtime-config versions, an entry file, and a complete package file list with media types and SHA-256 digests; THE launcher SHALL resolve relative entry and file URLs against the catalog response URL and reject invalid records before presenting them as runnable.

#### Scenario: Relative package paths follow the catalog
- **WHEN** a catalog at `https://publisher.example/releases/catalog.json` declares `packages/app/build/app.js`
- **THEN** the resolved file URL is `https://publisher.example/releases/packages/app/build/app.js`

#### Scenario: Unsupported schema does not execute code
- **WHEN** a catalog declares a schema version the launcher does not support
- **THEN** the launcher reports the catalog as incompatible
- **AND** it does not fetch or execute an application file from that catalog

#### Scenario: Traversal-like identity is rejected
- **WHEN** a publisher or app ID is empty or contains characters outside lowercase ASCII letters, digits, and hyphens
- **THEN** the affected catalog or app record is rejected before the identity is used in a URL, cache key, or persistence path

### Requirement: sbac-3 — Registry: global identity and deterministic merge
WHEN validated catalogs are merged, THE launcher SHALL identify an application by `<publisher-id>/<app-id>`, sort accepted applications deterministically by display name and then global identity, retain the first accepted registration for a duplicated global identity, and report every later duplicate without allowing it to replace the accepted application.

#### Scenario: Two publishers reuse a local app ID
- **WHEN** publishers `sheaf` and `friend` both publish an app with local ID `miniapp`
- **THEN** the registry contains distinct `sheaf/miniapp` and `friend/miniapp` applications

#### Scenario: Duplicate publisher and app identity is visible
- **WHEN** two catalog records resolve to `sheaf/miniapp`
- **THEN** only the first accepted record in configured source order is selectable
- **AND** the launcher reports the conflicting source instead of silently overriding the registration

### Requirement: sbac-4 — Package: immutable and internally consistent builds
WHEN an application package is selected, THE package loader SHALL fetch exactly the files declared for that immutable build ID, verify each file's SHA-256 digest and declared media type before module instantiation, and fail the selection without executing the entry module if any file is absent, changed, or from a different build.

#### Scenario: Valid package materializes
- **WHEN** every declared package file is fetched with its expected bytes and media type
- **THEN** the loader makes one internally consistent package available for instantiation

#### Scenario: Stale WASM is rejected
- **WHEN** the entry JavaScript matches its digest but the fetched WASM bytes do not
- **THEN** the loader reports a package-integrity failure
- **AND** no runtime creation export is invoked

### Requirement: sbac-5 — Compatibility: stable host boundary with embedded library
WHEN a browser application package is built, THE package SHALL contain its concrete application, its chosen Sheaf library implementation or fork, and an adapter for one declared browser ABI; THE launcher SHALL depend only on supported ABI, UI command-buffer, and runtime-config versions and SHALL NOT dynamically replace the application's embedded DSP/library implementation with the launcher's current Sheaf library.

#### Scenario: Older application keeps its DSP implementation
- **WHEN** the launcher is redeployed with newer Sheaf DSP code and opens a previously published compatible application package
- **THEN** that application executes the DSP/library implementation embedded in its package
- **AND** no current launcher library is linked into or substituted for the package

#### Scenario: ABI mismatch fails before creation
- **WHEN** a package declares a browser ABI version unsupported by the launcher
- **THEN** the launcher reports the required and supported versions
- **AND** it does not call the package's runtime creation export

#### Scenario: Compatible fork runs
- **WHEN** an application built with a Sheaf fork preserves the declared browser ABI, UI protocol, and runtime-config contract
- **THEN** the launcher runs it through the same generic host path as the first-party miniapp

### Requirement: sbac-6 — Activation: application selection owns the first gesture
WHEN the user selects a compatible application row, THE launcher SHALL synchronously begin acquisition of a host-owned audio activation context and sysex Web MIDI permission from that gesture before awaiting package network or compilation work, SHALL pass the activated host resources into the selected runtime, and SHALL NOT require a second click to produce audio or connect permitted MIDI devices.

#### Scenario: Slow package retains activation
- **WHEN** package download and WASM compilation complete after the selection handler's asynchronous boundary
- **THEN** the application attaches to the audio context activated by the original selection
- **AND** audio startup does not depend on creating a new unactivated context after the download

#### Scenario: Permission failure can be retried
- **WHEN** audio activation or MIDI permission acquisition fails
- **THEN** the selected row reports the failure without executing an unprepared application
- **AND** the user can retry selection with a new gesture

### Requirement: sbac-7 — Loading: CORS package sidecar materialization
WHEN a trusted package is hosted on a different origin from the cross-origin-isolated launcher, THE loader SHALL fetch every declared file with CORS, materialize typed same-session object URLs, configure the Emscripten module's WASM and worker/AudioWorklet file resolution explicitly, and retain those URLs for the active app lifetime so direct cross-origin `Worker` or `AudioWorklet` URL acceptance is not required.

#### Scenario: GitHub Pages package starts from Cloudflare launcher
- **WHEN** a compatible catalog and package are served by GitHub Pages with CORS and correct WASM media type
- **THEN** the Cloudflare-hosted launcher materializes and starts that package while remaining cross-origin isolated

#### Scenario: Worker sidecar is not loaded by accidental document-relative URL
- **WHEN** an Emscripten package contains a pthread or WASM-worker sidecar
- **THEN** the worker is bootstrapped from the package loader's resolved object URL
- **AND** it does not resolve against the launcher document path or require direct construction from a cross-origin worker URL

### Requirement: sbac-8 — Launcher: generic loading, running, and failure states
WHILE no application is active, THE browser site SHALL render a generic SheafPatch catalog launcher with publisher, author, category, compatibility, loading, and source-status information; WHEN one application starts successfully, THE site SHALL replace the launcher surface with the existing generic runtime UI without concrete-application HTML, node IDs, controls, or branches.

#### Scenario: Miniapp is not special-cased
- **WHEN** the first-party miniapp is selected
- **THEN** its row uses the same catalog record, package loader, ABI adapter, and runtime UI path as any other compatible app

#### Scenario: Selected app fails to initialize
- **WHEN** package verification succeeds but runtime initialization returns an error
- **THEN** the launcher reports that app's failure without removing other catalog applications
- **AND** a reload or retry can return to catalog selection

#### Scenario: Only one app runs per navigation
- **WHEN** an application has started
- **THEN** no second application runtime is created concurrently in that page lifetime
- **AND** returning to the launcher uses a top-level reload or navigation that releases the prior page's audio and MIDI ownership

### Requirement: sbac-9 — Persistence: shared runtime config and isolated app patches
WHEN a catalog application initializes browser persistence, THE launcher/runtime boundary SHALL use the global application identity to keep shared SheafPatch runtime configuration under one common browser root and application patches under `patches/<publisher-id>/<app-id>`; THE application build ID SHALL NOT change that patch root, and an unsupported runtime-config version SHALL be rejected before shared configuration is written.

#### Scenario: App update retains patches
- **WHEN** `sheaf/miniapp` changes from one immutable build ID to another compatible build ID
- **THEN** both builds resolve the same `patches/sheaf/miniapp` root

#### Scenario: Publishers cannot collide in patch storage
- **WHEN** `sheaf/miniapp` and `friend/miniapp` run on the same browser origin
- **THEN** their patch roots are distinct
- **AND** neither app discovers the other's patch files

#### Scenario: Runtime config incompatibility is non-destructive
- **WHEN** an app declares a runtime-config version unsupported by the launcher
- **THEN** it is rejected before its module can overwrite shared runtime configuration

### Requirement: sbac-10 — Distribution: first-party catalog and package
WHEN the synth browser publish artifact is assembled, THE repository SHALL generate and include a first-party `sheaf` catalog whose initial application is the existing miniapp, SHALL point the production catalog source list at that deployed catalog, and SHALL point the catalog entry at the immutable miniapp package in the same deployment.

#### Scenario: Production page is only a launcher
- **WHEN** the deployed site is opened before selection
- **THEN** it displays the SheafPatch catalog launcher
- **AND** it does not auto-load miniapp or name miniapp in launcher/runtime source code outside first-party catalog/build metadata

#### Scenario: First entry points back to Sheaf
- **WHEN** the production launcher fetches its first configured source
- **THEN** it reads the catalog published from this repository
- **AND** selecting that catalog's miniapp loads the package published from this repository

### Requirement: sbac-11 — Distribution: GitHub Actions and Pages publisher path
WHEN the repository's catalog/package publication workflow runs on the default branch, THE workflow SHALL build and test the generic browser runtime, launcher, first-party catalog, and immutable miniapp package with pinned toolchain inputs; SHALL upload and deploy a GitHub Pages artifact using the official Pages Actions flow; and SHALL treat Pages as a catalog/package origin rather than the top-level cross-origin-isolated launcher.

#### Scenario: Push publishes updated catalog
- **WHEN** an accepted default-branch change adds an app or changes a package build
- **THEN** GitHub Actions publishes a catalog referencing the new immutable build ID without requiring launcher source changes

#### Scenario: Pages artifact excludes launcher authority
- **WHEN** the GitHub Pages artifact is inspected
- **THEN** it contains publisher catalogs and packages needed by remote launchers
- **AND** production still relies on the Cloudflare launcher for COOP, COEP, Web MIDI policy, and top-level cross-origin isolation

#### Scenario: Deployed Pages behavior is verified
- **WHEN** a Pages deployment completes
- **THEN** post-deploy checks confirm catalog CORS visibility and `application/wasm` delivery
- **AND** a cross-origin-isolated Chromium launcher test starts the deployed generic app package before publication is considered ready

### Requirement: sbac-12 — Verification: federation, activation, and version isolation
WHEN the catalog launcher change is verified, THE synth project SHALL include schema/merge/package unit tests, two-origin browser integration tests, generic fake-app acceptance before miniapp smoke, activation timing tests, ABI incompatibility tests, persistence namespace tests, deterministic publish tests, and a production-like test proving a catalog update changes the listed build without recompiling launcher code.

#### Scenario: New catalog app appears without launcher rebuild
- **WHEN** a test catalog at a stable URL changes from one valid app list to a newer list and the launcher refreshes it
- **THEN** the newly listed compatible app appears without changing or rebuilding launcher JavaScript

#### Scenario: Forked implementation remains isolated
- **WHEN** two compatible fake packages expose the same host ABI but distinguish their embedded library behavior
- **THEN** each selected package exhibits its own embedded behavior
- **AND** the launcher does not share application implementation state between them

#### Scenario: Generic gate precedes miniapp
- **WHEN** end-to-end catalog tests run
- **THEN** a generic fake publisher/app proves catalog discovery, remote package loading, activation, and runtime startup before the first-party miniapp acceptance path runs
