## MODIFIED Requirements

### Requirement: spm-20 — UI State: parameter and visible-cell snapshots
WHEN a parameter or visible-cell UI snapshot is populated, THE synth parameter modulation system SHALL write a `Parameter::UIState` whose scalar fields are individually atomic and which contains the parameter base color and resolved per-voice indicator colors from `ParameterConfig`, connected state, bipolar flag, short name pointer or stable short name view, per-voice display center values, per-voice display spread values, per-voice minimum values, per-voice maximum values, per-voice switch bucket values, switch cardinality, a normalized single control-center `rawKnobValue` before modulation and display smoothing, the slot position's latest processed absolute-input epoch, a synth-native modulator affecting bitmask, a 64-bit synth-native gesture affecting bitmask, source colors for the parameter's owning-group modulators, and manager-owned gesture colors; every field SHALL be inside the existing snapshot revision transaction; disconnected visible cells SHALL use `connected=false` with neutral values, zero spread, zero color counts, and off colors while preserving the slot position's processed absolute-input epoch instead of a separate page/navigation role; `rawKnobValue` SHALL remain normalized in `[0, 1]` for every parameter range kind, bipolar parameter UI display values and min/max values SHALL be reported in `[-1, 1]`, and unipolar parameter UI display values and min/max values SHALL be reported in `[0, 1]`.

#### Scenario: Parameter UI state reports smoothed per-voice display values
- **WHEN** a parameter has two voices with different cached knob values
- **AND** `Parameter::PopulateUIState` is called after compute/process work
- **THEN** the UI state exposes the parameter's per-voice smoothed display center values
- **AND** it does not expose unsmoothed audio-rate cached knob values as the encoder indicator center

#### Scenario: Parameter UI state reports normalized raw control center
- **WHEN** a parameter's scene and gesture composition has normalized center `0.25`
- **AND** audio-rate modulation or display smoothing makes voice-0 display value differ from `0.25`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** `rawKnobValue` is `0.25` within numeric tolerance
- **AND** it is neither modulation-adjusted nor converted to bipolar presentation

#### Scenario: Processed epoch and raw center are coherent
- **WHEN** absolute epoch `E` has been processed for a slot position and its resulting visible raw center is `X`
- **AND** that visible-cell UI state is populated
- **THEN** a stable revision read returns both processed epoch `E` and raw center `X` from the same publication transaction
- **AND** a torn read is rejected by the existing revision protocol

#### Scenario: Parameter UI state reports display spread
- **WHEN** audio-rate modulation causes a voice's cached knob value to vary around its smoothed display center
- **AND** `Parameter::PopulateUIState` is called after process work
- **THEN** the UI state exposes a non-negative per-voice display spread derived from the smoothed residual energy

#### Scenario: Parameter UI state reports configured base color
- **WHEN** a parameter is configured with base color `C`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** the UI state reports parameter base color `C`

#### Scenario: Parameter UI state reports parameter indicator colors
- **WHEN** a two-voice parameter resolves indicator colors `A` and `B`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** voice 0 indicator color is `A`
- **AND** voice 1 indicator color is `B`
- **AND** another parameter in the same group may report different colors

#### Scenario: Parameter UI state reports local source and global gesture colors
- **WHEN** a parameter's group has source colors `M0` and `M1` and its manager has gesture color `G0`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** the snapshot reports `M0`, `M1`, and `G0` in their indexed color arrays

#### Scenario: Bipolar UI state reports signed values
- **WHEN** a bipolar parameter has smoothed display center values `-0.5` and `0.75`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** the UI state reports the bipolar flag as true
- **AND** reports per-voice display center values `-0.5` and `0.75`
- **AND** reports minimum value `-1` and maximum value `1`

#### Scenario: Unipolar UI state reports unipolar values
- **WHEN** a unipolar parameter UI state is populated
- **THEN** the UI state reports the bipolar flag as false
- **AND** reports minimum value `0` and maximum value `1`

#### Scenario: Parameter UI state reports switch metadata
- **WHEN** a switch/discrete parameter UI state is populated
- **THEN** the UI state reports the parameter's switch cardinality
- **AND** reports each voice's precomputed switch bucket value using the same helper as `Parameter::GetSwitchVal(voiceIx)`
- **AND** reports display spread `0` for each voice

#### Scenario: Parameter UI state reports affecting masks
- **WHEN** a parameter has active or assigned modulation/gesture relationships that should be visible to the external encoder renderer
- **THEN** the UI state reports synth-native modulator and gesture affecting bitmasks
- **AND** those masks do not use Smart Grid `BitSet16` or Smart Grid enum types
- **AND** the gesture mask is 64 bits and covers gesture indices `0..63`
- **AND** a modulator bit is set when the parameter has a non-neutral assigned modulation-depth parameter for that modulator
- **AND** a gesture bit is set when the parameter has that gesture active in the manager's active scene selection: left scene only at blend 0, right scene only at blend 1, and both endpoint scenes for intermediate blends

#### Scenario: Unused UI state voices are disconnected or neutral
- **WHEN** a UI state has capacity for more voices than the parameter group uses
- **THEN** populated voice entries beyond the configured voice count are neutral and do not report stale values as connected
- **AND** their display spread values and indicator colors are zero/off

#### Scenario: Modulation target cell stays parameter-owned
- **WHEN** a visible bank cell is the target encoder in an open modulation view
- **AND** slot UI state is populated
- **THEN** that reserved `Parameter::UIState` reports `connected=true`
- **AND** it reports the target parameter's switch cardinality, per-voice switch buckets, affecting masks, base color, indicator colors, source colors, gesture colors, short name, bipolar flag, display center values, display spread values, and min/max values exactly as the target parameter would outside the modulation view
- **AND** renderers do not distinguish this cell from normal parameter cells through parameter UI-state page/navigation data

#### Scenario: Short name lifetime is stable
- **WHEN** a parameter UI state exposes a short name pointer or stable view
- **THEN** that reference remains valid for the lifetime of the owning manager topology
- **AND** UI state consumers do not retain it after the manager or parameter is destroyed

### Requirement: spm-35 — MIDI output: Twister encoder feedback
WHEN Twister encoder MIDI output is processed, THE synth parameter modulation system SHALL provide a Twister output processor that maps configured slot positions to controller CCs and emits separate CC feedback for the primary encoder value and LED-ring position on zero-based channel `0`, parameter color on channel `1`, RGB brightness on channel `2`, and primary LED-ring brightness on channel `5` using the MIDI Fighter Twister manual conventions; THE processor SHALL NOT mirror primary position to channel `4`, which is reserved by the controller for shifted encoders and shifted LED rings.

#### Scenario: Twister value and primary ring feedback share channel 0
- **WHEN** a mapped connected relative-feedback cell has voice-0 normalized display value `0.5`
- **THEN** the Twister output processor emits one channel `0` CC for that cell with a value near `64`
- **AND** that CC is both the encoder value and primary LED-ring position feedback
- **AND** it emits no mirrored position message on channel `4`

#### Scenario: Twister color feedback uses channel 1
- **WHEN** a mapped connected cell's parameter-level color changes
- **THEN** the Twister output processor emits a channel `1` CC for that cell using the Twister color code derived from synth color

#### Scenario: Twister brightness feedback uses channel 2
- **WHEN** a mapped connected cell has UI-state brightness `1.0`
- **THEN** the Twister output processor emits a channel `2` CC for that cell using the Smart Grid full-brightness animation value

#### Scenario: Twister brightness feedback follows UI state
- **WHEN** a mapped connected cell has UI-state brightness `0.5`
- **THEN** the Twister output processor emits a brightness animation value derived from `17 + 0.5 * 30`

#### Scenario: Twister disconnected cell blanks brightness
- **WHEN** a mapped cell is disconnected
- **THEN** the Twister output processor emits RGB brightness-off value `17` and primary ring brightness-off value `65` for that cell rather than applying visible brightness

#### Scenario: Twister indicator brightness follows UI state
- **WHEN** a mapped connected cell has UI-state brightness `0.5`
- **THEN** the Twister output processor emits primary ring brightness value derived from `65 + 0.5 * 30`

#### Scenario: Twister color helper uses full hue range
- **WHEN** a saturated synth color is converted to an MF Twister color code
- **THEN** the result is a deterministic nonzero value in the manual hue range `1..126`
- **AND** the mapping is verified against the Smart Grid `RGB2MFTHue` shape before implementation completion

### Requirement: spm-62 — MIDI controller profiles: default MF Twister profile
WHEN the default MF Twister MIDI controller profile is requested, THE synth parameter modulation system SHALL build a profile config and profile-created processors for row-major encoder turns, encoder presses, encoder output feedback, and six configurable side-button system-message associations on user-facing channel 4 CCs 8-13, without owning JUCE MIDI devices.

#### Scenario: Default MF Twister profile maps encoders
- **WHEN** the default MF Twister profile is created for slot `0`
- **THEN** encoder turn input uses zero-based channel `0`
- **AND** encoder pushbutton input uses zero-based channel `1`
- **AND** CCs `0..15` map to slot positions `0..15` in row-major order
- **AND** encoder output maps the same positions for primary encoder/ring value, RGB color, RGB brightness, and primary ring brightness feedback
- **AND** encoder output does not use zero-based channel `4` as primary indicator-position feedback

#### Scenario: Default MF Twister profile exposes six side-button slots
- **WHEN** the default MF Twister profile is created
- **THEN** it exposes exactly six configurable side-button system-message associations
- **AND** those associations use zero-based channel `3` CCs `8..13`

#### Scenario: Profile factory builds MF Twister processors
- **WHEN** a profile config contains MF Twister encoder mappings and side-button system-message associations
- **THEN** the profile factory includes encoder input and system-button input in the input chain
- **AND** creates Twister encoder output for primary encoder/ring value, RGB color, RGB brightness, and primary ring brightness feedback
- **AND** creates no side-button output processor for MF Twister side-button associations
- **AND** callers can invoke each output processor independently without an output chain

#### Scenario: Profile does not require all side buttons to be assigned
- **WHEN** a caller creates an MF Twister profile with fewer than six configured side-button messages
- **THEN** the profile remains valid
- **AND** only configured side buttons emit input messages

### Requirement: spm-68 — MIDI output: Twister unbacked encoder brightness
WHEN MF Twister encoder MIDI output is processed, THE synth parameter modulation system SHALL process only configured Twister output mappings, SHALL emit live feedback for mapped encoders whose target slot/position has a connected visible UI cell, SHALL emit MF Twister brightness-off animation values plus blank primary encoder/ring value and RGB color feedback for mapped encoders whose target slot/position has no connected visible UI cell, SHALL emit no primary position feedback on zero-based channel `4`, and SHALL ignore physical encoders that have no configured output mapping.

#### Scenario: Unused slot position blanks Twister brightness
- **WHEN** a Twister output mapping targets a realized slot position whose visible cell is disconnected or empty
- **THEN** the Twister output processor emits channel `2` RGB brightness-off value `17` for that encoder
- **AND** it emits channel `5` primary ring brightness-off value `65` for that encoder
- **AND** it emits blank RGB color and one blank primary encoder/ring value on channel `0`
- **AND** it emits no channel `4` position value

#### Scenario: Mapping beyond visible-cell capacity blanks Twister brightness
- **WHEN** a Twister output mapping targets a slot or position outside the current `ParameterManager::UIState` slot/cell capacity
- **THEN** the Twister output processor treats that mapped hardware encoder as having blank feedback state instead of skipping it as an unstable UI-state read
- **AND** it emits channel `2` RGB brightness-off value `17` for that encoder
- **AND** it emits channel `5` primary ring brightness-off value `65` for that encoder
- **AND** it emits blank RGB color and one blank primary encoder/ring value on channel `0`
- **AND** it emits no channel `4` position value

#### Scenario: Unmapped Twister encoder is ignored
- **WHEN** a Twister physical encoder has no configured output mapping
- **THEN** the Twister output processor emits no feedback for that physical encoder
- **AND** no blank feedback is required for that physical encoder

#### Scenario: Disconnected Twister brightness remains debounced
- **WHEN** a mapped Twister encoder is processed as disconnected and no relevant UI state or output cache reset occurs before the next process call
- **THEN** the Twister output processor does not emit duplicate brightness-off feedback on the next process call

## ADDED Requirements

### Requirement: spm-77 — MIDI absolute feedback: causal acknowledgement and debounce
WHEN an absolute encoder input mapping accepts a raw 7-bit position, THE synth parameter modulation system SHALL allocate a globally monotonically increasing nonzero runtime epoch, publish that epoch and received byte as the matching controller route's unresolved output expectation before the epoch-bearing `ParamSetAbsolute` becomes visible to `MessageInBus`, process the parameter edit or rejection on the audio thread, record the epoch as processed for the addressed slot position, and publish that processed epoch coherently with the position's normalized pre-modulation scene/gesture raw center; WHILE the published processed epoch precedes the latest expected epoch, absolute output SHALL emit no position feedback and SHALL NOT mutate its position debounce cache; WHEN the processed epoch reaches or passes the expectation, absolute output SHALL quantize the raw center with `round(127 * clamp(rawCenter, 0, 1))`, suppress output exactly when that byte equals the received byte, otherwise emit that actual byte once as a correction, and then resume ordinary debounce; relative encoder input and output SHALL remain outside this protocol and retain post-modulation display feedback.

#### Scenario: Applied absolute input does not echo
- **WHEN** absolute input receives byte `B`, queues epoch `E`, and DSP applies the exact normalized target `B / 127`
- **AND** UI state publishes processed epoch at least `E` with that raw center
- **THEN** absolute output emits no position message for `B`
- **AND** records the acknowledged value for subsequent debounce

#### Scenario: Output waits for DSP acknowledgement
- **WHEN** absolute input has published expected epoch `E`
- **AND** the latest stable UI snapshot for the route has processed epoch less than `E`
- **THEN** absolute output emits no position message for that route
- **AND** leaves the route's position cache unchanged
- **AND** may continue independent color and brightness feedback

#### Scenario: Rejected absolute input is corrected
- **WHEN** absolute byte `B` with epoch `E` is rejected because a modifier is active or the routed edit cannot apply
- **THEN** the slot position still publishes processed epoch at least `E`
- **AND** if the actual raw-center byte differs from `B`, output emits the actual byte once even when it equals the pre-input cached value
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
- **THEN** each controller resolves its own expectation against that common actual center
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
- **AND** it neither allocates an absolute epoch nor waits for one

#### Scenario: Epoch zero remains untracked
- **WHEN** a `ParamSetAbsolute` message is created outside the epoch-allocating absolute-encoder path with epoch `0`
- **THEN** it retains the existing absolute apply-or-reject routing behavior
- **AND** it creates no output expectation and does not advance a slot's processed absolute epoch

#### Scenario: Coordinator capacity exhaustion fails closed
- **WHEN** profile construction cannot reserve one of the coordinator's 4096 runtime-lifetime route records for a newly configured absolute mapping
- **THEN** a matching hardware turn remains consumed as a mapped controller message but does not queue `ParamSetAbsolute`
- **AND** output for that untracked mapping uses ordinary raw-center debounce without creating or waiting for an expectation
- **AND** no untracked absolute input is applied in a way that can be overwritten by stale feedback

#### Scenario: Unstable snapshot cannot resolve expectation
- **WHEN** output cannot obtain one stable revision containing both processed epoch and raw center
- **THEN** it emits no absolute position feedback from that read
- **AND** leaves the pending expectation and position cache unchanged for retry

#### Scenario: Correction enqueue failure retries
- **WHEN** an acknowledged actual byte differs from the received byte but the MIDI sender rejects the correction enqueue
- **THEN** output leaves the expectation unresolved and the position cache unchanged
- **AND** a later process pass retries the correction

### Requirement: spm-78 — MIDI output: Generic encoder position feedback
WHEN a Generic controller profile contains encoder-turn input mappings and no explicit encoder output, THE synth parameter modulation system SHALL automatically create position feedback from those turn mappings; for each mapping it SHALL emit at most one debounced MIDI CC using exactly the mapping's input channel and CC and the mapped encoder position byte, SHALL emit no color, brightness, animation, SysEx, or auxiliary feedback, SHALL use the causal absolute acknowledgement protocol when the encoder input mode is Absolute, and SHALL use the existing post-modulation display position without epoch coordination in either relative mode; an explicit Twister or WRLD.Bldr encoder output SHALL override automatic Generic feedback.

#### Scenario: Generic output mirrors the full input address
- **WHEN** a Generic turn mapping uses zero-based channel `C` and CC `N`
- **AND** its mapped position requires feedback byte `V`
- **THEN** automatic Generic output emits exactly one CC `(C, N, V)`
- **AND** emits no other MIDI message for that mapping

#### Scenario: Generic absolute output uses causal acknowledgement
- **WHEN** a Generic controller in Absolute mode receives byte `B` on one of its turn mappings
- **THEN** its automatically derived output waits for the mapping's processed epoch
- **AND** suppresses output when the acknowledged raw-center byte equals `B`
- **AND** emits one correction on the same channel and CC when the acknowledged raw-center byte differs
- **AND** retains the pending expectation and cache for retry when correction enqueue fails

#### Scenario: Generic relative output remains modulation-aware
- **WHEN** a Generic controller uses either relative encoder mode
- **AND** modulation changes the mapped post-modulation display position
- **THEN** automatic Generic output emits the changed position on the turn mapping's same channel and CC
- **AND** allocates, waits for, and resolves no absolute epoch

#### Scenario: Explicit specialized output overrides Generic derivation
- **WHEN** a Generic profile contains encoder input and an explicit Twister or WRLD.Bldr encoder output
- **THEN** profile construction creates only the explicit specialized output
- **AND** does not also create automatic Generic CC feedback

#### Scenario: Generic profile without encoder input has no derived output
- **WHEN** a Generic profile has no encoder input
- **THEN** profile construction creates no automatic Generic encoder output
