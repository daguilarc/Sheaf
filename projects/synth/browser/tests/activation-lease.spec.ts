import { expect, test } from "@playwright/test";
import { makeCommandBuffer, NodeKind } from "./fixtures/command-buffer.js";

const launcherApp = {
  globalId: "example/portable-app",
  catalogUrl: "https://publisher.example/catalog.json",
  publisher: { id: "example", name: "Example Audio" },
  appId: "portable-app",
  displayName: "Portable App",
  author: "Ada Example",
  category: "Instrument",
  buildId: "portable-app-build-1",
  browser: {
    abiVersion: 2,
    uiProtocolVersion: 1,
    runtimeConfigVersion: 1,
    entry: "packages/portable-app/portable-app-build-1/app.js",
    entryUrl: "https://publisher.example/packages/portable-app/portable-app-build-1/app.js",
    files: [],
  },
};

test("begins audio resume and sysex MIDI acquisition synchronously before delayed package work", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/public/index.html");
  const result = await page.evaluate(async () => {
    const { ActivationLease } = await (new Function("return import('/dist/src/activation.js')")() as Promise<any>);
    const calls: string[] = [];
    let finishPackage!: () => void;
    const packageWork = new Promise<void>((resolve) => { finishPackage = resolve; });
    const context = {
      async resume() { calls.push("audio:resume"); },
      async close() { calls.push("audio:close"); },
    };
    const access = { inputs: new Map(), outputs: new Map(), onstatechange: null };

    const select = () => {
      const lease = ActivationLease.acquire({
        audioContextFactory: () => { calls.push("audio:construct"); return context; },
        requestMIDIAccess: (options: unknown) => {
          calls.push(`midi:request:${JSON.stringify(options)}`);
          return Promise.resolve(access);
        },
      });
      calls.push("package:begin");
      return packageWork.then(async () => {
        calls.push("package:resolved");
        await lease.consume();
        lease.dispose();
      });
    };

    const pending = select();
    const beforePackageResolution = [...calls];
    finishPackage();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { beforePackageResolution, calls };
  });

  expect(result.beforePackageResolution).toEqual([
    "audio:construct",
    "audio:resume",
    'midi:request:{"sysex":true}',
    "package:begin",
  ]);
  expect(result.calls).toEqual([
    ...result.beforePackageResolution,
    "package:resolved",
    "audio:close",
  ]);
});

test("consumes once and idempotently closes audio plus every MIDI port", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/public/index.html");
  const result = await page.evaluate(async () => {
    const { ActivationLease } = await (new Function("return import('/dist/src/activation.js')")() as Promise<any>);
    const counters = { resume: 0, contextClose: 0, inputClose: 0, outputClose: 0 };
    const context = {
      async resume() { counters.resume += 1; },
      async close() { counters.contextClose += 1; },
    };
    const input = { close: async () => { counters.inputClose += 1; } };
    const output = { close: async () => { counters.outputClose += 1; } };
    const access = {
      inputs: new Map([["input", input]]),
      outputs: new Map([["output", output]]),
      onstatechange: null,
    };
    const lease = ActivationLease.acquire({
      audioContextFactory: () => context,
      requestMIDIAccess: async () => access,
    });
    const resources = await lease.consume();
    let secondConsume = "";
    try { await lease.consume(); } catch (error) { secondConsume = (error as Error).message; }
    lease.dispose();
    lease.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return {
      sameContext: resources.audioContext === context,
      sameAccess: resources.midiAccess === access,
      secondConsume,
      counters,
    };
  });

  expect(result.sameContext).toBe(true);
  expect(result.sameAccess).toBe(true);
  expect(result.secondConsume).toMatch(/already.*consumed/i);
  expect(result.counters).toEqual({ resume: 1, contextClose: 1, inputClose: 1, outputClose: 1 });
});

test("cleans partial denial and permits a fresh lease retry without duplicate live resources", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/public/index.html");
  const result = await page.evaluate(async () => {
    const { ActivationLease } = await (new Function("return import('/dist/src/activation.js')")() as Promise<any>);
    const counters = { contexts: 0, resumes: 0, closes: 0, requests: 0, portCloses: 0 };
    const context = () => {
      counters.contexts += 1;
      return {
        async resume() { counters.resumes += 1; },
        async close() { counters.closes += 1; },
      };
    };
    const access = {
      inputs: new Map([["input", { close: async () => { counters.portCloses += 1; } }]]),
      outputs: new Map(),
      onstatechange: null,
    };
    const request = async () => {
      counters.requests += 1;
      if (counters.requests === 1) throw new Error("sysex denied");
      return access;
    };

    const denied = ActivationLease.acquire({ audioContextFactory: context, requestMIDIAccess: request });
    let denial = "";
    try { await denied.consume(); } catch (error) { denial = (error as Error).message; }
    denied.dispose();
    const retry = ActivationLease.acquire({ audioContextFactory: context, requestMIDIAccess: request });
    await retry.consume();
    retry.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { denial, counters };
  });

  expect(result.denial).toContain("sysex denied");
  expect(result.counters).toEqual({ contexts: 2, resumes: 2, closes: 2, requests: 2, portCloses: 1 });
});

test("closes MIDI resources that resolve after audio activation fails", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/public/index.html");
  const result = await page.evaluate(async () => {
    const { ActivationLease } = await (new Function("return import('/dist/src/activation.js')")() as Promise<any>);
    const counters = { contextClose: 0, portClose: 0 };
    let resolveMidi!: (access: unknown) => void;
    const midi = new Promise((resolve) => { resolveMidi = resolve; });
    const lease = ActivationLease.acquire({
      audioContextFactory: () => ({
        resume: async () => { throw new Error("audio denied"); },
        close: async () => { counters.contextClose += 1; },
      }),
      requestMIDIAccess: () => midi,
    });
    let failure = "";
    const consumed = lease.consume().catch((error: Error) => { failure = error.message; });
    resolveMidi({
      inputs: new Map([["input", { close: async () => { counters.portClose += 1; } }]]),
      outputs: new Map(),
      onstatechange: null,
    });
    await consumed;
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { failure, counters };
  });

  expect(result.failure).toContain("audio denied");
  expect(result.counters).toEqual({ contextClose: 1, portClose: 1 });
});

test("launcher acquires once before package work and forwards one materialized package plus declared versions", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/dist/src/main.js");
  await page.setContent('<main id="synth-root"></main>');
  const result = await page.evaluate(async (application) => {
    const main = await (new Function("return import('/dist/src/main.js')")() as Promise<any>);
    const events: string[] = [];
    let finishMaterialization!: () => void;
    const materialization = new Promise<void>((resolve) => { finishMaterialization = resolve; });
    const materialized = {
      entryUrl: "blob:entry",
      locateFile: {},
      mainScriptUrlOrBlob: "blob:main",
      dispose() { events.push("package:dispose"); },
    };
    const launcher = await main.installSheafPatchLauncher(document.querySelector("#synth-root"), {
      client: { loadSources: async () => ({ apps: [application], diagnostics: [], duplicateDiagnostics: [] }) },
      activationLeaseFactory: () => {
        events.push("lease:acquire");
        return { consume: async () => { throw new Error("not consumed by stub"); }, dispose() { events.push("lease:dispose"); } };
      },
      materializePackage: async () => {
        events.push("package:begin");
        await materialization;
        events.push("package:ready");
        return materialized;
      },
      installApp: async (_root: HTMLElement, options: any) => {
        events.push("runtime:install");
        (window as any).__installedOptions = options;
        return { stop() {} };
      },
    });
    const button = document.querySelector<HTMLButtonElement>(".synth-launcher__launch")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const beforePackageResolution = [...events];
    finishMaterialization();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const options = (window as any).__installedOptions;
    return {
      beforePackageResolution,
      events,
      moduleIsMaterialized: options.module === materialized,
      leasePresent: Boolean(options.activationLease),
      versions: options.runtimeVersions,
      launcherPresent: Boolean(launcher),
    };
  }, launcherApp);

  expect(result.beforePackageResolution).toEqual(["lease:acquire", "package:begin"]);
  expect(result.events).toEqual(["lease:acquire", "package:begin", "package:ready", "runtime:install"]);
  expect(result.moduleIsMaterialized).toBe(true);
  expect(result.leasePresent).toBe(true);
  expect(result.versions).toEqual({ abiVersion: 2, uiProtocolVersion: 1, runtimeConfigVersion: 1 });
  expect(result.launcherPresent).toBe(true);
});

test("package failure disposes the lease once and a retry acquires fresh resources", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/dist/src/main.js");
  await page.setContent('<main id="synth-root"></main>');
  await page.evaluate(async (application) => {
    const main = await (new Function("return import('/dist/src/main.js')")() as Promise<any>);
    const counters = { leases: 0, leaseDisposals: 0, packages: 0, installs: 0 };
    (window as any).__failureCounters = counters;
    await main.installSheafPatchLauncher(document.querySelector("#synth-root"), {
      client: { loadSources: async () => ({ apps: [application], diagnostics: [], duplicateDiagnostics: [] }) },
      activationLeaseFactory: () => {
        counters.leases += 1;
        let disposed = false;
        return {
          async consume() { return {}; },
          dispose() { if (!disposed) { disposed = true; counters.leaseDisposals += 1; } },
        };
      },
      materializePackage: async () => {
        counters.packages += 1;
        if (counters.packages === 1) throw new Error("package unavailable");
        return { entryUrl: "blob:entry", locateFile: {}, mainScriptUrlOrBlob: "blob:main", dispose() {} };
      },
      installApp: async () => { counters.installs += 1; return { stop() {} }; },
    });
  }, launcherApp);

  await page.getByRole("button", { name: /launch portable app/i }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Portable App" });
  await expect(row).toContainText("package unavailable");
  await page.getByRole("button", { name: /retry portable app/i }).click();
  await expect(row.getByRole("button", { name: /launch portable app/i })).toBeDisabled();
  await expect(page.getByRole("button", { name: /back to launcher/i })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__failureCounters)).toEqual({
    leases: 2,
    leaseDisposals: 1,
    packages: 2,
    installs: 1,
  });
});

test("runtime initialization failure releases consumed activation and materialized package resources", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/dist/src/main.js");
  await page.setContent('<main id="synth-root"></main>');
  const result = await page.evaluate(async (application) => {
    const main = await (new Function("return import('/dist/src/main.js')")() as Promise<any>);
    const { ActivationLease } = await (new Function("return import('/dist/src/activation.js')")() as Promise<any>);
    const counters = { contextClose: 0, portClose: 0, packageDispose: 0, runtimeClients: 0, runtimeTerminates: 0 };
    let lease: any;
    let packageDisposed = false;
    const materialized = {
      entryUrl: "blob:entry",
      locateFile: {},
      mainScriptUrlOrBlob: "blob:main",
      dispose() { if (!packageDisposed) { packageDisposed = true; counters.packageDispose += 1; } },
    };
    await main.installSheafPatchLauncher(document.querySelector("#synth-root"), {
      client: { loadSources: async () => ({ apps: [application], diagnostics: [], duplicateDiagnostics: [] }) },
      activationLeaseFactory: () => lease = ActivationLease.acquire({
        audioContextFactory: () => ({
          resume: async () => {},
          close: async () => { counters.contextClose += 1; },
        }),
        requestMIDIAccess: async () => ({
          inputs: new Map([["input", { close: async () => { counters.portClose += 1; } }]]),
          outputs: new Map(),
          onstatechange: null,
        }),
      }),
      materializePackage: async () => materialized,
      runtimeClientFactory: () => {
        counters.runtimeClients += 1;
        return {
          async request(command: { type: string }) {
            if (command.type === "create") return { type: "created", handle: 1 };
            if (command.type === "initialize") return { type: "error", error: "runtime initialization failed" };
            return { type: "ok" };
          },
          terminate() { counters.runtimeTerminates += 1; },
        };
      },
    });
    document.querySelector<HTMLButtonElement>(".synth-launcher__launch")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { counters, error: document.querySelector(".synth-launcher__app-error")?.textContent, leasePresent: Boolean(lease) };
  }, launcherApp);

  expect(result.error).toContain("runtime initialization failed");
  expect(result.leasePresent).toBe(true);
  expect(result.counters).toEqual({
    contextClose: 1,
    portClose: 1,
    packageDispose: 1,
    runtimeClients: 1,
    runtimeTerminates: 1,
  });
});

test("successful leased app unload is idempotent and releases one context, MIDI request, runtime, node, and package", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/dist/src/main.js");
  await page.setContent('<main id="synth-root"></main>');
  const frame = makeCommandBuffer([{ id: "root", kind: NodeKind.Root, bounds: [0, 0, 20, 20] }]);
  const result = await page.evaluate(async (bytes) => {
    const main = await (new Function("return import('/dist/src/main.js')")() as Promise<any>);
    const { ActivationLease } = await (new Function("return import('/dist/src/activation.js')")() as Promise<any>);
    const counters = {
      contexts: 0, resumes: 0, contextCloses: 0, midiRequests: 0, portCloses: 0,
      runtimeStarts: 0, nativeStarts: 0, runtimeTerminates: 0, ringCommands: 0,
      fallbackNodes: 0, packageDisposals: 0,
    };
    const context = {
      sampleRate: 48_000,
      destination: {},
      audioWorklet: { addModule: async () => {} },
      resume: async () => { counters.resumes += 1; },
      close: async () => { counters.contextCloses += 1; },
    };
    const lease = ActivationLease.acquire({
      audioContextFactory: () => { counters.contexts += 1; return context; },
      requestMIDIAccess: async () => {
        counters.midiRequests += 1;
        return {
          inputs: new Map([["input", {
            id: "input", name: "Input", state: "connected", onmidimessage: null,
            close: async () => { counters.portCloses += 1; },
          }]]),
          outputs: new Map(),
          onstatechange: null,
        };
      },
    });
    const runtime = {
      async request(command: { type: string }) {
        if (command.type === "create") { counters.runtimeStarts += 1; return { type: "created", handle: 1 }; }
        if (command.type === "configure-audio" || command.type === "render-audio") counters.ringCommands += 1;
        if (command.type === "audio-config") return { type: "audio-config", channels: 2 };
        if (command.type === "build-ui-frame") return { type: "ui-frame", frame: bytes };
        if (command.type === "midi-endpoints") return { type: "midi-actions", actions: [] };
        if (command.type === "drain-midi-output") return { type: "midi-output" };
        return { type: "ok" };
      },
      async startAudioWorklet(received?: AudioContext) {
        if (received !== context as unknown as AudioContext) throw new Error("leased context was not passed to native startup");
        counters.nativeStarts += 1;
        return { started: true };
      },
      terminate() { counters.runtimeTerminates += 1; },
    };
    let packageDisposed = false;
    const app = await main.installSynthBrowserApp(document.querySelector("#synth-root"), {
      module: { entryUrl: "blob:entry", locateFile: {}, mainScriptUrlOrBlob: "blob:main" },
      activationLease: lease,
      runtimeClient: runtime,
      frameIntervalMs: 60_000,
      disposeModule: () => {
        if (!packageDisposed) { packageDisposed = true; counters.packageDisposals += 1; }
      },
      audioOptions: {
        audioContextFactory: () => { throw new Error("second context"); },
        audioWorkletNodeFactory: () => { counters.fallbackNodes += 1; throw new Error("JavaScript AudioWorklet fallback"); },
      },
    });
    dispatchEvent(new Event("pagehide"));
    dispatchEvent(new Event("pagehide"));
    app.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return counters;
  }, Array.from(new Uint8Array(frame)));

  expect(result).toEqual({
    contexts: 1,
    resumes: 1,
    contextCloses: 1,
    midiRequests: 1,
    portCloses: 1,
    runtimeStarts: 1,
    nativeStarts: 1,
    runtimeTerminates: 1,
    ringCommands: 0,
    fallbackNodes: 0,
    packageDisposals: 1,
  });
});
