## Why

Visualizer underlays are now rendered beneath modulation-depth encoders, but the shared encoder body is opaque enough that most of the waveform is hidden. The UI needs the encoder to remain legible while letting the underlay read as an active visualizer instead of a decorative edge artifact.

## What Changes

- Add shared portable encoder styling for cells that have a visible visualizer underlay.
- Make the encoder body fill partially translucent only when an underlay is present.
- Keep encoder arcs, outlines, badges, labels, and pointer behavior readable and unchanged.
- Wire MiniApp and Braid 4 portable encoder surfaces to set the shared underlay-present flag from their published UI-state visualizer pointer.
- Add JUCE-free tests proving the translucent body is shared encoder behavior, not MiniApp-specific drawing.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `synth-runtime-ui`: Encoder draw commands gain a portable underlay-aware body style for visualizer-backed modulation-depth cells.

## Impact

- Affected code:
  - `projects/synth/include/synth/EncoderDraw.hpp`
  - `projects/synth/apps/miniapp/MiniAppUI.hpp`
  - `projects/synth/apps/braid-4/Braid4UI.hpp`
  - focused JUCE-free synth UI/system tests
- No backend adapter implementation changes.
- No serialized state or DSP behavior changes.
