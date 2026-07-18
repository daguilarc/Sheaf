# synth-runtime-ui Specification

Project: `projects/synth`. ID prefix: `sru`.

## Purpose

Define the runtime library UI framework: the main pane with right-hand
sidebar (Audio/Controllers/File entries and max-recent-deadline readout),
the audio, controllers, and file pages, kind-driven expandable controller
configuration with scrollable mapping editors, and the JUCE-free view
model that page logic lives in.
## Requirements
### Requirement: sru-1 — Layout: main pane with sidebar and content host
WHEN a runtime-hosted application presents UI through any active backend, THE runtime library SHALL provide the same portable main pane composed of a right-hand sidebar menu subcomponent and a content host; the content host SHALL preserve the application's configured portable content bounds without clipping or rewriting app coordinates, SHALL display the application's portable UI surface through the active backend by default, SHALL display exactly one library page at a time when one is opened from the sidebar, SHALL return to the application's UI surface when the page is dismissed, and SHALL keep the sidebar adjacent to the content when the host surface is resized or uniformly scaled.

#### Scenario: Default view is the application
- **WHEN** the main pane opens with no page selected in JUCE or Chrome
- **THEN** the content host shows the application's portable UI surface, adapted by the active backend, beside the sidebar

#### Scenario: Page opens and returns
- **WHEN** the user opens a sidebar page and then dismisses it
- **THEN** the page replaces the application UI while open
- **AND** the application UI surface is restored, retaining its state, on dismissal

#### Scenario: Resize keeps one composition
- **WHEN** the host surface is resized or the browser uniformly scales it to a narrower viewport
- **THEN** the sidebar keeps its logical width and position beside the content host
- **AND** the application or active page remains complete and non-overlapping

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
WHEN a controller row's config section is used, THE runtime library SHALL provide an expandable config area that starts collapsed, containing collapsible submenus — encoders, system messages, and analogs/gestures — that each start collapsed and are omitted entirely when the controller's kind does not support them; the submenus SHALL present the controller's mappings as the block presentation of sru-10/sru-11 (block rows for uniform runs, individual rows otherwise, config-level rows for encoder mode, turn step, and scene blend), SHALL edit them through the view model (encoder channel/CC to parameter slot and position; kind-schema system-message addresses to press/release message-ins per sru-8; analog channel/CC to gesture index and scene blend), SHALL expose scrollable content with distinct visible viewport bounds and content extent so every row remains reachable in JUCE and portable backends, and SHALL remain usable with multiple controllers each carrying dozens of mappings; committed edits apply through the live-edit rebuild path (smi-8).

#### Scenario: Config starts collapsed
- **WHEN** the Controllers page opens
- **THEN** every controller's config section and submenus are collapsed

#### Scenario: Unsupported submenus are skipped
- **WHEN** a launchpad controller's config is expanded
- **THEN** no encoders or analogs submenu is shown
- **AND** the system messages submenu is shown

#### Scenario: Mapping lists scroll
- **WHEN** a controller has more mappings than fit in the visible page
- **THEN** the mapping lists expose a content extent larger than the visible viewport
- **AND** the page can scroll to every mapping row and keep it reachable and editable

#### Scenario: Committed edit reaches the hardware path
- **WHEN** the user edits a system-message association or a block row and commits it
- **THEN** the live instrument configuration is updated and the controller's processors are rebuilt

#### Scenario: Uniform runs present as blocks
- **WHEN** the default WRLD.Bldr controller's encoders submenu is expanded
- **THEN** the 16 turn mappings present as one turn block row and the 16 push mappings as one push block row rather than 32 individual rows

### Requirement: sru-6 — File page: patch commands
WHEN the File page is open, THE runtime library SHALL present the patch commands (new, save, save-as, load, revert) in a polished page layout with a current-patch identity header, runtime patch-root/path context, and last command/browser status, replacing the former shell chrome row; Save with no current patch directory SHALL fall through to the in-app Save As flow; Save As and Load SHALL open the dedicated in-app patch-browser viewer rooted at the runtime-owned `patches/` directory rather than an operating-system file explorer.

#### Scenario: File page carries patch identity
- **WHEN** a patch is saved-as or loaded
- **THEN** the File page shows that patch's name and the command status in the page header/status area

#### Scenario: First save falls through
- **WHEN** the user presses Save before any patch directory exists
- **THEN** the in-app Save As flow opens instead of an error

#### Scenario: Patch browser stays under patches root
- **WHEN** the user browses, saves-as, or loads from the File page
- **THEN** every selectable or creatable patch directory is resolved under the runtime-owned `patches/` directory
- **AND** the UI exposes no arbitrary absolute filesystem picker

#### Scenario: File page layout remains intentional while idle
- **WHEN** no Save As or Load browser viewer is open
- **THEN** the File page still shows the patch identity header, command strip, and status/empty-state region without leaving a rough blank or cramped chooser area

### Requirement: sru-7 — View model: JUCE-free page logic
WHEN the Controllers page builds or edits its content, THE row-tree construction (sections present per kind, labels, mapping row values, expand/collapse state) and edit application onto the instrument configuration SHALL live in JUCE-free library code, so page logic is unit-testable headlessly with multiple controllers and large mapping sets; JUCE components SHALL be thin renderers over this view model.

#### Scenario: View model builds without JUCE
- **WHEN** a JUCE-free test builds the view model from an instrument with four controllers of all four kinds
- **THEN** it compiles without JUCE and yields rows whose sections match each kind's support matrix

#### Scenario: Edits round-trip through the view model
- **WHEN** a JUCE-free test applies an encoder-mapping edit through the view model
- **THEN** the underlying instrument configuration reflects the edit and rebuilding the view model shows the new value

### Requirement: sru-8 — Controllers page: per-kind address schema
WHEN system-message mappings are presented or edited, THE runtime library SHALL derive each kind's address fields from a single shared schema — wrldbldr: channel, x, y; launchpad: x, y; twister: logical side-button number 0..5 only (stored as its fixed channel-3 CC `8 + button`; the channel is display-only, not an editable column); generic: channel, cc — and SHALL use that schema for row fields, column headers, and block address forms, so no kind shows dead or inapplicable address columns.

#### Scenario: Twister shows a single address column
- **WHEN** a twister controller's system messages submenu is expanded
- **THEN** each row exposes exactly one editable address field (the logical button number 0..5, persisted as CC `8 + button` on the fixed channel) plus press/release
- **AND** no editable channel field is shown
- **AND** a button value outside 0..5 is refused with a reason

#### Scenario: Schema drives every surface
- **WHEN** a kind's system-message rows, their column headers, and its system block form are compared
- **THEN** all three expose the same address fields in the same order as the shared schema

### Requirement: sru-9 — Controllers page: canonical config ordering
WHEN the view model commits any mapping change (edit, add, delete, or block operation), THE runtime library SHALL normalize the committed profile config's element order — encoder turns and pushes by (slot, position); system-message associations by a total press-message sort key defined for every `MessageIn` type (type order, then the type's semantic arguments — scene index, bank slot+index, gesture index, param slot+position, held-flag tuple for modifier set/release variants — then the kind's address tuple, then stable original order); analog gesture mappings by gesture index — through a JUCE-free library helper, without changing the persistence format; block reconstruction SHALL sort its input view the same way, so configs authored in any order reconstruct identically and become canonical on their first commit.

#### Scenario: Commit normalizes order
- **WHEN** a mapping edit is committed on a config whose system messages are stored out of order
- **THEN** the committed config's system messages are sorted by (message type, argument)
- **AND** the persisted JSON structure is otherwise unchanged

#### Scenario: Unsorted input still reconstructs
- **WHEN** an externally-authored config stores a bank-selector run out of order
- **THEN** expanding the section reconstructs the same block as for the sorted equivalent

### Requirement: sru-10 — Controllers page: block model
WHEN a section is expanded, THE runtime library SHALL reconstruct, via pure JUCE-free functions, a block presentation of the sorted config that is minimal under the reconstruction's canonical traversal (x ascending within a row, row direction ±1 in y, row-major): encoder blocks (channel, start cc, end cc exclusive, slot, start position) for maximal runs (length ≥ 2) of constant slot/channel with consecutive positions and ccs at constant offset, separately for turns and pushes; analog gesture blocks (channel, start cc, end cc exclusive, start gesture) analogously; system blocks only for scene-select, bank-select, and gesture-select messages — presented per the kind's address form (generic: channel + cc run; wrldbldr: channel + exclusive-end x/y rectangle whose end row may be above or below its start row; launchpad: the same rectangle form without channel; twister: never blocked) — for maximal runs of the same type (and same bank slot for bank-select) with consecutive arguments, consistent release pattern (paired set-false for gesture-select, absent otherwise), feedback equal to press on every cell, and a constant output-feedback flag, fitting greedy rectangles of ≥ 2 cells with the y direction fixed by the run's second row; a block SHALL expand to exactly its equivalent individual configs (argument = start + cell index in traversal order; wrldbldr cells derive control cc from position with the block channel authoritative; feedback = press; output-feedback = the block's flag), and reconstruction composed with expansion SHALL round-trip: expanding a reconstructed presentation reproduces the sorted config exactly for every config (duplicate addresses or duplicate messages simply fail the run checks and pass through as individual rows), and reconstructing the expansion of any block reconstruction can itself produce yields that block back; mappings fitting no block — including all non-blockable message types and scene blend — SHALL present as individual rows.

#### Scenario: Encoder run reconstructs to one block
- **WHEN** a config maps ccs 0..15 on one channel to slot 0 positions 0..15 as turns
- **THEN** the encoders presentation contains one turn block (channel, cc 0..16 exclusive, slot 0, start position 0)

#### Scenario: Bank rectangle reconstructs on WRLD.Bldr
- **WHEN** the default WRLD.Bldr profile's bank selectors (banks 0..7 on row y=3, banks 8..15 on row y=2, feedback = press throughout) are reconstructed
- **THEN** the system presentation contains one bank-select block spanning x 0..7 from start row 3 to end row 2 with start argument 0

#### Scenario: Broken run splits minimally
- **WHEN** one cell in the middle of an otherwise uniform scene-select run has a non-consecutive argument
- **THEN** reconstruction emits blocks/rows covering each maximal uniform piece and an individual row for the outlier

#### Scenario: Non-blockable messages stay individual
- **WHEN** a config contains reset/random modifier associations and a scene blend assignment
- **THEN** they present as individual rows regardless of adjacency

#### Scenario: Expansion round-trips
- **WHEN** any reconstructed presentation's blocks are expanded and merged with its individual rows
- **THEN** the result equals the sorted input config exactly

#### Scenario: Block commit is all-or-nothing
- **WHEN** a block edit produces an expansion where any cell fails validation (address out of shape, argument out of domain, duplicate address)
- **THEN** the commit is refused with a reason and the config is unchanged

### Requirement: sru-11 — Controllers page: edit-session stability, add, and delete
WHILE a section is expanded, THE runtime library SHALL render an explicit in-memory edit-session row list for that controller section; the edit session SHALL be created by coalescing the current persisted profile elements only on the collapsed-to-expanded transition, SHALL be discarded on expanded-to-collapsed, SHALL NOT be replaced or re-coalesced by accepted edits, adds, deletes, view-model rebuilds, or canonical persisted-order sorting while the section remains expanded, and SHALL flush accepted changes by expanding the current session rows back into the existing persisted profile arrays, validating the full candidate section, and normalizing the persisted element order; each addable mapping group SHALL offer "+" (append one config with next-free defaults) and, where blocks apply, "+B" (append a block, committed as its expansion) which append session rows at the end of the requested group — EVEN WHEN the group is currently empty, so an empty section is never a dead end, and adding the first mapping into a section whose profile-config container is absent (no encoder-input or analog-input) SHALL create that container as part of the commit; individual mapping rows and block rows SHALL be deletable (a block delete removes all its cells in one commit); config-level rows (encoder mode, turn step, scene blend) SHALL NOT be deletable.

#### Scenario: Empty group still offers add
- **WHEN** a controller's section (e.g. system messages, or analog gestures) currently has zero mappings
- **THEN** the section still shows the group's "+" (and "+B" where blocks apply) so the first mapping can be added

#### Scenario: First add creates an absent container
- **WHEN** the user adds the first encoder (or analog) mapping to a controller whose config has no encoder-input (or analog-input) container
- **THEN** the commit creates the container and adds the mapping rather than refusing

#### Scenario: Session rows survive canonical persisted sorting
- **WHEN** the user edits a row while a section stays expanded
- **THEN** the edit session keeps rendering the same row list with the edited row updated in place
- **AND** the persisted profile arrays are expanded from the session and normalized without reordering the visible session rows

#### Scenario: Duplicate messages resolve distinctly
- **WHEN** two associations at different addresses both send scene-select 0 and one is deleted
- **THEN** exactly the deleted association's row disappears and the other is unaffected

#### Scenario: Edits do not re-group while expanded
- **WHEN** the user adds two individual scene-select rows that happen to form a contiguous run while the section stays expanded
- **THEN** they remain two individual rows until the section is collapsed and re-expanded
- **AND** re-expanding presents them as one block

#### Scenario: Block edit keeps its row
- **WHEN** the user edits a block's start argument and commits
- **THEN** the block row stays in place with updated values
- **AND** the config holds the new expansion normalized into persisted order

#### Scenario: Add block appends
- **WHEN** the user presses "+B" on the system group of a launchpad controller and commits the block form
- **THEN** the block's cells are added to the config in one commit
- **AND** the block row appears at the end of the session group without re-coalescing neighboring rows

#### Scenario: Delete removes exactly its rows
- **WHEN** the user deletes a 16-cell bank block
- **THEN** all 16 associations represented by that session block are removed in one commit and no other mapping changes

#### Scenario: Config-level rows are not deletable
- **WHEN** the encoders section presents encoder mode and turn step
- **THEN** neither exposes a delete affordance

#### Scenario: Close and reopen re-coalesces
- **WHEN** the user closes a section after edits that left adjacent compatible singleton rows visible
- **AND** the user opens that section again
- **THEN** the section coalesces from the current persisted profile arrays and may present those rows as a block

### Requirement: sru-12 — Configuration pages: Back saves runtime configuration
WHEN the user dismisses a runtime configuration page with Back, THE runtime library SHALL save the current runtime configuration before returning to the application view for pages that edit persistent configuration, including the Audio page and Controllers page.

#### Scenario: Audio Back saves configuration
- **WHEN** the user changes the audio device selection and presses Back on the Audio page
- **THEN** the runtime saves a configuration document containing the current audio device state
- **AND** returns to the application view

#### Scenario: Controllers Back saves configuration
- **WHEN** the user changes controller setup or mappings and presses Back on the Controllers page
- **THEN** the runtime saves a configuration document containing the current MIDI instrument/controller configuration
- **AND** returns to the application view

#### Scenario: File Back does not save runtime configuration
- **WHEN** the user presses Back on the File page
- **THEN** the runtime returns to the application view without writing runtime configuration solely because the File page was dismissed

### Requirement: sru-13 — File page: in-app patch browser
WHEN the File page enters Save As or Load flow, THE runtime library SHALL render a dedicated root-scoped in-app patch-browser viewer over the runtime-owned `patches/` directory, listing patch directories in deterministic flat order, allowing creation of a named new patch directory for Save As, selecting an existing patch directory for Load, supporting row double-click to load or overwrite-save-as existing patch directories, and presenting clear selected-row, empty, error, invalid-input, confirm, and cancel states in the viewer.

#### Scenario: Browser lists patch directories deterministically
- **WHEN** the patch root contains multiple patch directories
- **THEN** the in-app browser lists them in deterministic filename order
- **AND** non-patch version files at the root are not presented as loadable patches

#### Scenario: Save As creates patch directory under root
- **WHEN** the user enters a new patch name in the in-app Save As flow
- **THEN** the runtime creates the corresponding patch directory under the runtime-owned `patches/` directory
- **AND** writes the first patch version file there through the patch manager

#### Scenario: Save As refuses existing patch name in viewer
- **WHEN** the user enters or selects a Save As patch name whose target directory or file already exists under the runtime-owned `patches/` directory
- **THEN** the browser viewer keeps the Save As flow open and shows an inline already-exists status
- **AND** it does not dispatch a save-as callback for that target

#### Scenario: Save As double-click appends to existing patch
- **WHEN** the user double-clicks an existing patch directory row in the Save As browser
- **THEN** the runtime appends a new version file into that patch directory through an explicit overwrite-save-as action
- **AND** ordinary typed Save As confirmation still refuses existing patch directories

#### Scenario: Load selects patch directory under root
- **WHEN** the user confirms an existing patch directory in the in-app Load flow
- **THEN** the runtime asks the patch manager to load that directory
- **AND** the patch manager selects the latest sortable version file in that directory

#### Scenario: Load double-click accepts a flat row
- **WHEN** the user double-clicks a patch directory row in the Load browser
- **THEN** the runtime asks the patch manager to load that directory without requiring a separate Open control

#### Scenario: Browser cannot escape root
- **WHEN** a browser navigation or typed patch name contains an absolute path or `..`
- **THEN** the runtime rejects that target
- **AND** no file outside the runtime-owned `patches/` directory is read or written

#### Scenario: Browser exposes polished chooser states
- **WHEN** the Save As or Load browser viewer is open
- **THEN** the viewer shows its mode title, selected directory row state, primary confirm action, cancel action, and any invalid-input/status message within the viewer
- **AND** an empty patch root is presented as an empty state rather than a missing or broken list
- **AND** it does not expose separate Open or Parent controls

#### Scenario: Browser exposes unreadable-root error state
- **WHEN** the runtime-owned `patches/` directory cannot be read or refreshed
- **THEN** the browser viewer shows an error state and status inside the viewer
- **AND** it does not dispatch save-as or load callbacks until a valid target is available

### Requirement: sru-14 — Portable UI: semantic controls and drawing commands
WHEN runtime UI pages or synth widgets render, THE runtime UI layer SHALL express their host-independent structure through a JUCE-free portable UI model that supports semantic controls (buttons, toggles, sliders, combo boxes, text fields, labels, rows, sections, scroll areas, and status text), stable node identities for stateful controls, input/action callbacks, and bounded drawing commands for bespoke visual widgets using the canonical `synth::Color` RGBA type; JUCE renderers SHALL consume that model through backend adapters under `projects/synth/juce` rather than owning page behavior directly, and the model SHALL be shaped so neither the JUCE backend nor a future browser/DOM backend is forced through toolkit-awkward abstractions.

#### Scenario: Portable UI model compiles without JUCE
- **WHEN** a JUCE-free synth test includes the portable UI model and builds a representative miniapp/runtime page tree
- **THEN** it compiles without JUCE headers
- **AND** the tree can represent buttons, toggles, sliders, combo boxes, text fields, labels, scroll areas, and custom drawing nodes

#### Scenario: Bespoke widgets emit drawing commands
- **WHEN** the miniapp encoder or waveform widget renders through the portable UI layer
- **THEN** it emits host-neutral geometry, canonical `synth::Color` values, text, path/arc/line/fill, and interaction descriptions sufficient for the JUCE backend to reproduce the existing visual widget
- **AND** no second portable RGBA type is required

#### Scenario: Semantic controls remain backend-native
- **WHEN** the Audio, File, or Controllers page renders a form-like control through the portable UI layer
- **THEN** the page describes the control semantically rather than as raw drawing only
- **AND** the JUCE backend may realize it as native JUCE controls while a browser backend could map it to DOM controls

#### Scenario: Backend owns toolkit details
- **WHEN** a JUCE backend renders a portable UI tree
- **THEN** all JUCE component construction, graphics calls, focus handling, and toolkit-specific event translation happen inside JUCE-owned backend code under `projects/synth/juce`
- **AND** the portable UI tree producer remains free of JUCE references

### Requirement: sru-15 — Controllers page: DOM-friendly semantic presentation
WHEN the Controllers page is rendered, THE runtime UI layer SHALL derive a DOM-friendly semantic tree from the JUCE-free `MidiConfigViewModel`, preserving the page's existing controller list, endpoint selection, connection state display, add-controller flow, expandable config sections, mapping rows, block rows, add/delete affordances, validation/refusal status, focus-safe refresh, and commit-through-`EditInstrument` behavior; the JUCE backend SHALL render that semantic tree without reducing current functionality, SHALL NOT treat the current dense Controllers page look and feel as a visual-parity target, and MAY improve spacing, visual layout grouping, labels, and control presentation without relaxing sru-11's row/block presentation-stability requirements.

#### Scenario: Controller workflows are preserved
- **WHEN** the user adds a controller, selects input/output endpoints, expands sections, edits mapping fields, adds or deletes individual rows, adds or deletes block rows, or changes launchpad variant controls
- **THEN** each accepted action is applied through the existing `MidiConfigViewModel` edit APIs and committed through the runtime's instrument edit path
- **AND** refused actions show a status reason without mutating the live instrument

#### Scenario: Connection and rebuild refresh survives the refactor
- **WHEN** MIDI connection state changes, a patch load/revert changes the instrument, or an out-of-band MIDI processor rebuild occurs
- **THEN** the Controllers page marks its semantic tree dirty and refreshes from the current instrument snapshot and connection state
- **AND** active text editing is not clobbered before the edit commits or focus is released

#### Scenario: Empty groups remain editable
- **WHEN** a controller section has no existing mappings in an addable group
- **THEN** the semantic tree still exposes the group's add affordance and, where supported, block-add affordance
- **AND** adding the first row creates any absent profile-config container needed by the view model

#### Scenario: JUCE renderer may improve presentation
- **WHEN** the JUCE backend renders the Controllers page semantic tree
- **THEN** it may replace the current dense component layout with clearer visual layout grouping, spacing, headers, and form controls rather than preserving the current appearance for its own sake
- **AND** every capability required by `sru-4` through `sru-11` remains available and testable

### Requirement: sru-16 — File page: portable patch explorer
WHEN the File page opens Save As or Load, THE runtime UI layer SHALL represent patch browsing and confirmation as a dedicated rootless JUCE-free portable patch-browser state machine over `synth::PatchBrowser`, including flat directory rows with stable identities and selected state, row double-click accept actions, save-name entry for Save As, confirm/cancel actions, status text, empty/error states, and safe root-constrained path resolution; the File page surface SHALL splice that browser state machine into one File page `NodeTree` without introducing a nested root surface; the JUCE desktop backend SHALL render and dispatch that semantic tree without using `juce::FileChooser`, accepted Load confirmations SHALL call the runtime's `LoadPatch` path, typed Save As confirmations SHALL call `SavePatchAs`, and Save As row double-click confirmations SHALL call an explicit overwrite-save-as runtime path.

#### Scenario: Save As uses in-page browser state
- **WHEN** the user chooses Save As from the File page
- **THEN** the portable tree shows a Save As browser rooted at the runtime patches root
- **AND** the user can type a patch name and confirm only when `PatchBrowser::ResolveSaveAsPath` accepts it and the target does not already exist
- **AND** confirmation dispatches the resolved path through the host save callback

#### Scenario: Load uses in-page browser state
- **WHEN** the user chooses Load from the File page
- **THEN** the portable tree shows a Load browser rooted at the runtime patches root
- **AND** directory rows, selected directory state, double-click row loading, and selected directory confirmation are represented by portable nodes/actions
- **AND** confirmation dispatches the resolved directory through the host load callback

#### Scenario: Save As uses explicit overwrite action for existing rows
- **WHEN** the user double-clicks an existing directory row from the Save As browser
- **THEN** the portable tree dispatches a distinct overwrite-save-as confirmation action for that row
- **AND** normal Save As confirmation remains constrained to new patch names

#### Scenario: Browser state is backend-neutral
- **WHEN** a JUCE-free test builds and drives the File page browser tree
- **THEN** it can inspect rows, double-click rows, cancel, enter save names, and confirm valid paths without JUCE headers
- **AND** the JUCE runtime File page host contains no `juce::FileChooser` usage

#### Scenario: Browser nodes are spliced into one File page tree
- **WHEN** the File page portable tree is built while the browser viewer is open
- **THEN** the tree contains exactly one root node for the File page surface
- **AND** browser rows and controls are descendants of the File page browser section rather than a nested root surface

#### Scenario: JUCE backend renders a polished browser viewer
- **WHEN** the JUCE backend renders the File page portable tree with a browser open
- **THEN** it renders the browser as a full flat viewer region with stable controls, visible selected-row treatment, readable labels/status text, row double-click actions, and primary/cancel actions that remain inside their parent bounds after resize
- **AND** File page behavior remains owned by the portable surface rather than by JUCE-only callbacks

### Requirement: sru-17 — File page: model-based browser verification
WHEN the File page browser behavior is tested, THE synth test suite SHALL include deterministic model-based simulation coverage that drives the production JUCE-free File page/browser state machine and the JUCE portable renderer through randomized Save, Save As, Load, select, row double-click accept/overwrite, save-name edit, confirm, cancel, and resize actions while checking an independent oracle for browser-open state, selected path/name state, dispatched save/load callbacks, and root-constrained path safety.

#### Scenario: Simulation preserves browser invariants
- **WHEN** a seeded simulation dispatches a randomized sequence of File page browser actions
- **THEN** the browser never dispatches a Save As or Load path outside the configured patch root
- **AND** invalid save names, existing Save As targets, unreadable roots, or missing load selections update status without dispatching save/load callbacks
- **AND** cancel closes the browser without dispatching save/load callbacks

#### Scenario: Simulation verifies renderer layout
- **WHEN** the seeded simulation rebuilds the JUCE renderer after each File page action and resize
- **THEN** every visible semantic control has a matching JUCE component of the expected kind
- **AND** row controls, status text, save-name input, and primary/cancel actions remain within their parent/root bounds

#### Scenario: First-save flow is simulated
- **WHEN** the simulation triggers Save while the File page has no current patch directory
- **THEN** the Save As browser opens through the same portable state machine used by the explicit Save As action

### Requirement: sru-18 — File page: current patch versions
WHEN the File page has a current patch directory, THE runtime UI layer SHALL present a Versions list for that current patch in the idle File page region, ordered newest-first by sortable patch version filename, and SHALL allow double-clicking a version row to load that exact version file.

#### Scenario: Versions list shows current patch files
- **WHEN** the current patch directory contains multiple `.json` patch version files
- **THEN** the idle File page shows a Versions section
- **AND** the version rows are ordered newest first by filename

#### Scenario: Version double-click loads exact file
- **WHEN** the user double-clicks a version row
- **THEN** the File page dispatches a load action for that exact version file
- **AND** the patch manager loads that version rather than resolving the latest version from the directory

### Requirement: sru-19 — Launcher: app list and one-way selection
WHEN the Sheaf Patch superapp starts, THE runtime UI SHALL present a launcher page listing registered synth apps with their display name, author, category, and advisory hardware requirements, and SHALL start the selected app when the user activates an app row without blocking launch based on those requirements.

#### Scenario: Launcher lists registered apps
- **WHEN** the Sheaf Patch launcher opens
- **THEN** it lists every registered app sorted by stable app id
- **AND** each row shows the app display name, author, category, and minimum encoder requirement

#### Scenario: Selecting miniapp starts miniapp
- **WHEN** the user activates the miniapp row
- **THEN** the miniapp runtime starts
- **AND** the launcher no longer owns the visible main content for that process session

#### Scenario: No in-app return for this change
- **WHEN** a launched app is running
- **THEN** the runtime UI provides no launcher Back or Home action for returning to the app list
- **AND** returning to the launcher requires quitting and restarting the Sheaf Patch executable

#### Scenario: Category is visible
- **WHEN** the app list contains the current miniapp
- **THEN** the row shows category `test`

#### Scenario: Hardware requirements are advisory
- **WHEN** a registered app declares a minimum encoder requirement
- **THEN** the launcher displays that requirement
- **AND** activating the app row still starts the app regardless of detected hardware capability

### Requirement: sru-20 — Portable UI: encoder mouse interaction parity
WHEN a miniapp encoder is rendered through the portable UI layer on the JUCE desktop backend, THE runtime UI layer SHALL preserve the pre-abstraction encoder mouse interaction behavior: mouse drag over the encoder dispatches a relative parameter increment/decrement for that encoder's bound slot and position using the existing `(deltaX - deltaY) * sensitivity` gesture mapping, and mouse double-click dispatches the encoder push action for that same slot and position; the portable tree producer SHALL remain JUCE-free and the JUCE backend SHALL only translate toolkit mouse events into portable actions.

#### Scenario: Mouse drag turns encoder
- **WHEN** the JUCE backend receives a mouse-down followed by a mouse-drag on a portable miniapp encoder node
- **THEN** the miniapp surface dispatches a `MessageIn::ParamIncDec` message to the UI bus for the encoder's slot and position
- **AND** the message delta follows the pre-abstraction encoder drag formula and sensitivity

#### Scenario: Mouse double-click pushes encoder
- **WHEN** the JUCE backend receives a mouse double-click on a portable miniapp encoder node
- **THEN** the miniapp surface dispatches a `MessageIn::ParamPush` message to the UI bus for the encoder's slot and position

#### Scenario: Portable boundary remains JUCE-free
- **WHEN** a JUCE-free synth test includes the portable UI model and miniapp encoder tree builder
- **THEN** it compiles without JUCE headers
- **AND** it can inspect the encoder node's host-neutral drag and double-click action metadata

### Requirement: sru-21 — Portable UI: reusable scope-waveform drawing
WHEN a synth application needs to draw scope-backed waveforms, THE runtime UI layer SHALL provide JUCE-free shared portable drawing logic that converts a scope writer/channel, connection state, color, and target bounds into bounded waveform draw commands, and SHALL allow multiple applications to use that logic without including another application's headers or depending on a JUCE waveform component.

#### Scenario: MiniApp preserves waveform behavior
- **WHEN** MiniApp migrates from its app-local scope draw math to the shared helper
- **THEN** equivalent scope snapshots and bounds produce equivalent waveform paths, colors, and clipping behavior

#### Scenario: Braid uses independent waveform bounds
- **WHEN** Braid supplies audible and LFO scope channels with non-overlapping panel bounds
- **THEN** the helper produces independently bounded waveform command sets for every supplied channel
- **AND** it does not overlay one channel into another channel's panel

#### Scenario: Shared helper remains JUCE-free
- **WHEN** a synth test includes the shared waveform builder and constructs commands from a fake scope snapshot
- **THEN** it compiles and runs without JUCE headers

### Requirement: sru-22 — Braid 4: waveform and encoder main screen
WHEN the Braid 4 application surface is visible, THE runtime UI SHALL show four audible VCO waveform panels in a 2x2 grid stacked above four LFO waveform panels in a second 2x2 grid, all sixteen cells of its unique bank slot in a 4x4 encoder grid, and one compact global scene strip with selectors for scenes `0/1` plus the shared blend fader; SHALL bind encoder cells in row-major order to slot `0` positions `0..15`; SHALL reflect the currently selected Braid, matrix, LFO, or LFO matrix bank through the existing slot UI state; and SHALL keep both complete waveform grids, the encoder grid, and the scene strip visible without scrolling at the default application size.

#### Scenario: Four waveforms occupy a 2x2 grid
- **WHEN** Braid's default screen is built
- **THEN** oscillator 1, 2, 3, and 4 draw in the top-left, top-right, bottom-left, and bottom-right waveform panels respectively
- **AND** each panel reads its corresponding published VCO UI state and scope channel

#### Scenario: Four LFO waveforms occupy a second 2x2 grid
- **WHEN** Braid's default screen is built
- **THEN** LFO oscillator 1, 2, 3, and 4 draw in a second 2x2 grid below the audible VCO grid
- **AND** each panel reads its corresponding published LFO UI state and scope channel

#### Scenario: Sixteen encoders occupy a 4x4 grid
- **WHEN** Braid's default screen is built
- **THEN** it contains sixteen encoder nodes arranged as four rows of four
- **AND** node `n` dispatches turns and pushes to slot `0`, position `n`

#### Scenario: Reserved positions use shared disconnected encoder state
- **WHEN** the Braid bank is active
- **THEN** encoder nodes `2` and `3` remain present and interactive for slot `0` positions `2` and `3`
- **AND** they use the shared encoder renderer's empty disconnected draw-command state
- **AND** the remaining fourteen nodes render their parameter names, configured color, value state, and native voice indicators

#### Scenario: All four banks reuse the same encoder grid
- **WHEN** any of the audible Braid, audible matrix, LFO Braid, or LFO matrix banks becomes active through the existing bank-selection message path
- **THEN** all sixteen encoder nodes update to the active bank's parameters
- **AND** no second encoder slot or second encoder grid is created

#### Scenario: Scene strip remains global across banks
- **WHEN** the user selects either scene or changes blend and then switches between Braid and matrix banks
- **THEN** the same scene endpoints and blend remain displayed and active
- **AND** the UI creates no bank-local scene selector or fader

#### Scenario: Visual treatment carries astronomical character
- **WHEN** Braid's surface draws its default background and panels
- **THEN** it uses a near-black deep-space treatment with red audible VCO waveform/control accents, green LFO waveform/control accents, orange audible matrix accents, and yellow/green-yellow LFO matrix accents
- **AND** all text and control state remain legible through the portable UI backend

### Requirement: sru-23 — Portable encoder consumes complete parameter snapshot
WHEN a portable synth surface builds an encoder, THE runtime UI layer SHALL derive its complete encoder draw state from one `Parameter::UIState` without app-supplied parameter, indicator, modulation-source, gesture, bank, or scope palette arguments.

#### Scenario: Shared builder is app independent
- **WHEN** Braid 4 and MiniApp build encoders from visible slot cells
- **THEN** both call the same reusable encoder-state and drawing functions
- **AND** neither app contains a color reconstruction or post-snapshot override

### Requirement: sru-24 — Modulation view: visualizer beneath encoder
WHEN a portable encoder grid renders a connected modulation-depth cell whose complete `Parameter::UIState` publishes a non-null visible visualizer, THE runtime UI layer SHALL assign that visualizer bounds exactly equal to the encoder cell's square, append a stable visualizer draw node before the encoder node, and append the existing interactive encoder node above it using the portable tree contract that later overlapping nodes draw above earlier overlapping nodes; WHEN the published pointer is null or the visualizer is intrinsically hidden, THE runtime UI layer SHALL render only the existing encoder node.

#### Scenario: Visualizer and encoder share a square
- **WHEN** a visible modulation-depth cell has square encoder bounds and a visible visualizer
- **THEN** the portable tree contains a visualizer draw node with exactly the encoder bounds
- **AND** the encoder draw node follows it in stacking order with the same bounds

#### Scenario: Encoder remains interactive above visualizer
- **WHEN** a visualizer is rendered beneath an encoder
- **THEN** the encoder retains its existing drag and double-click actions
- **AND** the display-only visualizer exposes no competing pointer action

#### Scenario: Missing visualizer preserves existing rendering
- **WHEN** a visible modulation-depth cell publishes a null visualizer pointer
- **THEN** the tree contains the same encoder node and encoder commands as before this capability
- **AND** contains no visualizer node for that cell

#### Scenario: Top-level cells do not infer source visualizers
- **WHEN** the encoder grid shows an ordinary top-level parameter rather than a materialized modulation-depth control
- **THEN** it renders the encoder without looking up or inferring a visualizer from group topology

### Requirement: sru-25 — Encoder grid: translucent visualizer underlays
WHEN a portable encoder grid renders an encoder node above a visible visualizer underlay, THE runtime UI layer SHALL request the shared encoder draw builder to use an underlay-aware body style whose central body fill is partially translucent while preserving the encoder's existing strokes, arcs, badges, labels, and pointer actions; WHEN no visible visualizer underlay is present, THE runtime UI layer SHALL preserve the existing opaque encoder body style.

#### Scenario: Underlay-backed encoder body is translucent
- **WHEN** a connected encoder draw state indicates a visible visualizer underlay
- **THEN** the encoder draw commands use a partially transparent central body fill
- **AND** retain the existing readable encoder outline and value commands

#### Scenario: Ordinary encoder body remains opaque
- **WHEN** a connected encoder draw state does not indicate a visible visualizer underlay
- **THEN** the encoder draw commands preserve the existing opaque central body fill

#### Scenario: Hidden visualizer does not affect encoder style
- **WHEN** a cell publishes a visualizer pointer whose visualizer is hidden
- **THEN** the portable encoder grid renders no visualizer node
- **AND** requests the ordinary opaque encoder body style

#### Scenario: Underlay styling is shared, not MiniApp drawing
- **WHEN** MiniApp or Braid 4 builds an encoder cell with a visible visualizer pointer
- **THEN** the app surface only marks the shared encoder draw state as having an underlay
- **AND** the alpha choice remains inside shared portable encoder drawing code

### Requirement: sru-26 — Controllers page: absolute encoder mode editing
WHEN an encoder input configuration is presented or edited through the Controllers page, THE runtime library SHALL expose one non-deletable `Encoder mode` config-level row whose declaration-order choices are signed-7-bit, direction-only, and absolute; SHALL edit and flush the selected `EncoderMode` through the existing open-section edit session; SHALL preserve the stored `turnStep` while absolute mode is selected and identify that it affects relative modes only; and SHALL rebuild the live controller processor with the committed mode without re-coalescing or replacing the open session.

#### Scenario: Absolute mode is selectable
- **WHEN** the user edits an encoder input's `Encoder mode` row and selects the third catalog entry
- **THEN** the session row and persisted controller config use `EncoderMode::Absolute`
- **AND** the live-edit rebuild creates an absolute encoder input processor

#### Scenario: Absolute mode survives session flush and rebuild
- **WHEN** an open encoder section commits absolute mode and the view model rebuilds while that section remains open
- **THEN** the same session row remains visible in place and displays absolute mode
- **AND** the persisted controller config remains absolute

#### Scenario: Turn step is retained but ignored by absolute mode
- **WHEN** a controller has a non-default `turnStep` and the user changes its encoder mode from relative to absolute
- **THEN** the Controllers page preserves the stored `turnStep`
- **AND** identifies it as a relative-mode setting
- **AND** changing the absolute encoder position does not apply that step

#### Scenario: Switching back restores relative configuration
- **WHEN** the user changes an absolute encoder input back to signed-7-bit or direction-only mode
- **THEN** subsequent CC input uses the previously stored `turnStep`

#### Scenario: Encoder mode row is not deletable
- **WHEN** the encoder section presents the `Encoder mode` config-level row
- **THEN** the row exposes no delete affordance

### Requirement: sru-27 — Controllers page: Note/CC button address editing

WHEN the Controllers page edits encoder push mappings or Generic controller system-message mappings, THE runtime UI layer SHALL expose a Note/CC selector
with numeric channel and message-number fields, SHALL use numeric note values
rather than musical note names, SHALL omit the selector from encoder turns,
analog mappings, and controller-specific system-message address schemas, and
SHALL commit the selected message type through the existing config edit path.

#### Scenario: Encoder push row selects note

- **WHEN** a user changes an encoder push row from CC to Note and enters channel `1` and number `60`
- **THEN** the committed push mapping is note `60` on channel `1`
- **AND** the row displays the note as numeric value `60`

#### Scenario: Generic system-message row selects note

- **WHEN** a Generic controller system-message row is shown
- **THEN** the row includes the Note/CC selector, channel field, and numeric message-number field

#### Scenario: CC-only rows omit the selector

- **WHEN** an encoder turn, analog mapping, or non-Generic controller-specific system-message row is shown
- **THEN** that row does not offer note addressing

#### Scenario: Blocks do not mix message types

- **WHEN** adjacent button mappings have otherwise contiguous fields but one is CC and one is Note
- **THEN** the Controllers page does not coalesce them into one block row

#### Scenario: Block message type round trips

- **WHEN** a Note encoder-push block or Generic system-message block is expanded and committed
- **THEN** every resulting mapping retains the Note message type

### Requirement: sru-28 — Controllers page: grid buttons and blocks
WHEN a WRLD.Bldr or Launchpad controller's system mappings target button-grid messages, THE runtime UI SHALL present each exact press/release/feedback plus polyphonic-pressure pair as one user-visible grid button or maximal rectangular grid block, SHALL expose the target grid-slot index and the existing kind-specific signed physical x/y range with exclusive maxima, SHALL map physical `(x,y)` directly to the same logical grid coordinate, SHALL always derive press, release, pressure-change, and feedback mappings together on commit, SHALL offer no toggle or aftertouch controls, and SHALL preserve unknown pressure mappings invisibly and losslessly through open-section editing and persistence.

#### Scenario: Grid block expands all input behavior
- **WHEN** the user commits a Launchpad grid block for slot `1` over `[0,8) x [-1,7)`
- **THEN** the profile receives one system association per coordinate with paired `GridPress` and `GridRelease` and grid feedback
- **AND** receives one matching derived polyphonic-pressure mapping per coordinate
- **AND** every range maximum is treated as exclusive

#### Scenario: Single grid button hides MIDI mechanics
- **WHEN** one exact grid mapping is presented individually
- **THEN** the row identifies it as one grid button with controller address and target grid slot
- **AND** it exposes no toggle, note number, MIDI status, aftertouch, or pressure-mapping row

#### Scenario: Exact mappings reconstruct to one block
- **WHEN** canonical system and pressure config contains a uniform rectangular run of matching grid mappings
- **THEN** collapsing and reopening the section reconstructs the maximal grid block
- **AND** expanding that block reproduces the canonical underlying mappings exactly

#### Scenario: Negative coordinates round-trip
- **WHEN** a grid block includes y `-1` and has exclusive maximum y `7`
- **THEN** its row, edit session, expansion, JSON persistence, and reconstruction preserve the signed coordinates

#### Scenario: Grid mappings are always momentary
- **WHEN** a grid button or block is added or edited
- **THEN** the view model generates press and release messages as a pair
- **AND** offers no toggle variant

#### Scenario: Orphan pressure data is preserved but hidden
- **WHEN** externally authored profile config contains a pressure mapping that does not exactly pair with a grid system association
- **THEN** the Controllers page shows no aftertouch line item for it
- **AND** opening, editing an unrelated row, committing, and saving preserves that mapping unchanged

#### Scenario: Pair edit is atomic
- **WHEN** a grid block edit would create an invalid controller address, duplicate address, invalid signed rectangle, or unrepresentable logical target
- **THEN** the commit is refused with a reason
- **AND** neither its system associations nor pressure mappings change

### Requirement: sru-29 — Controllers page: grid mapping model coverage
WHEN grid mapping presentation is tested, THE synth runtime UI test suite SHALL cover pure expansion/reconstruction, profile JSON round trips, open-session edit stability, add/delete operations, signed exclusive ranges, hidden pressure sidecars, and deterministic seeded simulation against an independent model without requiring JUCE or physical MIDI devices.

#### Scenario: Pure model builds without JUCE
- **WHEN** a headless test constructs grid singleton and block rows for WRLD.Bldr and Launchpad profiles
- **THEN** it compiles and runs without JUCE headers
- **AND** produces the expected paired system and pressure config

#### Scenario: Seeded simulation preserves paired mappings
- **WHEN** a deterministic simulation adds, edits, deletes, opens, closes, and reconstructs grid rows and blocks
- **THEN** every visible grid row has exactly one matching pressure entry per cell
- **AND** unknown hidden pressure entries remain equal to the independent oracle

#### Scenario: Renderer never exposes aftertouch
- **WHEN** the portable Controllers tree and JUCE renderer are built from a profile containing grid pressure mappings
- **THEN** visible labels and editable fields contain grid button/block concepts
- **AND** contain no standalone aftertouch or polyphonic-pressure line item
