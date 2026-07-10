## MODIFIED Requirements

### Requirement: sar-10 — UI: runtime shell hosting an application component
WHEN a JUCE or browser runtime presents UI, THE runtime SHALL own its host-specific application/window or browser integration and SHALL render one shared JUCE-free runtime main component templated on the application and host services; that component SHALL host the library sidebar with Audio/Controllers/File pages and deadline readout plus the application's portable UI surface as default content, the runtime SHALL drive shared component refresh from manager UI-state atomics at the configured frame rate, and each host entry point SHALL define its executable or static WASM application by naming only the application type.

#### Scenario: Shell hosts the complete application surface
- **WHEN** the JUCE window or Chrome static site opens
- **THEN** the application's complete portable UI surface is displayed as main-pane content beside the sidebar through the active backend
- **AND** no patch or MIDI chrome row sits above it
- **AND** the sidebar does not consume or clip the configured application content width

#### Scenario: Both hosts share top-level behavior
- **WHEN** sidebar navigation, runtime-page Back, or application actions are dispatched in JUCE and Chrome
- **THEN** both hosts route them through the same portable runtime main component
- **AND** host adapters contain no concrete-application UI behavior

#### Scenario: Repaint reads UI-state atomics
- **WHEN** the UI timer fires
- **THEN** sidebar and application widgets render from the published manager UI state without touching the parameter manager directly

#### Scenario: Typed application entry points
- **WHEN** a JUCE or browser application entry point names a conforming application type
- **THEN** the build produces the corresponding runtime-hosted application without application-specific host source

