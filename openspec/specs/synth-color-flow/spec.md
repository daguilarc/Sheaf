# synth-color-flow Specification

## Purpose
TBD - created by archiving change make-synth-color-flow-coherent. Update Purpose after archive.
## Requirements
### Requirement: scf-1 — Color construction: one RGBA type and explicit hue units
WHEN synth or portable UI code constructs or transports color, THE synth library SHALL use one JUCE-free trivially-copyable 32-bit `synth::Color` RGBA type; SHALL provide separately named constructors for hue turns and hue degrees; SHALL reject non-finite hue and out-of-range hue-turn input instead of silently treating degree values as turns; SHALL return HSV conversion results with a field explicitly named `hueTurns`; and SHALL expose no ambiguous `FromHSV`/`ToHSV` API or second `synth::ui::Color` type.

#### Scenario: Degree green has literal RGB meaning
- **WHEN** `Color::FromHsvDegrees(120, 1, 1)` is evaluated
- **THEN** its red, green, and blue channels are respectively `0`, `255`, and `0` within one channel step

#### Scenario: Turns green has literal RGB meaning
- **WHEN** `Color::FromHsvTurns(1.0/3.0, 1, 1)` is evaluated
- **THEN** it matches the degree-green result within one channel step

#### Scenario: Degree value cannot silently enter turns API
- **WHEN** `Color::FromHsvTurns(120, 1, 1)` is requested
- **THEN** the call fails with an invalid-argument error
- **AND** it does not return hue zero/red

#### Scenario: Portable commands carry canonical color
- **WHEN** an encoder or waveform builder emits a draw command
- **THEN** the command's terminal RGBA payload is a `synth::Color`
- **AND** JUCE converts those exact bytes without choosing a semantic palette

### Requirement: scf-2 — Independent semantic owners
WHEN synth topology is configured, THE system SHALL store bank color on the bank, parameter base color and resolved per-voice indicator colors on the parameter, modulation-source color on modulator metadata, gesture color on gesture metadata, and scope-trace color on the scope-producing processor UI state; SHALL keep those roles independently configurable; and SHALL store no color palette or color-selection behavior on a `ParameterGroup`.

#### Scenario: Shared group does not imply shared indicators
- **WHEN** two parameters belong to the same four-voice group and are configured with different four-color indicator palettes
- **THEN** each parameter publishes its own palette unchanged
- **AND** changing bank selection does not change either parameter's colors

#### Scenario: Semantic roles remain independent
- **WHEN** a bank, one of its parameters, one parameter voice, a modulation source, and a scope trace are assigned five different colors
- **THEN** each consumer observes the color assigned to its own semantic role
- **AND** no role derives or overwrites another role's color

#### Scenario: Group topology has no color API
- **WHEN** `ParameterGroupConfig` and `ParameterGroup` are compiled
- **THEN** neither exposes voice-color fields, palettes, setters, getters, or fallback generation

### Requirement: scf-3 — Parameter appearance: complete and validated
WHEN a parameter is registered, THE parameter system SHALL accept one base color and zero, one, or exactly `numVoices` indicator colors; SHALL broadcast the base color when zero indicators are supplied; SHALL broadcast the supplied color when one indicator is supplied; SHALL preserve an exact per-voice palette when `numVoices` indicators are supplied; and SHALL reject every other nonzero cardinality before registration mutates manager or bank state.

#### Scenario: Empty indicators broadcast base color
- **WHEN** a two-voice parameter has base color `C` and no explicit indicator colors
- **THEN** both resolved indicator colors equal `C`

#### Scenario: One indicator broadcasts explicitly
- **WHEN** a four-voice parameter supplies one indicator color `I`
- **THEN** all four resolved indicator colors equal `I`

#### Scenario: Exact palette is retained
- **WHEN** a four-voice parameter supplies `[I0,I1,I2,I3]`
- **THEN** voices `0..3` publish `[I0,I1,I2,I3]` respectively

#### Scenario: Partial palette fails atomically
- **WHEN** a four-voice parameter supplies two or three indicator colors
- **THEN** registration fails before consuming a parameter ID or group slot

#### Scenario: Modulation depth preserves source and target identity
- **WHEN** a modulation-depth parameter is materialized for source color `S` on a target with indicator palette `P`
- **THEN** the depth parameter base color is `S`
- **AND** its indicator palette is `P`

### Requirement: scf-4 — Complete visible-cell color snapshots
WHEN a visible parameter cell publishes UI state, THE parameter system SHALL publish its base color, every resolved voice indicator color, its own group's modulation-source colors, and the manager's gesture colors inside the existing revision transaction; SHALL clear all colors and color counts when disconnected; and SHALL give portable encoder and MIDI feedback consumers the same base and first-voice indicator values.

#### Scenario: Encoder builder needs no external palette
- **WHEN** an `EncoderDrawState` is constructed from a visible parameter UI state
- **THEN** the builder receives no app-supplied modulator-color or gesture-color span
- **AND** its badges use the colors carried by that parameter snapshot

#### Scenario: Different groups publish different source colors
- **WHEN** Braid stereo/mono groups use red and green source colors while its quad group uses orange and yellow source colors
- **THEN** XY and mono encoder snapshots carry red/green badge colors
- **AND** quad encoder snapshots carry orange/yellow badge colors

#### Scenario: Screen and hardware indicators agree
- **WHEN** one connected visible parameter snapshot is consumed by the portable encoder and WRLD.Bldr feedback
- **THEN** both consumers use the snapshot's same parameter base color
- **AND** both consumers use the snapshot's same voice-zero indicator color

#### Scenario: Gesture metadata crosses snapshot boundary once
- **WHEN** a gesture color is configured before audio/UI publication
- **THEN** the visible-cell snapshot contains that gesture color
- **AND** portable surfaces do not read live gesture metadata to rebuild encoder state

### Requirement: scf-5 — Portable drawing: terminal color only
WHEN reusable portable drawing converts semantic snapshot state into geometry, THE portable UI layer SHALL use shared alpha/darken/brighten helpers on `synth::Color`; SHALL use parameter base color for encoder body/outline/label treatment, per-voice indicator color for value arcs/dots, source color for modulation badges, gesture color for gesture badges, and scope color for waveform/marker treatment; and SHALL retain `DrawCommand::color` only as the final RGBA selected by that drawing operation.

#### Scenario: Base and indicator colors render independently
- **WHEN** an encoder state has red base color and four distinct indicator colors
- **THEN** body/outline/label commands derive from red
- **AND** each voice's arcs/dots derive from its own indicator color

#### Scenario: Scope uses only scope color
- **WHEN** a waveform layer has scope color `S`
- **THEN** its polyline uses `S` and its marker uses the shared brightened form of `S`
- **AND** no bank or parameter color is consulted

#### Scenario: No duplicate portable color helpers remain
- **WHEN** encoder and waveform builders are compiled
- **THEN** they use the shared color helpers
- **AND** neither defines a semantic-to-UI color conversion or private brightening implementation

### Requirement: scf-6 — Braid 4 palette contract
WHEN Braid 4 initializes its four banks and eight oscillator scopes, THE app SHALL assign full red as the audible shared parameter base, four pairwise-distinct red-family oscillator shades, full green (`RGB(0, 255, 0)`) as the LFO shared parameter base, four pairwise-distinct green-family oscillator shades, orange audible-matrix diagonal cells with yellow off-diagonal cells, green-yellow LFO-matrix diagonal cells with yellow off-diagonal cells, independent bank colors, independent modulation-source colors, and scope colors equal in value to their corresponding oscillator shades but assigned through the scope-color API.

#### Scenario: Audible quad controls share base and expose four voices
- **WHEN** audible Tune, Phase, Shape, or Gain UI state is published
- **THEN** its base color is full red
- **AND** its four indicator colors are the four audible oscillator shades in oscillator order

#### Scenario: LFO quad controls mirror in green
- **WHEN** LFO Tune, Phase, Shape, or Gain UI state is published
- **THEN** its base color is full green (`RGB(0, 255, 0)`)
- **AND** its four indicator colors are the four LFO oscillator shades in oscillator order

#### Scenario: Mono oscillator controls identify their oscillator
- **WHEN** PM or Frequency control `N` is published for the audible or LFO bank
- **THEN** its base and sole indicator color equal oscillator `N`'s shade from the applicable family

#### Scenario: Stereo controls remain full family color
- **WHEN** audible or LFO X/Y state is published
- **THEN** its base and both indicator colors equal full red or full green respectively

#### Scenario: Scope families are visibly distinct
- **WHEN** all eight scope draw states are published
- **THEN** the audible scopes contain four distinct red-family colors
- **AND** the LFO scopes contain four distinct green-family colors
- **AND** no audible shade equals any LFO shade

#### Scenario: No Braid snapshot color rewrite exists
- **WHEN** Braid constructs its portable snapshot
- **THEN** it translates visible-cell state directly
- **AND** no selected-bank/encoder-position pass rewrites base, indicator, source, gesture, or scope colors

### Requirement: scf-7 — MiniApp migration contract
WHEN MiniApp initializes and renders, THE app SHALL use parameter-owned cyan/orange voice indicators on every two-voice parameter, preserve each module's configured parameter base colors, preserve cyan/orange VCO and green/yellow LFO scope colors, preserve cyan/green bank colors, preserve modulation-source and orange gesture colors, and build reusable encoders from complete visible-cell snapshots without app-local palette injection.

#### Scenario: MiniApp visible parameter carries two indicators
- **WHEN** any MiniApp parameter cell is published
- **THEN** its indicator colors are cyan for voice 0 and orange for voice 1

#### Scenario: MiniApp surface does not reconstruct colors
- **WHEN** MiniApp builds its encoder grid
- **THEN** it passes only each visible-cell snapshot to the shared encoder-state builder
- **AND** it does not query group modulator metadata or manager gesture metadata for encoder colors

### Requirement: scf-8 — Dead and ambiguous color paths are absent
WHEN the color migration is complete, THE synth source SHALL contain no ambiguous HSV API, group voice-color palette, Braid active-bank indicator override, second portable color type, duplicate encoder/waveform conversion helpers, `EncoderGeometry::ColorForIndex` invented badge fallback, generic scope `SetColor`, generic bank `SetColor`, generic matrix `SetColor`/`GetColor`, unused matrix color introspection, or unowned parameter UI brightness field; role-specific APIs and terminal `DrawCommand::color` SHALL remain.

#### Scenario: Structural audit finds no removed concepts
- **WHEN** the repository is searched for the removed symbol set
- **THEN** no production source match remains

#### Scenario: Badge indexes cannot invent colors
- **WHEN** an encoder snapshot has an affecting mask
- **THEN** badge iteration is bounded by the matching published source/gesture color count
- **AND** the renderer has no cyan, orange, or brightness-derived fallback for an out-of-range index

#### Scenario: Generic runtime theme remains separate
- **WHEN** the JUCE portable backend styles ordinary semantic buttons, labels, or panels
- **THEN** its generic runtime-theme constants do not alter custom encoder or waveform draw-command colors
- **AND** they are not presented as bank, parameter, indicator, source, gesture, or scope colors

