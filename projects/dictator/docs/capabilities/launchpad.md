# Capability: Launchpad

ID prefix: `lp`

## Purpose

The service drives a Novation Launchpad Pro Mk3 as a hardware control
surface: pads toggle dictation (standard, auxiliary-prompt, and Talon Lite
modes), inject macOS keystrokes, send contextual backspace, latch Shift, and
restore safe runtime config. Dictation results are inserted into the active
macOS application via synthetic paste. This is the service-side replacement
for the legacy AppKit Launchpad UI; there is no native window or overlay.

## Requirements

### Lifecycle and layout

- **[lp-1]** WHEN the service starts, THE Launchpad controller SHALL load the
  layout from `projects/dictator/src/launchpad/launchpad-layout.json`
  (falling back to `projects/dictator/tests/fixtures/launchpad-layout.json`),
  build pages, and start MIDI discovery; IF the layout is missing or invalid,
  THEN the controller SHALL log the failure and stay inactive while the rest
  of the service runs normally.
- **[lp-2]** THE layout file SHALL decode as `{"initial_page_id"?, "pages":
  [{"id", "pads": [{"x", "y", "color": {r,g,b}, "role"?, "action"}]}]}`;
  validation rejects empty page lists, empty page ids, coordinates outside
  x ∈ [-1, 8] / y ∈ [-1, 9], `keystroke` actions without `key`, dictation
  actions without `command`, `auxiliary_dictation` without `command` and
  `prompt_slot` ∈ {1, 2}, and `modifier_latch` without `modifier`.
- **[lp-3]** THE decoder SHALL accept action types `keystroke`, `dictation`,
  `auxiliary_dictation`, `talon_lite_dictation`, `contextual_backspace`,
  `modifier_latch`, `load_safe_runtime_config`, `next_window`, `app_reload`,
  and `toggle_fullscreen_overlay`; the last three are decode-compatible
  no-ops in the service (a trace line explains why). Dictation commands are
  `start`, `stop`, `cancel`, `toggle`; the only modifier is `shift`.
- **[lp-4]** WHEN the service stops, THE controller SHALL cancel any active
  dictation task, stop an in-progress recording, and shut down the render
  worker and MIDI connection.
- **[lp-5]** IF Accessibility permission is missing at startup or when a key
  dispatch fails, THEN THE controller SHALL trigger the macOS permission
  prompt and log the failure; keystroke and insertion features require that
  permission, dictation recording requires microphone permission.

### Dictation pads

- **[lp-6]** THE controller SHALL keep one dictation state — `idle`,
  `recording`, `thinking` — and render it on the `record_status` pad: white
  when idle, red while recording, blue while thinking; `toggle` starts
  recording when idle, stops-and-processes when recording, and cancels
  processing when thinking; `start`/`stop`/`cancel` apply only in the
  matching state.
- **[lp-7]** WHEN recording starts, THE controller SHALL capture 16 kHz mono
  16-bit PCM WAV from the default input and snapshot dictation context:
  frontmost app/site context plus the current selection captured via a
  synthetic Cmd+C (≤ 12 000 chars, 0.25 s pasteboard wait, prior clipboard
  restored).
- **[lp-8]** WHEN recording stops in standard mode, THE controller SHALL run
  the same in-process pipeline as HTTP dictation
  ([dictation-pipeline](dictation-pipeline.md)) with the system locale and
  the captured context; auxiliary pads run the identical flow with the
  prompt file from `auxiliary_system_prompt_1`/`_2` (slot 1/2) substituted
  for the primary system prompt.
- **[lp-9]** WHEN recording stops in Talon Lite mode, THE controller SHALL
  transcribe with the talon-lite decode mode and run the Talon Lite
  parse → LLM-correct → reparse → render pipeline; the result's
  `edit_summary` is `Talon-lite pipeline rendered after LLM correction.` or
  `Talon-lite pipeline rendered without LLM correction.` and corrected runs
  carry uncertainty flag `talon_lite_llm_corrected`.
- **[lp-10]** WHEN a dictation produces non-empty revised text, THE
  controller SHALL insert it into the active target by writing the
  pasteboard and posting synthetic Cmd+V, then restore the previous
  pasteboard contents (~0.1 s later); empty revised text skips insertion.
- **[lp-11]** WHEN a Launchpad dictation completes or fails, THE controller
  SHALL append an interaction record
  ([interactions](../contracts/interactions.md)) with
  `request_source: "launchpad"` and a per-controller `session_id`; the
  stored mode is `talon_lite` for Talon Lite runs, `text_replacement` when
  selected text was captured, `raw_dictation` when raw and revised text are
  equal after trimming, otherwise `revision`. Failures store mode
  `revision`/`talon_lite`, edit summary `Dictation pipeline failed.` /
  `Talon-lite pipeline failed.`, uncertainty flag `pipeline_error`, and the
  error text; cancellations record nothing.
- **[lp-12]** WHILE a Launchpad dictation is processing, THE controller SHALL
  mark the shared activity tracker so `GET /api/status` reports
  `dictation_state: "processing"`.

### Keystrokes, backspace, shift latch, safe config

- **[lp-13]** WHEN a `keystroke` pad is pressed, THE controller SHALL inject
  the configured key with the configured modifiers through CoreGraphics
  events; supported keys are `tab`, `up`, `down`, `left`, `right`, `enter`,
  `backspace`, `space`, `c`, `v`, `x`, `z`, `f13`–`f20`; supported modifiers
  are `shift`, `command`, `option`, `control`. Keystroke and
  contextual-backspace pads auto-repeat while held (0.30 s initial delay,
  0.05 s interval); dictation/config pads do not repeat.
- **[lp-14]** WHEN the contextual-backspace pad is pressed, THE controller
  SHALL cancel the recording when recording, cancel processing when
  thinking, and otherwise inject Backspace.
- **[lp-15]** THE shift-latch pad SHALL hold Shift while pressed and latch it
  on release if no non-arrow key was sent during the hold; WHILE latched,
  arrow keys keep Shift applied and the latch persists, and the first
  non-arrow key consumes the latch; the pad renders dim yellow (50,50,0)
  when unlatched and bright yellow (255,220,0) when held or latched.
- **[lp-16]** WHEN the `load_safe_runtime_config` pad is pressed while idle,
  THE controller SHALL restore startup defaults to `config/dictator.json`
  (same operation as `POST /api/config/reset`) and apply the restored
  interaction-buffer size; WHILE recording or thinking the press is ignored
  (`launchpad safe runtime restore skipped: busy`).

### Rendering and connection

- **[lp-17]** THE controller SHALL render pad colors over MIDI (programmer
  mode), re-rendering everything on (re)connect and on wake; pressed pads
  render dimmed (each channel quartered); record-status and shift-latch pads
  re-render on every state change.

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
        { "x": 1, "y": 7, "color": { "r": 255, "g": 170, "b": 0 },
          "action": { "type": "talon_lite_dictation", "command": "toggle" } },
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

Roles: `record_status` (color driven by dictation state) and `shift_latch`
(color driven by latch state); pads without a role render their static
`color`. The shipped product layout binds: primary/auxiliary/Talon-Lite
dictation toggles, safe-config restore, shift latch, contextual backspace,
Space, Enter, arrows, F13–F20, and Cmd+C/V/X/Z.

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
- `src/Sources/DictatorCore/TalonLiteParser.swift`,
  `TalonLiteRecoveryEngine.swift` (contains `TalonLitePipelineOrchestrator`
  and `RuntimeConfigTalonLiteLLMCorrectionEngine`) — Talon Lite grammar,
  rendering, LLM correction, and recovery.
- Tests: `tests/DictatorServiceTests/LaunchpadTests.swift` (layout decode and
  validation, page dispatch, render diffs, product-layout guard that pins
  which actions are bound and that legacy overlay/navigation actions stay
  absent), `LaunchpadAppCycleStateTests.swift`, and
  `tests/DictatorCoreTests/TalonLite*Tests.swift`.

## Interactions

- [dictation-pipeline](dictation-pipeline.md) — shares the STT engine,
  refinement routing, and orchestrator; Launchpad runs them in-process.
- [web-ui](web-ui.md) — Launchpad interactions appear in the dashboard
  history; the safe-config pad mirrors `POST /api/config/reset`.
- [service-lifecycle](service-lifecycle.md) — controller start/stop is tied
  to service start/shutdown.
- [Config contract](../contracts/config.md) — auxiliary prompt slots and
  safe-config restore source.
- [Interactions contract](../contracts/interactions.md) — record shape,
  including the `insert_ms` timing only this capability populates.
