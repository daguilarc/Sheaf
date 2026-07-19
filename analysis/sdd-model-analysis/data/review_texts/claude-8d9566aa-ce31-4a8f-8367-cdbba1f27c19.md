### Spec Compliance: **PASS**

Verified against `design.md` decisions 4–5, the `spm-71`, `sdsp-33/38/40` delta requirements, and the relevant `ssm-1..5` bundle contracts (Task 1/2, unchanged but load-bearing here). All claims below were checked against actual code, not the report's prose.

**Topology (exact 15-modulator / 16-position / 192-capacity)**
- `numModulators = 15`, `maxParameters = 192` (`= 12*(1+15)`) — `projects/synth/apps/miniapp/MiniAppCore.hpp:66-73`.
- 16 physical positions `10..25` — `MiniAppCore.hpp:134-136` (`for (PhysicalEncoderId encoder = 10; encoder < 26; ++encoder)`); `PhysicalEncoderId = uint32_t` (`ParameterModulation.hpp:28`), so no narrowing. Test asserts all 16 values — `tests/miniapp_system_tests.cpp:742-745`.

**Standard sources 0..3/11/14, moved 4/5/6, gaps disconnected**
- `standardModulators_->Register()` before app-source registration; `vcoModule_.RegisterModulationSources(group, 4, 5)`, `lfoModule_.RegisterModulationSource(group, 6)` — `MiniAppCore.hpp:89-91`.
- Metadata/color/pointer assertions for `0..3` (random), `4/5/6` (VCO Direct/Swapped/LFO), `11` (Constant), `14` (Noise), and disconnected `{7,8,9,10,12,13}` — `tests/miniapp_system_tests.cpp:746-774`.
- `StandardModulators::Register()` installs exactly `randomIndexes={0,1,2,3}`, `constantIndex=11`, `noiseIndex=14` and never touches other indexes — `include/synth/StandardModulators.hpp:126-149, 231-235`.

**15-depth-cell + return routing/materialization (not merely assumed)**
- `core.VcoBank()->VisibleParameter(10+modIx)` checked for all `modIx 0..14`, and `VisibleParameter(25)` (return) checked against the top-level parameter — `tests/miniapp_system_tests.cpp:818-823`.
- `uiState.slots[0].cells[i].visualizer` checked for all 15 indices (9 connected + 6 gap) — `tests/miniapp_system_tests.cpp:829-841`. This is the layer that actually drives hardware feedback; it is exercised for all 15, not just the 7 shown in the dev-preview grid.
- The rendered `BuildTree()` node grid is capped at `EncoderGridLayout::kEncoderCount = 7` (`apps/miniapp/MiniAppUiModel.hpp:79`), a pre-existing constant untouched by this diff — so the on-screen preview only ever shows `Encoder(0..6)`. The test correctly scopes its node-tree assertions to `{0..6}` present and `{7,8,9,10,12,13,15}` absent (`tests/miniapp_system_tests.cpp:829-843`) — it never claims 11/14 render in the tree, and the report's wording ("routed... and verified in bank/UI state") is accurate rather than overclaiming screen rendering. **Verified, not assumed** — but see Minor note below.

**No saved-index migration**
- `miniapp_loads_old_six_index_depth_data_without_alias_or_translation` loads raw index-keyed JSON at old indexes 0–5, confirms values land unchanged on the new topology's semantics at the same raw indexes (e.g. old idx 0's VCO-Direct depth now surfaces as "Random 500 ms" depth), and confirms new indexes 6–14 are unmaterialized — `tests/miniapp_system_tests.cpp:846-882`. Matches `spm-71` "Old modulation indexes are not migrated" scenario exactly.

**Deletion of direct generic processors/adapters/visualizers**
- `gangedRandomLfo_`, `gangedRandomLfoInput_`, `gangedRandomLfoModulationSources_`, `gangedRandomLfoVisualizer_`, `noiseModulator_`, `noiseVisualizer_`, `constantModulator_`, `constantBarVisualizer_`, `RegisterGangedRandomLfoSource()` all removed — diff hunks around `MiniAppCore.hpp:409-460` (old). Confirmed zero dangling references to `GangedRandomLfoVisualizerInstance`, `ConstantBarVisualizerInstance`, `ConstantModulatorInstance`, `GangedRandomLfoInputConfig`, `GangedRandomLfoModulationSources` anywhere in the tree (grep, empty result) — no missed call sites, no compile risk from the removal.

**Address-stable bundle, host-rate prepare, once-per-sample process before update, once-per-block publish**
- `standardModulators_ = std::make_unique<...>(group)` right after group construction, retained as a member — `MiniAppCore.hpp:74-75, 286`.
- `Prepare(sampleRate)` in `PrepareToPlay` uses the host-negotiated rate — `MiniAppCore.hpp:171`.
- `standardModulators_->Process();` immediately followed by `UpdateModValues(*group_);` inside the per-sample loop, nothing between — `MiniAppCore.hpp:204-205`.
- `standardModulators_->PublishUiState();` called once, after the frame loop, once per `ProcessBlock` — `MiniAppCore.hpp:222`.

**Random-0 main panel/accessors**
- `underlayId` now targets `Encoder(0)`; retained-visualizer check uses `StandardModulatorsInstance().RandomVisualizer(0)` — `tests/miniapp_system_tests.cpp:616,625`.
- `GangedRandomLfoInstance()` rewired to delegate to `standardModulators_->RandomProcessor(0)` (not a duplicate storage — a rewired compatibility accessor, exactly as Step 3 specifies) — `MiniAppCore.hpp:257-260`; consumed by `ReadGangedRandomLfoSnapshotFromCore` in the untouched `MiniAppUiModel.hpp:266-272`, so the waveform panel genuinely reads bundle random-0.

**Distinct moved scope visualizers, standard/portable/browser behavior**
- `mod4 != mod5`, `mod6 != mod4/mod5`, all `Visible()` — `tests/miniapp_system_tests.cpp:639-683`.
- Portable UI (`tests/portable_ui_tests.cpp:1192-1223`) and browser command-buffer (`tests/browser_command_buffer_tests.cpp:525-561`) each independently construct a `StandardModulators<2>`, register/prepare/process/publish, and assert visualizer pointer identity and draw-command production — genuine coverage, not stubs.

### Strengths
- The topology/routing tests operate at the correct layer (`BankSlot::VisibleParameter`, `uiState.slots[0].cells[]`) rather than the 7-slot dev-preview grid, so "15 cells + return across 16 positions" is actually exercised end-to-end, not just asserted at the metadata level.
- The no-migration test is a well-constructed adversarial check: it deliberately exploits index reuse across old/new semantics to prove there's no aliasing, rather than just checking new defaults look right.
- Full, clean removal of the old six-source ownership graph with zero dangling references — verified by repo-wide grep, not just diff inspection.
- Default random-timing derivation in `StandardModulators.hpp:215-229` matches `ssm-3`'s formulas exactly, and Task 3's new test values (`0.5/0.05/0.2` etc., `tests/miniapp_system_tests.cpp:778-784`) match the spec's worked example precisely.
- Report's wording on the seven-cell vs sixteen-position distinction is precise ("routed... and verified in bank/UI state") — it does not overclaim on-screen rendering of all 15 cells, matching what the code and tests actually do.

### Issues

**Critical:** None found.

**Important:** None found.

**Minor:**
1. `.superpowers/sdd/task-3-standard-modulators-report.md:50` (Concerns section) states the fifteen-cell view "is routed through all sixteen physical positions and verified in bank/UI state" — this is accurate but easy to misread as "verified end-to-end including on-screen rendering." Given this is exactly the ambiguity the review was asked to scrutinize, the report would be stronger if it explicitly named `EncoderGridLayout::kEncoderCount = 7` as the pre-existing, out-of-scope limiter of the dev-preview grid, rather than leaving the reader to infer it. No code change needed — documentation clarity only.
2. `projects/synth/Makefile` MiniApp/portable-UI/browser targets (`Makefile:115,142,157`) still list `include/synth/DspScope.hpp`, `DspConstant.hpp`, `DspNoise.hpp`, `ConstantBarVisualizer.hpp`, `NoiseWaveformVisualizer.hpp` as explicit prerequisites even though `$(STANDARD_MODULATOR_HEADERS)` already pulls them in transitively. Harmless redundancy, not a correctness issue — could be trimmed in Task 5's cleanup pass.

### Assessment

Task quality: **Approved**

The implementation matches every scrutinized spec requirement (exact topology, capacity, index placement, gap disconnection, lifecycle ordering, address stability, no-migration behavior, visualizer distinctness) with genuine test evidence at the correct architectural layer, not assumption. The one nuance called out by the review brief — seven visible portable cells vs. sixteen hardware positions — is real but pre-existing, out of this task's file scope, and correctly not conflated with the (properly tested) backend materialization/routing. No Critical or Important findings; the two Minor notes are documentation/cleanup only and don't block landing.