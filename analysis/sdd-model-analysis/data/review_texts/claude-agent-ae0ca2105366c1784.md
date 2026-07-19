Status: Done. Commit `3eaae7b` `fix(synth): document caller-arena lifetime contract and test consume-before-reuse`.

Tests: `projects/synth/build/parameter_modulation_tests` — all pass including `apply_patch_message_reuses_caller_arena` (now consume-before-reuse with `patchName` A/B assertions) and `apply_patch_message_reports_exhaustion_without_growing_caller_arena`; full `make -C projects/synth test` — 174 PASS, 0 FAIL, 0 warnings.

Concerns: none — this closes the exact gap the original implementer had flagged in their own "Concerns" section of the p2-task-2 report.