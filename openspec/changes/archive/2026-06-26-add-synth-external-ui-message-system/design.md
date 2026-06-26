## Context

`projects/synth` currently contains a C++20 parameter/modulation library in
`include/synth/ParameterModulation.hpp` and `src/ParameterModulation.cpp`, plus
the randomized oracle test in `tests/parameter_modulation_tests.cpp`. The core
already owns `ParameterManager`, `ParameterGroup`, `Parameter`, `Modulators`,
group-local `Gestures`, `Bank`, and `BankSlot`. This change moves gesture
ownership completely to `ParameterManager`. The core also already supports
manager-owned `SceneState`, routed encoder press/tick/shift-press, page
selection, selected gestures, scene blend, nested modulation-depth routes, and
process-lite smoothing.

The missing external layer is the Smart Grid-style contract between this core
and UI/MIDI producers:

- a parallel tree of atomic UI state structs populated once per UI/control
  frame;
- a small timestamped `MessageIn` packet type;
- a queue/bus that drains timestamp-visible messages and applies them to the
  parameter manager;
- a UI component/application that reads the atomic state at any time without
  entering the DSP/control model.

The Smart Grid precedent is in:

- `/Users/joyo/theallelectricsmartgrid/private/src/EncoderUIState.hpp`: atomic
  `EncoderUIState` and `EncoderBankUIState` with values, min/max values,
  colors, connected flags, indicator colors, modulation/gesture badges, and
  getters/setters.
- `/Users/joyo/theallelectricsmartgrid/private/src/MessageIn.hpp`:
  timestamped message structs with compact command mode and command payload.
- `/Users/joyo/theallelectricsmartgrid/private/src/MessageInBus.hpp`:
  `CircularQueue<MessageIn, 16384>` with `Push`, `Pop(timestamp)`, and
  `ProcessMessages(processor, timestamp)`.
- `/Users/joyo/theallelectricsmartgrid/private/src/Color.hpp` and `HSV.hpp`:
  trivially copyable RGB color with brightness helpers and HSV/Twister
  conversion support.
- `/Users/joyo/theallelectricsmartgrid/JUCE/SmartGridOne/Source/EncoderComponent.hpp`:
  JUCE rendering that consumes UI state, converts colors at the boundary, and
  pushes encoder drag/double-click messages.

The synth implementation should follow those shapes while respecting the synth
differences: no tracks, runtime voice/modulator counts per group,
manager-owned gesture state shared across groups, banks/slots instead of Smart
Grid encoder bank banks, and no JUCE dependency in core parameter code.

## Goals / Non-Goals

**Goals:**

- Make the parameter system observable by message-thread UI and MIDI sender code
  through atomic UI state.
- Keep UI snapshots isomorphic to the current visible bank/slot/parameter tree.
- Keep `Parameter`, `ParameterGroup`, `BankSlot`, manager-owned `Gestures`, and
  `ParameterManager` responsible for populating their own UI-state fragments.
- Add message types for all external actions named in the prompt, with clock
  and transport represented but intentionally inert in this change.
- Make `MessageInBus::Process(timestamp)` the normal external entry point for
  UI/MIDI actions.
- Add randomized coverage that drives manager behavior through `MessageInBus`
  and validates UI state against the independent oracle.
- Add a minimal JUCE mini app under `projects/synth/miniapp` that demonstrates
  two voices, two banks, scenes, gestures, modulation, encoders, buttons, and
  sliders using the same message bus and UI-state APIs.

**Non-Goals:**

- No synth audio engine, oscillator, filter, or plugin wrapper.
- No hardware MIDI mapping implementation beyond the generic message bus and
  miniapp-produced messages.
- No clock or transport behavior beyond accepting the message types safely.
- No JUCE includes, `juce::Colour`, or JUCE component types in
  `include/synth/` or `src/`.
- No serialization of UI state or messages.
- No replacement of the existing parameter/modulation core or randomized
  oracle; this change extends it.

## Decisions

### Extend the existing synth `Color`

The current synth header has a tiny `Color { r, g, b }`. Keep that as the core
color type and extend it rather than introducing a second color class. Add:

- equality operators;
- `AdjustBrightness(float)`;
- `HSV { h, s, v }`;
- `Color::FromHSV(HSV)` and `Color::ToHSV()`;
- named constants used by tests/miniapp, such as `Off`, `White`, `Red`,
  `Orange`, `Yellow`, `Green`, `Cyan`, `Blue`, `Indigo`, `Grey`.

`Color` should remain a small trivially copyable value type, but UI state should
store colors through a lock-free 32-bit representation: either `Color` itself is
laid out as a 32-bit RGB/RGBA-compatible struct with a fixed unused/alpha byte,
or UI state stores a packed `std::uint32_t` color atomically and exposes
load/store helpers that convert to and from `Color`.

Rationale: Smart Grid's color type is a small RGB struct, but `std::atomic` over
a 3-byte struct has unclear lock-free behavior. The synth public API stays
readable while the UI-state concurrency contract uses an explicitly lock-free
atomic wall.

Alternative considered: use `std::atomic<Color>` directly. That is attractive
API-wise, but the lock-free guarantee is too compiler/layout dependent for the
message-thread UI contract.

### UI state is a parallel, atomic mirror tree

Add nested UI-state structs to the relevant classes:

- `Parameter::UIState`: color, indicator colors, connected flag, bipolar flag,
  short name, per-voice current values, per-voice min values, per-voice max values, per-voice switch
  bucket values, switch cardinality, and synth-native bitmasks for
  modulators/gestures affecting the parameter.
- `BankSlot::UIState`: fixed or configured array/vector of parameter UI states
  representing the selected bank's currently visible cells.
- `GestureManagerUIState`: manager-owned per-gesture values, selected flags,
  colors, and connected/valid flags.
- `ParameterManager::UIState`: scene indices/blend, shift-held state, slots,
  manager gesture UI state, and any global status needed by miniapp/MIDI
  senders.

Use atomics for all scalar fields that the message thread may read while the
control/model thread is writing. UI-state structs containing atomics are
non-copyable and non-movable; arrays of UI-state elements must be allocated to
their final capacity during setup and never resized by population code.

The UI/MIDI bridge owns the UI-state tree. The core provides a setup/factory
surface, such as `ParameterManager::CreateUIState()` or
`ParameterManager::ConfigureUIState(UIState&)`, that sizes the tree from the
current manager topology: group voice counts, manager gesture count, slot count,
and each slot's physical-encoder count. The topology is expected to be stable
after UI-state creation; if topology changes, the caller recreates or
reconfigures the UI state before the next populate. `PopulateUIState` only
stores into already-allocated atomics and fixed arrays.

For slot visible cells, there is one reserved `Parameter::UIState` per slot
position. Cell connectivity is expressed through that embedded
`Parameter::UIState.connected` flag; an unused cell is represented by the
reserved cell UI state with `connected=false`, neutral values, and off colors.
A modulation view's final target encoder is populated as the
underlying target parameter; the parameter UI state does not know that pressing
the cell closes the modulation view. Slots also expose an
atomic `showingModulationView` flag for UI surfaces that need page-level status.
There is no separate slot-level connected flag that can disagree with the cell.
Any short-name pointer or view stored in UI state refers to immutable parameter
configuration storage and is valid only while the owning manager topology lives.

Rationale: this mirrors Smart Grid's `EncoderBankUIState` pattern and gives UI
and MIDI send routines stable memory to read without locks or calls into the
parameter tree.

Alternative considered: build immutable snapshots each frame. That is clean but
would allocate/copy more and requires lifetime handoff. The Smart Grid pattern
is already known and matches the requested design.

### Populate functions live beside model classes

Each model class populates its own UI-state fragment:

- `Parameter::PopulateUIState(UIState&) const`;
- manager-owned `Gestures::PopulateUIState(GestureManagerUIState&) const`;
- `BankSlot::PopulateUIState(UIState&) const`;
- `ParameterManager::PopulateUIState(UIState&) const`;

`Parameter::PopulateUIState` reads `Get(voiceIx)` or the current fields needed
to report the audible per-voice value, min/max range, bipolar flag, parameter
color, and indicator colors. Parameter color comes from `ParameterConfig`, with
a deterministic neutral default for existing call sites. Per-voice indicator
colors come from the owning group's voice indicator palette, with deterministic
defaults if none is supplied. The default palette is `[Cyan, Orange, Green,
Indigo, Yellow, Blue]` for the first six voices, then deterministic evenly
spaced HSV hues for additional voices. Unipolar parameter UI values and min/max
values are reported in `[0, 1]`. Bipolar parameter UI values and min/max values
are reported directly in `[-1, 1]`; renderers that want a 0..1 arc must remap
only at paint time after checking the atomic bipolar flag.

`BankSlot::PopulateUIState` populates only the selected bank's visible cells in
the slot's configured physical-encoder order, marking unused cells
disconnected/off. This matches the current bank behavior where pressing a
parameter swaps visible cells to modulation-depth parameters and the target
parameter at the final visible position.
`BankSlot` owns the slot UI-state ordering contract; `Bank` provides a public
visible-cell query such as `VisibleParameter(PhysicalEncoderId)` or
`VisibleCellFor(PhysicalEncoderId)` returning the visible `Parameter*` so
`BankSlot` can populate cell state without reaching through private bank
internals. UI-state arrays are allocated from the slot's physical encoder count
or an explicit setup capacity, not from transient bank contents.

Rationale: placing population on the classes that own the invariants avoids a
large external renderer-specific translator and follows Smart Grid's
`PopulateUIState(uiState)` convention.

Alternative considered: put all population in `ParameterManager`. That would
centralize traversal but make manager know too much about every subordinate UI
shape.

### MessageIn is command-specific, not route-specific

Add `struct MessageIn` in the synth namespace with:

- `std::uint64_t timestamp`;
- `enum class Type`;
- payload fields for `slotIx`, `position`, `gestureIx`, `bankIx`, `sceneIx`,
  `value`, `delta`, and boolean toggles as needed.

Supported types:

- `ParamIncDec`: slot + position + delta;
- `ParamPush`: slot + position;
- `ToggleShift`: optional explicit bool or toggle semantic;
- `ToggleGestureSelect`: gesture index;
- `SelectParamBank`: slot + bank index;
- `Start`, `Stop`, `Clock`;
- `SetGestureValue`: gesture index + value;
- `SceneSelect`: one scene ordinal payload;
- `SetSceneBlend`: blend value.

Rationale: the prompt explicitly says no route field. Slots and positions are
the routing surface. Using a small fixed struct keeps queue storage simple like
Smart Grid's `MessageIn`.

Alternative considered: use `std::variant` per message. That is type-safe but
less convenient for a fixed-size circular queue and less consistent with Smart
Grid.

### MessageInBus owns queue mechanics and applies to ParameterManager

Add `MessageInBus` with:

- an owned circular queue or equivalent bounded ring buffer;
- `ParameterManager* manager`;
- `bool Push(MessageIn)`;
- `bool Pop(MessageIn&, std::uint64_t timestamp)`;
- `void Apply(const MessageIn&)`;
- `void Process(std::uint64_t timestamp)`.

`Push` stores messages. `Pop` returns only messages whose timestamp is visible.
The bus is a bounded single-producer/single-consumer queue; callers with
multiple producers must serialize before `Push`. `Process` drains visible
messages and calls `Apply`. `Apply` directly calls manager APIs when
appropriate:

- inc/dec -> selected bank in slot handles tick by slot/position;
- push -> selected bank in slot handles press by slot/position;
- shift toggle -> manager shift-held state, supporting both explicit
  press/release values and toggle-only producers;
- bank select -> slot selects a bank by index in the manager's global bank list
  and deselects previous modulation view;
- gesture toggle/value -> manager gesture API;
- scene select -> manager writes the requested scene ordinal to the
  less-selected scene endpoint, leaving blend unchanged; when blend is exactly
  centered, the right endpoint is the deterministic target; invalid ordinals
  are rejected and leave scene state unchanged;
- scene blend -> manager scene blend value, leaving endpoints unchanged;
- clock/start/stop -> accepted and ignored for now.

Manager APIs need slot-position entry points in addition to existing
physical-encoder ID routing. The canonical mapping is the `BankSlot`
`AddPhysicalEncoder` order: `position` indexes that stable order, then the
selected bank resolves the resulting `PhysicalEncoderId` to the visible cell.
This avoids forcing external UI code to know the internal IDs while preserving
the bank/slot model already in the core.

Rationale: this is the Smart Grid bus shape with synth-specific routing.

Alternative considered: let UI components call manager directly. That is simpler
for the miniapp but bypasses the queue and would not test the MIDI/message path.

### Scene and shift state are manager-owned

`ParameterManager` already owns `SceneState`. Extend it with shift-held state
unless an existing owner appears during implementation. Add a validated manager
scene endpoint setter used by direct tests, message bus routing, and new
external code. The setter accepts endpoints only when both are valid for every
existing group, rejects invalid endpoints without changing scene state, and
leaves scene blend unchanged when endpoints change. Existing randomized tests
that directly mutate `manager.Scene()` should be migrated to this setter, and
cross-group randomized fixtures should give auxiliary groups scene counts
compatible with the scene endpoint range they exercise.

Shift affects message application in this change narrowly: shifted `ParamPush`
on a connected parameter cell routes to reset/default behavior equivalent to
the current shift-press path; shifted `ParamIncDec` is accepted but ignored
unless a well-defined shifted tick behavior already exists in the current core.
If the miniapp has explicit reset buttons, those should still go through
messages. If a bank is showing a modulation view, the bank still owns the
navigation rule for pressing the selected target cell to close the view.

Rationale: scene and shift are global interaction state read by routing logic,
and manager is already the owner of scene state, slots, and banks.

Alternative considered: store shift state in `MessageInBus`. That makes the bus
stateful in a way that is harder for tests and future MIDI senders to inspect.

### Gesture state moves to the manager

Move `Gestures` ownership out of `ParameterGroup` and into `ParameterManager`.
The manager owns the gesture count, gesture values, selected flags, and gesture
metadata. The manager default gesture count is zero for compatibility with
existing call sites. External code may call a non-replacing setup API such as
`ParameterManager::SetGestureCount(count)` before any group is created; that
call fails or is rejected after group creation.

`ParameterGroupConfig::numGestures` should be removed from the public group
configuration contract rather than kept as a second source of truth.
`ParameterManager::CreateGroup` injects the fixed manager gesture count and a
non-owning manager pointer/reference into the group constructor. The group keeps
the injected count only for arena sizing. Each parameter reaches runtime
gesture values, selection, and metadata through the owning manager context, not
through group-local gesture state. Parameters still store
per-scene/per-gesture values and active flags, but those arrays are sized from
the injected manager gesture count when a parameter is created.
`Parameter::Compute`, `HandleIncDec`, and gesture-active clearing read selected
flags and gesture weights from the manager, not from the owning group.

Public gesture APIs should be manager methods; group-level forwarding helpers
should either be removed or made thin compatibility shims that cannot create
group-local gesture state.

`ParameterGroup` may still own the parameter arrays that contain
per-gesture/per-scene values and active flags. It must not own global gesture
values or selected flags, and existing group-level tests/call sites must be
updated or explicitly funneled through manager shims so no stale group-local
gesture path remains.

The randomized oracle migration belongs to the core gesture-migration slice:
once group-local gestures are removed, direct tests and the existing randomized
oracle must compile against manager-owned gestures before moving on to the new
message-driven randomized variant. The implementation should not intentionally
leave the default test suite red between the gesture migration and bus work.

Rationale: gesture selection and gesture value messages are external
performance state, not part of one voice/modulator group. Manager ownership also
matches the requested external message model where gesture messages carry only a
gesture index, not a group route.

Alternative considered: retain group-owned gestures and have messages choose a
primary group. That would make multi-group banks ambiguous and would not satisfy
the intended global gesture behavior.

### Reusable JUCE encoder component

Smart Grid reference shape:

- `EncoderUIState.hpp` stores one `EncoderUIState` per visible encoder cell,
  with atomics for color, brightness, per-voice values, per-voice min/max
  ranges, connected state, modulator/gesture bitsets, short name, and
  `switchValues`.
- `EncoderComponent.hpp` renders concentric voice arcs, brighter min/max arcs,
  per-voice indicator dots, switch/discrete gaps, selected switch bucket arcs,
  modulator/gesture badges, drag as inc/dec messages, double-click as push, and
  a lower display area.
- `FourteenSegmentDisplayComponent.hpp` is a standalone JUCE component with a
  fixed ASCII segment table. Smart Grid currently hardcodes it off and draws a
  rounded color pill instead.
- `SmartGridOneEncoders::GetSwitchVal` is a parameter-layer helper: if
  `switchValues <= 1` it returns 0; otherwise it rounds the normalized unslewed
  value to `[0, switchValues - 1]`.

Add a reusable synth JUCE component layer under `projects/synth/juce`, not under
core synth headers/sources:

- `FourteenSegmentDisplayComponent` should be ported mechanically from Smart
  Grid, renamed/namespaced for synth if useful, and kept independent from Smart
  Grid headers/assets.
- `EncoderComponent` should be ported mechanically from Smart Grid's geometry,
  arc, switch-gap, indicator, badge, mouse-drag, and mouse-double-click
  behavior, but bind to synth UI/message types:
  - `const synth::Parameter::UIState*` for the visible cell;
  - optional `synth::MessageInBus*`, `slotIx`, and `position` for drag/push;
  - no Smart Grid route IDs, `EncoderBankUI`, `BitSet16`, or
    `SmartGrid::Color`; synth UI state uses `std::uint32_t` bitmasks and
    synth-owned modulator/gesture colors instead of Smart Grid types/assets.
- The 14-segment display must be hardcoded on. It should show the cell short
  name for connected parameters. It must not special-case modulation-return
  behavior; it renders whatever parameter UI state the visible bank position
  provides. The rounded color-pill fallback from Smart
  Grid should not be the normal path.
- The miniapp should instantiate this reusable component and delete its local
  ad hoc encoder class.

Rationale: the synth parameter UI state is intentionally isomorphic to Smart
Grid's encoder UI state, but not identical. A reusable JUCE encoder layer is the
right boundary: it keeps JUCE and painting code out of the DSP/model layer while
letting future JUCE surfaces reuse the same renderer as the miniapp.

Alternative considered: keep the miniapp-only encoder class. That was useful as
a probe, but it loses the requested Smart Grid renderer behavior and gives no
reusable UI component for the external layer.

### Bipolar and switch rendering

Smart Grid's renderer assumes arc-space values are normalized to `[0, 1]`.
Synth UI-state values are raw parameter values: unipolar parameters report
`[0, 1]`, while bipolar parameters report `[-1, 1]` and set `bipolar=true`.
The reusable encoder must therefore normalize for painting only:

- unipolar arc value: `value`;
- bipolar arc value: `(value + 1) * 0.5`;
- all min/max and switch bucket calculations use the same display-normalized
  value, while labels/state continue to expose raw values.

Signed modulation normalization uses the sum of absolute effective depths as
the range accounting factor. For each voice, raw depths remain unchanged while
`sum(abs(rawDepths)) <= 1`; otherwise every depth is divided by that sum. The
center scale is `max(0, 1 - sum(abs(rawDepths)))`. Because modulation sources
are unipolar `[0, 1]`, the parameter also stores a per-voice normalization
offset computed from the effective depths after any over-one normalization:
`-sum(min(0, effectiveDepth))`. Audio-rate reads add that offset between the
center contribution and the modulator dot product, and process-lite smoothing
slews it alongside center scale and depths.

The same full compute pass derives per-voice modulation min/max for encoder UI
state. For ordinary underfull modulation (`sum(abs(rawDepths)) <= 1`), min/max
are the reachable audio-rate interval from unipolar modulator values:
`base + sum(min(0, effectiveDepth))` to
`base + sum(max(0, effectiveDepth))`, clamped to the parameter range, where
`base = center * centerScale + normalizationOffset`. When
`sum(abs(rawDepths)) > 1`, the visual min/max arc should show the complete
parameter range: `0..1` for unipolar and `-1..1` for bipolar. These target
min/max values are process-lite-smoothed into current min/max values and then
published through `Parameter::UIState::minValues/maxValues`, which the JUCE
encoder already renders as Smart Grid-style range arcs.

Discrete/switch behavior should be added to the parameter layer so it can be
used by UI and non-UI consumers:

- `ParameterConfig` gains `switchValues` with default `0`.
- `Parameter` exposes `SwitchValues()`, `IsSwitch()`, and
  `GetSwitchVal(voiceIx)` helpers. `GetSwitchVal` returns 0 when
  `switchValues <= 1`; otherwise it rounds the display-normalized unslewed
  value to `[0, switchValues - 1]`. In synth terms, unslewed means the same
  calculation as `Get(voiceIx)` but using target center, target center scale,
  and target modulation depths instead of process-lite-smoothed current state.
- `Parameter::UIState` gains `std::atomic<int> switchValues` and per-voice
  `switchValue` atomics, populated through the same `GetSwitchVal(voiceIx)`
  helper and reset to 0 when disconnected. The reusable renderer reads the
  precomputed bucket from UI state rather than duplicating switch rounding.
- `Parameter::UIState` also gains synth-native `std::uint32_t` bitmasks for
  modulators and gestures affecting the visible parameter cell. The renderer may
  draw Smart Grid-style badge geometry from those masks using existing synth
  modulator/gesture metadata colors, without importing Smart Grid bitmap glyph
  assets. These masks are a renderer-visible summary of the first 32
  modulators/gestures only; higher indices remain valid in the synth model but
  are omitted from encoder badges. A modulator bit is set when the parameter has
  an assigned modulation-depth parameter for that modulator. A gesture bit is
  set when the parameter has that gesture active in the manager's active scene
  selection: left scene only at blend 0, right scene only at blend 1, and both
  endpoint scenes for intermediate blends.
- The encoder renderer draws switch gaps around the base/min/max arcs when
  `switchValues > 1`, and draws the selected switch bucket for each voice as a
  visually separated highlighted segment, matching Smart Grid's
  `DrawArcWithSwitchGaps`/`DrawSwitchValueArc` behavior.

This change does not need a separate enum/discrete-value parameter type yet; the
switch value is derived from normalized parameter value exactly like Smart Grid.

### JUCE miniapp

Create `projects/synth/miniapp` with its own JUCE app source and build files.
The miniapp should:

- create a `ParameterManager` with manager-owned gestures, demo groups covering
  two-voice and three-voice banks, at least one modulator per group, at least
  one gesture, three scenes, and enough parameter capacity to materialize
  modulation depths;
- create at least two banks in one slot;
- run a timer that updates a sine modulator with voice 1 offset by 90 degrees,
  computes/processes parameters, and calls `PopulateUIState`;
- render reusable synth JUCE encoder components from `Parameter::UIState`/slot
  UI state;
- provide buttons for gestures, bank switching, latching shift, three scene
  selections, and start/stop message demonstration;
- provide sliders for gesture value and scene blend;
- map drag/slider/double-click interactions to `MessageInBus` messages.

Color conversion should be a tiny boundary helper, e.g. `juce::Colour
ToJuce(synth::Color)`. No core synth file includes `JuceHeader.h`.

The miniapp should use the developer-local JUCE checkout at `~/JUCE` by
default, matching Smart Grid's actual local module search path. If that checkout
is unavailable, the miniapp task should document the precise blocker while
keeping normal `make synth-test` independent from JUCE.

Rationale: the miniapp is a development probe, not the product UI, but it should
exercise the same reusable encoder component that future JUCE UI/MIDI-facing
surfaces will use.

### Randomized test extends the existing oracle through messages

Keep the existing randomized model/oracle and add a second test variant that
performs the same categories of operations through `MessageInBus`. The existing
oracle must also be migrated to manager-owned gestures so direct and
message-driven variants use the same ownership model. Add operations for bank
selection through messages, cross-group gesture coherence checks, and periodic
`PopulateUIState` checks. The UI-state checks should read atomics and compare
against oracle state after compute/process settling appropriate to the action.

Rationale: this avoids duplicating the implementation as a test and proves the
external path is semantically equivalent to direct manager calls.

Alternative considered: only unit-test each message type. Unit tests are still
useful, but they will not catch state-machine interactions between bank views,
gesture activation, scenes, and modulation-depth materialization.

## Risks / Trade-offs

- Atomic `Color` portability -> Keep `Color` trivially copyable and use a
  32-bit lock-free atomic representation in UI state, with compile-time/runtime
  checks where useful.
- UI state array sizing ambiguity -> Size UI-state arrays from group/slot config
  during setup and mark disconnected cells explicitly.
- Modulation-depth materialization allocation -> Preserve the existing lazy
  materialization behavior on first routed press, bounded by preconfigured
  group capacity. Subsequent press handling after a view's depth parameters
  exist should not allocate.
- Bipolar value rendering mismatch -> UI state carries an atomic bipolar flag
  and signed `[-1, 1]` values for bipolar parameters; renderers remap only at
  paint time.
- Manager gesture migration could leave stale group gesture paths -> Update
  ownership, config, compute, edit, message routing, UI state, and tests in the
  same implementation slice; keep any temporary group helpers as forwarding
  shims only.
- Message bus overflow -> Use bounded queue behavior like Smart Grid: failed
  `Push` returns false and leaves existing messages intact.
- Message bus concurrency overclaim -> Define the bus as single-producer /
  single-consumer. Multi-producer callers must serialize externally, and tests
  should cover the supported SPSC contract rather than implying arbitrary MPMC
  behavior.
- Clock/transport messages could imply behavior not delivered here -> Include
  message types and tests that they are safely accepted/ignored; defer timing
  implementation to a later change.
- JUCE availability may vary by machine -> Keep library/tests independent from
  JUCE and make miniapp build target separate from normal `make synth-test`.
- Timestamp ordering ambiguity -> Require producers to enqueue messages in
  nondecreasing timestamp order; `Pop(timestamp)` only examines the queue head
  so future head messages block later messages until they become visible.

## Migration Plan

This change is additive for the external UI/message surface, but the gesture
ownership migration is a breaking API change for current synth callers and
tests that configure `ParameterGroupConfig::numGestures` or call group-routed
gesture APIs. Existing direct manager, bank, slot, parameter, compute, and
process workflows remain available after their gesture and scene call sites are
migrated to the new manager-owned APIs. The implementation should land in
stages:

1. Extend color helpers.
2. Add UI-state structs and `PopulateUIState` methods.
3. Move gesture ownership from groups to the manager, update compute/edit
   paths, restructure tests that intentionally used divergent group gesture
   counts, and keep the default test suite compiling after this slice.
4. Add manager state/accessors needed by external routing.
5. Add `MessageIn` and `MessageInBus`.
6. Add message-driven tests and UI-state assertions.
7. Add the reusable encoder component and optional miniapp build target.
8. Correct modulation-view target ownership so the target encoder is an ordinary
   visible parameter cell; only the owning bank treats pressing that selected
   target cell as `Deselect()`.

Rollback of the external layer is deleting the new UI/message/miniapp
additions. Rollback of the gesture ownership migration would require restoring
group-owned gesture count/config APIs and the old group-routed gesture tests.

## Resolved Review Decisions

- Bipolar UI state uses an atomic bipolar flag with signed `[-1, 1]` values.
- Gestures are manager-owned, not group-owned.
- Parameter UI color comes from `ParameterConfig`; per-voice indicator colors
  come from the group voice indicator palette.
- `SceneSelect` carries one scene ordinal and the manager writes it to the
  less-selected scene endpoint; `SetSceneBlend` carries the blend value.
- Slot-position routing uses `BankSlot::AddPhysicalEncoder` order.
- The bus contract is single-producer/single-consumer.
- Visible cell UI state uses `connected=false` for empty cells; connected
  visible cells are parameter snapshots, including modulation-view target cells.
  Return/close behavior is bank-owned press routing, not UI-state data.
