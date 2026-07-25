## MODIFIED Requirements

### Requirement: sru-2 — Sidebar: tabs and deadline readout
WHEN the sidebar renders, THE runtime library SHALL show Audio, Controllers, Sync, and File entries that open their pages in the content host, SHALL show a warning marker on the Controllers entry exactly while at least one currently present wizard-recognized input/output pair is neither configured nor blacklisted, and SHALL show a max-recent-deadline readout displaying the maximum audio callback load percentage over a rolling window of recent UI frames, updated on the UI timer.

#### Scenario: Tabs open their pages
- **WHEN** the user activates the Controllers entry
- **THEN** the Controllers page opens in the content host

#### Scenario: Sync tab opens its page
- **WHEN** the user activates the Sync entry in JUCE or Chrome
- **THEN** the portable Sync page opens in the content host

#### Scenario: Deadline readout holds recent peaks
- **WHEN** a single audio callback spikes the load percentage and later callbacks are cheap
- **THEN** the readout continues to display the spike value until it leaves the rolling window

#### Scenario: Available controller shows warning
- **WHEN** the background MIDI refresh observes a present wizard-recognized pair that is neither active nor blacklisted
- **THEN** the Controllers sidebar entry shows a warning marker without requiring the Controllers page to be open

#### Scenario: Configured or ignored controller clears warning
- **WHEN** the last available candidate is configured or ignored
- **THEN** the warning marker clears on the next portable UI refresh

### Requirement: sru-4 — Controllers page: list, state, and adding
WHEN the Controllers page is open, THE runtime library SHALL list every active and blacklisted controller record in instrument order, showing its name, hardware kind, disposition, and—only for active records—per-endpoint connection state and actual input/output devices; SHALL list currently available wizard candidates separately with Configure and Ignore actions; SHALL provide an add ("+") action that creates a named active controller of a chosen kind seeded from that kind's default profile; SHALL provide Rename for every stored record, Reconfigure and Blacklist for wizard-associated active records, Delete for active records, and Configure and Remove from blacklist for blacklisted records; and SHALL commit device selections and lifecycle actions through instrument editing and reconciliation rather than opening or closing handlers directly.

#### Scenario: Connection state is visible
- **WHEN** one active mapped controller is connected and another active controller's device is unplugged
- **THEN** the page shows the first online with its device names and the second offline

#### Scenario: Blacklisted record is visibly inert
- **WHEN** a blacklisted controller record is listed
- **THEN** its row shows a Blacklisted badge and its stored endpoint labels
- **AND** it exposes no mapping disclosure or live endpoint selectors

#### Scenario: Add controller
- **WHEN** the user presses "+", names the controller, and picks the twister kind
- **THEN** an active controller seeded with the default twister profile appears in the list and in the instrument configuration

#### Scenario: Device choice triggers reconnect
- **WHEN** the user assigns a present input device to an active controller
- **THEN** the preference is stored and reconciliation opens that device for the controller

#### Scenario: Ignore creates a visible blacklist row
- **WHEN** the user activates Ignore for an available controller
- **THEN** its available row is replaced by a persisted Blacklisted row
- **AND** neither endpoint is opened

#### Scenario: Remove from blacklist restores availability
- **WHEN** the user removes a blacklisted record while its recognized pair remains present and unclaimed
- **THEN** the inert record is removed
- **AND** the pair returns to Available controllers and restores the sidebar warning

#### Scenario: Rename rejects duplicates
- **WHEN** the user renames any active or blacklisted record to a name already used by another record
- **THEN** the rename is refused and the prior name remains

#### Scenario: Delete active profile closes hardware
- **WHEN** the user deletes an active connected controller
- **THEN** the record is removed through the instrument commit path
- **AND** reconciliation closes its endpoints and removes its processor/sender routing

## ADDED Requirements

### Requirement: sru-32 — Controllers page: three-click configuration wizard flow
WHEN available wizard candidates exist on the Controllers page, THE runtime library SHALL provide a Configuration Wizard action that opens the sole candidate's form directly when exactly one exists, presents a candidate chooser when more than one exists, and submits the active form through the controller-wizard commit path; the unique-candidate path SHALL require only Controllers, Configuration Wizard, and Submit activations to install the default profile.

#### Scenario: Unique candidate is three clicks
- **WHEN** exactly one unconfigured MF Twister pair is present
- **AND** the user activates Controllers, Configuration Wizard, and Submit without changing defaults
- **THEN** an active Twister profile is installed with both endpoints and six default side-button mappings
- **AND** no additional selection or confirmation activation is required

#### Scenario: Multiple candidates require selection
- **WHEN** two or more available candidates exist
- **THEN** Configuration Wizard first presents their controller and endpoint labels
- **AND** selecting one opens only that candidate's form

#### Scenario: Form retains edits after refusal
- **WHEN** Submit is refused because validation fails or a new candidate disconnected
- **THEN** the wizard remains open with every entered choice preserved
- **AND** an inline status explains the refusal

#### Scenario: Fast path still exposes Ignore
- **WHEN** the unique-candidate flow opens a form directly
- **THEN** the form provides Ignore this controller as a secondary action
- **AND** activating it creates the blacklisted row without generating an active profile

### Requirement: sru-33 — Controllers page: portable wizard backend parity
WHEN controller discovery, wizard forms, blacklist controls, or profile lifecycle controls are rendered, THE runtime library SHALL derive them from the same portable node tree, stable node ids, portable actions, and host-service commit callbacks in Chrome and JUCE, and neither backend SHALL contain controller-wizard, MF Twister, blacklist, profile-generation, or validation policy.

#### Scenario: Browser renders portable wizard controls
- **WHEN** the MF Twister form is open in Chrome
- **THEN** its six dropdown/argument pairs and Submit/Ignore actions are rendered from portable semantic nodes
- **AND** browser events return through `Surface::DispatchAction`

#### Scenario: JUCE renders the same form contract
- **WHEN** the same MF Twister form is open through the JUCE backend
- **THEN** it exposes the same node ids, labels, selected options, enabled argument fields, and actions as Chrome
- **AND** action outcomes mutate the same JUCE-free form state

#### Scenario: Playwright pins the browser-first acceptance path
- **WHEN** the browser integration suite runs with test-controlled MF Twister input/output ports
- **THEN** Playwright verifies the exact three-click installation path and resulting active profile
- **AND** also covers chooser, Ignore, warning, rename, delete, and reconfigure behavior

#### Scenario: JUCE simulation pins backend parity
- **WHEN** the JUCE Controllers-page simulation suite runs
- **THEN** it drives the production portable actions for form editing, submission, Ignore, rename, delete, and reconfigure
- **AND** verifies no JUCE-specific wizard state or policy is required
