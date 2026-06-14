## MODIFIED Requirements

### Requirement: lp-2 — Lifecycle and layout: Layout file decode shape
THE layout file SHALL decode as `{"initial_page_id"?, "pages": [{"id", "pads": [{"x", "y", "color": {r,g,b}, "role"?, "action"}]}]}`; validation rejects empty page lists, empty page ids, coordinates outside x ∈ [-1, 8] / y ∈ [-1, 9], `keystroke` actions without `key`, dictation actions without `command`, `auxiliary_dictation` without `command` and `prompt_slot` ∈ {1, 2}, `talon_control` without `command`, and `modifier_latch` without `modifier`.

#### Scenario: Valid layout file
- **WHEN** the layout file is present
- **THEN** it is decoded with the specified shape and validation rejects empty page lists, empty page ids, out-of-range coordinates, `keystroke` actions without `key`, dictation actions without `command`, `auxiliary_dictation` without `command` and `prompt_slot` ∈ {1, 2}, `talon_control` without `command`, and `modifier_latch` without `modifier`

### Requirement: lp-3 — Lifecycle and layout: Accepted action types
THE decoder SHALL accept action types `keystroke`, `dictation`, `auxiliary_dictation`, `talon_control`, `contextual_backspace`, `modifier_latch`, `load_safe_runtime_config`, `next_window`, `app_reload`, and `toggle_fullscreen_overlay`; the last three are decode-compatible no-ops in the service (a trace line explains why). Dictation and Talon-control commands are `start`, `stop`, `cancel`, `toggle`; the only modifier is `shift`.

#### Scenario: Accepted action types decoded
- **WHEN** the layout file is decoded
- **THEN** the decoder accepts all specified action types, treats `next_window`, `app_reload`, and `toggle_fullscreen_overlay` as no-ops with a trace line, accepts dictation and Talon-control commands `start`/`stop`/`cancel`/`toggle`, and accepts `shift` as the only modifier

### Requirement: lp-11 — Dictation pads: Interaction record
WHEN a Launchpad dictation completes or fails, THE controller SHALL append an interaction record ([interactions](../../../projects/dictator/docs/contracts/interactions.md)) with `request_source: "launchpad"` and a per-controller `session_id`; the stored mode is `text_replacement` when selected text was captured, `raw_dictation` when raw and revised text are equal after trimming, otherwise `revision`. Failures store mode `revision`, edit summary `Dictation pipeline failed.`, uncertainty flag `pipeline_error`, and the error text; cancellations record nothing.

#### Scenario: Dictation completes successfully
- **WHEN** a Launchpad dictation completes
- **THEN** the controller appends an interaction record with `request_source: "launchpad"`, a per-controller `session_id`, and the appropriate mode (`text_replacement`, `raw_dictation`, or `revision`)

#### Scenario: Dictation fails
- **WHEN** a Launchpad dictation fails
- **THEN** the controller appends an interaction record with mode `revision`, edit summary `Dictation pipeline failed.`, uncertainty flag `pipeline_error`, and the error text

#### Scenario: Dictation cancelled
- **WHEN** a Launchpad dictation is cancelled
- **THEN** no interaction record is recorded

### Requirement: lp-17 — Rendering and connection: Pad color rendering
THE controller SHALL render pad colors over MIDI (programmer mode), re-rendering everything on (re)connect and on wake; pressed pads render dimmed (each channel quartered); record-status, Talon-control, and shift-latch pads re-render on every relevant state change.

#### Scenario: Connect or wake
- **WHEN** the controller (re)connects or the system wakes
- **THEN** all pad colors are re-rendered over MIDI in programmer mode

#### Scenario: Pad pressed
- **WHEN** a pad is pressed
- **THEN** the pad renders dimmed (each channel quartered)

#### Scenario: State change
- **WHEN** the record-status, Talon-control, or shift-latch state changes
- **THEN** those pads re-render immediately

## ADDED Requirements

### Requirement: lp-22 — Talon control pad
THE Launchpad controller SHALL repurpose the former Talon Lite pad at `(1,7)` as a Talon control pad that toggles the full Talon installation through [dictator-talon-control](../dictator-talon-control/spec.md).

#### Scenario: Talon asleep
- **WHEN** the Talon control pad is pressed while Talon is asleep and Dictator is idle
- **THEN** the controller requests Talon wake through the Talon control client

#### Scenario: Talon awake
- **WHEN** the Talon control pad is pressed while Talon is awake
- **THEN** the controller requests Talon sleep through the Talon control client

#### Scenario: Talon unavailable
- **WHEN** the Talon control pad is pressed while the Talon bridge is unavailable
- **THEN** the controller logs that Talon control is unavailable and does not start Dictator dictation

#### Scenario: Dictator busy
- **WHEN** the Talon control pad is pressed while Dictator is recording or processing non-Talon dictation
- **THEN** the controller refuses to wake Talon and does not interrupt the active Dictator dictation

### Requirement: lp-23 — Talon control pad colors
THE Launchpad controller SHALL render the Talon control pad using dynamic status colors: green when Talon is awake, dim amber when Talon is asleep, red when Talon wake is blocked by active Dictator dictation, and grey when Talon control is unavailable or in error.

#### Scenario: Talon awake color
- **WHEN** Talon state is `awake`
- **THEN** the Talon control pad renders green

#### Scenario: Talon asleep color
- **WHEN** Talon state is `asleep`
- **THEN** the Talon control pad renders dim amber

#### Scenario: Talon blocked color
- **WHEN** Talon wake is blocked because Dictator is active
- **THEN** the Talon control pad renders red

#### Scenario: Talon unavailable color
- **WHEN** Talon control state is `unavailable` or `error`
- **THEN** the Talon control pad renders grey

## REMOVED Requirements

### Requirement: lp-9 — Dictation pads: Talon Lite recording stop
**Reason**: The Launchpad Talon Lite recording workflow is replaced by direct control of the full Talon installation.

**Migration**: Use the Talon control pad at `(1,7)` to wake or sleep Talon. Use normal Dictator dictation pads for Dictator-owned dictation.

