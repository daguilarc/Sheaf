# Generic Encoder Position Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ordinary Generic controller profiles send one debounced encoder-position CC on each turn mapping's same input channel and CC, with full absolute epoch synchronization and unchanged relative feedback.

**Architecture:** Add one position-only `GenericMidiOutProcessor` derived from the existing shared encoder-output base. Engine assembly explicitly supplies `MidiProfileKind`; the factory derives Generic output from `encoderInput.turns` only when no explicit specialized `encoderOutput` exists. The shared position decision accepts a final MIDI address so Generic can preserve the input channel while Twister and WRLD.Bldr remain on primary channel `0`.

**Tech Stack:** C++20, existing `MidiSender`, `AbsoluteFeedbackCoordinator`, `ParameterManager::UIState`, Make-based synth test binaries, OpenSpec.

## Global Constraints

- A derived Generic mapping emits exactly one position CC at the corresponding turn input's full `(channel, cc)` address and no color, brightness, animation, SysEx, or auxiliary traffic.
- Absolute mode reuses the existing guarded `A/E/B/P` gate, exact suppression, rejection correction, enqueue retry, capacity policy, and rebuild-persistent coordinator.
- `Signed7Bit` and `DirectionOnly` remain epoch-free and follow the post-modulation display position.
- An explicit Twister or WRLD.Bldr `encoderOutput` overrides derived Generic output.
- Direct callers omitting profile kind retain prior behavior; the kind argument defaults to `std::nullopt`, never Generic.
- No persisted profile-schema change and no edits to the user-owned `projects/synth/miniapp/` tree.

---

### Task 1: Add automatic same-address Generic encoder position feedback

**Files:**

- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/include/synth/Engine.hpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`
- Test: `projects/synth/tests/engine_tests.cpp`
- Test: `projects/synth/tests/rig_tests.cpp`
- Modify: `projects/synth/docs/coverage.md`

**Interfaces:**

- Consumes: `EncoderMidiInConfig::turns`, `MidiControlAddress`, `MidiOutProcessor::LoadCellSnapshot`, the guarded absolute position state machine, `MidiProfileKind::Generic`, engine controller-slot identity.
- Produces: `GenericMidiOutProcessor`; trailing factory argument `std::optional<MidiProfileKind> profileKind = std::nullopt`; one derived output processor for engine-built Generic input profiles without explicit output.

- [ ] **Step 1: Write focused factory and processor tests before production edits**

Add table-driven cases proving that engine-style construction with supplied kind Generic and no explicit output creates exactly one `GenericMidiOutProcessor`, while omitted kind, non-Generic kind, missing encoder input, and explicit specialized output do not create derived Generic output. Use turn mappings on nonzero, distinct addresses such as `(channel 7, CC 74)` and `(channel 12, CC 3)`.

Drive the processor against stable UI cells and assert the complete MIDI trace is exactly:

```cpp
REQUIRE_TRUE(messages.size() == 2);
REQUIRE_TRUE(messages[0].Channel() == 7 && messages[0].GetCC() == 74);
REQUIRE_TRUE(messages[1].Channel() == 12 && messages[1].GetCC() == 3);
REQUIRE_TRUE(std::all_of(messages.begin(), messages.end(),
    [](const BasicMidi& midi) { return midi.IsCC(); }));
```

Assert a second unchanged pass emits nothing. Assert explicit Twister output still emits only its established `0/1/2/5` protocol messages and no same-address Generic duplicate.

- [ ] **Step 2: Add absolute and relative behavior tests**

For Generic Absolute mode, use the real coordinator and controller slot to prove: pre-ack position gating; exact received-byte suppression after acknowledgement; modifier rejection correction at the same input address; correction enqueue failure retry without resolve/cache mutation; disconnected zero behavior; and untracked capacity fallback. For both relative modes, alter post-modulation `values[0]` without altering `rawKnobValue` and prove output follows the display value on the same address without reserving or waiting on an epoch.

- [ ] **Step 3: Add engine/rig integration tests**

Install a Generic controller with only `encoderInput` and an output endpoint. Through the real callback → MIDI bus → audio block → coherent UI publication → message-thread tick path, prove:

```text
input byte B on (C,N)
→ no stale feedback before processed epoch E
→ no echo when acknowledged center quantizes to B
→ one correction CC(C,N,V) when the edit is rejected
```

Establish a pending input, call `RebuildMidiProcessors()`, and prove the rebuilt automatically derived Generic output remains gated then resolves through the same coordinator record. Include two distinct input addresses and assert no non-position traffic.

- [ ] **Step 4: Run RED**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests build/engine_tests build/rig_tests && \
projects/synth/build/parameter_modulation_tests && \
projects/synth/build/engine_tests && \
projects/synth/build/rig_tests
```

Expected: compile failure for missing `GenericMidiOutProcessor` and/or missing factory profile-kind argument before production edits.

- [ ] **Step 5: Parameterize the shared position enqueue address**

Change the protected position helper to receive the final address explicitly:

```cpp
void ProcessPosition(std::size_t mappingIx,
                     const EncoderMidiOutMapping& mapping,
                     MidiControlAddress outputAddress,
                     const CellSnapshot& snapshot,
                     bool blank,
                     bool& cacheValid,
                     std::uint8_t& cachedValue);
```

Use `outputAddress.channel` and `outputAddress.cc` in every exact/correction/ordinary enqueue branch. Twister and WRLD.Bldr call it with `{0, mapping.cc}` so their existing traffic is byte-for-byte unchanged.

- [ ] **Step 6: Implement the minimal Generic processor**

Add a final class with only position state:

```cpp
class GenericMidiOutProcessor final : public MidiOutProcessor {
public:
    GenericMidiOutProcessor(const EncoderMidiInConfig& input,
                            MidiSender* sender,
                            ParameterManager::UIState* uiState,
                            std::size_t sinkIx = 0,
                            AbsoluteFeedbackCoordinator* absoluteFeedback = nullptr,
                            std::size_t controllerSlot = 0);
    void Reset() override;
    void Process() override;

private:
    struct CacheEntry { bool valid = false; std::uint8_t value = 0; };
    std::vector<MidiControlAddress> outputAddresses_;
    std::vector<CacheEntry> cache_;
};
```

Project `input.turns` into the base `EncoderMidiOutConfig` using only `(slotIx, position, cc)` for snapshot/route identity, retain each full `control` address in the same order, and on `Process()` call the shared position helper once per stable snapshot. Do not add appearance fields or sends.

- [ ] **Step 7: Thread explicit profile kind and construct derived output**

Extend the factory trailing arguments source-compatibly:

```cpp
MidiControllerProfileResult CreateMidiControllerProfile(
    const MidiControllerProfileConfig& config,
    MessageInBus* bus,
    MidiSender* sender,
    ParameterManager::UIState* uiState,
    MidiInProcessor::TimestampProvider timestampProvider = {},
    std::size_t sinkIx = 0,
    AbsoluteFeedbackCoordinator* absoluteFeedback = nullptr,
    std::size_t controllerSlot = 0,
    std::optional<MidiProfileKind> profileKind = std::nullopt);
```

Keep explicit `encoderOutput` construction first. Otherwise, when `profileKind == MidiProfileKind::Generic && config.encoderInput.has_value()`, create one Generic processor with the same `feedbackMode`, active coordinator, sink index, and controller slot as the input. Update `Engine::RebuildMidiProcessors()` to pass `controllers[ix].kind`; do not change bus producer or sender sink ownership.

- [ ] **Step 8: Run focused GREEN twice**

Run twice:

```bash
make -C projects/synth build/parameter_modulation_tests build/engine_tests build/rig_tests && \
projects/synth/build/parameter_modulation_tests && \
projects/synth/build/engine_tests && \
projects/synth/build/rig_tests
```

Expected: exit `0` both times with all prior Twister/WRLD.Bldr and new Generic cases passing.

- [ ] **Step 9: Update coverage and run complete verification**

Map `spm-78` and the new `sar-7` scenario to the exact new test names in `projects/synth/docs/coverage.md`. Then run:

```bash
make -C projects/synth check-ui-boundary
make -C projects/synth test
openspec validate synchronize-absolute-encoder-feedback --strict
git diff --check
```

Scan changed production/tests/docs for `TBD|TODO|FIXME|HACK|placeholder`, confirm all existing specialized-output tests still pass, and verify `git diff --name-only -- projects/synth/miniapp/` is empty.

- [ ] **Step 10: Commit**

Stage only the scoped production, test, and coverage files and commit:

```bash
git commit -m "feat(synth): add generic encoder position feedback"
```

Do not mark OpenSpec 5.1 complete until the exact implementation diff passes both spec-compliance and code-quality review.
