import { expect, test, type Page } from "@playwright/test";

// The published `BrowserAudioInputStatus` codes, in ABI order. Mirrored here so
// a reordered enum fails these tests instead of silently relabelling the Audio
// page.
const INPUT_STATUS = {
  notRequested: 0,
  requesting: 1,
  online: 2,
  permissionDenied: 3,
  apiUnavailable: 4,
  prerequisiteBlocked: 5,
  streamEnded: 6,
  channelCountUnreported: 7,
} as const;

type CaptureScenario = {
  requestedChannels: number;
  capture?: "granted" | "denied" | "blocked" | "unavailable-device" | "missing-api" | "no-track";
  trackChannelCount?: number | null;
  omitTrackSettings?: boolean;
  sourceChannelCount?: number;
  secureContext?: boolean;
  omitAudioContext?: boolean;
  nativeStartFails?: boolean;
};

type CaptureStep = "retry" | "end-track" | "stop" | "stop-again" | "clear-fails" | "replace";

type CaptureRun = {
  started: { started: boolean; diagnostic?: string };
  constraints: unknown[];
  calls: string[];
  registrations: Array<{ physicalChannels: number; statusCode: number; sourceIx: number }>;
  inputState: { requestedChannels: number; activeChannels: number; statusCode: number; diagnostic: string };
  sourceCount: number;
  sourceDisconnects: number[];
  trackStops: number[];
  nativeStarts: number;
  connectedSources: number;
};

// One capture harness for every browser-input scenario: the AudioBridge under
// test only ever sees fake media devices, a fake AudioContext, and a fake
// runtime facade, so no developer hardware and no real permission prompt is
// involved.
async function runCapture(page: Page, scenario: CaptureScenario, steps: CaptureStep[] = []): Promise<CaptureRun> {
  await page.goto("http://127.0.0.1:4174/public/index.html");
  return page.evaluate(async ({ scenario, steps }) => {
    const { AudioBridge } = await (new Function("return import('/dist/src/audio.js')")() as Promise<any>);
    const calls: string[] = [];
    const constraints: unknown[] = [];
    const tracks: any[] = [];
    const sources: any[] = [];
    const registrations: Array<{ physicalChannels: number; statusCode: number; sourceIx: number }> = [];
    let nativeStarts = 0;
    let clearFails = false;

    const makeStream = () => {
      const track: any = {
        stops: 0,
        onended: null,
        stop() { track.stops += 1; calls.push("track:stop"); },
      };
      if (!scenario.omitTrackSettings) {
        track.getSettings = () => (scenario.trackChannelCount === null || scenario.trackChannelCount === undefined
          ? {}
          : { channelCount: scenario.trackChannelCount });
      }
      const streamTracks = scenario.capture === "no-track" ? [] : [track];
      if (streamTracks.length > 0) tracks.push(track);
      return { getAudioTracks: () => streamTracks, getTracks: () => streamTracks };
    };

    const mediaDevices = {
      async getUserMedia(requested: unknown) {
        calls.push("getUserMedia");
        constraints.push(requested);
        if (scenario.capture === "denied") throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
        if (scenario.capture === "blocked") throw Object.assign(new Error("blocked"), { name: "SecurityError" });
        if (scenario.capture === "unavailable-device") throw Object.assign(new Error("no device"), { name: "NotFoundError" });
        return makeStream();
      },
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: scenario.capture === "missing-api" ? undefined : mediaDevices,
    });
    if (scenario.secureContext === false)
      Object.defineProperty(globalThis, "isSecureContext", { configurable: true, value: false });

    const audioContext = {
      sampleRate: 48_000,
      createMediaStreamSource(stream: unknown) {
        calls.push("createMediaStreamSource");
        const source: any = {
          stream,
          channelCount: scenario.sourceChannelCount ?? 2,
          disconnects: 0,
          connects: 0,
          connect() { source.connects += 1; calls.push("source:connect"); },
          disconnect() { source.disconnects += 1; calls.push("source:disconnect"); },
        };
        sources.push(source);
        return source;
      },
    };

    const worker = {
      async audioInputChannels() { calls.push("audioInputChannels"); return scenario.requestedChannels; },
      async startAudioWorklet() {
        calls.push("startAudioWorklet");
        nativeStarts += 1;
        return scenario.nativeStartFails
          ? { started: false, diagnostic: "native-audio-worklet-start-failed" }
          : { started: true };
      },
      async setAudioInputSource(source: unknown, physicalChannels: number, statusCode: number) {
        calls.push(`setAudioInputSource:${physicalChannels}:${statusCode}`);
        registrations.push({ physicalChannels, statusCode, sourceIx: sources.indexOf(source) });
      },
      async clearAudioInputSource(statusCode: number) {
        calls.push(`clearAudioInputSource:${statusCode}`);
        if (clearFails) throw new Error("runtime is destroyed");
      },
    };

    const options = scenario.omitAudioContext ? {} : { audioContext };
    let bridge = new AudioBridge(worker, options);
    const started = await bridge.startFromUserActivation();
    for (const step of steps) {
      if (step === "retry") await bridge.retryInput();
      if (step === "end-track") {
        tracks[tracks.length - 1].onended();
        await bridge.whenInputSettled();
      }
      if (step === "clear-fails") clearFails = true;
      if (step === "stop" || step === "stop-again") await bridge.stop();
      // The launcher replacing one application with another on the same page:
      // the outgoing bridge is stopped and a fresh one starts against the same
      // context and runtime.
      if (step === "replace") {
        await bridge.stop();
        bridge = new AudioBridge(worker, options);
        await bridge.startFromUserActivation();
      }
    }
    return {
      started,
      constraints,
      calls,
      registrations,
      inputState: bridge.inputState(),
      sourceCount: sources.length,
      sourceDisconnects: sources.map((source: any) => source.disconnects),
      trackStops: tracks.map((track: any) => track.stops),
      nativeStarts,
      connectedSources: sources.filter((source: any) => source.connects > 0).length,
    };
  }, { scenario, steps });
}

test("never touches the media device API for a zero-input application", async ({ page }) => {
  const result = await runCapture(page, { requestedChannels: 0 }, ["stop"]);

  expect(result.started).toEqual({ started: true });
  expect(result.calls).toEqual(["audioInputChannels", "startAudioWorklet"]);
  expect(result.registrations).toEqual([]);
  expect(result.inputState).toEqual({
    requestedChannels: 0,
    activeChannels: 0,
    statusCode: INPUT_STATUS.notRequested,
    diagnostic: "",
  });
});

test("requests System Default capture with the pinned multichannel constraints before native startup", async ({ page }) => {
  const result = await runCapture(page, { requestedChannels: 4, trackChannelCount: 4 });

  expect(result.constraints).toEqual([{
    audio: {
      channelCount: { ideal: 4 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  }]);
  expect(result.calls).toEqual([
    "audioInputChannels",
    `clearAudioInputSource:${INPUT_STATUS.requesting}`,
    "getUserMedia",
    "createMediaStreamSource",
    `setAudioInputSource:4:${INPUT_STATUS.online}`,
    "startAudioWorklet",
  ]);
  expect(result.registrations).toEqual([{ physicalChannels: 4, statusCode: INPUT_STATUS.online, sourceIx: 0 }]);
  expect(result.inputState).toEqual({
    requestedChannels: 4,
    activeChannels: 4,
    statusCode: INPUT_STATUS.online,
    diagnostic: "",
  });
  // The native worklet input bus is the only path from capture into the graph.
  expect(result.connectedSources).toBe(0);
});

test("clamps a device that supplies more channels than the application requested", async ({ page }) => {
  const result = await runCapture(page, { requestedChannels: 2, trackChannelCount: 6 });

  expect(result.registrations).toEqual([{ physicalChannels: 2, statusCode: INPUT_STATUS.online, sourceIx: 0 }]);
  expect(result.inputState.activeChannels).toBe(2);
});

test("reports a channel shortfall through the published active count", async ({ page }) => {
  const result = await runCapture(page, { requestedChannels: 4, trackChannelCount: 1 });

  expect(result.registrations).toEqual([{ physicalChannels: 1, statusCode: INPUT_STATUS.online, sourceIx: 0 }]);
  expect(result.inputState).toEqual({
    requestedChannels: 4,
    activeChannels: 1,
    statusCode: INPUT_STATUS.online,
    diagnostic: "",
  });
});

test("falls back to the source node count and a distinct status when the track omits its channel count", async ({ page }) => {
  const result = await runCapture(page, { requestedChannels: 4, trackChannelCount: null, sourceChannelCount: 2 });

  expect(result.registrations).toEqual([{
    physicalChannels: 2,
    statusCode: INPUT_STATUS.channelCountUnreported,
    sourceIx: 0,
  }]);
  expect(result.inputState).toEqual({
    requestedChannels: 4,
    activeChannels: 2,
    statusCode: INPUT_STATUS.channelCountUnreported,
    diagnostic: "channel-count-unreported",
  });
});

test("falls back to one channel when neither the track nor the source node reports a count", async ({ page }) => {
  const result = await runCapture(page, { requestedChannels: 4, omitTrackSettings: true, sourceChannelCount: 0 });

  expect(result.registrations).toEqual([{
    physicalChannels: 1,
    statusCode: INPUT_STATUS.channelCountUnreported,
    sourceIx: 0,
  }]);
  expect(result.inputState.activeChannels).toBe(1);
});

test("keeps output live and distinguishes each offline capture state", async ({ page }) => {
  const denied = await runCapture(page, { requestedChannels: 4, capture: "denied" });
  const blocked = await runCapture(page, { requestedChannels: 4, capture: "blocked" });
  const missingApi = await runCapture(page, { requestedChannels: 4, capture: "missing-api" });
  const insecure = await runCapture(page, { requestedChannels: 4, secureContext: false });
  const noContext = await runCapture(page, { requestedChannels: 4, omitAudioContext: true });
  const unavailable = await runCapture(page, { requestedChannels: 4, capture: "unavailable-device" });
  const noTrack = await runCapture(page, { requestedChannels: 4, capture: "no-track" });

  for (const result of [denied, blocked, missingApi, insecure, noContext, unavailable, noTrack]) {
    expect(result.started).toEqual({ started: true });
    expect(result.nativeStarts).toBe(1);
    expect(result.registrations).toEqual([]);
    expect(result.inputState.activeChannels).toBe(0);
    expect(result.inputState.requestedChannels).toBe(4);
  }
  expect(denied.inputState).toMatchObject({ statusCode: INPUT_STATUS.permissionDenied, diagnostic: "permission-denied" });
  expect(blocked.inputState).toMatchObject({ statusCode: INPUT_STATUS.prerequisiteBlocked, diagnostic: "capture-blocked" });
  expect(missingApi.inputState).toMatchObject({ statusCode: INPUT_STATUS.apiUnavailable, diagnostic: "media-devices-unavailable" });
  expect(insecure.inputState).toMatchObject({ statusCode: INPUT_STATUS.prerequisiteBlocked, diagnostic: "insecure-context" });
  expect(noContext.inputState).toMatchObject({ statusCode: INPUT_STATUS.prerequisiteBlocked, diagnostic: "audio-context-unavailable" });
  expect(unavailable.inputState).toMatchObject({ statusCode: INPUT_STATUS.apiUnavailable, diagnostic: "capture-failed:NotFoundError" });
  expect(noTrack.inputState).toMatchObject({ statusCode: INPUT_STATUS.streamEnded, diagnostic: "no-audio-track" });
  // Neither a missing API, an insecure context, nor a missing AudioContext may
  // reach `getUserMedia()` at all.
  expect(missingApi.calls).not.toContain("getUserMedia");
  expect(insecure.calls).not.toContain("getUserMedia");
  expect(noContext.calls).not.toContain("getUserMedia");
});

test("releases an ended stream once, clears the native count first, and leaves output running", async ({ page }) => {
  const result = await runCapture(page, { requestedChannels: 2, trackChannelCount: 2 }, ["end-track"]);

  expect(result.calls.slice(result.calls.indexOf("startAudioWorklet"))).toEqual([
    "startAudioWorklet",
    `clearAudioInputSource:${INPUT_STATUS.streamEnded}`,
    "source:disconnect",
    "track:stop",
  ]);
  expect(result.trackStops).toEqual([1]);
  expect(result.sourceDisconnects).toEqual([1]);
  expect(result.nativeStarts).toBe(1);
  expect(result.inputState).toEqual({
    requestedChannels: 2,
    activeChannels: 0,
    statusCode: INPUT_STATUS.streamEnded,
    diagnostic: "stream-ended",
  });
});

test("retries capture into the existing context and runtime without restarting the worklet", async ({ page }) => {
  const result = await runCapture(page, { requestedChannels: 2, trackChannelCount: 2 }, ["end-track", "retry"]);

  expect(result.nativeStarts).toBe(1);
  expect(result.sourceCount).toBe(2);
  expect(result.registrations).toEqual([
    { physicalChannels: 2, statusCode: INPUT_STATUS.online, sourceIx: 0 },
    { physicalChannels: 2, statusCode: INPUT_STATUS.online, sourceIx: 1 },
  ]);
  expect(result.trackStops).toEqual([1, 0]);
  expect(result.inputState).toEqual({
    requestedChannels: 2,
    activeChannels: 2,
    statusCode: INPUT_STATUS.online,
    diagnostic: "",
  });
});

test("retry replaces a live capture without leaking the previous stream", async ({ page }) => {
  const result = await runCapture(page, { requestedChannels: 1, trackChannelCount: 1 }, ["retry", "stop"]);

  expect(result.sourceCount).toBe(2);
  expect(result.sourceDisconnects).toEqual([1, 1]);
  expect(result.trackStops).toEqual([1, 1]);
  expect(result.nativeStarts).toBe(1);
});

test("retry stays inert for a zero-input application", async ({ page }) => {
  const result = await runCapture(page, { requestedChannels: 0 }, ["retry"]);

  expect(result.calls).toEqual(["audioInputChannels", "startAudioWorklet"]);
  expect(result.sourceCount).toBe(0);
});

test("stops every track exactly once across repeated stops", async ({ page }) => {
  const result = await runCapture(page, { requestedChannels: 2, trackChannelCount: 2 }, ["stop", "stop-again"]);

  expect(result.trackStops).toEqual([1]);
  expect(result.sourceDisconnects).toEqual([1]);
  expect(result.calls.filter((call) => call.startsWith("clearAudioInputSource"))).toEqual([
    `clearAudioInputSource:${INPUT_STATUS.requesting}`,
    `clearAudioInputSource:${INPUT_STATUS.notRequested}`,
  ]);
});

test("releases the replaced application's capture exactly once and gives its successor a fresh source", async ({ page }) => {
  const result = await runCapture(page, { requestedChannels: 2, trackChannelCount: 2 }, ["replace"]);

  expect(result.sourceCount).toBe(2);
  expect(result.trackStops).toEqual([1, 0]);
  expect(result.sourceDisconnects).toEqual([1, 0]);
  expect(result.nativeStarts).toBe(2);
  expect(result.registrations).toEqual([
    { physicalChannels: 2, statusCode: INPUT_STATUS.online, sourceIx: 0 },
    { physicalChannels: 2, statusCode: INPUT_STATUS.online, sourceIx: 1 },
  ]);
  expect(result.inputState).toEqual({
    requestedChannels: 2,
    activeChannels: 2,
    statusCode: INPUT_STATUS.online,
    diagnostic: "",
  });
});

test("releases capture when the runtime rejects the teardown clear", async ({ page }) => {
  const result = await runCapture(page, { requestedChannels: 2, trackChannelCount: 2 }, ["clear-fails", "stop"]);

  expect(result.trackStops).toEqual([1]);
  expect(result.sourceDisconnects).toEqual([1]);
});

test("releases capture when native AudioWorklet startup fails", async ({ page }) => {
  const result = await runCapture(page, { requestedChannels: 2, trackChannelCount: 2, nativeStartFails: true });

  expect(result.started).toEqual({ started: false, diagnostic: "native-audio-worklet-start-failed" });
  expect(result.trackStops).toEqual([1]);
  expect(result.sourceDisconnects).toEqual([1]);
  expect(result.inputState.activeChannels).toBe(0);
});

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
    await bridge.stop();
    return { started, calls };
  });

  expect(result.started).toEqual({ started: true });
  expect(result.calls).toEqual([expect.anything()]);
  expect(result.calls[0]).toEqual(expect.objectContaining({ sampleRate: 48_000 }));
});

test("prefers runtime-owned Wasm AudioWorklet callback over JS ring producer", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/public/index.html");
  const result = await page.evaluate(async () => {
    const { AudioBridge } = await (new Function("return import('/dist/src/audio.js')") as () => Promise<{ AudioBridge: new (worker: unknown, options: unknown) => { startFromUserActivation(): Promise<unknown>; stop(): Promise<void> } }>)();
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
    await bridge.stop();
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
          const moduleUrl = new URL("/dist/wasm/apps/miniapp/miniapp.js", location.href).href;
          await request({ type: "load", module: {
            entryUrl: moduleUrl,
            locateFile: {
              "miniapp.js": moduleUrl,
              "miniapp.wasm": new URL("/dist/wasm/apps/miniapp/miniapp.wasm", location.href).href,
            },
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

          const moduleUrl = new URL("/dist/wasm/apps/miniapp/miniapp.js", location.href).href;
          await request({ type: "load", module: {
            entryUrl: moduleUrl,
            locateFile: {
              "miniapp.js": moduleUrl,
              "miniapp.wasm": new URL("/dist/wasm/apps/miniapp/miniapp.wasm", location.href).href,
            },
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
