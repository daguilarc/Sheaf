import { expect, test } from "@playwright/test";

test.beforeAll(async () => {
  const processInfo = (globalThis as any).process as { env: Record<string, string | undefined>; ppid: number };
  if (processInfo.env.SYNTH_BROWSER_FAKE_GATE_CONFIRMED === "1") return;
  const gateFile = processInfo.env.SYNTH_BROWSER_FAKE_GATE ?? `/tmp/sheaf-synth-browser-fake-app-${processInfo.ppid}`;
  const { stat } = await (new Function("return import('node:fs/promises')")() as Promise<{
    stat(path: string): Promise<unknown>;
  }>);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      await stat(gateFile);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("generic fake-app acceptance did not succeed before miniapp smoke");
});

test("miniapp smoke wiring keeps the generic fake-app gate first", async () => {
  const { readFile } = await (new Function("return import('node:fs/promises')")() as Promise<{
    readFile(path: URL, encoding: "utf8"): Promise<string>;
  }>);
  const browserMakefile = await readFile(new URL("../Makefile", import.meta.url), "utf8");
  const synthMakefile = await readFile(new URL("../../Makefile", import.meta.url), "utf8");
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const entry = await readFile(new URL("../cpp/miniapp_entry.cpp", import.meta.url), "utf8");

  expect(browserMakefile).toMatch(/browser-miniapp-smoke:\s+browser-fake-app-test/);
  expect(browserMakefile).toMatch(/browser-miniapp-smoke:[\s\S]*\$\(MAKE\) browser-miniapp/);
  expect(synthMakefile).toMatch(/browser-miniapp-smoke:/);
  expect(readme).toMatch(/Chrome/);
  expect(readme).toMatch(/Cross-Origin-Opener-Policy:\s*same-origin/);
  expect(readme).toMatch(/Cross-Origin-Embedder-Policy:\s*require-corp/);
  expect(readme).toMatch(/sysex/i);
  expect(readme).toMatch(/System Default/);
  expect(readme).toMatch(/audio input.*skipped/is);
  expect(readme).toMatch(/static-only/i);
  expect(entry).toBe('#include "MiniApp.hpp"\n#include "synth/browser/BrowserAppEntry.hpp"\n\nSYNTH_BROWSER_APP(synth_miniapp::MiniApp)\n');
});

test("miniapp smoke validates bidirectional sysex through the shared injectable MIDI facade", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/public/index.html");
  const result = await page.evaluate(async () => {
    const { BrowserMidiManager } = await (new Function("return import('/dist/src/midi.js')")() as Promise<any>);
    class InputPort {
      readonly type = "input";
      readonly state = "connected";
      onmidimessage: ((event: { data: Uint8Array; timeStamp: number }) => void) | null = null;
      constructor(readonly id: string, readonly name: string) {}
      emit(bytes: number[]) { this.onmidimessage?.({ data: Uint8Array.from(bytes), timeStamp: 9 }); }
    }
    class OutputPort {
      readonly type = "output";
      readonly state = "connected";
      readonly sent: number[][] = [];
      constructor(readonly id: string, readonly name: string) {}
      send(bytes: number[] | Uint8Array) { this.sent.push(Array.from(bytes)); }
    }
    const input = new InputPort("smoke-input", "Smoke Input");
    const output = new OutputPort("smoke-output", "Smoke Output");
    const access = { inputs: new Map([[input.id, input]]), outputs: new Map([[output.id, output]]), onstatechange: null };
    const permission: unknown[] = [];
    const delivered: unknown[] = [];
    const queue = [{ controllerIx: 0, bytes: [0xf0, 0x7d, 0x22, 0xf7] }];
    const midi = new BrowserMidiManager({
      async submitEndpoints() {
        return [
          { type: "open-input", controllerIx: 0, identifier: input.id, name: input.name },
          { type: "open-output", controllerIx: 0, identifier: output.id, name: output.name },
        ];
      },
      async deliverMidi(controllerIx: number, bytes: number[], timestampMicros: number) {
        delivered.push({ controllerIx, bytes, timestampMicros });
      },
      async dequeueMidiOutput() { return queue.shift(); },
    }, {
      requestMIDIAccess: async (options: unknown) => { permission.push(options); return access; },
      setInterval: () => 1,
      clearInterval: () => {},
    });
    await midi.startFromUserActivation();
    input.emit([0xf0, 0x7d, 0x11, 0xf7]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await midi.drainOutputs();
    midi.stop();
    return { permission, delivered, sent: output.sent };
  });

  expect(result.permission).toEqual([{ sysex: true }]);
  expect(result.delivered).toEqual([{ controllerIx: 0, bytes: [0xf0, 0x7d, 0x11, 0xf7], timestampMicros: 9000 }]);
  expect(result.sent).toEqual([[0xf0, 0x7d, 0x22, 0xf7]]);
});

test("miniapp real-WASM smoke reuses only the generic browser runtime", async ({ page, request }) => {
  const artifact = await request.get("http://127.0.0.1:4174/dist/wasm/miniapp.js");
  test.skip(artifact.status() === 404, "miniapp WASM artifact is unavailable; run make browser-miniapp-smoke with Emscripten");
  expect(artifact.ok()).toBe(true);

  await page.goto("http://127.0.0.1:4174/public/index.html");
  const result = await page.evaluate(async () => {
    const { BrowserUiBackend, decodeCommandBuffer } = await (new Function("return import('/dist/src/ui.js')")() as Promise<any>);
    const { SharedRingBuffer } = await (new Function("return import('/dist/src/protocol.js')")() as Promise<any>);
    const runtime = new Worker("/dist/src/worker.js", { type: "module" });
    const send = (command: unknown, expected: string) => new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${expected}`)), 10000);
      const receive = (event: MessageEvent<any>) => {
        if (event.data.type === "page-status") return;
        if (event.data.type !== expected && event.data.type !== "error") return;
        clearTimeout(timer);
        runtime.removeEventListener("message", receive);
        event.data.type === "error" ? reject(new Error(event.data.error)) : resolve(event.data);
      };
      runtime.addEventListener("message", receive);
      runtime.postMessage(command);
    });

    await send({ type: "load", moduleUrl: new URL("/dist/wasm/miniapp.js", location.href).href }, "ok");
    const created = await send({ type: "create" }, "created");
    await send({ type: "initialize", dataRoot: "/data" }, "ok");
    const frameResponse = await send({ type: "build-ui-frame" }, "ui-frame");
    const frameBytes = Uint8Array.from(frameResponse.frame);
    const frame = decodeCommandBuffer(frameBytes.buffer);
    const actions: Array<{ name: string; value: string }> = [];
    const pending: Promise<unknown>[] = [];
    const backend = new BrowserUiBackend(document.querySelector("#synth-root")!, (action: { name: string; value: string }) => {
      actions.push(action);
      pending.push(send({ type: "dispatch-action", ...action }, "ok"));
    });
    backend.renderFrame(frameBytes.buffer);

    const ring = SharedRingBuffer.create(2, 1024);
    await send({ type: "configure-audio", sampleRate: 48000, blockSize: 128, bridge: ring.descriptor() }, "ok");
    await send({ type: "midi-input", controllerIx: 0, bytes: [0x90, 60, 100], timestampMicros: 1000 }, "ok");
    for (let block = 0; block < 4; block += 1)
      await send({ type: "render-audio", timestampMicros: 2000 + block * 2667 }, "ok");

    const dragNode = frame.nodes.find((node: any) => node.pointerDragAction);
    const pushNode = frame.nodes.find((node: any) => node.doubleClickAction);
    if (dragNode) {
      const element = document.querySelector(`[data-synth-node-id="${CSS.escape(dragNode.id)}"]`)!;
      element.dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, bubbles: true }));
      element.dispatchEvent(new PointerEvent("pointerup", { clientX: 18, bubbles: true }));
    }
    if (pushNode) {
      const element = document.querySelector(`[data-synth-node-id="${CSS.escape(pushNode.id)}"] canvas`) ??
        document.querySelector(`[data-synth-node-id="${CSS.escape(pushNode.id)}"]`)!;
      element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    }
    await Promise.all(pending);
    const samples = Array.from(new Float32Array(ring.descriptor().samples)) as number[];
    await send({ type: "destroy" }, "destroyed");
    runtime.terminate();
    return {
      created,
      nodeCount: frame.nodes.length,
      hasCanvas: Boolean(document.querySelector("canvas")),
      hasDrag: Boolean(dragNode),
      hasPush: Boolean(pushNode),
      actions,
      samples,
      html: document.body.innerHTML,
    };
  });

  expect(result.created.handle).toBeGreaterThan(0);
  expect(result.nodeCount).toBeGreaterThan(0);
  expect(result.hasCanvas).toBe(true);
  expect(result.hasDrag).toBe(true);
  expect(result.hasPush).toBe(true);
  expect(result.actions.length).toBeGreaterThanOrEqual(2);
  expect(result.samples.every(Number.isFinite)).toBe(true);
  expect(result.samples.some((sample) => sample !== 0)).toBe(true);
  expect(result.html).not.toMatch(/miniapp-specific|data-miniapp|class=["'][^"']*miniapp/i);

  const genericSources = await Promise.all([
    request.get("http://127.0.0.1:4174/dist/src/main.js"),
    request.get("http://127.0.0.1:4174/dist/src/worker.js"),
    request.get("http://127.0.0.1:4174/dist/src/ui.js"),
  ]);
  for (const response of genericSources) expect(await response.text()).not.toMatch(/MiniApp|synth_miniapp|miniapp-specific/);
});
