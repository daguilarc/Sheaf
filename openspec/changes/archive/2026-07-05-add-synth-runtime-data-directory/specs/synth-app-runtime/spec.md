# synth-app-runtime Delta

Project: `projects/synth`. ID prefix: `sar`.

## MODIFIED Requirements

### Requirement: sar-2 — Configuration: runtime config supplied by the application
WHEN a synth application is defined, THE application SHALL supply a JUCE-free `RuntimeConfig` value declaring at minimum the application name, audio input count, audio output count, preferred sample rate, preferred block size, and UI shell dimensions/frame rate; THE application SHALL NOT declare production patch roots, log roots, or persistent MIDI/audio device preferences through `RuntimeConfig`; THE runtime SHALL treat audio fields as a request, negotiate actual values with the audio device, and report the negotiated sample rate and block size to the application before audio processing starts.

#### Scenario: Config drives device request
- **WHEN** the runtime starts an application whose config requests 0 inputs, 2 outputs, and 48000 Hz
- **THEN** the runtime requests those settings when opening the audio device

#### Scenario: Negotiated values reported to the application
- **WHEN** the audio device opens with a sample rate or block size different from the preferred values
- **THEN** the application receives the actual negotiated sample rate and block size through its prepare hook before its first `ProcessBlock` call

#### Scenario: Application config does not own persistence paths
- **WHEN** an application returns its `RuntimeConfig`
- **THEN** the config contains no production patch-root or log-root fields
- **AND** the runtime resolves those paths from runtime-owned data paths instead

### Requirement: sar-8 — Patches: runtime startup load and command orchestration
WHEN the runtime starts, THE runtime SHALL attempt to load the most recent patch under the runtime-owned patches root, selected deterministically by the library's sortable version-file naming — the patch directory containing the lexicographically greatest version filename, ties broken by directory name — and SHALL fall back silently to the application's initialized defaults when none exists; WHILE running, THE runtime SHALL expose new/save/save-as/load/revert patch commands through the patch manager, write and read version files only through library persistence helpers, and patch load/revert/new commands SHALL mutate synthesizer patch data only, not MIDI instrument configuration or audio device configuration.

#### Scenario: Startup loads the latest patch
- **WHEN** the runtime starts and the runtime-owned patches root contains saved patch directories
- **THEN** the parameter values from the version file with the lexicographically greatest name across patch directories are applied before audio starts
- **AND** MIDI instrument configuration and audio device configuration are not read from the patch

#### Scenario: Startup selection is deterministic under ties
- **WHEN** two patch directories contain version files with identical names
- **THEN** the directory with the lexicographically greater name is selected

#### Scenario: Missing startup patch keeps defaults
- **WHEN** the runtime starts with an empty patches root
- **THEN** the application's `Init` defaults remain in effect and no persistence failure is reported

#### Scenario: Load preserves runtime configuration
- **WHEN** a patch load message is consumed at runtime
- **THEN** the runtime applies saved parameter values from the patch
- **AND** keeps the current MIDI instrument configuration and audio device selection unchanged

### Requirement: sar-15 — Audio: device selection and patch persistence
WHEN the runtime presents configuration UI, THE runtime SHALL provide audio device selection through the library Audio page (sru-3) (output device, and input device when the application requests inputs) instead of always using the system default; the selection SHALL be held as a JUCE-free audio device state (empty meaning system default) that persists in the runtime configuration document and round-trips through configuration save and load like the MIDI instrument state; WHEN a loaded startup configuration names an audio device, THE runtime SHALL switch to that device when it is present (preparing the engine with the negotiated values) and SHALL keep the current/default device with a visible status, not a startup failure, when it is absent.

#### Scenario: User selects a non-default interface
- **WHEN** the user picks an audio output device from the Audio page
- **THEN** the audio device manager switches to that device on the message thread
- **AND** the engine is re-prepared with the device's actual sample rate and block size

#### Scenario: Device selection round-trips through configuration
- **WHEN** runtime configuration saved with a named output device is loaded while that device is present
- **THEN** the runtime switches to the named device during startup

#### Scenario: Patch load does not switch audio device
- **WHEN** a patch is loaded after the user has selected an audio device
- **THEN** the current audio device selection remains unchanged by the patch load

#### Scenario: Absent device degrades gracefully
- **WHEN** loaded runtime configuration names an audio device that is not currently present
- **THEN** the current/default device keeps running and the status reports the missing device
- **AND** startup itself succeeds

## ADDED Requirements

### Requirement: sar-17 — Data paths: runtime-owned persistent app data
WHEN a runtime-hosted synth application starts, THE runtime SHALL resolve a persistent app data root owned by the runtime host, create or use `patches/` and `logs/` subdirectories under that root, expose the resolved paths to the engine and runtime pages as immutable runtime data paths, and use an OS-appropriate long-lived user application data location for production runs rather than a temporary directory.

#### Scenario: Production data root is long-lived
- **WHEN** the JUCE runtime starts the miniapp in production mode
- **THEN** its data root is under the user's application data area for Sheaf and the app name
- **AND** the root is not under the system temporary directory or the build tree

#### Scenario: Runtime creates standard subdirectories
- **WHEN** the runtime resolves data paths for an app
- **THEN** `patches/` and `logs/` exist or are created under the data root
- **AND** the File page and patch manager use `patches/` as the only production patch root
- **AND** the async logger uses `logs/` as the production log root

#### Scenario: Tests can inject scratch paths
- **WHEN** a headless rig or unit test constructs a runtime/engine host with explicit data paths
- **THEN** the host uses those scratch paths instead of the production OS data directory

### Requirement: sar-18 — Configuration: runtime startup load and save ownership
WHEN the runtime starts, THE runtime SHALL initialize the application-defined synth topology first, then load the runtime configuration document from the runtime-owned data root if it exists, applying MIDI instrument/controller configuration and audio device selection before MIDI processors are built, controller reconciliation starts, or the audio device is opened; WHEN the runtime is asked to save configuration, THE runtime SHALL write the current MIDI instrument/controller configuration and audio device selection to that document without writing synthesizer patch data.

#### Scenario: Missing configuration keeps app defaults
- **WHEN** the runtime starts and no runtime configuration document exists
- **THEN** the MIDI instrument and audio device state established by application initialization and system defaults remain active
- **AND** startup continues without reporting a persistence failure

#### Scenario: Configuration loads before controller reconciliation
- **WHEN** the runtime configuration document contains a MIDI instrument with controller endpoint references
- **THEN** MIDI processors are built from that loaded instrument
- **AND** startup controller reconciliation uses the loaded endpoint references

#### Scenario: Configuration save excludes patch state
- **WHEN** runtime configuration is saved after Audio or Controllers page edits
- **THEN** the saved document contains MIDI instrument/controller configuration and audio device state
- **AND** it does not contain patch parameter values or patch identity
