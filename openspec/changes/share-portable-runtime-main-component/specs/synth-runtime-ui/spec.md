## MODIFIED Requirements

### Requirement: sru-1 — Layout: main pane with sidebar and content host
WHEN a runtime-hosted application presents UI through any active backend, THE runtime library SHALL provide the same portable main pane composed of a right-hand sidebar menu subcomponent and a content host; the content host SHALL preserve the application's configured portable content bounds without clipping or rewriting app coordinates, SHALL display the application's portable UI surface through the active backend by default, SHALL display exactly one library page at a time when one is opened from the sidebar, SHALL return to the application's UI surface when the page is dismissed, and SHALL keep the sidebar adjacent to the content when the host surface is resized or uniformly scaled.

#### Scenario: Default view is the application
- **WHEN** the main pane opens with no page selected in JUCE or Chrome
- **THEN** the content host shows the application's complete portable UI surface, adapted by the active backend, beside the sidebar

#### Scenario: Page opens and returns
- **WHEN** the user opens a sidebar page and then dismisses it
- **THEN** the page replaces the application UI while open
- **AND** the application UI surface is restored, retaining its state, on dismissal

#### Scenario: Resize keeps one composition
- **WHEN** the host surface is resized or the browser uniformly scales it to a narrower viewport
- **THEN** the sidebar keeps its logical width and position beside the content host
- **AND** the application or active page remains complete and non-overlapping

