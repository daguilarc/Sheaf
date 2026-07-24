# Relative Bank MessageIns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add slot-addressed next/previous parameter-bank messages with wrapped navigation, current-bank modifier actions, MIDI persistence, controller editing, and deterministic simulation coverage.

**Architecture:** `ParameterManager` owns one direction-based relative navigation operation because it already owns bank ordering, slot lookup, scene state, and effective modifiers. `MessageInBus` only dispatches the two new messages. MIDI JSON, sorting, output info, and the JUCE-free controller view model extend their existing exhaustive message switches without adding a new persistence field or block type.

**Tech Stack:** C++20, the synth library's custom test harness, Make, OpenSpec, native Codex Terra implementers, and xagent-backed Claude reviewers.

## Global Constraints

- `NextParamBank(timestamp, slotIx)` and `PrevParamBank(timestamp, slotIx)` carry `slotIx` and no bank-index argument.
- Unmodified navigation wraps across manager-owned bank indices `0..bankCount-1`.
- Reset, random, or random-mod applies the existing effective modifier to the addressed slot's current bank and never changes selection.
- Invalid slot, no banks, no selected bank, or a selected bank not owned by the manager is mutation-free.
- Serialized names are exactly `nextParamBank` and `prevParamBank`.
- Controller labels are exactly `Next Bank` and `Previous Bank`; their single `Arg` edits `slotIx`.
- Relative navigation remains an individual press action with no release and default-off output feedback.
- Existing `SelectParamBank` behavior and existing profile compatibility remain unchanged.
- Follow test-driven development: observe focused tests fail for the missing behavior before production implementation.

---

### Task 1: Relative Bank Runtime and Message-Bus Model

**OpenSpec mapping:** 1.1-1.3, 2.1-2.3, 4.1.

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

**Interfaces:**
- Produces: `enum class BankDirection { Next, Previous };`
- Produces: `bool ParameterManager::NavigateBankForSlot(std::size_t slotIx, BankDirection direction);`
- Produces: `MessageIn::NextParamBank(std::uint64_t timestamp, std::size_t slotIx)`
- Produces: `MessageIn::PrevParamBank(std::uint64_t timestamp, std::size_t slotIx)`
- Consumes: existing `GetCurrentModifier`, `Bank::ApplyModifierToTopLevel`, `BankSlot::SelectedBank`, and `BankSlot::SelectBank`.

- [ ] **Step 1: Add focused failing runtime tests**

Add named tests beside the existing modified-bank and message-bus tests. Cover factory payloads, ordinary movement, both wraps, one-bank stability, all three modifiers for both directions, effective-modifier precedence, invalid slot, zero banks, no selected bank, and a foreign selected bank.

The core assertions must exercise public messages:

```cpp
const synth::MessageIn next = synth::MessageIn::NextParamBank(17, 3);
REQUIRE_TRUE(next.type == synth::MessageIn::Type::NextParamBank);
REQUIRE_TRUE(next.timestamp == 17);
REQUIRE_TRUE(next.slotIx == 3);
REQUIRE_TRUE(next.bankIx == 0);

const synth::MessageIn previous = synth::MessageIn::PrevParamBank(19, 4);
REQUIRE_TRUE(previous.type == synth::MessageIn::Type::PrevParamBank);
REQUIRE_TRUE(previous.timestamp == 19);
REQUIRE_TRUE(previous.slotIx == 4);
REQUIRE_TRUE(previous.bankIx == 0);
```

Use `MessageInBus::Apply` for routing assertions and compare `slot.SelectedBank()` plus parameter/modulation state before and after invalid actions.

- [ ] **Step 2: Run focused tests and observe RED**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests
```

Expected: compilation fails because `NextParamBank`, `PrevParamBank`, and their enum cases do not exist.

- [ ] **Step 3: Add the message and manager contracts**

Append the new `MessageIn::Type` cases after existing cases so existing declaration-order sort values remain stable. Add the factories and manager direction API:

```cpp
enum class BankDirection {
    Next,
    Previous,
};

bool NavigateBankForSlot(std::size_t slotIx, BankDirection direction);

static MessageIn NextParamBank(std::uint64_t timestamp, std::size_t slotIx);
static MessageIn PrevParamBank(std::uint64_t timestamp, std::size_t slotIx);
```

Factories set only `timestamp`, `type`, and `slotIx`.

- [ ] **Step 4: Implement relative manager routing**

Implement the manager operation with explicit current-bank lookup and safe wrap:

```cpp
bool ParameterManager::NavigateBankForSlot(std::size_t slotIx, BankDirection direction) {
    BankSlot* slot = BankSlotAt(slotIx);
    if (slot == nullptr || banks_.empty() || slot->SelectedBank() == nullptr) {
        return false;
    }

    const auto current = std::find_if(
        banks_.begin(), banks_.end(),
        [selected = slot->SelectedBank()](const std::unique_ptr<Bank>& bank) {
            return bank.get() == selected;
        });
    if (current == banks_.end()) {
        return false;
    }

    const Modifier modifier = GetCurrentModifier();
    if (modifier != Modifier::None) {
        (*current)->ApplyModifierToTopLevel(modifier, scene_);
        return true;
    }

    const std::size_t currentIx = static_cast<std::size_t>(std::distance(banks_.begin(), current));
    const std::size_t nextIx = direction == BankDirection::Next
        ? (currentIx + 1 == banks_.size() ? 0 : currentIx + 1)
        : (currentIx == 0 ? banks_.size() - 1 : currentIx - 1);
    slot->SelectBank(banks_[nextIx].get());
    return true;
}
```

Route both new enum cases from `MessageInBus::Apply` to this operation.

- [ ] **Step 5: Extend the independent randomized message-bus oracle**

Add an oracle helper that never calls production routing:

```cpp
void SimNavigateBank(SimOracle& oracle, synth::BankDirection direction,
                     SimRandomSamples& randomSamples, std::mt19937& randomRng,
                     std::vector<std::string>* samples) {
    if (SimCurrentModifier(oracle) != synth::Modifier::None) {
        SimApplyModifierToBank(oracle, oracle.selectedBank, randomSamples, randomRng, samples);
        return;
    }
    const int bankCount = static_cast<int>(oracle.banks.size());
    oracle.selectedBank = direction == synth::BankDirection::Next
        ? (oracle.selectedBank + 1) % bankCount
        : (oracle.selectedBank == 0 ? bankCount - 1 : oracle.selectedBank - 1);
}
```

Add next and previous actions to `randomized_message_bus_ui_state_simulation`, preserving random sample accounting, seed reporting, and the existing independent state checks.

- [ ] **Step 6: Run GREEN and self-review**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
```

Expected: exit `0`, including the focused and randomized message-bus tests. Review the diff for accidental `SelectParamBank` changes and report exact commands/results.

- [ ] **Step 7: Commit the runtime task**

```bash
git add projects/synth/include/synth/ParameterModulation.hpp \
        projects/synth/src/ParameterModulation.cpp \
        projects/synth/tests/parameter_modulation_tests.cpp
git commit -m "feat(synth): add relative bank message routing"
```

### Task 2: MIDI Persistence and Controller Configuration

**OpenSpec mapping:** 1.4-1.5, 3.1-3.4, 4.2.

**Files:**
- Modify: `projects/synth/include/synth/MidiConfigBlocks.hpp`
- Modify: `projects/synth/include/synth/MidiConfigViewModel.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/src/MidiConfigBlocks.cpp`
- Modify: `projects/synth/src/MidiConfigViewModel.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
- Modify: `projects/synth/tests/blocks_tests.cpp`
- Modify: `projects/synth/tests/viewmodel_tests.cpp`

**Interfaces:**
- Consumes: Task 1's `MessageIn::Type::NextParamBank`, `MessageIn::Type::PrevParamBank`, and factories.
- Produces: JSON names `nextParamBank` and `prevParamBank`.
- Produces: `UISystemMessage::NextParamBank` and `UISystemMessage::PrevParamBank`.
- Preserves: declaration-order sort semantics, non-blockable reconstruction, no release, press-shaped feedback, and default-off `SystemMessageOutputInfo`.

- [ ] **Step 1: Add focused failing integration tests**

Add tests that construct both messages for different slots, round-trip them through `ToJSON`/`FromJSON`, and assert the exact JSON type strings and `slotIx`. Extend system-output tests with:

```cpp
const auto nextState = info.Evaluate(synth::MessageIn::NextParamBank(0, 2));
REQUIRE_TRUE(nextState.color == synth::Color::Off);
REQUIRE_TRUE(!nextState.isOn);

const auto prevState = info.Evaluate(synth::MessageIn::PrevParamBank(0, 3));
REQUIRE_TRUE(prevState.color == synth::Color::Off);
REQUIRE_TRUE(!prevState.isOn);
```

In `blocks_tests.cpp`, assert sort keys include `slotIx`, relative messages stay individual, and exact duplicate/order round trips remain canonical. In `viewmodel_tests.cpp`, assert both labels appear, `MessageArg` edits `slotIx` in press and feedback, kind conversion preserves the primary argument, and releases remain absent.

- [ ] **Step 2: Run focused tests and observe RED**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests build/blocks_tests build/viewmodel_tests
```

Expected: compilation or assertions fail because serialization, sort keys, and UI enum/catalog cases are incomplete.

- [ ] **Step 3: Extend MIDI serialization, sorting, and output info**

Map the exact names in `MessageTypeName` and `ParseMessageType`. Include both cases in generic `MessageIn` JSON field handling. Extend `ComputeSystemMessageSortKey`:

```cpp
case MessageIn::Type::NextParamBank:
case MessageIn::Type::PrevParamBank:
    key.arg1 = message.slotIx;
    break;
```

Group both with stateless actions in `SystemMessageOutputInfo::Evaluate`, returning `{}`. Update declaration-order comments/counts without renumbering existing values.

- [ ] **Step 4: Extend the controller view model exhaustively**

Append `NextParamBank` and `PrevParamBank` to `UISystemMessage`. Update every relevant switch:

```cpp
case MessageIn::Type::NextParamBank:
case MessageIn::Type::PrevParamBank:
    return message.slotIx;
```

`SetPrimaryMessageArg` writes `slotIx`; `UISystemMessageHasArg` returns true; association conversion maps both directions; factories build from `arg`; release mapping returns `std::nullopt`; catalog labels are exactly `Next Bank` and `Previous Bank`; descriptions include direction and slot. Leave `BlockableMessage` unchanged so reconstruction treats them as individual rows.

- [ ] **Step 5: Extend the randomized controller oracle**

Add both message kinds to `TwisterSystemMessagesRandomizedOpenSessionOracle`'s supported choice set. Its oracle must model kind conversion, slot argument edits, persisted press/feedback equality, no release, rebuild, ordering, and delete without calling production conversion helpers.

- [ ] **Step 6: Run focused GREEN and the full synth suite**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests build/blocks_tests build/viewmodel_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/blocks_tests
projects/synth/build/viewmodel_tests
make -C projects/synth test
```

Expected: every command exits `0`. Audit all `MessageIn::Type` and `UISystemMessage` switches with `rg`, confirm absolute bank selection and legacy profile tests remain green, and report exact commands/results.

- [ ] **Step 7: Commit the controller integration task**

```bash
git add projects/synth/include/synth/MidiConfigBlocks.hpp \
        projects/synth/include/synth/MidiConfigViewModel.hpp \
        projects/synth/src/MidiController.cpp \
        projects/synth/src/MidiConfigBlocks.cpp \
        projects/synth/src/MidiConfigViewModel.cpp \
        projects/synth/tests/parameter_modulation_tests.cpp \
        projects/synth/tests/blocks_tests.cpp \
        projects/synth/tests/viewmodel_tests.cpp
git commit -m "feat(synth): expose relative bank controller actions"
```

## Completion Criteria

Both Terra tasks have passed Claude spec-compliance and code-quality review, all 17 OpenSpec task checkboxes are synchronized only after their covering task/review/verification is complete, `make -C projects/synth test` passes, strict OpenSpec validation passes, `git diff --check` is clean, and a fresh Claude Opus whole-change review has no unresolved Critical or Important findings.
