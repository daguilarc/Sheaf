# Rework Controllers Block Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragile Controllers page block reconstruction with stable open-section edit sessions, fix scrolling, split system-message kind/arguments, and cover the page with oracle-driven simulation tests.

**Architecture:** Persisted MIDI profile arrays remain the saved source of truth. Opening a section coalesces persisted arrays into an in-memory edit session; accepted changes mutate that session, expand it back to normalized persisted arrays, and do not re-coalesce visible rows until close/reopen. System messages use one shared row/block/edit pipeline whose only per-kind variation is address schema.

**Tech Stack:** C++20, JUCE-free synth core tests under `projects/synth/tests`, JUCE renderer/simulation tests under `projects/synth/juce`, OpenSpec change `rework-controllers-block-editing`.

---

## File Structure

- Modify `projects/synth/include/synth/MidiConfigViewModel.hpp`: add edit-session row types, message-kind/argument fields, and remove stale identity-cache comments once replaced.
- Modify `projects/synth/src/MidiConfigViewModel.cpp`: implement open-section sessions, session flush, add/edit/delete behavior, and shared system-message pipeline.
- Modify `projects/synth/include/synth/MidiConfigBlocks.hpp` and `projects/synth/src/MidiConfigBlocks.cpp`: expose pure coalesce/expand helpers where the session needs block conversions; keep reconstruction math JUCE-free.
- Modify `projects/synth/include/synth/PortableUI.hpp`: add scroll content extent to `synth::ui::Node`.
- Modify `projects/synth/include/synth/ControllersPageUI.hpp`: build scroll nodes with viewport bounds and content extent; render message-kind and argument fields.
- Modify `projects/synth/juce/ControllersPageJuce.hpp`: size viewport and content separately and refresh immediately after accepted actions.
- Modify `projects/synth/tests/viewmodel_tests.cpp`: add edit-session, system-message field, and shared-pipeline regression tests.
- Modify `projects/synth/tests/controllers_page_ui_tests.cpp`: add portable tree scroll/content and message-control tests.
- Modify `projects/synth/juce/ControllersPageJuceTests.cpp`: add JUCE viewport reachability regression tests.
- Rewrite `projects/synth/juce/ControllersPageSimulationTests.cpp`: oracle-driven randomized simulation using production surface/renderer.
- Modify `projects/synth/juce/ControllersPageHarness.hpp` and `projects/synth/juce/ControllersPageHarnessApp.cpp`: keep the harness on production paths and add large all-kind fixtures.

---

### Task 1: Lock In Failing Regressions

**Files:**
- Modify: `projects/synth/tests/viewmodel_tests.cpp`
- Modify: `projects/synth/tests/controllers_page_ui_tests.cpp`
- Modify: `projects/synth/juce/ControllersPageJuceTests.cpp`

- [ ] **Step 1: Add a stable-open-session test**

Add this test shape to `projects/synth/tests/viewmodel_tests.cpp`. Use existing helpers such as `MakeGenericSlot`, `MakeFourKindConnection`, `SectionRows`, `AddSingle`, `ApplyMappingEdit`, and `ToggleSection`; adjust row indexes by finding rows with `RowGroup::System` rather than hard-coding positions.

```cpp
TEST_CASE(SystemRowsDoNotCoalesceUntilCloseReopen) {
    MidiInstrumentConfig instrument;
    REQUIRE_TRUE(instrument.AddController(MakeGenericSlot("generic")));
    MidiConfigViewModel vm;
    vm.Rebuild(instrument, MidiConnectionState{});
    vm.ToggleConfig(0);
    vm.ToggleSection(0, MidiConfigSection::SystemMessages);

    MidiInstrumentConfig next;
    std::string reason;
    REQUIRE_TRUE(vm.AddSingle(0, MidiConfigSection::SystemMessages, MidiMappingRowVM::RowGroup::System, next, &reason));
    vm.Rebuild(next, MidiConnectionState{});
    REQUIRE_TRUE(vm.AddSingle(0, MidiConfigSection::SystemMessages, MidiMappingRowVM::RowGroup::System, next, &reason));
    vm.Rebuild(next, MidiConnectionState{});

    const auto openRows = vm.SectionRows(0, MidiConfigSection::SystemMessages);
    const auto singletonCount = std::count_if(openRows.begin(), openRows.end(), [](const MidiMappingRowVM& row) {
        return row.group == MidiMappingRowVM::RowGroup::System && row.kind == MidiMappingRowVM::Kind::Individual;
    });
    REQUIRE_TRUE(singletonCount >= 2);

    vm.ToggleSection(0, MidiConfigSection::SystemMessages);
    vm.ToggleSection(0, MidiConfigSection::SystemMessages);
    const auto reopenedRows = vm.SectionRows(0, MidiConfigSection::SystemMessages);
    REQUIRE_TRUE(std::any_of(reopenedRows.begin(), reopenedRows.end(), [](const MidiMappingRowVM& row) {
        return row.group == MidiMappingRowVM::RowGroup::System && row.kind == MidiMappingRowVM::Kind::Block;
    }));
}
```

- [ ] **Step 2: Add block-edit and add/delete regression tests**

Add tests that assert: a block edit keeps a block row visible at the same row index, `AddBlock` appends a block at the end of the system group, `DeleteRow` removes exactly that row, and `CanDeleteRow` is false for config-level encoder mode/step rows.

```cpp
TEST_CASE(BlockEditFlushesWithoutVisibleRegrouping) {
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    MidiConfigViewModel vm;
    vm.Rebuild(instrument, MakeFourKindConnection());
    vm.ToggleConfig(0);
    vm.ToggleSection(0, MidiConfigSection::Encoders);

    const auto before = vm.SectionRows(0, MidiConfigSection::Encoders);
    const auto blockIt = std::find_if(before.begin(), before.end(), [](const MidiMappingRowVM& row) {
        return row.kind == MidiMappingRowVM::Kind::Block && row.group == MidiMappingRowVM::RowGroup::EncoderTurn;
    });
    REQUIRE_TRUE(blockIt != before.end());
    const std::size_t blockIx = static_cast<std::size_t>(blockIt - before.begin());

    MidiInstrumentConfig next;
    std::string reason;
    REQUIRE_TRUE(vm.ApplyMappingEdit(0, MidiConfigSection::Encoders, blockIx,
                                     MidiMappingRowVM::Field::BlockStartPos, 1.0, next, &reason));
    vm.Rebuild(next, MakeFourKindConnection());

    const auto after = vm.SectionRows(0, MidiConfigSection::Encoders);
    REQUIRE_TRUE(after.size() == before.size());
    REQUIRE_TRUE(after[blockIx].kind == MidiMappingRowVM::Kind::Block);
    REQUIRE_TRUE(after[blockIx].group == MidiMappingRowVM::RowGroup::EncoderTurn);
}
```

- [ ] **Step 3: Add message-kind/argument field tests**

First add expected field names in Task 3, then assert rows expose kind and arguments separately. Temporarily write the test against the intended names so it fails:

```cpp
TEST_CASE(SystemMessageKindDoesNotBakeArgumentsIntoComboLabels) {
    MidiConfigViewModel vm;
    vm.Rebuild(MakeFourKindInstrument(), MakeFourKindConnection());
    vm.ToggleConfig(0);
    vm.ToggleSection(0, MidiConfigSection::SystemMessages);

    const auto rows = vm.SectionRows(0, MidiConfigSection::SystemMessages);
    REQUIRE_TRUE(std::any_of(rows.begin(), rows.end(), [](const MidiMappingRowVM& row) {
        return std::find(row.editableFields.begin(), row.editableFields.end(), MidiMappingRowVM::Field::MessageKind) != row.editableFields.end() &&
               std::find(row.editableFields.begin(), row.editableFields.end(), MidiMappingRowVM::Field::MessageArg) != row.editableFields.end();
    }));
}
```

- [ ] **Step 4: Add portable scroll invariant tests**

In `projects/synth/tests/controllers_page_ui_tests.cpp`, add a test that expands a large fixture, finds the `ScrollArea`, and asserts `node.scrollContentHeight > node.bounds.height`. Use the new field name from Task 6:

```cpp
REQUIRE_TRUE(scrollNode.scrollContentHeight > scrollNode.bounds.height);
```

- [ ] **Step 5: Run tests to prove failure**

Run:

```bash
make -C projects/synth test
make -C projects/synth/apps/miniapp test
```

Expected: the new tests fail to compile or fail assertions because `MessageKind`, `MessageArg`, and `scrollContentHeight` do not exist yet, and because open-section rows still use identity/rebuild behavior.

- [ ] **Step 6: Commit failing tests**

```bash
git add projects/synth/tests/viewmodel_tests.cpp projects/synth/tests/controllers_page_ui_tests.cpp projects/synth/juce/ControllersPageJuceTests.cpp
git commit -m "test(synth): pin controller edit-session regressions"
```

---

### Task 2: Add Edit-Session Data Model

**Files:**
- Modify: `projects/synth/include/synth/MidiConfigViewModel.hpp`
- Modify: `projects/synth/src/MidiConfigViewModel.cpp`

- [ ] **Step 1: Define session row storage**

Replace `detail::PresentationRow`/`SectionPresentation` with a clearer session model. Preserve fields needed by existing render code, but rename comments around behavior.

```cpp
namespace detail {

using ControllerSectionKey = std::pair<std::string, MidiConfigSection>;

struct SessionRow {
    MidiMappingRowVM::Kind kind = MidiMappingRowVM::Kind::Individual;
    MidiMappingRowVM::RowGroup group = MidiMappingRowVM::RowGroup::System;
    std::vector<RowIdentity> sourceIdentities;
    std::variant<std::monostate, EncoderMidiMapping, AnalogMidiMapping,
                 MidiControllerSystemMessageAssociation, EncoderBlock, AnalogBlock, SystemBlock> value;
};

struct SectionEditSession {
    MidiProfileKind kind = MidiProfileKind::Generic;
    std::vector<SessionRow> rows;
};

}  // namespace detail
```

- [ ] **Step 2: Add session map and helpers**

In `MidiConfigViewModel` private members, store sessions by controller name plus section:

```cpp
mutable std::map<detail::ControllerSectionKey, detail::SectionEditSession> editSessions_;
```

Add helpers in `.cpp`:

```cpp
detail::ControllerSectionKey SessionKey(const MidiControllerSlot& slot, MidiConfigSection section) {
    return {slot.name, section};
}

bool SessionCompatible(const detail::SectionEditSession& session, const MidiControllerSlot& slot) {
    return session.kind == slot.kind;
}
```

- [ ] **Step 3: Build session only on section open**

Change `ToggleSection` so collapsed-to-expanded calls a new `OpenSessionFor(controllerIx, section)` and expanded-to-collapsed erases the session.

```cpp
void MidiConfigViewModel::ToggleSection(std::size_t controllerIx, MidiConfigSection section) {
    if (controllerIx >= controllers_.size()) {
        return;
    }
    const std::string& name = controllers_[controllerIx].name;
    const bool willExpand = !expandState_[name].sections[section];
    expandState_[name].sections[section] = willExpand;
    const MidiControllerSlot& slot = instrument_.controllers[controllerIx];
    const auto key = detail::SessionKey(slot, section);
    if (willExpand) {
        editSessions_[key] = BuildSessionFromConfig(slot, section);
    } else {
        editSessions_.erase(key);
    }
}
```

- [ ] **Step 4: Preserve sessions on rebuild**

In `Rebuild`, remove ordinary re-coalescing/re-resolution for compatible open sessions. Erase sessions only for removed controller names or kind mismatches.

```cpp
for (auto it = editSessions_.begin(); it != editSessions_.end();) {
    const MidiControllerSlot* slot = FindSlotByName(instrument_, it->first.first);
    if (slot == nullptr || !SessionCompatible(it->second, *slot)) {
        it = editSessions_.erase(it);
    } else {
        ++it;
    }
}
```

- [ ] **Step 5: Make `SectionRows` render session rows**

Change `PresentationFor`/`BuildSectionRows` to use `editSessions_`. If a section is expanded but lacks a session, lazily create one for compatibility with tests that call `SectionRows` immediately after manually toggling state.

```cpp
detail::SectionEditSession& MidiConfigViewModel::SessionFor(std::size_t controllerIx, MidiConfigSection section) const {
    const MidiControllerSlot& slot = instrument_.controllers[controllerIx];
    const auto key = detail::SessionKey(slot, section);
    auto [it, inserted] = editSessions_.try_emplace(key);
    if (inserted) {
        it->second = BuildSessionFromConfig(slot, section);
    }
    return it->second;
}
```

- [ ] **Step 6: Run viewmodel tests**

Run:

```bash
make -C projects/synth build
projects/synth/build/viewmodel_tests
```

Expected: compile succeeds; some tests may still fail until row operations flush from sessions.

- [ ] **Step 7: Commit session skeleton**

```bash
git add projects/synth/include/synth/MidiConfigViewModel.hpp projects/synth/src/MidiConfigViewModel.cpp
git commit -m "feat(synth): add controller config edit sessions"
```

---

### Task 3: Implement Coalesce, Expand, and Flush

**Files:**
- Modify: `projects/synth/include/synth/MidiConfigBlocks.hpp`
- Modify: `projects/synth/src/MidiConfigBlocks.cpp`
- Modify: `projects/synth/src/MidiConfigViewModel.cpp`

- [ ] **Step 1: Add section coalesce entry points**

Expose functions that build rows without relying on view-model rebuild state:

```cpp
std::vector<detail::SessionRow> CoalesceEncoderSessionRows(const EncoderMidiInConfig& input);
std::vector<detail::SessionRow> CoalesceAnalogSessionRows(const AnalogMidiInConfig& input);
std::vector<detail::SessionRow> CoalesceSystemSessionRows(const std::vector<MidiControllerSystemMessageAssociation>& associations,
                                                          MidiProfileKind kind);
```

Keep `detail::SessionRow` inside `MidiConfigViewModel.hpp`; `MidiConfigBlocks.hpp` continues to expose reconstructed block row structs and pure expansion/reconstruction functions, and `MidiConfigViewModel.cpp` translates those reconstructed rows into session rows.

- [ ] **Step 2: Add expansion helpers in the view model**

Implement flush helpers in `MidiConfigViewModel.cpp`:

```cpp
bool FlushSessionToSlot(const detail::SectionEditSession& session,
                        MidiConfigSection section,
                        MidiControllerSlot& slot,
                        std::string* reason) {
    switch (section) {
        case MidiConfigSection::Encoders:
            return ExpandEncoderSession(session.rows, slot, reason);
        case MidiConfigSection::Analogs:
            return ExpandAnalogSession(session.rows, slot, reason);
        case MidiConfigSection::SystemMessages:
            return ExpandSystemSession(session.rows, slot, reason);
    }
    return false;
}
```

Each expander should rebuild the whole section from session rows, preserving config-level values from existing slot config.

- [ ] **Step 3: Validate before mutating visible session**

For edits that can fail, first copy the session, mutate the copy, expand into a scratch instrument, validate, then assign the copied session into `editSessions_`.

```cpp
detail::SectionEditSession candidateSession = session;
ApplyFieldToSessionRow(candidateSession.rows[rowIx], field, value, slot.kind, validationError);
MidiInstrumentConfig scratch = instrument_;
if (!FlushSessionToSlot(candidateSession, section, scratch.controllers[controllerIx], reason)) {
    return false;
}
NormalizeMidiProfileConfig(scratch.controllers[controllerIx].config, scratch.controllers[controllerIx].kind);
if (!SlotValidForKind(scratch.controllers[controllerIx], reason)) {
    return false;
}
session = std::move(candidateSession);
out = std::move(scratch);
return true;
```

- [ ] **Step 4: Remove identity re-sync from ordinary rebuild**

Delete or quarantine helpers whose only purpose was to re-resolve and re-sync block rows on every rebuild, such as `RebuildPresentationFor`, `ReSyncBlockRow`, and optimistic identity staging. Keep identity helpers only where needed to coalesce existing persisted config on open.

- [ ] **Step 5: Run tests**

Run:

```bash
make -C projects/synth test
```

Expected: view-model session tests begin passing; message-kind and scroll tests still fail until later tasks.

- [ ] **Step 6: Commit coalesce/flush**

```bash
git add projects/synth/include/synth/MidiConfigBlocks.hpp projects/synth/src/MidiConfigBlocks.cpp projects/synth/include/synth/MidiConfigViewModel.hpp projects/synth/src/MidiConfigViewModel.cpp
git commit -m "feat(synth): flush controller sessions to profile config"
```

---

### Task 4: Rework Row Operations

**Files:**
- Modify: `projects/synth/src/MidiConfigViewModel.cpp`
- Modify: `projects/synth/include/synth/MidiConfigViewModel.hpp`

- [ ] **Step 1: Edit session rows in `ApplyMappingEdit`**

Change individual, block, and config-level branches to target `SessionFor(controllerIx, section).rows[rowIx]`. Block edits should mutate the block value stored in that session row. Individual edits should mutate the stored mapping/association value.

- [ ] **Step 2: Append in `AddSingle` and `AddBlock`**

Create the default mapping/block from the current persisted slot plus session occupancy, append a `SessionRow`, then flush. Do not call coalesce after append.

```cpp
detail::SessionRow row;
row.kind = MidiMappingRowVM::Kind::Block;
row.group = group;
row.value = block;
candidateSession.rows.insert(EndOfGroup(candidateSession.rows, group), std::move(row));
```

- [ ] **Step 3: Delete by session row index**

`DeleteRow` should copy the session, erase `rows.begin() + rowIx`, flush, validate, then commit candidate session and output config.

- [ ] **Step 4: Preserve refused-action state**

Add tests that snapshot `DumpInstrument(instrument)` and `SectionRows()` before an invalid duplicate-address block edit, then assert both snapshots are unchanged after refusal.

- [ ] **Step 5: Run focused tests**

Run:

```bash
projects/synth/build/viewmodel_tests
```

Expected: edit/add/delete tests pass.

- [ ] **Step 6: Commit row operations**

```bash
git add projects/synth/include/synth/MidiConfigViewModel.hpp projects/synth/src/MidiConfigViewModel.cpp projects/synth/tests/viewmodel_tests.cpp
git commit -m "fix(synth): apply controller edits through sessions"
```

---

### Task 5: Split System Message Kind and Arguments

**Files:**
- Modify: `projects/synth/include/synth/MidiConfigViewModel.hpp`
- Modify: `projects/synth/src/MidiConfigViewModel.cpp`
- Modify: `projects/synth/include/synth/ControllersPageUI.hpp`
- Modify: `projects/synth/tests/viewmodel_tests.cpp`
- Modify: `projects/synth/tests/controllers_page_ui_tests.cpp`

- [ ] **Step 1: Add semantic fields**

Add fields to `MidiMappingRowVM::Field`:

```cpp
MessageKind,
MessageArg,
MessageBankSlot,
ReleaseKind,
ReleaseArg,
```

Use `MessageKind` and `MessageArg` for press. Use `ReleaseKind`/`ReleaseArg` only for rows where release is editable. Keep block fields `BlockMessageType`, `BlockStartArg`, and `BlockBankSlotIx`.

- [ ] **Step 2: Add compact catalogs**

Replace singleton row use of `SystemMessageCatalog()` in Controllers page rendering with compact kind options:

```cpp
struct SystemMessageKindOption {
    MessageIn::Type type;
    const char* label;
};

std::span<const SystemMessageKindOption> SystemMessageKindCatalog();
```

Labels must be argument-free: `Scene Select`, `Bank Select`, `Gesture Select`, `Set Reset`, etc.

- [ ] **Step 3: Implement argument accessors**

Add accessors alongside `RowFieldValue`:

```cpp
int SystemMessageKindIndex(std::size_t controllerIx, MidiConfigSection section,
                           std::size_t rowIx, MidiMappingRowVM::Field field) const;
bool RowFieldValue(... Field::MessageArg ...);
bool RowFieldValue(... Field::MessageBankSlot ...);
```

- [ ] **Step 4: Update edit application**

`ApplyMappingEdit` should interpret:

- `MessageKind`: change `association.press.type` while preserving compatible argument defaults.
- `MessageArg`: edit scene index, bank index, or gesture index according to current kind.
- `MessageBankSlot`: edit bank slot for bank select.
- `ReleaseKind`/`ReleaseArg`: same split for optional release where supported.

- [ ] **Step 5: Update portable UI controls**

In `ControllersPageUI.hpp`, render combo boxes for kind fields using compact labels and render numeric fields for argument fields. Remove UI usage of `SystemMessageCatalog()` labels for singleton rows.

- [ ] **Step 6: Add label regression assertions**

In `controllers_page_ui_tests.cpp`, walk all combo node options:

```cpp
REQUIRE_TRUE(option.label != "Scene Select 3");
REQUIRE_TRUE(option.label.find("Scene Select ") == std::string::npos);
REQUIRE_TRUE(option.label.find("Bank Select ") == std::string::npos);
REQUIRE_TRUE(option.label.find("Gesture Select ") == std::string::npos);
```

- [ ] **Step 7: Run tests**

Run:

```bash
make -C projects/synth test
```

Expected: core and portable UI tests pass.

- [ ] **Step 8: Commit message split**

```bash
git add projects/synth/include/synth/MidiConfigViewModel.hpp projects/synth/src/MidiConfigViewModel.cpp projects/synth/include/synth/ControllersPageUI.hpp projects/synth/tests/viewmodel_tests.cpp projects/synth/tests/controllers_page_ui_tests.cpp
git commit -m "fix(synth): split system message kind and arguments"
```

---

### Task 6: Consolidate System Message Pipeline

**Files:**
- Modify: `projects/synth/include/synth/MidiConfigViewModel.hpp`
- Modify: `projects/synth/src/MidiConfigViewModel.cpp`
- Modify: `projects/synth/src/MidiConfigBlocks.cpp`
- Modify: `projects/synth/tests/viewmodel_tests.cpp`

- [ ] **Step 1: Extract schema as data**

Represent address variation with one schema function:

```cpp
struct SystemAddressSchemaEntry {
    MidiMappingRowVM::Field field;
    const char* label;
};

std::span<const SystemAddressSchemaEntry> SystemAddressSchema(MidiProfileKind kind);
```

- [ ] **Step 2: Replace kind-specific row construction**

System row construction should call:

```cpp
std::vector<MidiMappingRowVM::Field> SystemEditableFields(MidiProfileKind kind, const MessageIn& press) {
    std::vector<MidiMappingRowVM::Field> fields;
    for (const auto& entry : SystemAddressSchema(kind)) {
        fields.push_back(entry.field);
    }
    fields.push_back(MidiMappingRowVM::Field::MessageKind);
    AppendArgumentFields(fields, press);
    fields.push_back(MidiMappingRowVM::Field::ReleaseKind);
    return fields;
}
```

- [ ] **Step 3: Share validation and address mutation**

Implement one function:

```cpp
bool ApplySystemAddressField(MidiControllerSystemMessageAssociation& association,
                             MidiProfileKind kind,
                             MidiMappingRowVM::Field field,
                             double value,
                             std::string& error);
```

It handles WRLD.Bldr channel/x/y, Launchpad x/y, Twister button, and Generic channel/cc using schema rules.

- [ ] **Step 4: Share block support checks**

Keep Twister no-block behavior as data-driven support:

```cpp
bool SystemBlocksSupported(MidiProfileKind kind) {
    return kind != MidiProfileKind::MfTwister;
}
```

All other block add/edit paths use common `SystemBlock` expansion and validation.

- [ ] **Step 5: Add all-kind shared tests**

Create a helper:

```cpp
void ExpectSharedSystemMessageFields(MidiProfileKind kind, const std::vector<MidiMappingRowVM::Field>& addressFields);
```

Call it for WRLD.Bldr, Launchpad, MF Twister, and Generic. Assert common message fields exist for each, and only address fields differ.

- [ ] **Step 6: Run tests**

Run:

```bash
make -C projects/synth test
```

Expected: all JUCE-free tests pass.

- [ ] **Step 7: Commit shared pipeline**

```bash
git add projects/synth/include/synth/MidiConfigViewModel.hpp projects/synth/src/MidiConfigViewModel.cpp projects/synth/src/MidiConfigBlocks.cpp projects/synth/tests/viewmodel_tests.cpp
git commit -m "refactor(synth): share system message editing pipeline"
```

---

### Task 7: Fix Scroll Contract and JUCE Renderer

**Files:**
- Modify: `projects/synth/include/synth/PortableUI.hpp`
- Modify: `projects/synth/include/synth/ControllersPageUI.hpp`
- Modify: `projects/synth/juce/ControllersPageJuce.hpp`
- Modify: `projects/synth/tests/controllers_page_ui_tests.cpp`
- Modify: `projects/synth/juce/ControllersPageJuceTests.cpp`

- [ ] **Step 1: Add content extent to portable nodes**

Add to `synth::ui::Node`:

```cpp
float scrollContentWidth = 0.0f;
float scrollContentHeight = 0.0f;
```

For non-scroll nodes, leave both at zero.

- [ ] **Step 2: Build scroll node correctly**

In `BuildControllersPageTree`, keep the scroll node `bounds.height` equal to the visible viewport height and set `scrollContentHeight` to the computed content height:

```cpp
tree.nodes[scrollAreaIndex].bounds = viewportBounds;
tree.nodes[scrollAreaIndex].scrollContentWidth = viewportBounds.width;
tree.nodes[scrollAreaIndex].scrollContentHeight = std::max(viewportBounds.height, scrollY);
```

Do not assign `bounds.height = scrollY`.

- [ ] **Step 3: Render viewport and content separately**

In `ControllersPageJuce.hpp`, update layout:

```cpp
m_viewport.setBounds(UiToJuceRect(scrollNode.bounds));
m_content.setSize(static_cast<int>(std::ceil(scrollNode.scrollContentWidth)),
                  static_cast<int>(std::ceil(scrollNode.scrollContentHeight)));
```

- [ ] **Step 4: Assert reachability**

In JUCE tests, scroll to bottom and assert final row bottom is within content and can be visible after setting view position:

```cpp
viewport.setViewPosition(0, viewport.getViewedComponent()->getHeight());
REQUIRE_TRUE(lastRow->getBottom() <= viewport.getViewedComponent()->getHeight());
```

- [ ] **Step 5: Run UI and JUCE tests**

Run:

```bash
projects/synth/build/controllers_page_ui_tests
make -C projects/synth/apps/miniapp test
```

Expected: scroll tests pass.

- [ ] **Step 6: Commit scroll fix**

```bash
git add projects/synth/include/synth/PortableUI.hpp projects/synth/include/synth/ControllersPageUI.hpp projects/synth/juce/ControllersPageJuce.hpp projects/synth/tests/controllers_page_ui_tests.cpp projects/synth/juce/ControllersPageJuceTests.cpp
git commit -m "fix(synth): separate controller scroll extent from viewport"
```

---

### Task 8: Replace Simulation With Oracle-Driven Model

**Files:**
- Rewrite: `projects/synth/juce/ControllersPageSimulationTests.cpp`
- Modify: `projects/synth/README.md` if seed docs change

- [ ] **Step 1: Define oracle state**

In `ControllersPageSimulationTests.cpp`, add:

```cpp
struct OracleSection {
    bool open = false;
    std::vector<OracleRow> rows;
};

struct OracleState {
    synth::MidiInstrumentConfig persisted;
    std::map<std::pair<std::string, synth::MidiConfigSection>, OracleSection> sections;
};
```

`OracleRow` should store kind, group, label-relevant values, and row expansion data.

- [ ] **Step 2: Generate semantic actions**

Generate actions from oracle state, not just visible widgets:

```cpp
enum class SimActionKind {
    ToggleConfig,
    ToggleSection,
    AddSingle,
    AddBlock,
    DeleteRow,
    EditField,
    EditSystemMessageKind,
    EditSystemMessageArg,
    Scroll
};
```

Translate each action into the production `synth::ui::Action` only after the oracle has chosen it.

- [ ] **Step 3: Compare implementation to oracle after every step**

Add assertions:

```cpp
AssertSessionRowsEqual(surface.ViewModelForTest(), oracle);
AssertPersistedEqual(fixture.state.instrument, oracle.persisted);
AssertRenderedTreeMatchesOracle(surface.BuildTree(), oracle);
AssertScrollReachable(surface.BuildTree(), renderer);
```

If no public test hook exists for the view model, expose a JUCE-free `DebugSectionRowsForTest` under a test-only helper or compare through `SectionRows`.

- [ ] **Step 4: Preserve seed controls**

Keep existing environment behavior documented in `projects/synth/README.md`:

```text
SYNTH_RANDOM_SEEDS=0x51A7,0xC0FFEE SYNTH_RANDOM_STEPS=5000 make synth-test
```

On failure, print:

```text
seed=0x5EAF2026 step=137 action=EditSystemMessageArg controller=generic section=SystemMessages row=4
```

- [ ] **Step 5: Promote known regressions to fixed seeds**

Add fixed default seeds that cover:

- large expanded section scrolling,
- add single then add block in same group,
- delete block then reopen,
- edit system message kind and argument,
- invalid duplicate-address refusal.

- [ ] **Step 6: Run simulation**

Run:

```bash
make -C projects/synth/apps/miniapp test
SYNTH_RANDOM_SEEDS=0x5EAF2026 SYNTH_RANDOM_STEPS=1000 make -C projects/synth/apps/miniapp test
```

Expected: JUCE simulation passes and prints no invariant failures.

- [ ] **Step 7: Commit simulation**

```bash
git add projects/synth/juce/ControllersPageSimulationTests.cpp projects/synth/README.md
git commit -m "test(synth): model controller configuration simulation"
```

---

### Task 9: Harness Visual Feedback and Layout Refinement

**Files:**
- Modify: `projects/synth/juce/ControllersPageHarness.hpp`
- Modify: `projects/synth/juce/ControllersPageHarnessApp.cpp`
- Modify: `projects/synth/apps/controllers_harness/README.md`
- Modify: `projects/synth/include/synth/ControllersPageUI.hpp`

- [ ] **Step 1: Add all-kind large fixtures**

Ensure the harness fixture includes WRLD.Bldr, Launchpad, MF Twister, and Generic controllers with enough rows to require scrolling.

- [ ] **Step 2: Build and run harness**

Run:

```bash
make -C projects/synth/apps/controllers_harness
open projects/synth/apps/controllers_harness/build/ControllersHarness.app
```

Expected: harness opens the production Controllers page.

- [ ] **Step 3: Inspect flows manually**

Exercise:

- expand/collapse every kind,
- scroll to bottom,
- add singleton and block,
- edit message kind and argument,
- delete singleton and block,
- close/reopen to see coalescing.

- [ ] **Step 4: Refine layout only through portable UI**

Make targeted layout improvements in `ControllersPageUI.hpp`: clearer group spacing, field labels, and stable dimensions. Do not move behavior into JUCE-specific code.

- [ ] **Step 5: Re-run tests**

Run:

```bash
make -C projects/synth test
make -C projects/synth/apps/miniapp test
make -C projects/synth/apps/controllers_harness
```

Expected: all pass/build.

- [ ] **Step 6: Commit harness/layout refinements**

```bash
git add projects/synth/include/synth/ControllersPageUI.hpp projects/synth/juce/ControllersPageHarness.hpp projects/synth/juce/ControllersPageHarnessApp.cpp projects/synth/apps/controllers_harness/README.md
git commit -m "chore(synth): refine controller harness coverage"
```

---

### Task 10: Cleanup, OpenSpec Sync, and Final Verification

**Files:**
- Modify: `openspec/changes/rework-controllers-block-editing/tasks.md`
- Possibly modify: docs/comments touched by obsolete behavior

- [ ] **Step 1: Remove obsolete comments and helpers**

Search:

```bash
rg -n "re-resolve|re-resolving|identity re|PresentationRow|SectionPresentation|optimistic|re-partition|re-group" projects/synth/include/synth/MidiConfigViewModel.hpp projects/synth/src/MidiConfigViewModel.cpp
```

Remove comments/helpers that describe the old rebuild/re-resolve behavior, keeping only session semantics.

- [ ] **Step 2: Full verification**

Run:

```bash
make -C projects/synth test
make -C projects/synth/apps/miniapp test
make -C projects/synth/apps/controllers_harness
openspec validate rework-controllers-block-editing --type change --strict
```

Expected: all commands pass.

- [ ] **Step 3: Update OpenSpec task checkboxes**

After code review and verification, mark completed items in:

```text
openspec/changes/rework-controllers-block-editing/tasks.md
```

Only check an item after its implementation, tests, and review have passed.

- [ ] **Step 4: Commit final docs**

```bash
git add openspec/changes/rework-controllers-block-editing/tasks.md docs/superpowers/plans/2026-07-05-rework-controllers-block-editing.md
git commit -m "docs(synth): plan controller edit-session rework"
```

---

## Review Checkpoints

- After Tasks 1-3: review session architecture against OpenSpec `sru-11`.
- After Tasks 4-6: review system-message behavior against `sru-15` and `sru-16`.
- After Task 7: review scroll behavior against `sru-5`.
- After Task 8: review simulation coverage against `sru-14`.
- Before final: run verification commands and inspect harness visually.

## Spec Coverage Self-Review

- `sru-5` scrollability: covered by Tasks 1, 7, 8, and 9.
- `sru-11` edit-session stability: covered by Tasks 1-4 and 8.
- `sru-14` model-based verification: covered by Task 8.
- `sru-15` message kind/argument split: covered by Task 5.
- `sru-16` shared system-message pipeline: covered by Task 6.

## Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-07-05-rework-controllers-block-editing.md`.

1. Subagent-Driven (recommended): dispatch a fresh subagent per task, review between tasks, and keep OpenSpec checkboxes synchronized only after verification.
2. Inline Execution: execute tasks in this session using `superpowers:executing-plans`, with checkpoints between task groups.
