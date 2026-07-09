# Task 1 Report: Browser Build, Fake App, And Portability Gates

## Implementation

- Added `synth_browser::BrowserApplication`, `BrowserAppBinding`, and the
  `SYNTH_BROWSER_APP(AppType)` generic entry macro. The browser boundary is
  defined solely in terms of `synth::SynthApplication`.
- Added `FakeBrowserApp`, including a portable surface with one button, one
  slider, and one draw node. Its audio callback writes a bounded 440 Hz sine
  signal to every available output channel.
- Added separate generic entry translation units for the fake app and
  `synth_miniapp::MiniApp`. The miniapp entry only includes its existing
  JUCE-free application header and invokes the generic macro; it contains no
  miniapp-specific browser behavior.
- Added the browser package scaffold, generic HTML root, TypeScript and
  Playwright configurations, and Emscripten-oriented static targets
  (`browser-fake-app` and `browser-miniapp`).
- Added the focused browser runtime contract binary and root/project make
  shortcuts.

## TDD Evidence

1. Added `projects/synth/tests/browser_runtime_contract_tests.cpp` before the
   browser entry boundary.
2. Ran `make -C projects/synth build/browser_runtime_contract_tests`.
   It failed as expected because no rule existed for the requested focused
   target.
3. Implemented the generic boundary and focused make target.
4. Ran `make -C projects/synth browser-unit-test`; it compiled and passed.

## Verification

- `make -C projects/synth browser-unit-test` passed.
- `make -C projects/synth/browser build` passed.
- Host C++ compilation of both `fake_app_entry.cpp` and `miniapp_entry.cpp`
  with the browser include paths passed. This checks that the generic entry
  points parse and satisfy their C++ constraints on the host compiler; it does
  not verify an Emscripten build.
- `make -C projects/synth/browser -n browser-fake-app` and
  `make -C projects/synth/browser -n browser-miniapp` produced the expected
  Emscripten WASM build commands.
- `git diff --check` passed.

## Changed Files

- `Makefile`
- `projects/synth/Makefile`
- `projects/synth/browser/Makefile`
- `projects/synth/browser/package.json`
- `projects/synth/browser/tsconfig.json`
- `projects/synth/browser/playwright.config.mjs`
- `projects/synth/browser/public/index.html`
- `projects/synth/browser/cpp/FakeBrowserApp.hpp`
- `projects/synth/browser/cpp/fake_app_entry.cpp`
- `projects/synth/browser/cpp/miniapp_entry.cpp`
- `projects/synth/include/synth/browser/BrowserAppEntry.hpp`
- `projects/synth/tests/browser_runtime_contract_tests.cpp`

## Self-Review

- The browser app concept aliases the existing full application concept, so it
  neither weakens nor adds app-specific requirements.
- `miniapp_entry.cpp` names `synth_miniapp::MiniApp` through the generic macro
  without any miniapp browser backend, HTML, or JavaScript logic.
- The browser Makefile keeps the TypeScript scaffold build independent of the
  optional Emscripten artifact targets, allowing the required portability
  checks to run without a WASM toolchain.
- Generated `node_modules`, browser `dist`, and existing excluded OpenSpec and
  plan artifacts are not staged or committed.

## Concerns

- `em++` is not installed in this environment, so the two Emscripten targets
  were dry-run only. Actual WASM binaries were not generated or verified here.

## Review Fixes

- Added a Node test-runner smoke test at
  `projects/synth/browser/tests/scaffold.test.mjs`. `npm test` now builds the
  TypeScript scaffold and runs that test, while the Playwright configuration
  remains available for future browser specifications.
- Replaced the restrictive TypeScript `files` list with include patterns for
  `src`, `tests`, and root `.mjs` configuration files.
- Added browser `dist/` and `wasm-build/` generated outputs to `.gitignore`.
- Added browser `test-results/` generated Playwright output to `.gitignore`.
- Added the missing browser Makefile `test` delegate used by
  `make synth-browser-test`.
- The entry macro now instantiates `BrowserAppBinding<AppType>`, so the public
  generic binding boundary is exercised by each browser entry point.

## Fix Verification

- `make -C projects/synth browser-unit-test`: passed.
- `make -C projects/synth/browser build`: passed.
- `npm --prefix projects/synth/browser test`: passed; Node reported 1 test,
  1 pass, and 0 failures.
- `make synth-browser-test`: passed; it ran the C++ contract binary and the
  same Node smoke test (1 pass, 0 failures).
- Host `c++ -std=c++20` compilation of `fake_app_entry.cpp` and
  `miniapp_entry.cpp`: passed as a C++ portability check only.
- `git diff --check`: passed.
- `em++` remains unavailable, so no actual WASM build was claimed or run.

## Additional Controller Cleanup

- Added `projects/synth/browser/test-results/` to `.gitignore` after the
  scaffold checks produced Playwright metadata.
- Re-ran `make -C projects/synth browser-unit-test`: passed.
- Re-ran `make -C projects/synth/browser build`: passed.
- Re-ran `npm --prefix projects/synth/browser test`: passed; Node reported
  1 test, 1 pass, and 0 failures.
- Re-ran `make synth-browser-test`: passed; it ran the C++ contract binary and
  the browser package smoke test.
- Re-ran `git diff --check`: passed.
