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
      abiVersion: 1,
      uiProtocolVersion: 1,
      runtimeConfigVersion: 1,
      create() { calls.push(["create"]); return nextHandle++; },
      audioOutputChannels(handle: number) { calls.push(["audioOutputChannels", handle]); return 2; },
      initialize(handle: number, dataRoot: string) { calls.push(["initialize", handle, dataRoot]); return 0; },
      prepare(handle: number, sampleRate: number, blockSize: number) { calls.push(["prepare", handle, sampleRate, blockSize]); return 0; },
      process(handle: number, frames: number, timestampMicros: number) { calls.push(["process", handle, frames, timestampMicros]); return 0; },
      startAudioWorklet(handle: number) { calls.push(["startAudioWorklet", handle]); return 0; },
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
    await worker.handle({ type: "start-audio-worklet" });
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
    ["startAudioWorklet", 1],
    ["messageTick", 1, 11], ["dispatchAction", 1, "generic.trigger", "pressed"],
    ["buildUiFrame", 1], ["buildUiFrame", 1], ["destroy", 1],
  ]);
  expect(result.rejectedAfterDestroy).toEqual({ type: "error", error: "runtime is destroyed" });
  expect(result.html).not.toMatch(/miniapp|fake-browser/i);
});

test("reads Emscripten browser contract versions without creating a runtime", async ({ page }) => {
  await blockProductAutoBoot(page);
  await page.goto("http://127.0.0.1:4173/public/index.html");

  const result = await page.evaluate(async () => {
    const { emscriptenRuntimeFacade } = await (new Function("return import('/dist/src/worker.js')")() as Promise<any>);
    const calls: string[] = [];
    const facade = emscriptenRuntimeFacade({
      _synth_browser_abi_version() { calls.push("abiVersion"); return 1; },
      _synth_browser_ui_protocol_version() { calls.push("uiProtocolVersion"); return 1; },
      _synth_browser_runtime_config_version() { calls.push("runtimeConfigVersion"); return 1; },
      _synth_browser_create() { calls.push("create"); return 1; },
    } as any);
    return {
      versions: {
        abiVersion: facade.abiVersion,
        uiProtocolVersion: facade.uiProtocolVersion,
        runtimeConfigVersion: facade.runtimeConfigVersion,
      },
      calls,
    };
  });

  expect(result.versions).toEqual({ abiVersion: 1, uiProtocolVersion: 1, runtimeConfigVersion: 1 });
  expect(result.calls).toEqual(["abiVersion", "uiProtocolVersion", "runtimeConfigVersion"]);
});

test("rejects incompatible modules before creation or persistence setup", async ({ page }) => {
  await blockProductAutoBoot(page);
  await page.goto("http://127.0.0.1:4173/public/index.html");

  const results = await page.evaluate(async () => {
    const { BrowserRuntimeWorker } = await (new Function("return import('/dist/src/worker.js')")() as Promise<any>);
    const fields = ["abiVersion", "uiProtocolVersion", "runtimeConfigVersion"];
    return await Promise.all(fields.map(async (field) => {
      const calls: string[] = [];
      const versions = { abiVersion: 1, uiProtocolVersion: 1, runtimeConfigVersion: 1, [field]: 2 };
      const worker = new BrowserRuntimeWorker(
        async () => ({
          ...versions,
          filesystem: {},
          create() { calls.push("create"); return 1; },
        }),
        () => {
          calls.push("persistence");
          throw new Error("persistence must not be created");
        },
      );
      const loaded = await worker.handle({ type: "load" });
      const created = await worker.handle({ type: "create" });
      return { field, loaded, created, calls };
    }));
  });

  for (const result of results) {
    expect(result.loaded).toEqual({
      type: "error",
      error: expect.stringMatching(new RegExp(`${result.field}.*required 2.*supported 1|${result.field}.*supported 1.*received 2`, "i")),
    });
    expect(result.created).toEqual({ type: "error", error: "runtime module is not loaded" });
    expect(result.calls).toEqual([]);
  }
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
        abiVersion: 1,
        uiProtocolVersion: 1,
        runtimeConfigVersion: 1,
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
        startAudioWorklet(handle: number) { calls.push(["startAudioWorklet", handle]); return 0; },
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
        destroy(handle: number) { calls.push(["destroy", handle]); },
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { calls, text: document.querySelector('[data-synth-node-id="button"]')?.textContent, status: (document.querySelector("#synth-root") as HTMLElement).dataset.synthStatus };
  }, Array.from(new Uint8Array(frame)));

  expect(result.text).toBe("Booted");
  expect(result.status).toMatch(/audio:online; midi:(online|offline)/);
  expect(result.calls).toContainEqual(["audioOutputChannels", 11]);
  expect(result.calls).toContainEqual(["startAudioWorklet", 11]);
  expect(result.calls).not.toContainEqual(["prepare", 11, 48000, 128]);
  expect(result.calls).not.toContainEqual(["renderAudio", 1, 128]);
  expect(result.calls).toContainEqual(["dispatchAction", 11, "generic.boot", "pressed"]);
  expect(result.calls).toContainEqual(["destroy", 11]);
});

test("direct runtime installation supersedes delayed launcher auto-boot across fresh module evaluation", async ({ page }) => {
  const catalogUrl = "https://publisher.example/delayed-catalog.json";
  const pendingCatalogs: Array<import("@playwright/test").Route> = [];
  await page.route("http://127.0.0.1:4173/catalog-sources.json", (route) => route.fulfill({ json: [catalogUrl] }));
  await page.route(catalogUrl, (route) => { pendingCatalogs.push(route); });
  await page.goto("http://127.0.0.1:4173/public/index.html");
  await expect.poll(() => pendingCatalogs.length).toBe(1);
  const frame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 120, 50], children: ["button"] },
    { id: "button", kind: NodeKind.Button, bounds: [0, 0, 120, 40], label: "Direct owner", action: { name: "generic.direct", value: "pressed" } },
  ]);

  await page.evaluate(async (bytes) => {
    const main = await (new Function("return import('/dist/src/main.js?review-direct-owner')")() as Promise<any>);
    const runtimeClient = {
      async request(command: { type: string }) {
        if (command.type === "audio-config") return { type: "audio-config", channels: 2 };
        if (command.type === "build-ui-frame") return { type: "ui-frame", frame: bytes };
        return { type: "ok" };
      },
      terminate() {},
    };
    (window as any).__reviewDirectApp = await main.installSynthBrowserApp(
      document.querySelector("#synth-root"),
      { runtimeClient, frameIntervalMs: 60_000 },
    );
  }, Array.from(new Uint8Array(frame)));
  await expect(page.locator('[data-synth-node-id="button"]')).toHaveText("Direct owner");
  await expect.poll(() => pendingCatalogs.length).toBe(2);

  const response = {
    schemaVersion: 1,
    catalogVersion: "revision-1",
    publisher: { id: "example", name: "Example" },
    apps: [{
      appId: "portable-app",
      displayName: "Portable App",
      author: "Example",
      category: "Instrument",
      buildId: "portable-app-build-1",
      browser: {
        abiVersion: 1,
        uiProtocolVersion: 1,
        runtimeConfigVersion: 1,
        entry: "packages/portable-app/portable-app-build-1/app.js",
        files: [{
          path: "packages/portable-app/portable-app-build-1/app.js",
          mediaType: "text/javascript",
          sha256: "0123456789abcdef".repeat(4),
        }],
      },
    }],
  };
  await Promise.all(pendingCatalogs.map((route) => route.fulfill({ json: response })));

  await expect(page.locator('[data-synth-node-id="button"]')).toHaveText("Direct owner");
  await expect(page.getByRole("heading", { name: "SheafPatch" })).toHaveCount(0);
  await page.evaluate(() => (window as any).__reviewDirectApp.stop());
});

test("production bootstrap discovers catalogs without loading an application module", async ({ page }) => {
  const catalogUrl = "https://publisher.example/catalog.json";
  const requested: string[] = [];
  await page.route("http://127.0.0.1:4173/catalog-sources.json", (route) => route.fulfill({ json: [catalogUrl] }));
  await page.route(catalogUrl, (route) => route.fulfill({
    json: {
      schemaVersion: 1,
      catalogVersion: "revision-1",
      publisher: { id: "example", name: "Example" },
      apps: [{
        appId: "portable-app",
        displayName: "Portable App",
        author: "Example",
        category: "Instrument",
        buildId: "portable-app-build-1",
        browser: {
          abiVersion: 1,
          uiProtocolVersion: 1,
          runtimeConfigVersion: 1,
          entry: "packages/portable-app/portable-app-build-1/app.js",
          files: [{
            path: "packages/portable-app/portable-app-build-1/app.js",
            mediaType: "text/javascript",
            sha256: "0123456789abcdef".repeat(4),
          }],
        },
      }],
    },
  }));
  page.on("request", (request) => requested.push(request.url()));

  await page.goto("http://127.0.0.1:4173/public/index.html");
  await expect(page.getByRole("button", { name: /launch portable app/i })).toBeEnabled();

  expect(requested).toContain("http://127.0.0.1:4173/catalog-sources.json");
  expect(requested).toContain(catalogUrl);
  expect(requested).not.toContain("http://127.0.0.1:4173/dist/wasm/app.js");
  expect(requested.filter((url) => /\/packages\//.test(url))).toEqual([]);
});

test("browser worker contains no concrete application branch", async ({ page }) => {
  const forbidden = /MiniApp|miniapp|synth_miniapp|Vco|FilterModule|LfoBank/;
  await blockProductAutoBoot(page);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const source = await page.evaluate(async () => (await fetch("http://127.0.0.1:4173/src/worker.ts")).text());
  expect(source).not.toMatch(forbidden);
});
