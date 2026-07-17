# Absolute Encoder Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an absolute MIDI encoder mode whose raw 7-bit position sets the visible parameter's post-gesture, post-scene-blend raw center exactly, while preserving the relative modes and the existing Controllers edit-session behavior.

**Architecture:** Extend the encoder config and input decoder with `EncoderMode::Absolute`, route a new `ParamSetAbsolute` message alongside `ParamIncDec`, and implement `Parameter::HandleSetAbsolute` as a post-arming convex-coefficient reconstruction followed by a box-constrained minimum-change projection. Keep the mathematical helper JUCE-free and independently testable; integrate the Controllers choice through the existing open-section presentation rather than a second edit path.

**Tech Stack:** C++20, the synth library's in-file test registries, Make, OpenSpec, JSON helpers in `synth/Json.hpp`.

## Global Constraints

- Treat `openspec/changes/add-absolute-encoder-mode/{proposal.md,design.md,specs/**,tasks.md}` as normative. In particular, the mathematical proof and `1e-5` raw-center tolerance are acceptance criteria.
- Work in the existing harness-managed detached worktree. Do not create a nested worktree and do not touch the user's untracked `projects/synth/miniapp/` directory.
- Use strict TDD for every behavior change: capture the named RED test/build failure before production edits, then capture the corresponding GREEN result in the task report.
- Preserve `HandleIncDec` behavior byte-for-byte behaviorally, including its swallowed first relative turn when arming.
- Absolute edits arm first, rebuild coefficients after arming, and apply the target on that same message. Never assume arming preserves the pre-solve value.
- Exactness means `ComputeRawCenter(scene)` before `targetCenterAlpha` slew, not the result after one ordinary smoothed `Compute()` call.
- Use double intermediates in the projection, float storage at the boundary, aggregate coefficients for aliased storage, clamp all writes to the parameter range, and verify error at most `1e-5`. The routed handler must use a fixed-capacity 130-location stack workspace, perform no dynamic allocation, and leave all touched state unchanged when an internal invariant rejects the edit.
- New profile JSON writes only `mode`; loading accepts `relativeMode` only when `mode` is absent, and `mode` wins when both exist.
- `turnStep` stays stored and editable but is ignored by absolute input.
- Use the current `rework-controllers-block-editing` open-section presentation as the only Controllers edit path. Do not re-coalesce a session after accepted edits or rebuilds.
- Commit only task-scoped files. Do not commit the OpenSpec proposal or this plan from an implementation task unless the task explicitly updates its corresponding checklist/coverage files.
- After implementation, update OpenSpec checkboxes only for work demonstrated by tests and accepted by both spec-compliance and code-quality review.

---

### Task 1: Establish the encoder-mode contract and compatible persistence

**OpenSpec mapping:** 1.1, 1.2, 1.3

**Files:**

- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/include/synth/MidiConfigViewModel.hpp`
- Modify: `projects/synth/src/MidiConfigViewModel.cpp`
- Modify: repository consumers returned by `rg -l 'EncoderRelativeMode|relativeMode' projects/synth --glob '!miniapp/**'`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`
- Test: `projects/synth/tests/viewmodel_tests.cpp`

- [ ] Record the already-green dependency baseline in the task report: `make -C projects/synth build/parameter_modulation_tests build/viewmodel_tests build/blocks_tests build/controllers_page_ui_tests`, followed by all four binaries.
- [ ] Add contract tests/static assertions for declaration order `Signed7Bit == 0`, `DirectionOnly == 1`, `Absolute == 2`, default relative behavior, and the renamed `EncoderMidiInConfig::mode` field.
- [ ] Add JSON tests proving absolute round-trip, new `mode` output, legacy `relativeMode` fallback, new-field authority when both keys exist, and legacy-load/new-save migration.
- [ ] Run RED: `make -C projects/synth build/parameter_modulation_tests build/viewmodel_tests`. Expect compilation or new assertions to fail because `EncoderMode`, `mode`, and absolute persistence do not exist.
- [ ] Rename the public enum/field and all repository consumers atomically:

```cpp
enum class EncoderMode {
    Signed7Bit,
    DirectionOnly,
    Absolute,
};

struct EncoderMidiInConfig {
    EncoderMode mode = EncoderMode::Signed7Bit;
    float turnStep = 1.0f / 128.0f;
    // mappings unchanged
};
```

- [ ] Implement `ToJSON`/`FromJSON` for all three values. Serialize config with `mode`; parse `mode` first and parse legacy `relativeMode` only if the new key is absent. Invalid authoritative `mode` must fail rather than fall back.
- [ ] Rename catalog/presentation identifiers to encoder-mode terminology where they expose the old contract. Keep existing relative presets on `Signed7Bit`; defer absolute decoder behavior and full UI semantics to Tasks 4 and 5.
- [ ] Run GREEN: `make -C projects/synth build/parameter_modulation_tests build/viewmodel_tests build/blocks_tests build/controllers_page_ui_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/viewmodel_tests && projects/synth/build/blocks_tests && projects/synth/build/controllers_page_ui_tests`. Expect exit 0.
- [ ] Confirm `rg 'EncoderRelativeMode|\.relativeMode|"relativeMode"' projects/synth --glob '!miniapp/**'` finds only deliberate legacy-JSON fixtures/parser compatibility references.
- [ ] Commit: `feat(synth): add encoder mode contract and migration`

### Task 2: Implement and prove exact absolute parameter editing

**OpenSpec mapping:** 2.1, 2.2, 2.3, 2.4, 2.5

**Files:**

- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`

- [ ] Add JUCE-free helper tests that independently reconstruct the convex coefficients for endpoint and aliased scenes, intermediate blends, no gestures, partial/multiple weights, and scene-specific gesture activity. The test oracle must implement the equations from `design.md`, not call the production builder to calculate expected values.
- [ ] Add pure projection tests for no-op, both directions, unipolar/bipolar ranges, both saturation directions, endpoints, aliased-coefficient aggregation, finite termination, hand-calculated minimum-change cases, range safety, and effective error at most `1e-5`.
- [ ] Add `Parameter::HandleSetAbsolute` behavior tests: endpoint/mid-blend exactness, selected inactive same-call arming, the explicit reweighting counterexample from the proof, active deselected gestures, saturation redistribution, aliased endpoints, bipolar mapping, normalized-input clamping, non-finite rejection/no mutation, and unrelated-storage preservation.
- [ ] Run RED: `make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests`. Expect compilation/assertion failure because the helpers and handler do not exist.
- [ ] Introduce a small `synth::detail` JUCE-free contract for distinct latent contributors and projection. A suitable shape is:

```cpp
namespace detail {
struct AbsoluteEditLocation {
    float* storage = nullptr;
    double coefficient = 0.0;
};

bool ProjectAbsoluteTarget(std::span<AbsoluteEditLocation> locations,
                           double minimum,
                           double maximum,
                           double target);
}  // namespace detail
```

The implementation may refine names/types, but tests must be able to exercise the pure projection without constructing a full manager. Enforce finite bounds/target/storage, positive coefficients, a unit coefficient sum within a tight double tolerance, distinct non-null storage after aggregation, and bounded output. The production route must use a fixed workspace with capacity `2 + 2 * 64 = 130`; a vector-returning adapter may remain only as a pure-test convenience and must not be called by `Parameter::HandleSetAbsolute`.
- [ ] Build contributors from the post-arming topology using scene coefficients `1-b,b` and component coefficients `p0=sum(w(1-w))/W`, `pj=w_j^2/W` (or `p0=1` when `W=0`). Aggregate by storage address before solving and omit zero coefficients.
- [ ] Implement the active-set solve `z_i=clamp(x_i+lambda*a_i)`. Fix every contributor that crosses the approached bound, recompute over the free set, and terminate in at most the contributor count. Handle exact endpoint targets explicitly if useful.
- [ ] Implement `Parameter::HandleSetAbsolute`: preflight the scene, storage topology, finite/range state, and relevant gesture weights; clamp and map the normalized input; snapshot touched gesture state; arm without the relative early return; rebuild contributors into the fixed workspace; stage and validate the rounded weighted result within `1e-5`; commit only after every check succeeds; and make any rejected edit a mutation-free no-op. Verify production `ComputeRawCenter(scene)` within `1e-5` before slew in focused and property tests.
- [ ] Keep `ComputeRawCenter` private if possible; tests may establish raw-center agreement via a narrowly scoped test seam or `Compute` with `targetCenterAlpha=1`, but must explicitly distinguish this from smoothed production behavior.
- [ ] Run GREEN twice to catch deterministic/property instability: `make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests`. Expect exit 0 both times.
- [ ] Commit: `feat(synth): add exact absolute parameter projection`

### Task 3: Add absolute message serialization and visible-cell routing

**OpenSpec mapping:** 3.1, 3.2

**Files:**

- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/include/synth/MidiConfigBlocks.hpp`
- Modify: `projects/synth/src/MidiConfigBlocks.cpp`
- Modify: `projects/synth/include/synth/MidiConfigViewModel.hpp`
- Modify: `projects/synth/src/MidiConfigViewModel.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`
- Test: `projects/synth/tests/blocks_tests.cpp`
- Test: `projects/synth/tests/viewmodel_tests.cpp`

- [ ] Add tests for `MessageIn::ParamSetAbsolute(timestamp, slotIx, position, normalizedValue)` construction and JSON round-trip, including exact name/payload and preservation in controller system associations.
- [ ] Add routing tests for the selected bank, physical encoder and slot position, visible modulation-depth parameter rather than hidden parent, owning manager scene, every modifier gate, absent slot, out-of-range position, disconnected cell, and empty cell.
- [ ] Run RED: `make -C projects/synth build/parameter_modulation_tests build/blocks_tests build/viewmodel_tests`. Expect compile/assertion failure because the message type and routing APIs do not exist.
- [ ] Add `ParamSetAbsolute` adjacent to `ParamIncDec` in `MessageIn::Type`, its static constructor, string/JSON payload handling, sort keys/catalog/exhaustive switches, and update declaration-order comments/tests whose numeric assumptions shift.
- [ ] Add `HandleSetAbsolute` in parallel through `ParameterManager`, `BankSlot`, and `Bank`; the selected cell's currently visible `Parameter` receives the owning manager's scene and normalized target.
- [ ] In `MessageInBus::Apply`, dispatch only with no effective modifier, matching the `ParamIncDec` gate. Preserve no-op lookup boundaries.
- [ ] Run GREEN: `make -C projects/synth build/parameter_modulation_tests build/blocks_tests build/viewmodel_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/blocks_tests && projects/synth/build/viewmodel_tests`. Expect exit 0.
- [ ] Commit: `feat(synth): route absolute parameter messages`

### Task 4: Decode absolute MIDI CC positions without relative regressions

**OpenSpec mapping:** 4.1, 4.2, 4.3

**Files:**

- Modify: `projects/synth/src/MidiController.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`
- Test: `projects/synth/tests/rig_tests.cpp`
- Test: `projects/synth/tests/miniapp_system_tests.cpp`
- Test: `projects/synth/tests/braid4_system_tests.cpp`

- [ ] Add MIDI processor tests showing raw CC `0`, `64`, and `127` in absolute mode emit `ParamSetAbsolute` values `0`, `64.0f/127.0f`, and `1`, with the generated timestamp and mapped slot/position. Repeat with two `turnStep` values to prove independence.
- [ ] Extend mapped/unmapped/thru tests so absolute mapped turns are consumed exactly as relative mapped turns, while push mappings and zero-value push behavior remain unchanged.
- [ ] Run RED: `make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests`. Expect new absolute decoder assertions to fail.
- [ ] Branch turn decoding on `config_.mode`: preserve the existing signed and direction-only functions/branches unchanged; for absolute mode push `ParamSetAbsolute(NextTimestamp(), mapping.slotIx, mapping.position, float(raw)/127.0f)` and never read/apply `turnStep`.
- [ ] Run GREEN focused coverage: `make -C projects/synth build/parameter_modulation_tests build/rig_tests build/miniapp_system_tests build/braid4_system_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/rig_tests && projects/synth/build/miniapp_system_tests && projects/synth/build/braid4_system_tests`. Expect exit 0, including existing default Twister/WRLD.Bldr relative tests.
- [ ] Commit: `feat(synth): decode absolute encoder positions`

### Task 5: Integrate absolute mode into the existing Controllers edit session

**OpenSpec mapping:** 5.1, 5.2

**Files:**

- Modify: `projects/synth/include/synth/MidiConfigViewModel.hpp`
- Modify: `projects/synth/src/MidiConfigViewModel.cpp`
- Modify: `projects/synth/include/synth/ControllersPageUI.hpp` only if label/help rendering needs a source change
- Test: `projects/synth/tests/viewmodel_tests.cpp`
- Test: `projects/synth/tests/controllers_page_ui_tests.cpp`
- Test: `projects/synth/tests/portable_ui_tests.cpp` if portable field rendering is affected

- [ ] Add tests for the declaration-order three-entry `EncoderModeCatalog`, `Absolute` selection/index round-trip, non-deletable mode row, retained `turnStep`, a relative-only label/help cue, open-session identity/order across commit and `Rebuild`, persisted config, and live processor reconstruction from the committed instrument config.
- [ ] Run RED: `make -C projects/synth build/viewmodel_tests build/controllers_page_ui_tests build/portable_ui_tests && projects/synth/build/viewmodel_tests && projects/synth/build/controllers_page_ui_tests && projects/synth/build/portable_ui_tests`. Expect new catalog/session assertions to fail.
- [ ] Extend the existing `detail::EncoderModeRow`, section coalescing, `RowFieldValue`, `ApplyMappingEdit`, candidate flush, labels, and catalog to all three enum values. Use checked declaration-order conversion; reject non-integral/out-of-range catalog indices without mutating output.
- [ ] Keep the mode and step rows non-deletable. Keep `turnStep` in the session/config for every mode and label it as affecting relative modes; do not hide, reset, or overwrite it in absolute mode.
- [ ] Demonstrate that a committed absolute selection rebuilds `EncoderMidiInProcessor` from the same persisted config while the open presentation row remains in place and is not re-coalesced.
- [ ] Run GREEN: `make -C projects/synth build/viewmodel_tests build/controllers_page_ui_tests build/portable_ui_tests build/parameter_modulation_tests && projects/synth/build/viewmodel_tests && projects/synth/build/controllers_page_ui_tests && projects/synth/build/portable_ui_tests && projects/synth/build/parameter_modulation_tests`. Expect exit 0.
- [ ] Commit: `feat(synth): edit absolute encoder mode in controllers`

### Task 6: Add the independent randomized invariant and complete verification

**OpenSpec mapping:** 6.1, 6.2, 6.3

**Files:**

- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
- Modify: `projects/synth/docs/coverage.md`
- Modify: `openspec/changes/add-absolute-encoder-mode/tasks.md`

- [ ] Add a deterministic seeded property test whose oracle independently calculates post-arming coefficients from randomized valid scene blends, centers, gesture masks, effective weights, values, ranges, and normalized targets. Include forced endpoint, alias, zero/one weight, and saturation cases rather than relying on chance.
- [ ] For every case, assert same-message arming, all changed latent values in range, unrelated inactive storage bitwise unchanged where appropriate, production `ComputeRawCenter(scene)` before slew within `1e-5`, and deterministic completion. The oracle must not reuse the production projection or coefficient-builder output for expected effective values.
- [ ] Run RED first by making the new invariant exercise at least one not-yet-covered topology and capture its failure before any required production correction. If Tasks 1–5 already satisfy it on first run, document that the new test was RED at compile time before its test seam/helper was exposed; do not introduce a synthetic product defect.
- [ ] Run GREEN twice: `make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests`. Expect exit 0 both times.
- [ ] Update `projects/synth/docs/coverage.md` for `spm-31`, `spm-52`, `spm-76`, `spm-77`, and `sru-26`, naming the exact deterministic tests and the independent oracle.
- [ ] Run UI boundary/static check: `make -C projects/synth check-ui-boundary`. Expect exit 0.
- [ ] Run the complete synth suite: `make -C projects/synth test`. Expect exit 0.
- [ ] Run `openspec validate add-absolute-encoder-mode --strict`. Expect `Change 'add-absolute-encoder-mode' is valid` and exit 0.
- [ ] Run `rg -n 'EncoderRelativeMode|\.relativeMode' projects/synth --glob '!miniapp/**'` and confirm only intentional legacy compatibility text remains; inspect `git diff --check`; inspect `git status --short` and preserve the user's untracked `projects/synth/miniapp/`.
- [ ] After external spec-compliance and code-quality reviewers approve all implementation tasks, mark OpenSpec tasks 1.1 through 6.3 complete and rerun strict validation.
- [ ] Commit: `test(synth): verify absolute encoder invariants`
