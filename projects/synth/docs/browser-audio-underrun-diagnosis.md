# Browser Audio Underrun Diagnosis

Last investigated: 2026-07-10

## Finding

The original JavaScript ring-producer path was scheduled more slowly than the
AudioWorklet consumed audio. At 48 kHz with 128-frame render blocks:

```text
consumer rate = 48,000 / 128 = 375 blocks/s
producer interval = round(128 * 1,000 / 48,000) = 3 ms
requested producer rate = 1,000 / 3 = 333.33 blocks/s
shortfall = 375 - 333.33 = 41.67 blocks/s
          = 41.67 * 128 = 5,333 frames/s
          = 11.11% of required throughput
```

The timer deficit alone guarantees underruns even if every callback and render
finishes on time. The current producer can request only 88.89% of the blocks
that the worklet consumes. Main-thread timer jitter can only increase that
deficit.

That legacy scheduling behavior lives behind the fallback path in
[`audio.ts`](../browser/src/audio.ts): startup requests one block and then uses
a rounded millisecond `setInterval`. This provides only an initial one-block
buffering target, rather than a render-ahead reserve. Because the audio context
is resumed before the first render request completes, the worklet can also run
before that first block reaches the ring.

## Audible Failure Path

[`audio-worklet.ts`](../browser/src/audio-worklet.ts) reads at most the number
of frames currently available in the shared ring. For every unavailable frame
in an output callback it writes `0`, and it increments `underflowCount` whenever
the available count is smaller than the callback frame count. The guaranteed
producer deficit therefore becomes repeated zero-filled discontinuities, which
can sound like a steady whine or xrun-style artifacts rather than merely lower
throughput.

There is also secondary pressure in
[`worker.ts`](../browser/src/worker.ts). Each `render-audio` operation allocates
a WASM output-pointer array and one output buffer per channel, invokes the DSP,
copies every channel out with `HEAPF32.slice`, and then frees all of those
allocations. That per-block allocation and copy work can worsen timing and
jitter, but it is not needed to explain the deterministic 11.11% scheduling
shortfall.

## Resolution And Remaining Verification

This branch replaces the static-site default audio path with a runtime-owned
Emscripten Wasm AudioWorklet callback. Chrome creates the WebAudio context from
the page-loaded WASM module, starts the Wasm AudioWorklet thread, and invokes
the same generic `Runtime<App>::Process` path against the same runtime/engine
state used by UI, MIDI, patch, and controller edits. The JavaScript
ring-producer remains only as an injected-runtime fallback/diagnostic path.

The remaining verification gap is environmental: the real Chrome/Playwright
callback test exists, but sandboxed Chromium fails before test code runs on
macOS Mach-port registration in this harness, and unsandboxed launch approval
is currently unavailable. Native contract tests, TypeScript builds, Node unit
tests, and Emscripten miniapp/fake-app links cover the generic integration
until that browser run can be repeated.

Shutdown also keeps the erased C++ runtime object alive after a Wasm
AudioWorklet has been scheduled. Emscripten's destroy path suspends/deletes the
JavaScript WebAudio handles but does not expose a synchronous join for the Wasm
AudioWorklet thread. Retaining the runtime and its worklet stack for the page
lifetime avoids freeing callback userdata while late audio-thread callbacks may
still be unwinding.
