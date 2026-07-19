import assert from "node:assert/strict";
import test from "node:test";

import { CatalogClient } from "../src/catalog-client.js";
import {
  SUPPORTED_BROWSER_ABI_VERSION,
  SUPPORTED_CATALOG_SCHEMA_VERSION,
  SUPPORTED_RUNTIME_CONFIG_VERSION,
  SUPPORTED_UI_PROTOCOL_VERSION,
} from "../src/catalog.js";

const digest = "0123456789abcdef".repeat(4);
const sourcesUrl = "https://launcher.example/catalog-sources.json";

function app(appId, displayName = appId) {
  const buildId = `${appId}-build-1`;
  const entry = `packages/${appId}/${buildId}/${appId}.js`;
  return {
    appId,
    displayName,
    author: "Example Author",
    category: "synth",
    buildId,
    browser: {
      abiVersion: SUPPORTED_BROWSER_ABI_VERSION,
      uiProtocolVersion: SUPPORTED_UI_PROTOCOL_VERSION,
      runtimeConfigVersion: SUPPORTED_RUNTIME_CONFIG_VERSION,
      entry,
      files: [{ path: entry, mediaType: "text/javascript", sha256: digest }],
    },
  };
}

function catalog(publisherId, apps = [app("one", "One")]) {
  return {
    schemaVersion: SUPPORTED_CATALOG_SCHEMA_VERSION,
    catalogVersion: "revision-1",
    publisher: { id: publisherId, name: `${publisherId} publisher` },
    apps,
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("loads configured catalogs concurrently and reports every healthy source", async () => {
  const firstUrl = "https://first.example/catalog.json";
  const secondUrl = "https://second.example/catalog.json";
  const pending = new Map([[firstUrl, deferred()], [secondUrl, deferred()]]);
  const requested = [];
  const client = new CatalogClient({
    sourcesUrl,
    fetcher: async (url, init) => {
      requested.push({ url: String(url), cache: init?.cache });
      if (String(url) === sourcesUrl) return json([firstUrl, secondUrl]);
      return pending.get(String(url)).promise;
    },
  });

  const loading = client.loadSources({ cacheMode: "default" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requested, [
    { url: sourcesUrl, cache: "default" },
    { url: firstUrl, cache: "default" },
    { url: secondUrl, cache: "default" },
  ]);

  pending.get(secondUrl).resolve(json(catalog("second", [app("two", "Two")])));
  pending.get(firstUrl).resolve(json(catalog("first")));
  const result = await loading;

  assert.deepEqual(result.apps.map((entry) => entry.globalId), ["first/one", "second/two"]);
  assert.deepEqual(result.diagnostics, [
    { catalogUrl: firstUrl, status: "loaded", appCount: 1 },
    { catalogUrl: secondUrl, status: "loaded", appCount: 1 },
  ]);
});

test("keeps healthy apps when sibling sources have network and version failures", async () => {
  const goodUrl = "https://good.example/catalog.json";
  const offlineUrl = "https://offline.example/catalog.json";
  const incompatibleUrl = "https://future.example/catalog.json";
  const future = catalog("future");
  future.schemaVersion = SUPPORTED_CATALOG_SCHEMA_VERSION + 1;
  const client = new CatalogClient({
    sourcesUrl,
    fetcher: async (url) => {
      if (String(url) === sourcesUrl) return json([goodUrl, offlineUrl, incompatibleUrl]);
      if (String(url) === goodUrl) return json(catalog("good"));
      if (String(url) === offlineUrl) throw new TypeError("network unreachable");
      return json(future);
    },
  });

  const result = await client.loadSources({ cacheMode: "default" });

  assert.deepEqual(result.apps.map((entry) => entry.globalId), ["good/one"]);
  assert.deepEqual(result.diagnostics.map(({ catalogUrl, status }) => ({ catalogUrl, status })), [
    { catalogUrl: goodUrl, status: "loaded" },
    { catalogUrl: offlineUrl, status: "network-error" },
    { catalogUrl: incompatibleUrl, status: "incompatible" },
  ]);
  assert.match(result.diagnostics[1].message, /network unreachable/i);
  assert.match(result.diagnostics[2].message, /schemaVersion|unsupported version/i);
});

test("revalidates stable URLs on retry and discovers newly added manifest entries", async () => {
  const catalogUrl = "https://publisher.example/catalog.json";
  const calls = [];
  let revision = 0;
  const client = new CatalogClient({
    sourcesUrl,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), cache: init?.cache });
      if (String(url) === sourcesUrl) return json([catalogUrl]);
      revision += 1;
      return json(catalog("publisher", revision === 1
        ? [app("one", "One")]
        : [app("one", "One"), app("two", "Two")]));
    },
  });

  const initial = await client.loadSources({ cacheMode: "default" });
  const refreshed = await client.loadSources({ cacheMode: "no-cache" });

  assert.deepEqual(initial.apps.map((entry) => entry.globalId), ["publisher/one"]);
  assert.deepEqual(refreshed.apps.map((entry) => entry.globalId), ["publisher/one", "publisher/two"]);
  assert.deepEqual(calls, [
    { url: sourcesUrl, cache: "default" },
    { url: catalogUrl, cache: "default" },
    { url: sourcesUrl, cache: "no-cache" },
    { url: catalogUrl, cache: "no-cache" },
  ]);
});

test("rejects an invalid trusted source list before requesting any catalog", async () => {
  const calls = [];
  const client = new CatalogClient({
    sourcesUrl,
    fetcher: async (url) => {
      calls.push(String(url));
      return json(["http://not-trusted.example/catalog.json"]);
    },
  });

  await assert.rejects(() => client.loadSources({ cacheMode: "default" }), /HTTPS/i);
  assert.deepEqual(calls, [sourcesUrl]);
});
