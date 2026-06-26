# Synth External UI Message System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `add-synth-external-ui-message-system`: manager-owned gestures, validated scene and external interaction state, atomic UI-state snapshots, timestamped message input/bus routing, randomized message-driven coverage, and a segregated JUCE miniapp.

**Architecture:** Keep `projects/synth/include` and `projects/synth/src` JUCE-free. `ParameterManager` owns global gestures, scenes, banks, slots, and message routing state. UI state is caller-owned, pre-sized, non-copyable atomic storage populated once per frame. Message producers enqueue `MessageIn`; `MessageInBus::Process(timestamp)` applies visible messages to `ParameterManager`.

**Tech Stack:** C++20, current hand-written Makefile/test harness, JUCE only under reusable synth UI code in `projects/synth/juce` and the probe app in `projects/synth/miniapp`, OpenSpec artifacts under `openspec/changes/add-synth-external-ui-message-system`.

---

## Phase 1: Core Model Migration

- [ ] Extend `Color` and add `HSV`, named colors, brightness adjustment, equality, and 32-bit packed/load/store helpers suitable for lock-free UI-state atomics.
- [ ] Add `Color color` to `ParameterConfig` and `std::vector<Color> voiceIndicatorColors` to `ParameterGroupConfig`; remove `ParameterGroupConfig::numGestures`.
- [ ] Add deterministic voice color defaults: `[Cyan, Orange, Green, Indigo, Yellow, Blue]`, then evenly spaced HSV colors.
- [ ] Move `Gestures` storage to `ParameterManager` with default count `0` and pre-group `SetGestureCount`.
- [ ] Change `CreateGroup`/`ParameterGroup` construction so the manager injects a manager pointer plus fixed gesture count for arena sizing.
- [ ] Update `Parameter` compute/edit/reset paths to read selected gesture state and gesture values from the manager context.
- [ ] Add manager-owned gesture APIs without group parameters and update or remove group forwarding APIs.
- [ ] Add validated `SetSceneEndpoints(left, right)` used by tests and message routing; reject endpoints invalid for any group without changing state.
- [ ] Add shift-held state, bank/slot indexed access, and slot-position routing APIs.
- [ ] Keep `make synth-test` green after this phase by migrating existing direct tests and the current randomized oracle.

## Phase 2: UI State

- [ ] Define non-copyable UI-state storage helpers for fixed arrays of atomic-containing UI-state elements.
- [ ] Define `Parameter::UIState` with atomic packed color, connected flag, cell role, bipolar flag, short name pointer/view, per-voice value/min/max, and per-voice indicator color.
- [ ] Implement `Parameter::PopulateUIState`.
- [ ] Define `GestureManagerUIState`.
- [ ] Add `Bank::VisibleCellFor(PhysicalEncoderId)` returning visible parameter pointer plus role `empty`, `parameter`, or `return`.
- [ ] Define slot/bank UI state in physical-encoder order, including `showingModulationView`.
- [ ] Define `ParameterManager::UIState`, a manager UI-state factory/setup API, and `ParameterManager::PopulateUIState`.
- [ ] Add focused UI-state tests for sizing, colors, bipolar values, bank switching, modulation return role, gestures, scenes, and shift.

## Phase 3: Message Input And Bus

- [ ] Define `MessageIn` with timestamp, command enum, payload fields, and factory helpers for all requested message types.
- [ ] Implement bounded SPSC `MessageInBus` with `Push`, `Pop(timestamp)`, `Apply`, and `Process(timestamp)`.
- [ ] Route param inc/dec and push through slot-position APIs; shifted push resets, shifted inc/dec is ignored.
- [ ] Route bank selection through manager global bank index; deselect prior modulation views.
- [ ] Route gesture select/value, validated scene endpoints, scene blend, and shift-held state.
- [ ] Accept and drain clock/start/stop as inert messages.
- [ ] Add focused bus tests for timestamp head blocking, FIFO, overflow, SPSC integrity, every routed message, invalid scene endpoint rejection, and inert transport/clock behavior.

## Phase 4: Randomized Message Path

- [ ] Add a second randomized simulation driven exclusively through `MessageInBus`.
- [ ] Include existing operation classes plus bank selection, shift transitions, scene endpoint rejection, and cross-group gesture coherence.
- [ ] Ensure auxiliary groups in randomized tests have scene counts compatible with the scene endpoint range under test.
- [ ] Periodically populate UI state and compare connected atomics against the oracle.
- [ ] Preserve bounded default seeds and stress environment knobs.

## Phase 5: Miniapp

- [ ] Create `projects/synth/miniapp` with JUCE build files using developer-local `~/JUCE` by default.
- [ ] Build a two-voice demo manager with gestures, two scenes, two banks, one slot, and one sine-wave modulator offset 90 degrees by voice.
- [ ] Add a reusable `projects/synth/juce` encoder component layer modeled on Smart Grid's encoder, including switch gaps, bipolar display normalization, and an always-on 14-segment display; update the miniapp to use it instead of a local ad hoc encoder.
- [ ] Wire encoder drag/double-click, bank buttons, gesture controls, scene controls, scene blend, and transport demo buttons through `MessageInBus`.
- [ ] Keep the miniapp build separate from normal `make synth-test`; document a precise blocker if local JUCE is missing.

## Phase 6: Docs And Verification

- [ ] Update `projects/synth/README.md` with UI-state, message-bus, manager-owned gesture, scene validation, and miniapp notes.
- [ ] Run `openspec validate add-synth-external-ui-message-system --strict`.
- [ ] Run `make synth-test`.
- [ ] Build the miniapp target or document the exact JUCE/local-build blocker.
- [ ] Verify no JUCE includes/types outside `projects/synth/juce` and `projects/synth/miniapp`.
- [ ] Use xagent Claude reviewers on the implemented diff before marking OpenSpec tasks complete.
