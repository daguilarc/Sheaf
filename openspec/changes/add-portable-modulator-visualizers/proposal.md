## Why

Modulation-depth views currently render every source as an encoder alone, even when a source has useful DSP state such as a VCO or LFO waveform. A backend-agnostic visualizer component gives each modulator an optional, explicitly placed visual representation without coupling synth application code to JUCE or another host toolkit.

## What Changes

- Add a backend-agnostic `Visualizer` component abstraction with independent instance identity, visibility, bounds, and portable drawing behavior.
- Define strict one-instance/one-placement and non-owning model-pointer lifetime contracts; displaying equivalent content twice requires two visualizer instances.
- Extend modulator metadata with an optional visualizer pointer, carry that association into materialized modulation-depth parameters, and publish it through stable parameter UI state.
- When a modulation-depth cell with a visualizer is visible, place that visualizer in the encoder's square, draw it first, and draw the encoder above it; null visualizers preserve encoder-only rendering.
- Give MiniApp modulators 0 and 1 separate VCO visualizer instances and modulator 2 an LFO visualizer instance, each reading stable app-owned module UI state.
- Leave every Braid 4 modulator visualizer pointer null for now.
- Add JUCE-free contract, state-publication, layout/layering, MiniApp integration, and Braid 4 null-path tests.
- Exclude all JUCE, browser, and other backend implementation changes from this change.

## Capabilities

### New Capabilities

- `synth-portable-visualizers`: Backend-agnostic stateful visualizer components, portable drawing, instance identity, placement, visibility, and lifetime contracts.

### Modified Capabilities

- `synth-parameter-modulation`: Modulator metadata, modulation-depth parameters, and published cell UI state carry an optional visualizer association.
- `synth-runtime-ui`: Visible modulation-depth encoder cells compose an optional visualizer beneath the existing encoder within the same square.
- `synth-dsp-classes`: MiniApp constructs two independent VCO visualizers and one LFO visualizer backed by stable module UI state.
- `synth-braid-4`: Braid 4 explicitly leaves its modulator visualizer associations empty.

## Impact

The change affects the JUCE-free synth headers and sources for portable UI, parameter modulation, a new portable builder composition helper adopted by each app surface's `BuildTree()` loop, MiniApp initialization and UI-model wiring, Braid 4 initialization, and their headless tests. It adds non-owning pointer and address-stability contracts but no new dependency, persistence format, DSP processing behavior, message-bus behavior, or backend-specific implementation.
