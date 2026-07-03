# synth-midi-instrument Specification

Project: `projects/synth`. ID prefix: `smi`.

## Purpose

Define the MIDI instrument configuration model: the ordered controller
name → profile mapping (kinds, endpoint references, kind validity), its
JSON persistence, the pure reconciliation planner, the IO poll thread and
message-thread reconciliation for self-healing USB reconnect, startup
connection, per-controller sender routing, and live-edit rebuild
semantics.

## Requirements
### Requirement: smi-1 — Model: instrument configuration
WHEN MIDI controller configuration is stored or edited, THE synth system SHALL represent it as a JUCE-free instrument configuration: an ordered collection of controller slots, each holding a unique controller name, a profile kind (`wrldbldr`, `twister`, `launchpad`, `generic`), a controller profile config (the encoder, analog, and system-message association config defined by spm-44), and best-effort preferred input and output endpoint references, each an identifier plus device-name pair (empty meaning unconfigured); the instrument configuration SHALL contain no connection state; each kind SHALL declare which config sections it supports (wrldbldr: encoders, system messages, analogs; twister: encoders, system messages; launchpad: system messages only; generic: all sections) and which system-message address/feedback variants it supports (wrldbldr: channel/CC addresses and WRLD.Bldr feedback positions; twister: channel/CC addresses only; launchpad: Launchpad positions only; generic: channel/CC addresses only); a slot whose profile config populates a section its kind does not support, or whose system-message associations carry a kind-unsupported address or feedback variant, SHALL be invalid.

#### Scenario: Controller names are unique
- **WHEN** a controller is added to an instrument configuration with a name that already exists in the collection
- **THEN** the add is rejected and the configuration is unchanged

#### Scenario: Kind reports supported sections
- **WHEN** code queries the section support of a `launchpad` controller slot
- **THEN** encoders and analogs are reported unsupported and system messages supported

#### Scenario: Kind constrains config sections
- **WHEN** a `launchpad` slot is given a profile config containing encoder mappings
- **THEN** the slot is reported invalid and cannot be committed to an instrument configuration

#### Scenario: Kind constrains system-message address variants
- **WHEN** a `launchpad` slot's system-message association carries a WRLD.Bldr feedback position, or a `twister` slot's association carries a Launchpad position
- **THEN** the slot is reported invalid and cannot be committed to an instrument configuration

#### Scenario: Configuration is connection-independent
- **WHEN** an instrument configuration is inspected after its devices are unplugged
- **THEN** the stored slots, kinds, profile configs, and endpoint identifiers are unchanged

#### Scenario: Ordered slots preserve UI order
- **WHEN** controllers are added in a given order and the configuration is saved and reloaded
- **THEN** iteration yields the controllers in the same order

### Requirement: smi-2 — Persistence: instrument JSON
WHEN an instrument configuration is serialized, THE synth system SHALL write a JSON object with a schema identifier, schema version, and a `controllers` array whose entries carry the controller name, kind, preferred input and output endpoint references (identifier and device-name pairs), and the controller's profile config serialized with the existing spm-52 profile-config JSON helpers; loading SHALL reject unknown kinds, duplicate names, and slots invalid under the smi-1 kind rules (unsupported sections or kind-unsupported system-message address/feedback variants), in every case without mutating the target configuration; the instrument section SHALL replace the previous single `midiProfile` and separate endpoint-state sections with no legacy-format support.

#### Scenario: Instrument round-trips through JSON
- **WHEN** an instrument with a wrldbldr, a twister, and two launchpad controllers is serialized and reloaded
- **THEN** every slot's name, kind, endpoint identifier and device-name pairs, and profile config round-trip losslessly in order

#### Scenario: Unknown kind rejects load
- **WHEN** instrument JSON contains a controller entry with kind `"theremin"`
- **THEN** the load fails and the target configuration is unchanged

#### Scenario: Duplicate name rejects load
- **WHEN** instrument JSON contains two controller entries named `"pad"`
- **THEN** the load fails and the target configuration is unchanged

#### Scenario: Unsupported section rejects load
- **WHEN** instrument JSON contains a `launchpad` controller entry whose profile config carries encoder mappings
- **THEN** the load fails and the target configuration is unchanged

#### Scenario: Kind-incompatible address variant rejects load
- **WHEN** instrument JSON contains a `launchpad` controller entry whose system-message association carries a WRLD.Bldr position
- **THEN** the load fails and the target configuration is unchanged

#### Scenario: Legacy single-profile document is invalid
- **WHEN** a patch document contains the old `midiProfile` section and no `midiInstrument` section
- **THEN** the patch load fails validation (spp-2) rather than silently loading without an instrument

### Requirement: smi-3 — Reconciliation: pure planning function
WHEN controller connections must be reconciled with the present device list, THE synth system SHALL provide a JUCE-free planning function that takes the instrument configuration, the present MIDI device lists (identifier and name pairs for inputs and outputs), and the current per-controller, per-endpoint connection state (status `online`, `offline`, or `unconfigured`, plus the open identifier when online), and returns a deterministic action plan (open input, open output, close input, close output, mark endpoint offline/online, update a slot's stored endpoint reference, resync) such that: endpoint matching prefers exact identifier match against the stored endpoint reference and falls back to matching the stored device name; one present physical device is assigned to at most one controller slot per plan (deterministically by slot order); an endpoint whose stored reference is empty is treated as unconfigured and produces no open or offline action; endpoints whose referenced devices are absent are marked offline rather than guessed; a name-fallback match includes an update action that rewrites the slot's stored endpoint reference to the matched device's identifier and name; and every plan that newly opens a controller's output endpoint includes a resync action for that controller.

#### Scenario: Identifier match reconnects
- **WHEN** a controller's stored output identifier appears in the present device list and the controller output is closed
- **THEN** the plan opens that output for the controller and includes a resync action

#### Scenario: Name fallback after identifier change
- **WHEN** a controller's stored identifier is absent but a present device's name equals the stored endpoint device name
- **THEN** the plan opens that device for the controller
- **AND** includes an update action rewriting the slot's stored endpoint reference to the matched device's identifier and name

#### Scenario: One device never serves two slots
- **WHEN** two controller slots both match the single present device
- **THEN** the plan assigns the device to exactly one slot chosen deterministically by slot order
- **AND** marks the other slot's endpoint offline

#### Scenario: Vanished device closes and marks offline
- **WHEN** a controller's open device is missing from the present device list
- **THEN** the plan closes that endpoint and marks it offline

#### Scenario: Unconfigured endpoint is inert
- **WHEN** a controller slot's input endpoint reference is empty
- **THEN** the plan produces no open, close, or offline action for that endpoint
- **AND** the endpoint is reported as unconfigured rather than offline

#### Scenario: Input-only reconnect does not resync output
- **WHEN** a plan reopens only a controller's input endpoint while its output remains open throughout
- **THEN** the plan contains no resync action for that controller

#### Scenario: Converged state yields empty plan
- **WHEN** the planner runs on a state where every controller is already correctly connected, unconfigured, or offline with no matching device present
- **THEN** the returned plan contains no actions

### Requirement: smi-4 — Polling: IO poll thread and message-thread reconciliation
WHILE the runtime is running, THE runtime SHALL run an IO poll thread with its own `ThreadId` that every 5 seconds checks the USB MIDI device list, compares it against the previous poll snapshot, and alerts the message thread when the list changed; the poll thread SHALL NOT open or close devices or mutate engine state; WHEN alerted, THE message thread SHALL re-enumerate devices, run the reconciliation planner, and execute the resulting plan (reconnects, offline marking, resyncs); the poll thread SHALL start only after startup controller connection completes and SHALL be stopped and joined before MIDI devices are closed at shutdown.

#### Scenario: Device change triggers reconciliation
- **WHEN** the poll thread observes a device list different from its previous snapshot
- **THEN** the message thread re-enumerates the devices and executes a reconciliation plan on its next processing opportunity

#### Scenario: Unchanged list does no message-thread work
- **WHEN** consecutive polls observe identical device lists
- **THEN** no reconciliation work is scheduled on the message thread

#### Scenario: Poll thread never touches devices
- **WHEN** the poll thread code is inspected
- **THEN** it performs enumeration and comparison only, with no open/close calls and no engine state mutation

#### Scenario: Clean shutdown ordering
- **WHEN** the runtime shuts down
- **THEN** the IO poll thread is stopped and joined before open MIDI devices are closed

### Requirement: smi-5 — Reconnect: resync and safe input swap
WHEN a controller's output endpoint is (re)opened by reconciliation, THE runtime SHALL clear that controller's output feedback caches (debounce state) and force a full feedback resend so the hardware resynchronizes; WHEN a controller's input endpoint is (re)opened, THE runtime SHALL install the controller's input forwarding through the existing rebuild-safe swap so no MIDI callback observes a dangling processor; controllers not involved in the reconnect SHALL be unaffected.

#### Scenario: Reconnected controller resyncs feedback
- **WHEN** a controller's output device reopens after an absence
- **THEN** the next output processing pass resends value, color, and brightness feedback for every mapped position regardless of cached last-sent state

#### Scenario: Input flows after reconnect
- **WHEN** a controller's input device reopens and the hardware sends a mapped encoder turn
- **THEN** the message reaches the MIDI input bus through the rebuilt forwarding processor

#### Scenario: Unrelated controllers keep state
- **WHEN** one controller reconnects while another remains connected
- **THEN** the connected controller's caches are not cleared and its devices are not reopened

### Requirement: smi-6 — Startup: connect mapped controllers
WHEN the runtime starts, THE runtime SHALL attempt to connect every controller in the instrument configuration after MIDI processors are built, marking controllers whose devices are absent as offline without failing startup or blocking audio.

#### Scenario: Attached controller connects at startup
- **WHEN** the runtime starts and a mapped controller's device is present
- **THEN** that controller's input and output endpoints are open before the poll thread starts

#### Scenario: Absent controller starts offline
- **WHEN** the runtime starts and a mapped controller's device is not present
- **THEN** the controller is marked offline, startup completes, and audio runs

#### Scenario: Later attach self-heals
- **WHEN** an offline controller's device is plugged in after startup
- **THEN** a subsequent poll cycle reconnects it and resyncs its feedback without user action

### Requirement: smi-7 — Sender: per-controller output routing
WHEN multiple controllers produce MIDI output, THE MidiSender SHALL keep a single worker thread and route each enqueued message to a per-controller sink registered by controller slot; enqueueing for a controller with no registered or open sink SHALL drop the message without blocking or affecting other controllers.

#### Scenario: Messages route to the owning controller
- **WHEN** output processors for two controllers enqueue feedback messages
- **THEN** each message is delivered to its own controller's output device sink

#### Scenario: Offline sink drops safely
- **WHEN** a message is enqueued for a controller whose output is offline
- **THEN** the message is dropped, the worker thread continues, and other controllers' messages are delivered

### Requirement: smi-8 — Live edits: config changes rebuild processors
WHEN the instrument configuration is edited through the configuration UI, THE message thread SHALL apply the committed edit to the engine's live instrument configuration in a way that cannot race the audio thread's patch-message application (the sar-7 block-boundary patch drain remains the only audio-side writer, and UI-edit application SHALL be serialized against it), and SHALL then rebuild the affected controller's MIDI processors and reconcile connections; WHEN a patch load changes the instrument configuration, THE existing patch message flow SHALL apply it (patch input bus drained per sar-7) followed by the same message-thread rebuild and reconciliation, so both paths converge on one rebuild path and edits take effect without restart.

#### Scenario: Mapping edit takes effect
- **WHEN** the user changes an encoder mapping's target slot position and commits the edit
- **THEN** the next matching hardware CC drives the newly mapped position

#### Scenario: UI edits and patch loads share the rebuild path
- **WHEN** an instrument change arrives from the configuration UI and another from a patch load
- **THEN** both trigger the same per-controller processor rebuild and reconciliation code path

#### Scenario: Edits do not race the audio thread
- **WHEN** a UI instrument edit commits while a patch load message is pending on the patch input bus
- **THEN** the live instrument configuration observes the two applications in a serialized order with no concurrent mutation

#### Scenario: Added controller becomes live
- **WHEN** the user adds a controller with a kind default profile and its device is present
- **THEN** reconciliation connects it and its processors are active without restart
