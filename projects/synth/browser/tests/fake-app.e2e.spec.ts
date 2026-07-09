import { expect, test, type Page } from "@playwright/test";
import { DrawKind, NodeKind, makeCommandBuffer } from "./fixtures/command-buffer.js";

const fakeAppFrame = makeCommandBuffer([
  { id: "acceptance-root", kind: NodeKind.Root, bounds: [0, 0, 420, 220], children: ["activate", "status", "encoder"] },
  { id: "activate", kind: NodeKind.Button, bounds: [12, 12, 120, 32], label: "Activate", action: { name: "generic.activate", value: "pressed" } },
  { id: "status", kind: NodeKind.StatusText, bounds: [12, 52, 180, 24], text: "Runtime open" },
  {
    id: "encoder",
    kind: NodeKind.Draw,
    bounds: [12, 84, 160, 100],
    pointerDragAction: { name: "generic.encoder.drag", value: "bank:coarse:0" },
    doubleClickAction: { name: "generic.encoder.push", value: "pressed" },
    draws: [
      { kind: DrawKind.Fill, color: [20, 24, 32, 255] },
      { kind: DrawKind.Line, from: { x: 10, y: 50 }, to: { x: 150, y: 50 }, color: [96, 220, 180, 255], strokeWidth: 3 },
    ],
  },
]);

async function runFakeAppAcceptance(page: Page): Promise<void> {
  const dynamicRequests: string[] = [];
  const sockets: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:4174")
      dynamicRequests.push(url.href);
    else if (!url.pathname.startsWith("/dist/") && !url.pathname.startsWith("/public/"))
      dynamicRequests.push(url.pathname);
  });
  page.on("websocket", (socket) => sockets.push(socket.url()));

  await page.goto("http://127.0.0.1:4174/public/index.html");
  const opened = await page.evaluate(async (bytes) => {
    const { AudioBridge } = await (new Function("return import('/dist/src/audio.js')")() as Promise<any>);
    const { BrowserMidiManager } = await (new Function("return import('/dist/src/midi.js')")() as Promise<any>);
    const { BrowserPersistence } = await (new Function("return import('/dist/src/persistence.js')")() as Promise<any>);
    const { BrowserUiBackend } = await (new Function("return import('/dist/src/ui.js')")() as Promise<any>);
    const { BrowserRuntimeWorker } = await (new Function("return import('/dist/src/worker.js')")() as Promise<any>);

    const calls = {
      lifecycle: [] as string[],
      actions: [] as Array<{ name: string; value: string }>,
      incomingMidi: [] as Array<{ controllerIx: number; bytes: number[]; timestampMicros: number }>,
      sync: [] as boolean[],
      persistenceStatus: [] as unknown[],
    };
    const midiActions: unknown[] = [];
    const midiOutputs: Array<{ controllerIx: number; bytes: number[] }> = [];
    let phase = 0;
    const filesystem = {
      filesystems: { IDBFS: "idbfs" },
      mkdir() {},
      mount() {},
      syncfs(populate: boolean, complete: (error?: Error) => void) { calls.sync.push(populate); complete(); },
    };
    const module = {
      filesystem,
      create() { calls.lifecycle.push("create"); return 41; },
      audioOutputChannels() { return 2; },
      initialize(_handle: number, dataRoot: string) { calls.lifecycle.push(`initialize:${dataRoot}`); return 0; },
      prepare(_handle: number, sampleRate: number, blockSize: number) { calls.lifecycle.push(`prepare:${sampleRate}:${blockSize}`); return 0; },
      process() { return 0; },
      renderAudio(_handle: number, channels: number, frames: number) {
        const outputs = Array.from({ length: channels }, () => new Float32Array(frames));
        for (let frame = 0; frame < frames; frame += 1) {
          const sample = 0.2 * Math.sin(phase);
          phase += 2 * Math.PI * 440 / 48000;
          for (const output of outputs) output[frame] = sample;
        }
        return { status: 0, outputs };
      },
      messageTick() { return 0; },
      buildUiFrame() { return new Uint8Array(bytes).buffer; },
      dispatchAction(_handle: number, name: string, value: string) { calls.actions.push({ name, value }); return 0; },
      submitMidiEndpoints() {
        midiActions.push(
          { type: "open-input", controllerIx: 0, identifier: "test-input", name: "Test Input" },
          { type: "open-output", controllerIx: 0, identifier: "test-output", name: "Test Output" },
        );
        return 0;
      },
      dequeueMidiAction() { return midiActions.shift(); },
      deliverMidi(_handle: number, controllerIx: number, data: number[], timestampMicros: number) {
        calls.incomingMidi.push({ controllerIx, bytes: data, timestampMicros });
        midiOutputs.push({ controllerIx, bytes: [0xf0, 0x7d, 0x55, 0xf7] });
        return 0;
      },
      dequeueMidiOutput() { return midiOutputs.shift(); },
      destroy() { calls.lifecycle.push("destroy"); },
    };
    const runtime = new BrowserRuntimeWorker(
      async () => module,
      (_filesystem: unknown, reportStatus: (status: string) => void) => new BrowserPersistence(filesystem, { debounceMs: 0 }, reportStatus),
      (status: unknown) => calls.persistenceStatus.push(status),
    );

    class InputPort {
      readonly type = "input";
      readonly state = "connected";
      onmidimessage: ((event: { data: Uint8Array; timeStamp: number }) => void) | null = null;
      constructor(readonly id: string, readonly name: string) {}
      emit(data: number[]) { this.onmidimessage?.({ data: Uint8Array.from(data), timeStamp: 21 }); }
    }
    class OutputPort {
      readonly type = "output";
      readonly state = "connected";
      readonly sent: number[][] = [];
      constructor(readonly id: string, readonly name: string) {}
      send(data: number[] | Uint8Array) { this.sent.push(Array.from(data)); }
    }
    const input = new InputPort("test-input", "Test Input");
    const output = new OutputPort("test-output", "Test Output");
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map([[output.id, output]]),
      onstatechange: null,
    };
    const midi = new BrowserMidiManager({
      async submitEndpoints(endpoints: unknown[]) {
        const response = await runtime.handle({ type: "midi-endpoints", endpoints });
        if (response.type !== "midi-actions") throw new Error("MIDI endpoint reconciliation failed");
        return response.actions;
      },
      async deliverMidi(controllerIx: number, data: number[], timestampMicros: number) {
        const response = await runtime.handle({ type: "midi-input", controllerIx, bytes: data, timestampMicros });
        if (response.type !== "ok") throw new Error("MIDI input delivery failed");
      },
      async dequeueMidiOutput() {
        const response = await runtime.handle({ type: "drain-midi-output" });
        if (response.type !== "midi-output") throw new Error("MIDI output drain failed");
        return response.output;
      },
    }, {
      requestMIDIAccess: async (options: unknown) => {
        (calls as typeof calls & { midiPermission?: unknown }).midiPermission = options;
        return access;
      },
      setInterval: () => 1,
      clearInterval: () => {},
    });

    let descriptor: { channels: number; capacityFrames: number; samples: SharedArrayBuffer; state: SharedArrayBuffer } | undefined;
    const audioCommands: Array<Promise<unknown>> = [];
    class TestAudioContext {
      readonly sampleRate = 48000;
      readonly destination = {};
      readonly audioWorklet = { addModule: async () => {} };
      async resume() {}
    }
    class TestAudioWorkletNode {
      connect() {}
      disconnect() {}
    }
    const audio = new AudioBridge({
      postMessage(message: any) {
        if (message.type === "configure-audio") descriptor = message.bridge;
        audioCommands.push(runtime.handle(message));
      },
    }, {
      audioContextFactory: () => new TestAudioContext(),
      audioWorkletNodeFactory: () => new TestAudioWorkletNode(),
    });

    await runtime.handle({ type: "load" });
    const created = await runtime.handle({ type: "create" });
    const initialized = await runtime.handle({ type: "initialize", dataRoot: "/ignored" });
    const uiFrame = await runtime.handle({ type: "build-ui-frame" });
    if (uiFrame.type !== "ui-frame") throw new Error("UI frame build failed");

    const actionCommands: Array<Promise<unknown>> = [];
    let activation: Promise<unknown> = Promise.resolve();
    const backend = new BrowserUiBackend(document.querySelector("#synth-root")!, (action: { name: string; value: string }) => {
      actionCommands.push(runtime.handle({ type: "dispatch-action", ...action }));
      if (action.name === "generic.activate") {
        activation = Promise.all([audio.startFromUserActivation(), midi.startFromUserActivation()]).then(async (started) => {
          await Promise.all(audioCommands.splice(0));
          await runtime.handle({ type: "render-audio", timestampMicros: 1000 });
          return started;
        });
      }
    });
    backend.renderFrame(Uint8Array.from(uiFrame.frame).buffer);
    (window as any).__fakeAcceptance = { runtime, midi, audio, input, output, calls, actionCommands, activation, descriptor: () => descriptor };
    return { isolated: crossOriginIsolated, created, initialized, status: await runtime.handle({ type: "status" }) };
  }, Array.from(new Uint8Array(fakeAppFrame)));

  expect(opened.isolated).toBe(true);
  expect(opened.created).toEqual({ type: "created", handle: 41 });
  expect(opened.initialized).toEqual({ type: "ok" });
  expect(opened.status).toEqual({ type: "status", status: "running" });
  await expect(page.locator('[data-synth-node-id="status"]')).toHaveText("Runtime open");
  await expect(page.locator('[data-synth-node-id="encoder"] canvas')).toBeVisible();

  await page.locator('[data-synth-node-id="activate"]').click();
  await page.evaluate(async () => {
    const state = (window as any).__fakeAcceptance;
    await state.activation;
    state.input.emit([0xf0, 0x7d, 0x33, 0xf7]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await state.midi.drainOutputs();
  });
  await page.locator('[data-synth-node-id="encoder"]').dispatchEvent("pointerdown", { clientX: 20 });
  await page.locator('[data-synth-node-id="encoder"]').dispatchEvent("pointerup", { clientX: 31 });
  await page.locator('[data-synth-node-id="encoder"] canvas').dispatchEvent("dblclick");

  const result = await page.evaluate(async () => {
    const state = (window as any).__fakeAcceptance;
    await Promise.all(state.actionCommands);
    const pending = await state.runtime.handle({ type: "persistence", state: "patch saved" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const settled = await state.runtime.handle({ type: "persistence-status" });
    const descriptor = state.descriptor();
    const samples = Array.from(new Float32Array(descriptor.samples)) as number[];
    const painted = Array.from((document.querySelector('[data-synth-node-id="encoder"] canvas') as HTMLCanvasElement)
      .getContext("2d")!.getImageData(0, 0, 1, 1).data).some((value) => value !== 0);
    state.audio.shutdown();
    state.midi.stop();
    await state.runtime.handle({ type: "destroy" });
    return {
      calls: state.calls,
      pending,
      settled,
      samples,
      output: state.output.sent,
      painted,
      html: document.body.innerHTML,
    };
  });

  expect(result.samples.every(Number.isFinite)).toBe(true);
  expect(result.samples.some((sample) => sample !== 0)).toBe(true);
  expect(result.calls.incomingMidi).toEqual([{ controllerIx: 0, bytes: [0xf0, 0x7d, 0x33, 0xf7], timestampMicros: 21000 }]);
  expect(result.output).toEqual([[0xf0, 0x7d, 0x55, 0xf7]]);
  expect(result.calls.midiPermission).toEqual({ sysex: true });
  expect(result.calls.actions).toEqual([
    { name: "generic.activate", value: "pressed" },
    { name: "generic.encoder.drag", value: "bank:coarse:11" },
    { name: "generic.encoder.push", value: "pressed" },
  ]);
  expect(result.calls.sync).toEqual([true, false]);
  expect(result.pending).toEqual({ type: "page-status", path: "runtime.file.status", status: "persistence pending" });
  expect(result.settled).toEqual({ type: "page-status", path: "runtime.file.status", status: "persistence succeeded" });
  expect(result.painted).toBe(true);
  expect(result.html).not.toMatch(/miniapp|app-specific/i);
  expect(dynamicRequests).toEqual([]);
  expect(sockets).toEqual([]);
}

test("opens the generic fake app and validates the complete static browser flow", async ({ page }) => {
  await runFakeAppAcceptance(page);
  const processInfo = (globalThis as any).process as { env: Record<string, string | undefined>; ppid: number };
  const gateFile = processInfo.env.SYNTH_BROWSER_FAKE_GATE ?? `/tmp/sheaf-synth-browser-fake-app-${processInfo.ppid}`;
  const { writeFile } = await (new Function("return import('node:fs/promises')")() as Promise<{
    writeFile(path: string, contents: string): Promise<void>;
  }>);
  await writeFile(gateFile, "passed\n");
});
