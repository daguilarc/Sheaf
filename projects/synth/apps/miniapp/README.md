# Synth Miniapp

This directory contains the real SynthMiniapp application: a small JUCE probe
app for the synth parameter/modulation external UI/message layer, built on
top of the shared application runtime (`projects/synth/runtime/`) instead of
its own bespoke JUCE shell.

## Layout

- `MiniAppCore.hpp` — JUCE-free application core (`synth_miniapp::MiniAppCore`).
  Builds the parameter/bank/modulation/scope topology and runs the per-sample
  DSP. Satisfies `synth::SynthApplicationCore`, so it also runs headless
  under `synth_rig::SynthRig` (see `tests/miniapp_system_tests.cpp`).
- `DemoModulation.hpp` — small pure-math helpers (LFO phase step, unipolar
  sine modulator, etc.) used by `MiniAppCore`. Covered by test cases in the
  JUCE-free `module_tests` binary (`projects/synth/tests/module_tests.cpp`,
  built with `-Iapps/miniapp`).
- `MiniApp.hpp` — the JUCE-facing UI wrapper (`synth_miniapp::MiniApp`,
  extends `MiniAppCore`). Owns the app's bespoke widgets: four
  `synth_juce::EncoderComponent`s, the VCO waveform scope, page/bank
  buttons, the gesture select button + value slider, three scene buttons +
  blend slider, reset/random/random-modifier latches, and start/stop
  buttons. Satisfies `synth::SynthApplication` (adds `UIComponent()`).
- `Main.cpp` — `SYNTH_RUNTIME_MAIN(synth_miniapp::MiniApp)`.

## Runtime-owned chrome

This app does **not** provide patch load/save buttons or MIDI device
selection UI. Those are owned by the runtime shell:

- Patch commands (New/Save/Save As/Load/Revert), the current-patch-name
  label, and the patch status label come from `synth_runtime::ShellComponent`
  (`projects/synth/runtime/Shell.hpp`).
- MIDI device combo boxes, open/close buttons, and the MIDI status label
  come from `synth_runtime::MidiPanel` (`projects/synth/runtime/MidiPanel.hpp`).

The patch-name label shows the current patch directory's name (or
"(no patch)" when none is current), read fresh from
`Runtime::GetEngine().Patches().CurrentPatchDirectory()` on every repaint
tick — never cached in the shell. The Save button checks the same state
before dispatching: with no current patch it opens the Save As chooser
directly instead of sending a `SavePatch()` that would only come back
`NeedsSaveAsPath`.

`MiniApp::UIComponent()` only returns this app's own widget tree; the shell
hosts it alongside the patch row and MIDI panel.

## Logging

Patch command results are logged by the runtime itself
(`synth_runtime::Runtime::LogPatchCommand`, INFO-level, via
`synth::AsyncLogQueue`), not by this app. There is no app-side `std::ofstream`
patch log — the old miniapp's `appendPatchLog`/`patchLogPath`/
`logPatchCommand` functions were not ported.

Log files are written under `MiniAppCore::Config().logsRoot`, which defaults
to `$TMPDIR/sheaf-synth-miniapp-logs` (override for tests via
`MiniAppCore::testLogsRoot`).

## Patch root

Patches are written under `MiniAppCore::Config().patchesRoot`, which defaults
to `$TMPDIR/sheaf-synth-miniapp-patches` (override for tests via
`MiniAppCore::testPatchesRoot`). The runtime shell's Save As / Load file
choosers are rooted there (`Runtime::GetEngine().Config().patchesRoot`).

## Build

Requires a local JUCE checkout. The Makefile expects it at `~/JUCE` by
default; override with `JUCE_DIR=/path/to/JUCE` if yours lives elsewhere.

From `projects/synth`:

```text
make -C apps/miniapp
```

or, equivalently, via the root Makefile's `apps` target:

```text
make -C projects/synth apps
```

The `miniapp` target at the repo's `projects/synth/Makefile` level delegates
here too:

```text
make -C projects/synth miniapp
```

## Run

```text
open projects/synth/apps/miniapp/build/SynthMiniapp.app
```

## What this app does

It creates one parameter group with two demo pages (VCO, LFO), two banks
(VCO bank mapped to the dual-VCO module's parameters, LFO bank mapped to the
LFO speed parameter), one bank slot with four physical encoders, one gesture,
and three scenes with unipolar sine modulators driving the LFO sources.
Encoders send `MessageIn` values through `context->uiBus`; painting reads
`ParameterManager::UIState` atomics off `context->uiState` and converts
`synth::Color` to `juce::Colour` only in this app's code (`MiniApp.hpp`).
Selecting the VCO/LFO bank buttons pushes a `SelectParamBank` message onto
`context->uiBus`; `MiniAppCore::ProcessBlock` keeps the active parameter page
in sync with whichever bank ends up selected, once per audio block.
