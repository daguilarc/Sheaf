# Portable JUCE Value Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make JUCE portable value controls preserve action address prefixes and prove Controllers device selection persists.

**Architecture:** The tests first establish one generic backend contract for all value-producing JUCE widgets and one Controllers-specific production-path regression. The fix then centralizes prefix/value composition inside `PortableComponent`, applies it to combo boxes, text fields, toggles, and sliders, and restores single-commit text editing without altering pointer-drag behavior.

**Tech Stack:** C++20, JUCE `ComboBox`/`TextEditor`/`ToggleButton`/`Slider`, portable `NodeTree` actions, existing custom executable tests, Make.

## Global Constraints

- Buttons dispatch their declared action unchanged.
- Combo boxes, text fields, toggles, and sliders append emitted values as `value` for an empty prefix and `prefix:value` for a non-empty prefix.
- Pointer-drag delta replacement behavior remains unchanged.
- JUCE text fields commit once per completed edit; Return commits and releases focus without a duplicate focus-loss dispatch.
- The Controllers regression uses the production `ControllersPageSurface` and generic `synth_juce::PortableComponent`; no Controllers-specific production renderer or test-only production hook is added.
- Browser production code remains unchanged; its existing append semantics and real-WASM endpoint Playwright test remain authoritative parity evidence.
- Preserve unrelated untracked files under `projects/synth/browser` and `projects/synth/miniapp`.

---

### Task 1: Add Failing JUCE Value-Action Regressions

**Files:**
- Modify: `projects/synth/juce/PortableJuceBackendTests.cpp`
- Modify: `projects/synth/juce/ControllersPageSimulationTests.cpp`

**Interfaces:**
- Consumes: `synth::ui::Action::WithValue`, `synth_juce::PortableComponent`, `ControllersHarnessFixture`, actual retained JUCE widget callbacks.
- Produces: Regression assertions defining exact emitted action values and persistent Controllers endpoint selection; no production code.

- [ ] **Step 1: Add the generic prefixed-control contract tests**

In `PortableJuceBackendTests.cpp`, render actual combo, text, toggle, and slider nodes whose actions use non-empty prefixes. Drive their JUCE controls through synchronous production callbacks and assert exact values:

```cpp
Require(surface.lastAction.value == "controller:input:b2",
        "combo appends the selected option id to the current action prefix");
Require(surface.lastAction.value == "controller:mapping:0:64",
        "text field appends committed text to its action prefix");
Require(surface.lastAction.value == "controller:mapping:1:1",
        "toggle appends its checked state to its action prefix");
Require(surface.lastAction.value.starts_with("controller:depth:"),
        "slider appends its value to its action prefix");
```

Also invoke Return followed by focus loss without changing the text and assert the text edit dispatch count increases only once.

- [ ] **Step 2: Add the real Controllers endpoint regression**

In `ControllersPageSimulationTests.cpp`, use `ControllersHarnessFixture`, the real `ControllersPageSurface`, and the production `PortableComponent`. Find controller zero's input `juce::ComboBox`, select the existing `Twister In` option with `juce::sendNotificationSync`, refresh the surface and renderer, then assert:

```cpp
Require(fixture.state.instrument.controllers[0].input.identifier == "twister-in-id",
        "JUCE endpoint selection commits the selected device");
Require(refreshedCombo->getText() == juce::String("Twister In"),
        "JUCE endpoint selection remains selected after refresh");
```

- [ ] **Step 3: Verify the tests fail for the diagnosed reason**

Run:

```bash
make -C projects/synth/apps/miniapp test
```

Expected: the focused backend or Controllers assertion fails because JUCE emits only the dynamic value rather than `prefix:value`. Record the exact failure as RED evidence. Do not modify production code.

- [ ] **Step 4: Commit the failing tests**

```bash
git add projects/synth/juce/PortableJuceBackendTests.cpp projects/synth/juce/ControllersPageSimulationTests.cpp
git commit -m "test(synth): expose JUCE value action regression"
```

---

### Task 2: Fix Generic JUCE Value-Action Dispatch

**Files:**
- Modify: `projects/synth/juce/PortableJuceBackend.hpp`
- Test: `projects/synth/juce/PortableJuceBackendTests.cpp`
- Test: `projects/synth/juce/ControllersPageSimulationTests.cpp`

**Interfaces:**
- Consumes: the exact action composition contract established by Task 1.
- Produces: one generic value-dispatch path used by combo boxes, text fields, toggles, and sliders; existing pointer-drag dispatch remains separate.

- [ ] **Step 1: Implement one append-value dispatch helper**

Replace the value-replacement helper with a helper that reads the current retained node action, appends `:` only when its existing value is non-empty, appends the emitted value, and dispatches the composed action:

```cpp
void DispatchCurrentNodeActionWithAppendedValue(const synth::ui::NodeId& id,
                                                std::string value)
{
    if (const synth::ui::Node* node = FindNode(id); node != nullptr && node->action.has_value())
    {
        synth::ui::Action dispatched = *node->action;
        if (!dispatched.value.empty())
        {
            dispatched.value += ':';
        }
        dispatched.value += value;
        DispatchBackendAction(dispatched);
    }
}
```

- [ ] **Step 2: Route every value-producing JUCE widget through the helper**

- Combo boxes emit their selected option ID through the helper.
- Sliders emit their current numeric string through the helper.
- Text fields emit their committed text through the helper.
- Toggles emit `"1"` or `"0"` through the helper.
- Buttons and pointer-drag actions retain their existing paths.

- [ ] **Step 3: Restore one commit per JUCE text edit**

Track whether the current text has already been committed, clear that state from `onTextChange`, commit through the append helper on Return or focus loss, and have Return release keyboard focus. The later focus-loss callback must be idempotent for unchanged text.

- [ ] **Step 4: Run focused and full JUCE verification**

Run:

```bash
make -C projects/synth/apps/miniapp test
make -C projects/synth test
git diff --check
```

Expected: all commands exit zero with the Task 1 regressions green and no existing failures.

- [ ] **Step 5: Commit the production fix**

```bash
git add projects/synth/juce/PortableJuceBackend.hpp
git commit -m "fix(synth): preserve JUCE value action prefixes"
```
