## Task 4 Spec Compliance Review — commit `77e18924`

**Verdict: SPEC APPROVED**

No Critical or Important findings. All cited requirements were traced against the actual diff and, where formulas were exact (drag delta math, threshold retention, replacement-value formatting, layout coordinates), verified by hand against the test assertions.

### Minor
1. **`projects/synth/browser/src/ui.ts:273/282/293`** — `resolveFrameBounds`'s duplicate-node-id, unknown-child-reference, and multiple-parent guards have no dedicated focused test; only the cycle path is tested. Not a spec violation (design.md D6's explicit TS test list doesn't require these), but a coverage gap worth closing later.
2. **`projects/synth/browser/src/ui.ts:312`** — the auto-flow cursor's initial Y position only accounts for sibling `Draw`-kind nodes with explicit bounds, not other explicitly-positioned non-Draw siblings, which could theoretically let auto-flow overlap a fixed-position element above it. Untested edge case, not required by sprs-6.

### Notable things I checked and confirmed correct (no findings)
- **Pointer capture is attached only on `pointerDragAction` nodes** (`updatePointerGesture`), verified by the "plain" button in the capture test never receiving a `setPointerCapture` call.
- **Drag math**: `(dx - dy) * 0.0025`, `.001` threshold with anchor retained on rejection, `.5` scale compensation via `clientX/surfaceScale`, immediate per-move dispatch, and `0:3:0` → `0:3:<delta>` replacement formatting — all hand-verified against test numbers and exact.
- **Lifecycle**: capture on down, release+clear on up/cancel, clear-without-release on `lostpointercapture`, and `dispose()` releasing all captures, disconnecting the `ResizeObserver`, and stripping listeners.
- **Canvas arcs**: `save()` → round cap/join → `stroke()` → `restore()`, isolated from subsequent commands (verified against the fake-context instrumentation test).
- **`context.translate(-bounds.x, -bounds.y)`** in `paint()`: I initially suspected this broke rendering for non-origin Draw nodes (an untouched pre-existing test fixture uses small, seemingly node-local draw-command bounds for a node at absolute x=210). A sub-agent traced the real C++ builder (`MiniAppDraw.hpp`) and the JUCE reference backend (`PortableJuceBackend.hpp`, which applies no per-node translation before consuming `command.bounds`) and confirmed `DrawCommand.bounds` is genuinely absolute/global, matching `Node.bounds`. The new translate is the correct fix, not a regression — the untouched fixture just never asserted pixel positions for that node.
- **Layout**: absolute resolved bounds, parent-relative CSS offsets (`childAbsolute - parentAbsolute`), nearest-nested-root auto-flow/wrapping (verified the 900px-sidebar/900-wide-app-wrap scenario by hand), long label/status sizing (`Math.max(120, len*6.5+12)` capped to available width, exact 376px match), resolved host height including auto-flow overflow, one-parentless-root enforcement, cycle/duplicate/unknown-child/multiple-parent guards, single active root transform with stale-transform cleanup on reparenting, and `ResizeObserver` disposal — all verified against code and tests.
- **Generic boundary**: CSS/HTML use only `data-synth-node-kind`-based generic selectors, no app-specific IDs/branches/fallback UI; `check:generic-runtime` script legitimately exists and scans for forbidden app-specific tokens.
- **No worker/audio/MIDI/C++/Task 5 files touched** — diff is confined to the five files in the brief.
- Double-click behavior for Row/Draw nodes is unchanged, as required.