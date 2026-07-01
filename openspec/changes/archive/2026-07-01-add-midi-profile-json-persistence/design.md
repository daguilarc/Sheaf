## Context

`projects/synth` currently has the core MIDI profile machinery in the library: `MidiControllerProfileConfig`, `CreateMidiControllerProfile`, `WrldBldrDefaultProfileConfig`, and `CreateWrldBldrDefaultProfile` live in `projects/synth/include/synth/MidiController.hpp` and `projects/synth/src/MidiController.cpp`. The miniapp currently wires those library profiles together with code-defined topology in `projects/synth/miniapp/main.cpp`: modules and application code create the `ParameterManager`, group, VCO/LFO pages, banks, slot layout, parameters, modulation-depth parameters, modulation sources, colors, names, ranges, and selected JUCE MIDI devices. The core parameter model already has stable top-level names/IDs, group-owned local modulation-depth parameters, manager-owned scene/gesture state, and MIDI profile config structs.

Smart Grid's sibling implementation provides the persistence pattern to adapt: `private/src/Json.hpp` is an arena-backed JSON tree, `StateInterchange.hpp` owns save/load arenas across JSON handoff, `TheNonagonSquiggleBoy.hpp::ToJSON/FromJSON` separates patch sections, and `JUCE/SmartGridOne/Source/IOUtils.cpp` stores patch versions under `SmartGridOne/patches/<patch>/<timestamp>.json`.

## Goals / Non-Goals

**Goals:**

- Add a JUCE-free arena JSON library to the synth library, copied/adapted from Smart Grid.
- Save and load patch values recursively by parameter name across top-level parameters and modulation-depth subtrees addressed by live code-defined modulator slots.
- Save and load the MIDI configuration profile needed to reconstruct MIDI input and output processor setup.
- Keep loading value-only for an initialized manager: JSON must never create or delete parameters, groups, banks, slots, pages, modulation sources, modulation assignments, colors, names, polarity/range, or MIDI mappings in place.
- Add file APIs and tests for patch-directory version history without adding a UI.

**Non-Goals:**

- No patch chooser, version chooser, or save/load buttons in this change.
- No persistence of module graphs, parameter definitions, colors, names, ranges, bank/page layouts, modulation-source metadata, or modulation assignments.
- No generalized reflection system for C++ structs; persistence remains explicit APIs.
- No attempt to serialize realtime DSP internals such as oscillator phase, scope buffers, or MIDI sender queues.

## Decisions

1. **Copy the arena JSON implementation into synth.**
   Add `projects/synth/include/synth/Json.hpp` and source/tests as needed, preserving the Smart Grid API shape: `JsonArena` is the factory (`Object`, `Array`, `String`, `Integer`, `Real`, `Boolean`, `Null`, `Loads`), `JSON` is a thin nullable handle, build/read operations are null-tolerant, and `Dumps` returns caller-owned text. Rationale: this is the requested proven implementation and keeps recursive save code allocation-explicit. Alternative considered: use `nlohmann::json` or JUCE `var`; both would add heap allocation and split JUCE-free library behavior.

2. **Use a sectioned, relatively flat patch document.**
   The root patch object should include `schema`, `schemaVersion`, `patchName`, `parameterValues`, and `midiProfile`. A patch document scopes to exactly one initialized `ParameterManager`, relying on that manager's existing top-level parameter-name uniqueness. `parameterValues` should be an object keyed by initialized top-level parameter name. Each parameter value object stores fixed-shape value arrays such as scene centers and per-scene gesture value/active state, plus a `modDepths` object keyed by the live modulation slot index as a string (`"0"`, `"1"`, ...). The only recursive part is `modDepths`; all configuration/metadata stays in code. Default/zero modulation-depth branches are omitted, even if their controls currently exist because a page was opened. Child depth parameter names may be recorded as diagnostics, but load must address child values by the parent's live `modulationDepths_[modIx]` pointer rather than by generated child names.

   This means modulator slot order is part of the patch-value ABI for modulation-depth values. Top-level parameters are guarded by name, but depth values intentionally follow the code-defined modulation slot topology so the loader never has to interpret persisted modulation metadata.

3. **Keep topology entirely code-defined.**
   Application/module initialization declares modules and parameters in code, and those modules register the parameters, modulation-depth controls, pages, banks, MIDI mappings, colors, names, ranges, polarity, and modulation assignments they need. Patch value load runs only after this initialization, resets the live parameter value graph to code-defined defaults, then matches saved parameter entries by name. If a saved name no longer exists, it is ignored. If an initialized parameter has no saved entry, it remains at its default value.

4. **Materialize local depth controls from code-defined slots, not JSON definitions.**
   Modulation-depth controls are implementation state of the parameter system, not miniapp-defined topology. The app/module initialization path defines the top-level parameters and the group’s modulator slots. When load sees a saved `modDepths["N"]` branch for a live parent parameter, the parameter system may materialize the missing local depth control for slot `N` using the live modulator metadata (name, short name, color, bipolar range, neutral default). JSON still never supplies definitions or assignments; it only says that the code-defined slot has saved values. If storage is exhausted, the branch is skipped rather than partially creating topology.

4a. **Open modulation pages atomically and keep storage ahead of demand.**
   Opening a modulation page must either populate every visible modulator-depth control for that parameter or do nothing. Partial pages are invalid because they make recursive UI state depend on allocation accidents. Parameter storage is segmented: existing parameter spans remain stable, and additional storage batches can be supplied later. When unused storage falls below twice the group’s modulator count, the parameter system emits a storage-batch request message; the app can provide the next batch from a control/background thread before the user clicks again.

5. **Treat value shape mismatches like missing values.**
   Saved arrays are only applied when their shape matches the initialized live parameter shape. Load resets parameter values first; if saved scene-center, gesture-value, or gesture-active array lengths differ from the live parameter's `numScenes`/gesture count, skip that mismatched array and leave those values at their code-defined defaults. Continue applying other matching arrays and other matching parameters. This extends the deleted/new parameter behavior to per-parameter array shape changes.

6. **Recompute derived runtime state after load.**
   Store authoritative parameter value state: scene centers and parameter-owned gesture value/active flags, recursively for modulation-depth parameters. Do not store derived `currentDepths`, `targetDepths`, min/max, center scales, scope state, processor caches, parameter metadata, or topology. After load, call the existing compute/update path enough to repopulate derived state and UI snapshots.

7. **Persist the MIDI configuration profile as the only persisted profile.**
   `MidiControllerProfileConfig` should gain `ToJSON/FromJSON` helpers for encoder input/output mappings, analog mappings, and system-message associations in the synth library. This saved MIDI profile fully reconstructs input and output processor setup. Optional selected input/output endpoint identifiers may be saved beside the profile, but JUCE handlers still own open/close. Loading should not force-open unavailable devices.

   The first patch schema treats `midiProfile` as a required section. A malformed, absent, or unsupported MIDI-profile JSON section rejects the patch before parameter values are applied; this keeps patch loads atomic and avoids value/profile mismatches. Future schema versions can relax this into independent partial load results if parameter-only recovery becomes a requirement.

8. **Use Smart Grid-style patch directories and timestamped versions.**
   Add a synth file helper rooted at a configurable/testable directory, defaulting to a user data/documents location such as `SheafSynth/patches`. Matching Smart Grid's current `FileManager`, each patch lives in `patches/<patchName>/`; each save writes a new sortable timestamp JSON version file such as `YYYY-MM-DDTHH-MM-SS.json`; latest load picks the alphanumerically greatest JSON filename. The patch name also lives in JSON.

9. **Add a patch lifecycle manager above JSON/file helpers.**
   Add a library `PatchManager` as a sibling to `ParameterManager`. It stores `std::optional<std::filesystem::path> currentPatchDirectory`, where a value always means a patch directory containing JSON version files and `nullopt` means an unsaved/new patch. It owns patch lifecycle commands but does not own app file pickers or the concrete synth state. Instead, it sends patch-system input messages to the initialized synth state and receives serialized JSON through an output bus.

   The patch lifecycle API should include:
   - `NewPatch()`: dispatch `RevertAllToDefault`, then clear `currentPatchDirectory`.
   - `SavePatch()`: if `currentPatchDirectory` is null, return `NeedsSaveAsPath`. Otherwise, if no save is in flight, allocate a monotonic `requestId`, dispatch `SerializeToJSON(requestId)`, record a pending save targeting `currentPatchDirectory`, and return `Pending`.
   - `SavePatchAs(path)`: require that the target directory path itself does not exist; existing parents are allowed, but an existing file or empty directory at the target path is rejected. If no save is in flight, allocate a `requestId`, dispatch `SerializeToJSON(requestId)`, record a pending save-as targeting `path`, and return `Pending`.
   - `ProcessResponses()`: drain `MessageOutBus` responses. When a serialized JSON response with the pending `requestId` arrives, write a new JSON version file. On save-as, create the directory and set `currentPatchDirectory` only after the version file is written successfully. Return a completion status such as `Written`, `Failed`, or `NoCompletion`. Only one save/save-as may be pending at a time; additional save requests return `Busy`.
   - `LoadPatch(path)`: accept either a patch directory or an explicit version file. Resolve the version file, read it, parse it into a JSON root, validate the patch root enough to reject unsupported/corrupt patch files, and dispatch `LoadFromJSON` with the already-deserialized root JSON. Set `currentPatchDirectory` to the directory (or containing directory) only after read, parse, validation, and message dispatch succeed; otherwise leave it unchanged and return failure.
   - `RevertPatch()`: if `currentPatchDirectory` is set, load and dispatch the latest version from it; otherwise behave like `NewPatch()`.

10. **Keep patch messages separate from MIDI/parameter control messages.**
   The existing `MessageIn` and `MessageInBus` are parameter/UI control messages and are serialized as part of MIDI profile config. Do not add JSON/file lifecycle payloads to that type. Add patch-specific library input messages, for example `PatchMessageIn` with `LoadFromJSON`, `RevertAllToDefault`, and `SerializeToJSON`. Use the user-facing output names `MessageOut` and `MessageOutBus` for serialized JSON responses. This keeps MIDI mapping persistence stable and avoids requiring `MessageIn` to own JSON arena lifetimes.

   Patch lifecycle buses are command buses, not musical event buses. They should not copy `MessageInBus` timestamp gating; consumers drain them explicitly in app/control code.

11. **Route patch messages through initialized synth state.**
   Add a library-side helper that applies patch input messages to initialized synth state, for example `ApplyPatchMessage(PatchMessageIn, ParameterManager&, MidiControllerProfileConfig&, MidiEndpointState&, MessageOutBus&, PatchSerializationContext&)`. The helper owns the pure-library dispatch: `LoadFromJSON` calls the existing value-only `LoadPatchJSON` path, `RevertAllToDefault` resets initialized values, and `SerializeToJSON` builds a patch JSON object from the current state and posts `MessageOut::SerializedJSON(requestId, json)`. Apps should only contribute app-specific side effects after a successful load, such as rebuilding JUCE MIDI processors.

   JSON-bearing messages must carry or otherwise retain ownership of the arena backing the JSON handle. For `LoadFromJSON`, `PatchManager` owns a per-message arena and keeps it alive until the input message is consumed. For `SerializeToJSON`, the library apply helper writes into a per-response arena owned by the `MessageOut` payload; the arena remains alive until `PatchManager::ProcessResponses()` consumes the response. Because only one save/save-as may be pending, response arena clobbering is not allowed.

   `RevertAllToDefault` resets all initialized parameter values and existing modulation-depth values to code-defined defaults without changing topology. Control/navigation reset uses a captured default control state on `ParameterManager`; if no explicit default state has been captured after initialization, the manager's constructor defaults are used. Patch load remains value-only and continues not to restore scene blend, shift, page, bank, or slot navigation state; full revert/new patch intentionally resets those controls.

12. **Miniapp uses the library patch manager with a temporary patch root.**
   Wire the miniapp to instantiate the patch manager and patch message buses. Since there is no file picker yet, use a stable testable directory under `/tmp`, such as `/tmp/sheaf-synth-miniapp-patches/Default`, for save-as/load actions. The miniapp may expose simple buttons or programmatic helpers, but it must not duplicate JSON or versioning logic outside the library.

## Risks / Trade-offs

- **Renamed parameters lose saved values** -> This is intentional name-keyed behavior matching Smart Grid; rename migrations can be added later if needed.
- **Recursive depth load creates hidden definitions** -> Loader materializes only local modulation-depth controls for live code-defined modulator slots. It does not create top-level parameters or read config metadata from JSON.
- **Shape drift after scene/gesture count changes** -> Mismatched arrays are skipped, leaving initialized defaults for that part of the live parameter value.
- **Arena capacity exhaustion** -> Follow Smart Grid's grow-and-retry pattern for parse/build; tests should force tiny arenas.
- **Saved metadata drifts from current code** -> Do not save parameter metadata; initialized code is authoritative for definitions.
- **Device identifiers are machine-specific** -> Store identifiers as best-effort selections beside `midiProfile`; unavailable devices leave MIDI closed and preserve the saved identifier for later.
- **Modulator slot order can drift** -> Modulation-depth values are keyed by live slot index, so moving code-defined modulation sources between slots can apply old depth values to a different live source. This is intentional for v1 because slot topology is code-defined and not persisted.
- **Required MIDI profile couples patch sections** -> Invalid or future-version MIDI profile JSON rejects the whole v1 patch before any parameter mutation. This favors atomic loads over parameter-only salvage in the first schema.
- **JSON message lifetime** -> Patch messages that carry `JSON` handles require the owning `JsonArena` to live until the consumer processes the message. JSON-bearing messages carry per-message arena ownership rather than passing temporary handles.
- **Save requires serialize response** -> Save and save-as are two-step operations. The patch manager reports `Pending`, later completes through `ProcessResponses()`, and leaves `currentPatchDirectory` unchanged for save-as failures.
- **Load/revert failure state** -> Failed read, parse, validation, or message dispatch leaves `currentPatchDirectory` unchanged. Revert without a current patch is the only failure-free fallback and behaves like new patch.

## Migration Plan

Implement this as additive library APIs. Existing initialization code continues to define modules, parameters, modulation assignments, and MIDI mappings before load. Old absence of patch files is not an error. Rollback is to stop calling the persistence helpers; no existing synth file format must be migrated.

## Open Questions

- Should future UI display version files as timestamps only, as Smart Grid does, or include the patch-name prefix in display text?
- Resolved for v1: selected MIDI endpoint identifiers live beside the required profile as `midiEndpoints`, because they are machine-specific JUCE selections rather than controller mapping definitions.
