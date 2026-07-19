Non-const overload exists and `group` is a non-const reference, so `Metadata(0).visualizer = ...` compiles fine.

Review complete. Summary below.

## Task 4 Review — add-portable-modulator-visualizers

**Spec compliance (brief + OpenSpec):**
- `MiniAppCore.hpp:272-274,276-306`: constructs and retains `vcoVisualizer0_`, `vcoVisualizer1_` (`ScopeVisualizer<VcoUiLayerState>`) and `lfoVisualizer_` (`ScopeVisualizer<LfoUiLayerState>`), matching design.md's "two independent MiniApp VCO visualizers and one MiniApp LFO visualizer."
- Both VCO visualizers share the same `vcoLayers` pointer array but are distinct component instances — exactly what design.md line 57 specifies ("may observe the same VCO UI-state collection but never share component identity") and what the brief's pseudocode shows.
- Visualizer members are declared after `vcoUiStates_`/`lfoUiStates_` (`MiniAppCore.hpp:269-274`), giving correct C++ reverse-order destruction (visualizers destroyed before the UI state they point into), satisfying the design's dangling-pointer mitigation.
- Registration (`MiniAppCore.hpp:86,303-305`) happens after `vcoModule_.RegisterModulationSources(...)` / `lfoModule_.RegisterModulationSource(...)`, preserving existing metadata (name/color).
- `tasks.md`: only 4.1/4.2 checked; 4.3/4.4 (Braid 4) and section 5 correctly left unchecked. Diff touches only `MiniAppCore.hpp`, its test file, and `tasks.md` — no JUCE/browser backend files touched, consistent with the JUCE-free constraint.
- Verified field/type correctness against source: `VcoModule::UIState::vcos` and `LfoModule::UIState::lfos` are `std::array<..., kVoiceCount>` (`Modules.hpp:45,922`), and `DefaultWavetableVco::UIState`/`BasicLFOProcessor::UIState` both expose `connected`/`scope`/`scopeChannel`/`scopeColor`, matching `ScopeVisualizer`'s `LayerState` requirements.

**Code quality / ownership / lifetime:**
- `Visualizer` base is non-copyable/non-movable (`PortableUI.hpp:109-112`), and `MiniAppCore` is implicitly non-copyable/non-movable because it holds a non-copyable `VcoModule` member — so the raw pointers handed to `group.GetModulators().Metadata(n).visualizer` stay valid for the object's lifetime; no new dangling-pointer risk introduced.
- Minor style nit (non-blocking): `RegisterModulatorVisualizers` is defined between data-member declarations rather than after them — legal C++ (doesn't affect member init order) and consistent enough with the surrounding file, but slightly unconventional placement.

**Tests / TDD evidence:**
- New test `miniapp_registers_distinct_scope_visualizers_for_modulators` (`miniapp_system_tests.cpp:176-195`) matches the brief's Step 1 spec verbatim: non-null for all three modulators, `mod0 != mod1`, all three `Visible()`.
- Report shows RED (`mod0 != nullptr` failing) → GREEN transition and a final full-suite pass listing all 20 MiniApp tests, consistent with proper TDD sequencing. I did not re-run tests myself (read-only review), per standing reviewer policy.

**Findings:** none Critical or Important. One cosmetic/style nit noted above, not blocking.

APPROVED