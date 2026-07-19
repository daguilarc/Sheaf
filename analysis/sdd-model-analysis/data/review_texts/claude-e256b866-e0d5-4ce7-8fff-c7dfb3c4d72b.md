I have enough to write the review.

---

## Task 2 Review: Runtime Monotonic Sample Position

### Spec Compliance

All five deliverables from the brief are present:

| Requirement | Status |
|---|---|
| `AudioBlock::startSample` field added | ✓ |
| `ComputeAllTargets()` removed from steady-state block boundary | ✓ |
| Pre-increment `fetch_add` value stored as `block.startSample` | ✓ |
| `ProcessFrame` remains post-message-drain, pre-`ProcessBlock` | ✓ |
| Engine does not call `ProcessSample` (Task 1 reviewer constraint preserved) | ✓ |

Red/green verification is documented with concrete compiler output. OpenSpec tasks held pending review per brief instructions.

### Strengths

- **Surgical change**: Engine.hpp body adds three lines and deletes one. The footprint matches the task exactly — no scope creep.
- **`does_not_compute_targets` test design**: The new test elegantly separates `SceneCenter` (updated by message drain) from `CurrentCenter` (frozen until `ProcessSample`) by asserting `lastProbeDuringBlock ≈ 0.25f` before manually calling `ProcessSample(0)` and then observing `CurrentCenter ≈ 0.55f`. This is the canonical behavioral proof that no block-boundary target compute occurred.
- **Comment fidelity**: The binding-order comment in `Engine.hpp:200-120` and the inline comment in `ProcessFrameApp::ProcessFrame` both track the new ordering precisely. No stale wording remains.
- **`lastProbeSceneCenterDuringBlock` additive field**: Adding this to `EngineTestApp` lets `engine_pump_applies_messages_before_app_block` assert _both_ that SceneCenter reflected the message and that CurrentCenter did not move — a richer invariant than a single read could express.

### Issues

#### Important

**`engine_pump_populates_ui_state_at_throttle_cadence`: cadence-fires assertion is now vacuous.**

The old test was able to distinguish "PopulateUIState fired at block 6" from "never fired" because `expectedDisplayCenter != initialDisplayCenter` after 24 samples of slew. The new assertion:

```cpp
REQUIRE_NEAR(cell.values[0].load(), initialDisplayCenter, 1e-4f);
```

passes in both cases: `CurrentCenter` is frozen at `initialDisplayCenter` (no `ProcessSample` called), so `PopulateUIState` — if it publishes `CurrentCenter` — writes that same value whether it fires at block 6 or never fires at all. The block-1 assertion (`publishedBeforeAnyBlock`) is similarly inconclusive for the same reason.

The implementation itself is correct (the `++blocksSinceUiPublish_` counter is unchanged), but the test no longer demonstrates that the throttle fires. To restore coverage: call `probe.ProcessSample(n)` enough times to advance `CurrentCenter` meaningfully before the final assertions, then check that `cell.values[0].load()` matches the advanced `CurrentCenter` value rather than `initialDisplayCenter`.

#### Minor

1. **`engine_process_sample_preserves_slew_after_engine_message_pump` is now primarily a `ProcessSample` unit test.** The test confirms the engine's message pump sets `SceneCenter`, then drives convergence entirely through `probe.ProcessSample(sample)` in a loop that never touches the engine again. The name implies slew is preserved "after the engine message pump" but the slew loop bypasses the engine entirely. Not wrong, just a slight title mismatch — consider `parameter_process_sample_slews_to_scene_center_after_engine_message_pump` or a note in the test comment.

2. **`processLiteAlpha = 1.0f` in `engine_process_block_does_not_compute_targets` is a no-op.** Since `ProcessLite` does not advance `CurrentCenter`, the alpha has no effect on the assertions (both `lastProbeDuringBlock ≈ 0.25f` and the post-`ProcessSample` check are alpha-independent). Harmless, but a reader scanning that setup line will look for its bearing on the test and not find one.

### Assessment

**Approve with minors.** The core implementation is correct: `startSample` is stamped correctly (monotonic pre-increment), `ComputeAllTargets` is cleanly excised, and all global ordering constraints hold. The new behavioral test for target-compute removal is well-constructed. The one important finding is a test coverage regression in the throttle cadence test — the implementation is fine but the test no longer proves the cadence fires, which weakens coverage of a stated global constraint. The implementer should address that before marking tasks complete.