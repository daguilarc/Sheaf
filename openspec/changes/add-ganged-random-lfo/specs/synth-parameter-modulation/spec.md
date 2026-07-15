## ADDED Requirements

### Requirement: spm-71 — MiniApp: ganged random LFO modulation source
WHEN MiniApp initializes its modulation topology, THE application SHALL create one two-voice ganged random LFO, register its unipolar voice outputs as modulation source index `3`, configure cyan and orange voice colors, retain and publish its UI state, own one address-stable ganged-random-LFO visualizer for modulation-depth cells, and add a separate main-screen rendering of the same snapshot beside the existing VCO and ordinary LFO scopes without adding a parameter, page, bank, encoder, or performer control for the new source.

#### Scenario: MiniApp uses the requested fixed metaparameters
- **WHEN** MiniApp configures the ganged random LFO
- **THEN** waiting uses center-time mean `2.0` seconds, center-time sigma `0.5` seconds, and internal increment sigma `0.125` hertz
- **AND** moving uses center-time mean `2.0` seconds, center-time sigma `0.5` seconds, and internal increment sigma `0.125` hertz
- **AND** target internal sigma is `0.1`

#### Scenario: MiniApp processes the source at audio rate
- **WHEN** MiniApp prepares and processes audio
- **THEN** it supplies the negotiated processing sample rate to the gang
- **AND** processes the gang once per audio sample before updating group modulation values
- **AND** modulator `3` receives the gang's two current outputs in voice order

#### Scenario: Existing sources retain their indexes
- **WHEN** the fourth source is registered
- **THEN** the existing direct VCO, swapped VCO, and ordinary LFO sources remain at indexes `0`, `1`, and `2`
- **AND** group capacity accommodates the fourth source and its materialized depth controls without invalidating existing parameter, page, bank, scene, or gesture topology

#### Scenario: Ganged source visualizer is address stable
- **WHEN** MiniApp materializes a modulation-depth cell for source `3`
- **THEN** its published visualizer pointer refers to the retained ganged-random-LFO visualizer
- **AND** the visualizer reads the retained gang UI-state address
- **AND** no object is reconstructed during audio or UI refresh

#### Scenario: Main screen displays all three signal families
- **WHEN** the MiniApp surface builds at its default size
- **THEN** the waveform row contains bounded VCO, ordinary LFO, and ganged-random-LFO panels
- **AND** the ganged panel displays the current complete round with cyan and orange paths and present dots

#### Scenario: No performer controls are added
- **WHEN** MiniApp publishes its pages, banks, encoder mappings, and patch state
- **THEN** the ganged random LFO metaparameters are absent from performer controls and serialized parameter state
- **AND** the existing VCO and LFO bank mappings remain unchanged
