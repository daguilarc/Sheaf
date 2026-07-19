import { expect, test, type Page } from "@playwright/test";

type FrameNode = {
  id: string;
  children: string[];
  drawCount?: number;
  pointerDragAction?: { name: string; value: string };
  doubleClickAction?: { name: string; value: string };
};

type FrameObservation = { nodes: FrameNode[] };

async function builtMiniappCatalogApp() {
  const { createHash } = await (new Function("return import('node:crypto')")() as Promise<{
    createHash(name: string): { update(bytes: Uint8Array): { digest(encoding: "hex"): string } };
  }>);
  const { readFile } = await (new Function("return import('node:fs/promises')")() as Promise<{
    readFile(path: URL): Promise<Uint8Array>;
  }>);
  const buildId = "miniapp-build-1";
  const packageRoot = `packages/miniapp/${buildId}`;
  const files = await Promise.all([
    ["miniapp.js", "text/javascript"],
    ["miniapp.wasm", "application/wasm"],
  ].map(async ([name, mediaType]) => {
    const bytes = await readFile(new URL(`../dist/wasm/${name}`, import.meta.url));
    return {
      path: `${packageRoot}/${name}`,
      url: `http://127.0.0.1:4174/dist/wasm/${name}`,
      mediaType,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }));
  return {
    globalId: "sheaf/miniapp",
    catalogUrl: "https://sheaf.example/catalog.json",
    publisher: { id: "sheaf", name: "Sheaf" },
    appId: "miniapp",
    displayName: "Mini App",
    author: "Sheaf",
    category: "Instrument",
    buildId,
    browser: {
      abiVersion: 1,
      uiProtocolVersion: 1,
      runtimeConfigVersion: 1,
      entry: `${packageRoot}/miniapp.js`,
      entryUrl: files[0].url,
      files,
    },
  };
}

test.beforeAll(async () => {
  const processInfo = (globalThis as any).process as { env: Record<string, string | undefined>; ppid: number };
  if (processInfo.env.SYNTH_BROWSER_FAKE_GATE_CONFIRMED === "1") return;
  const gateFile = processInfo.env.SYNTH_BROWSER_FAKE_GATE ?? `/tmp/sheaf-synth-browser-fake-app-${processInfo.ppid}`;
  const { stat } = await (new Function("return import('node:fs/promises')")() as Promise<{ stat(path: string): Promise<unknown> }>);
  const deadline = Date.now() + 20_000;
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

async function installRealMiniapp(page: Page, options: { fakeMidi?: boolean; frameIntervalMs?: number } = {}): Promise<void> {
  const application = await builtMiniappCatalogApp();
  await page.route("**/dist/src/main.js*", (route) => {
    if (new URL(route.request().url()).search) return route.continue();
    return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  });
  await page.goto("http://127.0.0.1:4174/public/index.html");
  await page.evaluate(async ({ application, fakeMidi, frameIntervalMs }) => {
    const root = document.querySelector<HTMLElement>("#synth-root")!;
    root.dataset.synthAuto = "false";
    root.dataset.synthLauncher = "false";
    const main = await (new Function("return import('/dist/src/main.js?task4-miniapp')")() as Promise<any>);
    const { decodeCommandBuffer } = await (new Function("return import('/dist/src/protocol.js')")() as Promise<any>);
    const { materializePackage } = await (new Function("return import('/dist/src/package-loader.js')")() as Promise<any>);
    const resources = {
      contexts: 0,
      resumes: 0,
      closes: 0,
      midiRequests: 0,
      portCloses: 0,
      inputBindings: 0,
      runtimeClients: 0,
      nodeConnects: 0,
      nodeDisconnects: 0,
      materializations: 0,
      packageDisposals: 0,
    };
    class InputPort {
        readonly type = "input";
        state = "connected";
        private handler: ((event: { data: Uint8Array; timeStamp: number }) => void) | null = null;
        get onmidimessage() { return this.handler; }
        set onmidimessage(value: ((event: { data: Uint8Array; timeStamp: number }) => void) | null) {
          if (value && value !== this.handler) resources.inputBindings += 1;
          this.handler = value;
        }
        constructor(readonly id: string, readonly name: string) {}
        emit(bytes: number[]) { this.handler?.({ data: Uint8Array.from(bytes), timeStamp: 17 }); }
        async close() { resources.portCloses += 1; }
      }
    class OutputPort {
        readonly type = "output";
        state = "connected";
        readonly sent: number[][] = [];
        constructor(readonly id: string, readonly name: string) {}
        send(bytes: number[] | Uint8Array) { this.sent.push(Array.from(bytes)); }
        async close() { resources.portCloses += 1; }
      }
    const input = new InputPort("in-a", "Input A");
    const output = new OutputPort("out-a", "Output A");
    const access = fakeMidi
      ? { inputs: new Map([[input.id, input]]), outputs: new Map([[output.id, output]]), onstatechange: null }
      : { inputs: new Map(), outputs: new Map(), onstatechange: null };
    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      value: async (request: unknown) => {
        resources.midiRequests += 1;
        (window as any).__task4MidiRequest = request;
        return access;
      },
    });
    (window as any).__task4MidiPorts = { input, output };
    const client = main.createWorkerRuntimeClient();
    const observations = {
      commands: [] as Array<{ type: string; name?: string; value?: string }>,
      statuses: [] as Array<{ type: string; status?: string }>,
      frames: [] as FrameObservation[],
      terminated: false,
    };
    const runtimeClient = {
      async request(command: { type: string; name?: string; value?: string }) {
        observations.commands.push({ ...command });
        const response = await client.request(command);
        if (response.type === "ui-frame") {
          observations.frames.push({ nodes: decodeCommandBuffer(Uint8Array.from(response.frame).buffer).nodes });
        }
        return response;
      },
      onStatus: (handler: (response: unknown) => void) => client.onStatus?.((response: { type: string; status?: string }) => {
        observations.statuses.push(response);
        handler(response);
      }),
      terminate: () => {
        observations.terminated = true;
        client.terminate?.();
      },
    };
    let leasedContext: TestAudioContext | undefined;
    class TestAudioContext {
      readonly sampleRate = 48_000;
      readonly destination = {};
      readonly audioWorklet = { addModule: async () => {} };
      constructor() { resources.contexts += 1; leasedContext = this; }
      async resume() { resources.resumes += 1; }
      async close() { resources.closes += 1; }
    }
    Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: TestAudioContext });
    await main.installSheafPatchLauncher(root, {
      client: { loadSources: async () => ({ apps: [application], diagnostics: [], duplicateDiagnostics: [] }) },
      runtimeClientFactory: () => { resources.runtimeClients += 1; return runtimeClient; },
      materializePackage: async (app: unknown) => {
        resources.materializations += 1;
        const packageLease = await materializePackage(app);
        let disposed = false;
        return {
          ...packageLease,
          dispose() {
            if (disposed) return;
            disposed = true;
            resources.packageDisposals += 1;
            packageLease.dispose();
          },
        };
      },
      frameIntervalMs: frameIntervalMs ?? 60_000,
      audioOptions: {
        audioContextFactory: () => { throw new Error("second AudioContext"); },
        audioWorkletNodeFactory: (context: unknown) => ({
          connect() {
            if (context !== leasedContext) throw new Error("audio attached to wrong context");
            resources.nodeConnects += 1;
          },
          disconnect() { resources.nodeDisconnects += 1; },
        }),
      },
    });
    (window as any).__task4Miniapp = { observations, resources, expectedPortCloses: fakeMidi ? 2 : 0 };
  }, { application, ...options });
  await page.getByRole("button", { name: /launch mini app/i }).click();
  await expect(page.locator('[data-synth-node-id="miniapp.root"]')).toBeVisible();
}

async function stopRealMiniapp(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const state = (window as any).__task4Miniapp;
    if (!state) return;
    dispatchEvent(new Event("pagehide"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!state.observations.terminated) throw new Error("SynthBrowserApp.stop() did not terminate the runtime client");
    if (state.resources.closes !== 1 || state.resources.nodeDisconnects !== 1 || state.resources.packageDisposals !== 1)
      throw new Error(`runtime resources were not released exactly once: ${JSON.stringify(state.resources)}`);
    if (state.resources.portCloses !== state.expectedPortCloses)
      throw new Error(`MIDI ports were not released exactly once: ${JSON.stringify(state.resources)}`);
    delete (window as any).__task4Miniapp;
  });
}

test.afterEach(async ({ page }) => {
  await stopRealMiniapp(page);
});

async function settleVisuals(page: Page): Promise<void> {
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }" });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(100);
}

const miniappEncoderCanvasSelector = Array.from(
  { length: 7 },
  (_, index) => `[data-synth-node-id="miniapp.encoder.${index}"] > canvas`,
).join(", ");

test("miniapp smoke wiring keeps the generic fake-app gate first", async () => {
  const { readFile } = await (new Function("return import('node:fs/promises')")() as Promise<{
    readFile(path: URL, encoding: "utf8"): Promise<string>;
  }>);
  const browserMakefile = await readFile(new URL("../Makefile", import.meta.url), "utf8");
  const entry = await readFile(new URL("../cpp/miniapp_entry.cpp", import.meta.url), "utf8");
  expect(browserMakefile).toMatch(/browser-miniapp-smoke:\s+browser-fake-app-test/);
  expect(entry).toBe('#include "MiniApp.hpp"\n#include "synth/browser/BrowserAppEntry.hpp"\n\nSYNTH_BROWSER_APP(synth_miniapp::MiniApp)\n');
});

test("catalog-selected remote miniapp materializes its real worker bootstrap and AudioWorklet sidecars", async ({ page }) => {
  const remoteRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === "http://127.0.0.1:4174" && url.pathname.startsWith("/dist/site/"))
      remoteRequests.push(url.pathname);
  });
  await page.route("**/dist/src/main.js*", (route) => {
    if (new URL(route.request().url()).search) return route.continue();
    return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  });
  await page.goto("http://127.0.0.1:4173/public/index.html");
  await page.evaluate(async () => {
    const main = await (new Function("return import('/dist/src/main.js?task6-remote-miniapp')")() as Promise<any>);
    const { ActivationLease } = await (new Function("return import('/dist/src/activation.js')")() as Promise<any>);
    const { CatalogClient } = await (new Function("return import('/dist/src/catalog-client.js')")() as Promise<any>);
    const { materializePackage } = await (new Function("return import('/dist/src/package-loader.js')")() as Promise<any>);
    const root = document.querySelector<HTMLElement>("#synth-root")!;
    root.dataset.synthLauncher = "false";
    const observations = {
      selectedGlobalId: "",
      entryUrl: "",
      mainScriptUrlOrBlob: "",
      mainScriptMapping: "",
      wasmMapping: "",
      loadEntryUrl: "",
      loadMainScriptUrlOrBlob: "",
      workerUrls: [] as string[],
      blobFetches: [] as string[],
      audioWorkletModules: [] as string[],
      audioWorkletNodes: 0,
    };

    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      if (url.startsWith("blob:")) observations.blobFetches.push(url);
      return nativeFetch(input, init);
    }) as typeof fetch;
    const NativeWorker = globalThis.Worker;
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: new Proxy(NativeWorker, {
        construct(target, argumentsList) {
          observations.workerUrls.push(String(argumentsList[0]));
          return Reflect.construct(target, argumentsList);
        },
      }),
    });
    const NativeAudioWorkletNode = globalThis.AudioWorkletNode;
    Object.defineProperty(globalThis, "AudioWorkletNode", {
      configurable: true,
      value: new Proxy(NativeAudioWorkletNode, {
        construct(target, argumentsList) {
          observations.audioWorkletNodes += 1;
          return Reflect.construct(target, argumentsList);
        },
      }),
    });

    let runtimeClient: any;
    await main.installSheafPatchLauncher(root, {
      client: new CatalogClient({
        sourcesUrl: "http://127.0.0.1:4174/dist/site/catalog-sources.json",
      }),
      activationLeaseFactory: () => {
        const context = new AudioContext();
        const addModule = context.audioWorklet.addModule.bind(context.audioWorklet);
        context.audioWorklet.addModule = async (url: string | URL, options?: WorkletOptions) => {
          observations.audioWorkletModules.push(String(url));
          return addModule(url, options);
        };
        return ActivationLease.acquire({
          audioContextFactory: () => context,
          requestMIDIAccess: async () => ({ inputs: new Map(), outputs: new Map(), onstatechange: null }),
        });
      },
      materializePackage: async (app: any) => {
        observations.selectedGlobalId = app.globalId;
        const materialized = await materializePackage(app);
        observations.entryUrl = materialized.entryUrl;
        observations.mainScriptUrlOrBlob = materialized.mainScriptUrlOrBlob;
        observations.mainScriptMapping = materialized.locateFile["miniapp.js"];
        observations.wasmMapping = materialized.locateFile["miniapp.wasm"];
        return materialized;
      },
      runtimeClientFactory: () => {
        const client = main.createDirectRuntimeClient();
        runtimeClient = {
          ...client,
          async request(command: any) {
            if (command.type === "load") {
              observations.loadEntryUrl = command.module.entryUrl;
              observations.loadMainScriptUrlOrBlob = command.module.mainScriptUrlOrBlob;
            }
            return client.request(command);
          },
        };
        (window as any).__task6RemoteMiniapp.runtimeClient = runtimeClient;
        return runtimeClient;
      },
      frameIntervalMs: 25,
    });
    (window as any).__task6RemoteMiniapp = { observations, runtimeClient };
  });

  await expect(page.locator('.synth-launcher__app[data-synth-app-id="sheaf/miniapp"]')).toHaveCount(1);
  const beforeSelection = [...remoteRequests];
  expect(beforeSelection).toEqual([
    "/dist/site/catalog-sources.json",
    "/dist/site/catalogs/sheaf/catalog.json",
  ]);
  await page.getByRole("button", { name: /launch mini app/i }).click();
  await expect(page.locator('[data-synth-node-id="miniapp.root"]')).toBeVisible();
  await page.evaluate(async () => {
    const state = (window as any).__task6RemoteMiniapp;
    const response = await state.runtimeClient.request({
      type: "midi-input", controllerIx: 0, bytes: [0x90, 60, 100], timestampMicros: 1_000,
    });
    if (response.type !== "ok") throw new Error(response.error ?? `unexpected MIDI response ${response.type}`);
  });

  const observations = await page.evaluate(() => (window as any).__task6RemoteMiniapp.observations);
  expect(observations.selectedGlobalId).toBe("sheaf/miniapp");
  expect(observations.entryUrl).toMatch(/^blob:/);
  expect(observations.mainScriptUrlOrBlob).toMatch(/^blob:/);
  expect(observations.entryUrl).not.toBe(observations.mainScriptUrlOrBlob);
  expect(observations.mainScriptMapping).toBe(observations.mainScriptUrlOrBlob);
  expect(observations.wasmMapping).toMatch(/^blob:/);
  expect(observations.loadEntryUrl).toBe(observations.entryUrl);
  expect(observations.loadMainScriptUrlOrBlob).toBe(observations.mainScriptUrlOrBlob);
  expect(observations.workerUrls).toContain(observations.mainScriptUrlOrBlob);
  expect(observations.blobFetches).toContain(observations.wasmMapping);
  expect(observations.audioWorkletModules.some((url: string) => url.endsWith("/dist/src/audio-worklet.js"))).toBe(true);
  expect(observations.audioWorkletNodes).toBe(1);
  expect(remoteRequests.filter((pathname) => pathname.includes("/packages/"))).toEqual(expect.arrayContaining([
    expect.stringMatching(/^\/dist\/site\/catalogs\/sheaf\/packages\/miniapp\/[0-9a-f]{64}\/miniapp\.js$/),
    expect.stringMatching(/^\/dist\/site\/catalogs\/sheaf\/packages\/miniapp\/[0-9a-f]{64}\/miniapp\.wasm$/),
  ]));
  expect(remoteRequests.some((pathname) => pathname.includes("/rollback/"))).toBe(false);

  await page.evaluate(() => {
    dispatchEvent(new Event("pagehide"));
    delete (window as any).__task6RemoteMiniapp;
  });
});

test("real miniapp WASM renders the complete shared shell and portable pages", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await installRealMiniapp(page);
  await expect(page.locator('[data-synth-node-id="runtime.main.root"]')).toHaveCount(1);
  await expect(page.locator('[data-synth-node-id="miniapp.root"]')).toBeVisible();
  await expect(page.locator('[data-synth-node-id="runtime.sidebar.root"]')).toBeVisible();
  await expect(page.locator(miniappEncoderCanvasSelector)).toHaveCount(7);
  await expect(page.locator('[data-synth-node-id="miniapp.vco.scope"] canvas')).toBeVisible();
  await expect(page.locator('[data-synth-node-id="miniapp.lfo.scope"] canvas')).toBeVisible();
  await expect(page.locator('[data-synth-node-id="miniapp.bank.vco"]')).toBeVisible();
  await expect(page.locator('[data-synth-node-id="miniapp.scene.blend"]')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__task4Miniapp.resources)).toEqual({
    contexts: 1,
    resumes: 1,
    closes: 0,
    midiRequests: 1,
    portCloses: 0,
    inputBindings: 0,
    runtimeClients: 1,
    nodeConnects: 1,
    nodeDisconnects: 0,
    materializations: 1,
    packageDisposals: 0,
  });
  expect(await page.evaluate(() =>
    (window as any).__task4Miniapp.observations.commands.filter((command: { type: string }) => command.type === "load").length,
  )).toBe(1);

  const geometry = await page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('[data-synth-node-id="miniapp.root"]')!.getBoundingClientRect();
    const sidebar = document.querySelector<HTMLElement>('[data-synth-node-id="runtime.sidebar.root"]')!.getBoundingClientRect();
    const composite = document.querySelector<HTMLElement>('[data-synth-node-id="runtime.main.root"]')!.getBoundingClientRect();
    const appCanvases = [...document.querySelectorAll<HTMLCanvasElement>('[data-synth-node-id^="miniapp."] canvas')].map((canvas) => canvas.getBoundingClientRect());
    return { appRight: app.right, sidebarLeft: sidebar.left, sidebarRight: sidebar.right, compositeRight: composite.right,
      rightmostCanvas: Math.max(...appCanvases.map((bounds) => bounds.right)) };
  });
  expect(geometry.appRight).toBeLessThanOrEqual(geometry.sidebarLeft + 0.5);
  expect(geometry.rightmostCanvas).toBeLessThanOrEqual(geometry.appRight + 0.5);
  expect(geometry.sidebarRight).toBeLessThanOrEqual(geometry.compositeRight + 0.5);

  for (const pageName of ["audio", "controllers", "file"] as const) {
    await page.locator(`[data-synth-node-id="runtime.sidebar.${pageName}"]`).click();
    await expect(page.locator(`[data-synth-node-id="runtime.${pageName}.root"]`)).toBeVisible();
    await page.locator(`[data-synth-node-id="runtime.${pageName}.back"]`).click();
    await expect(page.locator('[data-synth-node-id="miniapp.root"]')).toBeVisible();
  }

  const rootIds = await page.evaluate(() => {
    const frame = ((window as any).__task4Miniapp.observations.frames as FrameObservation[])[0];
    const children = new Set(frame.nodes.flatMap((node) => node.children));
    return frame.nodes.filter((node) => !children.has(node.id)).map((node) => node.id);
  });
  expect(rootIds).toEqual(["runtime.main.root"]);

  await settleVisuals(page);
  await page.screenshot({ path: new URL("./screenshots/runtime-shell-desktop.png", import.meta.url).pathname });
});

test("real miniapp WASM preserves gestures across fresh frames", async ({ page }) => {
  await installRealMiniapp(page);
  const gesture = await page.evaluate(() => {
    const frame = ((window as any).__task4Miniapp.observations.frames as FrameObservation[])[0];
    const drag = frame.nodes.find((node) => node.pointerDragAction && !node.id.startsWith("runtime."));
    const doubleClick = frame.nodes.find((node) => node.doubleClickAction && !node.id.startsWith("runtime."));
    return { dragId: drag?.id, dragAction: drag?.pointerDragAction?.name,
      doubleClickId: doubleClick?.id, doubleClickAction: doubleClick?.doubleClickAction?.name };
  });
  expect(gesture.dragId).toBeTruthy();
  expect(gesture.doubleClickId).toBeTruthy();
  const target = page.locator(`[data-synth-node-id="${gesture.dragId}"]`);
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 30, box!.y + 30);
  await page.mouse.down();
  await page.mouse.move(box!.x + 38, box!.y + 27, { steps: 2 });
  await page.mouse.move(box!.x + 48, box!.y + 22, { steps: 2 });
  await page.mouse.up();
  await page.locator(`[data-synth-node-id="${gesture.doubleClickId}"] canvas`).dispatchEvent("dblclick");
  await expect.poll(() => page.evaluate(() =>
    (window as any).__task4Miniapp.observations.commands.filter((command: { type: string }) => command.type === "dispatch-action").length,
  )).toBeGreaterThanOrEqual(3);
  const actions = await page.evaluate(() =>
    (window as any).__task4Miniapp.observations.commands.filter((command: { type: string }) => command.type === "dispatch-action"),
  );
  expect(actions.filter((action: { name?: string }) => action.name === gesture.dragAction).length).toBeGreaterThanOrEqual(2);
  expect(actions.some((action: { name?: string }) => action.name === gesture.doubleClickAction)).toBe(true);
});

test("real miniapp controller page selects Web MIDI endpoints through visible controls", async ({ page }) => {
  await installRealMiniapp(page, { fakeMidi: true, frameIntervalMs: 25 });
  await page.locator('[data-synth-node-id="runtime.sidebar.controllers"]').click();
  await expect(page.locator('[data-synth-node-id="runtime.controllers.root"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__task4MidiRequest)).toEqual({ sysex: true });
  await expect.poll(() => page.evaluate(() =>
    (window as any).__task4Miniapp.observations.commands
      .filter((command: { type: string }) => command.type === "midi-endpoints")
      .flatMap((command: { endpoints?: Array<{ identifier: string }> }) => command.endpoints?.map((endpoint) => endpoint.identifier) ?? []),
  )).toEqual(expect.arrayContaining(["in-a", "out-a"]));
  await page.locator('[data-synth-node-id="runtime.controllers.add_name"] input').fill("webctl");
  await page.locator('[data-synth-node-id="runtime.controllers.add_kind"] select').selectOption("generic");
  await expect.poll(() => page.evaluate(() =>
    (window as any).__task4Miniapp.observations.commands
      .filter((command: { type: string }) => command.type === "dispatch-action")
      .map((command: { name?: string; value?: string }) => [command.name, command.value]),
  )).toEqual(expect.arrayContaining([
    ["runtime.controllers.add_name_draft", "webctl"],
    ["runtime.controllers.add_kind_draft", "generic"],
  ]));
  await page.locator('[data-synth-node-id="runtime.controllers.add_button"]').click();
  await expect(page.locator('[data-synth-node-id="runtime.controllers.row.0.input"] select')).toBeVisible();
  await expect(page.locator('[data-synth-node-id="runtime.controllers.row.0.input"] select')).toContainText("Input A");
  await expect(page.locator('[data-synth-node-id="runtime.controllers.row.0.output"] select')).toContainText("Output A");

  await page.locator('[data-synth-node-id="runtime.controllers.row.0.input"] select').selectOption("in-a");
  await page.locator('[data-synth-node-id="runtime.controllers.row.0.output"] select').selectOption("out-a");
  await expect.poll(() => page.locator('[data-synth-node-id="runtime.controllers.status"]').textContent())
    .toMatch(/Selected (Input|Output) A/);
  await expect.poll(() => page.evaluate(() => (window as any).__task4Miniapp.resources.inputBindings)).toBe(1);

  await page.locator('[data-synth-node-id="runtime.controllers.add_name"] input').fill("webpad");
  await page.locator('[data-synth-node-id="runtime.controllers.add_kind"] select').selectOption("launchpad");
  await expect.poll(() => page.evaluate(() =>
    (window as any).__task4Miniapp.observations.commands
      .filter((command: { type: string }) => command.type === "dispatch-action")
      .map((command: { name?: string; value?: string }) => [command.name, command.value]),
  )).toEqual(expect.arrayContaining([
    ["runtime.controllers.add_name_draft", "webpad"],
    ["runtime.controllers.add_kind_draft", "launchpad"],
  ]));
  await page.locator('[data-synth-node-id="runtime.controllers.add_button"]').click();
  const variantSelect = page.locator('[data-synth-node-id^="runtime.controllers.row."][data-synth-node-id$=".variant"] select').last();
  await expect(variantSelect).toBeVisible();
  const variantNodeId = await variantSelect.locator("xpath=..").getAttribute("data-synth-node-id");
  const variantControllerIx = variantNodeId?.match(/runtime\.controllers\.row\.(\d+)\.variant/)?.[1];
  expect(variantControllerIx).toBeTruthy();
  await variantSelect.selectOption("1");

  await expect.poll(() => page.evaluate(() =>
    (window as any).__task4Miniapp.observations.commands
      .filter((command: { type: string }) => command.type === "dispatch-action")
      .map((command: { name?: string; value?: string }) => [command.name, command.value]),
  )).toEqual(expect.arrayContaining([
    ["runtime.controllers.add_name_draft", "webctl"],
    ["runtime.controllers.add_kind_draft", "generic"],
    ["runtime.controllers.add_controller", ""],
    ["runtime.controllers.endpoint_select", "0:input:in-a"],
    ["runtime.controllers.endpoint_select", "0:output:out-a"],
    ["runtime.controllers.add_name_draft", "webpad"],
    ["runtime.controllers.add_kind_draft", "launchpad"],
    ["runtime.controllers.variant_select", `${variantControllerIx}:1`],
  ]));

  await expect.poll(() => page.locator('[data-synth-node-id="runtime.controllers.status"]').textContent())
    .toMatch(/Selected Launchpad/);
});

test("real miniapp patch saves survive browser runtime restart through IDBFS", async ({ page }) => {
  const patchName = `codex-persist-${Date.now()}`;
  await installRealMiniapp(page, { frameIntervalMs: 25 });
  await page.locator('[data-synth-node-id="runtime.sidebar.file"]').click();
  await page.locator('[data-synth-node-id="runtime.file.save_as"]').click();
  await page.locator('[data-synth-node-id="runtime.file.browser.save_name"] input').fill(patchName);
  await page.locator('[data-synth-node-id="runtime.file.browser.confirm"]').click();
  await expect.poll(() => page.locator('[data-synth-node-id="runtime.file.patch_name"]').textContent())
    .toBe(patchName);
  await expect.poll(() => page.evaluate(() =>
    (window as any).__task4Miniapp.observations.statuses
      .filter((status: { type: string; status?: string }) => status.type === "page-status" && status.status === "persistence succeeded").length,
  )).toBeGreaterThanOrEqual(2);

  await stopRealMiniapp(page);
  await installRealMiniapp(page, { frameIntervalMs: 25 });
  await page.locator('[data-synth-node-id="runtime.sidebar.file"]').click();
  await page.locator('[data-synth-node-id="runtime.file.load"]').click();
  await expect(page.locator('[data-synth-node-id^="runtime.file.browser.entry."]').filter({ hasText: patchName }).first()).toBeVisible();
});

test("real miniapp shared shell scales as one non-overlapping narrow surface", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installRealMiniapp(page);
  await page.locator('[data-synth-node-id="runtime.sidebar.audio"]').click();
  await expect(page.locator('[data-synth-node-id="runtime.audio.root"]')).toBeVisible();
  await page.waitForTimeout(100);
  await page.locator('[data-synth-node-id="runtime.audio.back"]').click();
  await expect(page.locator('[data-synth-node-id="miniapp.root"]')).toBeVisible();
  const encoderRendering = await page.evaluate(() => {
    const frame = ((window as any).__task4Miniapp.observations.frames as FrameObservation[]).at(-1)!;
    const encoderNodeIds = Array.from({ length: 7 }, (_, index) => `miniapp.encoder.${index}`);
    const drawCounts = encoderNodeIds.map(
      (id) => frame.nodes.find((node) => node.id === id)?.drawCount ?? 0,
    );
    const canvases = encoderNodeIds.flatMap((id) => [
      ...document.querySelectorAll<HTMLCanvasElement>(`[data-synth-node-id="${id}"] > canvas`),
    ]);
    return {
      drawCounts,
      canvases: canvases.map((canvas) => {
        const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set<string>();
        for (let offset = 0; offset < pixels.length; offset += 4) {
          colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${pixels[offset + 3]}`);
        }
        const rect = canvas.getBoundingClientRect();
        return { backingWidth: canvas.width, backingHeight: canvas.height, cssWidth: rect.width, cssHeight: rect.height, colors: colors.size };
      }),
    };
  });
  expect(encoderRendering.drawCounts).toHaveLength(7);
  expect(encoderRendering.drawCounts.every((count) => count > 0), JSON.stringify(encoderRendering)).toBe(true);
  expect(encoderRendering.canvases).toHaveLength(7);
  expect(encoderRendering.canvases.every((canvas) => canvas.cssWidth > 0 && canvas.cssHeight > 0 && canvas.colors > 3), JSON.stringify(encoderRendering)).toBe(true);
  const geometry = await page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('[data-synth-node-id="miniapp.root"]')!.getBoundingClientRect();
    const sidebar = document.querySelector<HTMLElement>('[data-synth-node-id="runtime.sidebar.root"]')!.getBoundingClientRect();
    const composite = document.querySelector<HTMLElement>('[data-synth-node-id="runtime.main.root"]')!.getBoundingClientRect();
    return { appRight: app.right, sidebarLeft: sidebar.left, sidebarRight: sidebar.right,
      compositeRight: composite.right, viewportWidth: document.documentElement.clientWidth };
  });
  expect(geometry.appRight).toBeLessThanOrEqual(geometry.sidebarLeft + 0.5);
  expect(geometry.sidebarRight).toBeLessThanOrEqual(geometry.compositeRight + 0.5);
  expect(geometry.compositeRight).toBeLessThanOrEqual(geometry.viewportWidth + 0.5);
  await settleVisuals(page);
  await page.screenshot({ path: new URL("./screenshots/runtime-shell-narrow.png", import.meta.url).pathname });
});
