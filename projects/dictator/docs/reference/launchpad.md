# Dictator Launchpad

Dictator starts a Launchpad Pro MIDI controller path with the service. This is separate from the web UI and does not restore the old AppKit menu-bar app, fullscreen overlay, or native Launchpad navigation surface.

## Runtime wiring

`DictatorServiceMain` creates `LaunchpadServiceController` during startup. The controller:

- loads `projects/dictator/src/launchpad/launchpad-layout.json`
- connects through `LaunchpadMIDIManager`
- renders pad colors through `LaunchpadColorRenderWorker`
- dispatches pad actions through `LaunchpadPageFactory`
- uses `KeyboardInjector` for macOS Accessibility keystroke injection
- uses the same STT, refinement config, secret store, and interaction history store as the HTTP dictation service

If Accessibility permission is missing, keystroke injection requests permission at startup and logs failures.

## Active layout actions

| Pad role | Action |
|----------|--------|
| Primary record pad | Toggle standard dictation using `system_prompt` |
| Auxiliary pads | Toggle dictation using `auxiliary_system_prompt_1` or `auxiliary_system_prompt_2` |
| Talon Lite pad | Toggle Talon Lite command dictation |
| Contextual backspace | Cancel active recording/processing, otherwise send Backspace |
| Safe config pad | Restore `config/dictator.safe` or bootstrap defaults |
| Shift latch | Hold Shift for the next Launchpad keystroke |
| Keystroke pads | Inject Space, Enter, arrow keys, F13-F20, and Command-C/V/X/Z |

Dictation results are inserted into the active macOS target with `ClipboardInserter` after the service finishes STT and refinement. Launchpad-triggered interactions are recorded in `data/dictator/interactions/` just like HTTP dictation records.

## Intentionally absent

The product layout omits legacy actions that only made sense in the old AppKit UI:

- fullscreen overlay toggle
- next-window native Launchpad navigation
- app reload/restart command

The decoder still accepts those action types so old fixtures and parser tests remain useful, but the active layout does not bind them.
