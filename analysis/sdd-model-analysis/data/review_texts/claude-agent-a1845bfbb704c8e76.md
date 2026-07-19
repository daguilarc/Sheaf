Status: Done, all gates green.

Commit: `df96fdc7173f8ec408e22ac2f465fa6bee61e64b` — "fix(synth): allocation-free audio-state change detection and race-free flag consume"

Test summary: clean rebuild of `make -C projects/synth test` — all suites pass (23/23 engine_tests incl. extended fires-exactly-once test, rig_tests, miniapp_system_tests, logger tests); `make -C apps/miniapp` links cleanly; zero warnings/errors on clean rebuild.

MIDI flag: yes, `midiRebuildPending_` had the identical load-then-store drop race — fixed with the same `exchange(false, acq_rel)` pattern in this commit.

Concerns: none.