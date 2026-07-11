import { expect, test } from "@playwright/test";

test("syncs IDBFS before runtime initialization and flushes patch/config updates", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async () => {
    const { BrowserPersistence } = await (new Function("return import('/dist/src/persistence.js')")() as Promise<{
      BrowserPersistence: new (filesystem: unknown, options: unknown, reportStatus?: (status: string) => void) => {
        paths: unknown; start(): Promise<void>; scheduleSync(): void; status(): string; patchPath(path: string): string;
      };
    }>);
    const { BrowserRuntimeWorker } = await (new Function("return import('/dist/src/worker.js')")() as Promise<{
      BrowserRuntimeWorker: new (loadModule: unknown, createPersistence: unknown, emitStatus: unknown) => { handle(command: unknown): Promise<unknown> };
    }>);
    const calls: string[] = [];
    const emitted: unknown[] = [];
    let flushCount = 0;
    let persistence: InstanceType<typeof BrowserPersistence>;
    const filesystem = {
      filesystems: { IDBFS: "idbfs" },
      mkdir(path: string) { calls.push(`mkdir:${path}`); },
      mount(type: unknown, _options: object, path: string) { calls.push(`mount:${type}:${path}`); },
      syncfs(populate: boolean, complete: (error?: Error) => void) {
        calls.push(`sync:${populate}`);
        if (populate) complete();
        else {
          flushCount += 1;
          complete();
        }
      },
    };
    const worker = new BrowserRuntimeWorker(async () => ({
      filesystem,
      create: () => 3,
      audioOutputChannels: () => 2,
      initialize: (_handle: number, dataRoot: string) => { calls.push(`initialize:${dataRoot}`); return 0; },
      prepare: () => 0,
      process: () => 0,
      messageTick: () => 0,
      buildUiFrame: () => new ArrayBuffer(0),
      dispatchAction: () => 0,
      submitMidiEndpoints: () => 0,
      dequeueMidiAction: () => undefined,
      deliverMidi: () => 0,
      dequeueMidiOutput: () => undefined,
      destroy: () => {},
    }), (_filesystem: unknown, reportStatus: (status: string) => void) => {
      persistence = new BrowserPersistence(filesystem, { debounceMs: 0 }, reportStatus);
      return persistence;
    }, (status: unknown) => emitted.push(status));

    await worker.handle({ type: "load" });
    await worker.handle({ type: "create" });
    const initialized = await worker.handle({ type: "initialize", dataRoot: "/ignored-by-host" });
    const pending = await worker.handle({ type: "persistence", state: "patch saved" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const liveness = await worker.handle({ type: "status" });
    const settled = await worker.handle({ type: "persistence-status" });
    return {
      calls,
      emitted,
      initialized,
      pending,
      liveness,
      settled,
      flushCount,
      paths: persistence!.paths,
      patchPath: persistence!.patchPath("presets/bright.json"),
      rejectsEscape: (() => {
        try {
          persistence!.patchPath("../config.json");
          return false;
        } catch {
          return true;
        }
      })(),
    };
  });

  expect(result.initialized).toEqual({ type: "ok" });
  expect(result.calls).toEqual([
    "mkdir:/data", "mount:idbfs:/data", "mkdir:/data/patches", "mkdir:/data/logs", "sync:true", "initialize:/data", "sync:false",
  ]);
  expect(result.emitted).toEqual([
    { type: "page-status", path: "runtime.file.status", status: "persistence pending" },
    { type: "page-status", path: "runtime.file.status", status: "persistence succeeded" },
    { type: "page-status", path: "runtime.file.status", status: "persistence pending" },
    { type: "page-status", path: "runtime.file.status", status: "persistence succeeded" },
  ]);
  expect(result.pending).toEqual({ type: "page-status", path: "runtime.file.status", status: "persistence pending" });
  expect(result.liveness).toEqual({ type: "status", status: "running" });
  expect(result.settled).toEqual({ type: "page-status", path: "runtime.file.status", status: "persistence succeeded" });
  expect(result.flushCount).toBe(1);
  expect(result.paths).toEqual({ dataRoot: "/data", patchesRoot: "/data/patches", logsRoot: "/data/logs", configFile: "/data/config.json" });
  expect(result.patchPath).toBe("/data/patches/presets/bright.json");
  expect(result.rejectsEscape).toBe(true);
});

test("flushes runtime-reported persistence changes after actions and ticks", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async () => {
    const { BrowserPersistence } = await (new Function("return import('/dist/src/persistence.js')")() as Promise<{
      BrowserPersistence: new (filesystem: unknown, options: unknown, reportStatus?: (status: string) => void) => unknown;
    }>);
    const { BrowserRuntimeWorker } = await (new Function("return import('/dist/src/worker.js')")() as Promise<{
      BrowserRuntimeWorker: new (loadModule: unknown, createPersistence: unknown, emitStatus: unknown) => { handle(command: unknown): Promise<unknown> };
    }>);
    const calls: string[] = [];
    const statuses: unknown[] = [];
    let flushCount = 0;
    let dirty = false;
    const filesystem = {
      filesystems: { IDBFS: "idbfs" },
      mkdir() {},
      mount() {},
      syncfs(populate: boolean, complete: (error?: Error) => void) {
        calls.push(`sync:${populate}`);
        if (!populate) flushCount += 1;
        complete();
      },
    };
    const worker = new BrowserRuntimeWorker(async () => ({
      filesystem,
      create: () => 9,
      audioOutputChannels: () => 2,
      initialize: () => 0,
      prepare: () => 0,
      process: () => 0,
      messageTick: (_handle: number, timestampMicros: number) => { if (timestampMicros === 20) dirty = true; return 0; },
      buildUiFrame: () => new ArrayBuffer(0),
      dispatchAction: (_handle: number, name: string) => { if (name === "runtime.config.save") dirty = true; return 0; },
      hasPersistenceChanges: () => {
        const result = dirty;
        dirty = false;
        return result;
      },
      submitMidiEndpoints: () => 0,
      dequeueMidiAction: () => undefined,
      deliverMidi: () => 0,
      dequeueMidiOutput: () => undefined,
      destroy: () => {},
    }), (filesystem: unknown, reportStatus: (status: string) => void) => new BrowserPersistence(filesystem, { debounceMs: 0 }, reportStatus),
    (status: unknown) => statuses.push(status));

    await worker.handle({ type: "load" });
    await worker.handle({ type: "create" });
    await worker.handle({ type: "initialize", dataRoot: "/ignored" });
    calls.length = 0;
    await worker.handle({ type: "dispatch-action", name: "runtime.config.save", value: "" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const afterAction = { calls: [...calls], flushCount, statuses: [...statuses] };
    await worker.handle({ type: "dispatch-action", name: "runtime.file.save", value: "" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const afterPendingPatchAction = { calls: [...calls], flushCount };
    await worker.handle({ type: "message-tick", timestampMicros: 20 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { afterAction, afterPendingPatchAction, calls, flushCount, statuses };
  });

  expect(result.afterAction.calls).toEqual(["sync:false"]);
  expect(result.afterAction.flushCount).toBe(1);
  expect(result.afterPendingPatchAction.flushCount).toBe(1);
  expect(result.calls).toEqual(["sync:false", "sync:false"]);
  expect(result.flushCount).toBe(2);
  expect(result.statuses).toContainEqual({ type: "page-status", path: "runtime.file.status", status: "persistence succeeded" });
});

test("reports a generic browser-host persistence failure", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async () => {
    const { BrowserPersistence } = await (new Function("return import('/dist/src/persistence.js')")() as Promise<{
      BrowserPersistence: new (filesystem: unknown, options: unknown, report: (status: string) => void) => {
        start(): Promise<void>; scheduleSync(): void; status(): string;
      };
    }>);
    const statuses: string[] = [];
    const persistence = new BrowserPersistence({
      filesystems: { IDBFS: "idbfs" },
      mkdir() {},
      mount() {},
      syncfs(populate: boolean, complete: (error?: Error) => void) { complete(populate ? undefined : new Error("quota")); },
    }, { debounceMs: 0 }, (status: string) => statuses.push(status));
    await persistence.start();
    persistence.scheduleSync();
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { statuses, status: persistence.status() };
  });

  expect(result.statuses).toEqual(["persistence pending", "persistence succeeded", "persistence pending", "persistence failed"]);
  expect(result.status).toBe("persistence failed");
});
