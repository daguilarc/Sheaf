## MODIFIED Requirements

### Requirement: smi-1 — Model: instrument configuration
WHEN MIDI controller configuration is stored or edited, THE synth system SHALL represent it as a JUCE-free instrument configuration: an ordered collection of controller records, each holding a unique controller name, a hardware/profile kind (`wrldbldr`, `twister`, `launchpad`, `generic`), an Active or Blacklisted disposition, and best-effort preferred input and output endpoint references (identifier plus device-name pair); Active records SHALL require a profile config and use the existing per-kind section/address validity rules, while Blacklisted records SHALL require both endpoint references, SHALL permit a prior profile to be retained only as optional dormant reconfiguration seed data, and SHALL never make that profile runtime-active; the instrument configuration SHALL contain no live connection state; and unique names and ordered iteration SHALL span both dispositions.

#### Scenario: Controller names are unique
- **WHEN** an active or blacklisted controller is added with a name already used by either disposition
- **THEN** the add is rejected and the configuration is unchanged

#### Scenario: Kind reports supported sections
- **WHEN** code queries the section support of an active `launchpad` controller
- **THEN** encoders and analogs are reported unsupported and system messages supported

#### Scenario: Kind constrains active config sections
- **WHEN** an active `launchpad` record is given a profile config containing encoder mappings
- **THEN** the record is reported invalid and cannot be committed

#### Scenario: Kind constrains active system-message address variants
- **WHEN** an active `launchpad` record's system-message association carries a WRLD.Bldr feedback position, or an active `twister` record's association carries a Launchpad position
- **THEN** the record is reported invalid and cannot be committed

#### Scenario: Blacklisted record retains recognition identity
- **WHEN** a Twister pair is blacklisted before a profile is generated
- **THEN** its record retains Twister kind and both endpoint references
- **AND** it requires no active controller profile config

#### Scenario: Configuration is connection-independent
- **WHEN** an instrument configuration is inspected after its devices are unplugged
- **THEN** stored records, dispositions, kinds, profile configs, and endpoint identifiers are unchanged

#### Scenario: Ordered records preserve UI order
- **WHEN** active and blacklisted records are added in a given order and the configuration is saved and reloaded
- **THEN** iteration yields every record in the same order

### Requirement: smi-2 — Persistence: instrument JSON
WHEN an instrument configuration is serialized, THE synth system SHALL write a JSON object with a schema identifier, schema version, and a `controllers` array whose entries carry controller name, hardware/profile kind, Active or Blacklisted disposition, and preferred input/output endpoint references; Active entries SHALL carry the profile config serialized with the spm-52 helpers, Blacklisted entries SHALL allow the profile field to be absent or to carry dormant seed data, and loading SHALL reject unknown dispositions, duplicate names, Active entries without a valid kind-compatible profile, Blacklisted entries without both endpoint references, and malformed endpoint references without mutating the target; the reader SHALL accept the preceding instrument schema by treating every legacy entry as Active with its required profile, while the earlier single-`midiProfile` format remains unsupported.

#### Scenario: New instrument round-trips both dispositions
- **WHEN** an instrument containing active and blacklisted records is serialized and reloaded
- **THEN** every name, kind, disposition, endpoint reference, active profile, and ordered position round-trips losslessly

#### Scenario: Previous instrument schema loads active
- **WHEN** a valid preceding-schema instrument document contains controller entries without disposition
- **THEN** every entry loads as Active with its existing profile and endpoint references

#### Scenario: Unknown disposition rejects load
- **WHEN** instrument JSON contains disposition `"paused"`
- **THEN** the load fails and the target configuration is unchanged

#### Scenario: Active record requires profile
- **WHEN** instrument JSON contains an Active entry without a profile or with a kind-incompatible profile
- **THEN** the load fails and the target configuration is unchanged

#### Scenario: Blacklisted record can omit profile
- **WHEN** instrument JSON contains a valid Blacklisted entry with kind and both endpoint identities but no profile
- **THEN** it loads as an inert blacklisted record

#### Scenario: Duplicate name rejects load
- **WHEN** active and blacklisted entries use the same controller name
- **THEN** the load fails and the target configuration is unchanged

#### Scenario: Legacy single-profile document is invalid
- **WHEN** an instrument document contains the old single `midiProfile` section and no controller collection
- **THEN** instrument loading fails rather than silently dropping controller state

### Requirement: smi-3 — Reconciliation: pure planning function
WHEN controller connections must be reconciled with the present device list, THE synth system SHALL provide a JUCE-free planning function that takes the instrument configuration, present input/output device lists, and current per-record endpoint connection state and returns a deterministic action plan such that Active records retain the existing identifier-first/name-fallback, exclusive claiming, offline marking, reference update, open, close, and output-resync behavior, while Blacklisted records never claim or open a present device for runtime I/O and cause any endpoint still online from an earlier Active disposition to close and return to inert connection state.

#### Scenario: Active identifier match reconnects
- **WHEN** an Active record's stored output identifier appears and its output is closed
- **THEN** the plan opens that output and includes a resync action

#### Scenario: Active name fallback updates reference
- **WHEN** an Active record's stored identifier is absent but a present device name matches its stored name
- **THEN** the plan opens that device
- **AND** updates the stored reference to the matched identifier and name

#### Scenario: One active record claims a device
- **WHEN** two Active records both match one present device
- **THEN** the plan assigns it to exactly one record by deterministic order
- **AND** marks the other Active record's endpoint offline

#### Scenario: Blacklisted present pair stays closed
- **WHEN** both stored endpoints of a Blacklisted record are present
- **THEN** the plan produces no open, reference-update, or resync action for that record
- **AND** its endpoints remain in inert connection state

#### Scenario: Blacklisting closes an online record
- **WHEN** an online Active record is committed as Blacklisted
- **THEN** the next reconciliation plan closes both online endpoints
- **AND** registers no replacement output sink

#### Scenario: Half-configured active endpoint remains inert
- **WHEN** an Active record's input endpoint reference is empty
- **THEN** the plan produces no open, close, or offline action for that endpoint
- **AND** the endpoint is reported as unconfigured

#### Scenario: Converged state yields empty plan
- **WHEN** every Active record is correctly connected/unconfigured/offline and every Blacklisted record is inert
- **THEN** the returned plan contains no actions

### Requirement: smi-6 — Startup: connect mapped controllers
WHEN the runtime starts, THE runtime SHALL attempt to connect every Active controller record after MIDI processors are built, SHALL skip every Blacklisted record without opening either endpoint, and SHALL mark absent Active devices offline without failing startup or blocking audio.

#### Scenario: Attached active controller connects at startup
- **WHEN** the runtime starts and an Active mapped controller's device is present
- **THEN** that controller's input and output endpoints are open before the poll thread starts

#### Scenario: Blacklisted controller is skipped at startup
- **WHEN** the runtime starts with a Blacklisted record whose devices are present
- **THEN** neither endpoint is opened
- **AND** startup and audio proceed normally

#### Scenario: Absent active controller starts offline
- **WHEN** the runtime starts and an Active mapped controller's device is not present
- **THEN** the controller is marked offline, startup completes, and audio runs

#### Scenario: Later active attach self-heals
- **WHEN** an offline Active controller's device is plugged in after startup
- **THEN** a subsequent poll cycle reconnects it and resyncs its feedback without user action

### Requirement: smi-8 — Live edits: config changes rebuild processors
WHEN the instrument configuration is edited through the configuration UI, THE message thread SHALL serialize the committed edit against audio-side state application, SHALL rebuild controller processor slots and reconcile connections through the existing shared path, SHALL construct active processors from Active profiles, and SHALL construct only an explicit drop/no-op input processor with no output processors or sender sink for a Blacklisted record; changing Active to Blacklisted or deleting an Active record SHALL close affected endpoints, while generating/reconfiguring a record as Active SHALL make its processors and endpoints live without restart.

#### Scenario: Mapping edit takes effect
- **WHEN** the user changes an active encoder mapping's target slot position and commits
- **THEN** the next matching hardware CC drives the newly mapped position

#### Scenario: UI edits and configuration loads share the rebuild path
- **WHEN** an instrument change arrives from the configuration UI and another from runtime-configuration load
- **THEN** both trigger the same processor rebuild and reconciliation code path

#### Scenario: Edits do not race the audio thread
- **WHEN** a UI instrument edit commits while audio-side state application is pending
- **THEN** live instrument mutations observe a serialized order with no concurrent mutation

#### Scenario: Added active controller becomes live
- **WHEN** the wizard adds an Active controller with a generated profile and its devices are present
- **THEN** reconciliation connects it and its processors are active without restart

#### Scenario: Blacklisted processor chain drops everything
- **WHEN** a Blacklisted record's input processor is invoked during or after a rebuild window
- **THEN** it emits no parameter, grid, clock, or transport message
- **AND** the record has no output processor or sender sink

#### Scenario: Reconfigure activates a blacklisted record
- **WHEN** a valid wizard profile replaces a Blacklisted record and changes it to Active
- **THEN** the generated processors are installed
- **AND** reconciliation SHALL open each stored endpoint that is present under the Active matching rules
