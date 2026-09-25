# Delta — `synth-runtime-ui`

sru-71 is added.

## ADDED Requirements

### Requirement: sru-71 — Controllers page: Audio to MIDI section
WHEN the running app's catalog lists MIDI-out contents (smi-19), THE Controllers page SHALL show one Audio to MIDI section, separate from the controller rows, with a port choice (None and every present MIDI output), a Sends choice (Off and the catalog's contents), a Channel field covering the sixteen MIDI channels, numbered 0 to 15, the same construct and numbering every channel field already on this page uses, a CC field (0 to 127) shown while the chosen content sends Control Change, and a Velocity field (Level, or a fixed 1 to 127) shown while the chosen content sends notes, and SHALL save each committed edit as the runtime configuration's MIDI-out setting (sar-36) as it is made, through the same commit-then-save step every Controllers-page edit takes (sru-64), so leaving the page by Back saves nothing further, as sru-12 states for this page.

The section starts at port None and Sends Off; the Channel, CC and Velocity fields hold defaults, not presets.

The Channel field numbers the sixteen channels 0 to 15, the same construct every channel field already on this page uses; the section is titled "Audio to MIDI", naming what it sends, and each controller row's output-port choice keeps its existing "MIDI out" caption.

The section sits on the Controllers page because the browser requests MIDI access only from that page: the active Sheaf change `gate-browser-midi-on-controllers` makes the Controllers sidebar action the one dispatched action that starts Web MIDI, apart from a grant the browser already holds. A port choice on any other page would list no ports for a player who has never opened Controllers. The port choice and each controller row's input-port and output-port choices are emitted by one shared layout function, so all show the same online/offline status dot and the same kind of option list and cannot drift.

#### Scenario: A new configuration shows Off and None
- **WHEN** the Controllers page opens with no saved MIDI-out setting
- **THEN** the Audio to MIDI section shows port None, Sends Off, channel 0, and no CC or Velocity field
- Check: `tests/controllers_page_ui_tests.cpp: TestAppMidiOutSectionShowsOffAndNoneByDefault`

#### Scenario: The fields follow the chosen content
- **WHEN** Sends is set to a content that sends Control Change
- **THEN** the CC field shows 16 and no Velocity field is shown
- **WHEN** Sends is set to a content that sends notes
- **THEN** the Velocity field shows Level and no CC field is shown
- Check: `tests/controllers_page_ui_tests.cpp: TestAppMidiOutFieldsFollowTheChosenContent`

#### Scenario: An out-of-range entry is refused
- **WHEN** a channel outside the sixteen channels in the field's numbering, or 128 as the CC number, or 0 as a fixed velocity is entered
- **THEN** the stored value is unchanged and the field shows the stored value again
- Check: `tests/controllers_page_ui_tests.cpp: TestAppMidiOutOutOfRangeEntryIsRefused`, `tests/controllers_page_ui_tests.cpp: TestAppMidiOutCcCommitLandsAndSavesOnce`

#### Scenario: A committed MIDI-out edit is saved at once
- **WHEN** the port, Sends, channel or CC is changed and the edit is committed, with no Back pressed
- **THEN** the saved runtime configuration holds the new MIDI-out setting
- Check: `tests/controllers_page_ui_tests.cpp: TestAppMidiOutCommittedEditIsSavedAtOnce`, `tests/controllers_page_ui_tests.cpp: TestAppMidiOutCcCommitLandsAndSavesOnce`

#### Scenario: An offline port is shown offline and kept
- **WHEN** the saved MIDI-out port is not present
- **THEN** the port choice still names it, with the offline status dot, and the setting is not cleared
- Check: `tests/controllers_page_ui_tests.cpp: TestAppMidiOutOfflinePortIsShownOfflineAndKept`
