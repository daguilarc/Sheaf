// Shared harness for the REAL fake browser app: a first-party runtime shell
// running the fixture app's freshly built Wasm, with every runtime resource
// instrumented so a test can assert it was released exactly once.
//
// `npm test` runs `make browser-fixture-app` before Playwright, so the package
// this installs is compiled from `tests/fixtures/cpp/FakeBrowserApp.hpp` on
// every run: the surfaces it renders are the real producers' current output,
// not a checked-in fixture that could go stale.
//
// Extracted from `fake-app.e2e.spec.ts` so `visual-criteria.spec.ts` can drive
// the same shell without a second copy of the setup.
import { expect, type Page } from "@playwright/test";

type FrameNode = {
  id: string;
  children: string[];
  pointerDragAction?: { name: string; value: string };
  doubleClickAction?: { name: string; value: string };
};

type FrameObservation = { nodes: FrameNode[] };


export type { FrameNode, FrameObservation };

// The fixture apps this harness can install. Both are compiled from the same
// `FakeBrowserApp.hpp` on every run; they differ only in the surface height
// their `Config()` declares, which is the one thing a browser test cannot vary
// any other way. See the comment on `TallFakeBrowserApp`.
export const FIXTURE_APPS = {
  standard: { appId: "fake-browser-app", displayName: "Generic Fake App", uiHeight: 480 },
  tall: { appId: "tall-fake-browser-app", displayName: "Tall Generic Fake App", uiHeight: 720 },
} as const;

export type FixtureApp = (typeof FIXTURE_APPS)[keyof typeof FIXTURE_APPS];

export async function builtFakeCatalogApp(app: FixtureApp = FIXTURE_APPS.standard) {
  const { createHash } = await (new Function("return import('node:crypto')")() as Promise<{
    createHash(name: string): { update(bytes: Uint8Array): { digest(encoding: "hex"): string } };
  }>);
  const { readFile } = await (new Function("return import('node:fs/promises')")() as Promise<{
    readFile(path: URL): Promise<Uint8Array>;
  }>);
  const buildId = `${app.appId}-build-1`;
  const packageRoot = `packages/${app.appId}/${buildId}`;
  const emissionRoot = `fixture-apps/${app.appId}`;
  const files = await Promise.all([
    [`${app.appId}.js`, "text/javascript"],
    [`${app.appId}.wasm`, "application/wasm"],
  ].map(async ([name, mediaType]) => {
    const bytes = await readFile(new URL(`../../dist/wasm/${emissionRoot}/${name}`, import.meta.url));
    return {
      path: `${packageRoot}/${name}`,
      url: `http://127.0.0.1:4174/dist/wasm/${emissionRoot}/${name}`,
      mediaType,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }));
  return {
    globalId: `test/${app.appId}`,
    catalogUrl: "https://test.example/catalog.json",
    publisher: { id: "test", name: "Generic Test Publisher" },
    appId: app.appId,
    displayName: app.displayName,
    author: "Sheaf Tests",
    category: "Instrument",
    buildId,
    browser: {
      abiVersion: 4,
      uiProtocolVersion: 2,
      runtimeConfigVersion: 1,
      entry: `${packageRoot}/${app.appId}.js`,
      entryUrl: files[0].url,
      files,
    },
  };
}

export async function installRealFakeApp(
  page: Page,
  app: FixtureApp = FIXTURE_APPS.standard,
): Promise<void> {
  const application = await builtFakeCatalogApp(app);
  await page.route("**/dist/src/main.js*", (route) => {
    if (new URL(route.request().url()).search) return route.continue();
    return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  });
  await page.goto("http://127.0.0.1:4174/public/index.html");
  await page.evaluate(async (application) => {
    const controllerWizardMidi = (window as any).__controllerWizardMidi ??= {
      access: { inputs: new Map(), outputs: new Map(), onstatechange: null },
    };
    const root = document.querySelector<HTMLElement>("#synth-root")!;
    root.dataset.synthAuto = "false";
    root.dataset.synthLauncher = "false";
    const main = await (new Function("return import('/dist/src/main.js?task4-fake')")() as Promise<any>);
    const worker = await (new Function("return import('/dist/src/worker.js?task4-fake')")() as Promise<any>);
    const packageLoader = await (new Function("return import('/dist/src/package-loader.js?task4-fake')")() as Promise<any>);
    const { decodeCommandBuffer } = await (new Function("return import('/dist/src/protocol.js')")() as Promise<any>);
    const { materializePackage } = await (new Function("return import('/dist/src/package-loader.js')")() as Promise<any>);
    const { ActivationLease } = await (new Function("return import('/dist/src/activation.js')")() as Promise<any>);
    const observations = {
      commands: [] as Array<Record<string, unknown> & { type: string; name?: string; value?: string }>,
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

    const createObservedRuntimeClient = () => {
      const statusHandlers = new Set<(response: any) => void>();
      const runtime = new worker.BrowserRuntimeWorker(async (materialized: any) => {
        const imported = await (new Function("url", "return import(url)")(materialized.entryUrl) as Promise<any>);
        const factory = imported.default ?? imported.createSynthBrowserModule;
        if (!factory) throw new Error("runtime module does not export an Emscripten factory");
        const module = await factory({
          locateFile(requestedPath: string) {
            const normalized = packageLoader.normalizeMaterializedPath(
              requestedPath,
              `Emscripten requested path ${String(requestedPath)}`,
            );
            const url = materialized.locateFile[normalized];
            if (typeof url !== "string" || url.length === 0)
              throw new Error(`Emscripten requested unmapped package path ${requestedPath}; file was not materialized`);
            return url;
          },
          mainScriptUrlOrBlob: materialized.mainScriptUrlOrBlob,
        });
        const idbfs = module.IDBFS ?? module.FS.filesystems?.IDBFS;
        if (!idbfs) throw new Error("runtime module does not include IDBFS");
        (window as any).__task4FakeRuntimeFs = module.FS;
        return {
          ...worker.emscriptenRuntimeFacade(module),
          filesystem: {
            filesystems: { IDBFS: idbfs },
            mkdir: (path: string) => module.FS.mkdir(path),
            mount: (type: unknown, options: object, path: string) => module.FS.mount(type, options, path),
            syncfs: (populate: boolean, complete: (error?: Error) => void) => module.FS.syncfs(populate, complete),
          },
        };
      }, undefined, (response: any) => statusHandlers.forEach((handler) => handler(response)));
      let queue: Promise<void> = Promise.resolve();
      const request = (command: any) => {
        const run = () => runtime.handle(command);
        const response = queue.then(run, run);
        queue = response.then(() => {}, () => {});
        return response;
      };
      return {
        request,
        startAudioWorklet: async (context?: AudioContext) => {
          const response = await runtime.startAudioWorklet(context);
          if (response.type === "ok") return { started: true };
          return { started: false, diagnostic: response.type === "error" ? response.error : "audio-worklet-start-failed" };
        },
        onStatus: (handler: (response: any) => void) => { statusHandlers.add(handler); },
        terminate: async () => { await request({ type: "destroy" }); },
      };
    };
    const client = createObservedRuntimeClient();
    const observingClient = {
      ...client,
      async request(command: { type: string; name?: string; value?: string }) {
        observations.commands.push({ ...command });
        const response = await client.request(command);
        observations.responses.push({ type: response.type, error: response.type === "error" ? response.error : undefined });
        if (response.type === "ui-frame") {
          const frame = decodeCommandBuffer(Uint8Array.from(response.frame).buffer);
          observations.frames.push({ nodes: frame.nodes });
        }
        return response;
      },
      onStatus: client.onStatus,
      terminate: async () => {
        observations.terminated = true;
        await client.terminate?.();
      },
    };

    const NativeAudioWorkletNode = globalThis.AudioWorkletNode;
    Object.defineProperty(globalThis, "AudioWorkletNode", {
      configurable: true,
      value: new Proxy(NativeAudioWorkletNode, {
        construct(target, argumentsList, newTarget) {
          const node = Reflect.construct(target, argumentsList, newTarget) as AudioWorkletNode;
          const instrumented = node as any;
          const nativeConnect = instrumented.connect.bind(node);
          const nativeDisconnect = instrumented.disconnect.bind(node);
          instrumented.connect = (...args: unknown[]) => {
            resources.nodeConnects += 1;
            return nativeConnect(...args);
          };
          instrumented.disconnect = (...args: unknown[]) => {
            resources.nodeDisconnects += 1;
            return nativeDisconnect(...args);
          };
          return node;
        },
      }),
    });
    await main.installSheafPatchLauncher(root, {
      client: { loadSources: async () => ({ apps: [application], diagnostics: [], duplicateDiagnostics: [] }) },
      runtimeClientFactory: () => { resources.runtimeClients += 1; return observingClient; },
      activationLeaseFactory: () => {
        if (resources.contexts !== 0) throw new Error("second AudioContext");
        const context = new AudioContext();
        resources.contexts += 1;
        const nativeResume = context.resume.bind(context);
        const nativeClose = context.close.bind(context);
        context.resume = async () => {
          resources.resumes += 1;
          await nativeResume();
        };
        context.close = async () => {
          resources.closes += 1;
          await nativeClose();
        };
        return ActivationLease.acquire({
          audioContextFactory: () => context,
          requestMIDIAccess: async () => {
            resources.midiRequests += 1;
            return controllerWizardMidi.access;
          },
        });
      },
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
      frameIntervalMs: 60_000,
    });
    (window as any).__task4Fake = { observations, resources };
  }, application);
  await page.getByRole("button", { name: new RegExp(`launch ${app.displayName}`, "i") }).click();
  await expect(page.locator('[data-synth-node-id="fake-browser-root"]')).toBeVisible();
}

export async function stopRealFakeApp(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const state = (window as any).__task4Fake;
    if (!state) return;
    dispatchEvent(new Event("pagehide"));
    const deadline = performance.now() + 5_000;
    while (performance.now() < deadline &&
           (!state.observations.terminated || state.resources.closes !== 1 ||
            state.resources.nodeDisconnects !== 1 || state.resources.packageDisposals !== 1)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!state.observations.terminated) throw new Error("SynthBrowserApp.stop() did not terminate the runtime client");
    if (state.resources.closes !== 1 || state.resources.nodeDisconnects !== 1 || state.resources.packageDisposals !== 1)
      throw new Error(`runtime resources were not released exactly once: ${JSON.stringify(state.resources)}`);
    delete (window as any).__task4Fake;
    delete (window as any).__task4FakeRuntimeFs;
  });
}

export function synthNode(id: string): string {
  return `[data-synth-node-id="${id}"]`;
}
