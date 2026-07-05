# synth-runtime-ui Delta

Project: `projects/synth`. ID prefix: `sru`.

## MODIFIED Requirements

### Requirement: sru-6 — File page: patch commands
WHEN the File page is open, THE runtime library SHALL present the patch commands (new, save, save-as, load, revert) with the current patch name and last command status, replacing the former shell chrome row; Save with no current patch directory SHALL fall through to the in-app Save As flow; Save As and Load SHALL use an in-app patch browser rooted at the runtime-owned `patches/` directory rather than an operating-system file explorer.

#### Scenario: File page carries patch identity
- **WHEN** a patch is saved-as or loaded
- **THEN** the File page shows that patch's name and the command status

#### Scenario: First save falls through
- **WHEN** the user presses Save before any patch directory exists
- **THEN** the in-app Save As flow opens instead of an error

#### Scenario: Patch browser stays under patches root
- **WHEN** the user browses, saves-as, or loads from the File page
- **THEN** every selectable or creatable patch directory is resolved under the runtime-owned `patches/` directory
- **AND** the UI exposes no arbitrary absolute filesystem picker

## ADDED Requirements

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
WHEN the File page enters Save As or Load flow, THE runtime library SHALL render a root-scoped in-app patch browser over the runtime-owned `patches/` directory, listing patch directories in deterministic order, allowing relative navigation within that root, allowing creation of a named patch directory for Save As, and selecting an existing patch directory for Load.

#### Scenario: Browser lists patch directories deterministically
- **WHEN** the patch root contains multiple patch directories
- **THEN** the in-app browser lists them in deterministic filename order
- **AND** non-patch version files at the root are not presented as loadable patches

#### Scenario: Save As creates patch directory under root
- **WHEN** the user enters a new patch name in the in-app Save As flow
- **THEN** the runtime creates the corresponding patch directory under the runtime-owned `patches/` directory
- **AND** writes the first patch version file there through the patch manager

#### Scenario: Load selects patch directory under root
- **WHEN** the user confirms an existing patch directory in the in-app Load flow
- **THEN** the runtime asks the patch manager to load that directory
- **AND** the patch manager selects the latest sortable version file in that directory

#### Scenario: Browser cannot escape root
- **WHEN** a browser navigation or typed patch name contains an absolute path or `..`
- **THEN** the runtime rejects that target
- **AND** no file outside the runtime-owned `patches/` directory is read or written
