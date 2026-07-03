# MIDI Instrument Config — Plan 1/4: Instrument Model + Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single live MIDI profile + global endpoint state with the JUCE-free instrument model — an ordered collection of uniquely named controller slots (kind + profile config + endpoint refs) — persisted as a required `midiInstrument` patch section, owned by the engine with a post-`Init` default snapshot and a serialized message-thread edit entry point.

**Architecture:** New types live in `include/synth/MidiController.hpp` (+ `src/MidiController.cpp`): `MidiProfileKind`, `MidiEndpointRef`, `MidiControllerSlot`, `MidiInstrumentConfig`, kind support matrix, and slot validity (sections AND system-message address variants). Instrument JSON nests the existing spm-52 profile-config JSON verbatim per controller. `PatchPersistence` swaps `midiProfile` + `MidiEndpointState` for the instrument section (required; empty-controllers valid). The engine swaps `midiProfileConfig_`/`endpoints_` for `instrumentConfig_`/`defaultInstrumentConfig_` and gains `EditInstrument(...)` serialized against the audio-thread patch drain (mirror the `audioDeviceStateMutex_` shadow/lock pattern).

**Tech Stack:** C++20, GNU make, repo micro test framework (`TEST_CASE`/`REQUIRE_TRUE`, see `projects/synth/tests/module_tests.cpp:16-56`). Everything in this plan is JUCE-free.

**OpenSpec change:** `openspec/changes/midi-instrument-config-ui` — implements task groups 1 and 2 of `tasks.md`; requirements smi-1, smi-2, spp-2, spp-4, spp-7 (message payloads), sar-3 (engine state), spm-53 removal groundwork.

## Global Constraints

- C++20, `-std=c++20 -Wall -Wextra -Wpedantic -O2`, zero warnings; `make -C projects/synth build test` green after every task.
- JUCE-free: every new test file starts with the `#ifdef JUCE_MAJOR_VERSION` / `#error` guard like `tests/module_tests.cpp:3-5`.
- Namespace `synth`; house style: PascalCase methods, trailing-underscore privates, `enum class`, `k`-prefixed constexpr, status bools/enums for expected failures.
- **BREAKING is fine** (pre-user): remove `MidiEndpointState` and the `midiProfile` patch section outright; update every call site; no compatibility shims, no deprecated aliases.
- Binding kind matrix (smi-1): wrldbldr = encoders + systemMessages + analogs; twister = encoders + systemMessages; launchpad = systemMessages only; generic = all three. Binding address-variant matrix: wrldbldr = chan/CC addresses + WRLD.Bldr feedback positions; twister = chan/CC only; launchpad = Launchpad positions only; generic = chan/CC only. A slot violating either matrix is invalid: rejected by `MidiInstrumentConfig` mutation APIs and by JSON load.
- Patch document (spp-2, binding): `midiInstrument` section REQUIRED — `ValidatePatchJSON`/load fail without it; a section with zero controllers is valid; audio-device section behavior unchanged.
- Load failures never mutate the target config (parse into a scratch, swap on success).
- Reuse existing profile-config JSON helpers (spm-52) verbatim for the nested `profile` object — do not fork them.
- Commit per task, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Instrument model types and kind validity

**Files:**
- Modify: `projects/synth/include/synth/MidiController.hpp`, `projects/synth/src/MidiController.cpp`
- Create: `projects/synth/tests/instrument_tests.cpp`
- Modify: `projects/synth/Makefile` (add `instrument_tests` binary following the existing test-binary pattern)

**Interfaces:**
- Consumes: `MidiControllerProfileConfig` and nested association structs (`MidiController.hpp:103-527`), `SystemButtonMidiAssociation`/`MidiControllerSystemMessageAssociation` fields `control`, `wrldBldrPosition`, `launchpadPosition`.
- Produces (exact, later plans compile against these):

```cpp
enum class MidiProfileKind { WrldBldr, MfTwister, Launchpad, Generic };

const char* MidiProfileKindName(MidiProfileKind kind);           // "wrldbldr" | "twister" | "launchpad" | "generic"
bool MidiProfileKindFromName(std::string_view name, MidiProfileKind& out); // false on unknown

struct MidiKindSupport { bool encoders; bool systemMessages; bool analogs; };
MidiKindSupport KindSupport(MidiProfileKind kind);

struct MidiEndpointRef {
    std::string identifier;   // empty = unconfigured
    std::string name;         // device display name captured at match time
    bool IsConfigured() const { return !identifier.empty() || !name.empty(); }
};

struct MidiControllerSlot {
    std::string name;
    MidiProfileKind kind = MidiProfileKind::Generic;
    MidiControllerProfileConfig config;
    MidiEndpointRef input;
    MidiEndpointRef output;
};

// Sections + address variants (Global Constraints matrices). Returns false and
// fills `reason` (for UI/status) when invalid.
bool SlotValidForKind(const MidiControllerSlot& slot, std::string* reason = nullptr);

struct MidiInstrumentConfig {
    std::vector<MidiControllerSlot> controllers;
    bool AddController(MidiControllerSlot slot);            // false: dup name or invalid slot
    bool RenameController(std::size_t ix, std::string name); // false: dup name or bad ix
    bool ReplaceController(std::size_t ix, MidiControllerSlot slot); // same rules
    void RemoveController(std::size_t ix);
    const MidiControllerSlot* FindController(std::string_view name) const;
};
```

**Steps:**
- [ ] **Step 1: Failing tests.** In `instrument_tests.cpp` (framework block copied from `module_tests.cpp:16-56`): kind name round-trip incl. unknown-name rejection; `KindSupport` matrix (all four kinds, all three flags); `AddController` rejects duplicate name (config unchanged, verify size and original slot intact); `SlotValidForKind` rejects launchpad-with-encoder-mappings, launchpad-with-`wrldBldrPosition` association, twister-with-`launchpadPosition` association, generic-with-`launchpadPosition`; accepts wrldbldr-with-`wrldBldrPosition`, twister side-button CC associations (`control` set, no positions), each kind's default profile factory output (`WrldBldrDefaultProfileConfig()`, `MfTwisterDefaultProfileConfig()`, `LaunchpadDefaultProfileConfig()` must each be valid under their kind); ordered iteration preserved after add/remove; `RenameController` duplicate rejection.
- [ ] **Step 2:** Run `make -C projects/synth test` — new binary fails to compile/link (types absent). Expected.
- [ ] **Step 3:** Implement in `MidiController.hpp`/`.cpp`. `SlotValidForKind`: check `config.encoderInput`/`encoderOutput` empty unless `KindSupport(kind).encoders`; `config.analogInput` empty unless `.analogs`; for each `config.systemMessages` entry check the variant matrix — `launchpadPosition.has_value()` only for Launchpad kind, `wrldBldrPosition.has_value()` only for WrldBldr kind, plain `control` addresses allowed for wrldbldr/twister/generic but NOT required-absent for launchpad (launchpad entries must carry `launchpadPosition` and must not carry `control`-only addressing).
- [ ] **Step 4:** `make -C projects/synth build test` — all green, zero warnings.
- [ ] **Step 5: Commit** — `feat(synth): add MIDI instrument model with kind validity`.

---

### Task 2: Instrument JSON round-trip

**Files:**
- Modify: `projects/synth/include/synth/MidiController.hpp`, `projects/synth/src/MidiController.cpp` (beside the existing profile-config JSON helpers, `src/MidiController.cpp:994-1433`)
- Modify: `projects/synth/tests/instrument_tests.cpp`

**Interfaces:**
- Produces:

```cpp
inline constexpr const char* kMidiInstrumentSchema = "synth.midiInstrument";
inline constexpr int kMidiInstrumentSchemaVersion = 1;
JSON ToJSON(JsonArena& arena, const MidiInstrumentConfig& instrument);
bool FromJSON(JSON json, MidiInstrumentConfig& out); // false: unknown kind, dup name, invalid slot, bad schema
```

- JSON shape (design D7, binding):

```json
{ "schema": "synth.midiInstrument", "schemaVersion": 1,
  "controllers": [
    { "name": "left pad", "kind": "launchpad",
      "input":  { "identifier": "<id>", "name": "<device name>" },
      "output": { "identifier": "<id>", "name": "<device name>" },
      "profile": { /* existing MidiControllerProfileConfig JSON, reused verbatim */ } } ] }
```

**Steps:**
- [ ] **Step 1: Failing tests.** Round-trip an instrument with one wrldbldr (default profile), one twister (default profile), two launchpads (default grid profiles, distinct names) — assert order, names, kinds, endpoint identifier+name pairs, and a spot-check of nested profile content (e.g. encoder turn mapping count) survive; `FromJSON` rejects kind `"theremin"` (target unchanged — pre-populate target with one slot and assert it survives); rejects duplicate `"pad"` names; rejects a launchpad entry whose profile carries encoder mappings; rejects a launchpad entry whose systemMessages carry a `wrldBldrPosition`; empty-controllers round-trip is valid; endpoint refs with empty identifier+name round-trip as unconfigured.
- [ ] **Step 2:** Run — fails (helpers absent).
- [ ] **Step 3:** Implement: serialize via `JsonArena` object/array builders like the profile helpers; `FromJSON` parses into a scratch `MidiInstrumentConfig` using `AddController` (which enforces dup-name + validity), swaps into `out` only on full success.
- [ ] **Step 4:** Suite green, zero warnings.
- [ ] **Step 5: Commit** — `feat(synth): instrument JSON with kind and address-variant validation`.

---

### Task 3: Patch document swaps midiProfile for midiInstrument

**Files:**
- Modify: `projects/synth/include/synth/PatchPersistence.hpp`, `projects/synth/src/PatchPersistence.cpp`
- Modify: existing patch-persistence tests (the files covering `BuildPatchJSON`/`LoadPatchJSON`/`ValidatePatchJSON`/`ApplyPatchMessage` — locate via `grep -l BuildPatchJSON projects/synth/tests/`)

**Interfaces:**
- Produces (breaking rewrite of `PatchPersistence.hpp:41-49` signatures):

```cpp
JSON BuildPatchJSON(JsonArena& arena, std::string_view patchName,
                    const ParameterManager& manager,
                    const MidiInstrumentConfig& instrument,
                    const AudioDeviceState& audioDevice = {});
// LoadPatchJSON gains `MidiInstrumentConfig* instrument` (REQUIRED section: load
// fails when absent or invalid); ValidatePatchJSON requires a valid
// `midiInstrument` object; ApplyPatchMessage signature swaps the profile+endpoint
// parameters for `MidiInstrumentConfig& instrument, const MidiInstrumentConfig&
// defaultInstrument` (RevertAllToDefault restores the default instrument;
// SerializeToJSON writes the live instrument incl. endpoint refs).
```

**Steps:**
- [ ] **Step 1: Failing tests.** Update/add: patch root contains `midiInstrument` (not `midiProfile`) after save; document WITHOUT the section fails `ValidatePatchJSON` and `LoadPatchJSON` (state unchanged); zero-controller section loads (instrument becomes empty); instrument round-trips through save→load; revert restores the default instrument (perturb live, revert, compare controller names/kinds); serialize includes endpoint refs; audio-device-absent tolerance unchanged.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement; delete `MidiEndpointState` from `PatchPersistence.hpp`/`.cpp` and every call site (grep `MidiEndpointState` across `projects/synth` — Engine.hpp call sites get temporary locals ONLY if Task 4 in this plan doesn't land in the same session; prefer wiring Engine members in Task 4 and keeping this task to the library layer with Engine updated minimally to compile: swap its members now if that is smaller — the two tasks may share one commit boundary decision, but each must leave the suite green).
- [ ] **Step 4:** Suite green.
- [ ] **Step 5: Commit** — `feat(synth): patch documents persist the MIDI instrument section`.

---

### Task 4: Engine-owned instrument with serialized edits

**Files:**
- Modify: `projects/synth/include/synth/Engine.hpp`
- Modify: `projects/synth/tests/engine_tests.cpp`
- Modify: `projects/synth/include/synth/AppContext.hpp` (context members `midiProfileConfig`/`defaultMidiProfileConfig` → `instrument`/`defaultInstrument`)

**Interfaces:**
- Produces (Plans 2–4 compile against these):

```cpp
MidiInstrumentConfig& LiveInstrument();                    // message-thread read
const MidiInstrumentConfig& DefaultInstrument() const;     // post-Init snapshot
// Serialized edit entry point (smi-8): applies `edit` to the live instrument
// such that it cannot race the audio-thread patch drain — same block-boundary
// handoff/lock discipline as audioDeviceStateMutex_ (Engine.hpp, commit 93465c4
// precedent). Invokes the edit on the message thread, then fires the existing
// rebuilt-callback path so the host rebuilds processors + reconciles.
void EditInstrument(const std::function<void(MidiInstrumentConfig&)>& edit);
```

- `AppContext` members become `MidiInstrumentConfig* instrument; const MidiInstrumentConfig* defaultInstrument;` (sar-3) — update the thread-role doc comments.

**Steps:**
- [ ] **Step 1: Failing tests** (engine_tests.cpp, SynthRig-driven): post-`Init` default snapshot equals the app's seeded instrument; `EditInstrument` mutation visible in `LiveInstrument()` and triggers the rebuilt callback exactly once; patch save→perturb→load round-trips the instrument through production patch messages; revert restores the default instrument; load with a pending `EditInstrument` in the same tick observes serialized order (no torn state — assert final state is one of the two orderings, not a mix).
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement: replace `midiProfileConfig_`/`defaultMidiProfileConfig_`/`endpoints_`/`defaultEndpoints_` members; route `ApplyPatchMessage` new signature; keep the rebuilt-callback ordering discipline (fire after state fully applied, message thread).
- [ ] **Step 4:** Full suite green (rig, miniapp system tests may need mechanical updates for the new context member names — do them here).
- [ ] **Step 5: Commit** — `feat(synth): engine-owned MIDI instrument with serialized edit entry point`.

---

### Task 5: OpenSpec sync

- [ ] Verify groups 1–2 scenarios all have covering tests (spot-check the scenario list in `specs/synth-midi-instrument/spec.md` smi-1/smi-2 and `specs/synth-patch-persistence/spec.md` spp-2 against test names); check off OpenSpec `tasks.md` items 1.1–1.3 and 2.1–2.4; commit `Check off OpenSpec tasks 1.x, 2.x`.
