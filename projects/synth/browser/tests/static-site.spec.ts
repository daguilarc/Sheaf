import { expect, test } from "@playwright/test";

test("canonical static server applies browser isolation and MIDI sysex headers", async ({ request }) => {
  const { contentTypeForPath } = await import("../src/" + "static-server.mjs") as { contentTypeForPath(path: string): string };
  const defaultPage = await request.get("http://127.0.0.1:4173/public/index.html");
  expect(defaultPage.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(defaultPage.headers()["cross-origin-embedder-policy"]).toBe("require-corp");
  expect(defaultPage.headers()["permissions-policy"]).toContain("midi=(self)");

  const page = await request.get("http://127.0.0.1:4174/public/index.html");
  expect(page.status()).toBe(200);
  expect(page.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(page.headers()["cross-origin-embedder-policy"]).toBe("require-corp");
  expect(page.headers()["permissions-policy"]).toContain("midi=(self)");
  expect(contentTypeForPath("module.wasm")).toBe("application/wasm");

  expect((await request.get("http://127.0.0.1:4174/src/worker.ts")).status()).toBe(404);
  expect((await request.get("http://127.0.0.1:4174/../../package.json")).status()).toBe(404);
  expect((await request.get("http://127.0.0.1:4174/not-an-asset")).status()).toBe(404);
});

test("normal generic browser flows make no dynamic HTTP or WebSocket requests", async ({ page }) => {
  const dynamicRequests: string[] = [];
  const sockets: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === "http://127.0.0.1:4174" && !url.pathname.startsWith("/dist/") && !url.pathname.startsWith("/public/"))
      dynamicRequests.push(url.pathname);
  });
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto("http://127.0.0.1:4174/public/index.html");
  await page.evaluate(async () => {
    const { BrowserPersistence } = await (new Function("return import('/dist/src/persistence.js')")() as Promise<{
      BrowserPersistence: new (filesystem: unknown, options: unknown) => unknown;
    }>);
    const { BrowserRuntimeWorker } = await (new Function("return import('/dist/src/worker.js')")() as Promise<{
      BrowserRuntimeWorker: new (loadModule: unknown, createPersistence: unknown) => { handle(command: unknown): Promise<unknown> };
    }>);
    const filesystem = {
      filesystems: { IDBFS: "idbfs" }, mkdir() {}, mount() {}, syncfs(_populate: boolean, complete: () => void) { complete(); },
    };
    const persistence = new BrowserPersistence(filesystem, { debounceMs: 0 });
    const worker = new BrowserRuntimeWorker(async () => ({
      filesystem,
      create: () => 1, audioOutputChannels: () => 2, initialize: () => 0, prepare: () => 0, process: () => 0, messageTick: () => 0,
      buildUiFrame: () => new ArrayBuffer(0), dispatchAction: () => 0, submitMidiEndpoints: () => 0,
      dequeueMidiAction: () => undefined, deliverMidi: () => 0, dequeueMidiOutput: () => undefined, destroy: () => {},
    }), () => persistence);
    await worker.handle({ type: "load" });
    await worker.handle({ type: "create" });
    await worker.handle({ type: "initialize", dataRoot: "/data" });
    await worker.handle({ type: "prepare", sampleRate: 48000, blockSize: 128 });
    await worker.handle({ type: "midi-endpoints", endpoints: [] });
    await worker.handle({ type: "build-ui-frame" });
    await worker.handle({ type: "persistence", state: "configuration saved" });
  });

  expect(dynamicRequests).toEqual([]);
  expect(sockets).toEqual([]);
});
