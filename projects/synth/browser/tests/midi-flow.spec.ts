import { expect, test } from "@playwright/test";

test("forwards generic MIDI commands through the runtime worker", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async () => {
    const { BrowserRuntimeWorker } = await (new Function("return import('/dist/src/worker.js')")() as Promise<{
      BrowserRuntimeWorker: new (loadModule: unknown) => { handle(command: unknown): Promise<unknown> };
    }>);
    const calls: unknown[] = [];
    const actions = [{ type: "open-input", controllerIx: 1, identifier: "in-b", name: "Input B" }];
    const worker = new BrowserRuntimeWorker(async () => ({
      create: () => 7,
      initialize: () => 0,
      prepare: () => 0,
      process: () => 0,
      messageTick: () => 0,
      buildUiFrame: () => new ArrayBuffer(0),
      dispatchAction: () => 0,
      submitMidiEndpoints: (_handle: number, endpoints: unknown) => { calls.push(["endpoints", endpoints]); return 0; },
      dequeueMidiAction: () => actions.shift(),
      deliverMidi: (_handle: number, controllerIx: number, bytes: number[], timestampMicros: number) => { calls.push(["input", controllerIx, bytes, timestampMicros]); return 0; },
      dequeueMidiOutput: () => ({ controllerIx: 1, bytes: [0xf0, 0x7d, 0x55, 0xf7] }),
      destroy: () => {},
    }));
    await worker.handle({ type: "load" });
    await worker.handle({ type: "create" });
    const endpointResponse = await worker.handle({ type: "midi-endpoints", endpoints: [{ identifier: "in-b", name: "Input B", kind: "input" }] });
    const inputResponse = await worker.handle({ type: "midi-input", controllerIx: 1, bytes: [0xf0, 0x7d, 0x33, 0xf7], timestampMicros: 42 });
    const outputResponse = await worker.handle({ type: "drain-midi-output" });
    return { endpointResponse, inputResponse, outputResponse, calls };
  });

  expect(result.endpointResponse).toEqual({ type: "midi-actions", actions: [{ type: "open-input", controllerIx: 1, identifier: "in-b", name: "Input B" }] });
  expect(result.inputResponse).toEqual({ type: "ok" });
  expect(result.outputResponse).toEqual({ type: "midi-output", output: { controllerIx: 1, bytes: [0xf0, 0x7d, 0x55, 0xf7] } });
  expect(result.calls).toEqual([
    ["endpoints", [{ identifier: "in-b", name: "Input B", kind: "input" }]],
    ["input", 1, [0xf0, 0x7d, 0x33, 0xf7], 42],
  ]);
});

test("requests Web MIDI sysex permission and remains offline when it is denied", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async () => {
    const { BrowserMidiManager } = await (new Function("return import('/dist/src/midi.js')")() as Promise<{
      BrowserMidiManager: new (runtime: unknown, options: unknown) => { startFromUserActivation(): Promise<unknown>; status(): string };
    }>);
    const requests: unknown[] = [];
    const uiAndAudioRemainRunning = { ui: true, audio: true };
    const runtime = { submitEndpoints: async () => [], deliverMidi: async () => {}, dequeueMidiOutput: async () => undefined };
    const manager = new BrowserMidiManager(runtime, {
      requestMIDIAccess: async (options: unknown) => {
        requests.push(options);
        throw new Error("sysex denied");
      },
      setInterval: () => 1,
      clearInterval: () => {},
    });
    const start = await manager.startFromUserActivation();
    return { requests, start, status: manager.status(), uiAndAudioRemainRunning };
  });

  expect(result.requests).toEqual([{ sysex: true }]);
  expect(result.start).toEqual({ status: "offline", reason: "sysex denied" });
  expect(result.status).toBe("offline");
  expect(result.uiAndAudioRemainRunning).toEqual({ ui: true, audio: true });
});

test("routes sysex between selected ports and their independent controller slots", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async () => {
    const { BrowserMidiManager } = await (new Function("return import('/dist/src/midi.js')")() as Promise<{
      BrowserMidiManager: new (runtime: unknown, options: unknown) => { startFromUserActivation(): Promise<unknown>; drainOutputs(): Promise<void>; stop(): void };
    }>);
    class InputPort {
      readonly type = "input";
      readonly state = "connected";
      onmidimessage: ((event: { data: Uint8Array; timeStamp: number }) => void) | null = null;
      constructor(readonly id: string, readonly name: string) {}
      emit(bytes: number[]) { this.onmidimessage?.({ data: Uint8Array.from(bytes), timeStamp: 17 }); }
    }
    class OutputPort {
      readonly type = "output";
      readonly state = "connected";
      readonly sent: number[][] = [];
      constructor(readonly id: string, readonly name: string) {}
      send(bytes: number[] | Uint8Array) { this.sent.push(Array.from(bytes)); }
    }
    const inputA = new InputPort("in-a", "Input A");
    const inputB = new InputPort("in-b", "Input B");
    const outputA = new OutputPort("out-a", "Output A");
    const outputB = new OutputPort("out-b", "Output B");
    const access = { inputs: new Map([[inputA.id, inputA], [inputB.id, inputB]]), outputs: new Map([[outputA.id, outputA], [outputB.id, outputB]]), onstatechange: null };
    const delivered: Array<{ controllerIx: number; bytes: number[]; timestampMicros: number }> = [];
    const outputQueue = [{ controllerIx: 1, bytes: [0xf0, 0x7d, 0x44, 0xf7] }];
    const runtime = {
      submitEndpoints: async () => [
        { type: "open-input", controllerIx: 0, identifier: "in-a", name: "Input A" },
        { type: "open-input", controllerIx: 1, identifier: "in-b", name: "Input B" },
        { type: "open-output", controllerIx: 0, identifier: "out-a", name: "Output A" },
        { type: "open-output", controllerIx: 1, identifier: "out-b", name: "Output B" },
        { type: "resync", controllerIx: 0 },
        { type: "resync", controllerIx: 1 },
      ],
      deliverMidi: async (controllerIx: number, bytes: number[], timestampMicros: number) => { delivered.push({ controllerIx, bytes, timestampMicros }); },
      dequeueMidiOutput: async () => outputQueue.shift(),
    };
    const manager = new BrowserMidiManager(runtime, {
      requestMIDIAccess: async () => access,
      setInterval: () => 1,
      clearInterval: () => {},
      nowMicros: () => 123,
    });
    await manager.startFromUserActivation();
    inputB.emit([0xf0, 0x7d, 0x33, 0xf7]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await manager.drainOutputs();
    const handlerA = inputA.onmidimessage !== null;
    const handlerB = inputB.onmidimessage !== null;
    manager.stop();
    return { delivered, sentA: outputA.sent, sentB: outputB.sent, handlerA, handlerB };
  });

  expect(result.handlerA).toBe(true);
  expect(result.handlerB).toBe(true);
  expect(result.delivered).toEqual([{ controllerIx: 1, bytes: [0xf0, 0x7d, 0x33, 0xf7], timestampMicros: 17000 }]);
  expect(result.sentA).toEqual([]);
  expect(result.sentB).toEqual([[0xf0, 0x7d, 0x44, 0xf7]]);
});

test("polling recovers missed port changes without remapping another slot", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async () => {
    const { BrowserMidiManager } = await (new Function("return import('/dist/src/midi.js')")() as Promise<{
      BrowserMidiManager: new (runtime: unknown, options: unknown) => { startFromUserActivation(): Promise<unknown>; poll(): Promise<void>; stop(): void };
    }>);
    class InputPort {
      readonly type = "input";
      state = "connected";
      onmidimessage: ((event: { data: Uint8Array; timeStamp: number }) => void) | null = null;
      constructor(readonly id: string, readonly name: string) {}
    }
    class OutputPort {
      readonly type = "output";
      state = "connected";
      constructor(readonly id: string, readonly name: string) {}
      send(_bytes: number[] | Uint8Array) {}
    }
    const inputA = new InputPort("in-a", "Input A");
    const inputB = new InputPort("in-b", "Input B");
    const outputA = new OutputPort("out-a", "Output A");
    const outputB = new OutputPort("out-b", "Output B");
    const access = { inputs: new Map([[inputA.id, inputA], [inputB.id, inputB]]), outputs: new Map([[outputA.id, outputA], [outputB.id, outputB]]), onstatechange: null };
    const snapshots: string[][] = [];
    let pass = 0;
    const runtime = {
      submitEndpoints: async (endpoints: Array<{ identifier: string }>) => {
        snapshots.push(endpoints.map((endpoint) => endpoint.identifier).sort());
        pass += 1;
        if (pass === 1) return [
          { type: "open-input", controllerIx: 0, identifier: "in-a", name: "Input A" },
          { type: "open-input", controllerIx: 1, identifier: "in-b", name: "Input B" },
          { type: "open-output", controllerIx: 0, identifier: "out-a", name: "Output A" },
          { type: "open-output", controllerIx: 1, identifier: "out-b", name: "Output B" },
        ];
        if (pass === 2) return [
          { type: "close-input", controllerIx: 1 },
          { type: "close-output", controllerIx: 1 },
        ];
        return [
          { type: "open-input", controllerIx: 1, identifier: "in-b", name: "Input B" },
          { type: "open-output", controllerIx: 1, identifier: "out-b", name: "Output B" },
        ];
      },
      deliverMidi: async () => {},
      dequeueMidiOutput: async () => undefined,
    };
    const manager = new BrowserMidiManager(runtime, {
      requestMIDIAccess: async () => access,
      setInterval: () => 1,
      clearInterval: () => {},
    });
    await manager.startFromUserActivation();
    access.inputs.delete("in-b");
    access.outputs.delete("out-b");
    await manager.poll();
    const slotAStillBoundAfterOffline = inputA.onmidimessage !== null;
    const slotBUnboundAfterOffline = inputB.onmidimessage === null;
    access.inputs.set("in-b", inputB);
    access.outputs.set("out-b", outputB);
    await manager.poll();
    const slotAStillBoundAfterReconnect = inputA.onmidimessage !== null;
    const slotBRebound = inputB.onmidimessage !== null;
    manager.stop();
    return { snapshots, slotAStillBoundAfterOffline, slotBUnboundAfterOffline, slotAStillBoundAfterReconnect, slotBRebound };
  });

  expect(result.snapshots).toEqual([
    ["in-a", "in-b", "out-a", "out-b"],
    ["in-a", "out-a"],
    ["in-a", "in-b", "out-a", "out-b"],
  ]);
  expect(result.slotAStillBoundAfterOffline).toBe(true);
  expect(result.slotBUnboundAfterOffline).toBe(true);
  expect(result.slotAStillBoundAfterReconnect).toBe(true);
  expect(result.slotBRebound).toBe(true);
});
