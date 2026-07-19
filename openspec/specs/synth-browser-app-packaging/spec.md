# synth-browser-app-packaging Specification

## Purpose

Define application-agnostic first-party browser compilation, memory policy, immutable multi-app publication, and generic parity verification.

## Requirements

### Requirement: sbap-1 — Registry: one declarative first-party app list
WHEN a first-party `SynthApplication` is selected for browser publication, THE synth browser build SHALL require only one validated declarative app record containing catalog metadata and compile-time C++ identity and SHALL NOT require checked-in app-specific browser source, build recipes, runtime branches, package logic, or deployment logic.

#### Scenario: Mini App and Braid 4 are ordinary records
- **WHEN** the first-party app list is inspected
- **THEN** it contains Mini App and Braid 4 records with their header, qualified C++ type, include directory, app ID, display name, author, and category
- **AND** neither application has a handwritten browser entry translation unit or application-specific browser build path

#### Scenario: Invalid records fail before publication
- **WHEN** a record is missing a required field, duplicates an app ID, escapes an allowed source root, uses an invalid identifier, or selects unsupported build behavior
- **THEN** the browser build fails before producing a publication artifact
- **AND** it names the invalid record and field

### Requirement: sbap-2 — Compilation: generated binding and uniform runtime
WHEN the first-party browser build compiles its declarative app list, THE build SHALL generate each app's `SYNTH_BROWSER_APP` binding only as a transient build artifact and SHALL compile every app with the same browser ABI v2 runtime sources, context-registration/start exports, worker/worklet policy, compiler settings, and memory policy of 512 MiB initial memory, enabled growth, and a 2 GiB maximum.

#### Scenario: Ordinary SynthApplication compiles generically
- **WHEN** a manifest record names a header and qualified type satisfying `SynthApplication`
- **THEN** the generated binding instantiates the shared `BrowserRuntime<App>` without application-specific runtime code
- **AND** adding the record requires no edit to generic browser C++, TypeScript, Make recipes, package assembly, or deployment workflows

#### Scenario: Memory policy is uniform and pre-audio
- **WHEN** Mini App, Braid 4, or a fixture app is linked
- **THEN** its module declares 536870912 bytes of initial memory, allows growth, and declares 2147483648 bytes as its maximum
- **AND** application initialization and required growth finish before native audio callback startup

### Requirement: sbap-3 — Publication: deterministic multi-app immutable catalog
WHEN the first-party browser publication is assembled, THE publisher SHALL iterate the validated app list generically, validate every app emission, create one immutable content-addressed package per app build, and write one deterministic catalog containing the complete ordered set without privileged Mini App or Braid 4 branches.

#### Scenario: Two real first-party applications are published
- **WHEN** the repository publication build succeeds
- **THEN** the Sheaf catalog contains exactly the configured Mini App and Braid 4 records in deterministic order
- **AND** each record resolves to its own hashed JavaScript/Wasm package files with correct size, media type, and SHA-256 metadata

#### Scenario: Repeated builds are byte-identical
- **WHEN** identical sources, toolchain, and app-list inputs are published twice
- **THEN** catalog and package output trees are byte-identical
- **AND** the catalog version represents the complete ordered package set rather than one app

#### Scenario: One app failure prevents partial publication
- **WHEN** any configured app fails compilation, emits an undeclared file, or fails package validation
- **THEN** the complete first-party publication fails
- **AND** no partial catalog replaces the last validated output

### Requirement: sbap-4 — Verification: generic boundary and real-app parity
WHEN generic first-party packaging is verified, THE synth project SHALL include static boundary checks, fixture coverage, and real Chromium launches proving that app identity affects only declarative metadata and compiled application type while runtime, audio, packaging, publication, and deployment behavior remain shared.

#### Scenario: Generic sources contain no concrete app knowledge
- **WHEN** generic browser runtime, build-tool, package, publisher, and workflow sources are scanned
- **THEN** they contain no Mini App or Braid 4 IDs, type names, filenames, conditional branches, or alternate recipes outside the declarative manifest and generated/test artifacts

#### Scenario: Both real apps use one launcher path
- **WHEN** Chromium loads the validated two-app catalog and launches Mini App and Braid 4 in independent page sessions
- **THEN** each app renders its portable UI through the same generic host
- **AND** each starts the native runtime-owned AudioWorklet from the single catalog selection gesture
- **AND** persistence remains isolated by publisher and app identity

#### Scenario: Deployment artifacts remain host-appropriate
- **WHEN** Cloudflare launcher and GitHub Pages publisher artifacts are assembled
- **THEN** both contain the same complete catalog and immutable app packages
- **AND** only the Cloudflare artifact contains the launcher, runtime modules, rollback content, and response-header policy

