import { expect, test, type Page } from "@playwright/test";
import { makeCommandBuffer, NodeKind } from "./fixtures/command-buffer.js";

async function blockProductAutoBoot(page: Page) {
  await page.route("**/dist/src/main.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "",
  }));
}

test("routes a portable action through the runtime worker facade without app HTML", async ({ page }) => {
  await blockProductAutoBoot(page);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const frame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 100, 40], children: ["button"] },
    { id: "button", kind: NodeKind.Button, bounds: [0, 0, 100, 40], label: "Trigger", action: { name: "generic.trigger", value: "pressed" } },
  ]);

  const result = await page.evaluate(async (bytes) => {
    const loadWorker = new Function("return import('/dist/src/worker.js')") as () => Promise<{ BrowserRuntimeWorker: new (loadModule: unknown) => { handle(command: unknown): Promise<unknown> } }>;
    const { BrowserRuntimeWorker } = await loadWorker();
    const calls: Array<[string, ...unknown[]]> = [];
    let nextHandle = 1;
    const worker = new BrowserRuntimeWorker(async () => ({
      create() { calls.push(["create"]); return nextHandle++; },
      audioOutputChannels(handle: number) { calls.push(["audioOutputChannels", handle]); return 2; },
      initialize(handle: number, dataRoot: string) { calls.push(["initialize", handle, dataRoot]); return 0; },
      prepare(handle: number, sampleRate: number, blockSize: number) { calls.push(["prepare", handle, sampleRate, blockSize]); return 0; },
      process(handle: number, frames: number, timestampMicros: number) { calls.push(["process", handle, frames, timestampMicros]); return 0; },
      messageTick(handle: number, timestampMicros: number) { calls.push(["messageTick", handle, timestampMicros]); return 0; },
      buildUiFrame(handle: number) { calls.push(["buildUiFrame", handle]); return Uint8Array.from(bytes).buffer; },
      dispatchAction(handle: number, name: string, value: string) { calls.push(["dispatchAction", handle, name, value]); return 0; },
      destroy(handle: number) { calls.push(["destroy", handle]); },
    }));

    await worker.handle({ type: "load" });
    await worker.handle({ type: "create" });
    await worker.handle({ type: "initialize", dataRoot: "/runtime-data" });
    await worker.handle({ type: "prepare", sampleRate: 48000, blockSize: 128 });
    await worker.handle({ type: "process", frames: 128, timestampMicros: 10 });
    await worker.handle({ type: "message-tick", timestampMicros: 11 });
    await worker.handle({ type: "dispatch-action", name: "generic.trigger", value: "pressed" });
    const uiFrame = await worker.handle({ type: "build-ui-frame" });
    await worker.handle({ type: "destroy" });
    const rejectedAfterDestroy = await worker.handle({ type: "build-ui-frame" });
    return { calls, uiFrame, rejectedAfterDestroy, html: document.body.innerHTML };
  }, Array.from(new Uint8Array(frame)));

  expect(result.uiFrame).toEqual({ type: "ui-frame", frame: Array.from(new Uint8Array(frame)) });
  expect(result.calls).toEqual([
    ["create"], ["initialize", 1, "/runtime-data"], ["prepare", 1, 48000, 128], ["process", 1, 128, 10],
    ["messageTick", 1, 11], ["dispatchAction", 1, "generic.trigger", "pressed"],
    ["buildUiFrame", 1], ["buildUiFrame", 1], ["destroy", 1],
  ]);
  expect(result.rejectedAfterDestroy).toEqual({ type: "error", error: "runtime is destroyed" });
  expect(result.html).not.toMatch(/miniapp|fake-browser/i);
});

test("main bootstrap composes runtime, UI, audio channels, and actions generically", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/dist/src/main.js");
  await page.setContent('<main id="synth-root"></main>');
  const frame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 120, 50], children: ["button"] },
    { id: "button", kind: NodeKind.Button, bounds: [0, 0, 120, 40], label: "Booted", action: { name: "generic.boot", value: "pressed" } },
  ]);

  const result = await page.evaluate(async (bytes) => {
    const { installSynthBrowserApp } = await (new Function("return import('/dist/src/main.js')")() as Promise<any>);
    const calls: Array<[string, ...unknown[]]> = [];
    const app = await installSynthBrowserApp(document.querySelector("#synth-root")!, {
      moduleUrl: "/dist/wasm/test-app.js",
      frameIntervalMs: 100000,
      runtimeModuleLoader: async () => ({
        filesystem: {
          filesystems: { IDBFS: "idbfs" },
          mkdir() {},
          mount() {},
          syncfs(_populate: boolean, complete: () => void) { complete(); },
        },
        create() { calls.push(["create"]); return 11; },
        audioOutputChannels(handle: number) { calls.push(["audioOutputChannels", handle]); return 1; },
        initialize(handle: number, dataRoot: string) { calls.push(["initialize", handle, dataRoot]); return 0; },
        prepare(handle: number, sampleRate: number, blockSize: number) { calls.push(["prepare", handle, sampleRate, blockSize]); return 0; },
        process() { return 0; },
        renderAudio(_handle: number, channels: number, frames: number) {
          calls.push(["renderAudio", channels, frames]);
          return { status: 0, outputs: [new Float32Array(frames).fill(0.125)] };
        },
        messageTick() { return 0; },
        buildUiFrame(handle: number) { calls.push(["buildUiFrame", handle]); return Uint8Array.from(bytes).buffer; },
        dispatchAction(handle: number, name: string, value: string) { calls.push(["dispatchAction", handle, name, value]); return 0; },
        submitMidiEndpoints() { return 0; },
        dequeueMidiAction() { return undefined; },
        deliverMidi() { return 0; },
        dequeueMidiOutput() { return undefined; },
        destroy() {},
      }),
      audioOptions: {
        audioContextFactory: () => ({
          sampleRate: 48000,
          destination: {},
          audioWorklet: { addModule: async () => {} },
          resume: async () => {},
        }),
        audioWorkletNodeFactory: () => ({ connect() {}, disconnect() {} }),
      },
    });
    document.querySelector<HTMLElement>('[data-synth-node-id="button"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    app.stop();
    return { calls, text: document.querySelector('[data-synth-node-id="button"]')?.textContent, status: (document.querySelector("#synth-root") as HTMLElement).dataset.synthStatus };
  }, Array.from(new Uint8Array(frame)));

  expect(result.text).toBe("Booted");
  expect(result.status).toMatch(/audio:online; midi:(online|offline)/);
  expect(result.calls).toContainEqual(["audioOutputChannels", 11]);
  expect(result.calls).toContainEqual(["prepare", 11, 48000, 128]);
  expect(result.calls).toContainEqual(["renderAudio", 1, 128]);
  expect(result.calls).toContainEqual(["dispatchAction", 11, "generic.boot", "pressed"]);
});

test("static auto boot uses the default worker runtime client and receives idle status", async ({ page }) => {
  const frame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 120, 50], children: ["button"] },
    { id: "button", kind: NodeKind.Button, bounds: [0, 0, 120, 40], label: "Auto", action: { name: "generic.auto", value: "pressed" } },
  ]);
  await page.addInitScript(({ frameBytes }) => {
    class FakeWorker extends EventTarget {
      constructor(readonly url: string | URL, readonly options?: WorkerOptions) {
        super();
        (window as unknown as { __synthWorkerConstructed: unknown[] }).__synthWorkerConstructed = [String(url), options];
      }

      postMessage(command: { type: string }) {
        const host = window as unknown as { __synthWorkerCommands?: string[] };
        host.__synthWorkerCommands = [...(host.__synthWorkerCommands ?? []), command.type];
        const respond = (data: unknown) => {
          setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data })), 0);
        };
        if (command.type === "load") respond({ type: "ok" });
        else if (command.type === "create") respond({ type: "created", handle: 17 });
        else if (command.type === "initialize") respond({ type: "ok" });
        else if (command.type === "audio-config") respond({ type: "audio-config", channels: 1 });
        else if (command.type === "build-ui-frame") {
          respond({ type: "ui-frame", frame: frameBytes });
          setTimeout(() => this.dispatchEvent(new MessageEvent("message", {
            data: { type: "page-status", path: "/data/.browser-status", status: "idle-persisted" },
          })), 20);
        } else respond({ type: "ok" });
      }

      terminate() {}
    }
    Object.defineProperty(window, "Worker", { value: FakeWorker });
  }, { frameBytes: Array.from(new Uint8Array(frame)) });

  await page.goto("http://127.0.0.1:4173/public/index.html");
  await expect(page.locator('[data-synth-node-id="button"]')).toHaveText("Auto");
  await expect(page.locator("#synth-root")).toHaveAttribute("data-synth-status", "idle-persisted");
  const worker = await page.evaluate(() => ({
    constructed: (window as unknown as { __synthWorkerConstructed?: unknown[] }).__synthWorkerConstructed,
    commands: (window as unknown as { __synthWorkerCommands?: string[] }).__synthWorkerCommands,
  }));
  expect(worker.constructed).toEqual([expect.stringContaining("/dist/src/worker.js"), { type: "module" }]);
  expect(worker.commands?.slice(0, 5)).toEqual(["load", "create", "initialize", "audio-config", "build-ui-frame"]);
  expect(worker.commands?.slice(5).every((command) => command === "build-ui-frame")).toBe(true);
});

test("browser worker contains no concrete application branch", async ({ page }) => {
  const forbidden = /MiniApp|miniapp|synth_miniapp|Vco|FilterModule|LfoBank/;
  await blockProductAutoBoot(page);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const source = await page.evaluate(async () => (await fetch("http://127.0.0.1:4173/src/worker.ts")).text());
  expect(source).not.toMatch(forbidden);
});
