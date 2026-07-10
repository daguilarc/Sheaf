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

# Task 4 Report: Shared Portable Waveform Drawing

## Status

Implemented and locally verified.

## Summary

- Extracted MiniApp scope waveform drawing into shared JUCE-free portable UI
  code under `synth::ui`.
- Added `synth::ui::WaveformLayerDrawState`.
- Added `synth::ui::BuildScopeWaveformCommands(...)`, preserving the MiniApp
  behavior for dark background fill, inset plotting bounds, centerline,
  connected/scope filtering, transfer-split polylines, clamped Y positions,
  and optional transfer markers.
- Updated MiniApp compatibility names so existing VCO/LFO waveform builders
  delegate to the shared helper.
- Added portable UI tests covering shared helper compilation, separate-bounds
  clipping, four-cell clipping, and MiniApp wrapper equivalence.
- Added `apps/miniapp/MiniAppDraw.hpp` to the `portable_ui_tests` Makefile
  dependency list because the wrapper-equivalence test now includes it.

## Files changed

- `projects/synth/include/synth/PortableUIBuilders.hpp`
- `projects/synth/apps/miniapp/MiniAppDraw.hpp`
- `projects/synth/tests/portable_ui_tests.cpp`
- `projects/synth/Makefile`

## RED command/result

- `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`
- Result: failed as expected before implementation because
  `synth::ui::WaveformLayerDrawState` and
  `synth::ui::BuildScopeWaveformCommands` did not exist. The initial RED also
  exposed a test-helper mistake returning non-copyable `ScopeWriter`, which
  was corrected while keeping the shared-API failures as the meaningful RED
  signal.

## GREEN commands/results

- `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`
  - Result: pass.
- `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`
  - Result: pass; all MiniApp system tests reported `[PASS]`.
- `git diff --check -- projects/synth/include/synth/PortableUIBuilders.hpp projects/synth/apps/miniapp/MiniAppDraw.hpp projects/synth/apps/miniapp/MiniAppUiModel.hpp projects/synth/apps/miniapp/MiniAppUI.hpp projects/synth/juce/WaveformComponents.hpp projects/synth/tests/portable_ui_tests.cpp projects/synth/juce/MiniAppJuceBackendParityTests.cpp projects/synth/Makefile`
  - Result: pass.
- `rg -n "TODO|FIXME|NEEDS_CONTEXT|BLOCKED" projects/synth/include/synth/PortableUIBuilders.hpp projects/synth/apps/miniapp/MiniAppDraw.hpp projects/synth/tests/portable_ui_tests.cpp`
  - Result: no matches.

## Review finding and fix

- Review verdict: `REVISE`.
- Critical finding: removing `synth_miniapp::ScopePathMath` broke existing
  JUCE-side consumers:
  - `projects/synth/juce/PathDrawer.hpp`
  - `projects/synth/juce/EncoderComponentGeometryTests.cpp`
- Fix: restored `synth_miniapp::ScopePathMath` in `MiniAppDraw.hpp` as a
  compatibility shim forwarding the previous constants/functions to the new
  shared `synth::ui::waveform_detail` implementation.
- Fix verification:
  - `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`
    - Result: pass.
  - `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`
    - Result: pass; all MiniApp system tests reported `[PASS]`.
  - `make -C projects/synth/apps/miniapp /Users/joyo/.codex/worktrees/0546c445-dea2-4148-bd24-0451d943ed00/Sheaf/projects/synth/apps/miniapp/build/encoder_component_geometry_tests && projects/synth/apps/miniapp/build/encoder_component_geometry_tests`
    - Result: pass; final output included `Encoder geometry tests passed`.
      The run also printed the expected missing-device
      `CoreMIDI error: 580 - 10000003` probe warning.

## Self-review

- Scope remained limited to shared portable waveform drawing and MiniApp
  compatibility wrappers.
- No Dresden core, UI, runtime, or oversampling wiring was added.
- No Dresden-to-MiniApp dependency was introduced.
- The shared helper still uses `synth::Color` for compatibility with current
  module/UI state and converts to `synth::ui::Color` internally.
- MiniApp wrapper command counts and colors are tested against the shared
  helper, which guards against accidental divergence.

## Concerns

- `PortableUIBuilders.hpp` now depends on `DspScope.hpp` and
  `ParameterModulation.hpp` for waveform drawing. This is appropriate for the
  new shared helper, but if portable UI builders should stay semantically
  lighter long-term, a future cleanup could split waveform drawing into a
  dedicated portable waveform header.

## Commit hash

- `fe5e544e55abc32840fcf6d8d69477b56319e9e0`
  (`refactor: share scope waveform drawing`)
- `752d94758962f1f43b45df7c14a229a1cb5ffa96`
  (`fix: preserve miniapp scope path compatibility`)
