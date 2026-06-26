## 1. Core API Foundations

- [x] 1.1 Extend `synth::Color` with equality, brightness adjustment, named colors, `HSV`, `Color::ToHSV`, and `Color::FromHSV`, keeping it trivially copyable, JUCE-free, and compatible with a 32-bit lock-free atomic UI representation.
- [x] 1.2 Add unit coverage for RGB/HSV round trips, brightness adjustment, named colors, 32-bit UI color atomic storage/load/store helpers, and building the synth library without JUCE headers.
- [x] 1.3 Add `ParameterConfig` color support and group voice-indicator palette configuration, including deterministic defaults for existing call sites and tests for populated parameter/indicator colors.
- [x] 1.4 Move `Gestures` ownership from `ParameterGroup` to `ParameterManager`, including default manager gesture count zero, a non-replacing pre-group `SetGestureCount`-style API, removal of `ParameterGroupConfig::numGestures`, `CreateGroup` injection of manager pointer plus gesture count for arena sizing, manager-owned gesture values/selected flags/metadata, parameter array sizing, compute/edit reads, and active-flag clearing across all groups.
- [x] 1.5 Update existing direct manager/group tests, call sites, and the existing randomized oracle for manager-owned gestures in the same slice, restructuring tests that used divergent per-group gesture counts, leaving `make synth-test` compiling after the migration, and leaving no group-local gesture state path except deliberate forwarding shims.
- [x] 1.6 Add manager-owned external interaction state needed by messages, including shift-held state, a validated scene endpoint setter used by direct and bus paths, and stable indexed access to banks/slots for message routing.
- [x] 1.7 Add slot-position routing APIs so external messages can target `slotIx + visible position` through `BankSlot::AddPhysicalEncoder` order without knowing `PhysicalEncoderId`.

## 2. UI State Snapshots

- [x] 2.1 Define the UI-state allocation/sizing API, including non-copyable atomic-containing UI-state storage, caller-owned manager UI-state lifetime, topology-derived fixed capacities, and no allocation during `PopulateUIState`.
- [x] 2.2 Define the initial `Parameter::UIState` with atomic 32-bit color storage, connected state, bipolar flag, stable short name pointer/view lifetime, per-voice values, per-voice min/max values, and per-voice indicator colors; switch bucket and affecting-mask extensions are tracked in 6.2.
- [x] 2.3 Implement the initial `Parameter::PopulateUIState(UIState&) const` and tests that compare populated values to `Get(voiceIx)`, including configured parameter color, group voice-indicator colors, signed `[-1, 1]` bipolar values, and min/max ranges when the bipolar flag is true; switch bucket and affecting-mask population tests are tracked in 6.2.
- [x] 2.4 Define and implement manager-owned `GestureManagerUIState` for gesture values, selected flags, colors, and connected/valid flags.
- [x] 2.5 Define and implement slot/bank UI state for selected bank visible cells in slot physical-encoder order, using each reserved cell's embedded `Parameter::UIState.connected` flag for unused/disconnected/off cells and connected parameter cells.
- [x] 2.6 Add the public bank visible-cell query used by slot UI population, returning the visible parameter pointer for each physical encoder.
- [x] 2.7 Define and implement `ParameterManager::UIState` and `ParameterManager::PopulateUIState(UIState&) const` for slots, slot modulation-view active flags, gestures, scene state, scene blend, and shift-held state.
- [x] 2.8 Add focused tests for UI-state sizing/lifetime, bank switching, modulation-view opening with target parameter UI-state preservation, gesture state, scene state, and shift state as reflected in UI-state atomics.

## 3. Message Input And Bus

- [x] 3.1 Define `MessageIn` with timestamp, typed command enum, and payload fields/factory helpers for param inc/dec, param push, shift toggle with optional explicit value, gesture select toggle, bank select, start, stop, clock, gesture value set, scene select with left/right endpoints, and scene blend set.
- [x] 3.2 Implement a bounded single-producer/single-consumer `MessageInBus` with `Push`, `Pop(timestamp)`, `Apply`, and `Process(timestamp)` against an attached `ParameterManager`.
- [x] 3.3 Route parameter inc/dec and push messages through slot-position manager APIs, including modulation-view behavior, shifted push reset semantics, and explicitly ignored shifted inc/dec unless current core semantics already define it.
- [x] 3.4 Route bank select, gesture toggle, gesture value, scene endpoint select, and scene blend messages to manager-owned state, with bank indices resolving through the manager global bank list, invalid scene endpoints rejected without state changes, and gesture messages updating the manager-owned gesture state used by every group.
- [x] 3.5 Accept and drain clock/start/stop messages without changing parameter, bank, gesture, scene, or shift state in this change.
- [x] 3.6 Add focused tests for nondecreasing timestamp assumptions, future head-of-line blocking, FIFO order, overflow reporting, supported SPSC producer/consumer behavior, each supported routed message, scene endpoints versus blend, invalid scene endpoint rejection, and inert transport/clock messages.

## 4. Randomized Message-Driven Coverage

- [x] 4.1 Build a second randomized simulation path driven exclusively through `MessageInBus` for external operations, using the already-migrated manager-owned-gesture oracle.
- [x] 4.2 Include all operations covered by the current randomized test, plus message-driven bank selection, shift-held transitions, scene endpoint rejection, and cross-group gesture coherence checks that include auxiliary-group parameters in the oracle with scene counts compatible with the simulation scene range.
- [x] 4.3 Periodically call `PopulateUIState` during the randomized loop and compare connected UI-state fields against the oracle.
- [x] 4.4 Ensure randomized failures report seed, step, message/action, and mismatched model or UI field.
- [x] 4.5 Preserve bounded default seeds for routine `make synth-test` and keep stress seed/step controls available.

## 5. JUCE Miniapp

- [x] 5.1 Create `projects/synth/miniapp` with JUCE app source/build files that use developer-local `~/JUCE` by default and depend on the synth library without introducing JUCE includes into core synth headers or sources.
- [x] 5.2 Build a demo manager with manager-owned gestures, one group, two voices, at least one modulator, at least one gesture, at least two scenes, at least two banks, one slot, and enough capacity for modulation-depth materialization.
- [x] 5.3 Add a timer/update loop that advances one sine-wave modulation source with voice 1 offset 90 degrees from voice 0, computes/processes parameters, processes queued messages, and populates UI state.
- [x] 5.4 After the reusable encoder component work is complete, keep buttons/sliders local to the probe app and replace the miniapp-local ad hoc encoder as tracked in 6.7.
- [x] 5.5 Wire encoder drag, double-click, bank buttons, gesture buttons, gesture slider, scene controls, scene blend slider, and transport demo buttons to `MessageInBus`.
- [x] 5.6 Add a miniapp build target or documented build command separate from normal synth tests, and verify that normal `make synth-test` remains JUCE-free.

## 6. Reusable Encoder UI Support

- [x] 6.1 Add switch/discrete parameter metadata to the core model: `ParameterConfig::switchValues`, `Parameter::SwitchValues()`, `Parameter::IsSwitch()`, and `Parameter::GetSwitchVal(voiceIx)` with Smart Grid-compatible rounding from display-normalized unslewed value.
- [x] 6.2 Add `Parameter::UIState::switchValues`, per-voice switch bucket atomics, and synth-native 32-bit modulator/gesture affecting bitmasks; populate them from parameters, reset them on disconnected/empty cells, define/truncate masks to the first 32 visible indices, and cover them in focused UI-state tests and randomized UI-state checks.
- [x] 6.3 Port Smart Grid's `FourteenSegmentDisplayComponent` into the synth JUCE layer without Smart Grid includes, assets, or namespaces, and add minimal component-level build coverage through the miniapp target.
- [x] 6.4 Add a reusable synth JUCE `EncoderComponent` under `projects/synth/juce` that reads `synth::Parameter::UIState`, converts `synth::Color` to `juce::Colour` at the boundary, sends drag/push through `MessageInBus`, and exposes bind/configuration methods for `slotIx` and `position`.
- [x] 6.5 Port Smart Grid encoder geometry and rendering behavior: concentric per-voice rings, per-voice min/max arcs, per-voice indicator dots, switch/discrete arc gaps, selected switch bucket arcs from UI-state bucket atomics, connected/off states, ordinary parameter rendering for modulation target cells, modulator/gesture badge rendering from synth UI-state bitmasks and metadata colors, and an always-on 14-segment short-name display.
- [x] 6.6 Add bipolar display normalization helpers in the reusable encoder so raw bipolar UI-state values/min/max in `[-1, 1]` render into Smart Grid's `[0, 1]` arc space without changing the underlying UI-state values.
- [x] 6.7 Update miniapp layout/build files to compile the reusable JUCE component files and instantiate them instead of defining `EncoderComponent` inside `Main.cpp`.
- [x] 6.8 Verify `make synth-test`, `make -C projects/synth miniapp`, direct `open projects/synth/miniapp/build/SynthMiniapp.app`, and a JUCE-leak scan proving `projects/synth/include` and `projects/synth/src` remain JUCE-free.

## 7. Verification And Documentation

- [x] 7.1 Update `projects/synth/README.md` with the UI-state/message-bus contracts, miniapp location, and the fact that clock/transport messages are accepted but inert in this change.
- [x] 7.2 Run `make synth-test` and record the passing result.
- [x] 7.3 Build the miniapp target or document any local JUCE dependency blocker precisely.
- [x] 7.4 Review the pre-reusable-encoder slice to confirm no JUCE includes or JUCE types leaked outside `projects/synth/miniapp`.
- [x] 7.5 After section 6 lands, repeat the JUCE leak scan and confirm JUCE usage is limited to `projects/synth/juce` and `projects/synth/miniapp`.

## 8. Modulation View Ownership Correction

- [x] 8.1 Remove modulation-return/page roles from parameter UI state: the target encoder in an open modulation view must populate as the underlying target parameter with switch values, masks, color, short name, bipolar flag, and values preserved.
- [x] 8.2 Move close-view behavior fully into `Bank::HandlePress`: when the bank is showing a modulation view and the selected target cell is pressed, the bank deselects; inc/dec and shift/reset route to the visible parameter normally.
- [x] 8.3 Add focused and randomized tests proving modulation target cells are connected parameter snapshots, preserve switch metadata, and route `ParamIncDec(last-position, ...)` through the visible target parameter.
- [x] 8.4 Run `make synth-test`, `make -C projects/synth miniapp`, `make -C projects/synth/miniapp test`, and an xagent Claude Opus review focused on layer violations and ownership awkwardness.

## 9. Signed Modulation Normalization

- [x] 9.1 Specify the signed modulation normalization rule: normalize by `sum(abs(depths))`, derive the per-voice normalization offset from effective negative depths after any over-one normalization, and include that offset in target/current reads.
- [x] 9.2 Add focused tests for under-one and over-one mixed positive/negative modulation depths that fail without the normalization offset.
- [x] 9.3 Implement per-voice target/current normalization offsets, process-lite smoothing, recursive depth compute propagation, and randomized oracle parity.
- [x] 9.4 Update synth documentation for the new audio-rate read formula and run `make synth-test`.

## 10. Dynamic Modulation Min/Max UI Ranges

- [x] 10.1 Specify dynamic per-voice modulation min/max: underfull depths use the reachable interval, while `sum(abs(depths)) > 1` publishes full parameter range.
- [x] 10.2 Add focused tests for UI-state min/max in underfull mixed-depth and overfull bipolar cases, plus process-lite min/max smoothing.
- [x] 10.3 Implement per-voice target/current min/max state in the parameter compute path and publish current min/max through UI state.
- [x] 10.4 Update the randomized oracle to verify UI min/max, confirm the existing encoder renderer consumes the fields without JUCE changes, and run synth plus miniapp verification.

## 11. Scene, Gesture, And Shift UI Clarification

- [x] 11.1 Specify Smart Grid-style scene selection semantics: `SceneSelect` carries one scene ordinal and the manager writes that ordinal to the less-selected scene endpoint, using the right endpoint at exact center blend.
- [x] 11.2 Implement message-bus scene selection through manager-owned scene APIs, reject invalid ordinals without changing scene state, and update focused/randomized message tests.
- [x] 11.3 Ensure gesture selected flags, left/right scene endpoints, scene blend, and shift-held state are visible through manager UI state and covered by tests.
- [x] 11.4 Update the miniapp to expose three scene buttons, UI-state-driven scene endpoint labels, UI-state-driven gesture and shift button lighting, and a latching shift button that causes encoder pushes to route through `HandleShiftPress`.
