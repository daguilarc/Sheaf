Perfect! All gates pass. Here's the summary:

**Status**: Fixed. Commit 96da918 "fix(synth-runtime): apply startup patch input device at open" applied startup input device symmetrically to output in `Runtime::Start()`'s device-open step, gated by `config.numAudioInputs > 0`, mirroring output handling exactly.

**Commit SHA + subject**: 96da918 fix(synth-runtime): apply startup patch input device at open

**Gate summary**: `make -C projects/synth test` 229/229 PASS, zero warnings; `make -C projects/synth miniapp` links clean, zero warnings.

**Concerns**: Input coverage is compile-time only (no in-repo app requests inputs) — accepted per brief.