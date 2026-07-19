### Spec Compliance
Sync is after `ApplyPendingPatchMessages()` and `ProcessResponses()` in the startup-load path, and it is unconditional, so it does not depend on callback registration. No-startup-patch path remains covered by the initial post-`Init()` shadow seed.

### Strengths
The regression test is real: startup load with an `audioDevice` section fires once, then a sectionless runtime patch through `ProcessBlock()`/`MessageThreadTick()` leaves callback count at 1. Final commit only changes `Engine.hpp` and `engine_tests.cpp`.

### Issues
#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)
None.

### Assessment
**Task quality:** Approved
**Reasoning:** The round-2 fix addresses the stale-shadow path directly and the test captures the reported spurious-notification regression. No tests or builds were run per the read-only instruction.