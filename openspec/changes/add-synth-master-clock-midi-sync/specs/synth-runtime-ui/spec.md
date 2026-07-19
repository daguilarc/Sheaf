## MODIFIED Requirements

### Requirement: sru-2 — Sidebar: tabs and deadline readout
WHEN the sidebar renders, THE runtime library SHALL show Audio, Controllers, Sync, and File entries that open their pages in the content host, and a max-recent-deadline readout displaying the maximum audio callback load percentage over a rolling window of recent UI frames, updated on the UI timer.

#### Scenario: Tabs open their pages
- **WHEN** the user activates the Controllers entry
- **THEN** the Controllers page opens in the content host

#### Scenario: Sync tab opens its page
- **WHEN** the user activates the Sync entry in JUCE or Chrome
- **THEN** the portable Sync page opens in the content host

#### Scenario: Deadline readout holds recent peaks
- **WHEN** a single audio callback spikes the load percentage and later callbacks are cheap
- **THEN** the readout continues to display the spike value until it leaves the rolling window

### Requirement: sru-12 — Configuration pages: Back saves runtime configuration
WHEN the user dismisses a runtime configuration page with Back, THE runtime library SHALL save the current runtime configuration before returning to the application view for pages that edit persistent configuration, including the Audio, Controllers, and Sync pages.

#### Scenario: Audio Back saves configuration
- **WHEN** the user changes the audio device selection and presses Back on the Audio page
- **THEN** the runtime saves a configuration document containing the current audio device state
- **AND** returns to the application view

#### Scenario: Controllers Back saves configuration
- **WHEN** the user changes controller setup or mappings and presses Back on the Controllers page
- **THEN** the runtime saves a configuration document containing the current MIDI instrument/controller configuration
- **AND** returns to the application view

#### Scenario: Sync Back saves configuration
- **WHEN** the user changes a clock/transport send or receive toggle or PPQN and presses Back on the Sync page
- **THEN** the runtime applies the sync configuration through its audio-safe handoff, saves it in runtime configuration, and returns to the application view

#### Scenario: File Back does not save runtime configuration
- **WHEN** the user presses Back on the File page
- **THEN** the runtime returns to the application view without writing runtime configuration solely because the File page was dismissed

## ADDED Requirements

### Requirement: sru-30 — Sync page: portable clock configuration and status
WHEN the runtime Sync page is open, THE runtime library SHALL render through the shared portable UI a send-clock toggle, receive-clock toggle, send-transport toggle, receive-transport toggle, integer PPQN control limited to `1..960`, Back action, and read-only current BPM, lock state, active-source, output-latency, ignored-input, late-event, and dropped-output status; edits SHALL stage in JUCE-free page state and commit through generic host services without application-specific or host-specific UI logic.

#### Scenario: Defaults are safe and standard
- **WHEN** the Sync page opens for a runtime with no saved sync configuration
- **THEN** all four toggles are off and PPQN is 24

#### Scenario: Invalid PPQN is refused in the page
- **WHEN** an action attempts to set PPQN below 1 or above 960
- **THEN** the page retains its prior valid value and shows an inline validation status

#### Scenario: External lock is visible
- **WHEN** MasterClock is locked to a connected controller's external clock
- **THEN** the page shows Locked, that controller's name, and the recovered BPM

#### Scenario: Both hosts use one page model
- **WHEN** Sync controls are rendered and edited in JUCE and Chrome
- **THEN** both hosts use the same portable tree, action names, staged view model, and host-service commit path
- **AND** neither backend contains clock-policy logic

#### Scenario: Nonstandard PPQN is identified
- **WHEN** PPQN is set to a value other than 24
- **THEN** the page indicates that MIDI peers must be configured for the same nonstandard pulse density
