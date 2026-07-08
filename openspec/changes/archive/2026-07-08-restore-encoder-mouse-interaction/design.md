## Context

The `decouple-synth-ui-from-juce` change moved miniapp encoder visuals from a
dedicated JUCE `EncoderComponent` into a portable draw-node tree consumed by
`PortableJuceBackend`. The former `EncoderComponent` handled `mouseDrag` by
pushing `MessageIn::ParamIncDec` with `(deltaX - deltaY) * sensitivity`, and
handled `mouseDoubleClick` by pushing `MessageIn::ParamPush`.

The active portable backend preserves drawing, stable node IDs, and semantic
control actions, but draw nodes are not JUCE child controls and do not receive
mouse events. The fix should restore the old desktop behavior without moving
miniapp page logic or message construction back into JUCE-only code.

## Goals / Non-Goals

**Goals:**

- Restore mouse drag and double-click behavior for portable miniapp encoder
  nodes rendered in the JUCE desktop backend.
- Keep `projects/synth/include/synth` and miniapp UI tree production free of
  JUCE types.
- Route backend-originated encoder gestures through the same portable
  `Surface::DispatchAction` path as semantic controls.
- Preserve the old drag math and timestamp/message routing semantics from
  `EncoderComponent`.
- Add regression coverage that exercises the active portable/JUCE path.

**Non-Goals:**

- Redesign encoder visuals or change the miniapp layout.
- Introduce browser, Web MIDI, or Wasm input handling in this change.
- Rewrite Controllers/Audio/File page behavior.
- Replace the parameter/message bus contract.

## Decisions

### Decision 1: Make bespoke draw nodes explicitly interactive

Add a small JUCE-free pointer interaction descriptor to the portable UI model,
or the narrow equivalent if the implementation finds an existing hook sufficient.
The descriptor should allow a draw node to opt in to drag and double-click
actions without becoming a semantic slider. Encoders are not generic sliders:
they have custom drawing, push behavior, relative drag deltas, and no native
slider text box.

Alternative considered: render encoders as `juce::Slider` controls. That would
be quick but would lose the custom push gesture and force the portable model
through toolkit-shaped behavior that the abstraction was meant to avoid.

### Decision 2: Keep gesture-to-message translation in the portable surface

The JUCE backend should translate mouse events into portable actions containing
the node identity and gesture value; `MiniAppUiSurface` should continue to turn
those actions into `MessageIn` values using `AppContext::uiBus` and `now`.
This preserves the existing boundary: the backend knows about mouse events,
while the miniapp surface knows about slot/position and synth messages.

Alternative considered: let `PortableJuceBackend` push `MessageIn` directly.
That would restore behavior but would couple a generic backend to miniapp
parameter semantics and make future backends repeat synth-specific logic.

### Decision 3: Use transparent JUCE child components for interactive draw nodes

For draw nodes with pointer actions, the JUCE backend should register a stable
child component over the node bounds. Painting may stay in the parent
`PortableComponent`, but the child component should own mouse tracking,
last-position state, action dispatch, and double-click forwarding. This keeps
hit-testing precise and reuses the existing stable node ID retention logic.

Alternative considered: handle all mouse events in `PortableComponent` and
manually search draw-node bounds. That avoids another child type but duplicates
JUCE hit testing and makes overlapping or future interactive draw nodes harder
to reason about.

### Decision 4: Preserve the old drag formula and threshold

Encoder drag should keep the old behavior unless tests reveal an intentional
reason to tune it: `(event.position.x - last.x - (event.position.y - last.y))`
multiplied by the encoder sensitivity, ignored below the prior tiny threshold.
Double-click should dispatch a push action for the same slot/position.

Alternative considered: map vertical movement only. That is common for knobs,
but it would be a behavior change from the pre-abstraction `EncoderComponent`.

## Risks / Trade-offs

- Interactive draw-node API grows too broad -> Keep it to the minimum needed
  for drag and double-click actions; leave keyboard/accessibility expansion to
  a later frontend-focused change.
- Backend child overlays could interfere with drawing -> Keep overlays
  transparent and use the draw node's existing bounds for hit testing.
- Refreshes during drag could reset component state -> Retain interactive draw
  components by stable node ID, and avoid overwriting active drag state during
  `RefreshFromSurface`.
- Action value parsing could be brittle -> Centralize encoder action value
  formatting/parsing in miniapp UI helpers and cover it with a JUCE-free unit
  test plus a JUCE backend gesture test.

## Migration Plan

1. Extend the portable UI model/builders with a minimal pointer-drag action
   descriptor for draw nodes, reusing `doubleClickAction` where practical.
2. Mark miniapp encoder draw nodes with slot/position metadata and drag/push
   actions while keeping all declarations JUCE-free.
3. Add an interactive draw-node component path in `PortableJuceBackend` that
   dispatches current-node actions from JUCE mouse drag and double-click events.
4. Add JUCE-free miniapp action tests for encoder drag/push action handling.
5. Add a JUCE backend regression test that finds an encoder node, simulates or
   invokes drag/double-click handling, and observes the expected dispatched
   action/message.
6. Run the synth unit tests and JUCE backend tests that cover portable UI,
   miniapp backend parity, and encoder geometry.
