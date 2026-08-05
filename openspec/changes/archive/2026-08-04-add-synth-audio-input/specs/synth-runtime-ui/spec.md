## MODIFIED Requirements

### Requirement: sru-3 — Audio page: interface selection
WHEN the Audio page is open, THE runtime library SHALL let the user choose the audio output device and, when the application's config requests inputs, the input device from the host-provided choices with a system-default entry; SHALL apply selection through the runtime's audio device switching (sar-15); SHALL display the current output and negotiated status; and for input-capable applications SHALL display input permission/availability plus requested and active channel counts in the existing status line and expose `Retry Input` while browser capture is offline.

#### Scenario: Output selection applies
- **WHEN** the user selects an output device on the Audio page
- **THEN** the runtime switches to that device and the page reflects it as current

#### Scenario: Input row only when requested
- **WHEN** the application's config declares zero audio inputs
- **THEN** the Audio page shows no input device selector
- **AND** the page shows no input status or retry action

#### Scenario: Browser input status is explicit
- **WHEN** a browser-hosted application requests `N > 0` inputs
- **THEN** the page shows the System Default input selector
- **AND** its status line names the permission/availability state and reports `requested N / active M`
- **AND** it does not imply that input is monitored to output

#### Scenario: Offline browser input can be retried
- **WHEN** browser permission is denied, capture is unavailable, or an established stream ends
- **THEN** the page exposes a `Retry Input` action outside the realtime callback
- **AND** activating it dispatches the host-neutral retry action while the output page and application remain live

#### Scenario: JUCE input row keeps native choices
- **WHEN** a JUCE-hosted application requests one or more inputs
- **THEN** the page continues to show host-enumerated native input choices
- **AND** the current requested/active diagnostic remains visible through the portable status line
