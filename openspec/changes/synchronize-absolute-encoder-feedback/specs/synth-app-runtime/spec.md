## MODIFIED Requirements

### Requirement: sar-7 — Threading: ownership and queue handoff
WHILE audio is running, THE runtime SHALL treat the audio thread as the sole consumer of the UI, MIDI, and patch input buses and the sole thread that mutates or reads the parameter manager (including absolute-event processing acknowledgement and UI-state population at a throttled control cadence), SHALL keep the message thread as the sole producer of the UI and patch input buses and the sole thread performing parameter-storage-batch replies, patch manager responses and file IO, MIDI output processor polling, and MIDI device management, and SHALL keep MIDI input callbacks as the sole producer of the MIDI input bus; UI- and MIDI-originated messages SHALL be timestamped from one shared monotonic timestamp provider owned by the runtime, with timestamp-gated ordering guaranteed within each bus (cross-bus application order is by bus drain order within a block, not global timestamp order); the engine SHALL own one fixed-capacity thread-safe absolute-feedback coordinator whose runtime-local monotonic epoch allocator and per-controller-route expectation state survive controller processor rebuilds, whose input alert is linearized before the corresponding absolute message becomes visible to the audio consumer, and whose output decision is synchronized with that alert without requiring the audio thread to lock or allocate; patch command application MAY perform bounded non-real-time work (arena JSON serialization or parse, message payload destruction) at the block boundary as an accepted, user-initiated exception to the steady-state pump's allocation-free contract.

#### Scenario: Buses drained on the audio thread
- **WHEN** on-screen controls and MIDI hardware both enqueue messages while audio runs
- **THEN** both buses are processed into the parameter manager from the audio callback
- **AND** no message-thread code applies bus messages to the manager

#### Scenario: Storage growth handled off the audio thread
- **WHEN** the parameter message output bus reports a storage batch request
- **THEN** the message thread allocates and delivers the storage batch

#### Scenario: Shared timestamps order producers within a bus
- **WHEN** a UI control and a MIDI encoder produce messages in sequence
- **THEN** both messages carry timestamps from the runtime's shared monotonic provider
- **AND** each bus applies its own messages in timestamp order under the bus visibility rules

#### Scenario: Absolute feedback coordination crosses threads without entering DSP
- **WHEN** an absolute MIDI callback establishes an expected epoch while MIDI output polling and audio processing are active
- **THEN** the callback and message-thread output processor synchronize through the engine-owned coordinator
- **AND** the audio thread communicates completion only through its route epoch and coherent UI-state publication
- **AND** the audio thread neither locks the coordinator nor allocates memory

#### Scenario: Controller rebuild retains a pending epoch
- **WHEN** live configuration rebuilds input and output processors while an absolute epoch is awaiting DSP acknowledgement
- **THEN** the old processors may be replaced without destroying the engine-owned expectation
- **AND** the new output processor observes the pending epoch before sending position feedback
