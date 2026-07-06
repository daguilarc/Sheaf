## ADDED Requirements

### Requirement: spp-10 — Runtime data: Sheaf Patch launch configuration and app patch roots
WHEN a synth app is launched from the Sheaf Patch superapp, THE synth persistence system SHALL use the shared Sheaf Patch launch configuration path `<sheaf-user-data-root>/synth/sheaf-patch/config` as a JSON configuration file for MIDI/audio configuration and SHALL use `<sheaf-user-data-root>/synth/sheaf-patch/patches/<stable-app-id>` as the runtime-owned patches root for that selected app, where `<stable-app-id>` is the manifest app id from sar-19 and `<sheaf-user-data-root>` is the stable host user application data root used by standalone synth apps; standalone apps launched outside Sheaf Patch SHALL keep their existing default runtime data path behavior.

#### Scenario: Shared config path
- **WHEN** the miniapp is launched from Sheaf Patch and runtime configuration is saved
- **THEN** the configuration document is written to `<sheaf-user-data-root>/synth/sheaf-patch/config`
- **AND** the document contains runtime configuration only, not patch parameter values

#### Scenario: Per-app patch root
- **WHEN** the miniapp is launched from Sheaf Patch and a patch is saved-as
- **THEN** the patch directory is created below `<sheaf-user-data-root>/synth/sheaf-patch/patches/miniapp`
- **AND** no patch version file is written directly under another app's patch root

#### Scenario: Startup loads only selected app patches
- **WHEN** a selected app starts from Sheaf Patch
- **THEN** startup patch discovery searches only that app's `<sheaf-user-data-root>/synth/sheaf-patch/patches/<stable-app-id>` root
- **AND** patches saved for other registered apps are ignored

#### Scenario: Runtime data paths can split config and patches
- **WHEN** the runtime is supplied Sheaf Patch data paths
- **THEN** it accepts a config path and patches root that are not both derived from the selected app's display name
- **AND** patch lifecycle operations continue to use the supplied patches root

#### Scenario: Sheaf Patch logs root is supplied
- **WHEN** the runtime is supplied Sheaf Patch data paths
- **THEN** the supplied paths include a logs root at `<sheaf-user-data-root>/synth/sheaf-patch/logs`
- **AND** runtime startup uses that log root for apps launched by Sheaf Patch

#### Scenario: Standalone app paths are unchanged
- **WHEN** the miniapp is launched through its standalone executable rather than through Sheaf Patch
- **THEN** runtime configuration and patches continue to use the standalone app's default runtime data paths
- **AND** the standalone launch does not write configuration to `<sheaf-user-data-root>/synth/sheaf-patch/config`
