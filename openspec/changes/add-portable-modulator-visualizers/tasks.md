## 1. Portable Visualizer Contract

- [x] 1.1 Add JUCE-free tests for visualizer bounds, visible/hidden behavior, non-copyable/non-movable identity, node emission, and absent hidden nodes.
- [x] 1.2 Implement the backend-agnostic `synth::ui::Visualizer` base and portable builder composition helper without changing any backend adapter.
- [x] 1.3 Add tests for a typed scope visualizer reading updated atomic scope UI state, skipping disconnected layers, and keeping all generated geometry inside its current bounds.
- [x] 1.4 Implement the reusable typed scope visualizer by adapting stable UI-state pointers to the existing shared scope-waveform command builder.

## 2. Modulator-to-UI-State Publication

- [x] 2.1 Add parameter-modulation tests proving non-null and null visualizer associations flow from modulator metadata into materialized depth parameters and published cell UI state, disconnected cells clear the pointer, and save/load data contains no visualizer topology.
- [x] 2.2 Add nullable visualizer pointers to modulator metadata, parameter configuration, and atomic parameter UI state using forward declarations to preserve the JUCE-free dependency boundary.
- [x] 2.3 Copy each modulator visualizer into its materialized modulation-depth configuration, publish it inside the existing UI snapshot transaction, and preserve null defaults for ordinary parameters and existing callers.

## 3. Encoder Composition

- [x] 3.1 Add portable UI tests for a modulation-depth cell whose visualizer and encoder use identical square bounds, whose stable visualizer node precedes the encoder node, and whose encoder retains drag and double-click actions.
- [x] 3.2 Add null, intrinsically hidden, disconnected, top-level-parameter, and bank-transition tests proving encoder-only rendering remains unchanged when no visualizer is eligible.
- [x] 3.3 Add a portable builder composition helper and adopt it in each app surface's `BuildTree()` loop to set eligible visualizer bounds, append its display-only node first, and append the existing interactive encoder node above it.

## 4. Application Topology

- [x] 4.1 Add MiniApp initialization and system tests requiring three address-stable visualizer instances, distinct VCO visualizer addresses for modulators `0` and `1`, shared stable VCO model inputs where appropriate, and an LFO-state visualizer for modulator `2`.
- [x] 4.2 Construct and retain two MiniApp VCO visualizers and one LFO visualizer after the UI-state members they reference, then register their distinct pointers with the three modulation sources.
- [ ] 4.3 Add Braid 4 initialization and portable-tree tests proving all stereo, quad, and mono modulator visualizer pointers remain null and modulation views remain encoder-only.
- [ ] 4.4 Keep Braid 4 source registration explicitly on the null-default path without constructing visualizer instances.

## 5. Verification and Documentation

- [ ] 5.1 Run the focused portable UI, parameter modulation, MiniApp system, and Braid 4 system test targets and correct any contract failures.
- [ ] 5.2 Run the complete JUCE-free synth test suite and UI-boundary check, confirming no file under `projects/synth/juce`, `projects/synth/browser`, or another backend implementation directory changed.
- [ ] 5.3 Update synth coverage documentation to map `spv-1` through `spv-5`, `spm-70`, `sru-24`, `sdsp-33`, and `d4-9` to their tests.
