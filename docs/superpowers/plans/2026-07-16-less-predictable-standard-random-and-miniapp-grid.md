# Less-Predictable Standard Random and MiniApp Grid Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Broaden every temporal sigma in the standard random-modulator defaults and replace MiniApp's seven-encoder/three-panel main surface with a bounded Braid4-style two-scope plus 4x4 encoder layout.

**Architecture:** Keep `StandardModulators<VoiceCount>` as the single source of default random timing and change only its pre-registration defaults. Keep MiniApp's portable node tree as the shared browser/JUCE contract, but reshape its page model into a left scope stack and right 16-cell encoder grid; remove only the MiniApp-specific main-screen random panel while retaining the standard modulators' per-depth visualizers.

**Tech Stack:** C++20, synth portable UI node tree, JUCE backend parity tests, browser command-buffer tests, Make, OpenSpec.

---

### Task 1: Align the OpenSpec change and task ledger

**Files:**
- Modify: `openspec/changes/add-standard-modulators/specs/synth-standard-modulators/spec.md`
- Modify: `openspec/changes/add-standard-modulators/specs/synth-parameter-modulation/spec.md`
- Modify: `openspec/changes/add-standard-modulators/proposal.md`
- Modify: `openspec/changes/add-standard-modulators/design.md`
- Modify: `openspec/changes/add-standard-modulators/tasks.md`

**Step 1: Amend the standard timing requirement**

Replace `ssm-3`'s external and internal temporal-sigma formulas with:

```text
waiting.muSeconds          = W
waiting.sigmaSeconds       = 0.3 * W
waiting.internalSigmaHz    = 0.2 / W
moving.muSeconds           = W / 2
moving.sigmaSeconds        = 0.3 * (W / 2)
moving.internalSigmaHz     = 0.2 / (W / 2)
```

Keep target internal sigmas `[0.1, 0.3, 0.2, 0.1]` unchanged. State all four exact cases:

| W | waiting `(mu, sigma, internal)` | moving `(mu, sigma, internal)` |
|---:|---|---|
| 0.5 | `(0.5, 0.15, 0.4)` | `(0.25, 0.075, 0.8)` |
| 2 | `(2, 0.6, 0.1)` | `(1, 0.3, 0.2)` |
| 6 | `(6, 1.8, 1/30)` | `(3, 0.9, 1/15)` |
| 16 | `(16, 4.8, 0.0125)` | `(8, 2.4, 0.025)` |

**Step 2: Amend MiniApp's UI requirement**

Update `spm-71` so the default and 640x480 surfaces require:

- VCO and ordinary-LFO scopes stacked in a bounded left region.
- All sixteen physical encoder positions in a row-major 4x4 right grid.
- Position `0` at upper-left and `15` at lower-right.
- Empty top-level positions remain disconnected placeholders; modulation view remains sources `0..14` plus return at `15`.
- No separate MiniApp main-screen ganged-random panel.
- Standard random/constant/noise modulation-depth visualizer underlays remain available.

Update proposal and design prose that currently promises a three-panel waveform row or a retained random panel. Add section 7 to `tasks.md` with unchecked timing, MiniApp layout/backend, and final verification/review tasks.

**Step 3: Validate the amended change**

Run:

```bash
openspec validate add-standard-modulators --strict
```

Expected: strict validation succeeds with no errors.

**Step 4: Commit the spec amendment**

```bash
git add openspec/changes/add-standard-modulators/specs/synth-standard-modulators/spec.md \
  openspec/changes/add-standard-modulators/specs/synth-parameter-modulation/spec.md \
  openspec/changes/add-standard-modulators/proposal.md \
  openspec/changes/add-standard-modulators/design.md \
  openspec/changes/add-standard-modulators/tasks.md
git commit -m "spec(synth): broaden random timing and miniapp grid"
```

Do not stage the existing `.superpowers/sdd/` reports or `projects/synth/miniapp/` scratch directory.

### Task 2: Broaden all standard random temporal sigmas test-first

**Files:**
- Modify: `projects/synth/tests/dsp_tests.cpp`
- Modify: `projects/synth/tests/miniapp_system_tests.cpp`
- Modify: `projects/synth/include/synth/StandardModulators.hpp`

**Step 1: Write failing exact-default tests**

In `standard_modulators_defaults_match_min16_contract`, preserve the four waiting means and target sigmas, but assert:

```cpp
REQUIRE_NEAR(input.waiting.sigmaSeconds, 0.3 * waitingMean, 1.0e-12);
REQUIRE_NEAR(input.waiting.internalSigmaHz, 0.2 / waitingMean, 1.0e-12);
REQUIRE_NEAR(input.moving.sigmaSeconds, 0.15 * waitingMean, 1.0e-12);
REQUIRE_NEAR(input.moving.internalSigmaHz, 0.4 / waitingMean, 1.0e-12);
```

Also update MiniApp's standard-source integration assertions for source `0` to waiting `(0.5, 0.15, 0.4)` and moving `(0.25, 0.075, 0.8)`, with target sigma still `0.1`.

**Step 2: Run the focused tests to prove RED**

```bash
make -C projects/synth build/dsp_tests build/miniapp_system_tests
projects/synth/build/dsp_tests
projects/synth/build/miniapp_system_tests
```

Expected: both binaries build, and the changed timing assertions fail against the old defaults.

**Step 3: Make the minimal default-formula change**

In `StandardModulators.hpp`, change only `DefaultRandomInput`:

```cpp
input.waiting.sigmaSeconds = 0.3 * waitingMean;
input.waiting.internalSigmaHz = 0.2 / waitingMean;
input.moving.sigmaSeconds = 0.15 * waitingMean;
input.moving.internalSigmaHz = 0.4 / waitingMean;
```

Do not change means, target sigmas, registration, validation, caller override behavior, or Braid4 application code.

**Step 4: Run the focused tests to prove GREEN**

```bash
projects/synth/build/dsp_tests
projects/synth/build/miniapp_system_tests
```

Expected: both pass.

**Step 5: Commit the timing change**

```bash
git add projects/synth/include/synth/StandardModulators.hpp \
  projects/synth/tests/dsp_tests.cpp \
  projects/synth/tests/miniapp_system_tests.cpp
git commit -m "feat(synth): broaden standard random timing variance"
```

### Task 3: Replace MiniApp's old main layout with the full 4x4 grid test-first

**Files:**
- Modify: `projects/synth/tests/miniapp_system_tests.cpp`
- Modify: `projects/synth/apps/miniapp/MiniAppUiModel.hpp`
- Modify: `projects/synth/apps/miniapp/MiniAppUI.hpp`
- Modify: `projects/synth/juce/PortableDrawGeometryTests.cpp`

**Step 1: Write failing portable layout and routing tests**

Replace `miniapp_main_waveform_row_draws_three_distinct_bounded_panels` with a test that builds at both `900x560` and `640x480` and verifies:

- encoder nodes `0..15` all exist and are inside the root;
- encoder `0` is upper-left, `3` upper-right, `12` lower-left, and `15` lower-right;
- VCO and LFO scope nodes exist, are bounded, and VCO is vertically above LFO;
- the scope stack is left of the encoder grid;
- no node uses the literal removed MiniApp main-panel ID `miniapp.ganged_random_lfo.round`;
- after entering modulation view, source `0`'s retained standard random visualizer still supplies encoder `0`'s underlay bounds.

Extend the action-routing test to dispatch encoder position `15` and assert a `ParamPush` for slot `0`, position `15`. Rewrite `miniapp_ui_model_exposes_layout_scene_labels_and_dispatch` and `PortableDrawGeometryTests.cpp` to assert dynamic 4x4 geometry for indices `0`, `3`, `12`, and `15` rather than the old fixed seven-cell geometry.

**Step 2: Run the focused tests to prove RED**

```bash
make -C projects/synth build/miniapp_system_tests
projects/synth/build/miniapp_system_tests
make -C projects/synth/apps/miniapp \
  "$(pwd)/projects/synth/apps/miniapp/build/portable_draw_geometry_tests"
projects/synth/apps/miniapp/build/portable_draw_geometry_tests
```

Expected: the 16-node/layout assertions fail against the seven-node/three-panel implementation.

**Step 3: Implement the Braid4-style portable layout**

In `MiniAppUiModel.hpp`:

- set `EncoderGridLayout::kEncoderCount = 16`;
- use `row = index / 4`, `column = index % 4`, an 8-pixel gap, and cell width/height derived from the supplied area;
- give `MiniAppPageLayout` bounded `ScopeStackArea`, `VcoScopeBounds`, `LfoScopeBounds`, and `EncoderArea` helpers modeled on Braid4's proportions, but keep MiniApp-owned constants and types;
- clamp computed widths/heights with `std::max(0.0f, ...)` so both target sizes stay bounded;
- remove `MiniAppNodeIds::kGangedRandomLfoRound` and the MiniApp-only main-panel snapshot/build helpers if no remaining production caller uses them.

In `MiniAppUI.hpp`, build only the VCO and LFO draw nodes in the left stack and build all sixteen encoder nodes in the right grid. Preserve row-major position mapping and the existing disconnected-cell builder behavior. Keep the test-only `MiniAppDraw.hpp` wrapper until Task 4 removes it together with its remaining portable/browser callers, so every task commit remains buildable.

**Step 4: Run the focused tests to prove GREEN**

```bash
make -C projects/synth build/miniapp_system_tests
projects/synth/build/miniapp_system_tests
make -C projects/synth/apps/miniapp \
  "$(pwd)/projects/synth/apps/miniapp/build/portable_draw_geometry_tests"
projects/synth/apps/miniapp/build/portable_draw_geometry_tests
```

Expected: both pass at the new layout contract.

**Step 5: Commit the portable layout**

```bash
git add projects/synth/apps/miniapp/MiniAppUiModel.hpp \
  projects/synth/apps/miniapp/MiniAppUI.hpp \
  projects/synth/tests/miniapp_system_tests.cpp \
  projects/synth/juce/PortableDrawGeometryTests.cpp
git commit -m "feat(synth): show miniapp full encoder grid"
```

### Task 4: Update browser/JUCE parity and coverage, then run the complete gate

**Files:**
- Modify: `projects/synth/apps/miniapp/MiniAppDraw.hpp`
- Modify: `projects/synth/tests/browser_command_buffer_tests.cpp`
- Modify: `projects/synth/tests/portable_ui_tests.cpp`
- Modify: `projects/synth/juce/MiniAppJuceBackendParityTests.cpp`
- Modify: `projects/synth/docs/coverage.md`
- Modify: `openspec/changes/add-standard-modulators/tasks.md`

**Step 1: Update backend contract tests before production cleanup**

Replace `TestMiniAppThreePanelCommandsUseExistingBrowserSchema` with a two-scope MiniApp command-tree test that verifies VCO and LFO commands serialize at the unchanged command-buffer version with no diagnostics. Keep `TestPredictiveGangedLfoUsesExistingDrawSchema` and standard-modulator underlay tests unchanged because they cover the retained generic visualizer path.

Remove the MiniApp-only `BuildGangedRandomLfoPanelCommands` wrapper assertions from `portable_ui_tests.cpp`; retain all generic `BuildGangedRandomLfoCommands`, snapshot, fail-closed, and modulation-underlay coverage.

Now delete the unused MiniApp-only `BuildGangedRandomLfoPanelCommands` wrapper from `MiniAppDraw.hpp`; generic standard-modulator visualizer code remains unchanged.

In `MiniAppJuceBackendParityTests.cpp`, assert:

- encoder nodes `0` and `15` exist in the portable tree and JUCE component host;
- only VCO and LFO main scope nodes exist and paint through `PaintDrawCommand`;
- the scope nodes are stacked vertically left of the encoder grid;
- index `15` matches `EncoderGridLayout::BoundsForIndex` and can route a position-15 push;
- no MiniApp main-screen ganged-random node exists.

**Step 2: Run browser, portable, and JUCE parity tests**

```bash
make -C projects/synth build/portable_ui_tests build/browser_command_buffer_tests
projects/synth/build/portable_ui_tests
projects/synth/build/browser_command_buffer_tests
make -C projects/synth/apps/miniapp \
  "$(pwd)/projects/synth/apps/miniapp/build/miniapp_juce_backend_parity_tests"
projects/synth/apps/miniapp/build/miniapp_juce_backend_parity_tests
```

Expected: all pass without a browser schema-version change.

**Step 3: Update coverage and mark implementation tasks complete**

Update `projects/synth/docs/coverage.md` so `ssm-3` maps to the broadened exact-default assertions and `spm-71` maps to the two-scope/4x4 portable, browser, geometry, and JUCE parity tests. Remove claims that MiniApp has a three-panel main waveform row.

Mark OpenSpec section 7 timing and layout/backend tasks complete only after their focused tests and Claude review gates pass. Leave the final verification item unchecked until Step 4 succeeds.

**Step 4: Run the complete verification gate**

```bash
make -C projects/synth test
make -C projects/synth/apps/miniapp test
openspec validate add-standard-modulators --strict
git diff --check
```

Expected: every command succeeds; no whitespace errors; no source, protocol, parameter-topology, MIDI, or saved-data compatibility changes beyond the approved defaults and layout.

Then mark the OpenSpec final verification item complete and rerun strict validation.

**Step 5: Commit verification/docs updates**

```bash
git add projects/synth/tests/browser_command_buffer_tests.cpp \
  projects/synth/apps/miniapp/MiniAppDraw.hpp \
  projects/synth/tests/portable_ui_tests.cpp \
  projects/synth/juce/MiniAppJuceBackendParityTests.cpp \
  projects/synth/docs/coverage.md \
  openspec/changes/add-standard-modulators/tasks.md
git commit -m "test(synth): cover miniapp full-grid parity"
```

### Task 5: Independent review gates and final scope audit

**Step 1: Task-level reviews**

After each implementation task, send the task diff and its governing OpenSpec requirements to a fresh Claude reviewer for spec compliance. Only after compliance passes, send the same task to a fresh Claude reviewer for code quality. Native Codex performs every edit and every reviewer-directed fix.

**Step 2: Final whole-change review**

Send the complete diff from the pre-follow-up base through HEAD to Claude Opus. Require an explicit `PASS` on:

- all four external temporal sigmas are tripled;
- all four internal temporal sigmas are doubled;
- target sigmas and caller overrides are unchanged;
- MiniApp exposes all sixteen row-major encoder positions at both sizes;
- the main random panel is absent but modulation underlays remain;
- browser/JUCE share the portable tree without schema changes;
- no unrelated tracked or pre-existing untracked files are included.

**Step 3: Apply review fixes and reverify**

If a reviewer finds an issue, have native Codex add a failing regression test first, implement the minimum fix, rerun the focused command, repeat both review gates, and rerun the complete verification gate before claiming completion.

**Step 4: Audit final scope**

```bash
git status --short
git log --oneline --decorate -8
git diff --stat HEAD~4..HEAD
```

Expected: only the approved OpenSpec, standard-default, MiniApp layout/test, backend parity, and coverage files are in the follow-up commits; the pre-existing `.superpowers/sdd/` and `projects/synth/miniapp/` paths remain untouched and unstaged.
