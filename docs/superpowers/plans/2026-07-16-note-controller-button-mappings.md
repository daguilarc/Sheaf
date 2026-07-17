# Note Controller Button Mappings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let encoder pushes and Generic controller system messages use numeric MIDI note addresses as well as CC addresses.

**Architecture:** Add a default-CC type discriminator to `MidiControlAddress`, reuse it in the existing input, persistence, validation, block, and view-model pipelines, and keep all controller-specific protocols unchanged. Implement in three TDD slices—core model/processors, block presentation, and Controllers page editing—followed by coverage and full verification.

**Tech Stack:** C++20, the synth JUCE-free library and portable UI tree, the existing Makefile test binaries, OpenSpec.

## Global Constraints

- Note-on with positive velocity is press; raw note-on with zero velocity and note-off with any release velocity are release.
- Encoder turns and analog inputs remain CC-only; encoder pushes may be CC or note.
- Only Generic system-message control addresses may select CC or note; WRLD.Bldr, MF Twister, and Launchpad system protocols remain unchanged.
- Note-addressed Generic system messages emit no CC or note output feedback, even when their stored output-feedback flag is true.
- Note values are numeric `0..127`; do not add musical note names, MIDI learn, note output feedback, or new dependencies.
- Missing persisted address type loads as CC, preserving existing profile behavior.
- Keep the existing numeric `cc` member and JSON number field; do not perform a broad rename.
- Preserve unrelated untracked `projects/synth/browser/package-lock.json` and `projects/synth/miniapp/` content and never include them in commits.
- Follow strict TDD for Tasks 1–3: record a focused RED failure before changing production code, then record GREEN output.

---

### Task 1: Typed Addresses, Input Semantics, Persistence, Validation, and Feedback

**OpenSpec coverage:** 1.1–1.5

**Files:**
- Modify: `projects/synth/include/synth/MidiController.hpp:188-205,696-704,819-824`
- Modify: `projects/synth/src/MidiController.cpp:565-625,693-739,1420-1437,1691-1745,1990-2030,2287-2348`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`
- Test: `projects/synth/tests/instrument_tests.cpp`

**Interfaces:**
- Produces: `enum class MidiControlType { Cc, Note };`
- Produces: `MidiControlAddress::type`, defaulting to `MidiControlType::Cc` and declared after `cc` so existing designated aggregate initialization stays source-compatible.
- Produces: JSON address field `"type": "cc" | "note"`; missing `type` loads as CC and unknown values fail without mutating the target.
- Consumes: existing `BasicMidi::{kStatusCC,kStatusNote,kStatusNoteOff}`, `GetCC()`, `GetNote()`, and `GetValue()`.

- [ ] **Step 1: Add failing processor tests**

Add focused cases beside the existing encoder and system-button tests. Construct raw zero-velocity note-on with the byte-vector constructor so it retains status `0x90`:

```cpp
const BasicMidi zeroVelocityNoteOn(
    1, std::vector<std::uint8_t>{static_cast<std::uint8_t>(BasicMidi::kStatusNote | 1), 60, 0});
const BasicMidi nonzeroVelocityNoteOff(
    2, std::vector<std::uint8_t>{static_cast<std::uint8_t>(BasicMidi::kStatusNoteOff | 1), 60, 77});
```

Cover note encoder press, both release forms, note/CC type mismatch and thru behavior, and Generic note system press/release.

- [ ] **Step 2: Run the processor tests and capture RED**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
```

Expected: compilation fails because `MidiControlType`/`MidiControlAddress::type` do not exist, or the new behavior assertions fail because note controls are not matched.

- [ ] **Step 3: Implement the address type and input classification**

Add the model without disturbing existing aggregate initializers:

```cpp
enum class MidiControlType { Cc, Note };

struct MidiControlAddress {
    std::uint8_t channel = 0;
    std::uint8_t cc = 0;
    MidiControlType type = MidiControlType::Cc;
    bool operator==(const MidiControlAddress& other) const = default;
};
```

In `MidiController.cpp`, use one local raw-message-to-address helper for CC, note-on, and note-off. Keep turn decoding inside the `midi.IsCC()` branch; match pushes after that branch by the typed address. A note press is exactly `Status() == kStatusNote && GetValue() > 0`; note-off status is never a press, regardless of release velocity. Use the same typed-address helper in `SystemButtonMidiInProcessor::FindAssociation` while preserving Launchpad position matching.

- [ ] **Step 4: Verify processor GREEN**

Run the same focused command. Expected: all `parameter_modulation_tests` cases pass with pristine output.

- [ ] **Step 5: Add failing persistence, validation, and feedback tests**

Add cases that assert:

```cpp
REQUIRE_TRUE(roundTripped.encoderInput->pushes.front().control.type == MidiControlType::Note);
REQUIRE_TRUE(legacyLoaded.encoderInput->pushes.front().control.type == MidiControlType::Cc);
```

Also cover unknown serialized type rejection, note turns and note analogs rejected, Generic note pushes/system controls accepted, WRLD.Bldr and MF Twister note system controls rejected, and a note-addressed Generic system association with `outputFeedback=true` creating no system CC output.

- [ ] **Step 6: Run persistence/validation tests and capture RED**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests build/instrument_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/instrument_tests
```

Expected: new serialization/validation/output assertions fail because those paths do not yet inspect `type`.

- [ ] **Step 7: Implement persistence, profile validation, and feedback suppression**

Serialize the enum with explicit names and default missing input to CC:

```cpp
json.SetNew("type", arena.String(value.type == MidiControlType::Note ? "note" : "cc"));
```

Parse into a local `MidiControlAddress parsed` and assign only after every field is valid. Extend `SlotValidForKind` so every turn and analog address is CC, pushes allow both types, Generic system controls allow both, and non-Generic `control` addresses require CC. When profile construction gathers `SystemCcMidiOutAssociation` entries, require `control->type == MidiControlType::Cc` in addition to the existing `outputFeedback` condition.

- [ ] **Step 8: Verify Task 1 GREEN**

Run the commands from Step 6. Expected: both binaries pass with no warnings or failures.

- [ ] **Step 9: Commit Task 1**

```bash
git add projects/synth/include/synth/MidiController.hpp projects/synth/src/MidiController.cpp projects/synth/tests/parameter_modulation_tests.cpp projects/synth/tests/instrument_tests.cpp
git commit -m "feat(synth): support note-addressed controller buttons"
```

---

### Task 2: Type-Aware Block Expansion, Reconstruction, and Ordering

**OpenSpec coverage:** 2.1–2.2

**Files:**
- Modify: `projects/synth/include/synth/MidiConfigBlocks.hpp:36-60,73-104,123-150`
- Modify: `projects/synth/src/MidiConfigBlocks.cpp:10-22,33-123,126-150,360-500`
- Test: `projects/synth/tests/blocks_tests.cpp`

**Interfaces:**
- Consumes: `MidiControlType` and `MidiControlAddress::type` from Task 1.
- Produces: `SystemAddressField::AddressType` for the Generic address schema.
- Produces: `EncoderBlock::controlType` and `SystemBlock::controlType`, both default CC.
- Produces: `SystemMessageSortKey::addrType`, ordered before channel/number.

- [ ] **Step 1: Add failing block tests**

Cover these behaviors with real expand/reconstruct calls:

```cpp
EncoderBlock pushBlock{.isPush = true, .channel = 1, .startCc = 60, .endCc = 62,
                       .slotIx = 0, .startPosition = 0,
                       .controlType = MidiControlType::Note};
```

Assert expanded push/system mappings retain Note; a note `EncoderBlock` with `isPush=false` is rejected; adjacent CC and Note mappings do not reconstruct into one block; reconstructed Note blocks expand back to Note; and Generic system sort keys distinguish otherwise identical CC and Note addresses.

- [ ] **Step 2: Run block tests and capture RED**

Run:

```bash
make -C projects/synth build/blocks_tests
projects/synth/build/blocks_tests
```

Expected: compilation fails on the new block/schema fields or new behavior assertions fail.

- [ ] **Step 3: Implement type-aware schema and blocks**

Add `AddressType` only to the Generic system schema:

```cpp
case MidiProfileKind::Generic:
    return {SystemAddressField::AddressType, SystemAddressField::Channel, SystemAddressField::Cc};
```

Include `addrType` in `SortKeyTuple`, populate it from `association.control->type`, stamp `controlType` during expansion, and copy it when reconstruction creates candidate blocks. Continuation checks must require equal address types. Reject note-typed turn blocks while allowing note-typed push blocks. Preserve type in all all-or-nothing temporary output vectors.

- [ ] **Step 4: Verify block GREEN**

Run the Step 2 command. Expected: all `blocks_tests` pass with pristine output.

- [ ] **Step 5: Commit Task 2**

```bash
git add projects/synth/include/synth/MidiConfigBlocks.hpp projects/synth/src/MidiConfigBlocks.cpp projects/synth/tests/blocks_tests.cpp
git commit -m "feat(synth): preserve button address type in blocks"
```

---

### Task 3: Controllers Page Note/CC Editing

**OpenSpec coverage:** 2.3–2.4

**Files:**
- Modify: `projects/synth/include/synth/MidiConfigViewModel.hpp:55-165,245-350`
- Modify: `projects/synth/src/MidiConfigViewModel.cpp:550-735,880-1055,1120-1270,1660-1885,2400-2535`
- Modify: `projects/synth/include/synth/ControllersPageUI.hpp:176-219,1268-1345`
- Test: `projects/synth/tests/viewmodel_tests.cpp`
- Test: `projects/synth/tests/controllers_page_ui_tests.cpp`

**Interfaces:**
- Consumes: Task 2 block fields and Generic `SystemAddressField::AddressType`.
- Produces: `MidiMappingRowVM::Field::AddressType`, distinct from `MessageKind` and `BlockMessageType`.
- Produces: `ControlAddressTypeCatalog()` returning `{"CC", "Note"}` in enum order.
- Produces: row field value `0.0` for CC and `1.0` for Note.

- [ ] **Step 1: Add failing view-model tests**

Assert encoder-push individual and block rows expose `AddressType`; encoder turns and analogs do not; Generic system individual and block rows expose it; WRLD.Bldr, MF Twister, and Launchpad system rows do not. Exercise `RowFieldValue` and `ApplyMappingEdit` for both enum indices, reject fractional/out-of-range indices, preserve the open row session, and verify committed mappings retain Note after expansion.

- [ ] **Step 2: Run view-model tests and capture RED**

Run:

```bash
make -C projects/synth build/viewmodel_tests
projects/synth/build/viewmodel_tests
```

Expected: compilation fails because `Field::AddressType` and its catalog do not exist.

- [ ] **Step 3: Implement view-model field metadata and edits**

Add the enum field and catalog:

```cpp
const std::vector<std::string>& ControlAddressTypeCatalog() {
    static const std::vector<std::string> values{"CC", "Note"};
    return values;
}
```

Treat `AddressType` as non-integer combo metadata, label it `Type`, and map `SystemAddressField::AddressType` to it. Insert it into encoder push rows/blocks only, and into Generic system rows/blocks through the schema. `RowFieldValue` returns the enum index from the row's address/block. `ApplyMappingEdit` accepts only integral catalog indices and writes the candidate address/block before the existing validate/expand/normalize/commit path; rejected edits leave output and open-session rows unchanged.

- [ ] **Step 4: Verify view-model GREEN**

Run the Step 2 command. Expected: all `viewmodel_tests` pass.

- [ ] **Step 5: Add failing portable Controllers page tests**

In `controllers_page_ui_tests.cpp`, inspect the built node tree and assert affected rows render an `AddressType` `ComboBox` with options `CC` and `Note`, selection follows the model, dispatching option `1` commits Note, the numeric address remains a text field containing the decimal number, and CC-only rows have no address-type node.

- [ ] **Step 6: Run Controllers page tests and capture RED**

Run:

```bash
make -C projects/synth build/controllers_page_ui_tests
projects/synth/build/controllers_page_ui_tests
```

Expected: new combo-node assertions fail because the portable tree has no address-type renderer.

- [ ] **Step 7: Render and dispatch the address-type combo**

Handle `Field::AddressType` beside `EncoderMode`, using `ControlAddressTypeCatalog()` and `RowFieldValue()` to populate `selectedOption`. Reuse `Actions::kMappingFieldCommit`; the generic portable JUCE backend already renders `NodeKind::ComboBox`, so do not add a controller-specific JUCE widget path.

```cpp
else if (field == MidiMappingRowVM::Field::AddressType) {
    fieldNode.kind = ui::NodeKind::ComboBox;
    const auto& catalog = ControlAddressTypeCatalog();
    // append numeric option ids and select RowFieldValue's integral index
}
```

- [ ] **Step 8: Verify Task 3 GREEN**

Run:

```bash
make -C projects/synth build/viewmodel_tests build/controllers_page_ui_tests
projects/synth/build/viewmodel_tests
projects/synth/build/controllers_page_ui_tests
```

Expected: both binaries pass with pristine output.

- [ ] **Step 9: Commit Task 3**

```bash
git add projects/synth/include/synth/MidiConfigViewModel.hpp projects/synth/src/MidiConfigViewModel.cpp projects/synth/include/synth/ControllersPageUI.hpp projects/synth/tests/viewmodel_tests.cpp projects/synth/tests/controllers_page_ui_tests.cpp
git commit -m "feat(synth): edit note button mappings in controllers page"
```

---

### Task 4: Coverage and Full Verification

**OpenSpec coverage:** 3.1–3.2

**Files:**
- Modify: `projects/synth/docs/coverage.md`
- Verify: all files changed by Tasks 1–3

**Interfaces:**
- Consumes: completed, reviewed implementation from Tasks 1–3.
- Produces: coverage entries for `spm-80`, `smi-9`, and `sru-27` that name their concrete test files and behaviors.

- [ ] **Step 1: Update capability coverage**

Add concise rows in the current synth coverage summary:

```markdown
| `spm-80` | covered | typed controller address matching, note press/release including raw zero-velocity note-on and nonzero-velocity note-off, persistence compatibility, and note-feedback suppression in `parameter_modulation_tests` |
| `smi-9` | covered | per-section and per-kind address-type acceptance/rejection in `instrument_tests` |
| `sru-27` | covered | type-aware block round trips in `blocks_tests`, row editing in `viewmodel_tests`, and portable combo rendering/dispatch in `controllers_page_ui_tests` |
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests build/instrument_tests build/blocks_tests build/viewmodel_tests build/controllers_page_ui_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/instrument_tests
projects/synth/build/blocks_tests
projects/synth/build/viewmodel_tests
projects/synth/build/controllers_page_ui_tests
```

Expected: every binary exits 0 with no failures.

- [ ] **Step 3: Run full synth verification**

Run:

```bash
make synth-test
openspec validate add-note-system-message-mappings --type change --strict --json --no-interactive
git diff --check
```

Expected: full synth suite exits 0, OpenSpec reports `valid: true` with no issues, and `git diff --check` is silent.

- [ ] **Step 4: Commit coverage**

```bash
git add projects/synth/docs/coverage.md
git commit -m "docs(synth): cover note controller mappings"
```
