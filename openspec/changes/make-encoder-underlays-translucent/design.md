## Context

The portable visualizer work renders a visualizer draw node before the encoder node for modulation-depth cells. That composition is correct, but the shared encoder body fill is fully opaque, so the waveform is only visible around the knob's perimeter. The relevant drawing code is shared portable code: `EncoderDraw.hpp` builds encoder commands, while app surfaces only decide whether a visualizer pointer is present and how nodes stack.

## Goals / Non-Goals

**Goals:**

- Make visualizer-backed encoders read as an overlay/underlay composition rather than a mostly hidden waveform.
- Keep the behavior shared across portable app surfaces by adding state to `EncoderDrawState`, not MiniApp-specific drawing.
- Preserve encoder legibility: arcs, switch gaps, outlines, badges, labels, and pointer actions remain as they are.
- Preserve the default encoder appearance when no visible visualizer underlay is present.

**Non-Goals:**

- No JUCE or browser backend renderer changes.
- No DSP, serialization, parameter topology, or visualizer ownership changes.
- No per-app color palette tuning.

## Decisions

1. **Expose underlay presence as encoder draw state.**
   - Add a boolean such as `hasVisualizerUnderlay` to `synth::ui::EncoderDrawState`.
   - App surfaces set it from the same published `Parameter::UIState::visualizer` pointer they already use for composition, after checking the visualizer is non-null and visible.
   - Alternative considered: infer underlay state inside `BuildEncoderDrawCommands` from node order. Rejected because encoder command construction does not own the tree and should stay a pure draw-state transform.

2. **Make only the central body fill translucent.**
   - When `hasVisualizerUnderlay` is true, lower the alpha of the dark body fill and the color-tinted inner fill.
   - Keep strokes, arcs, badges, and indicator markers unchanged so the encoder still functions visually as the control.
   - Alternative considered: make the whole encoder node uniformly transparent. Rejected because it would weaken interaction affordances and text/badge readability.

3. **Keep app code limited to shared-state wiring.**
   - MiniApp and Braid 4 app surfaces set the new draw-state field before calling the shared encoder builder.
   - They do not construct draw commands or pick alpha values themselves.

## Risks / Trade-offs

- **Too transparent could reduce knob affordance** → Use a moderate alpha and keep strokes/arcs opaque.
- **Too opaque could still bury the visualizer** → Test exact draw-command alpha values for underlay-present cells so the intended shared style is locked down.
- **Hidden visualizers could trigger translucent encoders without an underlay** → Wire `hasVisualizerUnderlay` only when the pointer is non-null and `Visible()` is true.
