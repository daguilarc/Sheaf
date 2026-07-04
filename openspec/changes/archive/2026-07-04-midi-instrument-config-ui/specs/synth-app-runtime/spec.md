# synth-app-runtime Delta

Project: `projects/synth`. ID prefix: `sar`.

## MODIFIED Requirements

### Requirement: sar-3 — Context: application access to managers and configuration
WHEN the runtime initializes an application, THE runtime SHALL pass a pointer to an `AppContext` holding non-owning, address-stable pointers to the parameter manager, patch manager, UI message input bus, MIDI message input bus, parameter message output bus, patch message input and output buses, MIDI sender, live and default MIDI instrument configurations, the runtime configuration, and the host's shared monotonic timestamp provider (so application UI code timestamps messages from the same clock as the engine); the context's UI-state pointer SHALL be null during `Init` and SHALL be populated before MIDI processors, audio, or UI processing begin; all pointees SHALL remain valid for the application's lifetime.

#### Scenario: Context grants manager access during Init
- **WHEN** the application's `Init(AppContext*)` runs
- **THEN** the application can create groups, register modules and parameters, and configure pages and banks through the context's parameter manager pointer

#### Scenario: Context pointers remain stable
- **WHEN** the application stores the context pointer during `Init` and dereferences a member from a hook permitted to touch that member under the sar-7 threading contract
- **THEN** every pointer refers to the same live object the runtime constructed
- **AND** the context documentation names the thread role permitted to use each member

#### Scenario: UI state populated after topology lock
- **WHEN** application initialization completes and the runtime creates the manager UI state
- **THEN** the context's UI-state pointer is set before the first MIDI processor rebuild, audio callback, or UI frame

#### Scenario: Application seeds a default instrument
- **WHEN** the application's `Init` populates the live MIDI instrument configuration through the context
- **THEN** the runtime snapshots it as the default instrument restored by revert/new

### Requirement: sar-5 — Lifecycle: construction, init ordering, and shutdown
WHEN the runtime starts, THE runtime SHALL construct the framework objects and application, then perform in order: application `Init(AppContext*)`; capture of default control state; creation and publication of the manager UI state; MIDI processor construction from the live instrument configuration; startup patch application, including the same per-controller MIDI-processor rebuild that runtime patch loads trigger when the loaded patch changes the instrument; startup connection of mapped controllers only after any such rebuild; start of the IO poll thread only after startup controller connection; audio device opening and invocation of the application prepare hook with the negotiated values; and only then registration of the audio callback and start of UI/message-thread timers. WHEN the runtime shuts down, THE runtime SHALL stop the audio callback before destroying the application, stop and join the IO poll thread before closing MIDI devices, stop and join the MIDI sender worker, and close open MIDI devices.

#### Scenario: Init precedes UI state and patch load
- **WHEN** the runtime starts an application
- **THEN** all parameter/module/page/bank registration performed by `Init` completes before the manager UI state is created
- **AND** the startup patch is applied after default control state capture

#### Scenario: Audio starts last
- **WHEN** the runtime finishes startup
- **THEN** the first audio callback runs only after init, UI-state creation, MIDI processor construction, and startup patch application have completed

#### Scenario: Patched instrument installed before controllers connect
- **WHEN** the startup patch carries a MIDI instrument configuration different from the application default
- **THEN** MIDI processors are rebuilt from the patched instrument before mapped controllers are connected

#### Scenario: Poll thread starts after initial connect
- **WHEN** the runtime finishes startup controller connection
- **THEN** the IO poll thread starts, and it did not run before that point

#### Scenario: Clean shutdown ordering
- **WHEN** the runtime shuts down
- **THEN** the audio callback is deregistered before the application and managers are destroyed
- **AND** the IO poll thread is stopped and joined before MIDI devices are closed
- **AND** the MIDI sender worker thread is stopped and joined
- **AND** open MIDI input and output devices are closed

### Requirement: sar-8 — Patches: runtime startup load and command orchestration
WHEN the runtime starts, THE runtime SHALL attempt to load the most recent patch under the configured patches root, selected deterministically by the library's sortable version-file naming — the patch directory containing the lexicographically greatest version filename, ties broken by directory name — and SHALL fall back silently to the application's initialized defaults when none exists; WHILE running, THE runtime SHALL expose new/save/save-as/load/revert patch commands through the patch manager, write and read version files only through library persistence helpers, and after consuming a patch load SHALL rebuild MIDI processors from the loaded instrument configuration and reconcile mapped controller connections.

#### Scenario: Startup loads the latest patch
- **WHEN** the runtime starts and the patches root contains saved patch directories
- **THEN** the parameter values and MIDI instrument configuration from the version file with the lexicographically greatest name across patch directories are applied before audio starts

#### Scenario: Startup selection is deterministic under ties
- **WHEN** two patch directories contain version files with identical names
- **THEN** the directory with the lexicographically greater name is selected

#### Scenario: Missing startup patch keeps defaults
- **WHEN** the runtime starts with an empty patches root
- **THEN** the application's `Init` defaults remain in effect and no persistence failure is reported

#### Scenario: Load rebuilds MIDI wiring
- **WHEN** a patch load message is consumed at runtime
- **THEN** the runtime rebuilds MIDI processors from the loaded instrument configuration
- **AND** reconciles controller connections so mapped controllers with present devices are (re)connected and absent ones are marked offline

### Requirement: sar-9 — MIDI: runtime device and instrument management
WHEN an application runs under the runtime, THE runtime SHALL own the MIDI sender lifecycle, per-controller MIDI device enumeration, open/close, and reconciliation handling (including the IO poll thread and message-thread reconciliation of smi-4), and construction of MIDI input/output processors for every controller in the live instrument configuration via the library profile factory, registering them against the MIDI message input bus and the manager UI state; applications SHALL NOT construct MIDI device handlers or processor chains directly.

#### Scenario: Profile factory wires processors per controller
- **WHEN** the runtime builds MIDI processors
- **THEN** each controller slot's processors are created through the library controller-profile factory from that slot's profile config
- **AND** registered against the MIDI input bus and the manager UI state

#### Scenario: Application stays free of device glue
- **WHEN** the miniapp application is inspected
- **THEN** it contains no MIDI device enumeration, open/close, reconciliation, or processor construction code

### Requirement: sar-10 — UI: runtime shell hosting an application component
WHEN the runtime presents UI, THE runtime SHALL own the JUCE application object, main window, and a shell that hosts the library main pane (sru-1): the sidebar with Audio/Controllers/File pages and deadline readout, and the component returned by the application's UI hook as the default content; THE runtime SHALL drive sidebar and application repaint from manager UI-state atomics on a message-thread timer at the configured frame rate; an entry-point macro SHALL let an application define its executable by naming only its application type.

#### Scenario: Shell hosts the application component
- **WHEN** the runtime window opens
- **THEN** the application's component is displayed as the main pane content beside the sidebar
- **AND** no patch or MIDI chrome row sits above it

#### Scenario: Repaint reads UI-state atomics
- **WHEN** the UI timer fires
- **THEN** sidebar and application widgets render from the published manager UI state without touching the parameter manager directly

#### Scenario: One-line application entry point
- **WHEN** an application translation unit invokes the runtime entry-point macro with its application type
- **THEN** the build produces a runnable JUCE application hosting that application

### Requirement: sar-15 — Audio: device selection and patch persistence
WHEN the runtime presents configuration UI, THE runtime SHALL provide audio device selection through the library Audio page (sru-3) (output device, and input device when the application requests inputs) instead of always using the system default; the selection SHALL be held as a JUCE-free audio device state (empty meaning system default) that persists in the patch document and round-trips through save and load like the MIDI instrument state, with the engine snapshotting the post-`Init` state as the default restored by revert/new; WHEN a loaded or startup patch names an audio device, THE runtime SHALL switch to that device when it is present (re-preparing the engine with the new negotiated values) and SHALL keep the current device with a visible status, not a failure, when it is absent.

#### Scenario: User selects a non-default interface
- **WHEN** the user picks an audio output device from the Audio page
- **THEN** the audio device manager switches to that device on the message thread
- **AND** the engine is re-prepared with the device's actual sample rate and block size

#### Scenario: Device selection round-trips through a patch
- **WHEN** a patch saved with a named output device is loaded while that device is present
- **THEN** the runtime switches to the named device after applying the patch

#### Scenario: Absent device degrades gracefully
- **WHEN** a loaded patch names an audio device that is not currently present
- **THEN** the current device keeps running and the status reports the missing device
- **AND** the load itself succeeds

### Requirement: sar-16 — Patches: message-side identity and save fallback
WHEN the runtime tracks which patch is current, THE current patch identity (directory, name, and pending-save state) SHALL be owned by message-thread components (the patch manager and runtime shell) and SHALL NOT be cached on the audio side; THE library File page (sru-6) SHALL display the current patch name and command status, updating as commands complete; WHEN the user invokes Save while no current patch directory exists, THE File page SHALL fall through to the Save As flow rather than surfacing a needs-path failure.

#### Scenario: File page shows the current patch
- **WHEN** a patch is saved as or loaded from a directory
- **THEN** the File page displays that patch's name

#### Scenario: First save falls through to Save As
- **WHEN** the user presses Save before any patch directory exists
- **THEN** the Save As chooser opens instead of a needs-path error
- **AND** completing it writes the first version file and sets the current patch
