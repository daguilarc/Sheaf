## 1. Shared Encoder Draw Contract

- [x] 1.1 Add JUCE-free encoder draw tests proving ordinary connected encoders keep the existing opaque central body fill.
- [x] 1.2 Add JUCE-free encoder draw tests proving underlay-backed encoders use a partially transparent central body fill while retaining opaque/readable outline and value commands.
- [x] 1.3 Add an underlay-present field to the shared encoder draw state and implement the translucent body style in shared portable encoder drawing code.

## 2. Portable App Surface Wiring

- [x] 2.1 Add MiniApp system coverage proving a visible visualizer pointer marks the shared encoder draw state and produces translucent body commands.
- [x] 2.2 Add hidden-visualizer coverage proving hidden visualizers do not render a visualizer node and do not trigger translucent encoder styling.
- [x] 2.3 Wire MiniApp and Braid 4 encoder surfaces to set the shared underlay-present flag from visible visualizer pointers only.

## 3. Verification

- [x] 3.1 Run focused portable UI and MiniApp/Braid system tests.
- [x] 3.2 Run the JUCE-free synth UI boundary check and strict OpenSpec validation.
- [x] 3.3 Confirm no backend adapter implementation files changed.
