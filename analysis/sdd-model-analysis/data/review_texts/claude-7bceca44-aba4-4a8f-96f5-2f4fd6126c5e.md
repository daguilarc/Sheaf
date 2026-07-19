## Task 4 Re-Review — Fix Commit `1f982a76`

Verified against actual diff (`git show 1f982a76`), full current `projects/synth/browser/src/ui.ts`, the CSS, the JUCE backend (`PortableJuceBackend.hpp`), and the new/changed tests in `ui-backend.spec.ts`. No code or tests were run or edited.

### Critical
None.

### Important
None.

### Minor

1. **Dead duplicate "unknown child" check** — `projects/synth/browser/src/ui.ts:296-297` vs `:277-279`.
   The fix added a new validation pass (`ui.ts:277-284`) that walks every node's `children` and throws `unknown child node ${childId}` before the root/cycle checks run. But the pre-existing check inside `visit()` (`ui.ts:295-297`, `const child = nodes.get(childId); if (!child) throw ...`) walks the exact same `nodesInOrder`/`children` set and can never fire — any unknown child is now always caught by the earlier loop first. It's unreachable code duplicating the same message string, left over from the reordering that fixed the pure-cycle-vs-missing-root bug. No functional impact; worth deleting (replace with `nodes.get(childId)!`) for clarity.

### Verification of the fix areas

- **ScrollArea outer extent** — `ui.ts:345-359`: `isInsideScrollArea` walks the `parents` chain and excludes only true descendants of a `ScrollArea`, while the ScrollArea's own bounds still count toward `width`/`height`. Traced the new test (`keeps scroll descendants out of the outer surface extent`, spec.ts:484) by hand: root 300×160 stays 160 even with a descendant at y=1900/height=2000 inside the scroll node; the descendant remains scrollable and reachable (`scrollTop`/`getBoundingClientRect` checks). Ordinary (non-scroll) auto-flow overflow is untouched and still contributes to host height (pre-existing test at spec.ts:465 unaffected). Correct.

- **`setPointerCapture` failure** — `ui.ts:153`: wrapped in `try { ... } catch { return; }`, executed *before* `capturedPointers.set(...)`, so a throwing capture leaves no map entry and no drag state. Confirmed against the new test (spec.ts:181) which listens for `window`'s `error` event and asserts `errors: []` and `actions: []` — no uncaught `InvalidStateError`, no stale state.

- **One pointer per element / independent elements** — `ui.ts:150-151`: the new same-element scan (`for (const captured of this.capturedPointers.values()) if (captured.element === element) return;`) blocks a second pointer only when it targets an *already-captured element*; the check is keyed on `captured.element`, so a pointer on a different element is never blocked. Traced the new test (spec.ts:205) by hand and it matches (`captures: [1]`, `releases: [1]`, single drag action from pointer 1 only). No dedicated regression test exercises two simultaneously-dragged *different* elements, but the logic change trivially preserves that path (unaffected code branch) — not blocking.

- **Label/StatusText overlap** — `synth-browser.css:30-39`: the selector is already shared between `[data-synth-node-kind="label"]` and `[data-synth-node-kind="status-text"]` (confirmed in base commit too), and the fix adds `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` to that shared rule — so both kinds get single-line containment, not just status. Matches new test (spec.ts:431), which asserts `whiteSpace === "nowrap"`, `overflow === "hidden"`, `textOverflow === "ellipsis"`, and `scrollHeight <= clientHeight` for both `label` and `status`.

- **Malformed-tree coverage** — `ui.ts:274-303`: hand-traced all six cases in spec.ts:591-646 through the actual control flow (duplicate-id and unknown-child are actually intercepted earlier by `decodeCommandBuffer`'s own checks in `protocol.ts:232-233`, which format as `"<detail> (node N)"` — matching the test's expected strings; this is not a bug, just where those two checks are actually enforced for the `ArrayBuffer` entry path, while `ui.ts`'s own copies remain the enforcement path for direct `CommandBufferFrame` calls). Diamond-shaped (non-cyclic) shared-child structures do not false-positive as cycles because "visited" state is set before sibling traversal reaches the shared node. The pure two-node parent cycle (`a↔b`, no root) now reports `found 0` instead of a stack overflow, because the root-count check runs before the recursive `visit`. The genuine cycle test (`root→a→b→a`) still throws with a cycle message because `visit()` hits the `"visiting"` state before the deferred `multipleParentError` is ever checked. All consistent with the report's stated ordering fix.

- **Render-after-dispose / idempotent disposal** — `ui.ts:51,81-87`: `renderFrame` unconditionally throws once `disposed` is true; `dispose()` guards with `if (this.disposed) return` before flipping the flag, so a second `dispose()` call performs zero additional work (`resizeObserver.disconnect()` called exactly once). Matches spec.ts:678 (`disconnects: 1`, fixed error message).

- **Resize-mid-drag delta math** — `ui.ts:162-171`: anchors are now stored as raw, unscaled client coordinates and the scale division is applied at increment time using whatever `this.surfaceScale` currently is. Hand-computed the new test (spec.ts:238): scale 1→0.5 mid-drag, raw move Δx=4 → `(4/0.5)*0.0025 = 0.02`, matching the asserted `"axis:0.02"`. Re-verified the pre-existing scale test (spec.ts:122, constant scale 0.5) still yields `0.03` under the new formula — no regression.

- **Explicit non-Draw overlap (no-op decision)** — cross-checked against `PortableJuceBackend.hpp:466-485` (`AutoLayoutStartY`): JUCE's cursor-start computation also considers *only* `m_drawNodeIndices` (Draw-kind nodes) when computing `maxDrawBottom`, exactly mirroring `ui.ts:321-323`'s `candidate.kind === NodeKind.Draw` filter. The decision to leave explicit-bounds non-Draw overlap unaddressed is genuinely consistent with current backend parity, not a shortcut — confirmed by reading the actual JUCE source, not just trusting the report.

- **No regressions** — focus (spec.ts:271), scroll reachability (spec.ts:35), absolute/composite-root coordinates (spec.ts:512), arc save/restore (spec.ts:318), and generic-boundary/protocol tests (spec.ts:751, `protocol.ts` untouched by this commit) are all outside the diff's touched code paths; nothing in the fix commit alters shared logic those tests depend on.

---

**CODE QUALITY APPROVED**