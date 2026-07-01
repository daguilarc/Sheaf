## 1. Arena JSON

- [x] 1.1 Add synth JUCE-free arena JSON header/source adapted from Smart Grid `private/src/Json.hpp`.
- [x] 1.2 Add synth build/Makefile entries for the JSON implementation.
- [x] 1.3 Add tests for object/array/value build, parse, dump, numeric load, null-tolerant reads, and grow-and-retry after forced arena exhaustion.

## 2. Parameter Value Serialization

- [x] 2.1 Add `ToJSON(JsonArena&)` and value-load APIs for `Parameter`, including scene centers, per-scene gesture values, per-scene gesture active flags, and recursive modulation-depth child values keyed by live modulation slot index.
- [x] 2.2 Add `ToJSON(JsonArena&)` and value-load APIs for `ParameterManager` that walk initialized top-level parameters by parameter name and intentionally exclude manager UI/navigation state such as selected pages, banks, slots, scene blend/shift controls, and topology metadata.
- [x] 2.3 Ensure value load validates schema/shape before mutation, skips mismatched saved arrays while preserving initialized values, and never creates groups, top-level parameters, pages, banks, slots, modulation sources, or JSON-defined modulation-depth controls.
- [x] 2.4 Add round-trip tests proving top-level parameter values, parameter-owned gesture values/active flags, and nested modulation-depth value trees restore into a freshly code-initialized manager without restoring pages, banks, slots, or modulation definitions from JSON.
- [x] 2.5 Add tests proving unknown top-level parameters are ignored while saved recursive modulation-depth branches materialize only from live code-defined modulator slots.

## 3. Initialization Boundary

- [x] 3.1 Audit current module/miniapp initialization and identify which parameters and modulation-depth parameters are code-defined before load.
- [x] 3.2 Ensure persistence APIs operate only after initialization and never call app/module top-level parameter creation APIs during load.
- [x] 3.3 Add tests proving saved values for deleted parameter names are ignored, newly initialized parameters missing from JSON retain defaults, and saved scene/gesture array shape mismatches leave initialized values unchanged.

## 4. MIDI Profile Persistence

- [x] 4.1 Add JSON serialization/loading helpers for `MidiControllerProfileConfig` and nested encoder, analog, system-message, and output config structs.
- [x] 4.2 Add library JSON serialization/loading for generic MIDI endpoint state containing selected input and output identifiers separately from profile mappings; have the miniapp consume those identifiers in its JUCE device layer.
- [x] 4.3 Add tests proving WRLD.Bldr default profile config round-trips and rebuilds equivalent input/output processor categories.
- [x] 4.4 Add tests proving missing saved MIDI devices leave handlers closed and do not fail patch value load.

## 5. Patch Persistence

- [x] 5.1 Add synth patch document save/load helpers that write schema, schema version, patch name, parameter values by name, and MIDI configuration profile.
- [x] 5.2 Add file persistence helpers with configurable patches root, per-patch directories, timestamped JSON version files, latest-version selection, and explicit-version load.
- [x] 5.3 Wire the miniapp to run its existing code-defined initialization before consuming library persistence APIs, and expose programmatic save/load hooks without adding a UI.
- [x] 5.4 Add tests using a temp patches root proving two saves create two version files, latest load selects the newest sortable filename, and explicit version load reads the requested file.

## 6. Verification

- [x] 6.1 Run `make -C projects/synth test`.
- [x] 6.2 Run `make synth-test` from the repository root.
- [x] 6.3 Run `openspec validate add-midi-profile-json-persistence`.

## 7. Patch Lifecycle Manager

- [x] 7.1 Add library patch lifecycle input messages for `LoadFromJSON`, `RevertAllToDefault`, and `SerializeToJSON(requestId)`, plus JSON-owning `MessageOut` responses and `MessageOutBus`.
- [x] 7.2 Add `PatchManager` that owns nullable current patch directory state and implements new/save/save-as/load/revert orchestration through patch messages, one-in-flight save state, `ProcessResponses()`, and JSON version helpers.
- [x] 7.3 Add manager-wide parameter reset APIs with captured default control state, restoring initialized top-level parameters and existing modulation-depth parameters to code-defined defaults without topology mutation.
- [x] 7.4 Add a library helper to apply patch messages to `ParameterManager`, `MidiControllerProfileConfig`, `MidiEndpointState`, and `MessageOutBus`, keeping pure serialization/load/reset dispatch out of the miniapp.
- [x] 7.5 Add tests for patch manager current-directory transitions, save requiring save-as when current patch is null, save-as rejecting existing dirs/files, busy pending saves, `ProcessResponses()` completion, save creating additional version files, directory/latest load, explicit-version load, load/revert failure preserving current patch, and revert behavior.
- [x] 7.6 Add tests for patch input/output bus behavior, JSON arena lifetime ownership, serialization `requestId` correlation, and full reset not creating missing topology.

## 7A. Recursive Modulation Topology Hardening

- [x] 7A.1 Remove miniapp first-layer modulation-depth prepopulation so first and nested layers follow the same lazy path.
- [x] 7A.2 Add segmented parameter storage batches so reinforcement storage does not move or invalidate existing parameter spans.
- [x] 7A.3 Add parameter storage request messages when unused slots fall below twice the group modulator count, plus caller-provided batch installation.
- [x] 7A.4 Make modulation view opening all-or-nothing: insufficient storage leaves the current view unchanged and does not create partial depth controls.
- [x] 7A.5 Add randomized recursive modulation UI tests that press/tick/shift/gesture/scene through nested pages, serialize, load into a fresh initialization, and compare the recursive tree.

## 8. Miniapp Patch Manager Consumer

- [x] 8.1 Wire the miniapp to instantiate `PatchManager`, patch input bus, and message-out bus beside the existing parameter manager and MIDI buses.
- [x] 8.2 Route miniapp patch messages through the library apply helper, with the miniapp only handling app-specific side effects such as MIDI processor rebuilds after successful load.
- [x] 8.3 Add miniapp controls or programmatic helpers for new/save/save-as/load/revert using a deterministic `/tmp` patch directory, with no app-local JSON/versioning implementation.
- [x] 8.4 Add or update miniapp tests/build coverage for missing MIDI devices, tmp save/load/revert flow, and successful app target compile.

## 9. Final Verification

- [x] 9.1 Run `make -C projects/synth test`.
- [x] 9.2 Run `make synth-test` from the repository root.
- [x] 9.3 Run `make -C projects/synth/miniapp test && make -C projects/synth/miniapp all`.
- [x] 9.4 Run `openspec validate add-midi-profile-json-persistence`.
- [x] 9.5 Run xagent Claude Opus implementation review and address findings.
