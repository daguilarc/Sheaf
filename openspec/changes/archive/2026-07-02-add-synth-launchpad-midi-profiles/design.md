## Context

`projects/synth` already has a JUCE-free MIDI layer with `BasicMidi`, chainable input processors, output processors, a `MidiControllerProfileConfig`, and JSON round-tripping for encoder, analog, and WRLD.Bldr-style system message associations. System feedback is already centralized through `SystemMessageOutputInfo`, which maps supported `MessageIn` values to a color and on/off state from `ParameterManager::UIState`.

The missing piece is a Launchpad family grid profile. The sibling Smart Grid source in `/Users/joyo/theallelectricsmartgrid/private/src/LaunchPadMidi.hpp` defines the position model the user wants to preserve: grid associations are expressed as logical `(x,y)` positions, then translated to Launchpad MIDI notes for input/output. The Novation programmer references use the same RGB LED SysEx family: manufacturer header `F0 00 20 29 02`, product byte `0x0C` for Launchpad X, `0x0D` for Launchpad Mini MK3, `0x0E` for Launchpad Pro MK3, command `0x03`, and one or more RGB colour specs.

## Goals / Non-Goals

**Goals:**

- Add Launchpad X, Launchpad Pro MK3, and Launchpad Mini MK3 as first-class controller identities in the synth MIDI library.
- Extend the WRLD.Bldr-style generic system-message input association path so logical Launchpad `(x,y)` positions map to existing press/release `MessageIn` values.
- Add a Launchpad grid output processor that maps the same logical positions to RGB LED SysEx using `SystemMessageOutputInfo`.
- Extend `MidiControllerProfileConfig` and JSON persistence so Launchpad message associations sit beside the existing WRLD.Bldr message association shape.
- Add default Launchpad profile config/factory helpers that build only grid input and grid output processors.

**Non-Goals:**

- No miniapp changes.
- No analog input, encoder input, or encoder output for Launchpad profiles.
- No dedicated Launchpad-only input processor.
- No pressure/aftertouch behavior.
- No automatic hardware device discovery, mode switching, or JUCE device ownership.
- No new `MessageIn` types.

## Decisions

### Represent Launchpad identity with a small enum

Add `enum class LaunchpadController { LaunchpadX, LaunchpadProMk3, LaunchpadMiniMk3 };` plus JSON helpers. The enum should be used by both position validation and SysEx product-byte selection.

Alternative considered: infer the device from MIDI endpoint names. That would make persistence and tests depend on platform-specific device names, which the current profile config intentionally avoids.

### Store Launchpad positions in the existing system-message section

Extend `MidiControllerSystemMessageAssociation` with an optional `LaunchpadGridPosition` containing `controller`, `x`, and `y`. This mirrors `wrldBldrPosition`, keeps one shared `press`/`release`/`feedback` message association, and matches the requested "WRLD.Bldr message section plus controller enum" shape.

Alternative considered: add a separate `launchpadMessages` vector. That would duplicate the same message association model and make profile persistence more fragmented.

### Translate notes through Smart Grid-compatible helpers

Add helpers equivalent to the sibling `LPMidi` adapter:

- `LaunchpadPositionToNote(controller, x, y)` returns `std::optional<std::uint8_t>`.
- `LaunchpadNoteToPosition(controller, note)` returns `std::optional<LaunchpadGridPosition>`.
- `LaunchpadShapeSupports(controller, x, y)` applies the sibling support rules: X/Mini support `x` in `0..8` and `y` in `-1..7`; Pro supports `x` in `-1..8` and `y` in `-1..9`.

Use signed coordinates in the C++ position type so Pro left-side and bottom-row positions can round-trip without sentinel casts. Out-of-shape positions are invalid at config-load time and ignored by output helpers.

Alternative considered: store raw MIDI note numbers. The prompt specifically asks to associate `(x,y)` positions with `MessageIn` values, and raw notes would hide the controller shape semantics.

### Reuse the generic system-message input processor

Keep the WRLD.Bldr pattern: one shared system-message association owns the controller address plus press, optional release, and feedback `MessageIn` values. Extend the generic input matching used by `SystemButtonMidiInProcessor` so an association can match either a channel/CC address or a Launchpad `(controller,x,y)` address. The processor should handle Launchpad Note On, Note Off, and CC messages because Launchpad programmer surfaces can report pads and edge buttons differently. Note On or CC with value greater than zero emits the press message; Note Off or value zero emits the optional release message when present. Messages are stamped through the configured timestamp provider. Unmapped supported messages pass to `thru`.

Alternative considered: add a dedicated `LaunchpadGridMidiInProcessor`. That would be more code and would drift from the WRLD.Bldr profile shape. The better move is to make the existing generic system-message input matcher understand Launchpad addresses.

### Add a Launchpad RGB output processor

Add `LaunchpadGridMidiOutProcessor` as a `MidiOutputProcessor`. It evaluates each Launchpad association's feedback message with `SystemMessageOutputInfo`, debounces by position/color, and enqueues `LaunchpadColorSysex(0, controller, x, y, color)`. The SysEx builder should emit a single RGB colour spec by default:

`F0 00 20 29 02 <product> 03 03 <note> <r/2> <g/2> <b/2> F7`

The `r/2`, `g/2`, `b/2` conversion follows the existing WRLD.Bldr output convention for turning 8-bit synth colors into 7-bit MIDI RGB bytes. Tests should verify exact bytes for X, Mini MK3, and Pro MK3.

Alternative considered: send Note On palette values. RGB SysEx keeps color fidelity aligned with the existing `Color` type and avoids adding a Launchpad-specific palette mapper.

### Build library-only default profiles

Add options and helpers such as `LaunchpadDefaultProfileOptions`, `LaunchpadDefaultProfileConfig`, and convenience wrappers for X/Pro/Mini if that matches existing naming style. Defaults should populate only `systemMessages` with `launchpadPosition` entries; they should leave encoder and analog config unset. The profile factory should feed those associations into the generic system-message input processor and the Launchpad-specific output processor. The default layout can be conservative and reusable:

- bottom row `y = -1`, columns `0..7`, maps to scene selects;
- right column `x = 8`, rows `0..7`, maps to bank selects;
- grid row `y = 0`, columns `0..7`, maps to momentary gesture select;
- optional shift position defaults to `(8,-1)` when supported.

The options should allow callers to cap scene, bank, and gesture counts and override or omit shift. The implementation can expose the generic association builder so future apps can supply custom mappings without changing processors.

Alternative considered: mirror a specific miniapp layout. The user requested the library only, and this keeps app-specific decisions out of the change.

## Risks / Trade-offs

- [Launchpad coordinate conventions are easy to invert] -> Add golden tests copied from the sibling `LPMidi` mapping for representative bottom, top, side, overflow, and Pro-only coordinates.
- [Mini MK3 surface support can drift from Launchpad X] -> Treat Mini MK3 as X-shaped for coordinates but use product byte `0x0D`; add explicit tests for both product bytes.
- [Profile JSON schema changes can break existing patches] -> Keep schema version `1` if missing `launchpadPosition` remains valid, or bump to `2` only if the parser cannot remain backward-compatible. Tests must cover old WRLD.Bldr-only JSON and new Launchpad JSON.
- [Multiple controller positions in one config can produce multiple output processors] -> Group Launchpad output associations by controller enum during factory creation and document deterministic output order in tests.

## Migration Plan

The change is additive. Existing WRLD.Bldr, Twister, patch persistence, and miniapp behavior remain valid. Rollback is to remove Launchpad associations from a profile config; WRLD.Bldr-only JSON continues to load.
