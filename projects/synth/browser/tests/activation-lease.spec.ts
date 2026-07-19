import { expect, test } from "@playwright/test";

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
