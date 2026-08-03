# Synth Audio Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every synth application request any host-supported number of planar audio inputs and consume zero-copy block/frame views on JUCE, `SynthRig`, and the browser native Wasm AudioWorklet path, with explicit configuration, permission, shortfall, retry, and no-monitoring behavior.

**Architecture:** `AudioBlock` keeps its public pointer/count/output contract and gains additive non-owning `AudioInputView`/frame helpers plus a requested-input count. Hosts validate configuration once, publish actual counts clamped to the application request, and preserve missing/null channels as explicit safe silence. JUCE forwards callback-owned buffers; the browser registers a capture or deterministic test source with a physical-channel count and connects it to the existing native callback-only AudioWorklet; `SynthRig` reuses its preallocated planar storage and adds transactional injection helpers.

**Tech Stack:** C++20, JUCE, Emscripten WebAudio Wasm AudioWorklets, TypeScript/ES modules, Web Media Capture, Node test runner, Playwright Chromium, Make, OpenSpec.

## Global Constraints

- Source of truth: every artifact under `openspec/changes/add-synth-audio-input/`; implement every requirement and task without weakening requested-versus-active or no-monitoring behavior.
- First reconcile, sync, and archive `add-browser-wasm-runtime`; no source task after Task 1 starts until `synth-browser-wasm-runtime` exists in main specs.
- `RuntimeConfig::numAudioInputs` accepts every nonnegative `int` on JUCE; browser input is bounded by `kMaxBrowserInputChannels == 32`; negative values fail before engine/device/capture startup.
- Keep application and core DSP code JUCE-, DOM-, Web Audio-, and JavaScript-free.
- Input views are non-owning, trivially copyable, callback-lifetime-only, and allocation/copy-free on valid realtime access.
- A host exposes at most the requested prefix. Missing, null, denied, or ended input reads as silence through the explicitly safe accessor while actual count/status remains observable.
- Hosts never connect input directly to output or monitor it; only application DSP may route input to output.
- Browser apps requesting zero inputs create zero input buses and never call `getUserMedia()`.
- Browser capture uses System Default with `channelCount: { ideal: N }`, `echoCancellation: false`, `noiseSuppression: false`, and `autoGainControl: false`.
- Browser input/output selection persists the existing empty device name; named browser devices and output sink selection remain out of scope.
- Browser control/media/DOM work stays outside `ProcessAudioWorklet`; the callback performs bounded pointer adaptation, atomic state reads, engine processing, metering, and failure silencing only.
- Mini App and Braid 4 remain zero-input applications.
- All changes are test-first. An OpenSpec checkbox is marked only after its mapped task passes focused tests, specification review, code-quality review, and any same-session fix/re-review loop.
- Do not silently substitute models or harnesses. Claude models run only through `claude_code`; GPT models run only through `codex`; Grok runs through `cursor`.

---

### Task 1: Reconcile and archive the browser runtime base

**OpenSpec mapping:** 1.1. **Class:** complex/spec migration. **Implementer:** Codex harness, `gpt-5.5`, xhigh. **Reviewer:** Claude Code harness, `opus`, high.

**Files:**

- Modify: `openspec/changes/add-browser-wasm-runtime/design.md`
- Modify: `openspec/changes/add-browser-wasm-runtime/tasks.md`
- Modify: `openspec/changes/add-browser-wasm-runtime/specs/synth-app-runtime/spec.md`
- Modify: `openspec/changes/add-browser-wasm-runtime/specs/synth-browser-wasm-runtime/spec.md`
- Modify: `openspec/changes/add-browser-wasm-runtime/specs/synth-runtime-ui/spec.md`
- Modify/Create by intelligent sync: `openspec/specs/synth-app-runtime/spec.md`
- Create by intelligent sync: `openspec/specs/synth-browser-wasm-runtime/spec.md`
- Modify by intelligent sync: `openspec/specs/synth-runtime-ui/spec.md`
- Move after sync: `openspec/changes/add-browser-wasm-runtime/` to `openspec/changes/archive/2026-08-02-add-browser-wasm-runtime/`
- Verify: `openspec/changes/add-synth-audio-input/specs/**/*.md`

**Interfaces:**

- Produces unique base IDs: browser change `sar-27..30`, `sru-56..58`, existing `sbw-1..9`.
- `sar-29` replaces worker-negotiated block language with `AudioContext` sample rate and actual render quantum.
- `sbw-4` describes the shipped native `ProcessAudioWorklet -> Runtime<App>::Process` callback and no JavaScript/worker sample ring.
- `sbw-8` keeps cross-origin isolation requirements only for Emscripten pthread/Wasm worker support, not a deleted SharedArrayBuffer audio bridge.
- The base `sar-30` remains output-only; this change alone later makes it input-aware.
- Main spec sync is idempotent and preserves all unrelated current requirements.

- [ ] **Step 1: Capture completion and collision evidence**

Run:

```bash
/Users/joyo/.local/share/sheaf/bin/openspec status --change add-browser-wasm-runtime --json
rg -n '^### Requirement: (sar|sru)-' openspec/specs/synth-app-runtime/spec.md openspec/specs/synth-runtime-ui/spec.md openspec/changes/add-browser-wasm-runtime/specs
```

Expected: artifacts complete, all old tasks checked, four `sar-22..25` and three `sru-21..23` collisions visible, and no existing archive target for today.

- [ ] **Step 2: Write a failing composition check before editing**

Add a temporary review assertion to the task report (not production source) that requires these searches to return no stale architecture after reconciliation:

```bash
! rg -n 'SharedArrayBuffer audio bridge|worker-negotiated engine render block size|input.*unsupported' \
  openspec/changes/add-browser-wasm-runtime/specs
```

Run it now. Expected: FAIL on the old browser delta.

- [ ] **Step 3: Renumber and restate the completed change**

Rename the complete requirement headings and any internal references:

```text
sar-22 -> sar-27    sru-21 -> sru-56
sar-23 -> sar-28    sru-22 -> sru-57
sar-24 -> sar-29    sru-23 -> sru-58
sar-25 -> sar-30
```

Restate the current callback-only implementation in `sar-29`, `sbw-4`, `sbw-8`, design, and completed task descriptions. Preserve output System Default behavior and empty persisted output name. Do not add microphone/input behavior to this base.

- [ ] **Step 4: Validate the corrected predecessor**

Run:

```bash
/Users/joyo/.local/share/sheaf/bin/openspec validate add-browser-wasm-runtime --strict --json
! rg -n 'SharedArrayBuffer audio bridge|worker-negotiated engine render block size|input.*unsupported' \
  openspec/changes/add-browser-wasm-runtime/specs
```

Expected: strict validation passes and the stale-architecture scan exits zero.

- [ ] **Step 5: Intelligently sync all three deltas to main specs**

Read every predecessor delta beside its main capability. Apply ADDED requirements once, merge any MODIFIED intent without deleting unrelated requirements/scenarios, and create `openspec/specs/synth-browser-wasm-runtime/spec.md` with a concrete Purpose copied from the completed proposal (no placeholder Purpose). Re-run ID scans and ensure each requirement ID is globally unique within its capability.

- [ ] **Step 6: Archive the completed predecessor**

Verify all artifacts/tasks are complete, the delta is synced, and `openspec/changes/archive/2026-08-02-add-browser-wasm-runtime` does not exist. Move the entire change directory, preserving `.openspec.yaml`, to that exact archive target. This execution is the plan-selected “sync then archive” outcome required by D0.

- [ ] **Step 7: Validate the new base and downstream delta**

Run:

```bash
/Users/joyo/.local/share/sheaf/bin/openspec validate --all --strict --json
/Users/joyo/.local/share/sheaf/bin/openspec validate add-synth-audio-input --strict --json
/Users/joyo/.local/share/sheaf/bin/openspec status --change add-synth-audio-input --json
```

Expected: all pass; the current change remains ready and its `sar-31`/`sar-32`, `sbw-10`/`sbw-11`, and MODIFIED requirements resolve against main specs.

- [ ] **Step 8: Commit and review**

```bash
git add openspec/specs openspec/changes/archive/2026-08-02-add-browser-wasm-runtime openspec/changes/add-synth-audio-input
git commit -m "spec(synth): establish browser runtime base"
```

Run persistent Opus specification review then code-quality/migration review. Fix through the same Codex session and re-review with the same Opus session. Mark OpenSpec 1.1 only after both gates pass.

### Task 2: Portable input views and shared validation

**OpenSpec mapping:** 1.2–1.5. **Class:** basic/core contract. **Implementer:** Cursor harness, `grok-4.5`, high. **Reviewer:** Claude Code harness, `opus`, high.

**Files:**

- Modify: `projects/synth/include/synth/AppContext.hpp`
- Create: `projects/synth/tests/audio_input_tests.cpp`
- Modify: `projects/synth/tests/contract_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify: `projects/synth/include/synth/Engine.hpp`
- Test: `projects/synth/tests/audio_input_tests.cpp`

**Interfaces:**

```cpp
void ValidateRuntimeConfig(const RuntimeConfig& config); // throws std::invalid_argument for negative input count

class AudioInputFrameView {
public:
    std::size_t RequestedChannelCount() const noexcept;
    std::size_t ActiveChannelCount() const noexcept;
    std::size_t FrameIndex() const noexcept;
    bool HasActiveChannel(std::size_t channel) const noexcept;
    float Sample(std::size_t channel) const noexcept; // assert precondition: active non-null channel
    float SampleOrSilence(std::size_t channel) const noexcept;
};

class AudioInputView {
public:
    std::size_t RequestedChannelCount() const noexcept;
    std::size_t ActiveChannelCount() const noexcept;
    std::size_t FrameCount() const noexcept;
    bool Empty() const noexcept;
    bool HasActiveChannel(std::size_t channel) const noexcept;
    std::span<const float> Channel(std::size_t channel) const noexcept; // assert active non-null
    AudioInputFrameView Frame(std::size_t frame) const noexcept;       // assert frame in range
    float SampleOrSilence(std::size_t channel, std::size_t frame) const noexcept;
};
```

`AudioBlock` adds trailing `int numRequestedInputChannels = 0;` and `AudioInputView InputView() const noexcept;`. Hosts set requested count explicitly; `InputView()` defensively clamps negative/overlarge actual counts to `[0, requested]`. Existing public fields and aggregate initialization remain source compatible.

- [ ] **Step 1: Add the failing focused target**

Create `audio_input_tests.cpp` with a tiny assertion harness and add `AUDIO_INPUT_TEST_BIN`, build rule, `audio_input_tests` phony target, and aggregate `test` dependency/run line to `projects/synth/Makefile`.

- [ ] **Step 2: Write failing validation and zero-input tests**

```cpp
synth::RuntimeConfig invalid;
invalid.numAudioInputs = -1;
RequireThrowsInvalidArgument([&] { synth::ValidateRuntimeConfig(invalid); });

synth::AudioBlock zero;
const auto view = zero.InputView();
Require(zero.inputs == nullptr && view.Empty());
Require(view.ActiveChannelCount() == 0 && view.RequestedChannelCount() == 0);
Require(view.SampleOrSilence(0, 0) == 0.0f);
```

Also require a 17-channel config to validate successfully and prove `std::is_trivially_copyable_v<AudioInputView>` and `AudioInputFrameView`.

- [ ] **Step 3: Run and observe failure**

```bash
make -C projects/synth audio_input_tests
```

Expected: compile failure because validation/views/target source API do not exist.

- [ ] **Step 4: Write failing planar/frame/null/clamp tests**

Use three distinct planar arrays. Require `Channel(1)[2] == Frame(2).Sample(1)`, missing requested channel silence, invalid-frame silence, a counted null pointer yielding `HasActiveChannel == false` and safe zero, and `numInputChannels > numRequestedInputChannels` clamping the exposed active count. Valid strict access must return the underlying pointer span without copying.

- [ ] **Step 5: Implement the minimal header-only views and validation**

Add `<algorithm>`, `<cassert>`, `<span>`, `<stdexcept>`, and `<type_traits>` as needed. Store only pointer/count/index values in views. `HasActiveChannel` checks range and non-null pointer. Strict methods use `assert(HasActiveChannel(...))`; safe methods branch and return `0.0f`. No vector/string/heap ownership is permitted in either view.

- [ ] **Step 6: Validate every engine block at the shared boundary**

Call `ValidateRuntimeConfig` before `Engine<App>::Initialize()` mutates state, and ensure block producers populate `numRequestedInputChannels` from immutable config. Do not introduce validation inside the realtime callback.

- [ ] **Step 7: Run focused, boundary, and source scans**

```bash
make -C projects/synth audio_input_tests contract_tests engine_tests
! rg -n '#include <juce|emscripten|AudioContext|getUserMedia' projects/synth/include/synth/AppContext.hpp projects/synth/tests/audio_input_tests.cpp
```

Expected: all tests pass; scan finds nothing. Record `sizeof` assertions that both views remain bounded by six pointer-sized words.

- [ ] **Step 8: Commit and review**

```bash
git add projects/synth/include/synth/AppContext.hpp projects/synth/include/synth/Engine.hpp projects/synth/tests/audio_input_tests.cpp projects/synth/tests/contract_tests.cpp projects/synth/Makefile
git commit -m "feat(synth): add portable audio input views"
```

Use persistent Opus spec review then code-quality review; reuse Grok for fixes. Mark OpenSpec 1.2–1.5 only after both reviews pass.

### Task 3: Deterministic SynthRig input injection

**OpenSpec mapping:** 2.1–2.3. **Class:** basic/test harness. **Implementer:** Cursor harness, `grok-4.5`, high. **Reviewer:** Claude Code harness, `opus`, high.

**Files:**

- Modify: `projects/synth/tests/support/SynthRig.hpp`
- Modify: `projects/synth/tests/rig_tests.cpp`
- Modify: `projects/synth/tests/audio_input_tests.cpp`
- Modify: `projects/synth/Makefile`

**Interfaces:**

```cpp
std::size_t NumInputChannels() const noexcept;
std::size_t InputBlockSize() const noexcept;
void ClearAudioInputs() noexcept;
bool SetInputSample(std::size_t channel, std::size_t frame, float value) noexcept;
bool SetInputChannel(std::size_t channel, std::span<const float> samples) noexcept;
bool SetInputFrame(std::size_t frame, std::span<const float> channels) noexcept;
bool SetInputBlock(std::span<const std::span<const float>> channels) noexcept;
```

Every `bool` method validates its complete shape before mutation and returns false with storage unchanged on failure. Existing `RunSamples` continues rounding up to whole blocks.

- [ ] **Step 1: Add an input-probe test application**

In `audio_input_tests.cpp`, define a JUCE-free `InputProbeApp` requesting four inputs. Its block function reads channel 0 through `Channel`, channel 1 through `Frame`, and channel 3 through `SampleOrSilence`, then writes only the explicit sum/difference to two output channels. Leave channel 2 unused to prove no monitoring.

- [ ] **Step 2: Write failing silence and injection tests**

Require a new rig to output the probe's zero result before injection. Then inject distinct channel arrays, single samples, and frames; run a block; and assert exact sample ordering/transformation on captured outputs.

- [ ] **Step 3: Write failing transactional-rejection tests**

Snapshot valid storage through probe output, attempt invalid channel/frame/short block/long block/NaN-shape operations, require each returns false, run again, and require no partial mutation. Require `RunSamples(1)` still captures one full configured block.

- [ ] **Step 4: Run and observe failure**

```bash
make -C projects/synth audio_input_tests
make -C projects/synth build/rig_tests && projects/synth/build/rig_tests
```

Expected: compile failures for missing injection APIs.

- [ ] **Step 5: Implement helpers over existing preallocated storage**

Reuse `inputBuffers_` and `inputPointers_`; do not add callback-time allocation. Validate all dimensions before `std::copy`. `ClearAudioInputs()` uses `std::fill`. In `RunOneBlockAt`, set `block.numRequestedInputChannels = numInputChannels_` and retain null `inputs` for zero-input rigs.

- [ ] **Step 6: Prove pump allocation and routing behavior**

Run the test with allocation instrumentation already used by repository tests where available; otherwise use source assertions that `RunOneBlockAt`, `RunBlocks`, `RunSamples`, and `RunSeconds` contain no `resize`, `assign`, or new container construction. Require nonzero unused input produces unchanged output until the probe explicitly reads it.

- [ ] **Step 7: Run focused regression tests**

```bash
make -C projects/synth audio_input_tests
make -C projects/synth build/rig_tests && projects/synth/build/rig_tests
make -C projects/synth engine_tests
```

Expected: all pass, including whole-block capture counts.

- [ ] **Step 8: Commit and review**

```bash
git add projects/synth/tests/support/SynthRig.hpp projects/synth/tests/rig_tests.cpp projects/synth/tests/audio_input_tests.cpp projects/synth/Makefile
git commit -m "test(synth): inject deterministic rig audio input"
```

Use persistent Opus spec and quality review; reuse Grok for fixes. Mark OpenSpec 2.1–2.3 after both gates pass.

### Task 4: JUCE input negotiation, diagnostics, and macOS permission metadata

**OpenSpec mapping:** 3.1–3.4. **Class:** complex/device lifecycle. **Implementer:** Claude Code harness, `opus`, high. **Reviewer:** Codex harness, `gpt-5.6-sol`, xhigh.

**Files:**

- Modify: `projects/synth/runtime/Runtime.hpp`
- Modify: `projects/synth/runtime/JuceRuntimeMainServices.hpp`
- Modify: `projects/synth/juce/RuntimePagesJuce.hpp`
- Modify: `projects/synth/juce/RuntimePagesJuceTests.cpp`
- Modify: `projects/synth/juce/RuntimeShellSessionTests.cpp`
- Modify: `projects/synth/apps/miniapp/Info.plist`
- Modify: `projects/synth/apps/sheaf-patch/Info.plist`
- Modify: `projects/synth/apps/controllers_harness/Info.plist`
- Modify: `projects/synth/runtime/juce_build.mk`
- Modify: `projects/synth/docs/runtime.md` or the existing JUCE runtime contract document selected by repository convention

**Interfaces:**

- `Runtime<App>::Start()` calls shared `ValidateRuntimeConfig` before sender/device startup.
- `audioDeviceIOCallbackWithContext` publishes `numRequestedInputChannels = App::Config().numAudioInputs` and `numInputChannels = clamp(numInputChannels, 0, requested)` without compacting null pointers.
- Audio status uses stable text `Input requested N / active M`; device/permission errors append their existing diagnostic and do not stop independent output.
- Input selector visibility remains `N > 0`; persisted native input selection and reprepare ordering remain unchanged.
- macOS bundles include a nonempty `NSMicrophoneUsageDescription`; sandboxed signing configuration includes `com.apple.security.device.audio-input` only where sandbox entitlement files are actually used.

- [ ] **Step 1: Write failing callback-shape and status tests**

Add fixture coverage for zero requested input, request 17, device callback count above request, count below request, and a null pointer within the counted prefix. Assert the block fields and `InputView()` behavior plus exact `Input requested N / active M` status.

- [ ] **Step 2: Write failing lifecycle/UI tests**

Require input selector hidden for `N == 0`, visible for `N > 0`, a missing persisted input device leaves output initialized, device changes stop/reprepare/restart before callbacks, and input/output device names round-trip independently.

- [ ] **Step 3: Run the JUCE-focused suite and observe failure**

Use the existing JUCE test commands from the Mini App runtime harness:

```bash
make -C projects/synth build
make -C projects/synth/apps/miniapp test
```

If the repository exposes narrower JUCE binaries, run those first and record their exact commands in the report. Expected: new shape/status/metadata assertions fail before implementation.

- [ ] **Step 4: Implement validation and callback clamping**

Validate before any device open. Build each `AudioBlock` with the request, clamped counted prefix, actual frames, and unchanged output pointers. Preserve null logical positions; do not allocate scratch zero buffers or compact channels.

- [ ] **Step 5: Publish requested/active diagnostics without stopping output**

Update status on about-to-start, device switch, missing input, and callback shape change using message-thread-safe existing status plumbing. Do not log per callback; coalesce/atomic-publish count changes and render text on the message thread.

- [ ] **Step 6: Add permission metadata**

Add:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Audio input is used only by synth applications that explicitly request it.</string>
```

to bundled app plists used by the shared runtime. Add the audio-input entitlement only to an existing sandbox entitlement template; do not invent sandboxing for unsigned local builds. Document zero-input no-open/no-prompt behavior and permission-denial silence/diagnostic behavior.

- [ ] **Step 7: Run focused and full JUCE regression checks**

```bash
make -C projects/synth audio_input_tests contract_tests engine_tests
make -C projects/synth/apps/miniapp test
rg -n 'NSMicrophoneUsageDescription' projects/synth/apps/*/Info.plist
```

Expected: tests pass; every shipped runtime plist is covered; Mini App and Braid 4 configs still request zero inputs.

- [ ] **Step 8: Commit and review**

```bash
git add projects/synth/runtime projects/synth/juce projects/synth/apps projects/synth/docs
git commit -m "feat(synth): negotiate JUCE audio input"
```

Use persistent Codex GPT-5.6 Sol spec and quality review; reuse Opus for fixes. Mark OpenSpec 3.1–3.4 only after both gates pass.

### Task 5: Browser ABI and native AudioWorklet input path

**OpenSpec mapping:** 4.1–4.6. **Class:** complex/realtime ABI. **Implementer:** Codex harness, `gpt-5.5`, xhigh. **Reviewer:** Claude Code harness, `opus`, xhigh.

**Files:**

- Modify: `projects/synth/include/synth/browser/BrowserRuntime.hpp`
- Modify: `projects/synth/browser/cpp/BrowserRuntimeAbi.cpp`
- Modify: `projects/synth/browser/src/worker.ts`
- Modify: `projects/synth/browser/src/build-browser-apps.mjs`
- Modify: `projects/synth/browser/src/package-contract.mjs`
- Modify: `projects/synth/tests/browser_runtime_contract_tests.cpp`
- Modify: `projects/synth/browser/tests/runtime-core.spec.ts`
- Modify: browser fake modules/scaffolds named by the ABI contract tests

**Interfaces:**

```cpp
static constexpr std::size_t kMaxBrowserInputChannels = 32;
enum class BrowserAudioInputStatus : std::uint32_t {
    NotRequested, Requesting, Online, PermissionDenied, ApiUnavailable,
    PrerequisiteBlocked, StreamEnded, ChannelCountUnreported
};
```

C ABI v3 adds:

```cpp
std::size_t synth_browser_audio_input_channels(synth_browser_runtime*);
int synth_browser_set_audio_input_source(synth_browser_runtime*, std::uint32_t sourceHandle,
                                         std::uint32_t physicalChannels,
                                         std::uint32_t statusCode);
int synth_browser_clear_audio_input_source(synth_browser_runtime*, std::uint32_t statusCode);
int synth_browser_consume_audio_input_retry(synth_browser_runtime*);
```

The module facade registers a JS `AudioNode` with module-local `emscriptenRegisterAudioObject`, passes its native handle plus positive physical count, and preserves the existing supplied `AudioContext` start path. C++ stores the physical count/status atomically; source handle setup/replacement happens outside the callback. `ProcessAudioWorklet` constructs fixed `std::array<const float*, 32>` input pointers and clamps active count to `min(input bus channels, published physical channels, requested)`.

- [ ] **Step 1: Write failing ABI-v3 discovery/limit tests**

Require `synth_browser_abi_version() == 3`, requested-input discovery for zero/4/32 channels, 33-channel startup rejection before worklet/capture, and fake module rejection when new exports are absent.

- [ ] **Step 2: Write failing native callback tests**

Factor callback adaptation into a JUCE-free testable helper that accepts `AudioSampleFrame`-equivalent planar descriptors. Test actual frame count, planar input/output together, null input, physical/bus/request clamping, stale count after clear, safe silence, and monotonic `startSample` advancement by output frames.

- [ ] **Step 3: Run and observe failure**

```bash
make -C projects/synth browser-unit-test
npm --prefix projects/synth/browser run build
npx --prefix projects/synth/browser playwright test tests/runtime-core.spec.ts
```

Expected: ABI/version/export and callback-input assertions fail.

- [ ] **Step 4: Implement ABI/status/source registration**

Add the exports to C++ headers, facade types, Emscripten export lists, scaffolds, fakes, and package validation. Reject a zero physical count for a nonzero source handle. A clear call sets active count to zero before disconnect/teardown becomes observable.

- [ ] **Step 5: Configure the native node shape**

For zero input: `numberOfInputs=0`. For `N>0`: `numberOfInputs=1`, `channelCount=N`, explicit mode, discrete interpretation, unchanged `numberOfOutputs=1` and `outputChannelCounts`. Connect a pending registered source after node creation; a later replacement connects to the existing node without recreating runtime/context/engine.

- [ ] **Step 6: Adapt the realtime callback**

Use only fixed arrays, atomic loads, pointer arithmetic, engine processing, metering, and output failure silencing. Set `AudioBlock.numRequestedInputChannels=N`. Never call registration, DOM/media, string/status formatting, allocation, or logging from the callback.

- [ ] **Step 7: Run focused ABI/realtime scans**

```bash
make -C projects/synth browser-unit-test browser-audio-device-test
npm --prefix projects/synth/browser run build
npx --prefix projects/synth/browser playwright test tests/runtime-core.spec.ts
! rg -n 'new |std::vector|std::string|getUserMedia|emscripten_run_script' \
  projects/synth/include/synth/browser/BrowserRuntime.hpp
```

Scope the realtime scan to the callback/helper body in the report so existing non-callback class ownership does not create false positives. Expected: all focused tests pass and callback body has no forbidden operation.

- [ ] **Step 8: Commit and review**

```bash
git add projects/synth/include/synth/browser projects/synth/browser/cpp projects/synth/browser/src projects/synth/tests/browser_runtime_contract_tests.cpp projects/synth/browser/tests
git commit -m "feat(synth-browser): carry native audio input"
```

Use persistent Opus spec and quality review; reuse Codex GPT-5.5 for fixes. Mark OpenSpec 4.1–4.6 only after both gates pass.

### Task 6: Browser capture, Audio page, retry, and lifecycle

**OpenSpec mapping:** 5.1–5.7. **Class:** complex/browser lifecycle and UI. **Implementer:** Claude Code harness, `opus`, xhigh. **Reviewer:** Codex harness, `gpt-5.6-sol`, xhigh.

**Files:**

- Modify: `projects/synth/browser/src/audio.ts`
- Modify: `projects/synth/browser/src/main.ts`
- Modify: `projects/synth/browser/src/worker.ts`
- Modify: `projects/synth/include/synth/browser/BrowserAudioDevices.hpp`
- Modify: `projects/synth/include/synth/browser/BrowserRuntimeMainServices.hpp`
- Modify: `projects/synth/include/synth/RuntimePages.hpp`
- Modify: `projects/synth/tests/browser_audio_device_tests.cpp`
- Modify: `projects/synth/tests/portable_ui_tests.cpp`
- Modify: `projects/synth/browser/tests/audio-flow.spec.ts`
- Modify: `projects/synth/browser/tests/activation-lease.spec.ts`
- Modify: `projects/synth/browser/src/publish-site.mjs`
- Modify: `projects/synth/browser/src/static-server.mjs`
- Modify: `projects/synth/browser/README.md`

**Interfaces:**

```ts
type RegisteredAudioInput = { node: AudioNode; nativeHandle: number; physicalChannels: number };

class AudioBridge {
  startFromUserActivation(): Promise<AudioBridgeStart>;
  retryInput(): Promise<void>;
  stop(): Promise<void>;
}
```

`AudioBridge` queries `audioInputChannels()` after module/runtime initialization. For `N>0` it calls `getUserMedia` with the pinned ideal/processing-disabled constraints, creates `createMediaStreamSource`, derives positive physical count from track settings or node count/one fallback, registers source/count/status, and installs `track.onended`. For zero it never touches `navigator.mediaDevices`.

Portable UI adds `Actions::kAudioInputRetry = "audio-input-retry"` and `AudioPageSnapshot::showInputRetry`. `BrowserRuntimeMainServices::DispatchAudio` sets a consumable retry flag; after UI action dispatch, the TypeScript runtime consumes it and calls `AudioBridge.retryInput()`.

Because this task appends named input-status codes beyond the ABI-v3 range established by Task 5, it bumps the browser ABI to v4 across the native export, launcher negotiation, fixtures, packages, scaffolds, tests, and documentation. Task 5's ABI-v3 assertions remain the historical RED/GREEN boundary for that earlier task; v4 is the composed change's final contract.

- [ ] **Step 1: Write failing zero/nonzero capture tests**

For zero input, replace `navigator.mediaDevices.getUserMedia` with a throwing spy and require zero calls. For `N=4`, require exactly:

```ts
{ audio: {
  channelCount: { ideal: 4 },
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
} }
```

and require discovery happens after module load on the activation-initiated launch path.

- [ ] **Step 2: Write failing status/catalog/UI tests**

Require zero input hides combo/status/retry. Nonzero exposes only `system_default`, persists empty input name, rejects other ids, and renders `requested 4 / active M` plus permission state. Permission denied, missing API, insecure/policy block, ended stream, unreported-count fallback, and shortfall each have distinct status; only offline states show Retry Input.

- [ ] **Step 3: Write failing teardown/retry tests**

Require failed startup, app replacement, repeated stop, pagehide, and normal stop disconnect sources and stop every track exactly once, clear native active count before disposal, and release context registration in existing order. Retry must reuse the exact context/runtime/engine handle and register a replacement source without a second app construction.

- [ ] **Step 4: Run and observe failures**

```bash
make -C projects/synth browser-audio-device-test
npm --prefix projects/synth/browser run build
npx --prefix projects/synth/browser playwright test tests/audio-flow.spec.ts tests/activation-lease.spec.ts
```

Expected: capture/status/retry methods and UI action are absent.

- [ ] **Step 5: Implement capture and source lifecycle**

Keep media work on the launcher/main realm. Register the node via the module-local handle path, publish physical count/status before native start, and connect only through the native worklet input bus. On end/failure, clear native input first, disconnect source, stop tracks, publish offline status, and leave output callback/context live.

- [ ] **Step 6: Implement catalog/status/retry UI**

Extend `BuildBrowserAudioSnapshot`, `BrowserInputDeviceName`, portable snapshot/layout/action dispatch, and runtime services. The existing status line carries permission plus exact `requested N / active M`; add a captioned `Retry Input` button only while offline. Selecting System Default commits `inputDeviceName = ""`; never enumerate or persist browser device IDs.

- [ ] **Step 7: Add hosting policy and privacy documentation**

Set both local and published headers to:

```text
Permissions-Policy: midi=(self), microphone=(self)
```

Document secure-context requirement, activation/retry-only prompting, realtime-only samples, no persistence/log/UI sample transport, channel shortfall/fallback status, no named device selection, and no monitoring.

- [ ] **Step 8: Run focused lifecycle/UI/security checks**

```bash
make -C projects/synth browser-audio-device-test
make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests
npm --prefix projects/synth/browser test
npx --prefix projects/synth/browser playwright test tests/audio-flow.spec.ts tests/activation-lease.spec.ts
rg -n 'microphone=\(self\)' projects/synth/browser/src/publish-site.mjs projects/synth/browser/src/static-server.mjs
```

Expected: all pass; output-only tests observe no prompt/source; retry reuses runtime.

- [ ] **Step 9: Commit and review**

```bash
git add projects/synth/browser projects/synth/include/synth projects/synth/tests projects/synth/docs
git commit -m "feat(synth-browser): manage input capture and retry"
```

Use persistent Codex GPT-5.6 Sol spec and quality review; reuse Opus for fixes. Mark OpenSpec 5.1–5.7 only after both gates pass.

### Task 7: Deterministic real-Wasm input coverage, documentation, and full verification

**OpenSpec mapping:** 6.1–6.4, 7.1–7.4. **Class:** complex/end-to-end verification. **Implementer:** Codex harness, `gpt-5.5`, xhigh. **Reviewer:** Claude Code harness, `opus`, xhigh. **Final whole-branch reviewer:** Claude Code harness, `opus`, xhigh (opposite the final implementer).

**Files:**

- Create: `projects/synth/browser/tests/audio-input.spec.ts`
- Create: `projects/synth/browser/tests/fixtures/cpp/AudioInputProbeApp.hpp`
- Modify: `projects/synth/browser/tests/fixtures/fake-browser-apps.json`
- Modify: `projects/synth/browser/tests/helpers/fake-app.ts`
- Modify: `projects/synth/browser/tests/first-party-apps-smoke.spec.ts`
- Modify: `projects/synth/browser/playwright.config.mjs`
- Modify: `projects/synth/browser/Makefile`
- Modify: `projects/synth/Makefile`
- Modify: `projects/synth/docs/coverage.md`
- Modify: `projects/synth/browser/README.md`
- Modify: app-author runtime documentation selected by current docs index
- Modify: `openspec/changes/add-synth-audio-input/tasks.md`

**Interfaces:**

- Test-only helper registers `{node, physicalChannels}` where `node` is a `ChannelMergerNode` fed by distinct deterministic constant/oscillator channels; production capture remains `getUserMedia`.
- Real-Wasm `AudioInputProbeApp` requests four inputs and writes a fixed documented transform, for example `out0 = in0 + 0.5*in2`, `out1 = in1 - in3`, with no implicit contribution from unused channels.
- Tests observe output through the same native callback/runtime instance used for UI/lifecycle, never through JavaScript DSP.

- [ ] **Step 1: Add the fixture app and failing deterministic-source test**

Build the probe through the generic fixture manifest. Register 1-, 2-, and 4-channel deterministic nodes with explicit physical counts. Require the portable Audio page to show matching active count and native output to match the exact transform within a documented floating tolerance.

- [ ] **Step 2: Add the failure matrix**

Use media-device fakes for grant/denial and ended tracks; use registered nodes/count metadata for deterministic greater-than-two-channel and shortfall. Assert safe silence for missing channels while output block count, UI frames, persistence operations, and MIDI bridge remain live.

- [ ] **Step 3: Strengthen zero-input first-party regressions**

For Mini App and Braid 4, spy on `getUserMedia`, `createMediaStreamSource`, and input-source ABI registration. Require zero calls, zero native input buses, existing non-silent output, advancing worklet block counts, finite deadline data, and unchanged configs.

- [ ] **Step 4: Run the focused real-Wasm suite**

```bash
make -C projects/synth/browser browser-fixture-app
npx --prefix projects/synth/browser playwright test tests/audio-input.spec.ts tests/first-party-apps-smoke.spec.ts
```

Expected: deterministic transforms, failure matrix, and both output-only apps pass without developer hardware.

- [ ] **Step 5: Update contract and coverage documentation**

Add exact C++ examples for `InputView().Channel`, `Frame`, and `SampleOrSilence`; callback lifetime; 32-channel browser limit versus JUCE representable integer request; requested/active diagnostics; permission/retry; System Default persistence; explicit routing/no monitoring; and a requirement-to-test matrix for `sar-31`, `sar-32`, `sbw-4`, `sbw-10`, `sbw-11`, `sar-6`, `sar-30`, and `sru-3`.

- [ ] **Step 6: Run all required verification**

```bash
make -C projects/synth test
make -C projects/synth/apps/miniapp test
make -C projects/synth/apps/sheaf-patch test
make -C projects/synth/browser test
make -C projects/synth/browser browser-apps
make -C projects/synth/browser browser-apps-smoke
/Users/joyo/.local/share/sheaf/bin/openspec validate --all --strict --json
```

Expected: all pass. Record exact command outputs and durations in the task report; do not claim unsupported hardware testing.

- [ ] **Step 7: Run forbidden-boundary and behavior scans**

```bash
! rg -n 'juce|emscripten|AudioContext|getUserMedia' projects/synth/apps projects/synth/include/synth/AppContext.hpp
! rg -n 'SharedArrayBuffer|sample.?ring|renderTimer|ScriptProcessor' projects/synth/browser/src
rg -n 'getUserMedia' projects/synth/browser/src
rg -n 'connect\(' projects/synth/browser/src/audio.ts projects/synth/include/synth/browser/BrowserRuntime.hpp
```

Manually classify the positive `getUserMedia` and `connect` hits: capture must be gated by `N>0`; source connects only to native input; only native output connects to destination. Confirm no captured samples enter persistence, logs, metadata, or UI command buffers.

- [ ] **Step 8: Complete OpenSpec checkboxes and commit**

After all mapped tests and task reviews pass, mark 6.1–6.4 and 7.1–7.4 checked. Confirm every checkbox in `tasks.md` is checked, then:

```bash
git add projects/synth openspec/changes/add-synth-audio-input docs/superpowers/plans/2026-08-02-add-synth-audio-input.md
git commit -m "test(synth): verify audio input end to end"
```

- [ ] **Step 9: Task review and final whole-branch review**

Run persistent Opus task specification review then quality review; reuse Codex GPT-5.5 for fixes/re-review. After Task 7 passes, create one whole-branch review package from the pre-Task-1 base commit to `HEAD` and dispatch a fresh Claude Code Opus whole-branch reviewer. Resolve every Critical/Important finding with the Task 7 implementer when in scope, re-run affected/full tests, and re-review until clean.

## Plan Self-Review

- Spec coverage: Task 1 covers the predecessor/archive dependency; Tasks 2–4 cover `sar-31`, `sar-32`, `sar-6`, JUCE, and macOS; Tasks 5–6 cover ABI/native input, capture, UI, lifecycle, persistence, policy, and retry; Task 7 covers `sbw-11`, first-party regressions, docs, full scans, and final review.
- Completeness scan: every code, error, test, and verification step contains concrete content.
- Type consistency: requested count is `int` in `RuntimeConfig`/`AudioBlock`; public view counts are `std::size_t`; browser C ABI handles/counts/status are `std::uint32_t`; TypeScript registered source carries the same positive count; callback clamps all three sources before converting to `int` for `AudioBlock`.
- Assignment consistency: basic Tasks 2–3 use Cursor/Grok 4.5 + Claude Code/Opus. Complex tasks alternate Codex GPT-5.5 + Opus review (1, 5, 7) and Opus + Codex GPT-5.6 Sol review (4, 6). All Claude work uses `claude_code`; all GPT work uses `codex`.
