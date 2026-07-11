# Task 4 Report: Browser Pointer, Canvas, And Layout Parity

## Result

DONE

## Commit

`77e189249df5d38581243511717272ec1dfeeaa5` (`fix(synth): match browser UI interaction and drawing parity`)

## Changed Files

- `projects/synth/browser/src/ui.ts`
- `projects/synth/browser/tests/ui-backend.spec.ts`
- `projects/synth/browser/public/index.html`
- `projects/synth/browser/public/synth-browser.css`
- `projects/synth/browser/tests/static-site.spec.ts`

## RED Evidence

1. The three focused real-`PointerEvent` cases failed with no capture calls and no move-time actions. This demonstrated the old pointer-up-only, X-only behavior and missing cancel/lost-capture state.
2. The rounded-arc instrumentation observed `stroke:butt:miter` with no `save`, round cap/join assignments, or `restore`.
3. The 80-character status node resolved to 120 pixels instead of the root-capped 376 pixels, and the following control remained on the same row.
4. Auto-flow below a 30-pixel root left the host at 30 pixels high.
5. A sidebar child with absolute x 900 received nested CSS `left: 900px` instead of `0px`.
6. A cyclic graph failed with `RangeError: Maximum call stack size exceeded` instead of a cycle diagnostic.
7. Disposal failed with `TypeError: backend.dispose is not a function`.
8. A node that changed from parentless to nested retained its prior `scale(0.5)` transform.

## GREEN Evidence

- `npm --prefix projects/synth/browser run build`: passed.
- `npx --prefix projects/synth/browser playwright test projects/synth/browser/tests/ui-backend.spec.ts projects/synth/browser/tests/static-site.spec.ts`: 22 passed.
- `npm --prefix projects/synth/browser run check:generic-runtime`: passed.
- `git diff --check`: passed.

## Generic Boundary Evidence

- Pointer behavior is driven only by portable `pointerDragAction` data and generic action formatting.
- Layout uses only command-buffer nodes, bounds, parent links, and `NodeKind::Root`; there are no concrete application IDs or branches.
- The static document contains only the generic `#synth-root`, stylesheet reference, and browser module script. Tests assert that it contains no fallback controls.
- `index.html`, `synth-browser.css`, and `ui.ts` contain no miniapp or fake-app identifiers.
- The generic-runtime checker passed after all changes.

## Behavior Covered

- Captured, incremental two-axis drag math with scale compensation, threshold retention, replacement-delta formatting, and up/cancel/lost-capture/dispose cleanup.
- Saved/restored round Canvas arc cap and join state.
- Cycle-safe graph validation, nearest-root flow, text-aware label/status sizing, resolved host extents, parent-relative DOM offsets from absolute bounds, and exactly one active root transform.
- Generic static-site styling and absence of application-specific fallback markup.

## Concerns

- Chromium cannot acquire its macOS Mach rendezvous port inside the workspace sandbox, so Playwright verification was run with the approved unsandboxed browser-test command. The test server and all assertions completed normally.

## Review-Fix Commit

`1f982a76` (`fix(synth): harden browser UI backend lifecycle`)

## Review-Fix RED Evidence

1. Pointer-capture failure produced an uncaught `InvalidStateError` from the event listener.
2. Two pointers on one drag element both acquired capture and could independently dispatch deltas.
3. Label/status computed `white-space` was `normal`, allowing realistic multi-word text to wrap beyond the fixed 22-pixel layout height.
4. A 100-pixel ScrollArea with a descendant at y 1900 inflated the outer host from 160 to 1920 pixels.
5. A pure parent cycle reported a cycle before the no-parentless-root invariant; focused malformed-tree cases also pinned duplicate, unknown-child, multiple-parent, multiple/no-root, and non-Root-parentless diagnostics.
6. `renderFrame()` after idempotent disposal returned normally and could recreate listeners.
7. A forced scale change during a drag emitted `0.0325` instead of the current-scale incremental result `0.02`.

## Review-Fix Decisions

- A failed `setPointerCapture()` is contained and leaves no drag state.
- A second pointer on the same drag element is ignored; pointers on different elements remain independent.
- Accepted pointer anchors remain raw client coordinates, and each incremental delta is divided by the current surface scale.
- Label and StatusText use generic `nowrap`, hidden overflow, and ellipsis styling.
- Descendants below a ScrollArea are excluded from global surface extents while the ScrollArea box remains included; ordinary auto-flow overflow remains part of the host extent.
- Disposal is terminal: repeated `dispose()` calls are harmless and later `renderFrame()` calls throw `cannot render a disposed browser UI backend`.
- No explicit non-Draw overlap change was made. JUCE's `AutoLayoutStartY()` intentionally considers only explicit Draw nodes, so changing only the browser backend would break backend parity without a new shared layout contract.

## Review-Fix GREEN Evidence

- `npm --prefix projects/synth/browser run build`: passed.
- `npx --prefix projects/synth/browser playwright test projects/synth/browser/tests/ui-backend.spec.ts projects/synth/browser/tests/static-site.spec.ts`: 29 passed.
- `npm --prefix projects/synth/browser run check:generic-runtime`: passed.
- `git diff --check`: passed.
