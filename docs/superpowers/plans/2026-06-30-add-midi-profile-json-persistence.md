# MIDI Profile JSON Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add synth-library persistence for parameter values and MIDI configuration profiles using Smart Grid-style arena JSON and patch version files.

**Architecture:** Code initialization remains authoritative for modules, parameters, modulation topology, colors, polarity, pages, banks, slots, and MIDI mapping defaults. Persistence adds a JUCE-free library JSON layer, value-only parameter serialization keyed by top-level parameter name, recursive live modulation-slot value subtrees, MIDI profile config serialization, and optional app/file helpers. Loading only applies values into an already initialized `ParameterManager`.

**Tech Stack:** C++20, synth core Makefile tests, JUCE only in miniapp/file-device integration, Smart Grid `JsonArena`/`JSON` copied from `/Users/joyo/theallelectricsmartgrid/private/src/Json.hpp`, xagent Claude Code review checkpoints.

---

## File Structure

- Create `projects/synth/include/synth/Json.hpp`: copy/adapt Smart Grid arena JSON.
- Create `projects/synth/include/synth/PatchPersistence.hpp`: patch document, MIDI endpoint state, file helper declarations.
- Create `projects/synth/src/PatchPersistence.cpp`: patch document save/load, arena grow/retry helpers, filesystem versioning.
- Modify `projects/synth/include/synth/ParameterModulation.hpp`: declare value-only JSON APIs and name lookup.
- Modify `projects/synth/src/ParameterModulation.cpp`: implement recursive value serialization/load.
- Modify `projects/synth/include/synth/MidiController.hpp`: declare MIDI profile config JSON APIs.
- Modify `projects/synth/src/MidiController.cpp`: implement MIDI config JSON conversion helpers.
- Modify `projects/synth/miniapp/Main.cpp`: store profile config/endpoint state and add programmatic save/load hooks after initialization.
- Modify `projects/synth/Makefile`: include new persistence source and test dependencies.
- Modify `projects/synth/tests/parameter_modulation_tests.cpp`: focused tests for JSON, parameter persistence, MIDI profile persistence, patch files.
- Modify `openspec/changes/add-midi-profile-json-persistence/tasks.md`: mark tasks complete only after implementation, xagent reviews, and verification.

Review gate after each task:

```bash
node projects/xagent/dist/src/main.js run --harness claude_code --model sonnet --subagent "<findings-first review prompt>"
```

Use `--model opus` for the final whole-change review or if a task review turns architectural.

---

### Task 1: Arena JSON Library

**Files:**
- Create: `projects/synth/include/synth/Json.hpp`
- Modify: `projects/synth/Makefile`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

- [ ] **Step 1: Copy the Smart Grid JSON implementation**

Copy `/Users/joyo/theallelectricsmartgrid/private/src/Json.hpp` to `projects/synth/include/synth/Json.hpp`.

Keep these API names intact because later persistence code will use them directly:

```cpp
struct JSON {
    void SetNew(const char* key, JSON value);
    JSON Get(const char* key) const;
    void AppendNew(JSON value);
    JSON GetAt(size_t index) const;
    size_t Size() const;
    const char* StringValue() const;
    int IntegerValue() const;
    double NumberValue() const;
    bool BooleanValue() const;
    bool IsNull() const;
    char* Dumps(size_t flags) const;
};

struct JsonArena {
    static constexpr size_t kDefaultCapacity = 8u * 1024u * 1024u;
    JSON Object();
    JSON Array();
    JSON String(const char* value);
    JSON Integer(int64_t value);
    JSON Real(double value);
    JSON Boolean(bool value);
    JSON Null();
    JSON Loads(const char* input, size_t flags = 0, json_error_t* error = nullptr);
    bool Failed() const;
    void Reset();
    void GrowAndReset();
};
```

- [ ] **Step 2: Add a failing JSON smoke test**

Append a test case to `projects/synth/tests/parameter_modulation_tests.cpp`:

```cpp
TEST_CASE(json_arena_build_parse_dump_and_grow_retry) {
    synth::JsonArena arena(256);
    synth::JSON root = arena.Object();
    root.SetNew("name", arena.String("Patch A"));
    root.SetNew("version", arena.Integer(1));
    synth::JSON values = arena.Array();
    values.AppendNew(arena.Real(0.25));
    values.AppendNew(arena.Boolean(true));
    root.SetNew("values", values);

    char* dumped = root.Dumps(JSON_ENCODE_ANY);
    REQUIRE_TRUE(dumped != nullptr);

    synth::JsonArena parsedArena(16);
    synth::JSON parsed = parsedArena.Loads(dumped);
    while (parsed.IsNull() && parsedArena.Failed()) {
        parsedArena.GrowAndReset();
        parsed = parsedArena.Loads(dumped);
    }
    free(dumped);

    REQUIRE_TRUE(!parsed.IsNull());
    REQUIRE_TRUE(std::string(parsed.Get("name").StringValue()) == "Patch A");
    REQUIRE_TRUE(parsed.Get("version").IntegerValue() == 1);
    REQUIRE_NEAR(static_cast<float>(parsed.Get("values").GetAt(0).NumberValue()), 0.25f, 0.000001f);
    REQUIRE_TRUE(parsed.Get("values").GetAt(1).BooleanValue());
}
```

- [ ] **Step 3: Run the focused test to see compile failure or pass after copy**

Run:

```bash
make -C projects/synth test
```

Expected before includes are fixed: compile error for `synth::JsonArena` or missing `Json.hpp`. Expected after Step 4: all synth tests pass.

- [ ] **Step 4: Namespace the copied JSON if needed**

If the copied header has global `JSON`/`JsonArena`, wrap it in `namespace synth { ... }` and keep `JSON_ENCODE_ANY` globally defined if tests or dumps require it. Add `#include "synth/Json.hpp"` to the test file.

- [ ] **Step 5: Run task verification**

Run:

```bash
make -C projects/synth test
```

Expected: all existing tests plus `json_arena_build_parse_dump_and_grow_retry` pass.

- [ ] **Step 6: xagent Claude review**

Run an xagent review with this prompt:

```text
Review Task 1 of add-midi-profile-json-persistence. Files: projects/synth/include/synth/Json.hpp, projects/synth/Makefile, projects/synth/tests/parameter_modulation_tests.cpp. Check that Smart Grid's arena JSON API was copied/adapted faithfully, remains JUCE-free, supports build/parse/dump, null-tolerant reads, and grow-and-retry tests. Findings first with file/line references.
```

Fix Critical/Important findings before proceeding.

---

### Task 2: Recursive Parameter Value Serialization

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

- [ ] **Step 1: Add declarations**

In `Parameter`, declare:

```cpp
JSON ToValueJSON(JsonArena& arena) const;
bool LoadValuesFromJSON(JSON json);
```

In `ParameterManager`, declare:

```cpp
JSON ParameterValuesToJSON(JsonArena& arena) const;
bool LoadParameterValuesFromJSON(JSON json);
Parameter* FindParameterByName(std::string_view name);
const Parameter* FindParameterByName(std::string_view name) const;
void ComputeAllParameters();
```

Include `synth/Json.hpp` in the header or forward declare only if practical.

- [ ] **Step 2: Implement parameter JSON shape**

Use this value shape:

```json
{
  "sceneCenters": [0.1, 0.2, 0.3],
  "gestureValues": [[0.1], [0.2], [0.3]],
  "gestureActive": [[true], [false], [true]],
  "modDepths": {
    "0": { "sceneCenters": [0.0, 0.5, 0.0], "modDepths": {} }
  }
}
```

Implementation requirements:
- Save scene centers for `group_.Config().numScenes`.
- Save gesture values/active as scene-major arrays sized `numScenes x group_.GestureCount()`.
- Save only existing child depth parameters where the parent's live `modulationDepths_[modIx]` `Parameter*` is non-null.
- Key child depths by `std::to_string(modIx)`.
- Do not save names, ranges, colors, polarity, pages, banks, slots, source metadata, selected gesture state, manager scene endpoints, scene blend, or shift state.

- [ ] **Step 3: Implement value-only load**

Load requirements:
- For a top-level parameter, apply only arrays whose lengths match the live shape.
- If `sceneCenters.Size() != numScenes`, skip `sceneCenters`.
- If `gestureValues.Size() != numScenes` or any row length differs from `GestureCount()`, skip all `gestureValues`.
- If `gestureActive.Size() != numScenes` or any row length differs from `GestureCount()`, skip all `gestureActive`.
- For `modDepths`, parse keys as decimal modulation slot indexes. If the live child pointer is null or key is invalid/out of range, ignore that child. Do not call `EnsureModulationDepth`.
- After manager load, call `ComputeAllParameters()` so derived current/target state is recomputed from loaded authoritative values.

- [ ] **Step 4: Add parameter round-trip tests**

Add tests covering:
- a top-level parameter's scene centers, gesture values, and gesture active flags restore by name;
- an existing modulation-depth child under `modDepths["0"]` restores recursively;
- unknown top-level parameter names are ignored;
- missing saved top-level names leave live defaults unchanged;
- saved child `modDepths["1"]` does not materialize a missing depth parameter;
- mismatched saved scene/gesture array shapes leave initialized values unchanged.

- [ ] **Step 5: Run task verification**

Run:

```bash
make -C projects/synth test
```

Expected: all tests pass, including new value-only load tests.

- [ ] **Step 6: xagent Claude review**

Prompt:

```text
Review Task 2 of add-midi-profile-json-persistence. Files: ParameterModulation.hpp/cpp and parameter_modulation_tests.cpp. Requirements: value-only load after initialization, top-level parameter values keyed by name, recursive modDepths keyed by live slot index, no EnsureModulationDepth during load, shape mismatches skip arrays and keep initialized values, no topology/metadata persistence. Findings first.
```

Fix and re-review until approved.

---

### Task 3: MIDI Profile Config JSON

**Files:**
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

- [ ] **Step 1: Add declarations**

Declare JSON helpers for all profile structs:

```cpp
JSON ToJSON(JsonArena& arena, const MidiControlAddress& value);
bool FromJSON(JSON json, MidiControlAddress& value);
JSON ToJSON(JsonArena& arena, const MessageIn& value);
bool FromJSON(JSON json, MessageIn& value);
JSON ToJSON(JsonArena& arena, const EncoderMidiInConfig& value);
bool FromJSON(JSON json, EncoderMidiInConfig& value);
JSON ToJSON(JsonArena& arena, const EncoderMidiOutConfig& value);
bool FromJSON(JSON json, EncoderMidiOutConfig& value);
JSON ToJSON(JsonArena& arena, const AnalogMidiInConfig& value);
bool FromJSON(JSON json, AnalogMidiInConfig& value);
JSON ToJSON(JsonArena& arena, const MidiControllerProfileConfig& value);
bool FromJSON(JSON json, MidiControllerProfileConfig& value);
```

- [ ] **Step 2: Implement explicit enum and optional encoding**

Use stable strings for enums:
- `EncoderRelativeMode::Signed7Bit` -> `"signed7Bit"`
- `EncoderRelativeMode::DirectionOnly` -> `"directionOnly"`
- `MessageIn::Type` -> its C++ enumerator name, e.g. `"ParamIncDec"`, `"ToggleShift"`.

For `std::optional<T>`, omit absent fields on save and leave defaults on load.

- [ ] **Step 3: Add round-trip tests**

Add tests that:
- construct a non-default `MidiControllerProfileConfig`;
- serialize and load it;
- compare all primitive fields in encoder input/output, analog mappings, system control, press/release/feedback messages, and WRLD.Bldr positions;
- pass the loaded config to `CreateMidiControllerProfile` and verify processor categories match the original config.

- [ ] **Step 4: Run task verification**

Run:

```bash
make -C projects/synth test
```

- [ ] **Step 5: xagent Claude review**

Prompt:

```text
Review Task 3 of add-midi-profile-json-persistence. Files: MidiController.hpp/cpp and tests. Check explicit MIDI profile config JSON for full input/output reconstruction, stable enum encoding, optional handling, no JUCE dependency, and round-trip coverage. Findings first.
```

---

### Task 4: Patch Document and File Versioning

**Files:**
- Create: `projects/synth/include/synth/PatchPersistence.hpp`
- Create: `projects/synth/src/PatchPersistence.cpp`
- Modify: `projects/synth/Makefile`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

- [ ] **Step 1: Add patch API declarations**

Define:

```cpp
struct MidiEndpointState {
    std::string inputIdentifier;
    std::string outputIdentifier;
};

struct PatchDocument {
    std::string patchName;
    MidiControllerProfileConfig midiProfile;
    MidiEndpointState midiEndpoints;
};

JSON ToJSON(JsonArena& arena, const MidiEndpointState& endpoints);
bool FromJSON(JSON json, MidiEndpointState& endpoints);
JSON BuildPatchJSON(JsonArena& arena, std::string_view patchName,
                    const ParameterManager& manager,
                    const MidiControllerProfileConfig& midiProfile,
                    const MidiEndpointState& endpoints = {});
bool LoadPatchJSON(JSON root, ParameterManager& manager,
                   MidiControllerProfileConfig& midiProfile,
                   MidiEndpointState* endpoints = nullptr);

std::string TimestampPatchFilename(std::chrono::system_clock::time_point now);
std::filesystem::path PatchDirectory(const std::filesystem::path& patchesRoot, std::string_view patchName);
std::filesystem::path SavePatchVersion(const std::filesystem::path& patchesRoot, std::string_view patchName,
                                       const std::string& jsonText,
                                       std::chrono::system_clock::time_point now = std::chrono::system_clock::now());
std::optional<std::filesystem::path> LatestPatchVersion(const std::filesystem::path& patchDir);
std::string LoadPatchVersionText(const std::filesystem::path& versionFile);
```

- [ ] **Step 2: Implement root JSON**

Root shape:

```json
{
  "schema": "sheaf.synth.patch",
  "schemaVersion": 1,
  "patchName": "BrightLead",
  "parameterValues": {},
  "midiProfile": {},
  "midiEndpoints": {
    "inputIdentifier": "...",
    "outputIdentifier": "..."
  }
}
```

Reject unsupported `schema`/`schemaVersion` by returning `false`. Missing optional `midiEndpoints` leaves endpoint strings empty.

- [ ] **Step 3: Implement Smart Grid-style files**

Use `patches/<patchName>/<YYYY-MM-DDTHH-MM-SS.json>`. `LatestPatchVersion` must list `*.json`, sort alphanumerically, and return the greatest filename. If two saves occur inside the same second, append `-NNN` or otherwise avoid overwriting while preserving sortable order.

- [ ] **Step 4: Add tests**

Test:
- patch root sections exist;
- parameter values and MIDI profile load from root;
- temp patches root creates per-patch directory;
- two saves create two files;
- latest selection chooses greatest filename;
- explicit version load reads the requested file;
- missing endpoint devices are represented as strings only and do not affect value load.

- [ ] **Step 5: Run task verification and review**

Run:

```bash
make -C projects/synth test
```

Then xagent review:

```text
Review Task 4 of add-midi-profile-json-persistence. Files: PatchPersistence.hpp/cpp, Makefile, tests. Check schema/version root, one-ParameterManager scope, Smart Grid-style per-patch timestamp files, latest selection, no UI dependency, and value-only load behavior. Findings first.
```

---

### Task 5: Miniapp Consumer Hooks

**Files:**
- Modify: `projects/synth/miniapp/Main.cpp`
- Modify: `projects/synth/miniapp/Makefile`
- Modify: `projects/synth/Makefile` if miniapp source list needs new persistence source.

- [ ] **Step 1: Store MIDI profile config separately from runtime processors**

Add a member:

```cpp
synth::MidiControllerProfileConfig midiProfileConfig_;
synth::MidiEndpointState midiEndpointState_;
```

In `rebuildMidiProcessors()`, build `midiProfileConfig_ = synth::WrldBldrDefaultProfileConfig(options);` and pass it to `CreateMidiControllerProfile`.

- [ ] **Step 2: Add programmatic save/load hooks**

Add private methods, no UI buttons:

```cpp
std::string SavePatchForTests(std::string_view patchName);
bool LoadPatchForTests(std::string_view jsonText);
```

`SavePatchForTests` builds JSON from the already initialized manager/profile/endpoints. `LoadPatchForTests` parses JSON into an arena, applies parameter values into the already initialized manager, replaces `midiProfileConfig_`, updates endpoint state, then calls `rebuildMidiProcessors()` using the loaded config.

- [ ] **Step 3: Keep JUCE device opening best-effort**

Endpoint identifiers should update combo-box selection if present. Do not force-open unavailable devices during JSON load.

- [ ] **Step 4: Build verification and review**

Run:

```bash
make -C projects/synth miniapp
```

Then xagent review:

```text
Review Task 5 of add-midi-profile-json-persistence. Files: synth miniapp and Makefiles. Check the miniapp is only a consumer of library persistence, initialization still defines topology before load, no UI was added, MIDI profile config can reconstruct processors, endpoint load is best-effort. Findings first.
```

---

### Task 6: Final Verification, OpenSpec Sync, and Whole-Change Review

**Files:**
- Modify: `openspec/changes/add-midi-profile-json-persistence/tasks.md`

- [ ] **Step 1: Run all required verification**

Run:

```bash
make -C projects/synth test
make synth-test
openspec validate add-midi-profile-json-persistence --strict
```

Expected: all pass.

- [ ] **Step 2: Mark OpenSpec tasks complete**

Only after tests and task reviews pass, update every completed checkbox in:

```text
openspec/changes/add-midi-profile-json-persistence/tasks.md
```

- [ ] **Step 3: Final Opus review**

Run:

```bash
node projects/xagent/dist/src/main.js run --harness claude_code --model opus --subagent "<final review prompt>"
```

Prompt:

```text
Final review for add-midi-profile-json-persistence. Review the full diff from main to HEAD. Requirements: code-defined initialization remains authoritative; persistence saves only parameter values and MIDI configuration profile plus endpoint identifiers; load is value-only, recursive, shape-safe, and never creates parameters/modulation definitions; Smart Grid arena JSON and patch versioning are used; miniapp only consumes library APIs. Findings first, ordered by severity, with file/line references.
```

- [ ] **Step 4: Fix final review findings and re-run verification**

Fix all Critical and Important findings. Re-run:

```bash
make synth-test
openspec validate add-midi-profile-json-persistence --strict
```

- [ ] **Step 5: Report final status**

Summarize:
- files changed;
- tests run;
- xagent review model/run ids;
- any residual risk or explicitly skipped verification.
