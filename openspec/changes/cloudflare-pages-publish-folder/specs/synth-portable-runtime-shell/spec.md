## ADDED Requirements

### Requirement: sprs-9 — Deployment: Cloudflare Pages publish artifact
WHEN the browser runtime has been built and its browser application artifact is present, THE synth browser package SHALL provide a deterministic static publish step that assembles a Cloudflare Pages-compatible publish directory containing the HTML/CSS shell, compiled browser runtime modules, browser application WASM sidecar files, and a `_headers` file that preserves cross-origin isolation, Web MIDI permissions, and WASM content typing.

#### Scenario: Publish directory contains deployable assets
- **WHEN** a developer runs the browser publish step after building the TypeScript runtime and browser application artifact
- **THEN** the generated publish directory contains the static shell at its root
- **AND** the generated publish directory contains the compiled browser runtime modules under `dist/src`
- **AND** the generated publish directory contains the browser application artifact and its sidecars under `dist/wasm`

#### Scenario: Cloudflare headers preserve runtime requirements
- **WHEN** Cloudflare Pages serves the generated publish directory
- **THEN** every route is covered by headers declaring `Cross-Origin-Opener-Policy: same-origin`
- **AND** every route is covered by headers declaring `Cross-Origin-Embedder-Policy: require-corp`
- **AND** every route is covered by headers declaring `Permissions-Policy: midi=(self)`
- **AND** WASM assets are covered by headers declaring `Content-Type: application/wasm`

#### Scenario: Missing application artifact fails early
- **WHEN** a developer runs the browser publish step before the browser application artifact exists
- **THEN** the publish step fails before writing a complete publish directory
- **AND** the diagnostic names the missing artifact path.

#### Scenario: Git-backed Cloudflare build bootstraps Emscripten
- **WHEN** Cloudflare Pages runs the synth browser Git-backed build command in an environment without `em++`
- **THEN** the build command installs and activates Emscripten before invoking the browser application Make target
- **AND** the build command publishes the generated site directory after the browser application artifact exists.
