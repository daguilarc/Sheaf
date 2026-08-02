# Task 5 Report: Browser ABI and Native AudioWorklet Input

## What I Implemented

- Updated the browser C ABI to version 3.
- Added native browser audio input ABI surface:
  - `synth_browser_audio_input_channels`
  - `synth_browser_set_audio_input_source`
  - `synth_browser_clear_audio_input_source`
  - `synth_browser_consume_audio_input_retry`
- Added `kMaxBrowserInputChannels = 32` and `BrowserAudioInputStatus`.
- Added atomic runtime storage for requested input count, published physical input count, input source handle, input status, and retry state.
- Added native planar AudioWorklet adaptation:
  - zero requested inputs create a node with `numberOfInputs = 0`.
  - positive requested inputs create one input bus with explicit/discrete channel configuration.
  - callback adapts fixed planar input/output descriptors using fixed `std::array` storage.
  - active input channels are clamped to min(input bus channels, published physical channels, requested channels).
  - stale/absent input sources read as silence.
  - output remains native C++ DSP; no JavaScript DSP or realtime allocation path was added.
- Updated the TypeScript Emscripten facade to require ABI v3 input exports, register `AudioNode` sources module-locally, validate positive physical channel counts, clear sources, and consume retry flags.
- Updated builder exports, fake/scaffold/package checks, browser catalog docs, publisher docs, and browser README wording to ABI v3.

## What I Tested

- `make -C projects/synth browser-unit-test`
  - PASS
- `npm --prefix projects/synth/browser run build`
  - PASS
- `npx playwright test tests/runtime-core.spec.ts` from `projects/synth/browser`
  - PASS: 11/11
- `node --test dist/tests/build-browser-apps.test.mjs dist/tests/scaffold.test.mjs dist/tests/package-contract.test.mjs` from `projects/synth/browser`
  - PASS: 21/21
- `make -C projects/synth browser-unit-test browser-audio-device-test`
  - PASS
- Realtime callback/helper forbidden-term scan for `new | std::vector | std::string | getUserMedia | emscripten_run_script`
  - PASS: no matches in the scanned callback/helper bodies
- `make -C projects/synth test`
  - PASS: exit 0
  - Existing suite output includes one `[trace] concrete_sender ...` diagnostic line.
- `make -C projects/synth/browser browser-apps`
  - PASS: exit 0
  - Existing Emscripten warnings about `-pthread + ALLOW_MEMORY_GROWTH` and deprecated `USE_PTHREADS`.
- `npm --prefix projects/synth/browser run publish:site`
  - PASS: published `dist/site`
- `env -u FORCE_COLOR -u NO_COLOR npm test` from `projects/synth/browser`
  - PASS: Node 87/87, Playwright 163 passed / 2 skipped
  - Existing Emscripten warnings about `-pthread + ALLOW_MEMORY_GROWTH` and deprecated `USE_PTHREADS`.
- `git diff --check`
  - PASS
- Stale ABI-v2 scan across `projects/synth`
  - PASS: no remaining ABI-v2/browser ABI 2 contract references found.

## TDD Evidence

### RED

- Command: `make -C projects/synth browser-unit-test`
- Expected failure before implementation:
  - C++ compile failed because the new tests referenced missing ABI v3/input symbols, including `AudioInputChannels`, `SetAudioInputSource`, `BrowserAudioInputStatus`, `synth_browser_audio_input_channels`, and `BrowserAudioSampleFrameDescriptor`.
- Why expected:
  - The RED tests were written against Task 5's new browser ABI and native worklet input contract before those API surfaces existed.

Browser/TypeScript RED was also attempted before implementation:

- `npm --prefix projects/synth/browser run build`
  - Failed initially because local browser dev dependencies were not installed (`tsc: command not found`).
- `npx --prefix projects/synth/browser playwright test tests/runtime-core.spec.ts`
  - Failed initially because `@playwright/test` was not available locally.
- The TypeScript/runtime-core tests added before implementation were later covered by the GREEN focused and full browser suite once dependencies were available.

### GREEN

- Command: `make -C projects/synth browser-unit-test`
  - PASS
- Command: `npx playwright test tests/runtime-core.spec.ts`
  - PASS: 11/11
- Command: `node --test dist/tests/build-browser-apps.test.mjs dist/tests/scaffold.test.mjs dist/tests/package-contract.test.mjs`
  - PASS: 21/21
- Command: `make -C projects/synth test`
  - PASS: exit 0
- Command: `env -u FORCE_COLOR -u NO_COLOR npm test`
  - PASS: Node 87/87, Playwright 163 passed / 2 skipped

## Files Changed

- `.superpowers/sdd/2026-08-02-add-synth-audio-input/task-5-report.md`
- `projects/synth/browser/README.md`
- `projects/synth/browser/cpp/BrowserRuntimeAbi.cpp`
- `projects/synth/browser/docs/catalog-schema-v1.md`
- `projects/synth/browser/docs/publisher-guide.md`
- `projects/synth/browser/src/build-browser-apps.mjs`
- `projects/synth/browser/src/protocol.ts`
- `projects/synth/browser/src/static-server.mjs`
- `projects/synth/browser/src/worker.ts`
- `projects/synth/browser/tests/activation-lease.spec.ts`
- `projects/synth/browser/tests/build-browser-apps.test.mjs`
- `projects/synth/browser/tests/github-pages-workflow.test.mjs`
- `projects/synth/browser/tests/helpers/fake-app.ts`
- `projects/synth/browser/tests/launcher.spec.ts`
- `projects/synth/browser/tests/midi-flow.spec.ts`
- `projects/synth/browser/tests/midi-timing.test.mjs`
- `projects/synth/browser/tests/package-contract.test.mjs`
- `projects/synth/browser/tests/package-loader.spec.ts`
- `projects/synth/browser/tests/persistence.spec.ts`
- `projects/synth/browser/tests/publish-site.test.mjs`
- `projects/synth/browser/tests/runtime-core.spec.ts`
- `projects/synth/browser/tests/scaffold.test.mjs`
- `projects/synth/browser/tests/static-site.spec.ts`
- `projects/synth/browser/tests/two-origin-package.spec.ts`
- `projects/synth/docs/coverage.md`
- `projects/synth/include/synth/browser/BrowserRuntime.hpp`
- `projects/synth/tests/browser_runtime_contract_tests.cpp`

## Self-Review Findings

- Found and fixed a stale `catalogAbiVersion` assertion in `two-origin-package.spec.ts`.
- Found and fixed stale browser ABI v2 documentation references in the browser catalog docs, README, publisher guide, and coverage matrix.
- Confirmed browser full-suite failures from the first full run were caused by missing generated `dist/wasm/apps` and `dist/site` artifacts plus the stale v2 assertion. After rebuilding first-party apps and publishing the site, the full browser suite passed.
- Confirmed no JavaScript DSP or getUserMedia lifecycle work was added; that remains Task 6.

## Issues or Concerns

- No implementation concerns.
- Test output is not completely silent because existing Emscripten compiler flags emit warnings during browser app builds, and the native suite includes an existing MIDI sender trace diagnostic.

## Review Fix Report

Reviewer `Leibniz` found no Critical or Important issues. Two Minor edge risks were fixed before final reporting:

- `Runtime<App>::SetAudioInputSource` now publishes the accepted source handle, status, physical channel count, and retry state before a newly connected source can become observable by the running Emscripten AudioWorklet node.
- The TypeScript Emscripten facade now validates `physicalChannels` as `1..32` and `statusCode` as `0..7` before calling module-local `emscriptenRegisterAudioObject`, so rejected calls do not register unused native audio objects.
- `runtime-core.spec.ts` now verifies invalid input channel/status values reject before any AudioNode registration or native set/clear call.

Covering tests after the review fixes:

- Command: `npm --prefix projects/synth/browser run build && cd projects/synth/browser && env -u FORCE_COLOR -u NO_COLOR npx playwright test tests/runtime-core.spec.ts`
  - Output: TypeScript build passed; Playwright `tests/runtime-core.spec.ts` passed 11/11.
- Command: `make -C projects/synth browser-unit-test browser-audio-device-test`
  - Output: `build/browser_runtime_contract_tests` and `build/browser_audio_device_tests` passed.
- Command: realtime callback/helper forbidden-term scan for `new | std::vector | std::string | getUserMedia | emscripten_run_script`
  - Output: no matches, exit 0.
- Command: `git diff --check`
  - Output: no whitespace errors, exit 0.
- Command: `make -C projects/synth/browser browser-fixture-app`
  - Output: Emscripten fixture app build passed; existing warnings about `-pthread + ALLOW_MEMORY_GROWTH` and deprecated `USE_PTHREADS` were emitted.
