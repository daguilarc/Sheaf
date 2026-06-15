# Capability: Launchpad

Project: `projects/dictator`
ID prefix: `lp` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The service drives a Novation Launchpad Pro Mk3 as a hardware control
surface: pads toggle dictation (standard and auxiliary-prompt modes), control
the full Talon installation, inject macOS keystrokes, send contextual
backspace, latch Shift, and
restore safe runtime config. Dictation results are inserted into the active
macOS application via synthetic paste. This is the service-side replacement
for the legacy AppKit Launchpad UI; there is no native window or overlay.
## Requirements
### Requirement: lp-1 — Lifecycle and layout: Load layout on start
WHEN the service starts, THE Launchpad controller SHALL load the layout from `projects/dictator/src/launchpad/launchpad-layout.json` (falling back to `projects/dictator/tests/fixtures/launchpad-layout.json`), build pages, and start MIDI discovery; IF the layout is missing or invalid, THEN the controller SHALL log the failure and stay inactive while the rest of the service runs normally.

#### Scenario: Layout found and valid
- **WHEN** the service starts and the layout file is present and valid
- **THEN** the controller loads the layout, builds pages, and starts MIDI discovery

#### Scenario: Layout missing or invalid
- **WHEN** the service starts and the layout is missing or invalid
- **THEN** the controller logs the failure and stays inactive while the rest of the service runs normally

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

### Requirement: lp-4 — Lifecycle and layout: Controller shutdown
WHEN the service stops, THE controller SHALL cancel any active dictation task, stop an in-progress recording, and shut down the render worker and MIDI connection.

#### Scenario: Service stops
- **WHEN** the service stops
- **THEN** the controller cancels any active dictation task, stops any in-progress recording, and shuts down the render worker and MIDI connection

### Requirement: lp-5 — Lifecycle and layout: Accessibility permission
IF Accessibility permission is missing at startup or when a key dispatch fails, THEN THE controller SHALL trigger the macOS permission prompt and log the failure; keystroke and insertion features require that permission, dictation recording requires microphone permission.

#### Scenario: Accessibility permission missing at startup
- **WHEN** Accessibility permission is missing at startup
- **THEN** the controller triggers the macOS permission prompt and logs the failure

#### Scenario: Key dispatch fails due to missing permission
- **WHEN** a key dispatch fails due to missing Accessibility permission
- **THEN** the controller triggers the macOS permission prompt and logs the failure

### Requirement: lp-6 — Dictation pads: Dictation state and record-status pad
THE controller SHALL keep one dictation state — `idle`, `recording`, `thinking` — and render it on the `record_status` pad: white when idle, red while recording, blue while thinking; `toggle` starts recording when idle, stops-and-processes when recording, and cancels processing when thinking; `start`/`stop`/`cancel` apply only in the matching state.

#### Scenario: Idle state
- **WHEN** the dictation state is `idle`
- **THEN** the `record_status` pad renders white and `toggle` starts recording

#### Scenario: Recording state
- **WHEN** the dictation state is `recording`
- **THEN** the `record_status` pad renders red and `toggle` stops-and-processes

#### Scenario: Thinking state
- **WHEN** the dictation state is `thinking`
- **THEN** the `record_status` pad renders blue and `toggle` cancels processing

### Requirement: lp-7 — Dictation pads: Recording start
WHEN recording starts, THE controller SHALL capture 16 kHz mono 16-bit PCM WAV from the default input and snapshot dictation context: frontmost app/site context plus the current selection captured via a synthetic Cmd+C (≤ 12 000 chars, 0.25 s pasteboard wait, prior clipboard restored).

#### Scenario: Recording starts
- **WHEN** recording starts
- **THEN** the controller captures 16 kHz mono 16-bit PCM WAV from the default input and snapshots the frontmost app/site context plus the current selection via synthetic Cmd+C (≤ 12 000 chars, 0.25 s pasteboard wait, prior clipboard restored)

### Requirement: lp-8 — Dictation pads: Standard and auxiliary recording stop
WHEN recording stops in standard mode, THE controller SHALL run the same in-process pipeline as HTTP dictation ([dictation-pipeline](../dictator-dictation-pipeline/spec.md)) with the system locale and the captured context; auxiliary pads run the identical flow with the prompt file from `auxiliary_system_prompt_1`/`_2` (slot 1/2) substituted for the primary system prompt.

#### Scenario: Recording stops in standard mode
- **WHEN** recording stops in standard mode
- **THEN** the controller runs the in-process dictation pipeline with the system locale and captured context

#### Scenario: Recording stops in auxiliary mode
- **WHEN** recording stops in auxiliary mode
- **THEN** the controller runs the identical flow with the prompt file from `auxiliary_system_prompt_1`/`_2` (slot 1/2) substituted for the primary system prompt

### Requirement: lp-10 — Dictation pads: Result insertion
WHEN a dictation produces non-empty revised text, THE controller SHALL insert it into the active target by writing the pasteboard and posting synthetic Cmd+V, then restore the previous pasteboard contents (~0.1 s later); empty revised text skips insertion.

#### Scenario: Non-empty revised text
- **WHEN** a dictation produces non-empty revised text
- **THEN** the controller inserts it into the active target by writing the pasteboard and posting synthetic Cmd+V, then restores the previous pasteboard contents (~0.1 s later)

#### Scenario: Empty revised text
- **WHEN** a dictation produces empty revised text
- **THEN** insertion is skipped

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

### Requirement: lp-12 — Dictation pads: Activity tracker
WHILE a Launchpad dictation is processing, THE controller SHALL mark the shared activity tracker so `GET /api/status` reports `dictation_state: "processing"`.

#### Scenario: Dictation processing
- **WHEN** a Launchpad dictation is processing
- **THEN** the shared activity tracker is marked so `GET /api/status` reports `dictation_state: "processing"`

### Requirement: lp-13 — Keystrokes, backspace, shift latch, safe config: Keystroke pad
WHEN a `keystroke` pad is pressed, THE controller SHALL inject the configured key with the configured modifiers through CoreGraphics events; supported keys are `tab`, `up`, `down`, `left`, `right`, `enter`, `backspace`, `space`, `c`, `v`, `x`, `z`, `f13`–`f20`; supported modifiers are `shift`, `command`, `option`, `control`. Keystroke and contextual-backspace pads auto-repeat while held (0.30 s initial delay, 0.05 s interval); dictation/config pads do not repeat.

#### Scenario: Keystroke pad pressed
- **WHEN** a `keystroke` pad is pressed
- **THEN** the controller injects the configured key with the configured modifiers through CoreGraphics events, auto-repeating while held (0.30 s initial delay, 0.05 s interval)

### Requirement: lp-14 — Keystrokes, backspace, shift latch, safe config: Contextual backspace
WHEN the contextual-backspace pad is pressed, THE controller SHALL cancel the recording when recording, cancel processing when thinking, and otherwise inject Backspace.

#### Scenario: Contextual backspace pressed while recording
- **WHEN** the contextual-backspace pad is pressed while recording
- **THEN** the controller cancels the recording

#### Scenario: Contextual backspace pressed while thinking
- **WHEN** the contextual-backspace pad is pressed while thinking
- **THEN** the controller cancels processing

#### Scenario: Contextual backspace pressed while idle
- **WHEN** the contextual-backspace pad is pressed while idle
- **THEN** the controller injects Backspace

### Requirement: lp-15 — Keystrokes, backspace, shift latch, safe config: Shift latch
THE shift-latch pad SHALL hold Shift while pressed and latch it on release if no non-arrow key was sent during the hold; WHILE latched, arrow keys keep Shift applied and the latch persists, and the first non-arrow key consumes the latch; the pad renders dim yellow (50,50,0) when unlatched and bright yellow (255,220,0) when held or latched.

#### Scenario: Pad pressed with no non-arrow key sent
- **WHEN** the shift-latch pad is released and no non-arrow key was sent during the hold
- **THEN** Shift is latched, arrow keys keep Shift applied, and the pad renders bright yellow (255,220,0)

#### Scenario: Latch active, non-arrow key pressed
- **WHEN** a non-arrow key is pressed while Shift is latched
- **THEN** the latch is consumed

#### Scenario: Pad unlatched
- **WHEN** the shift-latch pad is unlatched
- **THEN** the pad renders dim yellow (50,50,0)

### Requirement: lp-16 — Keystrokes, backspace, shift latch, safe config: Safe runtime config restore
WHEN the `load_safe_runtime_config` pad is pressed while idle, THE controller SHALL restore startup defaults to `config/dictator.json` (same operation as `POST /api/config/reset`) and apply the restored interaction-buffer size; WHILE recording or thinking the press is ignored (`launchpad safe runtime restore skipped: busy`).

#### Scenario: Safe config pad pressed while idle
- **WHEN** the `load_safe_runtime_config` pad is pressed while idle
- **THEN** the controller restores startup defaults to `config/dictator.json` and applies the restored interaction-buffer size

#### Scenario: Safe config pad pressed while busy
- **WHEN** the `load_safe_runtime_config` pad is pressed while recording or thinking
- **THEN** the press is ignored (`launchpad safe runtime restore skipped: busy`)

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

### Requirement: lp-24 — External cells: WebSocket RPC ownership
WHEN the WebSocket RPC layer owns one or more Launchpad cells, THE Launchpad controller SHALL render the RPC-supplied colors for those cells, route press and release events for those cells to the RPC layer, and prevent owned cells from dispatching static layout actions.

#### Scenario: RPC-owned cell renders supplied color
- **WHEN** a WebSocket RPC client owns `(3,3)` and supplies a grey color
- **THEN** the Launchpad controller renders `(3,3)` grey

#### Scenario: RPC-owned cell press routed externally
- **WHEN** the user presses a WebSocket RPC-owned cell
- **THEN** the Launchpad controller routes the press to the RPC layer and does not dispatch a static layout action

#### Scenario: RPC ownership removed
- **WHEN** the WebSocket RPC layer releases ownership of a cell
- **THEN** the Launchpad controller returns that cell to the normal static-layout or off rendering behavior

### Requirement: lp-25 — External cells: Agent review controls move to generic RPC ownership
THE Launchpad controller SHALL NOT treat `(2,7)` as a review control and SHALL NOT implement built-in review, hunk-navigation, stage, revert, or undo behavior at the Agent Review coordinates; all Sheaf Chat Agent Review controls — hunk navigation, stage, revert, undo, and the review/comment/post cell — SHALL be provided through WebSocket RPC cell ownership and generic cell events, with Dictator rendering only the supplied colors and routing only the generic press/release events.

#### Scenario: Coordinate two seven removed from review workflow
- **WHEN** the user presses `(2,7)`
- **THEN** Dictator does not start review recording, post a review, or otherwise treat `(2,7)` as part of the review workflow

#### Scenario: Coordinate three three owned
- **WHEN** `(3,3)` is owned by Sheaf Chat over WebSocket RPC
- **THEN** Dictator sends generic cell press and release events for the Sheaf Chat review/comment/post Launchpad cell

#### Scenario: Hunk navigation and mutation cells owned externally
- **WHEN** Sheaf Chat owns the hunk navigation, stage, revert, and undo cells over WebSocket RPC
- **THEN** Dictator renders their supplied colors and sends generic cell press and release events without performing any hunk navigation, staging, reverting, or undo itself

## Contracts

### Layout file — `src/launchpad/launchpad-layout.json`

```json
{
  "initial_page_id": "arrows",
  "pages": [
    {
      "id": "arrows",
      "pads": [
        { "x": 0, "y": 7, "role": "record_status",
          "color": { "r": 255, "g": 255, "b": 255 },
          "action": { "type": "dictation", "command": "toggle" } },
        { "x": 0, "y": 6, "color": { "r": 90, "g": 90, "b": 255 },
          "action": { "type": "auxiliary_dictation", "command": "toggle", "prompt_slot": 1 } },
        { "x": 1, "y": 7, "role": "talon_status", "color": { "r": 255, "g": 170, "b": 0 },
          "action": { "type": "talon_control", "command": "toggle" } },
        { "x": -1, "y": 0, "color": { "r": 0, "g": 180, "b": 255 },
          "action": { "type": "load_safe_runtime_config" } },
        { "x": 5, "y": 6, "role": "shift_latch",
          "color": { "r": 255, "g": 220, "b": 0 },
          "action": { "type": "modifier_latch", "modifier": "shift" } },
        { "x": 4, "y": 4, "color": { "r": 50, "g": 160, "b": 80 },
          "action": { "type": "keystroke", "key": "c", "modifiers": ["command"] } },
        { "x": 7, "y": 5, "color": { "r": 255, "g": 120, "b": 0 },
          "action": { "type": "contextual_backspace" } }
      ]
    }
  ]
}
```

Roles: `record_status` (color driven by dictation state), `talon_status`
(color driven by Talon control state), and `shift_latch` (color driven by
latch state); pads without a role render their static
`color`. The shipped product layout binds: primary/auxiliary dictation
toggles, the Talon control pad, safe-config restore, shift latch, contextual backspace,
Space, Enter, arrows, and Cmd+C/V/X/Z. The coordinate `(2,7)` is reserved for
the voice diff review control layer and is not a static keystroke pad.

### Pinned dictation-state colors

| State | record_status pad |
|---|---|
| idle | white (255,255,255) |
| recording | red (255,0,0) |
| thinking | blue (0,0,255) |

## Design

- `src/Sources/DictatorService/LaunchpadServiceController.swift` —
  `@MainActor` controller owning dictation state, shift-latch state machine,
  context capture, pipeline invocation, insertion, and interaction
  recording. Auxiliary-prompt runs build a one-off
  `ProviderRoutingRefinementEngine` with the override prompt body so the
  persisted config is untouched.
- `src/Sources/DictatorService/LaunchpadDSL.swift` — layout decode +
  validation (`LaunchpadLayoutLoader`) and `LaunchpadPageFactory` (action
  dispatch, repeat behavior, status cells).
- `src/Sources/DictatorService/LaunchpadPage.swift`,
  `LaunchpadColorRenderWorker.swift`, `RenderInvalidationBus.swift`,
  `LaunchpadMIDIManager.swift`, `LaunchpadTypes.swift` — page/cell model,
  dirty-flag render loop, CoreMIDI transport (device discovery, programmer
  mode, sleep handling), pad coordinate/color primitives.
- `src/Sources/DictatorService/AudioRecorder.swift` — AVAudioRecorder WAV
  capture (16 kHz default), microphone permission flow;
  `RecordingController.swift` is the recording toggle flag.
- `src/Sources/DictatorService/ClipboardInserter.swift` — pasteboard
  snapshot/restore, synthetic Cmd+C selection capture and Cmd+V insert;
  `KeyboardInjector.swift` — CGEvent key synthesis + Accessibility checks;
  `ActiveTargetContextProvider.swift` — frontmost app/site context.
- `src/Sources/DictatorService/TalonControlClient.swift` — loopback HTTP
  client for the Talon bridge (status/wake/sleep) with awake/asleep/
  unavailable/error mapping; `LaunchpadTalonControlState.swift` — Talon
  control pad color and blocked-wake state. See
  [dictator-talon-control](../dictator-talon-control/spec.md).
- Tests: `tests/DictatorServiceTests/LaunchpadTests.swift` (layout decode and
  validation, page dispatch, render diffs, product-layout guard that pins
  which actions are bound and that legacy overlay/navigation actions stay
  absent), `LaunchpadAppCycleStateTests.swift`,
  `LaunchpadTalonControlStateTests.swift`, and
  `TalonControlClientTests.swift`.

## Interactions

- [dictation-pipeline](../dictator-dictation-pipeline/spec.md) — shares the STT engine,
  refinement routing, and orchestrator; Launchpad runs them in-process.
- [web-ui](../dictator-web-ui/spec.md) — Launchpad interactions appear in the dashboard
  history; the safe-config pad mirrors `POST /api/config/reset`.
- [service-lifecycle](../dictator-service-lifecycle/spec.md) — controller start/stop is tied
  to service start/shutdown.
- [Config contract](../../../projects/dictator/docs/contracts/config.md) — auxiliary prompt slots and
  safe-config restore source.
- [Interactions contract](../../../projects/dictator/docs/contracts/interactions.md) — record shape,
  including the `insert_ms` timing only this capability populates.
