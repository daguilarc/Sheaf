## Context

`projects/synth` now has a JUCE-free MIDI layer centered on `BasicMidi`,
`MidiInProcessor`, `EncoderMidiInProcessor`, `MidiSender`, and encoder-oriented
MIDI output processors. It also has manager-owned `MessageIn`, `MessageInBus`,
`ParameterManager::UIState`, selected bank slots, scene state, gestures, and
shift state. The miniapp currently hand-builds encoder input/output processors
for Twister or WRLD.Bldr and separately wires on-screen buttons and sliders to
`MessageInBus`.

The next missing layer is controller semantics above encoders:

- analog CCs for gesture values and scene blend;
- system buttons that emit existing `MessageIn` commands;
- feedback for those same system buttons;
- a profile that builds the input chain and output processors for one hardware
  controller without duplicating channel/CC/position associations.

Relevant WRLD.Bldr source-derived defaults come from
`/Users/joyo/theallelectricsmartgrid/private/src/TheNonagonSquiggleBoyWrldBldr.hpp`
and `WrldBLDRMidi.hpp`: encoder turns/pushes are channels 0/1, analogs are
channel 2 plus channel 14 offset by two, aux-grid buttons use channel 5 with
`cc = y * 8 + x`, scene select lives on aux row 6, gesture selectors are rows 0
and 1, bank selectors are row 3 for voice banks and row 2 for quad/global
banks, shift is aux `(0,4)`, and aux focus is `(0,5)`. The default synth
profile intentionally omits focus for now.

## Goals / Non-Goals

**Goals:**

- Add chainable analog and system-button MIDI input processors with config
  structs and safe thru behavior.
- Make message application safe when a controller sends a scene, gesture, or
  bank selection that does not exist for the current app.
- Extend bank and manager UI state enough for system-button output feedback,
  including bank colors and gesture-bank-affecting status.
- Add system output processors for simple CC feedback and WRLD.Bldr color-grid
  feedback.
- Add profile config/factory types that build complete controller wiring while
  sharing one association model across input and output.
- Update the miniapp so WRLD.Bldr controller setup is profile-driven, with one
  gesture button, scene select, shift, encoders, gesture CC, and scene blend CC.

**Non-Goals:**

- No analog output processor for gesture values.
- No new `MessageIn` commands beyond what is needed to express explicit
  shift/gesture press/release with existing message semantics.
- No hardware MIDI learn or persisted profile serialization.
- No focus behavior in the default WRLD.Bldr profile.
- No audio-thread MIDI output dispatch.

## Decisions

### Keep analog input as a separate processor

Add `AnalogMidiInConfig` with mappings from `MidiControlAddress` to either
`gestureIx` or `sceneBlend`. `AnalogMidiInProcessor` consumes configured CCs,
normalizes values to `[0, 1]`, pushes `SetGestureValue` or `SetSceneBlend`, and
passes unconfigured CCs to thru.

Alternative considered: fold analogs into encoder input. That would make the
encoder config carry unrelated value semantics and make profile defaults harder
to reason about.

### Make system buttons emit arbitrary existing `MessageIn` packets

Add `SystemButtonMidiInConfig` with associations:
`MidiControlAddress`, `pressMessage`, and optional `releaseMessage`. A mapped CC
with value greater than zero emits the press message. A mapped CC with value
zero emits the release message when configured and otherwise emits nothing. The
processor stamps messages with the configured bus-domain timestamp provider and
otherwise leaves the packet unchanged.

This supports latching and momentary shift or gesture behavior through config:
toggle on press with no release, or explicit `SetShift`/`SetGestureSelect`
messages on press and release. The processor does not know those use cases.

Alternative considered: bake latching/momentary modes into the processor. The
prompt calls those examples usage patterns; direct message associations keep the
processor generic.

### Harden message application at the manager boundary

`MessageInBus::Apply` should treat every target index as untrusted. Invalid
slot/position/bank, gesture, or scene messages return without mutating state.
Clock/transport remain accepted and inert. This lets controller defaults include
buttons for more banks, scenes, or gestures than a specific app exposes.

Alternative considered: validate only in processors. That misses direct UI
messages and tests, and does not protect future producers.

### Bank color belongs to bank metadata and UI state

Extend `Bank` with a color field and accessor/mutator. Extend
`ParameterManager::UIState` with one stable bank UI-state entry per manager
bank, including color, selected-by-any-slot, and connected/valid flags. A bank's
selected state is true when any slot currently selects that bank. Missing banks
are represented by absence or `connected=false`, never by undefined reads.

Alternative considered: derive bank color from visible parameter colors. That
would make bank select feedback unstable when parameters or modulation views
change; the prompt asks for bank-associated color.

### Populate gesture-bank-affecting status during UI-state population

Extend manager UI state with a compact matrix or per-gesture bitset indicating
which manager banks are affected by each gesture in the active scene selection.
`PopulateUIState` walks visible bank mappings and parameter gesture affecting
masks, then marks a gesture as affecting a bank when any visible parameter in
that bank is affected. If one bank is affected, gesture select output uses that
bank color; if multiple banks are affected, it uses white; if none, it uses
dimmed grey. Selected gestures still report `isOn=true`.

Alternative considered: compute this inside the output helper by walking the
live parameter tree. Output processing is meant to read the UI-state snapshot
only, so population is the right place to do the tree walk.

### Centralize system feedback in `SystemMessageOutputInfo`

Add a small helper that owns a `ParameterManager::UIState*` and maps a
`MessageIn` to `{Color color, bool isOn}`:

- `SelectParamBank`: selected bank color when selected, dimmed bank color when
  present but unselected, off/false when missing.
- `ToggleShift` or explicit `SetShift` messages: white when shift is held, grey
  when not.
- `SceneSelect`: Smart Grid-style orange for the left scene and green for the
  right scene; left brightness is `0.5 + 0.5 * (1 - blend)`, right brightness
  is `0.5 + 0.5 * blend`; if both endpoints are the same scene, the left/orange
  rule wins; off/false when missing; `isOn=true` when the scene is selected on
  either endpoint.
- `ToggleGestureSelect` or explicit `SetGestureSelect` messages: white when
  selected, otherwise bank color/white/grey from gesture-bank-affecting status;
  off/false when missing.
- all other message types: off/false.

Alternative considered: duplicate this logic in each output processor. That
would quickly drift between CC and WRLD.Bldr feedback.

### Add system output processors beside encoder output processors

Add `SystemCcMidiOutProcessor` with config mapping `MidiControlAddress` to
`MessageIn`. It calls `SystemMessageOutputInfo`, sends value `127` when `isOn`
and `0` otherwise, and debounces per association.

Add `WrldBldrSystemMidiOutProcessor` with config mapping `WrldBldrPosition`
(`channel`, `x`, `y`) to `MessageIn`. It calls the same output-info helper and
sends WRLD.Bldr/Yaeltex color feedback for the position. The design treats aux
positions as channel 5, with `cc = y * 8 + x`, matching Smart Grid input
addressing; the implementation should reuse or generalize the existing WRLD.Bldr
color SysEx builder rather than hand-building a second packet format.

Both processors own their debounce caches and reset re-renders state.

Alternative considered: one templated output processor with controller adapters.
The current code already keeps Twister and WRLD.Bldr feedback separate because
their protocols differ; explicit classes are easier to test.

### Profiles are factories, not device owners

Add `MidiControllerProfileConfig` and a profile/factory type that receives the
runtime `MessageInBus`, `ParameterManager::UIState`, `MidiSender`, timestamp
provider, and current app topology counts. It creates:

- one input chain composed from encoder, analog, and system-button processors;
- zero or more output processors;
- shared association data so system button input and output are configured from
  the same `MessageIn` to controller-position definitions.

The profile should not own JUCE devices. JUCE handlers continue to own device
open/close and install the profile-created input processor. Output processors do
not need chains because each has explicit associations.

Alternative considered: let the miniapp continue to choose processors manually.
That keeps logic local but defeats the point of reusable controller defaults.

### Default WRLD.Bldr profile follows Smart Grid positions, trimmed by app use

The default WRLD.Bldr profile should:

- create row-major encoder input/output for slot 0, trimmed only when the app
  requests fewer visible encoder positions;
- create analog input where logical analog index 0 controls scene blend and
  logical indices 1..16 control gesture values 0..15; WRLD.Bldr channel 2 CC
  `N` maps to logical index `N`, and channel 14 CC `N` maps to logical index
  `N + 2`, matching the sibling repo adapter;
- map aux `(0,4)` to momentary shift using `SetShift(true)` on press and
  `SetShift(false)` on release;
- map aux row 6, columns `0..7`, to scene select messages;
- map aux row 0/1 gesture positions using `SetGestureSelect(gesture, true)` on
  press and `SetGestureSelect(gesture, false)` on release, but the miniapp
  should request only the first gesture association for its one-gesture demo;
- map bank select positions from Smart Grid: voice banks at `(0..3,3)`, quad
  banks at `(0..2,2)`, and global banks at `(3..6,2)`;
- omit aux focus at `(0,5)`.

The profile may allocate more bank and scene buttons than the miniapp supports
because invalid message targets are safe no-ops.

Alternative considered: create a miniapp-specific WRLD.Bldr layout. That would
hide the general profile behavior the change is meant to prove.

## Risks / Trade-offs

- [Gesture-bank-affecting can be expensive if recomputed naively] -> Compute
  only during `PopulateUIState`, use compact bitsets, and keep the first
  implementation bounded by current manager bank/gesture counts.
- [WRLD.Bldr grid color packet details can diverge from Smart Grid] -> Reuse the
  existing Yaeltex SysEx builder shape and add golden tests from the sibling
  source.
- [Out-of-bounds safety can hide profile mistakes] -> Add explicit unit tests for
  safe no-op behavior while still testing valid associations change state.
- [Profile config can become a dumping ground] -> Keep profiles as factories
  over existing processors and configs; they should not own MIDI devices or
  app-specific parameter creation.

## Migration Plan

The change is additive. Existing encoder processors and Twister/WRLD.Bldr
encoder presets remain available. The miniapp can switch to the WRLD.Bldr
profile while keeping its on-screen UI bus and MIDI bus separation. Rollback is
to instantiate encoder processors directly as the miniapp does today.
