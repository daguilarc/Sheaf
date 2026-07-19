import { expect, test, type Page } from "@playwright/test";

type FrameNode = {
  id: string;
  children: string[];
  pointerDragAction?: { name: string; value: string };
  doubleClickAction?: { name: string; value: string };
};

type FrameObservation = { nodes: FrameNode[] };

const fakeAcceptance = { shell: false, gestures: false, narrow: false };

async function builtFakeCatalogApp() {
  const { createHash } = await (new Function("return import('node:crypto')")() as Promise<{
    createHash(name: string): { update(bytes: Uint8Array): { digest(encoding: "hex"): string } };
  }>);
  const { readFile } = await (new Function("return import('node:fs/promises')")() as Promise<{
    readFile(path: URL): Promise<Uint8Array>;
  }>);
  const buildId = "fake-browser-app-build-1";
  const packageRoot = `packages/fake-browser-app/${buildId}`;
  const files = await Promise.all([
    ["fake_browser_app.js", "text/javascript"],
    ["fake_browser_app.wasm", "application/wasm"],
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
    globalId: "test/fake-browser-app",
    catalogUrl: "https://test.example/catalog.json",
    publisher: { id: "test", name: "Generic Test Publisher" },
    appId: "fake-browser-app",
    displayName: "Generic Fake App",
    author: "Sheaf Tests",
    category: "Instrument",
    buildId,
    browser: {
      abiVersion: 1,
      uiProtocolVersion: 1,
      runtimeConfigVersion: 1,
      entry: `${packageRoot}/fake_browser_app.js`,
      entryUrl: files[0].url,
      files,
    },
  };
}

test.afterAll(async () => {
  if (!Object.values(fakeAcceptance).every(Boolean)) return;
  const processInfo = (globalThis as any).process as { env: Record<string, string | undefined>; ppid: number };
  const gateFile = processInfo.env.SYNTH_BROWSER_FAKE_GATE ?? `/tmp/sheaf-synth-browser-fake-app-${processInfo.ppid}`;
  const { writeFile } = await (new Function("return import('node:fs/promises')")() as Promise<{
    writeFile(path: string, contents: string): Promise<void>;
  }>);
  await writeFile(gateFile, "passed\n");
});

async function installRealFakeApp(page: Page): Promise<void> {
  const application = await builtFakeCatalogApp();
  await page.route("**/dist/src/main.js*", (route) => {
    if (new URL(route.request().url()).search) return route.continue();
    return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  });
  await page.goto("http://127.0.0.1:4174/public/index.html");
  await page.evaluate(async (application) => {
    const root = document.querySelector<HTMLElement>("#synth-root")!;
    root.dataset.synthAuto = "false";
    root.dataset.synthLauncher = "false";
    const main = await (new Function("return import('/dist/src/main.js?task4-fake')")() as Promise<any>);
    const { decodeCommandBuffer } = await (new Function("return import('/dist/src/protocol.js')")() as Promise<any>);
    const { materializePackage } = await (new Function("return import('/dist/src/package-loader.js')")() as Promise<any>);
    const client = main.createWorkerRuntimeClient();
    const observations = {
      commands: [] as Array<{ type: string; name?: string; value?: string }>,
      responses: [] as Array<{ type: string; error?: string }>,
      frames: [] as FrameObservation[],
      terminated: false,
    };
    const resources = {
      contexts: 0,
      resumes: 0,
      closes: 0,
      midiRequests: 0,
      runtimeClients: 0,
      nodeConnects: 0,
      nodeDisconnects: 0,
      materializations: 0,
      packageDisposals: 0,
    };
    const observingClient = {
      async request(command: { type: string; name?: string; value?: string }) {
        observations.commands.push({ type: command.type, name: command.name, value: command.value });
        const response = await client.request(command);
        observations.responses.push({ type: response.type, error: response.type === "error" ? response.error : undefined });
        if (response.type === "ui-frame") {
          const frame = decodeCommandBuffer(Uint8Array.from(response.frame).buffer);
          observations.frames.push({ nodes: frame.nodes });
        }
        return response;
      },
      onStatus: client.onStatus,
      terminate: () => {
        observations.terminated = true;
        client.terminate?.();
      },
    };
    class TestAudioContext {
      readonly sampleRate = 48_000;
      readonly destination = {};
      readonly audioWorklet = { addModule: async () => {} };
      constructor() { resources.contexts += 1; }
      async resume() { resources.resumes += 1; }
      async close() { resources.closes += 1; }
    }
    Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: TestAudioContext });
    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      value: async () => {
        resources.midiRequests += 1;
        return { inputs: new Map(), outputs: new Map(), onstatechange: null };
      },
    });
    await main.installSheafPatchLauncher(root, {
      client: { loadSources: async () => ({ apps: [application], diagnostics: [], duplicateDiagnostics: [] }) },
      runtimeClientFactory: () => { resources.runtimeClients += 1; return observingClient; },
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
      audioOptions: {
        audioContextFactory: () => { throw new Error("second AudioContext"); },
        audioWorkletNodeFactory: () => ({
          connect() { resources.nodeConnects += 1; },
          disconnect() { resources.nodeDisconnects += 1; },
        }),
      },
      frameIntervalMs: 60_000,
    });
    (window as any).__task4Fake = { observations, resources };
  }, application);
  await page.getByRole("button", { name: /launch generic fake app/i }).click();
  await expect(page.locator('[data-synth-node-id="fake-browser-root"]')).toBeVisible();
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    const state = (window as any).__task4Fake;
    if (!state) return;
    dispatchEvent(new Event("pagehide"));
    if (!state.observations.terminated) throw new Error("SynthBrowserApp.stop() did not terminate the runtime client");
    if (state.resources.closes !== 1 || state.resources.nodeDisconnects !== 1 || state.resources.packageDisposals !== 1)
      throw new Error(`runtime resources were not released exactly once: ${JSON.stringify(state.resources)}`);
    delete (window as any).__task4Fake;
  });
});

async function assertNoContentSidebarOverlap(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('[data-synth-node-id="fake-browser-root"]')!.getBoundingClientRect();
    const sidebar = document.querySelector<HTMLElement>('[data-synth-node-id="runtime.sidebar.root"]')!.getBoundingClientRect();
    const composite = document.querySelector<HTMLElement>('[data-synth-node-id="runtime.main.root"]')!.getBoundingClientRect();
    return {
      contentRight: content.right,
      sidebarLeft: sidebar.left,
      sidebarRight: sidebar.right,
      compositeRight: composite.right,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(geometry.contentRight).toBeLessThanOrEqual(geometry.sidebarLeft + 0.5);
  expect(geometry.sidebarRight).toBeLessThanOrEqual(geometry.compositeRight + 0.5);
  expect(geometry.compositeRight).toBeLessThanOrEqual(geometry.viewportWidth + 0.5);
}

test("real fake-app WASM renders and refreshes the shared runtime shell", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await installRealFakeApp(page);

  await expect(page.locator('[data-synth-node-id="runtime.main.root"]')).toHaveCount(1);
  await expect(page.locator('[data-synth-node-id="fake-browser-root"]')).toBeVisible();
  await expect(page.locator('[data-synth-node-id="runtime.sidebar.root"]')).toBeVisible();
  await assertNoContentSidebarOverlap(page);

  for (const pageName of ["audio", "controllers", "file"] as const) {
    await page.locator(`[data-synth-node-id="runtime.sidebar.${pageName}"]`).click();
    await expect(page.locator(`[data-synth-node-id="runtime.${pageName}.root"]`)).toBeVisible();
    await expect(page.locator('[data-synth-node-id="fake-browser-root"]')).toHaveCount(0);
    await page.locator(`[data-synth-node-id="runtime.${pageName}.back"]`).click();
    await expect(page.locator('[data-synth-node-id="fake-browser-root"]')).toBeVisible();
  }

  const frameShape = await page.evaluate(() => {
    const frames = (window as any).__task4Fake.observations.frames as FrameObservation[];
    const initial = frames[0];
    const childIds = new Set(initial.nodes.flatMap((node) => node.children));
    return {
      roots: initial.nodes.filter((node) => !childIds.has(node.id)).map((node) => node.id),
      frameCount: frames.length,
    };
  });
  expect(frameShape.roots).toEqual(["runtime.main.root"]);
  expect(frameShape.frameCount).toBeGreaterThanOrEqual(7);
  expect(await page.evaluate(() => (window as any).__task4Fake.resources)).toEqual({
    contexts: 1,
    resumes: 1,
    closes: 0,
    midiRequests: 1,
    runtimeClients: 1,
    nodeConnects: 1,
    nodeDisconnects: 0,
    materializations: 1,
    packageDisposals: 0,
  });
  expect(await page.evaluate(() =>
    (window as any).__task4Fake.observations.commands.filter((command: { type: string }) => command.type === "load").length,
  )).toBe(1);
  fakeAcceptance.shell = true;
});

test("real fake-app WASM dispatches incremental drag and double-click actions", async ({ page }) => {
  await installRealFakeApp(page);
  const gesture = await page.evaluate(() => {
    const frame = ((window as any).__task4Fake.observations.frames as FrameObservation[])[0];
    const drag = frame.nodes.find((node) => node.pointerDragAction);
    const doubleClick = frame.nodes.find((node) => node.doubleClickAction);
    return {
      dragId: drag?.id,
      dragAction: drag?.pointerDragAction?.name,
      doubleClickId: doubleClick?.id,
      doubleClickAction: doubleClick?.doubleClickAction?.name,
    };
  });
  expect(gesture.dragId).toBeTruthy();
  expect(gesture.doubleClickId).toBeTruthy();

  const dragTarget = page.locator(`[data-synth-node-id="${gesture.dragId}"]`);
  const box = await dragTarget.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 20, box!.y + 20);
  await page.mouse.down();
  await page.mouse.move(box!.x + 27, box!.y + 18, { steps: 2 });
  await page.mouse.move(box!.x + 35, box!.y + 14, { steps: 2 });
  await page.mouse.up();
  await page.locator(`[data-synth-node-id="${gesture.doubleClickId}"] canvas`).dispatchEvent("dblclick");

  await expect.poll(() => page.evaluate(() =>
    (window as any).__task4Fake.observations.commands.filter((command: { type: string }) => command.type === "dispatch-action").length,
  )).toBeGreaterThanOrEqual(3);
  const actions = await page.evaluate(() =>
    (window as any).__task4Fake.observations.commands.filter((command: { type: string }) => command.type === "dispatch-action"),
  );
  expect(actions.length, JSON.stringify(actions)).toBeGreaterThanOrEqual(3);
  expect(actions.filter((action: { name?: string }) => action.name === gesture.dragAction).length).toBeGreaterThanOrEqual(2);
  expect(actions.some((action: { name?: string }) => action.name === gesture.doubleClickAction)).toBe(true);
  fakeAcceptance.gestures = true;
});

test("real fake-app shared shell remains non-overlapping at narrow width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installRealFakeApp(page);
  await expect(page.locator('[data-synth-node-id="runtime.main.root"]')).toBeVisible();
  await assertNoContentSidebarOverlap(page);
  fakeAcceptance.narrow = true;
});
