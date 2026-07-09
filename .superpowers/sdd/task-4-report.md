STATUS: DONE_WITH_CONCERNS

# Task 4 Report: Generic Browser Runtime C++ Core And ABI

## Files Changed

- `projects/synth/include/synth/browser/BrowserRuntime.hpp`
  - Adds `synth_browser::Runtime<App>` over `synth::Engine<App>` with runtime-data-path injection, start/stop, prepare, output-only processing, message ticks, portable UI command-buffer production, and surface action dispatch.
  - Defines the opaque-handle ABI adapter, retaining each UI frame until the next frame request or destruction.
- `projects/synth/include/synth/browser/BrowserAppEntry.hpp`
  - Makes `SYNTH_BROWSER_APP(AppType)` the sole concrete-app binding point by instantiating a generic runtime adapter factory.
- `projects/synth/browser/cpp/BrowserRuntimeAbi.cpp`
  - Implements the generic C ABI: `synth_browser_create`, `synth_browser_initialize`, `synth_browser_prepare`, `synth_browser_process`, `synth_browser_message_tick`, `synth_browser_build_ui_frame`, `synth_browser_dispatch_action`, and `synth_browser_destroy`.
- `projects/synth/browser/src/worker.ts`
  - Adds the Emscripten facade, worker lifecycle protocol, UI-frame transfer, action/audio/message-tick forwarding, status messages, and post-destroy rejection.
- `projects/synth/browser/tests/runtime-core.spec.ts`
  - Covers fake ABI runtime lifecycle, portable action dispatch, UI frame retrieval, no concrete-app HTML, and rejection after destroy.
- `projects/synth/browser/Makefile`
  - Builds generic modularized Emscripten runtime modules with the ABI exports for both existing entry targets.
- `projects/synth/browser/package.json`
  - Adds the no-app-branch scan for browser source, headers, and generic ABI code.

## Commit Created

- `1a505a97 feat(synth): add generic browser runtime core`

## TDD Evidence

- Red: `npm --prefix projects/synth/browser test -- runtime-core.spec.ts` failed before implementation with `TS2307: Cannot find module '../dist/src/worker.js'`.
- Green: the same focused test command now passes all build, no-app-branch, Node, and Playwright checks.

## Tests Run

1. `clang++ -std=c++20 -Iprojects/synth/include -Iprojects/synth/browser/cpp -fsyntax-only projects/synth/browser/cpp/BrowserRuntimeAbi.cpp projects/synth/browser/cpp/fake_app_entry.cpp`
   - Exit `0`; generic ABI and concrete entry binding compile together.
2. `make -C projects/synth browser-unit-test`
   - Exit `0`; `browser_runtime_contract_tests` rebuilt and ran.
3. `npm --prefix projects/synth/browser test -- runtime-core.spec.ts`
   - Exit `0`; generic source scan passed, Node scaffold test passed, and Playwright reported `2 passed`.
4. `git diff --check`
   - Exit `0`; no whitespace errors.

## Self-Review

- `BrowserRuntimeAbi.cpp` contains no concrete application type; the type-erased factory is generated only by the browser entry macro.
- The browser runtime and worker contain no miniapp or concrete-widget branch. The package scan enforces the forbidden identifiers.
- Audio input is not introduced. The worker ABI process call remains output-only until the later audio bridge task.
- UI frames are bounded-copy at the worker boundary and runtime-owned in the C++ ABI between frame requests.

## Concerns

- `em++` is not installed in this environment, so the modularized WASM artifacts were not produced here. The C++ ABI/entry boundary was syntax-compiled with `clang++`, and the focused required gates passed.
