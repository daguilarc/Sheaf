Status: Done, all gates green.

Commit: `812419a306e66851b2a5c9fb486f20f9dbbcfe0c` — `fix(synth): lock-guarded host audio-device writes with shadow sync`

Test summary: `make -C projects/synth test` — 229/229 pass, zero warnings, clean rebuild; `make -C projects/synth miniapp` links clean; `make -C projects/synth/apps/miniapp test` (JUCE-linked geometry test, compiles Runtime.hpp/MidiPanel.hpp) passes clean.

Concerns:
- New input-device combo wiring (finding #3) compiles and behaves symmetrically with output, but no app in-repo sets `numAudioInputs > 0`, so it has no runtime/test coverage beyond compilation.
- Had to drop `AudioDeviceSetup.useDefaultInputDevice` (doesn't exist in JUCE) from my first pass — fixed by relying on `setAudioDeviceSetup`'s "both names empty deletes device" trap being unreachable since `outputDeviceName` is always carried forward.
- Report appended to `.superpowers/sdd/p4-task-3-report.md` (file is gitignored, not part of the commit — confirmed intentional via `.superpowers/sdd/.gitignore`).