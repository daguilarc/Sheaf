## MODIFIED Requirements

### Requirement: sru-6 — File page: patch commands
WHEN the File page is open, THE runtime library SHALL present the patch commands (new, save, save-as, load, revert) in a polished page layout with a current-patch identity header, runtime patch-root/path context, and last command/browser status, replacing the former shell chrome row; Save with no current patch directory SHALL fall through to the in-app Save As flow; Save As and Load SHALL open the dedicated in-app patch-browser viewer rooted at the runtime-owned `patches/` directory rather than an operating-system file explorer.

#### Scenario: File page carries patch identity
- **WHEN** a patch is saved-as or loaded
- **THEN** the File page shows that patch's name and the command status in the page header/status area

#### Scenario: First save falls through
- **WHEN** the user presses Save before any patch directory exists
- **THEN** the in-app Save As browser viewer opens instead of an error

#### Scenario: Patch browser stays under patches root
- **WHEN** the user browses, saves-as, or loads from the File page
- **THEN** every selectable or creatable patch directory is resolved under the runtime-owned `patches/` directory
- **AND** the UI exposes no arbitrary absolute filesystem picker

#### Scenario: File page layout remains intentional while idle
- **WHEN** no Save As or Load browser viewer is open
- **THEN** the File page still shows the patch identity header, command strip, and status/empty-state region without leaving a rough blank or cramped chooser area

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
- **THEN** it can inspect rows, navigate, cancel, enter save names, and confirm valid paths without JUCE headers
- **AND** the JUCE runtime File page host contains no `juce::FileChooser` usage

#### Scenario: Browser nodes are spliced into one File page tree
- **WHEN** the File page portable tree is built while the browser viewer is open
- **THEN** the tree contains exactly one root node for the File page surface
- **AND** browser rows and controls are descendants of the File page browser section rather than a nested root surface

#### Scenario: JUCE backend renders a polished browser viewer
- **WHEN** the JUCE backend renders the File page portable tree with a browser open
- **THEN** it renders the browser as a full flat viewer region with stable controls, visible selected-row treatment, readable labels/status text, row double-click actions, and primary/cancel actions that remain inside their parent bounds after resize
- **AND** File page behavior remains owned by the portable surface rather than by JUCE-only callbacks

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

## ADDED Requirements

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
