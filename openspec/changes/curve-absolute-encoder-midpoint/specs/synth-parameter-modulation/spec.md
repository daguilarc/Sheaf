## MODIFIED Requirements

### Requirement: spm-31 — MIDI input: encoder mapping
WHEN encoder MIDI input is processed, THE synth parameter modulation system SHALL map configured turn and pushbutton channel/CC pairs to `MessageIn` commands addressed by `(slotIx, position)`, SHALL decode signed-7-bit and direction-only modes as relative ticks scaled by the configured normalized `turnStep`, SHALL decode absolute mode byte `B` as a `ParamSetAbsolute` parameter-space float in `[0, 1]` equal to `(B / 127)^a` without applying `turnStep`, where `a = log(0.5) / log(64 / 127)`, SHALL NOT store the raw 7-bit velocity as the message's parameter target, and SHALL allow one controller to map multiple slots or leave some physical controls unmapped.

#### Scenario: Relative turn CC maps to parameter inc/dec
- **WHEN** an encoder input config maps channel `0` CC `5` to slot `1` position `2` in signed-7-bit mode
- **AND** the processor receives a CC on channel `0` CC `5` with value `65`
- **THEN** it pushes `MessageIn::ParamIncDec` for slot `1` position `2`

#### Scenario: Signed relative mode uses value minus 64
- **WHEN** a mapped turn CC is configured for signed-7-bit relative mode
- **AND** the turn step is `0.01`
- **AND** the processor receives values `63` and `66`
- **THEN** it sends normalized deltas `-0.01` and `0.02` respectively

#### Scenario: Direction-only mode ignores magnitude
- **WHEN** a mapped turn CC is configured for direction-only relative mode
- **AND** the turn step is `0.01`
- **AND** the processor receives values `1`, `64`, and `127`
- **THEN** it sends normalized deltas `-0.01`, no message, and `0.01` respectively

#### Scenario: Absolute mode curves the represented position
- **WHEN** a mapped turn CC is configured for absolute mode
- **AND** the processor receives raw values `0`, `64`, and `127`
- **THEN** it pushes `MessageIn::ParamSetAbsolute` float targets `0`, `0.5`, and `1` respectively for the mapped slot and position
- **AND** changing `turnStep` does not change those values

#### Scenario: Default turn step is small
- **WHEN** an encoder input config is created without an explicit turn step
- **THEN** it uses a default turn step of `1 / 128`

#### Scenario: Pushbutton nonzero value maps to push
- **WHEN** an encoder input config maps pushbutton channel `1` CC `5` to slot `1` position `2`
- **AND** the processor receives a CC on channel `1` CC `5` with value `127`
- **THEN** it pushes `MessageIn::ParamPush` for slot `1` position `2`

#### Scenario: Pushbutton zero value is not consumed as a parameter command
- **WHEN** an encoder input config maps pushbutton channel `1` CC `5`
- **AND** the processor receives a CC on channel `1` CC `5` with value `0`
- **THEN** it does not push a parameter command

### Requirement: spm-77 — Messaging: absolute parameter routing
WHEN a `MessageIn::ParamSetAbsolute(timestamp, slotIx, position, normalizedValue)` reaches `MessageInBus`, THE synth parameter modulation system SHALL treat `normalizedValue` as a parameter-space float target in `[0, 1]` rather than as a raw MIDI velocity, SHALL route it by slot and position through `ParameterManager`, `BankSlot`, and the selected `Bank` to the parameter or modulation-depth control currently visible in that cell's `HandleSetAbsolute`, SHALL use that parameter's owning scene and gesture context, SHALL ignore the edit while any effective modifier is active in the same manner as `ParamIncDec`, and SHALL leave state unchanged when the slot, position, cell, or parameter is not mapped.

#### Scenario: Absolute message reaches visible parameter
- **WHEN** a selected bank maps slot `0` position `2` to a visible parameter
- **AND** the bus applies `ParamSetAbsolute(..., 0, 2, 0.5)` with no modifier active
- **THEN** the mapped parameter handles absolute float target `0.5` unchanged
- **AND** its `ComputeRawCenter(scene)` before target-center slew equals the mapped target within tolerance `1e-5`

#### Scenario: Modulation-depth view receives absolute edit
- **WHEN** a bank's modulation-depth view maps a slot position to a materialized modulation-depth parameter
- **AND** an absolute message addresses that position with no modifier active
- **THEN** the visible modulation-depth parameter receives `HandleSetAbsolute`
- **AND** the hidden top-level parameter is not edited by that message

#### Scenario: Modifier blocks absolute edit
- **WHEN** any effective modifier is active
- **AND** the bus applies a mapped `ParamSetAbsolute` message
- **THEN** it does not perform an absolute edit

#### Scenario: Unmapped absolute address is a no-op
- **WHEN** `ParamSetAbsolute` addresses an absent slot, out-of-range position, disconnected cell, or cell without a parameter
- **THEN** parameter state remains unchanged

### Requirement: spm-78 — MIDI absolute feedback: causal acknowledgement and debounce
WHEN an absolute encoder input mapping accepts raw 7-bit byte `B`, THE synth parameter modulation system SHALL allocate a globally monotonically increasing nonzero runtime epoch, publish that epoch and received byte as the matching controller route's unresolved output expectation before the epoch-bearing `ParamSetAbsolute` float target `(B / 127)^a` becomes visible to `MessageInBus`, where `a = log(0.5) / log(64 / 127)`, process the parameter edit or rejection on the audio thread, record the epoch as processed for the addressed slot position, and publish that processed epoch coherently with the position's normalized pre-modulation scene/gesture raw center; WHILE the published processed epoch precedes the latest expected epoch, absolute output SHALL emit no position feedback and SHALL NOT mutate its position debounce cache; WHEN the processed epoch reaches or passes the expectation, absolute output SHALL convert normalized raw center `x` to byte `round(127 * clamp(x, 0, 1)^(1/a))`, suppress output exactly when that byte equals the received byte, otherwise emit that actual byte once as a correction, and then resume ordinary debounce using final 7-bit bytes; relative encoder input and output SHALL remain outside this protocol and retain post-modulation display feedback.

#### Scenario: Applied absolute input does not echo
- **WHEN** absolute input receives byte `B`, queues epoch `E`, and DSP applies the exact normalized target `(B / 127)^a`
- **AND** UI state publishes processed epoch at least `E` with that raw center
- **THEN** inverse conversion and 7-bit quantization recover byte `B`
- **AND** absolute output emits no position message for `B`
- **AND** records byte `B` for subsequent debounce

#### Scenario: Absolute midpoint outputs MIDI center
- **WHEN** absolute output observes normalized raw knob position `0.5`
- **THEN** inverse conversion produces `64 / 127` before quantization
- **AND** the emitted or debounced MIDI position byte is `64`

#### Scenario: Output debounce remains in the 7-bit domain
- **WHEN** consecutive normalized raw knob positions inverse-convert and quantize to the same 7-bit byte
- **THEN** absolute output emits that byte at most once
- **AND** its position cache stores and compares the 7-bit byte rather than the pre-quantized float

#### Scenario: Output waits for DSP acknowledgement
- **WHEN** absolute input has published expected epoch `E`
- **AND** the latest stable UI snapshot for the route has processed epoch less than `E`
- **THEN** absolute output emits no position message for that route
- **AND** leaves the route's position cache unchanged
- **AND** may continue independent color and brightness feedback

#### Scenario: Rejected absolute input is corrected
- **WHEN** absolute byte `B` with epoch `E` is rejected because a modifier is active or the routed edit cannot apply
- **THEN** the slot position still publishes processed epoch at least `E`
- **AND** if the inverse-curved and quantized actual raw-center byte differs from `B`, output emits the actual byte once even when it equals the pre-input cached value
- **AND** if the actual raw-center byte equals `B`, output emits no unnecessary correction

#### Scenario: Disconnected pending route resolves as blank
- **WHEN** an absolute route becomes disconnected after receiving byte `B` with epoch `E`
- **AND** the disconnected cell publishes processed epoch at least `E` with neutral raw center `0`
- **THEN** resolution leaves the controller's primary encoder/ring at blank byte `0`
- **AND** it suppresses output if `B` was already `0`, otherwise emits one channel-0 blank correction

#### Scenario: Queue failure restores the prior expectation
- **WHEN** an absolute input publishes a tentative expectation and the bounded MIDI input bus rejects its message
- **THEN** the coordinator conditionally restores the route's preceding expectation when no newer input superseded it
- **AND** the failed event does not persistently alter output debounce state
- **AND** output never emits a value derived from treating the failed event as processed

#### Scenario: Rapid input resolves only the latest expectation
- **WHEN** a route receives increasing epochs `E1`, `E2`, and `E3` before UI publication catches up
- **THEN** output remains gated until a stable snapshot has processed epoch at least `E3`
- **AND** resolves against the received byte for `E3` and the actual raw center after that processed prefix
- **AND** does not echo or correct the superseded expectations separately

#### Scenario: Multiple controllers share one cell
- **WHEN** two absolute controllers have independent expected epochs and received bytes for the same slot position
- **AND** the cell publishes a processed epoch and actual raw center covering both events
- **THEN** each controller resolves its own expectation against the inverse-curved and quantized byte for that common actual center
- **AND** the controller whose received byte equals the actual byte suppresses its echo
- **AND** any other controller receives a correction when its byte differs

#### Scenario: Bank or modulation-view change cannot strand acknowledgement
- **WHEN** an absolute message addresses a slot position and the selected bank or modulation-depth view changes before the next output poll
- **THEN** processed-epoch acknowledgement remains associated with the slot position rather than the former parameter object
- **AND** the currently visible cell publishes that acknowledgement with its actual raw center

#### Scenario: Profile rebuild preserves pending coordination
- **WHEN** controller processors rebuild after an absolute expectation is published but before it is resolved
- **THEN** the engine-owned coordinator retains that expectation
- **AND** the rebuilt absolute output processor remains gated until acknowledgement and performs the same suppression-or-correction decision

#### Scenario: Relative feedback remains modulation-aware
- **WHEN** a controller uses either relative encoder mode
- **AND** modulation changes the existing voice-0 display value without moving the scene/gesture center
- **THEN** its encoder output continues to follow the existing post-modulation display value
- **AND** it neither applies the absolute curve nor allocates or waits for an absolute epoch

#### Scenario: Epoch zero remains untracked
- **WHEN** a `ParamSetAbsolute` message is created outside the epoch-allocating absolute-encoder path with epoch `0`
- **THEN** it retains the existing absolute apply-or-reject routing behavior
- **AND** it creates no output expectation and does not advance a slot's processed absolute epoch

#### Scenario: Coordinator capacity exhaustion fails closed
- **WHEN** profile construction cannot reserve one of the coordinator's 4096 runtime-lifetime route records for a newly configured absolute mapping
- **THEN** a matching hardware turn remains consumed as a mapped controller message but does not queue `ParamSetAbsolute`
- **AND** output for that untracked mapping uses ordinary inverse-curved 7-bit debounce without creating or waiting for an expectation
- **AND** no untracked absolute input is applied in a way that can be overwritten by stale feedback

#### Scenario: Unstable snapshot cannot resolve expectation
- **WHEN** output cannot obtain one stable revision containing both processed epoch and raw center
- **THEN** it emits no absolute position feedback from that read
- **AND** leaves the pending expectation and position cache unchanged for retry

#### Scenario: Correction enqueue failure retries
- **WHEN** an acknowledged actual byte differs from the received byte but the MIDI sender rejects the correction enqueue
- **THEN** output leaves the expectation unresolved and the position cache unchanged
- **AND** a later process pass retries the correction
