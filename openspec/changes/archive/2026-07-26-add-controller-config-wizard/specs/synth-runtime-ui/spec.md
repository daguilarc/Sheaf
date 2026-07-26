## MODIFIED Requirements

### Requirement: sru-2 — Sidebar: tabs and deadline readout
WHEN the sidebar renders, THE runtime library SHALL show Audio, Controllers, Sync, and File entries that open their pages in the content host, SHALL show a warning marker on the Controllers entry exactly while the cached scw-2 classification contains at least one available wizard candidate, and SHALL show a max-recent-deadline readout displaying the maximum audio callback load percentage over a rolling window of recent UI frames, updated on the UI timer. Candidate classification SHALL be recomputed from the cached device snapshot after a device-list change and after every successful instrument commit, including while the Controllers page is closed, but SHALL NOT force device enumeration or reconciliation when the device list is unchanged.

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
- **WHEN** the background MIDI refresh observes a present wizard-recognized pair whose endpoints are unclaimed
- **THEN** the Controllers sidebar entry shows a warning marker without requiring the Controllers page to be open

#### Scenario: Configured or ignored controller clears warning
- **WHEN** the last available candidate is configured or ignored
- **THEN** the warning marker clears on the next portable UI refresh

#### Scenario: A claimed recognized pair never warns
- **WHEN** a recognized present pair has either endpoint claimed by an active or blacklisted record
- **THEN** it is not an available candidate
- **AND** it does not contribute to the Controllers warning marker

#### Scenario: Successful lifecycle commits refresh cached classification
- **WHEN** configuring, ignoring, deleting, blacklisting, or removing from blacklist successfully commits an instrument change
- **THEN** candidate availability and the warning marker are recomputed against the cached device snapshot without waiting for another device-list change

### Requirement: sru-4 — Controllers page: list, state, and adding
WHEN the Controllers page is open, THE runtime library SHALL list every active and blacklisted controller record in instrument order, showing its name, hardware kind, and disposition. Active records SHALL also show each endpoint as online, offline, or unconfigured when its stored reference is empty; show the actual input and output choices as the present devices plus the stored reference when absent; preserve the existing low-level mapping editor; and offer Rename and Delete. Active records whose persisted wizard id resolves in the current registry SHALL additionally offer Reconfigure and Blacklist. Blacklisted records SHALL show their stored endpoint labels, expose Rename and Remove from blacklist, expose Configure only when their wizard id resolves in the current registry, and expose no live endpoint selectors or mapping editor. The page SHALL list currently available wizard candidates separately with Configure and Ignore actions, SHALL preserve the add ("+") action that creates a named active controller of a chosen kind seeded from that kind's default profile, and SHALL commit device selections and lifecycle actions through instrument editing and reconciliation rather than opening or closing handlers directly.

#### Scenario: Connection state is visible
- **WHEN** one active mapped controller is connected and another active controller's device is unplugged
- **THEN** the page shows the first online with its device names and the second offline

#### Scenario: Blacklisted record is visibly inert
- **WHEN** a blacklisted controller record is listed
- **THEN** its row shows a Blacklisted badge and its stored endpoint labels
- **AND** it exposes no mapping disclosure or live endpoint selectors

#### Scenario: Manual and legacy profiles retain generic editing
- **WHEN** an active record has no persisted wizard id
- **THEN** its Rename, Delete, endpoint-selection, and low-level mapping controls remain available
- **AND** wizard Reconfigure and Blacklist actions are not offered

#### Scenario: Unknown opaque wizard id remains recoverable
- **WHEN** a stored Active or Blacklisted record carries a well-formed wizard id that does not resolve in the current registry
- **THEN** the record remains visible and offers its non-wizard Rename and Delete or Remove-from-blacklist actions
- **AND** Reconfigure, Blacklist, and Configure are not offered

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

#### Scenario: Blacklist retains a dormant wizard profile
- **WHEN** the user blacklists a wizard-associated active controller
- **THEN** its record changes to Blacklisted while retaining its prior profile as dormant reconfiguration seed data
- **AND** reconciliation closes both endpoints and the row exposes no active mapping or endpoint controls

### Requirement: sru-30 — Controllers page: relative bank message editing
WHEN system-message mappings are presented or edited in the low-level controller mapping editor, THE synth runtime UI SHALL expose “Next Bank” and “Previous Bank” message kinds, SHALL present exactly one message `Arg` for either kind and interpret it as `slotIx`, SHALL preserve that argument across message-kind conversion through the shared primary-argument path, and SHALL represent each mapping as an individual press action with no release. The controller-wizard form SHALL instead follow scw-3's more specific form-wide Encoder Slot and disabled per-button argument contract for these two kinds.

#### Scenario: Relative bank rows expose slot as Arg
- **WHEN** a low-level system-message row selects Next Bank or Previous Bank
- **THEN** the row exposes one editable `Arg` field
- **AND** editing `Arg` updates `slotIx` in the press and feedback messages
- **AND** no bank-index argument or release message is present

#### Scenario: Relative bank kind conversion preserves the argument
- **WHEN** a low-level row whose primary argument is `5` changes to Next Bank and then Previous Bank
- **THEN** both resulting messages target slot `5`
- **AND** rebuilding the view model preserves the selected message kind and argument

#### Scenario: Relative bank mappings remain individual
- **WHEN** adjacent controller addresses map to relative bank messages
- **THEN** controller block reconstruction leaves them as individual rows
- **AND** committing the section preserves their canonical message ordering and persisted meanings

#### Scenario: Randomized controller editing covers relative bank messages
- **WHEN** the deterministic controller view-model simulation adds, converts, edits, rebuilds, and deletes relative bank mappings
- **THEN** the production row model and persisted profile arrays remain equal to the independent model

## ADDED Requirements

### Requirement: sru-32 — Controllers page: three-click configuration wizard flow
WHEN the Controllers page is open, THE runtime library SHALL provide a Configuration Wizard action. It SHALL be visibly disabled with an explanatory no-candidate status when no available candidate exists, SHALL open the sole candidate's form directly when exactly one exists, SHALL present a candidate chooser when more than one exists, and SHALL submit the active form through the controller-wizard commit path. The unique-candidate path SHALL require only Controllers, Configuration Wizard, and Submit activations to install the default profile.

#### Scenario: No candidate explains the disabled action
- **WHEN** no wizard candidate is available
- **THEN** Configuration Wizard remains visible but disabled
- **AND** the page explains that no recognized unconfigured controller pair is present

#### Scenario: Unique candidate is three clicks
- **WHEN** exactly one unconfigured MF Twister pair is present
- **AND** the user activates Controllers, Configuration Wizard, and Submit without changing defaults
- **THEN** an active Twister profile is installed with both endpoints, Encoder Slot 0, sixteen encoders targeting slot 0, and exactly six default side-button mappings
- **AND** no additional selection or confirmation activation is required

#### Scenario: Multiple candidates require selection
- **WHEN** two or more available candidates exist
- **THEN** Configuration Wizard first presents their controller and endpoint labels
- **AND** selecting one opens only that candidate's form

#### Scenario: Form retains edits after refusal
- **WHEN** Submit is refused because validation fails or a new candidate disconnected
- **THEN** the wizard remains open with every entered choice preserved
- **AND** an inline status explains the refusal

#### Scenario: Twister form exposes one slot and six rows
- **WHEN** an MF Twister form is open
- **THEN** it shows one Encoder Slot control and exactly six message/argument rows
- **AND** the rows are presented as two columns of three in physical CC order

#### Scenario: Fast path still exposes Ignore
- **WHEN** the unique-candidate flow opens a form directly
- **THEN** the form provides Ignore this controller as a secondary action
- **AND** activating it creates the blacklisted row without generating an active profile

#### Scenario: Ignore is absent during reconfiguration
- **WHEN** a wizard form was opened from an existing active or blacklisted record
- **THEN** it does not offer Ignore this controller

#### Scenario: Submit refuses a stale session
- **WHEN** the selected candidate or existing record is removed, changes endpoints or disposition, or becomes claimed by a conflicting commit before Submit
- **THEN** Submit refuses the change and retains the form state
- **AND** no instrument commit or configuration save occurs

### Requirement: sru-33 — Controllers page: portable wizard backend parity
WHEN controller discovery, wizard forms, blacklist controls, or profile lifecycle controls are rendered, THE runtime library SHALL derive them from the same portable node tree, stable node ids, portable actions, and host-service commit callbacks in Chrome and JUCE. The browser and JUCE backends SHALL render and dispatch the same ids, labels, choices, values, enabled states, and outcomes, and neither backend SHALL contain controller-wizard, MF Twister, blacklist, profile-generation, or validation policy.

#### Scenario: Browser renders portable wizard controls
- **WHEN** the MF Twister form is open in Chrome
- **THEN** its Encoder Slot, six dropdown/argument pairs, and Submit/Ignore actions are rendered from portable semantic nodes
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
- **AND** its node ids, values, enabled states, dispatched actions, and resulting portable state match the JUCE-free surface expectations

### Requirement: sru-34 — Portable UI: semantic enabled state
WHEN a portable semantic control is disabled, THE runtime UI model SHALL carry that enabled state through its node contract, the Chrome backend SHALL render it as a disabled DOM control, the JUCE backend SHALL render it as a disabled JUCE control, and neither backend SHALL dispatch its user action while disabled.

#### Scenario: Wizard argument fields disable portably
- **WHEN** an MF Twister button selects Start, Next Bank, Previous Bank, or another no-argument choice
- **THEN** the argument control has the same disabled state in the portable tree, Chrome, and JUCE
- **AND** user interaction with that disabled control does not mutate form state
