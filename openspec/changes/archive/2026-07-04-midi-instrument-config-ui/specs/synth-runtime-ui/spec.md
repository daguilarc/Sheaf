# synth-runtime-ui Delta

Project: `projects/synth`. ID prefix: `sru`.

## ADDED Requirements

### Requirement: sru-1 — Layout: main pane with sidebar and content host
WHEN a runtime-hosted application presents UI, THE runtime library SHALL provide a main pane component composed of a right-hand sidebar menu subcomponent and a content host filling the remaining area; the content host SHALL display the application's UI override by default, SHALL display exactly one library page at a time when one is opened from the sidebar, SHALL return to the application's UI when the page is dismissed, and SHALL relayout the sidebar and content on window resize.

#### Scenario: Default view is the application
- **WHEN** the main pane opens with no page selected
- **THEN** the content host shows the application's UI component beside the sidebar

#### Scenario: Page opens and returns
- **WHEN** the user opens a sidebar page and then dismisses it
- **THEN** the page replaces the application UI while open
- **AND** the application UI is restored, retaining its state, on dismissal

#### Scenario: Resize relays out
- **WHEN** the window is resized
- **THEN** the sidebar keeps its width, and the content host (application or page) fills the remaining bounds

### Requirement: sru-2 — Sidebar: tabs and deadline readout
WHEN the sidebar renders, THE runtime library SHALL show Audio, Controllers, and File entries that open their pages in the content host, and a max-recent-deadline readout displaying the maximum audio callback load percentage over a rolling window of recent UI frames, updated on the UI timer.

#### Scenario: Tabs open their pages
- **WHEN** the user activates the Controllers entry
- **THEN** the Controllers page opens in the content host

#### Scenario: Deadline readout holds recent peaks
- **WHEN** a single audio callback spikes the load percentage and later callbacks are cheap
- **THEN** the readout continues to display the spike value until it leaves the rolling window

### Requirement: sru-3 — Audio page: interface selection
WHEN the Audio page is open, THE runtime library SHALL let the user choose the audio output device (and input device when the application's config requests inputs) from the enumerated devices with a system-default entry, SHALL apply the selection through the runtime's audio device switching (sar-15), and SHALL display the current device and negotiated status.

#### Scenario: Output selection applies
- **WHEN** the user selects an output device on the Audio page
- **THEN** the runtime switches to that device and the page reflects it as current

#### Scenario: Input row only when requested
- **WHEN** the application's config declares zero audio inputs
- **THEN** the Audio page shows no input device selector

### Requirement: sru-4 — Controllers page: list, state, and adding
WHEN the Controllers page is open, THE runtime library SHALL list every controller in the instrument configuration in order, showing its name, kind, per-endpoint connection state (online, offline, or unconfigured when the endpoint reference is empty), and the actual input and output devices (present devices plus the stored reference when absent), and SHALL provide an add ("+") action that creates a named controller of a chosen kind seeded from that kind's default profile; device selections made on the page SHALL update the controller's stored endpoint references and trigger reconciliation.

#### Scenario: Connection state is visible
- **WHEN** one mapped controller is connected and another's device is unplugged
- **THEN** the page shows the first online with its device names and the second offline

#### Scenario: Add controller
- **WHEN** the user presses "+", names the controller, and picks the twister kind
- **THEN** a controller seeded with the default twister profile appears in the list and in the instrument configuration

#### Scenario: Device choice triggers reconnect
- **WHEN** the user assigns a present input device to a controller
- **THEN** the preference is stored and reconciliation opens that device for the controller

### Requirement: sru-5 — Controllers page: expandable config sections
WHEN a controller row's config section is used, THE runtime library SHALL provide an expandable config area that starts collapsed, containing collapsible submenus — encoders, system messages, and analogs/gestures — that each start collapsed and are omitted entirely when the controller's kind does not support them; the submenus SHALL list and edit the controller's mappings (encoder channel/CC to parameter slot and position with relative mode and turn step; controller-appropriate system-message addresses to press/release message-ins; analog channel/CC to gesture index and scene blend), SHALL scroll within the page, and SHALL remain usable with multiple controllers each carrying dozens of mappings; committed edits apply through the live-edit rebuild path (smi-8).

#### Scenario: Config starts collapsed
- **WHEN** the Controllers page opens
- **THEN** every controller's config section and submenus are collapsed

#### Scenario: Unsupported submenus are skipped
- **WHEN** a launchpad controller's config is expanded
- **THEN** no encoders or analogs submenu is shown
- **AND** the system messages submenu is shown

#### Scenario: Mapping lists scroll
- **WHEN** a controller has more mappings than fit in the visible page
- **THEN** the mapping lists scroll and every mapping row remains reachable and editable

#### Scenario: Committed edit reaches the hardware path
- **WHEN** the user edits a system-message association and commits it
- **THEN** the live instrument configuration is updated and the controller's processors are rebuilt

### Requirement: sru-6 — File page: patch commands
WHEN the File page is open, THE runtime library SHALL present the patch commands (new, save, save-as, load, revert) with the current patch name and last command status, replacing the former shell chrome row; Save with no current patch directory SHALL fall through to the Save As flow.

#### Scenario: File page carries patch identity
- **WHEN** a patch is saved-as or loaded
- **THEN** the File page shows that patch's name and the command status

#### Scenario: First save falls through
- **WHEN** the user presses Save before any patch directory exists
- **THEN** the Save As chooser opens instead of an error

### Requirement: sru-7 — View model: JUCE-free page logic
WHEN the Controllers page builds or edits its content, THE row-tree construction (sections present per kind, labels, mapping row values, expand/collapse state) and edit application onto the instrument configuration SHALL live in JUCE-free library code, so page logic is unit-testable headlessly with multiple controllers and large mapping sets; JUCE components SHALL be thin renderers over this view model.

#### Scenario: View model builds without JUCE
- **WHEN** a JUCE-free test builds the view model from an instrument with four controllers of all four kinds
- **THEN** it compiles without JUCE and yields rows whose sections match each kind's support matrix

#### Scenario: Edits round-trip through the view model
- **WHEN** a JUCE-free test applies an encoder-mapping edit through the view model
- **THEN** the underlying instrument configuration reflects the edit and rebuilding the view model shows the new value
