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

test("fails closed when native AudioWorklet startup is unavailable", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/public/index.html");
  const result = await page.evaluate(async () => {
    const { AudioBridge } = await (new Function("return import('/dist/src/audio.js')")() as Promise<any>);
    const context = { sampleRate: 48_000 };
    const workerMessages: unknown[] = [];
    const bridge = new AudioBridge(
      { postMessage(message: unknown) { workerMessages.push(message); } },
      {
        audioContext: context,
        audioContextFactory: () => { throw new Error("second context"); },
        audioWorkletNodeFactory: () => { throw new Error("JavaScript AudioWorklet fallback"); },
      },
    );
    const started = await bridge.startFromUserActivation();
    return { started, workerMessages };
  });

  expect(result.started).toEqual({ started: false, diagnostic: "native-audio-worklet-required" });
  expect(result.workerMessages).toEqual([]);
});

test("passes the already-resumed leased context to native startup without ring messages or another context", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/public/index.html");
  const result = await page.evaluate(async () => {
    const { AudioBridge } = await (new Function("return import('/dist/src/audio.js')")() as Promise<any>);
    const calls: unknown[] = [];
    const context = {
      sampleRate: 48_000,
      async resume() { calls.push("resume"); },
    };
    const bridge = new AudioBridge({
      postMessage(message: { type: string }) { calls.push(message.type); },
      async startAudioWorklet(received?: AudioContext) { calls.push(received); return { started: true }; },
    }, {
      audioContext: context,
      audioContextFactory: () => { throw new Error("second context"); },
      audioWorkletNodeFactory: () => { throw new Error("JavaScript AudioWorklet fallback"); },
    });
    const started = await bridge.startFromUserActivation();
    bridge.shutdown();
    return { started, calls };
  });

  expect(result.started).toEqual({ started: true });
  expect(result.calls).toEqual([expect.anything()]);
  expect(result.calls[0]).toEqual(expect.objectContaining({ sampleRate: 48_000 }));
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
          await request({
            type: "initialize",
            identity: { publisherId: "sheaf", appId: "miniapp", runtimeConfigVersion: 1 },
          }, "ok");
          await request({ type: "midi-input", controllerIx: 0, bytes: [0x90, 60, 100], timestampMicros: 1_000 }, "ok");
          const started = await runtime.startAudioWorklet();
          if (started.type !== "ok") throw new Error(started.error ?? `unexpected audio response ${started.type}`);
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
          await request({
            type: "initialize",
            identity: { publisherId: "sheaf", appId: "miniapp", runtimeConfigVersion: 1 },
          }, "ok");
          const started = await runtime.startAudioWorklet();
          if (started.type !== "ok") throw new Error(started.error ?? `unexpected audio response ${started.type}`);
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
