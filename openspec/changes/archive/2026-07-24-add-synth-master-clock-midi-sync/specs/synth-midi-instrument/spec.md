## ADDED Requirements

### Requirement: smi-10 — Realtime input: terminal clock and transport routing
WHEN the runtime builds a MIDI input chain for any controller slot, THE synth MIDI system SHALL append a terminal realtime processor after profile-specific encoder, analog, system-button, and pressure processors; the terminal SHALL convert supported one-byte Timing Clock, Start, Continue, and Stop messages into MIDI-bus `MessageIn` values carrying ExternalMidi origin, an unsigned integer-microsecond event timestamp normalized into Engine's host-local monotonic epoch at the callback/bridge boundary, and controller-slot identity, while non-realtime messages SHALL retain existing profile/thru behavior and realtime delivery SHALL require no controller mapping.

#### Scenario: Unmapped controller still supplies clock
- **WHEN** a connected controller with no system-message association sends `F8`
- **THEN** its input chain pushes one ExternalMidi Clock message naming that controller slot

#### Scenario: Transport variants remain distinct
- **WHEN** a controller sends `FA`, `FB`, and `FC`
- **THEN** the MIDI bus receives distinct Start, Continue, and Stop message types in the same order

#### Scenario: Rebuild keeps terminal routing
- **WHEN** a controller profile is edited and its processor chain is rebuilt
- **THEN** the replacement chain still terminates in realtime routing with the same controller-slot identity

#### Scenario: Unsupported bytes do not masquerade as realtime transport
- **WHEN** the terminal receives a channel message, SysEx, Active Sensing, or System Reset
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
