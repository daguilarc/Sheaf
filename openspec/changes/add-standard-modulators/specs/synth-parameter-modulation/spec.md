## RENAMED Requirements

- FROM: `### Requirement: spm-71 — MiniApp: ganged random LFO modulation source`
- TO: `### Requirement: spm-71 — MiniApp: standard modulation topology`

## MODIFIED Requirements

### Requirement: spm-71 — MiniApp: standard modulation topology
WHEN MiniApp initializes its modulation topology, THE application SHALL configure its two-voice group for exactly fifteen modulators and its bank slot for all sixteen physical positions; SHALL retain one `StandardModulators<2>` that registers four two-voice ganged random LFOs at indexes `0..3`, constant at `11`, and noise at `14`; SHALL register direct VCO, swapped VCO, and ordinary LFO sources at indexes `4`, `5`, and `6`; SHALL retain and publish the standard bundle's UI states and address-stable visualizers; and SHALL render a separate main-screen panel from standard random source `0` beside the existing VCO and ordinary LFO scopes without adding performer parameters for any standard source.

#### Scenario: MiniApp uses standard random defaults
- **WHEN** MiniApp constructs its standard bundle without overriding random timing
- **THEN** its four random inputs use the waiting means, derived waiting/moving sigmas and internal sigmas, and target sigmas defined by `ssm-3`
- **AND** source `0` uses the 500-millisecond waiting mean and target sigma `0.1`

#### Scenario: MiniApp processes standard sources at audio rate
- **WHEN** MiniApp prepares and processes audio
- **THEN** it prepares the standard bundle at the negotiated processing sample rate
- **AND** processes the bundle once per audio sample before the existing group modulation-value update
- **AND** each standard source publishes outputs in MiniApp voice order

#### Scenario: Application-specific sources move after random sources
- **WHEN** MiniApp registration completes
- **THEN** standard random sources occupy `0..3`, direct VCO occupies `4`, swapped VCO occupies `5`, and ordinary LFO occupies `6`
- **AND** constant occupies `11` and noise occupies `14`
- **AND** all other indexes remain disconnected

#### Scenario: Fifteen modulation cells fit the MIN-16 slot
- **WHEN** the user opens a MiniApp modulation view
- **THEN** physical positions `0..14` preserve all fifteen modulator indexes in order
- **AND** connected indexes expose modulation-depth cells while disconnected indexes expose empty disconnected cells
- **AND** physical position `15` is the return cell
- **AND** group capacity accommodates every connected depth without invalidating existing top-level parameter, page, bank, scene, or gesture topology

#### Scenario: Standard visualizers are address stable
- **WHEN** MiniApp materializes depth cells for standard random, constant, or noise sources
- **THEN** each published visualizer pointer refers to the retained standard bundle's corresponding visualizer
- **AND** no processor, adapter row, UI state, or visualizer is reconstructed during audio or UI refresh

#### Scenario: Main screen retains the random panel
- **WHEN** the MiniApp surface builds at its default size
- **THEN** the waveform row contains bounded VCO, ordinary LFO, and standard-random-0 panels
- **AND** the random panel displays source `0`'s current complete round with the two configured voice colors and present dots

#### Scenario: Standard metaparameters are not performer state
- **WHEN** MiniApp publishes its pages, banks, encoder mappings, and patch state
- **THEN** standard source timing, indexes, random state, noise state, constant values, and visualizer state are absent from performer controls and serialized parameter values
- **AND** the existing top-level VCO and LFO bank parameter mappings remain unchanged while the slot gains the previously unused physical positions

#### Scenario: Old modulation indexes are not migrated
- **WHEN** MiniApp loads saved values created with its former six-modulator topology
- **THEN** the live code-defined fifteen-source topology remains authoritative
- **AND** no compatibility alias or index translation is applied

## ADDED Requirements

### Requirement: spm-75 — Disconnected sources are empty modulation-view positions
WHEN a bank opens a parameter's modulation view, THE parameter-modulation system SHALL preserve one physical position for every configured modulator index; SHALL expose and materialize a depth parameter only for indexes whose `ModulatorMetadata.connected` is true; SHALL represent every disconnected index with a null bank cell that publishes disconnected UI state and ignores encoder and modifier input; SHALL count only connected missing depths during capacity preflight; and SHALL limit Random Mod selection to connected source indexes.

#### Scenario: Disconnected index stays empty
- **WHEN** a modulation view opens for a group with a disconnected source index
- **THEN** that physical position has no visible parameter and publishes `connected=false`
- **AND** opening the view does not allocate or assign a modulation-depth parameter for that index

#### Scenario: Disconnected position ignores UI input
- **WHEN** the user turns or presses the disconnected position with no modifier, Reset, or Random held
- **THEN** no parameter value, selection, storage request, or topology changes

#### Scenario: Capacity preflight counts connected depths only
- **WHEN** a modulation view has connected and disconnected indexes without existing depth parameters
- **THEN** opening the view requires storage only for the connected missing depths
- **AND** disconnected positions do not prevent the view from opening

#### Scenario: Random Mod excludes disconnected indexes
- **WHEN** Random Mod applies to a parameter whose group contains disconnected source indexes
- **THEN** it can create or change depths only at connected indexes
- **AND** if no source index is connected, it is a no-op without a storage request

#### Scenario: Explicit disconnected depth remains hidden
- **WHEN** programmatic or legacy code has assigned a depth parameter at an index whose source metadata is disconnected
- **THEN** the modulation view still exposes that index as an empty disconnected position
- **AND** the explicit parameter API and stored depth object are otherwise unchanged
