## Context

`projects/synth` already has a JUCE-free MIDI layer with `BasicMidi`, chainable input processors, encoder input/output processors, generic system-button input, system-message output info, profile factories, WRLD.Bldr and Launchpad profile defaults, and JSON persistence for profile configs. The current Twister support is still the original encoder-only preset: 16 row-major encoders with turn input on zero-based channel 0, push input on zero-based channel 1, and encoder value/color/brightness output.

The user captured the six MIDI Fighter Twister side buttons as channel 4 CCs 8-13 with values 127 on press and 0 on release. The DJ TechTools channel documentation names channel 4 as system/banks/side buttons, while `BasicMidi` stores MIDI channels as zero-based nibbles, so the in-code address is channel 3 CCs 8-13. The Twister manual also separates encoder value feedback, switch RGB color feedback, and animation/brightness feedback by channel. Smart Grid's Twister path uses `Color::ToTwister()` for RGB-to-MFT hue conversion and `17 + brightness * 30` for animation/brightness, where full brightness is 47.

## Goals / Non-Goals

**Goals:**

- Add an MF Twister default profile config/factory that includes encoder inc/dec, encoder press, six configurable input-only side-button system messages, and encoder feedback.
- Keep MF Twister side-button input generic by reusing existing `MessageIn` press/release associations rather than adding new command types.
- Make encoder brightness an explicit `Parameter::UIState` snapshot field and have Twister and WRLD.Bldr encoder output consume it.
- Extend Twister encoder output to send both parameter/button color and voice-0 indicator/ring color/position using manual-compatible channel conventions.
- Verify Twister color and brightness helpers against the manual and the sibling Smart Grid implementation.

**Non-Goals:**

- No output handler for generic system-message on/off values beyond the existing `SystemCcMidiOutProcessor`.
- No MIDI output feedback for MF Twister side buttons; those buttons have no feedback LEDs in this profile.
- No analog input for MF Twister side buttons.
- No automatic MIDI learn or device discovery.
- No new `MessageIn` variants.
- No hardware-owned virtual-bank state tracking; the profile maps the configured CCs directly.

## Decisions

### Keep side-button messages in `systemMessages`

MF Twister side buttons should use input-side system-message associations with `control = {channel = 3, cc = 8..13}` and configurable press/release messages. This reuses the current generic system-button input processor and keeps the six defaults configurable per app, but the MF Twister default profile must not create any output processor for these side-button controls.

Alternative considered: add an MF Twister side-button input processor. That would duplicate existing channel/CC press/release behavior and make persistence more fragmented.

### Preserve user-facing channel language while using zero-based code channels

The default profile should document and test that "channel 4 CCs 8-13" from the controller correspond to `MidiControlAddress{channel = 3, cc = 8..13}` in the core library. Tests should use `BasicMidi::CC(..., 3, cc, value)` and names/comments should call out the user-facing channel to avoid off-by-one confusion.

Alternative considered: expose one-based MIDI channels in profile config. Existing synth MIDI APIs are zero-based and match raw status nibbles; changing that would be a breaking API shift.

### Promote brightness to parameter UI state

Add an atomic `brightness` field to `Parameter::UIState`. `PopulateUIState` should set connected cells to `1.0f` and disconnected cells to `0.0f` until a future feature exposes dynamic brightness. `MidiOutProcessor::CellSnapshot` should load it with the same bounded revision protocol as value and color. Twister brightness CC and WRLD.Bldr button color brightness should derive from the snapshot rather than hardcoding full brightness.

Alternative considered: leave brightness hardcoded in each output processor. That would work for today's UI but would make WRLD.Bldr and MF Twister diverge as soon as dynamic brightness is added.

### Use Smart Grid/manual Twister feedback conventions

Encoder output should continue sending voice-0 value on channel 0 and parameter RGB color on channel 1. Brightness should be sent on channel 2 using `17 + brightness * 30` clamped to `[17,47]` for connected cells and 0 for disconnected cells. Indicator/ring feedback should use voice-0 normalized position on channel 4 and voice-0 indicator color on channel 5, matching the manual's fixed ring feedback channels after zero-based conversion. Side buttons send input messages only and should not be part of output feedback.

Alternative considered: skip indicator/ring color for Twister because WRLD.Bldr already covers indicator color. The user asked for Twister output to set both color and indicator position, and existing UI state already has voice indicator colors.

### Replace the compact Twister color approximation with a source-derived helper

Update `ColorToTwister(Color)` to follow the Smart Grid `RGB2MFTHue` shape: map non-off RGB to hue codes `1..126`, rotate around blue, and treat off as 0. Grey/white should map deterministically to a visible neutral code, and tests should pin representative red/green/blue/yellow/off values. The implementation should check the MIDI Fighter Twister manual's color range and Smart Grid's `/Users/joyo/theallelectricsmartgrid/private/src/HSV.hpp`.

Alternative considered: keep the current `2 + round(h * 64)` mapper. It is deterministic but it only uses about half the available MFT hue range.

### Add explicit MF Twister profile APIs

Add options and helpers such as `MfTwisterDefaultProfileOptions`, `MfTwisterDefaultProfileConfig`, and `CreateMfTwisterDefaultProfile`. Defaults should include 16 encoder mappings, encoder output mappings, and exactly six input-only side-button system associations unless the caller provides overrides. The API must allow callers to configure all six side-button press/release messages without rebuilding the profile factory.

Alternative considered: make callers hand-assemble `MidiControllerProfileConfig`. That remains possible, but a named default profile is the clean way to make MF Twister a first-class controller beside WRLD.Bldr and Launchpad.

## Risks / Trade-offs

- [Channel numbering confusion] -> Tests and docs should name both user-facing channel 4 and zero-based channel 3, with assertions written against `BasicMidi` channel 3.
- [Generic profile factories may create CC output for every control association] -> Keep the MF Twister default factory explicit about creating no output processors for side-button controls.
- [Brightness field expands UI-state ABI] -> Keep it additive, initialize it during UI-state setup/population, and use a safe default of `1.0f` for connected cells.
- [Twister manual and Smart Grid hue mapping can disagree at grey/white] -> Pin off and primary hue behavior, and keep neutral colors deterministic rather than promising exact hardware white matching.
- [Profile defaults can become too app-specific] -> Provide configurable six-message options; keep the default factory generic and let miniapps decide which `MessageIn` values the side buttons should emit.

## Migration Plan

The change is additive. Existing Twister, WRLD.Bldr, Launchpad, and persisted profile configs continue to load. Rollback is to select the old encoder-only Twister config or omit MF Twister side-button associations; the extra UI-state brightness field remains harmless because it defaults to full brightness for connected cells.
