# Task 3 Report: Browser UI Backend And Gesture Semantics

## Scope

Implemented the browser-side SBCB v1 decoder and generic UI backend only. No runtime-core, audio, MIDI, persistence, or app-specific browser behavior was added.

## TDD Evidence

1. Added `tests/fixtures/command-buffer.ts` and `tests/ui-backend.spec.ts` before production modules existed.
2. Ran `npm --prefix projects/synth/browser test -- ui-backend.spec.ts`.
   - Red result: TypeScript failed only on the expected missing `../src/ui.js` module.
3. Added the protocol decoder and renderer, then reran the focused suite repeatedly while fixing failures found by the tests:
   - Corrected SBCB section framing: all five section lengths precede all payloads.
   - Corrected scroll content-wrapper reconciliation.
   - Kept leaf control content out of the structural child-reconciliation pass.
   - Corrected synthetic node bounds so the canvas did not intentionally cover interactive controls.
4. Final focused run passed: existing Node smoke test plus all three Playwright cases.

## Implementation

- `src/protocol.ts`
  - Decodes the Task 2 SBCB v1 layout and returns a typed frame.
  - Validates magic/version, section boundaries, string/action indexes, node/draw kinds, finite numeric fields, node draw ranges, child references, diagnostics, and non-negative scroll extents.
  - Throws named `CommandBufferError` values containing record kind and, where applicable, record index.
- `src/ui.ts`
  - Renders portable node kinds with only `data-synth-node-id` and `data-synth-node-kind` semantic hooks.
  - Reuses element instances by stable node id across frames.
  - Uses a Canvas2D path covering every Task 2 draw kind.
  - Dispatches button, toggle, slider, combo, text, pointer-drag, row double-click, and draw double-click actions.
  - Implements the final-colon pointer-drag replacement rule without accumulating browser-side drag state.
  - Establishes scroll content dimensions from the supplied extents.
- Test harness
  - `npm test -- ui-backend.spec.ts` now builds, runs the retained Node smoke test, then runs the selected Playwright spec.
  - The Playwright config starts a local static server so `public/index.html` and generated browser modules load via HTTP.

## Tests

`npm --prefix projects/synth/browser test -- ui-backend.spec.ts`

- Node smoke test: 1 passed.
- Playwright: 3 passed.
- Coverage includes portable semantic controls, canvas node presence with all draw kinds encoded, reachable scroll-bottom content, keyed node identity across frames, no app-specific DOM naming, action dispatch values, pointer drag suffix replacement, row/draw double-click, decoding, and named decoder failures.

`git diff --check`

- Passed with no whitespace errors.

## Changed Files

- `projects/synth/browser/src/protocol.ts`
- `projects/synth/browser/src/ui.ts`
- `projects/synth/browser/tests/fixtures/command-buffer.ts`
- `projects/synth/browser/tests/ui-backend.spec.ts`
- `projects/synth/browser/package.json`
- `projects/synth/browser/playwright.config.mjs`
- `.superpowers/sdd/task-3-report.md`

## Self-Review

- Verified the binary field order against `BrowserCommandBuffer.hpp`, including the important shared section-length header.
- Verified the renderer contains no app names or miniapp identifiers; the spec rejects those in generated node HTML.
- Verified element identity is preserved for a matching node id after a second frame render.
- Kept generated `dist/` output, existing untracked OpenSpec planning material, and the unrelated plan file out of the change set and commit.

## Concerns

- `public/index.html` already references `dist/src/main.js`, which is not part of Task 3 ownership and does not exist in this worktree. The focused tests load that page and inject the backend as required; its expected main-module 404 is visible in the static-server log but does not affect the synthetic-buffer tests. A later integration task should supply that entry point.
- Chromium needed to be installed and the Playwright command needed to run outside the filesystem sandbox because macOS Mach-port registration is denied inside it.
