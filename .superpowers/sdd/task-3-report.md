## Summary

- Updated the mini app modulation helper to call `ParameterGroup::ProcessSample(sampleIndex)`.
- Updated `MiniAppCore::ProcessBlock` to process parameters with `block.startSample + frame` before VCO, filter, LFO, modulator updates, output writes, and scope advance.
- Added the mini app system test assertion that the default target compute interval is 16 samples.
- Updated stale comments in `MiniAppCore.hpp` and `projects/synth/Makefile` that described the old per-sample `ProcessLite` helper.

## Verification

- Initial focused run after adding the interval assertion, before the mini app migration, failed with parameter-change and patch round-trip failures because the mini app still only ran `ProcessLite()` after runtime block-level target recomputation was removed.
- Final required verification passed:
  - `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`

## Notes

- Left `openspec/changes/decouple-encoder-block-rate/tasks.md` unchanged, per instruction not to mark tasks 3.1 through 3.3 complete until after review approval.
- Did not touch the untracked `projects/synth/miniapp/` directory or its build artifacts.
