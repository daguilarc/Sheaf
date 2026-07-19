Status: Complete.
Commit: `5ee17b7` — fix(synth-runtime): guard MIDI processor swaps and restore output reset parity
Gates: miniapp links clean (zero warnings, -Wall -Wextra -Wpedantic); `make -C projects/synth build test` = 199 PASS / 0 FAIL, no core regression from header-only Engine additions.
Concerns: none — both authorized additions implemented verbatim; panel no longer holds any raw pointer into the MIDI chain outside `MidiInHandler`'s mutex-guarded slot; Minor finding left as-is with acknowledgment comment added per instructions.