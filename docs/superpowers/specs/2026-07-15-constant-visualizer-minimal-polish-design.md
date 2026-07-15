# Constant Visualizer Minimal Polish Design

## Goal

Make the yellow constant-modulator chart visually lighter by halving each bar's
current width and removing the rounded encoder frame drawn over that chart,
without changing the other five modulator presentations.

## Bar Geometry

`ConstantBarVisualizer` continues to divide its assigned width into one equal
slot per voice and retain the existing slot-relative gap. Each bar becomes
exactly half of its current post-gap width and remains centered in its voice
slot. Heights, voice order, color, and the `[-0.1, 1.1]` vertical framing stay
unchanged.

## Frame Suppression

The rounded line is emitted by the shared encoder renderer rather than by the
constant visualizer. The base portable `Visualizer` contract will expose a
frame preference that defaults to retaining the encoder frame. The constant
visualizer overrides that preference to suppress it. MiniApp passes the
preference into `EncoderDrawState`, and the shared encoder renderer omits only
the outer rounded-rectangle stroke when suppression is requested. Encoder
body, indicator, badges, interaction, and every non-constant visualizer remain
unchanged.

This avoids type checks in MiniApp and gives the visualizer ownership of its
presentation preference while preserving existing behavior by default.

## Verification

Portable visualizer tests will first fail on the new exact centered half-width
geometry. Encoder-draw tests will first fail while the rounded frame is still
present, then prove suppression removes only that command. MiniApp tests will
prove the constant visualizer requests suppression and the other retained
visualizers do not. The focused UI and MiniApp tests, full synth suite, strict
OpenSpec validation, and MiniApp application build will run before completion.
