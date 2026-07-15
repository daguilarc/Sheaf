## Context

The rebased MiniApp configures one two-voice `ParameterGroup` with five
connected modulation sources: direct and swapped VCO outputs at indexes `0`
and `1`, a basic LFO at index `2`, a ganged random LFO at index `3`, and white
noise at index `4`. Its UI already supports six source cells, leaving index `5`
as the final unoccupied slot.

The new source is not a time-varying DSP signal. It assigns voices fixed values
that cover `[0, 1]` while maximizing cyclic adjacent separation, making it
useful for spreading a modulated parameter across polyphony. Pointer-backed
modulation registration still requires stable mutable-float addresses even
though the source API never changes those floats after construction. The
portable visualizer must show those exact immutable values without adding
audio/UI publication machinery.

## Goals / Non-Goals

**Goals:**

- Provide a runtime-sized constant processor with one construction-time value
  and one address-stable source pointer per voice.
- Define the exact greedy maximum-distance assignment for even, odd, and
  single-voice counts.
- Provide a minimal portable bar chart that shows every voice in order and
  makes both zero and one visibly framed inside the component.
- Register the two-voice constant source and retained visualizer at MiniApp
  modulator index `5` without changing the preceding five sources.
- Keep construction and drawing JUCE-free and add no audio-thread work.

**Non-Goals:**

- No rate, phase, smoothing, randomization, user-editable value, bipolar mode,
  reordering API, or post-construction mutation.
- No processor `Process()` method, `UIState`, atomic snapshot, scope channel,
  history, label, tick, axis, border, or backend-specific component.
- No new parameter, page, bank, persistence field, controller mapping, or audio
  routing.

## Decisions

1. Use one runtime-sized immutable `ConstantModulatorProcessor`.

   Construction accepts a positive `std::size_t` voice count, allocates output
   and pointer vectors once, fills them, and exposes only const output
   inspection plus a source-pointer span. Zero voices throws an invalid
   configuration error. The processor is non-copyable and non-movable so a
   registered pointer cannot be invalidated by moving the owner. It receives no
   `ParameterGroup`, modulator index, metadata, or UI object.

   Alternative considered: a compile-time `ConstantModulatorProcessor<N>`.
   Fixed arrays simplify lifetime but make voice count an application policy
   instead of the requested initialization input. Alternative considered: an
   app-owned float array. That duplicates the assignment and pointer-lifetime
   contract in every consumer.

2. Compute the exact greedy maximum-distance permutation once.

   For `n = 2m`, append `(j, m + j)` for `j` from `0` through `m - 1`. For
   `n = 2m + 1`, append `0, m`, then append `(m + j, j)` for `j` from `1`
   through `m - 1`, and finally append `2m`. The one-voice case is the special
   sequence `[0]`. Output `j` is `permutation[j] / (n - 1)` for `n > 1` and
   zero for `n = 1`.

   These formulas are the lexicographically smallest maximizing construction
   from the supplied permutation analysis. They yield `[0, 1]` for two voices,
   `[0, 1/2, 1]` for three, `[0, 2/3, 1/3, 1]` for four, and cover every
   normalized rank exactly once. Because values never change, the processor has
   no `Process()` method and MiniApp performs no per-sample copy.

   Alternative considered: search all permutations and select the first
   maximizer. That is factorial-time and obscures the closed-form contract.
   Alternative considered: ascending ranks. That covers the range but does not
   maximize adjacent voice separation.

3. Borrow the processor's immutable values in the portable visualizer.

   `ConstantBarVisualizer` retains a `std::span<const float>` and a color. Its
   owner must keep the source storage alive; MiniApp naturally does so by
   declaring the processor before the visualizer and retaining both for the app
   lifetime. Since no writer exists after construction, the UI thread can read
   directly without an atomic snapshot, scope, lock, or duplicated assignment
   logic.

   For finite positive bounds and a nonempty value span, divide the width into
   equal voice slots and emit one filled rectangle inside each slot. Small
   horizontal insets separate bars. Map data range `[-0.1, 1.1]` to the full
   height, start each rectangle at the bottom (`-0.1`), and place its top at the
   clamped voice value. A zero value therefore fills `1/12` of the height and a
   one value fills `11/12`. No other draw command is emitted. Invalid bounds or
   empty values emit nothing.

   Alternative considered: let the visualizer recompute or copy assignments
   from a voice count. That creates a second source of truth. Alternative
   considered: publish a processor `UIState`. It adds synchronization for data
   that is immutable before either processing or drawing begins.

4. Fill MiniApp's final modulator slot.

   MiniApp configures six modulator slots and capacity 84 (`12 + 12 * 6`),
   retains `ConstantModulatorProcessor(2)`, registers its source pointers at
   index `5` with connected `Constant` metadata and yellow source color, and
   attaches the retained yellow bar visualizer only to index `5`. Indexes `0`
   through `4` and their processing order remain unchanged. `UpdateModValues`
   dereferences the already initialized constants along with every other source.

5. Verify each contract at its owning boundary.

   DSP tests cover construction validation, exact even/odd/single assignments,
   permutation coverage and cyclic-distance maxima for representative counts,
   stable addresses, immutability, and direct group publication. Portable UI
   tests cover rectangle count/order, exact zero/one framing, in-bounds geometry,
   minimal commands, invalid input, stable identity, and draw-tree composition.
   MiniApp system tests cover the combined six-slot topology, capacity, index-5
   metadata/pointers/visualizer/color, fixed values before and after audio
   processing, and preservation of indexes `0` through `4`. Existing JUCE and
   browser drawing parity tests cover the already-supported fill-rectangle
   command path.

## Risks / Trade-offs

- [Risk] The source-pointer API exposes mutable pointers even though the
  processor contract is immutable. -> Mitigation: retain private storage,
  expose no mutable output accessor, document pointer use as registration-only,
  and test that all processor operations preserve values.
- [Risk] A borrowed visualizer span can dangle if an application destroys its
  processor first. -> Mitigation: make the lifetime precondition explicit and
  retain processor-before-visualizer member order in MiniApp.
- [Risk] Narrow bounds could make fixed gaps consume a bar. -> Mitigation: cap
  each inset as a fraction of its voice slot so every positive-width slot keeps
  positive bar width.
- [Risk] The new delta depends on unarchived noise requirement numbering and
  topology. -> Mitigation: reserve `sdsp-39`, `sdsp-40`, and `spv-8`, describe
  the combined six-slot state, and validate both active changes before landing.
