## MODIFIED Requirements

### Requirement: sprs-8 — Browser audio: runtime-owned AudioWorklet callback
WHEN the Chrome static site starts audio for any conforming browser-hosted application, THE browser runtime SHALL require browser ABI v2, use a generic Emscripten Wasm AudioWorklet callback that invokes the C++ `Runtime<App>::Process` path against the same runtime/engine instance used by UI, MIDI, patch, and controller operations, register the host `AudioContext` acquired synchronously by catalog selection with the selected module before native callback startup, and SHALL NOT schedule DSP production through a timer, animation frame, message-loop cadence, ScriptProcessor, or JavaScript sample ring.

#### Scenario: No duplicated application runtime
- **WHEN** the browser audio path starts
- **THEN** it does not construct a second application or runtime instance inside JavaScript or an AudioWorklet
- **AND** it does not use concrete-application JavaScript, HTML, node IDs, actions, or layout

#### Scenario: One selection click starts the native callback
- **WHEN** a user selects a catalog application before its package has been downloaded
- **THEN** the synchronous selection handler creates and resumes one host audio context before awaiting package work
- **AND** after verification and module initialization the generic host registers that same context with the module and starts its native Wasm AudioWorklet
- **AND** no second user gesture or second audio context is required

#### Scenario: Missing native support fails closed
- **WHEN** a loaded runtime module does not expose compatible host-context registration and native AudioWorklet startup
- **THEN** launch fails with a diagnostic before reporting audio online
- **AND** the browser does not start timer-driven, ring-buffered, or otherwise degraded audio

#### Scenario: ABI v1 package is rejected
- **WHEN** a catalog package reports browser ABI v1 or changes the v2 context-aware start signature
- **THEN** compatibility negotiation rejects it before runtime creation
- **AND** the publisher must rebuild the package with the v2 generic browser boundary

#### Scenario: Allocation completes before callback startup
- **WHEN** an application requires Wasm heap allocation or growth during construction and initialization
- **THEN** those operations complete before its native AudioWorklet is started
- **AND** the real-time callback does not allocate or trigger memory growth

#### Scenario: Browser callback verification
- **WHEN** Chromium can be launched with the required host permissions
- **THEN** Playwright verifies every real first-party browser app starts the runtime-owned AudioWorklet callback from one catalog selection and observes advancing processed-block and finite deadline diagnostics
- **AND** the verification cannot pass by merely resuming a silent host context

### Requirement: sprs-12 — Deployment: Cloudflare Pages publish artifact
WHEN the browser runtime, catalog launcher, and configured first-party applications have been built, THE synth browser package SHALL provide a deterministic static publish step that assembles a Cloudflare Pages-compatible directory containing the launcher HTML/CSS, compiled generic browser runtime modules, production trusted-catalog source configuration, validated rollback catalog/package copies, and a `_headers` file that preserves cross-origin isolation, Web MIDI permissions, and WASM content typing.

#### Scenario: Publish directory contains deployable launcher assets
- **WHEN** a developer runs the browser publish step after building the TypeScript launcher/runtime and every configured first-party application
- **THEN** the generated publish directory contains the catalog launcher at its root
- **AND** it contains compiled generic browser runtime modules under `dist/src`
- **AND** it contains the complete validated first-party catalog/package set and one generic rollback page per app

#### Scenario: Production discovery uses the GitHub Pages publisher
- **WHEN** Cloudflare Pages serves the production launcher and it reads its first configured catalog source
- **THEN** that source is the stable GitHub Pages catalog URL published from this repository
- **AND** selecting Mini App or Braid 4 fetches that app's immutable package from GitHub Pages through the generic cross-origin package path
- **AND** the checked-in localhost source list remains relative to the local development server

#### Scenario: Cloudflare headers preserve runtime requirements
- **WHEN** Cloudflare Pages serves the generated publish directory
- **THEN** every route is covered by headers declaring `Cross-Origin-Opener-Policy: same-origin`
- **AND** every route is covered by headers declaring `Cross-Origin-Embedder-Policy: require-corp`
- **AND** every route is covered by headers declaring `Permissions-Policy: midi=(self)`
- **AND** WASM assets are covered by headers declaring `Content-Type: application/wasm`

#### Scenario: Missing catalog or package artifact fails early
- **WHEN** a developer runs the browser publish step before the trusted source list, first-party catalog, configured application entry, or declared package sidecar exists
- **THEN** the publish step fails before writing a complete publish directory
- **AND** the diagnostic names the missing artifact or invalid catalog reference

#### Scenario: Git-backed Cloudflare build bootstraps Emscripten
- **WHEN** Cloudflare Pages runs the synth browser Git-backed build command in an environment without `em++`
- **THEN** the build command installs and activates Emscripten before invoking the generic browser application targets
- **AND** the build command publishes the generated launcher only after every configured application, catalog, and package validates
