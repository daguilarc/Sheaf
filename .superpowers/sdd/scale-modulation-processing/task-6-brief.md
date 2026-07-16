### Task 6: Braid4 Structural/Deadline Regression and Coverage Closure

**OpenSpec coverage:** tasks 6.1-6.4; coverage rows for `spm-20`, `spm-72`, `spm-73`, `spm-74`, and modified `spm-25`.

**Files:**
- Modify: `projects/synth/tests/braid4_deadline_tests.cpp` — baseline/materialized-neutral/sparse-active/64-inactive cases at two host rates.
- Modify: `projects/synth/tests/braid4_system_tests.cpp` — authoritative work-count assertions.
- Modify: `projects/synth/docs/coverage.md` — requirements/scenarios and timing limitations.

**Interfaces:**
- Consumes: `ParameterProcessingObserver` counters from Task 1 and sparse visit counts from Tasks 2-3.
- Produces: deterministic complexity guards plus secondary average/p99 timing evidence.

- [ ] **Step 1: Add RED Braid4 scenario accounting**

Create four rig configurations: baseline; all available local depth nodes materialized but neutral; a sparse active set; and 64 configured but inactive gestures. For the 64-gesture case, call `context.parameterManager->SetGestureCount(64)` before `Engine::Initialize` invokes `Braid4Core::Init` and creates any groups; do not add a shipping Braid4 mode. For the same processed internal-subframe count, assert:

```cpp
REQUIRE_TRUE(neutral.topLevelProcessLiteCalls == baseline.topLevelProcessLiteCalls);
REQUIRE_TRUE(inactive64.activeGestureVisits == 0);
REQUIRE_TRUE(sparse.activeRouteVisits > 0);
REQUIRE_TRUE(sparse.activeRouteVisits < denseConfiguredRouteVisits);
```

Run measured deadline cases at 48 kHz host/192 kHz internal and 96 kHz host/384 kHz internal. Record average and p99 for baseline and sparse-active, retaining generous platform-appropriate ceilings already used by the test instead of asserting a fragile speedup ratio.

- [ ] **Step 2: Run the Braid4 tests**

```bash
make -C projects/synth build/braid4_system_tests build/braid4_deadline_tests
projects/synth/build/braid4_system_tests
projects/synth/build/braid4_deadline_tests
```

Expected before final fixture wiring: structural scenario assertions fail or do not compile; after wiring, both binaries exit 0 and print timing lines for both rates.

- [ ] **Step 3: Update requirement coverage precisely**

Add a new `spm-20` row, update `spm-25` for 64-bit randomized masks, and add `spm-72`, `spm-73`, and `spm-74` rows. Each row must name the exact test cases introduced by Tasks 1-6. State that deterministic visit counters are the complexity contract and deadline measurements are secondary, platform-sensitive smoke evidence.

- [ ] **Step 4: Run the complete synth verification matrix**

```bash
make synth-test
openspec validate scale-modulation-processing --strict
```

Expected: every synth test target, including parameter modulation, modules, persistence/engine, portable UI, browser command buffer, MIDI/controller, Braid4 system, Braid4 deadline, and randomized oracles, exits 0; OpenSpec reports the change valid. No browser format/version diff should exist.

- [ ] **Step 5: Commit and pass the final task gate**

```bash
git add projects/synth/tests/braid4_deadline_tests.cpp projects/synth/tests/braid4_system_tests.cpp projects/synth/docs/coverage.md
git commit -m "test(synth): guard sparse modulation scaling"
```

Run the global Sonnet gate and record both passing verdicts.

- [ ] **Step 6: Run final cross-task Opus review and synchronize OpenSpec tasks**

Generate one exact review package from the pre-Task-1 base through `HEAD`. Run xagent Claude Opus with the proposal, design, delta spec, implementation plan, test results, and review package. Require separate final `SPEC COMPLIANCE` and `CODE QUALITY` verdicts and explicit audit of audio equivalence, source identity, settling tails, 64-bit boundaries, pointer lifetime, capacity accounting, and audio-thread safety. Fix/re-run/re-review any Critical/Important finding.

Every mapped checkbox must already have been synchronized after its owning task review. Only after the final Opus verdicts and Step 4 verification pass, confirm no checkbox was closed without its evidence, re-run strict validation, and commit any final evidence-only correction to the artifact:

```bash
git add openspec/changes/scale-modulation-processing/tasks.md
git commit -m "docs(openspec): complete sparse modulation processing change"
```
