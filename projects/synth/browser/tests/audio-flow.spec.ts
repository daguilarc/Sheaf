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

test("real miniapp WASM renders four finite non-silent audio blocks", async ({ page }) => {
  await page.route("**/dist/src/main.js*", (route) => {
    if (new URL(route.request().url()).search) return route.continue();
    return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  });
  await page.goto("http://127.0.0.1:4174/public/index.html");
  const blocks = await page.evaluate(async () => {
    const { SharedRingBuffer } = await (new Function("return import('/dist/src/protocol.js')")() as Promise<any>);
    const worker = new Worker("/dist/src/worker.js", { type: "module" });
    const request = (command: unknown, expected: string) => new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${expected}`)), 10_000);
      const receive = (event: MessageEvent<any>) => {
        if (event.data.type === "page-status") return;
        if (event.data.type !== expected && event.data.type !== "error") return;
        clearTimeout(timeout);
        worker.removeEventListener("message", receive);
        event.data.type === "error" ? reject(new Error(event.data.error)) : resolve(event.data);
      };
      worker.addEventListener("message", receive);
      worker.postMessage(command);
    });
    await request({ type: "load", moduleUrl: new URL("/dist/wasm/miniapp.js", location.href).href }, "ok");
    await request({ type: "create" }, "created");
    await request({ type: "initialize", dataRoot: "/data" }, "ok");
    const ring = SharedRingBuffer.create(2, 1024);
    await request({ type: "configure-audio", sampleRate: 48_000, blockSize: 128, bridge: ring.descriptor() }, "ok");
    await request({ type: "midi-input", controllerIx: 0, bytes: [0x90, 60, 100], timestampMicros: 1_000 }, "ok");
    for (let block = 0; block < 4; block += 1)
      await request({ type: "render-audio", timestampMicros: 2_000 + block * 2_667 }, "ok");
    const samples = new Float32Array(ring.descriptor().samples);
    const rendered = Array.from({ length: 2 }, (_, channel) =>
      Array.from({ length: 4 }, (_, block) => {
        const start = channel * 1024 + block * 128;
        return Array.from(samples.slice(start, start + 128));
      }));
    await request({ type: "destroy" }, "destroyed");
    worker.terminate();
    return rendered;
  });

  expect(blocks).toHaveLength(2);
  for (const channel of blocks) {
    expect(channel).toHaveLength(4);
    for (const block of channel) {
      expect(block).toHaveLength(128);
      expect(block.every(Number.isFinite)).toBe(true);
      expect(block.some((sample) => sample !== 0)).toBe(true);
    }
  }
});
