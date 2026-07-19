✅ Spec compliant

I found no Task 1 spec compliance issues in commit `485ed5247ec905fe57f1168a01f0214e843a9c53`.

Key checks:
- Realtime modes and fixed route are present in [MessageIn.hpp](/Users/joyo/.codex/worktrees/37b8e1a2-98d5-4adf-9044-b17fcc6ce7a8/theallelectricsmartgrid/private/src/MessageIn.hpp:23).
- `BasicMidi` recognizes clock/start/stop realtime statuses in [BasicMidi.hpp](/Users/joyo/.codex/worktrees/37b8e1a2-98d5-4adf-9044-b17fcc6ce7a8/theallelectricsmartgrid/private/src/BasicMidi.hpp:146).
- `MidiToMessageIn` maps realtime to fixed-route transport messages preserving timestamps in [MidiToMessageIn.hpp](/Users/joyo/.codex/worktrees/37b8e1a2-98d5-4adf-9044-b17fcc6ce7a8/theallelectricsmartgrid/private/src/MidiToMessageIn.hpp:27).
- `MidiInputHandler` accepts only supported one-byte realtime messages and adds fixed latency in [MidiHandlers.hpp](/Users/joyo/.codex/worktrees/37b8e1a2-98d5-4adf-9044-b17fcc6ce7a8/theallelectricsmartgrid/JUCE/SmartGridOne/Source/MidiHandlers.hpp:55).
- Realtime route dispatch bypasses grid/encoder handling in both controller variants.
- `MessageInBus` remains timestamp-gated and FIFO-drains visible messages.

Verification run:
- `cmake --build private/test/build` passed.
- `private/test/build/smartgrid_tests --test-case="midi realtime:*"` passed: 3 test cases, 22 assertions.