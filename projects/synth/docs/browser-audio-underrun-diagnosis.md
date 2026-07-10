# Browser Audio Underrun Diagnosis

Last investigated: 2026-07-10

## Finding

At the current Chrome configuration, the browser producer is scheduled more
slowly than the AudioWorklet consumes audio. At 48 kHz with 128-frame render
blocks:

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

The scheduling behavior is in
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

## Scope And Follow-up

This branch intentionally makes **no audio scheduler, ring-buffer, sample-rate,
DSP, or per-block allocation changes**. Its audio-flow tests establish that the
WASM DSP can produce finite, non-silent samples; they do not claim realtime
underrun safety.

The follow-up should be a separate render-ahead/watermark scheduler design. It
should prefill the ring before playback, observe available frames, and render
enough blocks to restore a chosen high-water mark whenever the ring falls below
a low-water mark. Scheduling from ring occupancy, instead of one rounded timer
tick per block, removes the guaranteed rate mismatch and provides tolerance for
browser wake-up jitter. That design should also evaluate persistent WASM output
buffers so allocation and copy pressure is measured and addressed independently
from the scheduler correction.
