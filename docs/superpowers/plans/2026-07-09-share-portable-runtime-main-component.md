# Shared Portable Runtime Main Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make JUCE and Chrome render the same generic portable top-level component containing an intact application surface, the runtime sidebar, and runtime pages, while correcting browser pointer/drawing/layout parity without changing audio scheduling.

**Architecture:** Add `synth::runtime_ui::RuntimeMainComponent<App, Services>` as the sole host-neutral UI composition and action router. JUCE and browser supply compile-time services adapters over their existing runtime/engine facilities, then render that same surface through `PortableComponent` or the browser command buffer; app dimensions remain content dimensions and the 96-pixel sidebar is additive.

**Tech Stack:** C++20, JUCE, Emscripten/LLVM WebAssembly, TypeScript, DOM/Canvas2D, Playwright Chromium, Make, OpenSpec change `share-portable-runtime-main-component`, xagent Codex workers, xagent Claude Code reviewers.

## Global Constraints

- Browser runtime and UI code must contain zero miniapp-specific or concrete-app-specific logic.
- Browser entry points may name only the concrete application type; every runtime, service, layout, renderer, and test path must be generic over `synth::SynthApplication`.
- The application portable root must be one origin-zero root matching positive `App::Config().uiWidth` and `uiHeight`; duplicate IDs, unknown children, cycles, or app IDs beginning `runtime.` fail generically.
- The composite root is `(app width + 96) x app height`; the app remains at `(0, 0)` and the sidebar begins at `x == app width`.
- JUCE and browser must build frames and dispatch actions through the same portable runtime main component.
- Browser Audio exposes exactly `system_default` / `System Default`, suppresses audio input, and does not enumerate named outputs.
- Browser pointer drag uses pointer capture, accepted incremental `(dx - dy) * 0.0025` deltas, threshold `abs(delta) >= 0.001`, surface-scale compensation, and replacement of the suffix after the final colon.
- Browser Arc drawing uses rounded line caps and joins without leaking Canvas state.
- The browser remains a static website and Playwright must verify app open, audio flow, bidirectional SysEx MIDI, multiple devices, polling/reconnect, shared runtime pages, mouse gestures, and desktop/narrow layout.
- Do not change `projects/synth/browser/src/audio.ts`, `audio-worklet.ts`, SharedRingBuffer scheduling, DSP, or sample-rate behavior. Report the diagnosed underrun cause only.
- Follow TDD for each behavior: write the focused test, run it and observe the expected failure, implement the minimum, then rerun focused and neighboring suites.
- Use xagent Codex workers for implementation tasks and xagent Claude Code for spec-compliance then code-quality review after each task.

---

## File Structure

- Create `projects/synth/include/synth/RuntimeMainComponent.hpp`: portable tree composition, validation, page state, action routing, refresh, and services concept.
- Create `projects/synth/tests/runtime_main_component_tests.cpp`: JUCE-free fake-app/fake-services contract tests.
- Modify `projects/synth/Makefile`: build and run the new JUCE-free test binary and list new header dependencies.
- Create `projects/synth/runtime/JuceRuntimeMainServices.hpp`: JUCE runtime services adapter over `Runtime<App>`.
- Modify `projects/synth/runtime/MainPane.hpp`: thin single-`PortableComponent` host for the shared main component.
- Modify `projects/synth/runtime/Shell.hpp`: shared intrinsic size and refresh wiring.
- Modify `projects/synth/juce/PortableJuceBackend.hpp`: resolve unbounded controls per nearest nested root while preserving flat absolute rendering.
- Modify `projects/synth/juce/RuntimeShellSessionTests.cpp`, `RuntimePagesJuceTests.cpp`, and miniapp `Makefile`: shared-shell JUCE coverage and build dependencies.
- Create `projects/synth/include/synth/browser/BrowserRuntimeMainServices.hpp`: browser services adapter over Engine, BrowserMidiBridge, browser audio snapshot, and persistence status.
- Modify `projects/synth/include/synth/browser/BrowserRuntime.hpp`: own/use the shared component for frame building, dispatch, prepare state, refresh, and pages.
- Modify `projects/synth/tests/browser_runtime_contract_tests.cpp`, `browser_audio_device_tests.cpp`, `browser_midi_bridge_tests.cpp`: shared browser runtime/page contracts.
- Modify `projects/synth/browser/src/ui.ts`: pointer capture, rounded arcs, resolved dimensions, cycle-safe traversal, and backend disposal.
- Modify `projects/synth/browser/tests/ui-backend.spec.ts`: focused browser backend behavior.
- Modify `projects/synth/browser/public/index.html` and create/modify `public/synth-browser.css`: generic static shell only.
- Modify `projects/synth/browser/tests/static-site.spec.ts`, `fake-app.e2e.spec.ts`, `miniapp-smoke.spec.ts`, `audio-flow.spec.ts`, and `midi-flow.spec.ts`: integrated behavior and screenshots.
- Modify `projects/synth/browser/src/main.ts` and protocol/worker files only where generic shared-page refresh/status plumbing requires it; no audio scheduling edits.
- Create `projects/synth/docs/browser-audio-underrun-diagnosis.md`: deferred audio findings and evidence.
- Modify `projects/synth/docs/coverage.md` and OpenSpec tasks after reviewed verification.

### Task 1: Portable Composite Surface And Validation

**OpenSpec tasks covered:** 1.1, 1.2, 1.3.

**Files:**
- Create: `projects/synth/include/synth/RuntimeMainComponent.hpp`
- Create: `projects/synth/tests/runtime_main_component_tests.cpp`
- Modify: `projects/synth/Makefile`

**Interfaces:**
- Produces:

```cpp
namespace synth::runtime_ui {
enum class RuntimeMainPage { Application, Audio, Controllers, File };

template <typename Services>
concept RuntimeMainServices = requires(Services& services,
                                      AudioPageSnapshot& audio,
                                      FilePageSnapshot& file,
                                      ControllersPageSurface& controllers,
                                      const ui::Action& action,
                                      std::function<void()> onBack) {
    { services.MakeControllersCallbacks(std::move(onBack)) } ->
        std::same_as<ControllersPageCallbacks>;
    { services.RefreshAudio(audio) } -> std::same_as<void>;
    { services.DispatchAudio(action) } -> std::same_as<void>;
    { services.RefreshFile(file) } -> std::same_as<void>;
    { services.DispatchFile(action) } -> std::same_as<void>;
    { services.RefreshControllers(controllers) } -> std::same_as<void>;
    { services.DeadlineSamplePercent() } -> std::convertible_to<float>;
    { services.SaveRuntimeConfiguration() } -> std::same_as<void>;
};

template <SynthApplication App, RuntimeMainServices Services>
class RuntimeMainComponent final : public ui::Surface {
public:
    RuntimeMainComponent(App& app, Services& services);
    ui::NodeTree BuildTree() override;
    void SetActionHandler(ActionHandler handler) override;
    void DispatchAction(const ui::Action& action) override;
    void Refresh();
    void ShowPage(RuntimeMainPage page);
    RuntimeMainPage CurrentPage() const;
    ui::Bounds IntrinsicBounds() const;
};
}
```

- `BuildTree()` returns `runtime.main.root` first, app/page root second, then the sidebar tree with its root and every descendant translated by `App::Config().uiWidth`; all explicit bounds remain absolute surface coordinates.

- [x] **Step 1: Add the failing test binary and geometry/navigation tests**

Create a fake `SynthApplication`, one-node app surface, and fake services. Add named cases:

```cpp
TestCompositeBoundsPreserveAppAndAddSidebar();
TestSidebarOpensEachPageAndBackRestoresApp();
TestAppActionsRouteOnlyToAppSurface();
TestRuntimeActionsRouteOnlyToOwningPageOrServices();
TestBackFromConfigurationPageSavesRuntimeConfiguration();
```

Assert an app config of 900x560 yields root 996x560, app root 900x560 at zero, and sidebar root x 900. Assert `runtime.sidebar.audio`, `runtime.audio.back`, and an app action change only their expected state/counters.

- [x] **Step 2: Run the new target and confirm RED**

Run:
```bash
make -C projects/synth build/runtime_main_component_tests
```

Expected: compile failure because `synth/RuntimeMainComponent.hpp` and the Make target do not exist.

- [x] **Step 3: Implement the services concept and minimum composite surface**

Implement the interface above. Reuse `SidebarSurface`, `AudioPageSurface`, `FilePageSurface`, `ControllersPageSurface`, `RuntimePageBackSavesConfiguration`, and `RollingMax256`. Wire surface handlers once in the constructor; `Refresh()` samples `DeadlineSamplePercent`, refreshes Audio/File, and calls `RefreshControllers`. `DispatchAction` routes by exact action-name ownership and sends unknown non-`runtime.` actions to `app.PortableSurface()`.

- [x] **Step 4: Add failing malformed-tree tests**

Add one test per diagnostic:
```cpp
TestRejectsRootSizeMismatch();
TestRejectsDuplicateNodeIds();
TestRejectsUnknownChild();
TestRejectsCycle();
TestRejectsAppRuntimeNamespace();
```

Each builds the malformed tree and asserts `BuildTree()` throws `std::invalid_argument` whose message contains respectively `configured bounds`, `duplicate node id`, `unknown child`, `cycle`, or `reserved runtime namespace`.

- [x] **Step 5: Run malformed-tree tests and confirm RED**

Run `projects/synth/build/runtime_main_component_tests`.

Expected: the new malformed cases fail because composition validation is missing.

- [x] **Step 6: Implement validation and rerun focused suites**

Validate before composition using a node-ID index plus DFS states `{unvisited, visiting, visited}` from the sole parentless root. Require every node reachable exactly once and app root bounds equal `{0,0,float(config.uiWidth),float(config.uiHeight)}`.

Run:
```bash
make -C projects/synth build/runtime_main_component_tests build/portable_ui_tests
projects/synth/build/runtime_main_component_tests
projects/synth/build/portable_ui_tests
```

Expected: both pass with no warnings.

- [x] **Step 7: Commit**

Commit message: `feat(synth): add portable runtime main component`.

### Task 2: JUCE Runtime Services And Single Renderer

**OpenSpec tasks covered:** 2.1, 2.2, 2.3.

**Files:**
- Create: `projects/synth/runtime/JuceRuntimeMainServices.hpp`
- Modify: `projects/synth/runtime/MainPane.hpp`
- Modify: `projects/synth/runtime/Shell.hpp`
- Modify: `projects/synth/runtime/juce_build.mk`
- Modify: `projects/synth/juce/PortableJuceBackend.hpp`
- Modify: `projects/synth/juce/PortableJuceBackendTests.cpp`
- Modify: `projects/synth/juce/RuntimeShellSessionTests.cpp`
- Modify: `projects/synth/juce/RuntimePagesJuceTests.cpp`
- Modify: `projects/synth/apps/miniapp/Makefile`

**Interfaces:**
- `JuceRuntimeMainServices<App>` satisfies Task 1's concept and delegates to `Runtime<App>`.
- `MainPane<App>` owns members in lifetime order: runtime reference, services, `RuntimeMainComponent<App, JuceRuntimeMainServices<App>>`, then one `synth_juce::PortableComponent`.
- `MainPane::RefreshOnTick()` calls shared refresh then renderer refresh.
- `MainPane::IntrinsicBounds()` returns the shared component bounds.

- [x] **Step 1: Write failing JUCE shell tests**

Extend `RuntimeShellSessionTests.cpp` to assert:
- the content component width is `MiniApp::Config().uiWidth + 96`;
- `runtime.main.root`, app encoder nodes, and `runtime.sidebar.audio` are discoverable through one `PortableComponent`;
- Audio click replaces app nodes, Back restores them, and app state survives;
- a full-width app draw node is not clipped at x 900.

Extend `PortableJuceBackendTests.cpp` with a composite tree containing a 900-pixel nested app root, unbounded app controls, and a sidebar at x 900; assert the controls wrap within the app root while the sidebar remains at x 900.

- [x] **Step 2: Run the JUCE shell target and confirm RED**

Run:
```bash
make -C projects/synth/apps/miniapp build/runtime_shell_session_tests
projects/synth/apps/miniapp/build/runtime_shell_session_tests
```

Expected: assertions fail because `MainPane` still owns separate renderers and the shell width remains 900.

- [x] **Step 3: Implement `JuceRuntimeMainServices<App>`**

Move the behavior currently in `AudioPageHost`, `FilePageHost`, and `ControllersPageHost::MakeCallbacks` behind the services methods. Preserve audio status/sync and MIDI-rebuild hooks with RAII cleanup. `DeadlineSamplePercent` returns `Runtime::DeadlineSamplePct`; `RefreshAudio` enumerates JUCE devices and negotiated status; `DispatchAudio` calls existing selection methods; File delegates exact existing patch operations/status; Controllers callbacks use engine instrument snapshot/edit and MIDI connection state, while `RefreshControllers` applies enumeration, pending dirty state, and `ControllersPageSurface::RefreshOnTick` each UI tick.

- [x] **Step 4: Replace `MainPane` composition and make shell size additive**

Render only the shared surface. Update `ShellApplication::MainWindow` and `RuntimeShellSession` sizing to use `RuntimeMainComponent::IntrinsicBounds()` after runtime startup. Keep the existing `MainPane::Page`, `ShowPage(Page)`, and `CurrentPage()` public API as wrappers that delegate to `RuntimeMainComponent::ShowPage`/`CurrentPage`.

Remove `ShellComponent::RepaintAll`'s separate `WriteDeadlineSample(runtime_.DeadlineSamplePct())` call; `RuntimeMainComponent::Refresh()` now samples and writes the rolling maximum exactly once through services.

Update `PortableJuceBackend::LayoutControls` to maintain one flow cursor per nearest ancestor `NodeKind::Root`. Each cursor uses that root's absolute bounds; controls remain direct children of `PortableComponent` and receive resolved absolute bounds.

- [x] **Step 5: Run focused and full JUCE suites**

Run:
```bash
make -C projects/synth/apps/miniapp test
make -C projects/synth/apps/miniapp
```

Expected: all eight JUCE test binaries pass and `SynthMiniapp.app` builds.

- [x] **Step 6: Commit**

Commit message: `refactor(synth): render shared runtime shell in JUCE`.

### Task 3: Browser Runtime Services And Shared Frame Routing

**OpenSpec tasks covered:** 3.1, 3.2, 3.3.

**Files:**
- Create: `projects/synth/include/synth/browser/BrowserRuntimeMainServices.hpp`
- Modify: `projects/synth/include/synth/browser/BrowserRuntime.hpp`
- Modify: `projects/synth/include/synth/browser/BrowserAudioDevices.hpp`
- Modify: `projects/synth/tests/browser_runtime_contract_tests.cpp`
- Modify: `projects/synth/tests/browser_audio_device_tests.cpp`
- Modify: `projects/synth/tests/browser_midi_bridge_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify: `projects/synth/browser/Makefile`

**Interfaces:**
- `BrowserRuntimeMainServices<App>` holds references to `Engine<App>`, `BrowserMidiBridge<Engine<App>>`, and negotiated audio status fields; it uses only generic runtime/page types, returns `0.0f` from `DeadlineSamplePercent`, and refreshes the Controllers surface from the bridge's latest device list/state.
- `synth_browser::Runtime<App>` owns services before `RuntimeMainComponent`, calls `mainComponent_.Refresh()` from `MessageTick`, serializes `mainComponent_.BuildTree()`, and dispatches to `mainComponent_`.
- `Prepare(sampleRate, blockSize)` records negotiated values for the Audio page but does not alter scheduling.

- [x] **Step 1: Add failing browser runtime shared-frame tests**

In `browser_runtime_contract_tests.cpp`, initialize the fake app runtime and decode/build its portable tree. Assert the first frame contains `runtime.main.root`, fake app node IDs, and sidebar nodes; dispatch Audio, assert the next frame contains `runtime.audio.root` and no app content; dispatch Back, assert app content returns; dispatch an app action, assert the fake app receives it.

- [x] **Step 2: Run browser C++ targets and confirm RED**

Run:
```bash
make -C projects/synth browser-unit-test browser-audio-device-test browser-midi-bridge-test
```

Expected: shared-frame assertions fail because `BrowserRuntime` serializes only `PortableSurface()`.

- [x] **Step 3: Implement browser services**

Use `BuildBrowserAudioSnapshot(engine.AudioDeviceSnapshot())`, then populate a generic negotiated device line such as `System Default - 48000 Hz - 128 samples` after prepare. Audio selection accepts only `system_default` and persists the empty output name through `Engine::SetAudioDeviceFromHost`. File methods call the same `Engine::Patches()` operations and expose `engine.DataPaths().patchesRoot`. Controllers callbacks use engine instrument snapshot/edit plus `BrowserMidiBridge::ConnectionState`; store and expose the latest submitted `MidiDeviceList` from the bridge for `RefreshControllers`. Return `0.0f` for browser deadline load because no callback-load metric exists in this change.

- [x] **Step 4: Route browser frames/actions through the shared component**

Construct services and main component after engine/midi bridge members in declaration order. Replace only `BuildUiFrame`, `DispatchAction`, `Prepare`, and `MessageTick` behavior needed for shared UI. Do not edit JavaScript audio scheduling or WASM render-buffer allocation.

- [x] **Step 5: Run C++ and Emscripten generic gates**

Run:
```bash
make -C projects/synth browser-unit-test browser-command-buffer-test browser-audio-device-test browser-midi-bridge-test
make -C projects/synth/browser browser-fake-app
npm --prefix projects/synth/browser run check:generic-runtime
```

Expected: all pass; generic-runtime checker finds no miniapp strings outside the typed miniapp entry.

- [x] **Step 6: Commit**

Commit message: `feat(synth): expose shared runtime shell in browser`.

### Task 4: Browser Pointer, Canvas, And Layout Parity

**OpenSpec tasks covered:** 4.1, 4.2, 4.3.

**Files:**
- Modify: `projects/synth/browser/src/ui.ts`
- Modify: `projects/synth/browser/tests/ui-backend.spec.ts`
- Modify: `projects/synth/browser/public/index.html`
- Create/Modify: `projects/synth/browser/public/synth-browser.css`
- Modify: `projects/synth/browser/tests/static-site.spec.ts`

**Interfaces:**
- `BrowserUiBackend` gains `dispose(): void` to disconnect its `ResizeObserver` and clear captured pointer state.
- Pointer state is keyed by pointer ID and stores node ID plus accepted unscaled `clientX/clientY` anchor.
- `resolveFrameBounds` returns absolute surface bounds for every node plus a resolved extent, uses the nearest nested `NodeKind::Root` as each unbounded control's flow boundary, and records parent IDs so DOM CSS offsets are `childAbsolute - parentAbsolute`.

- [x] **Step 1: Write failing pointer tests**

Use real `PointerEvent`s and patched `setPointerCapture`/`releasePointerCapture` spies. Assert:
- down `(10,20)`, move `(18,16)` dispatches `(8 - -4) * .0025 == .03`;
- second move is incremental from accepted `(18,16)`;
- `surfaceScale == .5` compensates CSS movement before sensitivity;
- below-threshold motion dispatches nothing and is accumulated from the last accepted anchor;
- movement after leaving the element still dispatches until up/cancel/lost capture;
- action value `0:3:0` becomes `0:3:<delta>`.

- [x] **Step 2: Run focused Playwright test and confirm RED**

Run:
```bash
npm --prefix projects/synth/browser run build
npx --prefix projects/synth/browser playwright test projects/synth/browser/tests/ui-backend.spec.ts
```

Expected: pointer tests fail because dispatch occurs once on pointer up and ignores y/capture.

- [x] **Step 3: Implement incremental captured gestures**

Attach pointer listeners only where `pointerDragAction` exists, call `setPointerCapture(event.pointerId)`, dispatch accepted move deltas immediately, and clear on `pointerup`, `pointercancel`, and `lostpointercapture`. Keep double click unchanged.

- [x] **Step 4: Write failing Canvas/layout tests**

Instrument a fake 2D context and assert Arc calls are enclosed by `save`/`restore` with `lineCap == "round"` and `lineJoin == "round"`. Render an unbounded 80-character status node followed by a button and assert non-overlap. Render auto-flow below the explicit root and assert root host height reaches the resolved bottom. Render a graph with a cycle and assert `CommandBufferError`/generic error rather than recursion.

Render a composite tree whose sidebar root and button both have absolute x coordinates at 900. Assert the sidebar element has CSS left 900, its nested button has CSS left 0, and both resolve to surface x 900. Assert unbounded app controls wrap before x 900 even though the composite root is 996 pixels wide.

- [x] **Step 5: Implement rounded arcs and resolved layout fixes**

Set arc stroke state inside `context.save()`/`restore()`. Add visited/visiting traversal guards. Resolve auto-flow separately for each nested root and measure default label/status width with `Math.max(120, text.length * 6.5 + 12)` capped to that root's available row width. Keep resolved bounds absolute, but subtract the resolved parent origin when assigning nested DOM `left`/`top`. Compute `surfaceHeight` from resolved descendant bounds, apply one transform to the single parentless composite root, and make `dispose()` disconnect the observer.

- [x] **Step 6: Verify TypeScript/static tests**

Run:
```bash
npm --prefix projects/synth/browser run build
npx --prefix projects/synth/browser playwright test projects/synth/browser/tests/ui-backend.spec.ts projects/synth/browser/tests/static-site.spec.ts
```

Expected: all focused tests pass and static HTML contains only generic root/activation/status elements plus stylesheet/module references.

- [x] **Step 7: Commit**

Commit message: `fix(synth): match browser UI interaction and drawing parity`.

### Task 5: Playwright Shared-Shell And Real-WASM Verification

**OpenSpec tasks covered:** 5.1, 5.2, 5.3.

**Files:**
- Modify: `projects/synth/browser/tests/fake-app.e2e.spec.ts`
- Modify: `projects/synth/browser/tests/miniapp-smoke.spec.ts`
- Modify: `projects/synth/browser/tests/audio-flow.spec.ts`
- Modify: `projects/synth/browser/tests/midi-flow.spec.ts`
- Modify: `projects/synth/browser/src/main.ts`
- Modify: `projects/synth/browser/src/protocol.ts` and `worker.ts` to return a fresh generic UI frame after successful action dispatch; changes are confined to the `dispatch-action`/`ui-frame` branches and must not touch `configure-audio` or `render-audio`
- Create: `projects/synth/browser/tests/screenshots/runtime-shell-desktop.png`
- Create: `projects/synth/browser/tests/screenshots/runtime-shell-narrow.png`

**Interfaces:**
- Browser test hooks remain generic and report frame node IDs/actions, audio ring counters/samples, and MIDI port traffic; no hook names a miniapp widget.
- Screenshots use stable viewports 1200x800 and 390x844 with animations disabled.

- [ ] **Step 1: Add failing generic fake-app integration assertions**

Assert initial frame contains app content and right sidebar, each sidebar button opens its portable page, Back restores app, desktop/narrow element bounds do not overlap, captured drag sends multiple incremental actions, and double click reaches the fake surface. Save screenshots only after deterministic fonts/frame completion.

- [ ] **Step 2: Run fake-app E2E and confirm RED**

Run:
```bash
make -C projects/synth/browser browser-fake-app
npx --prefix projects/synth/browser playwright test projects/synth/browser/tests/fake-app.e2e.spec.ts
```

Expected: shared sidebar/page or incremental gesture assertions fail until integration refresh plumbing is complete.

- [ ] **Step 3: Implement minimum generic refresh/status plumbing**

After any dispatched action, request and render a fresh `ui-frame`. Keep the existing static activation control host-generic. Expose test observations through generic runtime responses or DOM data attributes; do not inspect app node IDs in production code.

- [ ] **Step 4: Extend real-WASM miniapp and MIDI tests**

Build the generic miniapp entry and assert:
- one composite root, visible sidebar, at least one app canvas, and no clipped rightmost app draw region;
- four rendered audio blocks contain finite non-zero samples;
- `requestMIDIAccess` receives `{sysex:true}`;
- two controller slots mapped to separate fake input/output pairs remain independent;
- incoming SysEx reaches its configured slot and outbound SysEx reaches that slot's output;
- disconnect followed by a poll marks only that slot offline, reconnect restores it, and the other slot stays active;
- drag and double click alter action/runtime state through `Surface::DispatchAction`.

- [ ] **Step 5: Run real browser/WASM tests**

Run:
```bash
make -C projects/synth/browser browser-miniapp
SYNTH_BROWSER_FAKE_GATE_CONFIRMED=1 npx --prefix projects/synth/browser playwright test projects/synth/browser/tests/miniapp-smoke.spec.ts projects/synth/browser/tests/audio-flow.spec.ts projects/synth/browser/tests/midi-flow.spec.ts
```

Expected: all pass. Do not add an underflow-count assertion because audio scheduling is deferred.

- [ ] **Step 6: Build and visually compare desktop/browser**

Run:
```bash
make -C projects/synth/apps/miniapp
make -C projects/synth/browser browser-miniapp
```

Launch the desktop app for one screenshot and use Playwright for browser screenshots. Confirm complete seven-encoder layout, both waveform panes, lower controls, persistent stationary indicator caps, right sidebar, and working gestures. Correct only generic composition/backend defects.

- [ ] **Step 7: Commit**

Commit message: `test(synth): verify shared browser runtime shell`.

### Task 6: Diagnosis, Reviews, Coverage, And Full Verification

**OpenSpec tasks covered:** 6.1, 6.2, 6.3.

**Files:**
- Create: `projects/synth/docs/browser-audio-underrun-diagnosis.md`
- Modify: `projects/synth/docs/coverage.md`
- Modify: `openspec/changes/share-portable-runtime-main-component/tasks.md`

- [ ] **Step 1: Write the audio diagnosis without production changes**

Document these calculations and evidence:
```text
48,000 / 128 = 375 worklet blocks/sec
round(128 * 1000 / 48,000) = 3 ms producer interval
1000 / 3 = 333.33 requested render blocks/sec
shortfall = 41.67 blocks/sec = 5,333 frames/sec (11.11%)
```

Reference `audio.ts` timer scheduling, `audio-worklet.ts` zero fill/underflow counter, and `worker.ts` per-block `_malloc`/copy/free as secondary pressure. State explicitly that this change did not modify audio code and recommend a separate render-ahead/watermark scheduler design.

- [ ] **Step 2: Run final Claude Opus whole-branch review**

Generate a merge-base review package and run:
```bash
plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "Review the supplied branch package for spec compliance and code quality. Findings first, ordered by severity, with file/line references. Verify zero concrete-app browser logic, shared JUCE/browser top-level composition, pointer/Canvas parity, static-site behavior, and that audio scheduling was not changed. Call out uncertainty."
```

Resolve every Critical/Important finding with a Codex worker, rerun covering tests, regenerate the package, and re-review until clean.

- [ ] **Step 3: Run full verification**

Run:
```bash
make -C projects/synth test
make -C projects/synth/apps/miniapp test
make -C projects/synth/apps/miniapp
make -C projects/synth/browser browser-miniapp
npm --prefix projects/synth/browser test
openspec status --change share-portable-runtime-main-component
git diff --check
```

Expected: all commands pass; OpenSpec reports every checkbox complete only after review evidence exists.

- [ ] **Step 4: Update coverage and OpenSpec tasks**

Map `sprs-1` through `sprs-7`, modified `sru-1`, and modified `sar-10` to exact C++/JUCE/TypeScript/Playwright tests. Check OpenSpec boxes incrementally to reflect reviewed commits.

- [ ] **Step 5: Commit**

Commit message: `docs(synth): record browser shell verification and audio diagnosis`.
