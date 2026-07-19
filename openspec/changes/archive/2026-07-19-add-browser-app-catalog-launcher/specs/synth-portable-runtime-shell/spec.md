## MODIFIED Requirements

### Requirement: sprs-12 — Deployment: Cloudflare Pages publish artifact
WHEN the browser runtime, catalog launcher, first-party catalog, and first-party application package have been built, THE synth browser package SHALL provide a deterministic static publish step that assembles a Cloudflare Pages-compatible directory containing the launcher HTML/CSS, compiled generic browser runtime modules, trusted catalog source configuration, the first-party catalog, immutable application package files and sidecars, and a `_headers` file that preserves cross-origin isolation, Web MIDI permissions, and WASM content typing.

#### Scenario: Publish directory contains deployable launcher assets
- **WHEN** a developer runs the browser publish step after building the TypeScript launcher/runtime and first-party application package
- **THEN** the generated publish directory contains the catalog launcher at its root
- **AND** it contains compiled generic browser runtime modules under `dist/src`
- **AND** it contains the trusted catalog source configuration and first-party catalog
- **AND** it contains the miniapp entry, WASM, and required sidecars under an immutable package build path

#### Scenario: First-party catalog resolves within the deployment
- **WHEN** the published launcher reads its first configured catalog source
- **THEN** that URL resolves to the first-party catalog in the same Cloudflare Pages deployment
- **AND** the catalog's miniapp files resolve to the immutable first-party package in that deployment

#### Scenario: Cloudflare headers preserve runtime requirements
- **WHEN** Cloudflare Pages serves the generated publish directory
- **THEN** every route is covered by headers declaring `Cross-Origin-Opener-Policy: same-origin`
- **AND** every route is covered by headers declaring `Cross-Origin-Embedder-Policy: require-corp`
- **AND** every route is covered by headers declaring `Permissions-Policy: midi=(self)`
- **AND** WASM assets are covered by headers declaring `Content-Type: application/wasm`

#### Scenario: Missing catalog or package artifact fails early
- **WHEN** a developer runs the browser publish step before the trusted source list, first-party catalog, application entry, or declared package sidecar exists
- **THEN** the publish step fails before writing a complete publish directory
- **AND** the diagnostic names the missing artifact or invalid catalog reference

#### Scenario: Git-backed Cloudflare build bootstraps Emscripten
- **WHEN** Cloudflare Pages runs the synth browser Git-backed build command in an environment without `em++`
- **THEN** the build command installs and activates Emscripten before invoking the browser application/package targets
- **AND** the build command publishes the generated launcher, catalog, and package directory only after their validation succeeds
