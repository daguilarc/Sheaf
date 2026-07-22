## ADDED Requirements

### Requirement: lp-27 — MIDI connection: Ordered Launchpad preferences
WHEN Dictator starts, THE Launchpad MIDI transport SHALL read the startup `launchpad_models` preference list and, on every discovery scan, connect to the first preferred supported Launchpad model that has both standard MIDI endpoints.

#### Scenario: Pro preferred when both controllers are present
- **WHEN** `launchpad_models` is `["pro_mk3", "mini_mk3"]` and both controllers expose standard MIDI input/output endpoints
- **THEN** Dictator connects to the Launchpad Pro Mk3 and uses the Pro Mk3 SysEx model byte `0x0E`

#### Scenario: Mini fallback when Pro is absent
- **WHEN** `launchpad_models` is `["pro_mk3", "mini_mk3"]`, no Launchpad Pro Mk3 standard MIDI endpoint pair is present, and a Launchpad Mini Mk3 standard MIDI endpoint pair is present
- **THEN** Dictator connects to the Launchpad Mini Mk3 and uses the Mini Mk3 SysEx model byte `0x0D`

#### Scenario: Standard MIDI endpoints required
- **WHEN** a preferred Launchpad exposes only DAW endpoints or only one side of the standard MIDI pair
- **THEN** Dictator does not connect to that endpoint and continues scanning for the next configured model with standard source and destination endpoints whose names contain `MIDI` and not `DAW`

#### Scenario: CoreMIDI short endpoint names accepted
- **WHEN** CoreMIDI exposes a configured Launchpad's endpoint name as its short product token such as `LPProMK3 MIDI` or `LPMiniMK3 MIDI In/Out`
- **THEN** Dictator still matches the endpoint to the configured profile while continuing to require `MIDI` and reject `DAW`

#### Scenario: Offline preferred endpoints ignored
- **WHEN** a higher-priority Launchpad's previous CoreMIDI endpoints remain in the MIDI object graph but are marked offline, and a lower-priority configured Launchpad exposes online standard MIDI source and destination endpoints
- **THEN** Dictator ignores the offline endpoints and connects to the online lower-priority Launchpad using that model's SysEx profile

#### Scenario: Source and destination belong to one controller entity
- **WHEN** CoreMIDI retains endpoints for more than one instance of the same Launchpad model
- **THEN** Dictator connects a standard MIDI source and destination belonging to the same CoreMIDI entity

#### Scenario: Topology changes use the main CoreMIDI context
- **WHEN** unplugging or plugging a controller produces a burst of CoreMIDI notifications or a discovery scan finds no usable endpoint pair
- **THEN** Dictator services its single CoreMIDI client, ports, and discovery scans on the main dispatch/run-loop context, coalesces the notification burst into one delayed scan, publishes `searching` when appropriate, and continues periodic discovery without recreating the client

#### Scenario: Legacy scalar preference
- **WHEN** runtime config contains legacy `launchpad_model: "mini_mk3"` and omits `launchpad_models`
- **THEN** Dictator treats the scalar as the one-item preference list `["mini_mk3"]`
