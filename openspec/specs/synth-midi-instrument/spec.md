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
WHEN MIDI controller configuration is stored or edited, THE synth system SHALL represent it as a JUCE-free instrument configuration: an ordered collection of controller slots, each holding a unique controller name, a profile kind (`wrldbldr`, `twister`, `launchpad`, `generic`), an Active or Blacklisted disposition, an optional stable controller-wizard id stored as an opaque non-empty string, best-effort preferred input and output endpoint references that each contain an identifier plus device-name pair (empty meaning unconfigured for an Active slot), and profile data as follows: an Active slot SHALL require a controller profile config (the encoder, analog, and system-message association config defined by spm-44), while a Blacklisted slot SHALL require both endpoint references and a non-empty wizard id, SHALL have no runtime-active profile, and SHALL carry either no dormant profile when created by Ignore or the prior Active profile retained as dormant reconfiguration seed data when changed from Active; the instrument configuration SHALL contain no connection state; unique names and ordered iteration SHALL span both dispositions; each kind SHALL declare which config sections it supports (wrldbldr: encoders, system messages, analogs; twister: encoders, system messages; launchpad: system messages only; generic: all sections) and which system-message address/feedback variants it supports (wrldbldr: channel/CC addresses and WRLD.Bldr feedback positions; twister: channel/CC addresses only; launchpad: Launchpad positions only; generic: channel/CC addresses only); an Active profile or dormant Blacklisted profile whose config populates a section its kind does not support, or whose system-message associations carry a kind-unsupported address or feedback variant, SHALL be invalid. Instrument-model validity SHALL NOT depend on whether the current baked wizard registry recognizes an opaque wizard id.

#### Scenario: Controller names are unique
- **WHEN** an Active or Blacklisted controller is added with a name already used by either disposition
- **THEN** the add is rejected and the configuration is unchanged

#### Scenario: Kind reports supported sections
- **WHEN** code queries the section support of an Active `launchpad` controller slot
- **THEN** encoders and analogs are reported unsupported and system messages supported

#### Scenario: Kind constrains active config sections
- **WHEN** an Active `launchpad` slot is given a profile config containing encoder mappings
- **THEN** the slot is reported invalid and cannot be committed

#### Scenario: Kind constrains active system-message address variants
- **WHEN** an Active `launchpad` slot's system-message association carries a WRLD.Bldr feedback position, or an Active `twister` slot's association carries a Launchpad position
- **THEN** the slot is reported invalid and cannot be committed

#### Scenario: Blacklisted record retains wizard identity
- **WHEN** a Twister pair is ignored before a profile is generated
- **THEN** its Blacklisted slot retains Twister kind, its non-empty wizard id, and both endpoint references
- **AND** it requires no dormant profile

#### Scenario: Active-to-Blacklisted retains dormant profile
- **WHEN** a wizard-associated Active slot is changed to Blacklisted
- **THEN** its complete prior profile is retained as dormant reconfiguration seed data
- **AND** that profile is never runtime-active while the disposition remains Blacklisted

#### Scenario: Configuration is connection-independent
- **WHEN** an instrument configuration is inspected after its devices are unplugged
- **THEN** stored slots, dispositions, kinds, wizard ids, active or dormant profile configs, and endpoint identifiers are unchanged

#### Scenario: Ordered slots preserve UI order
- **WHEN** Active and Blacklisted slots are added in a given order and the configuration is saved and reloaded
- **THEN** iteration yields every slot in the same order

### Requirement: smi-2 — Persistence: instrument JSON
WHEN an instrument configuration is serialized, THE synth system SHALL write a JSON object with a schema identifier, schema version, and a `controllers` array whose entries carry controller name, profile kind, Active or Blacklisted disposition, optional stable wizard id, and preferred input/output endpoint references (identifier and device-name pairs); Active entries SHALL carry the profile config serialized with the existing spm-52 helpers and SHALL allow the wizard id to be absent for manual or migrated records; Blacklisted entries SHALL carry a non-empty opaque wizard id and both endpoint references and SHALL allow the profile field to be absent only for an ignored candidate or to carry dormant seed data; loading SHALL reject unknown kinds, unknown dispositions, malformed or empty wizard-id values, duplicate names, Active entries without a valid kind-compatible profile, Blacklisted entries without a non-empty wizard id or both valid endpoint references, and active or dormant profiles invalid under the smi-1 kind rules (unsupported sections or kind-unsupported system-message address/feedback variants), in every case without mutating the target configuration; loading SHALL preserve an unknown but well-formed wizard id without consulting the baked registry; the reader SHALL accept the preceding instrument schema by treating every legacy entry as Active with no wizard id and requiring its existing profile exactly as before; the earlier single-`midiProfile` format remains unsupported.

#### Scenario: New instrument round-trips both dispositions
- **WHEN** an instrument containing Active and Blacklisted slots is serialized and reloaded
- **THEN** every name, kind, disposition, wizard id, endpoint reference, active or dormant profile, and ordered position round-trips losslessly

#### Scenario: Existing multi-kind coverage remains
- **WHEN** an instrument with a wrldbldr, a twister, and two launchpad Active controllers is serialized and reloaded
- **THEN** every slot's name, kind, endpoint identifier and device-name pairs, and profile config round-trip losslessly in order

#### Scenario: Previous instrument schema loads active without wizard identity
- **WHEN** a valid preceding-schema instrument document contains controller entries without disposition or wizard id
- **THEN** every entry loads as Active with its existing profile and endpoint references
- **AND** no wizard lifecycle action is inferred from kind alone

#### Scenario: Unknown kind rejects load
- **WHEN** instrument JSON contains a controller entry with kind `"theremin"`
- **THEN** the load fails and the target configuration is unchanged

#### Scenario: Unknown disposition rejects load
- **WHEN** instrument JSON contains disposition `"paused"`
- **THEN** the load fails and the target configuration is unchanged

#### Scenario: Unknown wizard id remains loadable and opaque
- **WHEN** instrument JSON contains an otherwise-valid Active or Blacklisted entry whose non-empty wizard id is not in the baked registry
- **THEN** the entry loads and its wizard id round-trips unchanged
- **AND** no wizard association is inferred by the instrument model

#### Scenario: Active record requires profile
- **WHEN** instrument JSON contains an Active entry without a profile or with a kind-incompatible profile
- **THEN** the load fails and the target configuration is unchanged

#### Scenario: Blacklisted ignored record can omit profile
- **WHEN** instrument JSON contains a Blacklisted entry with a non-empty wizard id, kind, and both endpoint identities but no profile
- **THEN** it loads as an inert ignored record

#### Scenario: Blacklisted dormant profile is validated
- **WHEN** instrument JSON contains a Blacklisted entry whose dormant profile violates its retained kind
- **THEN** the load fails and the target configuration is unchanged

#### Scenario: Duplicate name rejects load
- **WHEN** Active and Blacklisted entries use the same controller name
- **THEN** the load fails and the target configuration is unchanged

#### Scenario: Unsupported section rejects load
- **WHEN** instrument JSON contains an Active or dormant `launchpad` profile with encoder mappings
- **THEN** the load fails and the target configuration is unchanged

#### Scenario: Kind-incompatible address variant rejects load
- **WHEN** instrument JSON contains an Active or dormant `launchpad` profile whose system-message association carries a WRLD.Bldr position
- **THEN** the load fails and the target configuration is unchanged

#### Scenario: Legacy single-profile document loads with the section ignored
- **WHEN** a patch document contains the old single `midiProfile` section and no `midiInstrument` section
- **THEN** the patch load succeeds (spp-2) with the legacy section tolerated and not applied as patch state
- **AND** the current instrument configuration is unchanged

### Requirement: smi-3 — Reconciliation: pure planning function
WHEN controller connections must be reconciled with the present device list, THE synth system SHALL provide a JUCE-free planning function that takes the instrument configuration, present input/output device lists (identifier and name pairs), and current per-slot endpoint connection state (status `online`, `offline`, or `unconfigured`, plus the open identifier when online), and returns a deterministic action plan (open input, open output, close input, close output, mark endpoint offline/online/unconfigured, update a slot's stored endpoint reference, resync) such that: disposition is checked before every Active matching and status rule; Active slots retain identifier-first/name-fallback matching, deterministic exclusive claiming by slot order, unconfigured handling for empty refs, offline marking for absent referenced devices, stored-ref update after name fallback, and one resync whenever an output is newly opened; Blacklisted slots never claim, open, update, resync, or mark Offline a present or absent endpoint, never rewrite their deliberately stale stored references, and cause any endpoint still online from an earlier Active disposition to close and become `Unconfigured`. For a Blacklisted slot, `Unconfigured` SHALL mean deliberately inert even though both stored endpoint references remain populated.

#### Scenario: Active identifier match reconnects
- **WHEN** an Active slot's stored output identifier appears and its output is closed
- **THEN** the plan opens that output and includes a resync action

#### Scenario: Active name fallback updates reference
- **WHEN** an Active slot's stored identifier is absent but a present device name equals its stored endpoint name
- **THEN** the plan opens that device
- **AND** updates the stored reference to the matched identifier and name

#### Scenario: One active record claims a device
- **WHEN** two Active slots both match one present device
- **THEN** the plan assigns it to exactly one slot by deterministic slot order
- **AND** marks the other Active endpoint offline

#### Scenario: Vanished active device closes and marks offline
- **WHEN** an Active slot's open device is missing from the present device list
- **THEN** the plan closes that endpoint and marks it offline

#### Scenario: Blacklisted present pair stays closed
- **WHEN** both stored endpoints of a Blacklisted slot are present
- **THEN** the plan produces no claim, open, reference-update, or resync action for that slot
- **AND** its endpoint connection states remain Unconfigured and deliberately inert

#### Scenario: Blacklisted absent pair does not become offline
- **WHEN** a Blacklisted slot has populated endpoint references, neither device is present, and both connection states are Unconfigured
- **THEN** disposition handling precedes configured-reference absence handling
- **AND** the plan emits no MarkOffline action

#### Scenario: Blacklisting closes an online record
- **WHEN** an online Active slot is committed as Blacklisted
- **THEN** the next plan closes both online endpoints and marks them unconfigured
- **AND** registers no replacement output sink

#### Scenario: Half-configured active endpoint remains inert
- **WHEN** an Active slot's input endpoint reference is empty
- **THEN** the plan produces no open, close, or offline action for that endpoint
- **AND** the endpoint is reported as unconfigured

#### Scenario: Input-only reconnect does not resync output
- **WHEN** a plan reopens only an Active slot's input endpoint while its output remains open throughout
- **THEN** the plan contains no resync action for that slot

#### Scenario: Converged state yields empty plan
- **WHEN** every Active slot is correctly connected, unconfigured, or offline and every Blacklisted slot is inert
- **THEN** the returned plan contains no actions

### Requirement: smi-4 — Polling: IO poll thread and message-thread reconciliation
WHILE the runtime is running, THE runtime SHALL run an IO poll thread with its own `ThreadId` that every 5 seconds checks the USB MIDI device list, compares it against the previous poll snapshot, and alerts the message thread when the list changed; WHERE platform constraints prevent safe device enumeration off the message thread (e.g. macOS CoreMIDI asserts the message thread), THE poll thread SHALL instead alert the message thread every interval (degraded mode) and THE message thread SHALL perform the bounded device enumeration and comparison itself; the poll thread SHALL NOT open or close devices or mutate engine state; WHEN the message thread observes a changed device list, THE message thread SHALL run the reconciliation planner and execute the resulting plan (reconnects, offline marking, resyncs); WHEN the device list is unchanged from the previous message-thread pass, THE message thread SHALL NOT run reconciliation planning or plan execution; the poll thread SHALL start only after startup controller connection completes and SHALL be stopped and joined before MIDI devices are closed at shutdown.

#### Scenario: Device change triggers reconciliation
- **WHEN** the poll thread (or, in degraded mode, the message-thread comparison) observes a device list different from its previous snapshot
- **THEN** the message thread re-enumerates the devices and executes a reconciliation plan on its next processing opportunity

#### Scenario: Unchanged list does no reconciliation work
- **WHEN** consecutive polls observe identical device lists
- **THEN** no reconciliation planning or plan execution runs on the message thread
- **AND** in degraded mode the message thread's per-interval work is limited to the bounded enumeration and comparison

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
WHEN the runtime starts, THE runtime SHALL attempt to connect every Active controller slot after MIDI processors are built, SHALL skip every Blacklisted slot without opening either endpoint, and SHALL mark absent Active devices offline without failing startup or blocking audio.

#### Scenario: Attached active controller connects at startup
- **WHEN** the runtime starts and an Active mapped controller's device is present
- **THEN** that controller's input and output endpoints are open before the poll thread starts

#### Scenario: Blacklisted controller is skipped at startup
- **WHEN** the runtime starts with a Blacklisted slot whose devices are present
- **THEN** neither endpoint is opened
- **AND** startup and audio proceed normally

#### Scenario: Absent active controller starts offline
- **WHEN** the runtime starts and an Active mapped controller's device is not present
- **THEN** the controller is marked offline, startup completes, and audio runs

#### Scenario: Later active attach self-heals
- **WHEN** an offline Active controller's device is plugged in after startup
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
WHEN the instrument configuration is edited through the configuration UI, THE message thread SHALL apply the committed edit to the engine's live instrument configuration in a way that cannot race the audio thread's patch-message application (the sar-7 block-boundary patch drain remains the only audio-side writer, and UI-edit application SHALL be serialized against it), SHALL rebuild the affected controller's MIDI processor slot and reconcile connections through the existing shared path, SHALL construct Active processors from Active profiles, and SHALL construct only an explicit drop/no-op input processor with no terminal realtime processor, output processors, thru processors, or sender sink for a Blacklisted slot; WHEN a patch or runtime-configuration load changes the instrument configuration, the existing patch/configuration message flow SHALL apply it followed by the same message-thread rebuild and reconciliation, so UI edits and loads converge on one rebuild path; changing Active to Blacklisted or deleting an Active slot SHALL close affected endpoints, while generating or reconfiguring a slot as Active SHALL make its processors and endpoints live without restart.

#### Scenario: Mapping edit takes effect
- **WHEN** the user changes an Active encoder mapping's target slot position and commits
- **THEN** the next matching hardware CC drives the newly mapped position

#### Scenario: UI edits and configuration loads share the rebuild path
- **WHEN** an instrument change arrives from the configuration UI and another from a patch or runtime-configuration load
- **THEN** both trigger the same processor rebuild and reconciliation path

#### Scenario: Edits do not race the audio thread
- **WHEN** a UI instrument edit commits while a patch-load message is pending on the patch input bus
- **THEN** the live instrument configuration observes serialized application with no concurrent mutation

#### Scenario: Added active controller becomes live
- **WHEN** the wizard adds an Active controller with generated profile and present devices
- **THEN** reconciliation connects it and its processors are active without restart

#### Scenario: Blacklisted processor chain drops everything
- **WHEN** a Blacklisted slot's explicit drop input processor receives an ordinary, SysEx, or realtime MIDI message during or after a rebuild window
- **THEN** it emits no parameter, grid, clock, or transport message
- **AND** the slot has no terminal realtime, thru, output, or sender-sink route

#### Scenario: Reconfigure activates a blacklisted record
- **WHEN** a valid wizard profile replaces a Blacklisted slot and changes it to Active
- **THEN** the generated processors are installed
- **AND** reconciliation opens each stored endpoint present under the Active matching rules

### Requirement: smi-9 — Instrument config: note-addressed button validation

WHEN instrument configuration validates a controller profile, THE synth system SHALL permit CC or note addresses for encoder push mappings and for Generic
controller system-message control mappings, SHALL require encoder turns and
analog mappings to remain CC-addressed, and SHALL reject note addresses in
controller-specific system-message address schemes that do not declare note
support.

#### Scenario: Generic note buttons are valid

- **WHEN** a Generic controller profile contains a note-addressed encoder push and a note-addressed system-message control
- **THEN** instrument configuration validation accepts those mappings

#### Scenario: Note encoder turn is invalid

- **WHEN** a controller profile contains a note-addressed encoder turn mapping
- **THEN** instrument configuration validation rejects the profile

#### Scenario: Controller-specific note system address is invalid

- **WHEN** a WRLD.Bldr or MF Twister profile contains a note-addressed system-message control
- **THEN** instrument configuration validation rejects the profile

#### Scenario: Existing CC profiles remain valid

- **WHEN** an existing controller profile contains only CC addresses
- **THEN** instrument configuration validation preserves its prior validity

### Requirement: smi-10 — Realtime input: terminal clock and transport routing
WHEN the runtime builds a MIDI input chain for an Active controller slot, THE synth MIDI system SHALL append a terminal realtime processor after profile-specific encoder, analog, system-button, and pressure processors; the terminal SHALL convert supported one-byte Timing Clock, Start, Continue, and Stop messages into MIDI-bus `MessageIn` values carrying ExternalMidi origin, an unsigned integer-microsecond event timestamp normalized into Engine's host-local monotonic epoch at the callback/bridge boundary, and controller-slot identity, while non-realtime messages SHALL retain existing profile/thru behavior and realtime delivery SHALL require no controller mapping; WHEN the slot is Blacklisted, THE runtime SHALL omit that terminal and use only the smi-8 drop processor.

#### Scenario: Unmapped active controller still supplies clock
- **WHEN** a connected Active controller with no system-message association sends `F8`
- **THEN** its input chain pushes one ExternalMidi Clock message naming that controller slot

#### Scenario: Transport variants remain distinct
- **WHEN** an Active controller sends `FA`, `FB`, and `FC`
- **THEN** the MIDI bus receives distinct Start, Continue, and Stop message types in the same order

#### Scenario: Active rebuild keeps terminal routing
- **WHEN** an Active controller profile is edited and its processor chain is rebuilt
- **THEN** the replacement chain still terminates in realtime routing with the same controller-slot identity

#### Scenario: Blacklisted rebuild omits terminal routing
- **WHEN** an Active slot is changed to Blacklisted and rebuilt
- **THEN** the replacement input chain contains only the drop processor
- **AND** Timing Clock and transport bytes emit nothing

#### Scenario: Unsupported bytes do not masquerade as realtime transport
- **WHEN** an Active terminal receives a channel message, SysEx, Active Sensing, or System Reset
- **THEN** it emits no master-clock MessageIn for that byte

### Requirement: smi-11 — Sender: scheduled broadcast realtime lane
WHEN runtime-owned MIDI clock or transport is emitted from the audio timeline, THE `MidiSender` SHALL accept it through a fixed-capacity single-producer/single-consumer scheduled-realtime lane separate from the existing controller-feedback queue, carry an absolute due timestamp and phase generation, support invalidating an old generation at an exact due-time cutoff, prioritize realtime deadlines, and broadcast a due event to every currently registered/open sink; this lane's producer SHALL perform no mutex acquisition or allocation, queue overflow SHALL be observable and non-blocking, and existing per-controller feedback routing SHALL retain its slot-specific behavior.

#### Scenario: Realtime broadcast reaches all online outputs
- **WHEN** two controller output sinks are open at a scheduled clock deadline
- **THEN** both sinks receive the same Timing Clock event

#### Scenario: Feedback remains controller-specific
- **WHEN** a controller output processor enqueues encoder feedback for sink 1 while clock broadcast is active
- **THEN** that feedback reaches only sink 1
- **AND** the broadcast clock reaches every open sink

#### Scenario: Audio producer never waits on feedback queue
- **WHEN** the mutex-protected feedback queue is contended while the audio thread enqueues scheduled clock
- **THEN** scheduled enqueue does not acquire that mutex or wait for feedback work

#### Scenario: Stale generation is suppressed only after its cutoff
- **WHEN** a phase transition invalidates an old generation at due time `C`
- **THEN** the sender preserves old-generation events due before `C`
- **AND** drops old-generation events due at or after `C` before any sink receives them

### Requirement: smi-12 — Output sinks: host-timestamp scheduling contract
WHEN a scheduled realtime event is delivered to a host MIDI output sink, THE host adapter SHALL preserve its engine-monotonic due time through a documented epoch conversion and use the host's future-timestamp scheduling facility where available; the JUCE adapter SHALL use timestamped/background MIDI delivery rather than `sendMessageNow` for scheduled events, the browser bridge SHALL carry `dueTimeMicros` through its output protocol and invoke Web MIDI `send(bytes, timestamp)`, and immediate feedback output SHALL remain supported.

#### Scenario: Browser polling is not the event timestamp
- **WHEN** the browser drains a scheduled MIDI event after its C++ queueing time but before its due time
- **THEN** it passes the converted future timestamp to Web MIDI
- **AND** does not replace it with the drain timer's current time

#### Scenario: JUCE schedules ahead
- **WHEN** the JUCE sink receives a scheduled event before its due time
- **THEN** it submits the event to JUCE's timestamped MIDI output path with the intended deadline

#### Scenario: Immediate feedback remains immediate
- **WHEN** an existing encoder/color feedback processor enqueues a non-scheduled event
- **THEN** the sink continues to deliver it through the established immediate-feedback semantics

#### Scenario: Missing scheduling API degrades explicitly
- **WHEN** a host cannot schedule MIDI for a future timestamp
- **THEN** its sender worker waits until the deadline and reports fallback timing mode in diagnostics
- **AND** the audio thread never performs that wait
