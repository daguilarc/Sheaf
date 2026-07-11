# Task 2 Report: JUCE Runtime Services And Single Renderer

## Result

- Status: `DONE`
- Commit: `0e837e3a842dac77ce928ec712d46862f954a0d8`
- Commit message: `refactor(synth): render shared runtime shell in JUCE`
- Scope: OpenSpec tasks 2.1, 2.2, and 2.3.

## Implementation

- Added `JuceRuntimeMainServices<App>`, a generic JUCE host adapter satisfying
  Task 1's `RuntimeMainServices` concept and delegating to `Runtime<App>`.
  It preserves Audio device enumeration, negotiated status, selection
  dispatch, File patch operations/status, Controllers instrument edits and
  MIDI connection snapshots, runtime-configuration saves, and deadline
  sampling.
- Installed Audio status/sync and MIDI-processor rebuild hooks in the services
  constructor and cleared all three in its destructor. Controller rebuilds are
  retained as pending dirty state until a shared controller surface is
  available.
- Replaced `MainPane<App>`'s separate app, sidebar, Audio, File, and
  Controllers renderers with the required lifetime order: runtime reference,
  services adapter, `RuntimeMainComponent`, and one
  `synth_juce::PortableComponent`.
- Preserved `MainPane::Page`, `ShowPage(Page)`, and `CurrentPage()` as
  wrappers over the shared component, and made `RefreshOnTick()` call shared
  refresh before renderer refresh.
- Made `RuntimeShellSession` and `ShellApplication::MainWindow` size from
  the shared component's intrinsic bounds after runtime startup. MiniApp
  content remains 900x560 and the runtime sidebar is additive, producing
  996x560 shell content.
- Removed the separate deadline write from `ShellComponent::RepaintAll`.
  `RuntimeMainComponent::Refresh()` now obtains the JUCE deadline sample
  through services and writes the rolling maximum once per tick.
- Updated `PortableJuceBackend` to track each rendered/draw node's nearest
  `NodeKind::Root` and maintain an independent absolute-bounds auto-flow
  cursor per root. The outer composite root is discoverable as the
  `PortableComponent` itself.
- Added the documented relative focused Make target and dependency tracking
  for the shared runtime component and JUCE services header.

## TDD Evidence

### RED 1: Additive Shell And Single Renderer

After adding the shell integration assertions, the documented build command
first exposed that the Makefile only named the focused target by absolute
path:

```text
make -C projects/synth/apps/miniapp build/runtime_shell_session_tests
make: *** No rule to make target `build/runtime_shell_session_tests'. Stop.
```

After adding the minimal relative alias, the target compiled and the binary
failed for the intended missing behavior:

```text
projects/synth/apps/miniapp/build/runtime_shell_session_tests
libc++abi: terminating due to uncaught exception of type std::runtime_error:
runtime shell content width adds the shared sidebar
```

The test covers 996x560 shell bounds, exactly one portable renderer,
`runtime.main.root`, MiniApp encoder and sidebar Audio discovery, Audio/Back
page replacement, retained app-surface identity, and a generic 900-pixel-wide
interactive draw reaching x=900.

### RED 2: Nested-Root Auto-Flow

After correcting the test fixture to use the repository's flat
`synth::ui::Builder` API, the focused backend binary failed:

```text
projects/synth/apps/miniapp/build/portable_juce_backend_tests
libc++abi: terminating due to uncaught exception of type std::runtime_error:
unbounded app controls wrap within the nested 900-pixel app root
```

The final fixture uses twelve unbounded app controls inside a 900-pixel app
root and a separate sidebar root at x=900. It proves the app wraps on its own
cursor and the sidebar begins from its own translated root.

### RED 3: Composite Root Discovery

A focused follow-up required the structural composite root to resolve through
the single renderer. Before the minimal lookup change, the shell binary failed:

```text
libc++abi: terminating due to uncaught exception of type std::runtime_error:
composite root is discoverable as the shared renderer
```

### GREEN: Focused Tests

Commands:

```text
make -C projects/synth/apps/miniapp build/runtime_shell_session_tests
projects/synth/apps/miniapp/build/runtime_shell_session_tests
make -C projects/synth/apps/miniapp /Users/joyo/.codex/worktrees/d359/Sheaf/projects/synth/apps/miniapp/build/portable_juce_backend_tests
projects/synth/apps/miniapp/build/portable_juce_backend_tests
```

Fresh resume results:

- Both Make targets exited 0 and reported current artifacts.
- `runtime_shell_session_tests` exited 0 after exercising both MiniApp and
  the generic wide-draw app.
- `portable_juce_backend_tests` printed
  `PortableJuceBackendTests passed` and exited 0.

### GREEN: Full JUCE Suite And App

`make -C projects/synth/apps/miniapp test` exited 0 and ran all eight JUCE
test binaries:

- `encoder_component_geometry_tests`: passed.
- `portable_juce_backend_tests`: passed.
- `miniapp_juce_backend_parity_tests`: passed.
- `runtime_pages_juce_tests`: passed.
- `file_page_simulation_tests`: passed, seed `0xf11e2026`.
- `runtime_shell_session_tests`: passed.
- `controllers_page_juce_tests`: passed.
- `controllers_page_simulation_tests`: passed, seed `0x5eaf2026`.

`make -C projects/synth/apps/miniapp` exited 0 with
`SynthMiniapp.app` current. The earlier implementation run rebuilt the
standalone executable and copied it into the app bundle successfully.

`git diff --check` over the owned Task 2 paths exited 0.

## Changed Files

- `projects/synth/runtime/JuceRuntimeMainServices.hpp` (new)
- `projects/synth/runtime/MainPane.hpp`
- `projects/synth/runtime/Shell.hpp`
- `projects/synth/runtime/juce_build.mk`
- `projects/synth/juce/PortableJuceBackend.hpp`
- `projects/synth/juce/PortableJuceBackendTests.cpp`
- `projects/synth/juce/RuntimeShellSessionTests.cpp`
- `projects/synth/apps/miniapp/Makefile`

`projects/synth/juce/RuntimePagesJuceTests.cpp` remained unchanged.

## Self-Review

- Runtime/backend production files contain no MiniApp or other concrete-app
  branches, IDs, layout values, or special handling. The generic wide-draw
  test app uses the same portable-root contract as MiniApp.
- `MainPane` declares members in the required lifetime order. Destruction
  removes the renderer and shared component before services clears runtime
  callbacks, while the externally owned runtime remains alive.
- Audio and MIDI runtime hooks cannot call a destroyed adapter because all
  registrations are cleared with RAII. The Controllers surface pointer is
  populated only from shared refresh and is used only while the owning shared
  component is alive.
- Audio and File behavior matches the previous JUCE hosts' Runtime calls and
  status text. Controllers callbacks use engine snapshots/edits and MIDI
  connection state, with enumeration, pending dirty application, and
  `ControllersPageSurface::RefreshOnTick` on every UI tick.
- Navigation is owned by `RuntimeMainComponent`; the JUCE shell no longer
  duplicates sidebar/page selection logic. The public legacy page wrappers
  map one-to-one to shared page values.
- `DeadlineSamplePct()` appears only in the JUCE services adapter across the
  new MainPane/Shell path, so shared refresh samples and writes once.
- Auto-flow root ownership is established during tree traversal and explicit
  bounds remain absolute. Controls remain direct children of one
  `PortableComponent`.
- Staging is explicit to the eight changed Task 2 code paths. Existing dirty
  browser files and `.superpowers/sdd/task-1-report.md` are excluded.

## Concerns

- JUCE emits `CoreMIDI error: 580 - 10000003` in this environment when no
  usable MIDI service/device is available. It appeared in both RED and GREEN
  runs; all affected binaries continued and exited 0 on GREEN.
- No external Claude review was run during completion, per controller
  ownership of xagent reviews.
- This report is updated after the implementation commit so it can record the
  final hash; it is intentionally not part of the Task 2 code commit.

## Review Fix: Synchronous JUCE Navigation

- Commit: `981b3ec0ace086747829f70f23093676bd551e36`
- Commit message: `fix(synth): refresh shared JUCE shell synchronously`
- `MainPane` now uses `RuntimeMainComponent::SetActionHandler` as the generic
  post-dispatch notification and refreshes its one `PortableComponent` before
  a JUCE click callback returns. Its destructor clears the action and focus
  callbacks before renderer/member teardown.
- `JuceRuntimeMainServices` no longer retains a
  `ControllersPageSurface*`. MIDI rebuilds and controller commits retain only
  dirty state, which the next message-thread refresh applies to the supplied
  live surface; this eliminates the prior dangling-pointer interval.
- The audio sync hook remains RAII-managed as required by Task 2. It now marks
  device-option enumeration pending, and `RefreshAudio` consumes that state on
  the next UI tick. Audio status and negotiated device text intentionally do
  not refresh controls from runtime/device callbacks: the shared renderer is a
  JUCE message-thread object, and the pre-existing safe contract is periodic
  message-thread refresh rather than cross-thread synchronous widget updates.

### RED

After removing the test's manual `RefreshOnTick()` calls:

```text
CoreMIDI error: 580 - 10000003
libc++abi: terminating due to uncaught exception of type std::runtime_error:
audio click synchronously replaces app controls in the shared renderer
EXIT=134
```

This failed immediately after `audioButton->onClick()`, proving the existing
test had masked the one-tick navigation lag.

### GREEN

- Focused `runtime_shell_session_tests`: exited 0; Audio and Back both rebuild
  the shared renderer without a manual timer refresh.
- Focused `portable_juce_backend_tests`: exited 0. The expanded regression
  contains an app-root Draw plus trailing unbounded controls and a sibling
  sidebar-root Draw, proving draw-node filtering is per nearest root. This was
  a characterization test and passed before production edits because the
  reviewed filtering implementation was already correct.
- `make -s -C projects/synth/apps/miniapp test`: exited 0; all eight JUCE test
  binaries passed, including simulation seeds `0xf11e2026` and `0x5eaf2026`.
- `make -s -C projects/synth/apps/miniapp`: exited 0 and built the standalone
  app bundle.
- `git diff --check`: exited 0 before commit.
- The known no-device `CoreMIDI error: 580 - 10000003` remained non-fatal; no
  MIDI/CoreMIDI code was changed.
