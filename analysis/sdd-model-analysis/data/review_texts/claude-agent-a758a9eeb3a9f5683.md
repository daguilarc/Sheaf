Status: Done. Both findings fixed, gates green.

Commit: `b75c44c` — `fix(synth): make miniapp output-effect tests phase-drift-immune via twin-rig comparison`

Test summary: `make -C projects/synth test` clean rebuild, exit 0, all test binaries pass including rewritten `miniapp_rig_tune_turn_changes_output` and `miniapp_rig_shape_turn_changes_output` (twin-rig A/B determinism comparison), zero warnings.

Concerns: none — twin-rig baseline sanity check confirmed bit-identical pre-turn windows before asserting post-turn material difference, so both tests are now phase-drift-immune as required.