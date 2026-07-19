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

test("prefers runtime-owned Wasm AudioWorklet callback over JS ring producer", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/public/index.html");
  const result = await page.evaluate(async () => {
    const { AudioBridge } = await (new Function("return import('/dist/src/audio.js')") as () => Promise<{ AudioBridge: new (worker: unknown, options: unknown) => { startFromUserActivation(): Promise<unknown>; shutdown(): void } }>)();
    const calls: unknown[] = [];
    const bridge = new AudioBridge({
      postMessage(message: unknown) { calls.push(message); },
      async startAudioWorklet() { calls.push("start-audio-worklet"); return { started: true }; },
    }, {
      audioContextFactory: () => {
        throw new Error("JS AudioContext fallback should not be constructed");
      },
    });
    const started = await bridge.startFromUserActivation();
    bridge.shutdown();
    return { started, calls };
  });

  expect(result.started).toEqual({ started: true });
  expect(result.calls).toEqual(["start-audio-worklet"]);
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
    const moduleUrl = new URL("/dist/wasm/miniapp.js", location.href).href;
    await request({ type: "load", module: {
      entryUrl: moduleUrl,
      locateFile: { "miniapp.js": moduleUrl, "miniapp.wasm": new URL("/dist/wasm/miniapp.wasm", location.href).href },
      mainScriptUrlOrBlob: moduleUrl,
    } }, "ok");
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

test("real miniapp WASM runs DSP from the runtime-owned AudioWorklet callback", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/public/index.html");
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "start-runtime-audio";
    button.textContent = "start";
    document.body.append(button);
    (window as any).__runtimeAudioStats = new Promise((resolve, reject) => {
      button.addEventListener("click", async () => {
        try {
          const { BrowserRuntimeWorker } = await (new Function("return import('/dist/src/worker.js')")() as Promise<any>);
          const { decodeCommandBuffer } = await (new Function("return import('/dist/src/protocol.js')")() as Promise<any>);
          const runtime = new BrowserRuntimeWorker();
          const request = async (command: unknown, expected: string) => {
            const response = await runtime.handle(command);
            if (response.type !== expected) throw new Error(response.type === "error" ? response.error : `expected ${expected}, got ${response.type}`);
            return response;
          };
          const moduleUrl = new URL("/dist/wasm/miniapp.js", location.href).href;
          await request({ type: "load", module: {
            entryUrl: moduleUrl,
            locateFile: { "miniapp.js": moduleUrl, "miniapp.wasm": new URL("/dist/wasm/miniapp.wasm", location.href).href },
            mainScriptUrlOrBlob: moduleUrl,
          } }, "ok");
          await request({ type: "create" }, "created");
          await request({ type: "initialize", dataRoot: "/data" }, "ok");
          await request({ type: "midi-input", controllerIx: 0, bytes: [0x90, 60, 100], timestampMicros: 1_000 }, "ok");
          await request({ type: "start-audio-worklet" }, "ok");
          const deadline = performance.now() + 5_000;
          let latest = { blocks: 0, peakMicrounits: 0, deadlineMicrounits: 0, deadlineText: "0.0%" };
          while (performance.now() < deadline) {
            latest = await request({ type: "audio-worklet-stats" }, "audio-worklet-stats");
            await request({ type: "message-tick", timestampMicros: Math.round(performance.now() * 1000) }, "ok");
            const frameResponse = await request({ type: "build-ui-frame" }, "ui-frame");
            const frame = decodeCommandBuffer(Uint8Array.from(frameResponse.frame).buffer);
            const deadlineNode = frame.nodes.find((node: any) => node.id === "runtime.sidebar.deadline");
            latest.deadlineText = deadlineNode?.text ?? "";
            if (latest.blocks >= 4 && latest.peakMicrounits > 0 && latest.deadlineMicrounits > 0 && latest.deadlineText !== "0.0%") break;
            await new Promise((pollResolve) => setTimeout(pollResolve, 25));
          }
          await request({ type: "destroy" }, "destroyed");
          resolve(latest);
        } catch (error) {
          reject(error);
        }
      }, { once: true });
    });
  });
  await page.locator("#start-runtime-audio").click();
  const stats = await page.evaluate(async () => {
    return (window as any).__runtimeAudioStats;
  });

  expect(stats.blocks).toBeGreaterThanOrEqual(4);
  expect(stats.peakMicrounits).toBeGreaterThan(0);
  expect(stats.deadlineMicrounits).toBeGreaterThan(0);
  expect(stats.deadlineText).not.toBe("0.0%");
});

test("runtime-owned AudioWorklet applies browser-time encoder actions promptly", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/public/index.html");
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "start-runtime-control";
    button.textContent = "start";
    document.body.append(button);
    (window as any).__runtimeControlResult = new Promise((resolve, reject) => {
      button.addEventListener("click", async () => {
        try {
          const { BrowserRuntimeWorker } = await (new Function("return import('/dist/src/worker.js')")() as Promise<any>);
          const { decodeCommandBuffer } = await (new Function("return import('/dist/src/protocol.js')")() as Promise<any>);
          const runtime = new BrowserRuntimeWorker();
          const request = async (command: unknown, expected: string) => {
            const response = await runtime.handle(command);
            if (response.type !== expected) throw new Error(response.type === "error" ? response.error : `expected ${expected}, got ${response.type}`);
            return response;
          };
          const frame = async () => {
            const response = await request({ type: "build-ui-frame" }, "ui-frame");
            return decodeCommandBuffer(Uint8Array.from(response.frame).buffer);
          };
          const encoderSignature = (decoded: any) => {
            const encoder = decoded.nodes.find((node: any) => node.id.startsWith("miniapp.encoder.") && node.pointerDragAction);
            if (!encoder) throw new Error("no draggable encoder in miniapp frame");
            const draws = decoded.drawCommands.slice(encoder.drawStart, encoder.drawStart + encoder.drawCount);
            return {
              action: encoder.pointerDragAction,
              signature: JSON.stringify(draws.map((draw: any) => [draw.kind, draw.bounds, draw.startRadians, draw.endRadians, draw.text])),
            };
          };

          const moduleUrl = new URL("/dist/wasm/miniapp.js", location.href).href;
          await request({ type: "load", module: {
            entryUrl: moduleUrl,
            locateFile: { "miniapp.js": moduleUrl, "miniapp.wasm": new URL("/dist/wasm/miniapp.wasm", location.href).href },
            mainScriptUrlOrBlob: moduleUrl,
          } }, "ok");
          await request({ type: "create" }, "created");
          await request({ type: "initialize", dataRoot: "/data" }, "ok");
          await request({ type: "start-audio-worklet" }, "ok");
          await request({ type: "message-tick", timestampMicros: Math.round(performance.now() * 1000) }, "ok");
          const before = encoderSignature(await frame());
          const parts = String(before.action.value).split(":");
          parts[parts.length - 1] = "0.35";
          await request({ type: "dispatch-action", name: before.action.name, value: parts.join(":") }, "ui-frame");

          const deadline = performance.now() + 5_000;
          let latestStats = { blocks: 0, peakMicrounits: 0 };
          let latestSignature = before.signature;
          while (performance.now() < deadline) {
            latestStats = await request({ type: "audio-worklet-stats" }, "audio-worklet-stats");
            await request({ type: "message-tick", timestampMicros: Math.round(performance.now() * 1000) }, "ok");
            latestSignature = encoderSignature(await frame()).signature;
            if (latestStats.blocks >= 8 && latestSignature !== before.signature) break;
            await new Promise((pollResolve) => setTimeout(pollResolve, 25));
          }
          await request({ type: "destroy" }, "destroyed");
          resolve({ blocks: latestStats.blocks, before: before.signature, after: latestSignature });
        } catch (error) {
          reject(error);
        }
      }, { once: true });
    });
  });
  await page.locator("#start-runtime-control").click();
  const result = await page.evaluate(async () => {
    return (window as any).__runtimeControlResult;
  });

  expect(result.blocks).toBeGreaterThanOrEqual(8);
  expect(result.after).not.toBe(result.before);
});
