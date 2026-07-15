# Minimize Constant Visualizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halve and center the constant-modulator bars and remove only the rounded encoder frame drawn over the constant chart.

**Architecture:** Give every portable visualizer a default frame preference, override it only for `ConstantBarVisualizer`, and carry that preference through `MiniAppUI` into the shared encoder renderer. Preserve all existing drawing and interaction behavior except the single rounded-frame command requested for suppression.

**Tech Stack:** C++20, JUCE-free portable draw commands, Make, OpenSpec.

## Global Constraints

- Existing non-constant visualizers retain the rounded encoder frame by default.
- Each constant bar is exactly half its previous post-gap width and centered in the same voice slot.
- Constant bar height, order, color, and `[-0.1, 1.1]` vertical range remain unchanged.
- No type checks, backend-specific logic, or DSP/sample-path changes.

---

### Task 1: Minimal constant chart presentation

**Files:**
- Modify: `projects/synth/tests/portable_ui_tests.cpp`
- Modify: `projects/synth/tests/miniapp_system_tests.cpp`
- Modify: `projects/synth/include/synth/PortableUI.hpp`
- Modify: `projects/synth/include/synth/ConstantBarVisualizer.hpp`
- Modify: `projects/synth/include/synth/EncoderDraw.hpp`
- Modify: `projects/synth/apps/miniapp/MiniAppUI.hpp`
- Modify: `openspec/changes/add-constant-modulator/specs/synth-portable-visualizers/spec.md`
- Modify: `openspec/changes/add-constant-modulator/design.md`
- Modify: `openspec/changes/add-constant-modulator/tasks.md`
- Modify: `projects/synth/docs/coverage.md`

**Interfaces:**
- Produces: `virtual bool Visualizer::WantsEncoderFrame() const noexcept`, defaulting to `true`.
- Produces: `EncoderDrawState::wantsFrame`, defaulting to `true`.
- Consumes: `ConstantBarVisualizer::WantsEncoderFrame() == false` in `MiniAppUiSurface::BuildTree()`.

- [ ] **Step 1: Write failing portable bar and frame-preference tests**

For the existing 80-wide, four-voice constant chart, preserve the current gap calculation and require each bar width to equal `(slotWidth - gap) * 0.5f`. Require each bar center to equal its slot center. Require the base test visualizer to want a frame and `ConstantBarVisualizer` not to want one.

- [ ] **Step 2: Write failing encoder and MiniApp integration tests**

Build an underlay encoder with `wantsFrame = false` and require that it contains no `StrokeRoundedRect`, while the default underlay still contains one. In the MiniApp visualizer-underlay test, inject a constant visualizer and require the corresponding encoder node to omit `StrokeRoundedRect`; keep the existing injected default visualizer assertion to prove unchanged behavior.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
make -C projects/synth build/portable_ui_tests build/miniapp_system_tests
projects/synth/build/portable_ui_tests
projects/synth/build/miniapp_system_tests
```

Expected: compile or assertion failures because the frame preference and half-width geometry do not exist yet.

- [ ] **Step 4: Implement the minimal presentation contract**

Add the default virtual frame preference to `Visualizer`, override it to `false` in `ConstantBarVisualizer`, and set the bar width to half the existing post-gap width with a centered x coordinate. Add the default-true `EncoderDrawState::wantsFrame`; guard only the `StrokeRoundedRect` append in `BuildEncoderDrawCommands`. In `MiniAppUI`, assign `encoderState.wantsFrame = visualizer->WantsEncoderFrame()` whenever a visible visualizer underlay exists.

- [ ] **Step 5: Update the active specification and traceability**

Specify exact centered half-width bars and constant-only encoder-frame suppression in `spv-8`; document the presentation preference in the OpenSpec design; add and complete polish tasks in `tasks.md`; update the coverage row with the new focused assertions.

- [ ] **Step 6: Run focused and full verification**

Run:

```bash
projects/synth/build/portable_ui_tests
projects/synth/build/miniapp_system_tests
make -C projects/synth test
openspec validate add-constant-modulator --strict
openspec validate add-noise-modulator --strict
make -C projects/synth miniapp
git diff --check
```

Expected: all commands exit zero; the constant OpenSpec change remains 100% complete.

- [ ] **Step 7: Commit**

Stage only the files listed above and commit with:

```bash
git commit -m "feat(synth): minimize constant visualizer"
```
