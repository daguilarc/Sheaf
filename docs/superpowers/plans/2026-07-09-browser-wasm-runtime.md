# Browser WASM Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome-targeted static website runtime that hosts any conforming `synth::SynthApplication` through WebAssembly, Web Audio, Web MIDI with sysex, browser persistence, and the existing portable UI surface.

**Architecture:** Add a sibling `synth_browser::Runtime<App>` over `synth::Engine<App>` and keep all browser APIs in `projects/synth/browser`. C++ owns the generic engine, command-buffer serialization, runtime ABI, MIDI reconciliation policy, and app entry binding; browser TypeScript owns static-site boot, DOM/canvas command-buffer consumption, Web Audio/AudioWorklet/Worker wiring, Web MIDI port objects, IDBFS sync calls, and Playwright shims.

**Tech Stack:** C++20, Emscripten/LLVM WebAssembly, TypeScript/ES modules, `AudioContext`, `AudioWorklet`, `AudioWorkletNode`, `SharedArrayBuffer`, Web MIDI `navigator.requestMIDIAccess({ sysex: true })`, IndexedDB/IDBFS, Playwright Chromium/Chrome, Make.

## Global Constraints

- Chrome is the primary browser target.
- The browser build is a static website: only static HTML, JavaScript, WebAssembly, worker, AudioWorklet, and asset files are produced.
- Normal browser operation must not require a server-side synth process, dynamic HTTP API, WebSocket service, native helper, or application-specific backend.
- Browser runtime and UI code must contain zero miniapp-specific or concrete-app-specific logic.
- Browser entry points may name only the concrete application type; every other browser runtime/backend path must be generic over `synth::SynthApplication`.
- The build must fail or the implementation must stop if a concrete app cannot run without app-specific browser runtime/backend code.
- Browser audio uses a Worker-owned WASM runtime and an AudioWorklet connected through preallocated `SharedArrayBuffer` ring buffers.
- `AudioWorkletProcessor.process()` array length is used only for ring-buffer copy/fill; `Engine<App>::ProcessBlock` uses the worker-negotiated engine render block size.
- Cross-origin isolation is mandatory for the browser audio bridge.
- The browser Audio page exposes exactly one output option labeled `System Default`, option id `system_default`, persisted as the existing empty output-device name.
- Browser audio input is skipped: `showInputCombo == false`, `inputOptions` is empty, and browser code does not call `getUserMedia()`.
- Web MIDI access must request sysex with `navigator.requestMIDIAccess({ sysex: true })`.
- Web MIDI must support multiple devices, one handler/sink binding per controller slot, polling plus reconnect/offline behavior, inbound bytes including sysex, and outbound bytes including sysex.
- Browser MIDI reconciliation must reuse the JUCE-free reconcile core where the C++/WASM boundary permits; if reuse is impossible, stop and report the boundary gap.
- Browser pointer-drag dispatch must preserve the JUCE backend value convention: replace the suffix after the final colon with the current delta, or use the delta as the whole value when there is no colon prefix.
- Playwright must verify app open, audio flow, bidirectional MIDI flow including sysex, and mouse gestures. Audio input is skipped.
- Tests must prove the generic fake app runs before any miniapp smoke target.

---

## File Structure

- Create `projects/synth/browser/Makefile`: Emscripten/browser build targets, static artifact packaging, Playwright entry points.
- Create `projects/synth/browser/package.json`, `tsconfig.json`, `playwright.config.mjs`: browser TypeScript/test tooling scoped to synth browser assets, following the repo's direct Playwright launch style from `projects/sheaf-chat/tests/integration/browserChat.integration.test.ts` where useful.
- Create `projects/synth/browser/public/index.html`: generic static app shell with no concrete app controls.
- Create `projects/synth/browser/src/main.ts`: main-thread bootstrap, permission/user-activation flow, worker/audio/MIDI/UI/persistence orchestration.
- Create `projects/synth/browser/src/worker.ts`: Emscripten module owner, runtime ABI wrapper, UI-frame loop, MIDI/audio/status message protocol.
- Create `projects/synth/browser/src/audio-worklet.ts`: `AudioWorkletProcessor` with SAB ring-buffer copy/fill and no DOM/Web MIDI/IDBFS calls.
- Create `projects/synth/browser/src/audio.ts`: `AudioContext`/AudioWorklet startup and cross-origin-isolation gate.
- Create `projects/synth/browser/src/midi.ts`: Web MIDI sysex permission, port catalog, polling/reconnect, injectable test ports, bidirectional byte routing.
- Create `projects/synth/browser/src/ui.ts`: command-buffer decode, semantic DOM diff, Canvas2D draw batching, event dispatch, scroll handling.
- Create `projects/synth/browser/src/persistence.ts`: IDBFS sync coordination and status messages.
- Create `projects/synth/browser/src/static-server.mjs`: static file server with traversal protection, COOP/COEP, MIDI permissions-policy headers, and explicit `.wasm` MIME type `application/wasm`.
- Create `projects/synth/browser/src/protocol.ts`: typed main/worker/worklet message schema.
- Create `projects/synth/browser/tests/*.spec.ts`: Playwright tests for fake app, command-buffer backend, audio, MIDI, persistence, static-only network checks, and miniapp smoke.
- Create `projects/synth/browser/tests/fixtures/*`: deterministic Web MIDI and audio probes used by Playwright.
- Create `projects/synth/include/synth/browser/BrowserCommandBuffer.hpp`: JUCE-free binary UI command-buffer record format and writer/reader helpers.
- Create `projects/synth/include/synth/browser/BrowserRuntime.hpp`: `synth_browser::Runtime<App>` generic host over `synth::Engine<App>`.
- Create `projects/synth/include/synth/browser/BrowserAudioDevices.hpp`: default-only audio catalog snapshot helpers.
- Create `projects/synth/include/synth/browser/BrowserMidiBridge.hpp`: C++ side of controller-slot MIDI routing and reconcile-core binding.
- Create `projects/synth/include/synth/browser/BrowserPersistence.hpp`: browser runtime data paths and persistence status model.
- Create `projects/synth/browser/cpp/BrowserRuntimeAbi.cpp`: Emscripten-exported C ABI for runtime creation, prepare/process, UI frame production, action dispatch, MIDI, patch/config, and diagnostics.
- Create `projects/synth/browser/cpp/FakeBrowserApp.hpp`: fake conforming app used only for generic browser host/backend tests.
- Create `projects/synth/browser/cpp/fake_app_entry.cpp`: generic browser entry binding naming only `FakeBrowserApp`.
- Create `projects/synth/browser/cpp/miniapp_entry.cpp`: generic browser entry binding naming only `synth_miniapp::MiniApp`.
- Create `projects/synth/tests/browser_command_buffer_tests.cpp`: JUCE-free serializer/decoder tests.
- Create `projects/synth/tests/browser_runtime_contract_tests.cpp`: compile/runtime contract tests for valid and invalid app shapes.
- Create `projects/synth/tests/browser_audio_device_tests.cpp`: `System Default` output and skipped-input snapshot tests.
- Create `projects/synth/tests/browser_midi_bridge_tests.cpp`: reconcile-core and bidirectional controller-slot routing tests.
- Modify `projects/synth/Makefile`: add browser C++ unit test binaries, browser package target hooks, and optional Emscripten target delegation.
- Modify root `Makefile`: add `synth-browser-build`, `synth-browser-test`, and keep existing `synth-test` behavior.
- Modify `openspec/changes/add-browser-wasm-runtime/tasks.md`: check off items only after implementation, review, and verification.

---

### Task 1: Browser Build, Fake App, And Portability Gates

**Files:**
- Create: `projects/synth/browser/Makefile`
- Create: `projects/synth/browser/package.json`
- Create: `projects/synth/browser/tsconfig.json`
- Create: `projects/synth/browser/playwright.config.mjs`
- Create: `projects/synth/browser/public/index.html`
- Create: `projects/synth/browser/cpp/FakeBrowserApp.hpp`
- Create: `projects/synth/browser/cpp/fake_app_entry.cpp`
- Create: `projects/synth/browser/cpp/miniapp_entry.cpp`
- Create: `projects/synth/include/synth/browser/BrowserAppEntry.hpp`
- Create: `projects/synth/tests/browser_runtime_contract_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify: `Makefile`

**Interfaces:**
- Consumes: `synth::SynthApplication`, `synth::Engine<App>`, `synth::RuntimeConfig`, `synth::AudioBlock`, `synth::ui::Surface`.
- Produces: `SYNTH_BROWSER_APP(AppType)` entry macro, `browser-fake-app` static build target, `browser-miniapp` static build target, contract test binary `browser_runtime_contract_tests`.

- [ ] **Step 1: Write failing contract tests**

Add `projects/synth/tests/browser_runtime_contract_tests.cpp` with a valid fake app and invalid app shapes:

```cpp
#include "synth/AppConcepts.hpp"
#include "synth/AppContext.hpp"
#include "synth/Engine.hpp"
#include "synth/PortableUI.hpp"
#include "synth/browser/BrowserAppEntry.hpp"

#include <type_traits>

namespace {
class EmptySurface final : public synth::ui::Surface {
public:
    synth::ui::NodeTree BuildTree() override { return {}; }
    void SetActionHandler(ActionHandler handler) override { handler_ = std::move(handler); }
    void DispatchAction(const synth::ui::Action& action) override { if (handler_) handler_(action); }
private:
    ActionHandler handler_;
};

class ValidApp {
public:
    static synth::RuntimeConfig Config() { return synth::RuntimeConfig{.appName = "FakeBrowserApp"}; }
    void Init(synth::AppContext*) {}
    void ProcessBlock(synth::AudioBlock&) {}
    synth::ui::Surface& PortableSurface() { return surface_; }
private:
    EmptySurface surface_;
};

class MissingSurface {
public:
    static synth::RuntimeConfig Config() { return {}; }
    void Init(synth::AppContext*) {}
    void ProcessBlock(synth::AudioBlock&) {}
};
}

int main()
{
    static_assert(synth::SynthApplication<ValidApp>);
    static_assert(synth_browser::BrowserApplication<ValidApp>);
    static_assert(!synth_browser::BrowserApplication<MissingSurface>);
    static_assert(!synth::SynthApplication<MissingSurface>);
    return 0;
}
```

- [ ] **Step 2: Run the contract test and confirm it fails for missing browser headers**

Run: `make -C projects/synth build/browser_runtime_contract_tests`

Expected: fails because `synth/browser/BrowserAppEntry.hpp` and the make target do not exist.

- [ ] **Step 3: Implement the generic browser app entry boundary**

Add `projects/synth/include/synth/browser/BrowserAppEntry.hpp`:

```cpp
#pragma once

#include "synth/AppConcepts.hpp"

namespace synth_browser {

template <typename App>
concept BrowserApplication = synth::SynthApplication<App>;

template <BrowserApplication App>
struct BrowserAppBinding {
    using AppType = App;
};

}  // namespace synth_browser

#define SYNTH_BROWSER_APP(AppType) \
    extern "C" void* synth_browser_app_type_anchor() { \
        static_assert(::synth_browser::BrowserApplication<AppType>); \
        return nullptr; \
    }
```

- [ ] **Step 4: Add a generic fake app and generic entry files**

Add `projects/synth/browser/cpp/FakeBrowserApp.hpp` with an app that satisfies `SynthApplication`, produces a portable `NodeTree` with one button, one slider, one draw node, and writes a finite non-silent sine sample in `ProcessBlock`.

Add `fake_app_entry.cpp`:

```cpp
#include "FakeBrowserApp.hpp"
#include "synth/browser/BrowserAppEntry.hpp"

SYNTH_BROWSER_APP(synth_browser::test::FakeBrowserApp)
```

Add `miniapp_entry.cpp`:

```cpp
#include "MiniApp.hpp"
#include "synth/browser/BrowserAppEntry.hpp"

SYNTH_BROWSER_APP(synth_miniapp::MiniApp)
```

Do not add any miniapp-specific HTML, JavaScript, or browser backend code.

- [ ] **Step 5: Add browser package scaffolding**

Add `projects/synth/browser/package.json` with `type: "module"` and scripts:

```json
{
  "name": "sheaf-synth-browser",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "npm run build && playwright test",
    "test:unit": "npm run build && node --test dist/tests/*.test.mjs"
  },
  "devDependencies": {
    "@playwright/test": "^1.60.0",
    "typescript": "^5.8.3"
  }
}
```

Add `tsconfig.json` targeting ES2022 modules with `rootDir: "."` and `outDir: "dist"`.

Add `public/index.html` with a generic root element only:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Sheaf Synth</title></head>
  <body><main id="synth-root"></main><script type="module" src="../dist/src/main.js"></script></body>
</html>
```

- [ ] **Step 6: Add Make targets**

Modify `projects/synth/Makefile` with `BROWSER_CONTRACT_TEST_BIN := $(BUILD_DIR)/browser_runtime_contract_tests`, build rule, and `browser-unit-test` target. Add a `browser` target that delegates to `$(MAKE) -C browser build`.

Modify root `Makefile` with:

```make
.PHONY: synth-browser-build synth-browser-test
synth-browser-build:
	$(MAKE) -C projects/synth browser
synth-browser-test:
	$(MAKE) -C projects/synth browser-unit-test
	$(MAKE) -C projects/synth/browser test
```

- [ ] **Step 7: Verify and commit**

Run: `make -C projects/synth browser-unit-test`

Expected: contract test passes.

Run: `make -C projects/synth/browser build`

Expected: TypeScript build passes.

Commit: `git add projects/synth/browser projects/synth/include/synth/browser projects/synth/tests/browser_runtime_contract_tests.cpp projects/synth/Makefile Makefile && git commit -m "feat(synth): scaffold generic browser wasm target"`

---

### Task 2: JUCE-Free Browser Command Buffer Serialization

**Files:**
- Create: `projects/synth/include/synth/browser/BrowserCommandBuffer.hpp`
- Create: `projects/synth/tests/browser_command_buffer_tests.cpp`
- Modify: `projects/synth/Makefile`

**Interfaces:**
- Consumes: `synth::ui::NodeTree`, `Node`, `DrawCommand`, `Action`.
- Produces: `synth_browser::CommandBuffer`, `synth_browser::SerializeNodeTree(const synth::ui::NodeTree&)`, `synth_browser::DecodeCommandBuffer(std::span<const std::byte>)` for C++ tests and TypeScript decoder parity.

- [ ] **Step 1: Write failing serialization tests**

Add tests that build a tree containing `Root`, `ScrollArea`, `Button`, `Slider`, `ComboBox`, `TextField`, `StatusText`, and `Draw` nodes with fill/line/text/ellipse/rounded-rect/polyline/polygon commands. Assert stable node ids, bounds, options, actions, scroll extents, string table entries, and draw command count.

Run: `make -C projects/synth build/browser_command_buffer_tests`

Expected: fails because `BrowserCommandBuffer.hpp` does not exist.

- [ ] **Step 2: Implement command-buffer records**

Define little-endian packed records with a header magic `SBCB`, version `1`, string table, node table, action table, draw table, and diagnostic enum. Use append-only vectors, not per-draw browser calls. Include explicit enum mapping functions for every current `NodeKind` and `DrawCommand::Kind`; unknown values return an unsupported diagnostic.

- [ ] **Step 3: Implement serializer and decoder test helper**

Implement `SerializeNodeTree` and a C++ `DecodeCommandBuffer` helper for tests. Keep serialization JUCE-free and DOM-free. Preserve node order and child ids exactly as supplied.

- [ ] **Step 4: Add stable-frame and unsupported-feature tests**

Add one test that serializes two consecutive frames with the same ids and changed values/draw commands; assert ids are stable. Add one test that injects an invalid enum through a test-only helper and assert the diagnostic names the generic unsupported feature, not an app name.

- [ ] **Step 5: Verify and commit**

Run: `make -C projects/synth browser-command-buffer-test`

Expected: all command-buffer tests pass.

Run: `make -C projects/synth test`

Expected: existing synth tests pass.

Commit: `git add projects/synth/include/synth/browser/BrowserCommandBuffer.hpp projects/synth/tests/browser_command_buffer_tests.cpp projects/synth/Makefile && git commit -m "feat(synth): serialize portable ui for browser command buffers"`

---

### Task 3: Browser UI Backend And Gesture Semantics

**Files:**
- Create: `projects/synth/browser/src/protocol.ts`
- Create: `projects/synth/browser/src/ui.ts`
- Create: `projects/synth/browser/tests/ui-backend.spec.ts`
- Create: `projects/synth/browser/tests/fixtures/command-buffer.ts`

**Interfaces:**
- Consumes: command-buffer binary format from Task 2.
- Produces: `BrowserUiBackend`, `decodeCommandBuffer(buffer: ArrayBuffer)`, `renderFrame(frame)`, `dispatchBrowserAction(action)`.

- [ ] **Step 1: Write failing Playwright tests over synthetic buffers**

Create tests that load `public/index.html`, inject a synthetic command buffer, and assert semantic controls render from portable node kinds. Include a draw node rendered to canvas and a scroll area whose bottom child is reachable.

Run: `npm --prefix projects/synth/browser test -- ui-backend.spec.ts`

Expected: fails because `ui.ts` does not exist.

- [ ] **Step 2: Implement TypeScript decoder**

Implement a decoder that validates magic/version, string indexes, node records, action records, draw records, and scroll extents. Throw `CommandBufferError` with record kind and index for malformed buffers.

- [ ] **Step 3: Implement semantic DOM diff**

Map portable node kinds to generic browser controls. Use `data-synth-node-id` and `data-synth-node-kind`; never use app names or miniapp ids to select control classes. Preserve nodes across frames when ids match.

- [ ] **Step 4: Implement batched Canvas2D draw rendering**

For draw nodes, render all draw commands after decoding the full buffer. Implement fill, stroke rect, line, arc, text, fill/stroke ellipse, fill/stroke rounded rect, polyline, and fill polygon.

- [ ] **Step 5: Implement event dispatch and gesture value rules**

Implement button/toggle/slider/combo/text actions, pointer drag actions, row double click, and draw-node double click. For pointer drag, if action value contains `:`, replace everything after the final colon with `String(delta)`; otherwise dispatch `String(delta)` as the value. Do not accumulate deltas in browser state.

- [ ] **Step 6: Verify and commit**

Run: `npm --prefix projects/synth/browser test -- ui-backend.spec.ts`

Expected: semantic rendering, scroll, pointer drag suffix replacement, and double-click tests pass.

Commit: `git add projects/synth/browser/src projects/synth/browser/tests && git commit -m "feat(synth): render browser ui command buffers"`

---

### Task 4: Generic Browser Runtime C++ Core And ABI

**Files:**
- Create: `projects/synth/include/synth/browser/BrowserRuntime.hpp`
- Create: `projects/synth/browser/cpp/BrowserRuntimeAbi.cpp`
- Create: `projects/synth/browser/src/worker.ts`
- Create: `projects/synth/browser/tests/runtime-core.spec.ts`
- Modify: `projects/synth/browser/Makefile`

**Interfaces:**
- Consumes: `synth::Engine<App>`, `RuntimeDataPaths`, `BrowserCommandBuffer`, `synth::ui::Surface`.
- Produces: `synth_browser::Runtime<App>`, C ABI functions `synth_browser_create`, `synth_browser_initialize`, `synth_browser_prepare`, `synth_browser_process`, `synth_browser_message_tick`, `synth_browser_build_ui_frame`, `synth_browser_dispatch_action`, `synth_browser_destroy`.

- [ ] **Step 1: Write failing runtime tests**

Add Playwright/runtime tests that start the fake app worker, create a runtime, dispatch a button action through the ABI, request a UI frame, and assert no DOM or app-specific HTML is involved.

Run: `npm --prefix projects/synth/browser test -- runtime-core.spec.ts`

Expected: fails because worker/runtime ABI is not implemented.

- [ ] **Step 2: Implement `synth_browser::Runtime<App>`**

Wrap `synth::Engine<App>` with start/stop/message tick, runtime data path injection, `Prepare(sampleRate, blockSize)`, `Process(float** outputs, size_t frames, uint64_t timestampMicros)`, UI command-buffer production from `PortableSurface().BuildTree()`, and action dispatch through `Surface::DispatchAction`.

- [ ] **Step 3: Implement the C ABI**

Expose opaque runtime handles and copy-free or bounded-copy buffers for UI frames and diagnostics. Keep ABI generic: the only app-specific compile unit is the entry file that names `AppType`.

- [ ] **Step 4: Implement worker protocol**

In `worker.ts`, load the Emscripten module, call the ABI functions, own the runtime handle, forward UI/action/audio/MIDI/persistence/status messages, and reject commands after destroy.

- [ ] **Step 5: Add no-app-branch checks**

Add a test script that scans `projects/synth/browser/src` and `projects/synth/include/synth/browser` for `MiniApp`, `miniapp`, `synth_miniapp`, and concrete widget names outside `cpp/miniapp_entry.cpp`; fail on matches.

- [ ] **Step 6: Verify and commit**

Run: `make -C projects/synth browser-unit-test`

Run: `npm --prefix projects/synth/browser test -- runtime-core.spec.ts`

Expected: both pass.

Commit: `git add projects/synth/include/synth/browser/BrowserRuntime.hpp projects/synth/browser/cpp/BrowserRuntimeAbi.cpp projects/synth/browser/src/worker.ts projects/synth/browser/tests projects/synth/browser/Makefile && git commit -m "feat(synth): add generic browser runtime core"`

---

### Task 5: Web Audio, SAB Ring Buffers, And Default Audio Catalog

**Files:**
- Create: `projects/synth/include/synth/browser/BrowserAudioDevices.hpp`
- Create: `projects/synth/tests/browser_audio_device_tests.cpp`
- Create: `projects/synth/browser/src/audio.ts`
- Create: `projects/synth/browser/src/audio-worklet.ts`
- Create: `projects/synth/browser/tests/audio-flow.spec.ts`
- Modify: `projects/synth/browser/src/main.ts`
- Modify: `projects/synth/browser/src/protocol.ts`
- Modify: `projects/synth/Makefile`

**Interfaces:**
- Consumes: worker runtime ABI `prepare/process`, `RuntimeConfig`, `AudioWorkletProcessor.process()` arrays.
- Produces: `BuildBrowserAudioSnapshot`, `AudioBridge`, `SharedRingBuffer`, cross-origin-isolation diagnostics, finite non-silent fake-app audio probe.

- [ ] **Step 1: Write failing audio catalog tests**

Add `browser_audio_device_tests.cpp` asserting exactly one output option: id `system_default`, label `System Default`, selected empty device name, `showInputCombo == false`, and empty `inputOptions`.

Run: `make -C projects/synth build/browser_audio_device_tests`

Expected: fails because `BrowserAudioDevices.hpp` does not exist.

- [ ] **Step 2: Implement default-only audio catalog**

Implement `BuildBrowserAudioSnapshot` using `synth::runtime_ui::kSystemDefaultOptionId` and `kSystemDefaultOptionLabel`. Persist the empty output-device name through the existing generic state conversion helper.

- [ ] **Step 3: Write failing Playwright audio tests**

Test that without `crossOriginIsolated`, startup reports the missing isolation diagnostic. Test that with the static test server headers, user activation creates/resumes `AudioContext`, installs the worklet, and the fake app produces finite non-silent samples.

- [ ] **Step 4: Implement AudioContext and worklet startup**

`audio.ts` creates/resumes `AudioContext` only from user activation, loads the worklet module, creates the `AudioWorkletNode`, connects to `audioContext.destination`, and posts negotiated sample rate plus worker block size to the worker.

- [ ] **Step 5: Implement SAB ring-buffer bridge**

`audio-worklet.ts` performs only ring-buffer copy/fill, state-word reads/writes, underflow count increments, and shutdown checks. It reads actual output array lengths each callback and never calls DOM, Web MIDI, IndexedDB, or UI code.

- [ ] **Step 6: Verify and commit**

Run: `make -C projects/synth browser-audio-device-test`

Run: `npm --prefix projects/synth/browser test -- audio-flow.spec.ts`

Expected: catalog tests and audio-flow tests pass.

Commit: `git add projects/synth/include/synth/browser/BrowserAudioDevices.hpp projects/synth/tests/browser_audio_device_tests.cpp projects/synth/browser/src projects/synth/browser/tests projects/synth/Makefile && git commit -m "feat(synth): bridge browser audio through worklet ring buffers"`

---

### Task 6: Web MIDI Sysex Bridge And Reconnect Semantics

**Files:**
- Create: `projects/synth/include/synth/browser/BrowserMidiBridge.hpp`
- Create: `projects/synth/tests/browser_midi_bridge_tests.cpp`
- Create: `projects/synth/browser/src/midi.ts`
- Create: `projects/synth/browser/tests/midi-flow.spec.ts`
- Modify: `projects/synth/browser/src/worker.ts`
- Modify: `projects/synth/browser/src/protocol.ts`
- Modify: `projects/synth/Makefile`

**Interfaces:**
- Consumes: `navigator.requestMIDIAccess({ sysex: true })`, `MIDIInput`, `MIDIOutput`, `MidiInstrumentConfig`, `PlanMidiReconciliation`, `ExecuteReconcilePlan`, engine MIDI buses and `MidiSender`.
- Produces: `BrowserMidiBridge`, injectable Web MIDI test shim, bidirectional bytes including sysex, poll/reconnect/offline state.

- [ ] **Step 1: Write failing C++ MIDI bridge tests**

Assert the browser bridge plans open/close/update/resync through `PlanMidiReconciliation`/`ExecuteReconcilePlan`, keeps slots independent, routes incoming bytes to the selected controller slot, and exposes outgoing bytes per selected output slot.

- [ ] **Step 2: Implement C++ bridge bindings**

Bind the reconcile core to abstract browser endpoint operations. Do not duplicate desktop reconcile policy in JS. If a needed operation cannot be represented over the ABI, stop and update the OpenSpec before continuing.

- [ ] **Step 3: Write failing Playwright MIDI tests**

Inject deterministic MIDI access with two inputs and two outputs. Assert `requestMIDIAccess` is called with `{ sysex: true }`, sysex denial leaves MIDI offline while UI/audio continue, input sysex reaches runtime state, engine output sysex reaches the selected test output port, polling recovers missed connect/disconnect, and reconnecting one slot does not remap another.

- [ ] **Step 4: Implement browser Web MIDI manager**

`midi.ts` requests MIDI from a user gesture, owns browser port objects on the main thread, listens to `statechange`, runs a poll timer, serializes inbound/outbound bytes, and reports generic runtime status. It must support multiple simultaneous selected inputs and outputs.

- [ ] **Step 5: Verify and commit**

Run: `make -C projects/synth browser-midi-bridge-test`

Run: `npm --prefix projects/synth/browser test -- midi-flow.spec.ts`

Expected: C++ bridge and Playwright MIDI tests pass.

Commit: `git add projects/synth/include/synth/browser/BrowserMidiBridge.hpp projects/synth/tests/browser_midi_bridge_tests.cpp projects/synth/browser/src projects/synth/browser/tests projects/synth/Makefile && git commit -m "feat(synth): add sysex web midi bridge"`

---

### Task 7: Browser Persistence And Static Hosting Server

**Files:**
- Create: `projects/synth/include/synth/browser/BrowserPersistence.hpp`
- Create: `projects/synth/browser/src/persistence.ts`
- Create: `projects/synth/browser/src/static-server.mjs`
- Create: `projects/synth/browser/tests/persistence.spec.ts`
- Create: `projects/synth/browser/tests/static-site.spec.ts`
- Modify: `projects/synth/browser/playwright.config.mjs`
- Modify: `projects/synth/browser/src/worker.ts`

**Interfaces:**
- Consumes: `RuntimeDataPaths::FromDataRoot`, Emscripten `FS.syncfs`, IDBFS, File page status paths.
- Produces: app-scoped IDBFS root with `patches/`, `logs/`, `config.json`, pending/succeeded/failed sync status, static server with COOP/COEP and permissions-policy headers.

- [ ] **Step 1: Write failing persistence/static tests**

Playwright tests must assert startup sync precedes runtime initialization, patch/config saves schedule `FS.syncfs(false)`, patch paths stay under `patches/`, the static server sets COOP/COEP and MIDI permissions-policy headers, and normal audio/MIDI/UI/patch/config flows make no dynamic HTTP or WebSocket requests.

- [ ] **Step 2: Implement IDBFS coordination**

`persistence.ts` mounts an app-scoped root, calls `FS.syncfs(true)` before runtime initialization, exposes `/data/patches`, `/data/logs`, and `/data/config.json`, and schedules debounced `FS.syncfs(false)` after save/status messages.

- [ ] **Step 3: Implement runtime status plumbing**

Send persistence pending/succeeded/failed statuses through the existing runtime page status path. Keep storage failures generic and browser-host-owned.

- [ ] **Step 4: Implement static server for Playwright**

`static-server.mjs` serves only files from the browser build output. Add headers `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, and a permissions policy that allows MIDI sysex for the test origin. Reject unknown routes with 404, reject path traversal like the existing static-server tests in `projects/sheaf-chat/tests/server/static.test.ts`, and map `.wasm` to `application/wasm`; do not add application APIs.

- [ ] **Step 5: Verify and commit**

Run: `npm --prefix projects/synth/browser test -- persistence.spec.ts static-site.spec.ts`

Expected: persistence and static-only tests pass.

Commit: `git add projects/synth/include/synth/browser/BrowserPersistence.hpp projects/synth/browser/src projects/synth/browser/tests projects/synth/browser/playwright.config.mjs && git commit -m "feat(synth): persist browser runtime state statically"`

---

### Task 8: End-To-End Browser Validation And OpenSpec Progress

**Files:**
- Create: `projects/synth/browser/tests/fake-app.e2e.spec.ts`
- Create: `projects/synth/browser/tests/miniapp-smoke.spec.ts`
- Create: `projects/synth/browser/README.md`
- Modify: `projects/synth/browser/Makefile`
- Modify: `projects/synth/Makefile`
- Modify: `openspec/changes/add-browser-wasm-runtime/tasks.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: required Playwright acceptance suite, miniapp browser smoke target using the generic entry point, documented static-hosting prerequisites, checked OpenSpec task list.

- [ ] **Step 1: Write end-to-end Playwright tests**

`fake-app.e2e.spec.ts` starts the fake app first and verifies app open, user-activated audio flow, finite non-silent output, bidirectional MIDI including sysex through injectable ports, command-buffer rendering, pointer drag suffix replacement, double-click push dispatch, persistence sync, and no dynamic HTTP/WebSocket calls.

`miniapp-smoke.spec.ts` then starts the miniapp build using only `miniapp_entry.cpp` and verifies app open, audio flow, bidirectional MIDI through injectable ports, mouse gesture dispatch, UI command-buffer rendering, and absence of miniapp-specific browser glue.

- [ ] **Step 2: Wire browser test ordering**

Ensure `npm --prefix projects/synth/browser test` runs fake-app tests before miniapp smoke. Make miniapp smoke depend on the generic fake app build/test target succeeding first.

- [ ] **Step 3: Document static hosting prerequisites**

Add `projects/synth/browser/README.md` documenting Chrome target, secure context, mandatory COOP/COEP, Web MIDI sysex permission, System-Default-only output, skipped audio input, static-only hosting, and Playwright test commands.

- [ ] **Step 4: Run full verification**

Run: `make -C projects/synth test`

Expected: all existing and new C++ synth tests pass.

Run: `npm --prefix projects/synth/browser test`

Expected: all browser Playwright tests pass.

Run: `openspec validate add-browser-wasm-runtime --strict`

Expected: change remains valid.

- [ ] **Step 5: Update OpenSpec task checklist**

Mark each item in `openspec/changes/add-browser-wasm-runtime/tasks.md` complete only after the corresponding code has passed subagent review and the verification commands above.

- [ ] **Step 6: Commit**

Commit: `git add projects/synth/browser projects/synth/Makefile openspec/changes/add-browser-wasm-runtime/tasks.md && git commit -m "test(synth): verify browser wasm runtime end to end"`

---

## Spec Coverage Self-Review

- `synth-browser-wasm-runtime` sbw-1 through sbw-3 are covered by Tasks 1 and 4.
- sbw-4 audio bridge, System Default output, skipped input, and cross-origin isolation are covered by Task 5.
- sbw-5 MIDI sysex, multiple devices, polling, reconnect, and bidirectional flow are covered by Task 6.
- sbw-6 UI command-buffer backend and portable event dispatch are covered by Tasks 2 and 3.
- sbw-7 browser runtime data paths and persistence are covered by Task 7.
- sbw-8 Chrome security gates and static hosting headers are covered by Tasks 5 and 7.
- sbw-9 Playwright browser runtime coverage is covered by Tasks 3, 5, 6, 7, and 8.
- `synth-app-runtime` compile-time host swapping, app portability gates, host callback adaptation, and audio catalog behavior are covered by Tasks 1, 4, and 5.
- `synth-runtime-ui` command-buffer serialization, browser rendering/dispatch, and no app-specific fallback are covered by Tasks 2, 3, and 8.

## Execution Notes

- Use Codex worker subagents for implementation tasks and xagent Claude reviewers for the required task and final code-review passes.
- Dispatch implementation tasks sequentially unless their write sets are proven disjoint after Task 1; the runtime, worker protocol, and browser TypeScript files are tightly coupled.
- Before the first implementation subagent, record the current base commit with `git rev-parse HEAD` and initialize `.superpowers/sdd/progress.md`.
- After each task, generate a review package from that task's base commit and run a Claude review through `plugins/xagent/scripts/xagent run --harness claude_code --model sonnet` for ordinary task diffs or `--model opus` for audio/MIDI/concurrency/final branch reviews.
- Fix Critical and Important review findings before marking the task complete or checking OpenSpec task boxes.
