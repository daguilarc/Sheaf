# Constant Modulator Design

## Purpose

Add a reusable polyphonic modulation source that assigns every voice a fixed
unipolar value at construction time. The assignments spread adjacent voices
apart as much as possible while still covering the full normalized range.
MiniApp will expose the source in its sixth and final modulator slot with a
minimal bar-chart visualizer.

## Processor

`ConstantModulatorProcessor` accepts a positive runtime voice count. It owns
one immutable output value and one address-stable source pointer for each voice.
Zero voices is invalid. A one-voice processor publishes `0`.

For `n > 1`, construct the lexicographically smallest cyclic permutation that
maximizes the sum of absolute differences between adjacent entries, including
the wraparound edge. Write `n = 2m` or `n = 2m + 1`:

- For even `n`, use `0, m, 1, m + 1, ..., m - 1, 2m - 1`.
- For odd `n`, use `0, m, m + 1, 1, m + 2, 2, ..., 2m - 1, m - 1, 2m`.

If the permutation entry at voice index `j` is `x[j]`, that voice publishes
`x[j] / (n - 1)`. Thus four voices publish `[0, 2/3, 1/3, 1]` in voice order.
The values are computed only during construction. There is no per-sample
`Process()` work and no DSP-to-UI publication path.

The processor exposes its voice count, bounds-checked per-voice inspection,
an immutable output span, and a span of stable source pointers suitable for
`ParameterGroup::SetModulationSource`. It is non-copyable and non-movable so a
registered pointer cannot be invalidated by moving the owner.

## Portable Visualizer

`ConstantBarVisualizer` is JUCE-free and borrows the processor's immutable
output span. Because those values never change and the processor outlives its
app-owned visualizer, no `UIState`, atomic snapshot, scope, or audio-thread
synchronization is needed.

For positive finite bounds it emits exactly one filled rectangle per voice,
left to right in voice order. Every bar uses the modulator color. There are no
labels, ticks, axes, outlines, background panels, or other decoration. Small
gaps distinguish adjacent bars; each centered bar uses half the post-gap width
of its voice slot. The constant visualizer also suppresses the shared encoder's
outer rounded-rectangle frame without changing the encoder body or interaction.

The vertical data range is `[-0.1, 1.1]`. Each bar begins at the bottom edge,
which represents `-0.1`, and ends at its voice value. Consequently the voice
whose value is zero still has visible height, while the voice whose value is
one stops below the top edge. Empty values or invalid bounds emit no commands.

## MiniApp Integration

MiniApp retains a two-voice constant processor and its bar visualizer. It
expands the existing group from five to six modulator slots and increases the
parameter capacity from 72 to 84 (`12 + 12 * 6`). Indexes `0` through `4`
remain unchanged; index `5` registers the connected `Constant` source and its
visualizer. MiniApp uses yellow for both source metadata and bars so it remains
distinct from the white noise source.

The processor values are already initialized when the source pointers are
registered. MiniApp does not recompute or copy them in its sample loop and does
not add parameters, pages, banks, scopes, persistence fields, or audio routing.

## Verification

JUCE-free DSP tests cover zero and one voice, exact even and odd assignments,
the maximal cyclic-distance property for representative sizes, normalization,
stable source pointers, immutability, and direct `ParameterGroup` publication.
Portable UI tests cover one rectangle per voice, voice order, exact
`[-0.1, 1.1]` geometry, visible zero, top margin at one, minimal command output,
invalid bounds, and base visualizer contracts. MiniApp system tests cover the
six-slot topology, index-5 metadata and stable pointers, retained visualizer,
yellow color flow, fixed values across audio processing, and the absence of a
new per-sample processor call. Existing JUCE and browser parity tests verify
that rectangle commands remain backend portable.
