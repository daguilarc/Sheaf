# Task 3: MiniApp Standard Modulator Adoption Report

## Status

Implemented MiniApp adoption of `StandardModulators<2>` for the fifteen-source MIN-16 topology. OpenSpec task boxes were intentionally not modified pending review.

## RED evidence

After updating the focused tests first, ran:

```text
make -C projects/synth build/miniapp_system_tests build/portable_ui_tests build/browser_command_buffer_tests
```

Expected failure: exit 2 while compiling `miniapp_system_tests.cpp`. The first diagnostic was that `MiniAppCore` had no `StandardModulatorsInstance`; subsequent diagnostics showed the old direct generic-source API did not provide `RandomInput`, `RandomProcessor`, `RandomVisualizer`, or stable standard output rows. This demonstrated the new tests required bundle adoption rather than accepting the old six-source implementation.

## GREEN evidence

Ran the exact focused build and binaries:

```text
make -C projects/synth build/miniapp_system_tests build/portable_ui_tests build/browser_command_buffer_tests
projects/synth/build/miniapp_system_tests
projects/synth/build/portable_ui_tests
projects/synth/build/browser_command_buffer_tests
```

Result: all commands exited 0. MiniApp reported every focused case PASS; portable UI and browser command-buffer binaries exited cleanly with no output or warnings.

## Changed files

- `projects/synth/apps/miniapp/MiniAppCore.hpp`
- `projects/synth/tests/miniapp_system_tests.cpp`
- `projects/synth/tests/portable_ui_tests.cpp`
- `projects/synth/tests/browser_command_buffer_tests.cpp`
- `projects/synth/Makefile`
- `.superpowers/sdd/task-3-standard-modulators-report.md`

## Self-review

- The group now has 15 modulators, 192 initial parameter slots, and physical IDs 10 through 25, preserving the existing MiniApp physical-ID convention.
- One address-stable `StandardModulators<2>` is constructed after the group, registered at `0..3`, `11`, and `14`, prepared at host rate, processed immediately before `UpdateModValues()`, and published after each block.
- Direct random/noise/constant processors, input/output adapters, registration helpers, and generic visualizers were removed. The main-screen compatibility processor accessor resolves only standard random source 0.
- VCO direct/swapped and LFO sources moved to `4/5/6`; their three distinct retained scope visualizers moved with them. Gaps remain disconnected.
- Tests cover exact metadata, pointer-backed standard rows, all fifteen depth cells plus return, no old-index translation, three-panel random-0 rendering, standard and scope underlays, hidden/bank transitions, and JUCE-free portable/browser command parity.
- No Braid4, documentation, OpenSpec checkbox, or legacy `projects/synth/miniapp/` changes were made.

## Concerns

The portable MiniApp screen intentionally retains its existing seven-encoder visual grid and three-panel layout; the complete fifteen-cell view plus return is routed through all sixteen physical positions and verified in bank/UI state. No blocking concern remains.
