Status: Done, all three findings fixed.

Commit: `4c3f6cc` — "fix(synth-runtime): make shell shutdown and startup lifecycle safe"

Gates: miniapp links clean with zero warnings (`-Wall -Wextra -Wpedantic`); `make -C projects/synth build test` — 199/199 tests pass, exit 0.

Concerns: None blocking. Report appended to `.superpowers/sdd/p3-task-4-report.md` (gitignored path, not part of the commit).