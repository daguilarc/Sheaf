# Synth Miniapp

This directory contains a small JUCE probe app for the synth parameter external
UI/message layer.

The default Makefile expects a developer-local JUCE checkout:

```text
~/JUCE
```

Build from `projects/synth` with:

```text
make miniapp
```

Run it from this worktree with:

```text
open projects/synth/miniapp/build/SynthMiniapp.app
```

Current local build/run status in this worktree: verified with `~/JUCE/modules`.
Set `JUCE_DIR=/path/to/JUCE` to build against a different local checkout.

The app is intentionally basic. It creates two demo groups, two banks, one
gesture, three scenes, and unipolar sine modulators in the `(0, 1)` range.
Bank A is two-voice with a 90-degree offset; bank B is three-voice with
three-phase offsets.
Controls send `MessageIn` values through `MessageInBus`; painting reads
`ParameterManager::UIState` atomics and converts `synth::Color` to
`juce::Colour` only in miniapp code.
