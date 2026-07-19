import { expect, test } from "@playwright/test";

test("starts a generic verified package from the isolated launcher's second origin", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");

  const result = await page.evaluate(async () => {
    const main = await (new Function("return import('/dist/src/main.js')")() as Promise<any>);
    const { materializePackage } = await (new Function("return import('/dist/src/package-loader.js')")() as Promise<any>);
    const manifestResponse = await fetch("http://127.0.0.1:4174/package-fixture/catalog.json", { mode: "cors" });
    if (!manifestResponse.ok) throw new Error(`fixture catalog returned ${manifestResponse.status}`);
    const app = await manifestResponse.json();
    const materialized = await materializePackage(app);
    const runtime = main.createDirectRuntimeClient();
    const loaded = await runtime.request({
      type: "load",
      module: {
        entryUrl: materialized.entryUrl,
        locateFile: materialized.locateFile,
        mainScriptUrlOrBlob: materialized.mainScriptUrlOrBlob,
      },
      versions: { abiVersion: 1, uiProtocolVersion: 1, runtimeConfigVersion: 1 },
    });
    const created = await runtime.request({ type: "create" });
    const audio = await runtime.request({ type: "audio-config" });
    const remoteFactory = (globalThis as any).__synthTwoOriginFactory;
    runtime.terminate?.();
    materialized.dispose();
    return {
      crossOriginIsolated,
      loaded,
      created,
      audio,
      remoteFactory,
    };
  });

  expect(result.crossOriginIsolated).toBe(true);
  expect(result.loaded).toEqual({ type: "ok" });
  expect(result.created).toEqual({ type: "created", handle: 41 });
  expect(result.audio).toEqual({ type: "audio-config", channels: 2 });
  expect(result.remoteFactory.wasmUrl).toMatch(/^blob:/);
  expect(result.remoteFactory.mainScriptUrlOrBlob).toMatch(/^blob:/);
  expect(result.remoteFactory.entryOrigin).toBe("http://127.0.0.1:4173");
});
