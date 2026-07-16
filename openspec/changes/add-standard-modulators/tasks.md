## 1. Standard Bundle Contracts

- [ ] 1.1 Add focused JUCE-free tests for `StandardModulators<1>`, `<2>`, and `<4>` covering non-copy/move traits, address-stable ownership, exact default indexes, names, short names, colors, voice palettes, and all four derived timing configurations.
- [ ] 1.2 Add failing tests for pre-registration overrides, post-registration configuration freeze, duplicate/out-of-range active indexes, invalid metadata/timing, group voice/modulator shape mismatch, mono constant-index collision exclusion, atomic registration failure, and double registration.
- [ ] 1.3 Implement the reusable configuration and non-movable `StandardModulators<VoiceCount>` ownership structure with four random processors/inputs/output-pointer rows, runtime noise and constant processors, and all six retained portable visualizers.
- [ ] 1.4 Implement validated one-time registration into an exactly fifteen-modulator group, including connected metadata/visualizers, stable pointers, configured voice colors, and complete constant omission for `VoiceCount == 1`.

## 2. Standard Bundle Processing

- [ ] 2.1 Add deterministic tests for register/prepare/process/publish lifecycle ordering, one-step advancement of four independent random processors and noise, immutable constant behavior, voice-order output copies, coherent UI publication, and the absence of implicit `UpdateModValues()`.
- [ ] 2.2 Implement `Prepare`, allocation-free `Process`, and block-controlled `PublishUiState`, with explicit lifecycle errors and bounded inspection access for processors, inputs, outputs, and visualizers.
- [ ] 2.3 Add direct parameter-group integration tests proving latest standard values appear only after caller-owned `UpdateModValues()`, polyphonic constant publishes correctly, mono index `11` stays disconnected, and all registered pointers remain stable across processing/publication.

## 3. MiniApp Adoption

- [ ] 3.1 Update MiniApp system tests first for fifteen modulators, sixteen physical slot positions, capacity `192`, standard sources at `0..3/11/14`, direct/swapped VCO and ordinary LFO at `4/5/6`, disconnected gaps, and no saved-index migration.
- [ ] 3.2 Replace MiniApp's directly owned random/noise/constant processors, inputs, adapter storage, visualizers, registration helpers, and sample-loop calls with one retained `StandardModulators<2>` and its lifecycle operations.
- [ ] 3.3 Move MiniApp's three scope-backed source registrations and visualizer metadata to `4/5/6`, expand the slot using the existing physical-ID convention, and verify all fifteen depth cells plus the return cell materialize and route correctly.
- [ ] 3.4 Rewire MiniApp's main random panel and UI/test accessors to standard random source `0`; update portable and browser command-buffer tests while preserving the three-panel layout and modulation-underlay behavior.

## 4. Braid4 Adoption

- [ ] 4.1 Update Braid4 system tests first for fifteen modulators in every group, independent `<2>/<4>/<1>` bundles, standard sources and visualizers, the mono constant gap, application sources at `4/5`, complete fifteen-cell views, and distinct lifetime addresses.
- [ ] 4.2 Recalculate Braid4 group capacities for existing top-level parameters plus a complete fifteen-cell view, construct and register all three retained standard bundles, and move stereo, quad, and mono application-specific source pairs from `0/1` to `4/5`.
- [ ] 4.3 Prepare the Braid4 bundles at the four-times-host internal rate, process them once before each internal modulation-value update, publish all three once per host block, and retain the documented one-internal-sample delay for matrix/VCO-derived application sources.
- [ ] 4.4 Update Braid4 portable UI tests so standard depth cells render wrapper-owned visualizers, indexes `4/5` remain encoder-only, mono index `11` stays null/disconnected, and no visualizer aliases across sources or groups.

## 5. Regression, Performance, and Documentation

- [ ] 5.1 Update synth coverage documentation and any source-topology comments to map `ssm-1..5`, revised `spm-71`, `sdsp-33/38/40`, and `d4-1/3/8/9` to their focused tests.
- [ ] 5.2 Run the JUCE-free DSP, parameter modulation, module, portable UI, browser command-buffer, MiniApp system, and Braid4 system test targets and fix regressions without weakening existing assertions.
- [ ] 5.3 Run MiniApp's app/browser smoke coverage and Braid4's representative-rate/deadline benchmarks; confirm four additional random processors plus noise per Braid group remain inside the existing release callback budget.
- [ ] 5.4 Verify patch loading follows live fifteen-source topology without migration, run strict OpenSpec validation, and perform a final placeholder, contradiction, ambiguity, and changed-file scope review.
