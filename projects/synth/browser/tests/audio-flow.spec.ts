import { expect, test } from "@playwright/test";

test("reports a cross-origin isolation diagnostic before creating audio", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async () => {
    const { AudioBridge } = await (new Function("return import('/dist/src/audio.js')") as () => Promise<{ AudioBridge: new (worker: unknown) => { startFromUserActivation(): Promise<unknown> } }>)();
    Object.defineProperty(globalThis, "SharedArrayBuffer", { configurable: true, value: undefined });
    const bridge = new AudioBridge({ postMessage() {} });
    return bridge.startFromUserActivation();
  });

  expect(result).toEqual({ started: false, diagnostic: "cross-origin-isolation-required" });
});

test("starts a worklet from user activation and copies finite non-silent samples", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/public/index.html");
  const result = await page.evaluate(async () => {
    const { AudioBridge } = await (new Function("return import('/dist/src/audio.js')") as () => Promise<{ AudioBridge: new (worker: unknown, options: unknown) => { startFromUserActivation(): Promise<unknown> } }>)();
    const { AUDIO_RING_STATE, SharedRingBuffer } = await (new Function("return import('/dist/src/protocol.js')") as () => Promise<{ AUDIO_RING_STATE: { availableFrames: number }; SharedRingBuffer: { fromDescriptor(descriptor: unknown): { write(channels: Float32Array[], frames: number): number } } }>)();

    const calls: string[] = [];
    class TestAudioContext {
      readonly sampleRate = 48000;
      readonly destination = {};
      readonly audioWorklet = { addModule: async (url: string) => { calls.push(`module:${url}`); } };
      async resume() { calls.push("resume"); }
    }
    class TestAudioWorkletNode {
      readonly port = { postMessage: (message: unknown) => { (this as unknown as { message: unknown }).message = message; } };
      connect(destination: unknown) { calls.push(destination === context.destination ? "connect" : "wrong-destination"); }
    }
    const context = new TestAudioContext();
    const workerMessages: unknown[] = [];
    const bridge = new AudioBridge(
      { postMessage(message: unknown) { workerMessages.push(message); } },
      { audioContextFactory: () => context, audioWorkletNodeFactory: () => new TestAudioWorkletNode() as unknown as AudioWorkletNode },
    );
    const started = await bridge.startFromUserActivation();
    const message = workerMessages[0] as { type: string; sampleRate: number; blockSize: number; bridge: { channels: number; capacityFrames: number; samples: SharedArrayBuffer; state: SharedArrayBuffer } };
    const ring = SharedRingBuffer.fromDescriptor(message.bridge);
    ring.write([Float32Array.from([0.25, -0.25, 0.5]), Float32Array.from([0.25, -0.25, 0.5])], 3);

    let Processor: (new (options: { processorOptions: unknown }) => { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean }) | undefined;
    (globalThis as unknown as { AudioWorkletProcessor: new () => object; registerProcessor(name: string, processor: typeof Processor): void }).AudioWorkletProcessor = class {};
    (globalThis as unknown as { registerProcessor(name: string, processor: typeof Processor): void }).registerProcessor = (_name, processor) => { Processor = processor; };
    await import(`/dist/src/audio-worklet.js?test=${Date.now()}`);
    const processor = new Processor!({ processorOptions: message.bridge });
    const outputs = [[new Float32Array(5), new Float32Array(5)]];
    const alive = processor.process([], outputs);
    const samples = outputs[0].flatMap((channel) => Array.from(channel));
    return { isolated: crossOriginIsolated, started, calls, workerMessages: workerMessages.length,
      configuration: { type: message.type, sampleRate: message.sampleRate, blockSize: message.blockSize }, alive, samples,
      available: Atomics.load(new Int32Array(message.bridge.state), AUDIO_RING_STATE.availableFrames) };
  });

  expect(result.isolated).toBe(true);
  expect(result.started).toEqual({ started: true });
  expect(result.calls).toEqual([expect.stringContaining("audio-worklet.js"), "connect", "resume"]);
  expect(result.workerMessages).toBeGreaterThanOrEqual(1);
  expect(result.configuration).toEqual({ type: "configure-audio", sampleRate: 48000, blockSize: 128 });
  expect(result.alive).toBe(true);
  expect(result.samples.every(Number.isFinite)).toBe(true);
  expect(result.samples.some((sample) => sample !== 0)).toBe(true);
  expect(result.samples.slice(3, 5)).toEqual([0, 0]);
  expect(result.available).toBe(0);
});
