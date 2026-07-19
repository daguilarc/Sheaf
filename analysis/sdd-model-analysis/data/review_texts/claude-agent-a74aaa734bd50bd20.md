Status: complete.

- Commit: `00191d223b944b466165dbbb88ed37da85720388` — `fix(synth): poller forced-poll sequencing and exception safety`
- Test summary: `make -C projects/synth build test` green, 315 `[PASS]` / 0 `[FAIL]`, zero warnings; `poller_tests` (10 cases, incl. 2 new TDD regression tests for findings 1 & 2) run 8x back-to-back with no flakes; `make -C projects/synth miniapp` link check green.

All four reviewer findings addressed in `projects/synth/include/synth/MidiDevicePoller.hpp` and `projects/synth/src/MidiDevicePoller.cpp`, with new tests in `projects/synth/tests/poller_tests.cpp`. Full fix report appended to `.superpowers/sdd/p3-task-1-report.md` (gitignored, so not part of the commit).