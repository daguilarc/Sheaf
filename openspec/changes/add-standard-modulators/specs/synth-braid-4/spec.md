## RENAMED Requirements

- FROM: `### Requirement: d4-9 — Modulators: visualizer slots remain empty`
- TO: `### Requirement: d4-9 — Modulators: standard visualizers`

## MODIFIED Requirements

### Requirement: d4-1 — Topology: three heterogeneous parameter groups and one bank slot
WHEN the Braid 4 application initializes, THE application SHALL create exactly one two-voice stereo parameter group, one four-voice oscillator parameter group, and one monophonic parameter group shared by audible Braid VCO controls, audible matrix controls, LFO Braid VCO controls, and LFO matrix controls; SHALL give every group exactly two scenes and fifteen audio-rate modulators; SHALL initialize the manager-global scene endpoints to `0/1` with one shared blend value; SHALL retain independent `StandardModulators<2>`, `StandardModulators<4>`, and `StandardModulators<1>` instances for the respective groups; and SHALL map four banks to one sixteen-encoder bank slot, with the audible Braid controls in the first bank, the audible 4x4 matrix controls in the second bank, the LFO Braid controls in the third bank, and the LFO 4x4 matrix controls in the fourth bank.

#### Scenario: One bank spans three Braid groups
- **WHEN** the Braid bank is selected
- **THEN** its visible mapped parameters include members of the stereo, four-voice, and monophonic Braid groups
- **AND** all mappings route through one bank slot with sixteen physical positions

#### Scenario: Matrices share the mono group and use their own banks
- **WHEN** either matrix bank is selected
- **THEN** all sixteen slot positions expose sixteen row-major matrix gain parameters from the same monophonic group that owns audible and LFO PM Index and Frequency parameters
- **AND** the parameter manager contains exactly three groups

#### Scenario: Group voice counts remain native
- **WHEN** the manager publishes slot UI state
- **THEN** X and Y report two voices, Tune/Phase/Shape/Gain report four voices, and PM Index/Frequency/matrix gains report one voice
- **AND** every owning group reports exactly fifteen modulators

#### Scenario: Scene selection and blend are global
- **WHEN** the user selects scene endpoints or moves the scene fader while any Braid bank is active
- **THEN** the manager applies the same endpoint pair and blend value to stereo, quad, and shared mono parameter evaluation
- **AND** switching banks does not switch to a different scene state

#### Scenario: Groups reserve a complete modulation view
- **WHEN** the user opens a modulation view in any Braid group
- **THEN** every connected modulation-depth control can materialize in its fixed fifteen-position layout without exhausting that group's initial parameter storage
- **AND** disconnected positions remain empty and consume no parameter storage
- **AND** subsequently materialized controls can use the existing compatible storage-batch expansion path

#### Scenario: Standard bundles are independent
- **WHEN** Braid initializes its three standard bundles
- **THEN** every group owns distinct processor, output, pointer, random-state, and visualizer addresses
- **AND** no dynamic source state is shared across the stereo, quad, and mono groups

### Requirement: d4-3 — Signal graph: audible VCOs, matrix feedback source, and sample ordering
WHILE the Braid 4 application processes audio, THE application SHALL process each group's standard bundle once for every absolute internal sample at four times the negotiated host rate before refreshing all three groups' modulation values; SHALL process all three parameter groups for that internal sample index; SHALL map and process the four audible Braid VCOs; SHALL feed their post-linear-gain pre-stereo-mix outputs into the audible 4x4 matrix; SHALL process the matrix; SHALL clamp and normalize the four raw matrix outputs into the existing parameter-modulation source range; SHALL publish those four normalized values to modulator index `4` of the four-voice group; SHALL advance the shared scope writer once per internal sample; and SHALL submit only the audible Braid stereo result to the final decimator.

#### Scenario: Matrix receives post-gain oscillator outputs
- **WHEN** a VCO produces sample `v` and its Gain voice maps to `g`
- **THEN** Braid stores `v * g` as that oscillator output
- **AND** the corresponding matrix input receives `v * g`

#### Scenario: Matrix outputs normalize before addressing quad voices
- **WHEN** the matrix produces outputs `m0`, `m1`, `m2`, and `m3`
- **THEN** the app first computes `0.5 + 0.5 * clamp(m, -1, 1)` for each output
- **AND** the next modulation-source update exposes those normalized values as modulator `4` for quad voices `0`, `1`, `2`, and `3` respectively
- **AND** modulator `5` of the quad group is reserved for the LFO matrix source defined by `d4-8`

#### Scenario: Modulation source anchors match the parameter system
- **WHEN** one raw matrix output is `-2`, `-1`, `0`, `1`, or `2`
- **THEN** the corresponding published modulation source value is respectively `0`, `0`, `0.5`, `1`, or `1`
- **AND** the raw matrix output remains available to matrix tests without normalization

#### Scenario: Existing one-sample application-source delay is explicit
- **WHEN** an oscillator sample changes a matrix output during internal sample `n`
- **THEN** parameter processing for sample `n` has already consumed the prior matrix value from application-specific modulator `4`
- **AND** sample `n+1` is the first sample that consumes the new matrix value
- **AND** standard modulators processed before the sample-`n` group update are visible during sample `n`

#### Scenario: Identity matrix preserves oscillator routing
- **WHEN** the matrix is at its defaults
- **THEN** each matrix output equals the correspondingly indexed post-gain oscillator input

#### Scenario: Normalized modulation depth remains calibrated
- **WHEN** a quad parameter has a matrix modulation depth assigned
- **THEN** the parameter-system target min/max and depth behavior are computed against a normalized `[0, 1]` source
- **AND** an out-of-range raw matrix sum clips only at the modulation-source adapter before parameter evaluation clamps to the parameter range

### Requirement: d4-8 — Parallel modulation-only LFO Braid4VCO path
WHEN Braid 4 initializes, THE application SHALL create a second `Braid4VcoModule` instance for LFO-rate modulation; SHALL register it into the same stereo, quad, and mono groups as the audible VCO instance; SHALL map it to its own sixteen-position LFO bank with the same zero-based control layout; SHALL shift only its four Frequency parameter natural ranges down by exactly ten octaves; SHALL connect it to its own four scope holders and four green voice colors; SHALL process it every internal sample at the same four-times-host clock; SHALL not route its stereo output to the final audible output; SHALL use its post-gain oscillator outputs as inputs to a second 4x4 LFO matrix bank; and SHALL register each group's audible and parallel-LFO normalized sources at application-specific modulator indexes `4` and `5` after the four standard random sources.

#### Scenario: LFO layout mirrors Braid VCO layout
- **WHEN** the LFO bank is selected
- **THEN** positions `0=X`, `1=Y`, `4=Tune`, `5=Phase`, `6=Shape`, `7=Gain`, `8..11=PM Index 1..4`, and `12..15=Frequency 1..4` match the audible Braid bank layout
- **AND** positions `2` and `3` remain disconnected

#### Scenario: LFO frequencies are ten octaves lower
- **WHEN** LFO Frequency 1, 2, 3, and 4 move across their normalized range
- **THEN** they map exponentially across `10/1024..160/1024` Hz, `50/1024..800/1024` Hz, `250/1024..2000/1024` Hz, and `1000/1024..16000/1024` Hz respectively
- **AND** Tune still multiplies those shifted base frequencies by `0.5..2`

#### Scenario: Group modulator slots are assigned by signal family
- **WHEN** Braid publishes modulation sources for an internal sample
- **THEN** the stereo group exposes modulator `4` as the audible VCO left/right XY output and modulator `5` as the LFO left/right XY output
- **AND** the mono group exposes modulator `4` as the audible VCO left/right average and modulator `5` as the LFO left/right average
- **AND** the quad group exposes modulator `4` as the audible VCO matrix outputs and modulator `5` as the LFO matrix outputs

#### Scenario: Standard source slots coexist with Braid sources
- **WHEN** the three standard bundles register their defaults
- **THEN** every group exposes four standard random sources at `0..3` and standard noise at `14`
- **AND** the stereo and quad groups expose standard constant at `11`
- **AND** the monophonic group leaves `11` disconnected

#### Scenario: All application-specific audio-rate modulators are normalized
- **WHEN** any audible output, LFO output, audible matrix output, or LFO matrix output is published as a parameter modulation source
- **THEN** the source value first maps through `0.5 + 0.5 * clamp(raw, -1, 1)`
- **AND** raw linear outputs remain available to tests and later DSP consumers without this normalization

#### Scenario: Four banks share one slot
- **WHEN** the parameter manager is initialized
- **THEN** one sixteen-encoder slot can select four banks in order: audible Braid VCO, audible matrix, LFO Braid4VCO, and LFO matrix
- **AND** each bank uses the same physical encoder positions `0..15`

#### Scenario: Audible output ignores the LFO path
- **WHEN** the LFO module and LFO matrix produce nonzero values
- **THEN** the final decimated audio output is still computed only from the audible Braid VCO module's left/right XY output
- **AND** the LFO path affects audio only through assigned modulation depths in the parameter system

### Requirement: d4-9 — Modulators: standard visualizers
WHEN Braid 4 initializes its stereo, quad, and mono modulation sources, THE application SHALL assign each standard random and noise source its owning bundle's non-null portable visualizer; SHALL assign the standard constant visualizer only in the stereo and quad groups; SHALL retain null visualizer pointers for Braid-specific application sources `4` and `5`; and SHALL render standard modulation-depth cells with their visualizer underlay while continuing to render application-source depth cells as encoder-only cells.

#### Scenario: Polyphonic groups publish six standard visualizers
- **WHEN** Braid 4 initialization completes
- **THEN** standard indexes `0..3`, `11`, and `14` in both the stereo and quad groups publish non-null visualizer pointers owned by their corresponding bundles
- **AND** no visualizer address aliases between groups or sources

#### Scenario: Mono skips the constant visualizer
- **WHEN** Braid 4 initialization completes
- **THEN** mono indexes `0..3` and `14` publish non-null standard visualizers
- **AND** mono index `11` remains disconnected with a null visualizer
- **AND** opening a mono modulation view does not materialize a depth parameter at index `11`

#### Scenario: Braid-specific sources remain encoder-only
- **WHEN** a Braid 4 modulation-depth view exposes application-specific index `4` or `5`
- **THEN** the visible depth cell contains its existing encoder node
- **AND** no visualizer node is added for that source

#### Scenario: Standard sources render beneath depth encoders
- **WHEN** a Braid 4 modulation-depth view exposes a connected standard source
- **THEN** the visible depth cell contains its encoder and the corresponding wrapper-owned portable visualizer underlay
