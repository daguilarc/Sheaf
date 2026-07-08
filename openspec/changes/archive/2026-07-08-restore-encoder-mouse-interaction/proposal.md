## Why

The JUCE component abstraction refactor preserved encoder drawing but regressed
the pre-abstraction desktop behavior where users could drag encoders and
double-click/push them with the mouse. This needs to be restored now because
the miniapp's on-screen encoders are no longer a usable control surface.

## What Changes

- Restore mouse drag interaction for runtime/miniapp encoder widgets rendered
  through the JUCE portable backend.
- Restore encoder double-click push interaction through the same message path
  used by the former `EncoderComponent` implementation.
- Keep encoder drawing and portable tree production JUCE-free while adding the
  necessary event translation in JUCE-owned backend code.
- Add regression coverage that fails when a portable/JUCE-rendered encoder no
  longer dispatches param inc/dec and push messages from mouse gestures.

## Capabilities

### New Capabilities

### Modified Capabilities
- `synth-runtime-ui`: require bespoke portable synth widgets, specifically
  encoders, to preserve their pre-abstraction mouse interaction semantics when
  rendered by the JUCE backend.

## Impact

- `projects/synth/include/synth/PortableUI.hpp` and portable miniapp widget
  builders may need a small host-neutral input/action descriptor for bespoke
  draw nodes if one is not already present.
- `projects/synth/apps/miniapp/*` encoder tree/draw production must continue
  binding slot/position metadata and message actions without JUCE references.
- `projects/synth/juce/PortableJuceBackend.hpp` should translate JUCE mouse
  gestures over interactive encoder draw nodes into the same synth messages
  that `EncoderComponent` dispatched before abstraction.
- `projects/synth/juce/EncoderComponent.hpp` may remain as a geometry/drawing
  compatibility helper or be reused by the backend, but the restored behavior
  must be covered through the active portable rendering path.
- Synth JUCE/backend tests should add a focused regression for encoder drag and
  double-click behavior.
