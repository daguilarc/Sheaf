# Task 3 Report: Browser Runtime Services And Shared Frame Routing

## Result

DONE

## Commit

`93ed553f06aedca0afca8483467b05418c40ed38` (`feat(synth): expose shared runtime shell in browser`)

## Changed Files

- `projects/synth/include/synth/browser/BrowserRuntimeMainServices.hpp`
- `projects/synth/include/synth/browser/BrowserRuntime.hpp`
- `projects/synth/include/synth/browser/BrowserAudioDevices.hpp`
- `projects/synth/include/synth/browser/BrowserMidiBridge.hpp`
- `projects/synth/tests/browser_runtime_contract_tests.cpp`
- `projects/synth/tests/browser_audio_device_tests.cpp`
- `projects/synth/tests/browser_midi_bridge_tests.cpp`
- `projects/synth/Makefile`
- `projects/synth/browser/Makefile`

## RED Evidence

1. After adding the shared-frame browser runtime contract, `make -C projects/synth browser-unit-test browser-audio-device-test browser-midi-bridge-test` exited 2. The browser runtime test aborted with `browser frame contains shared runtime root`, proving the old runtime serialized only the application surface.
2. After adding the services contract, `make -C projects/synth browser-audio-device-test browser-midi-bridge-test` exited 2 because `synth/browser/BrowserRuntimeMainServices.hpp` did not exist.
3. `make -C projects/synth browser-midi-bridge-test` exited 2 because `BrowserMidiBridge` had no `LatestDeviceList` member.

## GREEN Evidence

- `make -C projects/synth browser-unit-test browser-audio-device-test browser-midi-bridge-test`: passed.
- `make -C projects/synth browser-unit-test browser-command-buffer-test browser-audio-device-test browser-midi-bridge-test`: passed.
- `make -C projects/synth/browser browser-fake-app`: passed and produced the Emscripten fake-app module.
- `npm --prefix projects/synth/browser run check:generic-runtime`: passed.
- `git diff --check`: passed.

## Generic Boundary Evidence

- `BrowserRuntimeMainServices<App>` depends only on `Engine<App>`, `BrowserMidiBridge<Engine<App>>`, the portable runtime page types, and standard-library types.
- Runtime member lifetime order is engine, MIDI bridge, services, then `RuntimeMainComponent`.
- `BuildUiFrame` and `DispatchAction` route only through the shared component.
- Browser audio exposes and accepts only `system_default`, persists it as an empty output name, records negotiated sample rate/block size, and reports exactly `0.0f` deadline load.
- The bridge retains the latest generic `MidiDeviceList` while preserving its existing multi-device reconciliation, input, and output paths.
- `rg -n -i "miniapp|fakebrowserapp|vco|filtermodule|lfobank"` over the owned browser production headers returned no matches.
- The repository generic-runtime checker passed with the concrete typed entry remaining its only allowed binding.
- Existing Task 4 HTML, CSS, TypeScript, and Playwright working-tree changes were neither edited nor committed.

## Self-Review

- Confirmed `MessageTick` runs the engine tick before refreshing the shared page models.
- Confirmed `Prepare` records only negotiated audio status after successful engine preparation and does not alter scheduling.
- Confirmed controller callbacks read instrument state through `InstrumentSnapshot`, mutate through `EditInstrument`, and read connection/device state through the bridge.
- Confirmed file actions call the same generic `PatchManager` operations as the JUCE services adapter and expose `Engine::DataPaths().patchesRoot`.
- Confirmed no changes were made to JavaScript scheduling, worklet code, ring-buffer behavior, DSP, or WASM render allocations.

## Concerns

- The Emscripten build emits the pre-existing `USE_PTHREADS is deprecated` warning. The build exits successfully, and changing the browser toolchain flags is outside this task.

## Code-Review Fix

Commit: `758963f5` (`test(synth): cover browser runtime services`)

### Coverage Added

- Drove `BrowserRuntime::Prepare` through the generic contract app, asserted the app hook and the shared Audio page's `System Default: 48000 Hz, 128 frames` line, and covered the oversized `size_t` block rejection.
- Covered shared Controllers and File navigation, root replacement, and Back restoration in addition to Audio.
- Submitted a four-endpoint/two-controller browser MIDI snapshot and asserted both endpoint lists, online selections, callback-driven endpoint commit, dirty refresh, and persisted save-on-Back configuration.
- Exercised File New, Save without a current patch, Save As, current-patch Save, rejected non-overwrite Save As, overwrite Save As, Load, and Revert through real browser runtime audio/message ticks and deterministic temporary filesystem outcomes.
- Removed the duplicate block-size range check from `BrowserRuntimeMainServices::RecordAudioNegotiation`; `BrowserRuntime::Prepare` remains the sole validating boundary and calls the service only after validation succeeds.

### Mutation Evidence

- Temporarily replaced `RecordAudioNegotiation` with a no-op. `make -C projects/synth browser-unit-test` exited 2 at `audio page reports the negotiated default output`. Restored the real implementation and the target passed.
- Temporarily replaced `RefreshControllers` device publication with an empty list. The same target exited 2 at `controller input uses latest multi-device enumeration`. Restored the real implementation and the target passed.
- Neither mutation was retained in the commit.

### Fresh Verification

- `make -C projects/synth browser-unit-test browser-command-buffer-test browser-audio-device-test browser-midi-bridge-test`: passed.
- `make -C projects/synth/browser browser-fake-app`: passed.
- `npm --prefix projects/synth/browser run check:generic-runtime`: passed.
- `git diff --check`: passed.
- Existing Task 4 HTML, CSS, TypeScript, and Playwright working-tree changes were not edited or staged.
