## ADDED Requirements

### Requirement: sar-22 — Apps: type-erased ownership of typed runtime sessions
WHEN Sheaf Patch launches any registered synth application, THE synth runtime SHALL construct the application's typed `RuntimeShellSession<App>` behind a minimal type-erased session-owner interface that preserves component access, deterministic destruction, and the existing runtime shutdown order, so the Sheaf Patch application object does not need an app-specific runtime-session field or launch method for each registered app type.

#### Scenario: Existing MiniApp uses generic session ownership
- **WHEN** the user launches MiniApp from Sheaf Patch
- **THEN** the generic session owner contains a `RuntimeShellSession<MiniApp>`
- **AND** Sheaf Patch displays its component through the type-erased interface

#### Scenario: A second app needs no launcher-specific runtime member
- **WHEN** Braid 4 is registered
- **THEN** the Sheaf Patch application object still owns exactly one generic active-session pointer
- **AND** it declares no `RuntimeShellSession<Braid4>` member or Braid-specific launch method

#### Scenario: Replacing or destroying a session preserves lifecycle
- **WHEN** the active session owner is destroyed during application shutdown
- **THEN** the contained typed runtime session performs the same audio, MIDI, timer, and application shutdown ordering as a directly owned session

### Requirement: sar-23 — Apps: Braid 4 Sheaf Patch registration
WHEN the Sheaf Patch registry is built, THE synth application runtime SHALL include a typed Braid 4 registration with stable app id `braid-4`, display name `Braid 4`, author `Sheaf`, category `synth`, and advisory minimum encoder count `16`, and SHALL launch it with the shared Sheaf Patch configuration path plus app-specific `patches/braid-4` path without requiring a standalone Braid executable.

#### Scenario: Launcher metadata identifies Braid
- **WHEN** the Sheaf Patch launcher lists registered applications
- **THEN** one row contains id `braid-4`, display name `Braid 4`, author `Sheaf`, category `synth`, and minimum encoders `16`

#### Scenario: Braid launch uses typed binding
- **WHEN** the user activates the Braid 4 row
- **THEN** the registration constructs and starts the Braid 4 runtime through the generic session owner
- **AND** the launcher does not construct Braid parameters, modules, UI, audio, or MIDI internals

#### Scenario: Braid patches are isolated
- **WHEN** Braid 4 is launched from Sheaf Patch
- **THEN** runtime configuration uses the shared Sheaf Patch config file
- **AND** patch discovery and save/load use the `patches/braid-4` subtree

#### Scenario: Standalone target is not required
- **WHEN** the synth application targets are inspected or built
- **THEN** Sheaf Patch includes Braid 4
- **AND** no standalone Braid 4 `Main.cpp`, executable, or app-bundle target is required
