## ADDED Requirements

### Requirement: sar-19 — Apps: manifest metadata and registry
WHEN synth applications are made available to the Sheaf Patch launcher, THE synth application runtime SHALL provide a JUCE-free app registration contract that binds a concrete app type to manifest metadata containing a stable app id, display name, author, category, and hardware requirements including minimum encoder count.

#### Scenario: Miniapp has launcher metadata
- **WHEN** the app registry is built for the Sheaf Patch launcher
- **THEN** it contains the miniapp registration
- **AND** that registration declares category `test`
- **AND** it declares a minimum encoder count in its hardware requirements

#### Scenario: Metadata is separate from runtime config
- **WHEN** a registered app's runtime configuration is requested
- **THEN** device configuration fields still come from `RuntimeConfig`
- **AND** launcher display fields and hardware requirements come from the app manifest metadata

#### Scenario: App id is path-safe
- **WHEN** an app is registered
- **THEN** its stable app id is valid for use as one path segment below the Sheaf Patch patches directory
- **AND** the runtime rejects or fails to compile registrations whose app id is empty

### Requirement: sar-20 — Apps: typed launch binding
WHEN a launcher-visible app is registered, THE synth application runtime SHALL provide a typed launch binding that constructs the selected app's runtime, applies caller-supplied runtime data paths, and starts the runtime without requiring the launcher to know app-specific initialization, audio, MIDI, patch, or UI internals.

#### Scenario: Launcher launches through registration
- **WHEN** the user selects a registered app from the Sheaf Patch launcher
- **THEN** the launcher invokes that registration's launch binding
- **AND** the binding constructs and starts the runtime for the registered app type

#### Scenario: Launcher stays thin
- **WHEN** the Sheaf Patch launcher source is inspected
- **THEN** it contains app list and selection code
- **AND** it does not construct parameter managers, patch managers, MIDI processors, audio devices, app module graphs, or app-specific UI widgets directly

#### Scenario: Missing app contract is caught at build time
- **WHEN** a registration is attempted for a type that does not satisfy the synth application concept
- **THEN** compilation fails with a diagnostic naming the unmet app contract

### Requirement: sar-21 — Product: Sheaf Patch superapp executable
WHEN the Sheaf Patch product is built, THE repository SHALL provide a top-level `sheaf-patch` synth executable that opens to the launcher instead of immediately starting a specific synth app, and that can launch the registered miniapp as its first contained app.

#### Scenario: Superapp starts at launcher
- **WHEN** the `sheaf-patch` executable starts
- **THEN** the first visible screen is the launcher app list
- **AND** no synth app runtime has started until the user selects an app

#### Scenario: Miniapp remains launchable
- **WHEN** the user selects the miniapp in the `sheaf-patch` launcher
- **THEN** the miniapp runtime starts through the same runtime lifecycle used by standalone runtime-hosted apps

#### Scenario: Standalone miniapp target remains available
- **WHEN** the existing miniapp build target is built
- **THEN** it continues to produce a standalone runtime-hosted miniapp unless a later change explicitly removes that target
