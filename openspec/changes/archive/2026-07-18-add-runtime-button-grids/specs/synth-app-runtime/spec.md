## ADDED Requirements

### Requirement: sar-24 — Control topology: runtime-owned button grids
WHEN a synth application runs under the engine runtime, THE runtime SHALL own one `GridManager` as a sibling of its `ParameterManager`, SHALL attach both the UI and MIDI `MessageInBus` instances to both managers, SHALL finalize and allocate grid UI topology during initialization, SHALL drain grid and parameter messages through the existing ordered bus pumps before application block processing, SHALL publish parameter and selected-grid state into one stable internal runtime UI snapshot used by MIDI processors, and SHALL destroy the grid manager only after audio and MIDI processing have stopped; this change SHALL NOT require an existing application to create, expose, or render a grid.

#### Scenario: Grid manager follows runtime lifetime
- **WHEN** an engine is constructed, initialized, run, and destroyed
- **THEN** exactly one grid manager exists beside the parameter manager for the engine lifetime
- **AND** its cells and UI state are destroyed only after audio and MIDI callbacks can no longer access them

#### Scenario: Initialization allocates before processors start
- **WHEN** runtime initialization completes
- **THEN** grid topology is finalized and its UI state is allocated before the first MIDI processor rebuild, audio callback, or UI publication

#### Scenario: Both buses can route both control families
- **WHEN** UI and MIDI producers enqueue interleaved parameter and grid messages
- **THEN** each bus applies both families before the application processes that audio block
- **AND** each family reaches only its corresponding manager

#### Scenario: MIDI processors receive global state
- **WHEN** the runtime builds a controller profile containing encoder and grid feedback mappings
- **THEN** encoder output reads the parameter portion of the runtime snapshot
- **AND** grid system output reads the grid portion of the same stable snapshot facade

#### Scenario: Existing apps require no grid integration
- **WHEN** an application defines only parameter groups, banks, and existing MIDI configuration
- **THEN** it initializes and runs with the same application contract and parameter UI-state access as before
- **AND** no application grid component or main-surface control appears
