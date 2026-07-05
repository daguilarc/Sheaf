## MODIFIED Requirements

### Requirement: sar-10 — UI: runtime shell hosting an application component
WHEN the runtime presents UI, THE runtime SHALL own the JUCE application object, main window, and a shell that hosts the library main pane (sru-1): the sidebar with Audio/Controllers/File pages and deadline readout, and the application's portable UI surface adapted by the JUCE backend as the default content; THE runtime SHALL drive sidebar and application repaint from manager UI-state atomics on a message-thread timer at the configured frame rate; an entry-point macro SHALL let an application define its executable by naming only its application type.

#### Scenario: Shell hosts the application surface
- **WHEN** the runtime window opens
- **THEN** the application's portable UI surface is adapted by the JUCE backend and displayed as the main pane content beside the sidebar
- **AND** no patch or MIDI chrome row sits above it

#### Scenario: Repaint reads UI-state atomics
- **WHEN** the UI timer fires
- **THEN** sidebar and application widgets render from the published manager UI state without touching the parameter manager directly

#### Scenario: One-line application entry point
- **WHEN** an application translation unit invokes the runtime entry-point macro with its application type
- **THEN** the build produces a runnable JUCE application hosting that application

## ADDED Requirements

### Requirement: sar-17 — UI: portable application surface
WHEN a synth application exposes user interface content to a host runtime, THE application SHALL expose that content through a JUCE-free synth-owned portable UI contract rather than returning or naming `juce::` component, graphics, event, string, colour, or geometry types from application-facing headers; the JUCE desktop runtime SHALL adapt that portable UI surface to JUCE components behind a JUCE-owned backend, and the existing engine, audio, MIDI, patch, and message-bus semantics SHALL remain unchanged.

#### Scenario: Application UI headers compile without JUCE
- **WHEN** a JUCE-free synth test includes the application UI contract headers and the miniapp's application-facing UI headers without JUCE include paths
- **THEN** the test compiles without seeing `JUCE_MAJOR_VERSION`
- **AND** those headers expose no `juce::` types in their public signatures

#### Scenario: Desktop runtime adapts portable UI
- **WHEN** the JUCE desktop runtime starts the miniapp
- **THEN** it constructs the app's portable UI surface and hosts it through the JUCE backend adapter
- **AND** audio startup, MIDI startup, patch startup load, message-thread ticking, and shutdown ordering continue to follow the existing runtime lifecycle

#### Scenario: Miniapp visual behavior is preserved
- **WHEN** the miniapp is run through the JUCE desktop backend after the refactor
- **THEN** the encoder grid, waveform panels, bank buttons, gesture controls, scene controls, modifier buttons, start/stop controls, and runtime sidebar/pages remain visibly and behaviorally equivalent to the pre-refactor miniapp

#### Scenario: JUCE remains isolated to backend code
- **WHEN** source files outside explicitly JUCE-owned backend/runtime host paths are inspected
- **THEN** application widgets, portable UI interfaces, miniapp UI layout/drawing logic, and synth core tests do not include JUCE headers or refer to `juce::` symbols
