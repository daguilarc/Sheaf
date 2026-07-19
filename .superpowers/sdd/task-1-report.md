# Task 1 Report: Native Browser Audio

## Result

- Status: `DONE`
- Commit message: `fix(synth-browser): restore native callback audio`
- The browser launcher now uses the Emscripten runtime's native AudioWorklet callback path exclusively.
- The JavaScript ring-buffer producer/consumer path and launcher-owned worklet module were removed.
- A supplied activation-lease `AudioContext` is registered module-locally and passed to the native runtime as a WebAudio handle; direct native ownership still uses handle `0`.
- Audio startup is not considered online until native block progress is observed.
- OpenSpec checkboxes were not modified.
- The pre-existing `.superpowers/sdd/progress.md` edit, `projects/synth/browser/package-lock.json`, and `projects/synth/miniapp/` artifacts were preserved and excluded from staging.
- This report is included in the task commit; its SHA is returned to the controller because a commit cannot contain its own final SHA.

## Pinned Emscripten Adoption Probe

The repository CI pin is Emscripten `6.0.3`. The exact SDK was cloned into `/private/tmp/sheaf-task1-emsdk-603`, installed, and activated before production changes.

Pinned toolchain identity:

```text
emcc 6.0.3 (283e2d130132859fde6a4e4c87fd254b38127651)
Emscripten toolchain release SDK: 9074aa...
emsdk git revision: c68d67a...
```

The probe inspected the pinned `libwebaudio.js` implementation of `emscriptenRegisterAudioObject`, then compiled a disposable native AudioWorklet callback with the production flags:

```text
-pthread
-sUSE_PTHREADS=1
-sPTHREAD_POOL_SIZE=1
-sINITIAL_MEMORY=268435456
-sSTACK_SIZE=16777216
-sAUDIO_WORKLET=1
-sWASM_WORKERS=1
-sMODULARIZE=1
-sEXPORT_ES6=1
-sENVIRONMENT=web,worker
-sWASM_BIGINT
-sEXPORTED_RUNTIME_METHODS=["emscriptenRegisterAudioObject"]
```

The first Chromium attempt was blocked by the macOS sandbox's Mach-port restriction. The unchanged probe was rerun outside the sandbox and exited `0`:

```json
{"registrationCallable":true,"handle":1,"validHandle":true,"accepted":true,"nativeStatus":3,"observedContext":1,"sampleRate":48000,"quantum":128,"blocks":8,"contextState":"running","sameContextHandle":true}
```

This proved that Emscripten 6.0.3 can register the already-resumed leased context, return a valid module-local handle, start the native callback on that exact context, and advance native DSP blocks. The stop gate therefore passed before implementation.

## Implementation

### Native callback ownership

- Bumped the browser ABI to `2` and changed `synth_browser_start_audio_worklet` to accept a WebAudio context handle.
- Extended `BrowserRuntime::StartAudioWorklet` to use a nonzero supplied handle or create a runtime-owned context for handle `0`.
- Preserved `BrowserRuntime::ProcessAudioWorklet` as the sole native DSP callback path.
- Exported `emscriptenRegisterAudioObject` from both browser build variants.
- Required the Emscripten facade to expose both context registration and native startup before runtime creation.
- Registered a supplied `AudioContext` in the loaded module's own JS realm and passed the resulting handle to native code.

### Fail-closed startup and lifecycle

- Removed `configure-audio`, `render-audio`, and `start-audio-worklet` worker commands, shared ring descriptors, render timers, and the launcher `AudioWorkletProcessor` module.
- Replaced the audio bridge with a thin native-start coordinator; there is no JavaScript DSP fallback.
- Added direct-realm startup progress gating: native block count must advance and the callback deadline must remain finite before startup resolves.
- Reused the single activation-lease `AudioContext`; the launcher does not create a second context.
- Made teardown await runtime destruction before closing the leased context and disposing the package.
- Kept the browser worker/package contract generic and extended the generic-runtime scan to reject legacy fallback identifiers.

### Packaging and real smoke coverage

- Removed launcher publication of `audio-worklet.js`; package-owned Emscripten runtime helpers remain ordinary package artifacts.
- Updated publish/scaffold contracts for the native runtime helper.
- Updated the real miniapp smoke test to use the direct runtime, one leased context, native progress evidence, and explicit teardown-order assertions.

## TDD RED Evidence

### Browser lifecycle RED

After changing the focused contracts and before production implementation:

```text
npm run build && npx playwright test tests/audio-flow.spec.ts tests/activation-lease.spec.ts tests/runtime-core.spec.ts
```

Observed: exit nonzero, `19 passed`, `3 failed`. The missing-native-support and leased-context cases entered the old JavaScript fallback and attempted `context.audioWorklet.addModule`; the lifecycle case reported `JavaScript AudioWorklet fallback`. This proved the ring/fallback path was still active.

### Native ABI RED

After changing the native contract test and before changing production declarations:

```text
make -C projects/synth build/browser_runtime_contract_tests
```

Observed: compilation failed because the test override expected `StartAudioWorklet(uint32_t)` while production still exposed the zero-argument method. This proved the native context-handle boundary was absent.

### Direct runtime RED

After adding the direct-start contract and before adding the production method:

```text
npm run build && npx playwright test tests/runtime-core.spec.ts
```

Observed: TypeScript compilation failed because `BrowserRuntimeWorker` did not expose `startAudioWorklet`. This proved native startup was not yet reachable from the direct module realm.

## GREEN Evidence

### Required native contracts

```text
make -C projects/synth build/browser_runtime_contract_tests
projects/synth/build/browser_runtime_contract_tests
```

Observed: both exited `0`; the production ABI adapter linked successfully and all native assertions passed.

### Required browser gates

```text
npm --prefix projects/synth/browser run build
npm --prefix projects/synth/browser run check:generic-runtime
npx --prefix projects/synth/browser playwright test tests/audio-flow.spec.ts tests/activation-lease.spec.ts tests/runtime-core.spec.ts
```

Observed: all exited `0`; TypeScript and the generic-runtime scan passed, and focused Playwright reported `23 passed`.

### Real pinned-toolchain smoke

The miniapp module was rebuilt with the exact Emscripten 6.0.3 SDK and the production browser flags, then the publication/scaffold and full miniapp smoke gates ran:

```text
make browser-miniapp EMXX=/private/tmp/sheaf-task1-emsdk-603/upstream/emscripten/em++ EMSDK=/private/tmp/sheaf-task1-emsdk-603 EM_CACHE=/private/tmp/sheaf-task1-production-em-cache
npm run build && node --test dist/tests/publish-site.test.mjs dist/tests/scaffold.test.mjs
SYNTH_BROWSER_FAKE_GATE_CONFIRMED=1 npx playwright test tests/miniapp-smoke.spec.ts
```

Observed: build exited `0`; Node reported `14 passed`; Playwright reported `7 passed`. The real callback block counter advanced on the leased context and all deadline samples were finite.

### Final hygiene

```text
rg -n 'renderTimer|configure-audio|render-audio|SharedRingBuffer|synth-audio-ring-buffer' projects/synth/browser/src
git diff --check
```

Observed: the fallback scan returned no matches; `git diff --check` exited `0`.

## Files Changed

- `.superpowers/sdd/task-1-report.md`
- `projects/synth/browser/Makefile`
- `projects/synth/browser/cpp/BrowserRuntimeAbi.cpp`
- `projects/synth/browser/src/audio-worklet.ts` (removed)
- `projects/synth/browser/src/audio.ts`
- `projects/synth/browser/src/main.ts`
- `projects/synth/browser/src/protocol.ts`
- `projects/synth/browser/src/publish-site.mjs`
- `projects/synth/browser/src/worker.ts`
- `projects/synth/browser/tests/activation-lease.spec.ts`
- `projects/synth/browser/tests/audio-flow.spec.ts`
- `projects/synth/browser/tests/check-generic-runtime.mjs`
- `projects/synth/browser/tests/miniapp-smoke.spec.ts`
- `projects/synth/browser/tests/publish-site.test.mjs`
- `projects/synth/browser/tests/runtime-core.spec.ts`
- `projects/synth/browser/tests/scaffold.test.mjs`
- `projects/synth/include/synth/browser/BrowserRuntime.hpp`
- `projects/synth/tests/browser_runtime_contract_tests.cpp`

## Self-Review

- Re-read the Task 1 brief, OpenSpec proposal/design/tasks, and affected specifications after implementation.
- Confirmed one exact Emscripten 6.0.3 adoption probe ran before production edits and exercised the supplied-context native callback path.
- Confirmed browser ABI `2` is consistent in TypeScript, native exports, and tests.
- Confirmed handle `0` retains direct native context ownership and nonzero handles are module-local registrations of the already-resumed leased context.
- Confirmed native progress, not successful setup alone, is the online gate.
- Confirmed there is no ring-buffer transport, JavaScript sample production loop, launcher AudioWorklet processor, or fallback branch in browser source.
- Confirmed teardown order is runtime destruction, leased context close, then package disposal.
- Confirmed package publication remains generic and contains no application-specific runtime branch.
- Confirmed generated screenshot/result artifacts were restored or removed before staging.
- Confirmed the protected progress edit, package lock, and miniapp directory remain unstaged.

## Concerns

None. Generated Emscripten output remains intentionally untracked; verification rebuilt and exercised it from the changed source and pinned toolchain.
