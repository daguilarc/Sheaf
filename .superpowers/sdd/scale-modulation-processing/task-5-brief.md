### Task 5: Randomized, Persistence, UI, and Controller Integration

**OpenSpec coverage:** tasks 2.4, 4.5, 5.5-5.6, and modified `spm-25` as an integrated state-machine requirement.

**Files:**
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp` — manager-owned 64-gesture oracle, permutations, collection/reuse actions, failure diagnostics.
- Modify: `projects/synth/tests/portable_ui_tests.cpp` — full snapshot-to-render bit-63 path.
- Modify: `projects/synth/tests/instrument_tests.cpp` — gesture/controller integration.
- Modify: `projects/synth/tests/browser_command_buffer_tests.cpp` only if an existing draw-command expectation changes because badge text changes; do not add mask fields or versions.

**Interfaces:**
- Consumes: all Tasks 1-4 production APIs.
- Produces: deterministic reference-model coverage for stable route identity, 64-bit masks, slot collection/reuse, and semantic JSON.

- [ ] **Step 1: Extend the randomized model before its production-action wiring**

Change simulated gesture selectors and expected affecting masks to `std::uint64_t`. Store `routeSourceIndices`, inverse positions, `activeRouteCount`, live/free slot identity, and pin state in `SimParam`/`SimOracle`. Add deterministic operations for gesture indices 32/63, route activation/removal, bank open/close, reset/revert, collect, reuse under a distinct parent, and patch load.

After every action validate both models with an error payload containing seed, step, action/message, random samples consumed, stable source index, route slot, expected/actual mask, and expected/actual current/target value.

- [ ] **Step 2: Run the oracle and observe RED model/production mismatches**

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
```

Expected: the newly modeled actions fail until their message/view/collection wiring and comparison extraction are complete; failures print the deterministic seed and step.

- [ ] **Step 3: Wire all existing external operations through the extended oracle**

Drive edits only through `MessageInBus` where a message exists, including normal and modified bank selection. Preserve the production random-source consumption order by drawing exactly the same samples in the oracle. Populate UI periodically and compare connected cells' centers, spreads, switch buckets, bipolar/min/max metadata, colors, all visible modulator bits, gesture bits `0..63`, manager gesture state, scenes/blend, modifiers, and selected bank/view state.

For GC-only control-boundary operations with no message type, invoke the same public manager/bank API used by production and mirror it in the oracle; do not invent a browser or patch wire command.

- [ ] **Step 4: Finish cross-surface integration assertions**

In portable UI, pass a real `Parameter::UIState` carrying bit 63 through snapshot and renderer and assert the distinct `64` badge command. In instrument/controller tests, verify controller gesture index 63 selects/edits the same manager gesture and that bank-affecting masks remain 32-bit bank selectors. Run browser command-buffer tests only to prove rendered command output remains valid; make no serialization/layout change.

- [ ] **Step 5: Run integration tests, commit, and pass the global Claude gate**

```bash
make -C projects/synth build/parameter_modulation_tests build/portable_ui_tests build/instrument_tests build/browser_command_buffer_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/portable_ui_tests
projects/synth/build/instrument_tests
projects/synth/build/browser_command_buffer_tests
```

Expected: all four binaries exit 0 and repeated runs use the same seeds and consume identical samples. Then:

```bash
git add projects/synth/tests/parameter_modulation_tests.cpp projects/synth/tests/portable_ui_tests.cpp projects/synth/tests/instrument_tests.cpp projects/synth/tests/browser_command_buffer_tests.cpp
git commit -m "test(synth): cover sparse modulation lifecycle end to end"
```

If `browser_command_buffer_tests.cpp` is unchanged, omit it from `git add`. Run the global Sonnet gate and record both passing verdicts.

---
