import { expect, test } from "@playwright/test";

const processInfo = (globalThis as any).process as { env: Record<string, string | undefined> };
const remoteCatalogUrl = processInfo.env.SYNTH_BROWSER_REMOTE_CATALOG_URL;
const expectedBuildId = processInfo.env.SYNTH_BROWSER_EXPECTED_BUILD_ID;

test.skip(!remoteCatalogUrl, "SYNTH_BROWSER_REMOTE_CATALOG_URL is not set");

test("cross-origin-isolated launcher reaches audio readiness from the deployed publisher", async ({ page }) => {
  expect(expectedBuildId, "SYNTH_BROWSER_EXPECTED_BUILD_ID must accompany the remote catalog URL").toBeTruthy();
  const remoteOrigin = new URL(remoteCatalogUrl!).origin;
  const remoteRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === remoteOrigin) remoteRequests.push(url.pathname);
  });
  await page.route("http://127.0.0.1:4173/catalog-sources.json", (route) =>
    route.fulfill({ json: [remoteCatalogUrl] }));
  await page.addInitScript(() => {
    const observations = {
      contexts: 0,
      resumes: 0,
      workerUrls: [] as string[],
      audioWorkletModules: [] as string[],
      audioWorkletNodes: 0,
      audioConnections: 0,
      blobFetches: [] as string[],
    };
    (window as any).__synthDeployedOrigin = observations;

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
        construct(target, argumentsList, newTarget) {
          observations.workerUrls.push(String(argumentsList[0]));
          return Reflect.construct(target, argumentsList, newTarget);
        },
      }),
    });

    const NativeAudioContext = globalThis.AudioContext;
    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      value: new Proxy(NativeAudioContext, {
        construct(target, argumentsList, newTarget) {
          const context = Reflect.construct(target, argumentsList, newTarget) as AudioContext;
          observations.contexts += 1;
          const nativeResume = context.resume.bind(context);
          context.resume = async () => {
            observations.resumes += 1;
            return nativeResume();
          };
          const nativeAddModule = context.audioWorklet.addModule.bind(context.audioWorklet);
          context.audioWorklet.addModule = async (url: string | URL, options?: WorkletOptions) => {
            observations.audioWorkletModules.push(String(url));
            return nativeAddModule(url, options);
          };
          return context;
        },
      }),
    });

    const NativeAudioWorkletNode = globalThis.AudioWorkletNode;
    Object.defineProperty(globalThis, "AudioWorkletNode", {
      configurable: true,
      value: new Proxy(NativeAudioWorkletNode, {
        construct(target, argumentsList, newTarget) {
          const node = Reflect.construct(target, argumentsList, newTarget) as AudioWorkletNode;
          observations.audioWorkletNodes += 1;
          const nodeWithConnect = node as any;
          const nativeConnect = nodeWithConnect.connect.bind(node);
          nodeWithConnect.connect = (...args: unknown[]) => {
            observations.audioConnections += 1;
            return nativeConnect(...args);
          };
          return node;
        },
      }),
    });

    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      value: async () => ({ inputs: new Map(), outputs: new Map(), onstatechange: null }),
    });
  });

  await page.goto("http://127.0.0.1:4173/public/index.html");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  const deployedBuildId = await page.evaluate(async (catalogUrl) => {
    const response = await fetch(catalogUrl, { mode: "cors", credentials: "omit", cache: "no-store" });
    if (!response.ok) throw new Error(`remote catalog returned HTTP ${response.status}`);
    const catalog = await response.json();
    return catalog.apps[0]?.buildId;
  }, remoteCatalogUrl!);
  expect(deployedBuildId).toBe(expectedBuildId);

  const row = page.locator('.synth-launcher__app[data-synth-app-id="sheaf/miniapp"]');
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: /launch mini app/i }).click();
  await expect(page.locator('[data-synth-node-id="miniapp.root"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#synth-root")).toHaveAttribute("data-synth-status", "running");

  const observations = await page.evaluate(() => (window as any).__synthDeployedOrigin);
  expect(observations.contexts).toBe(1);
  expect(observations.resumes).toBeGreaterThanOrEqual(1);
  expect(observations.workerUrls.some((url: string) => url.startsWith("blob:"))).toBe(true);
  expect(observations.blobFetches.length).toBeGreaterThan(0);
  expect(observations.audioWorkletModules.some((url: string) => url.endsWith("/dist/src/audio-worklet.js"))).toBe(true);
  expect(observations.audioWorkletNodes).toBe(1);
  expect(observations.audioConnections).toBe(1);
  expect(remoteRequests).toEqual(expect.arrayContaining([
    new URL(remoteCatalogUrl!).pathname,
    expect.stringMatching(/\/packages\/miniapp\/[0-9a-f]{64}\/miniapp\.js$/),
    expect.stringMatching(/\/packages\/miniapp\/[0-9a-f]{64}\/miniapp\.wasm$/),
  ]));

  await page.evaluate(() => dispatchEvent(new Event("pagehide")));
});
