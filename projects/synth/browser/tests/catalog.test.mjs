import assert from "node:assert/strict";
import test from "node:test";

import {
  SUPPORTED_BROWSER_ABI_VERSION,
  SUPPORTED_CATALOG_SCHEMA_VERSION,
  SUPPORTED_RUNTIME_CONFIG_VERSION,
  SUPPORTED_UI_PROTOCOL_VERSION,
  mergeCatalogs,
  parseCatalog,
  parseCatalogSources,
} from "../src/catalog.js";

const digest = "0123456789abcdef".repeat(4);

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
      files: [
        { path: entry, mediaType: "text/javascript", sha256: digest },
        { path: `packages/${appId}/${buildId}/${appId}.wasm`, mediaType: "application/wasm", sha256: digest },
        { path: `packages/${appId}/${buildId}/${appId}.data`, mediaType: "application/octet-stream", sha256: digest },
      ],
    },
  };
}

function catalog(publisherId = "sheaf", apps = [app("miniapp", "Mini App")]) {
  return {
    schemaVersion: SUPPORTED_CATALOG_SCHEMA_VERSION,
    catalogVersion: "revision-2026-07-18",
    publisher: { id: publisherId, name: publisherId === "sheaf" ? "Sheaf" : "Friend" },
    apps,
  };
}

function clone(value) {
  return structuredClone(value);
}

test("parses HTTPS catalog sources into immutable records", () => {
  const sources = parseCatalogSources([
    "https://publisher.example/releases/catalog.json",
    "https://friend.example/catalog.json",
  ]);

  assert.deepEqual(sources, [
    { catalogUrl: "https://publisher.example/releases/catalog.json" },
    { catalogUrl: "https://friend.example/catalog.json" },
  ]);
  assert.ok(Object.isFrozen(sources));
  assert.ok(sources.every(Object.isFrozen));
  assert.throws(() => parseCatalogSources([]), /source/i);
  assert.throws(() => parseCatalogSources(["http://publisher.example/catalog.json"]), /HTTPS/i);
  assert.throws(() => parseCatalogSources(["https://publisher.example/catalog.json#fragment"]), /fragment/i);
  assert.throws(() => parseCatalogSources(["https://publisher.example/catalog.json", "https://publisher.example/catalog.json"]), /duplicate/i);
});

test("parses a valid multi-app catalog and resolves package URLs against the catalog", () => {
  const input = catalog("sheaf", [app("miniapp", "Mini App"), app("braid-4", "Braid 4")]);
  const original = clone(input);
  const parsed = parseCatalog(input, "https://publisher.example/releases/catalog.json");

  assert.deepEqual(input, original);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.catalogVersion, "revision-2026-07-18");
  assert.deepEqual(parsed.publisher, { id: "sheaf", name: "Sheaf" });
  assert.equal(parsed.apps.length, 2);
  assert.equal(parsed.apps[0].globalId, "sheaf/miniapp");
  assert.equal(parsed.apps[0].catalogUrl, "https://publisher.example/releases/catalog.json");
  assert.equal(parsed.apps[0].browser.entryUrl,
    "https://publisher.example/releases/packages/miniapp/miniapp-build-1/miniapp.js");
  assert.equal(parsed.apps[0].browser.files[1].url,
    "https://publisher.example/releases/packages/miniapp/miniapp-build-1/miniapp.wasm");
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.publisher));
  assert.ok(Object.isFrozen(parsed.apps));
  assert.ok(Object.isFrozen(parsed.apps[0]));
  assert.ok(Object.isFrozen(parsed.apps[0].browser));
  assert.ok(Object.isFrozen(parsed.apps[0].browser.files));
  assert.ok(Object.isFrozen(parsed.apps[0].browser.files[0]));
});

for (const [field, supported] of [
  ["schemaVersion", SUPPORTED_CATALOG_SCHEMA_VERSION],
  ["abiVersion", SUPPORTED_BROWSER_ABI_VERSION],
  ["uiProtocolVersion", SUPPORTED_UI_PROTOCOL_VERSION],
  ["runtimeConfigVersion", SUPPORTED_RUNTIME_CONFIG_VERSION],
]) {
  test(`rejects every unsupported ${field}`, () => {
    for (const value of [supported - 1, supported + 1, "1", null]) {
      const input = catalog();
      if (field === "schemaVersion") input.schemaVersion = value;
      else input.apps[0].browser[field] = value;
      assert.throws(
        () => parseCatalog(input, "https://publisher.example/catalog.json"),
        new RegExp(field, "i"),
      );
    }
  });
}

test("rejects malformed publisher IDs, app IDs, and immutable build IDs", () => {
  for (const id of ["", "MiniApp", "mini_app", "-miniapp", "miniapp-", "mini--app", "../miniapp", "mini/app"] ) {
    const badPublisher = catalog();
    badPublisher.publisher.id = id;
    assert.throws(() => parseCatalog(badPublisher, "https://publisher.example/catalog.json"), /publisher\.id/i);

    const badApp = catalog();
    badApp.apps[0].appId = id;
    assert.throws(() => parseCatalog(badApp, "https://publisher.example/catalog.json"), /appId/i);

    const badBuild = catalog();
    badBuild.apps[0].buildId = id;
    assert.throws(() => parseCatalog(badBuild, "https://publisher.example/catalog.json"), /buildId/i);
  }
});

test("requires bounded, trimmed publisher and application metadata", () => {
  for (const [target, field] of [
    ["publisher", "name"],
    ["app", "displayName"],
    ["app", "author"],
    ["app", "category"],
  ]) {
    for (const value of ["", "  ", " padded ", "x".repeat(201), 42, null]) {
      const input = catalog();
      if (target === "publisher") input.publisher[field] = value;
      else input.apps[0][field] = value;
      assert.throws(() => parseCatalog(input, "https://publisher.example/catalog.json"), new RegExp(field, "i"));
    }
  }

  for (const value of ["", "  ", " revision ", "x".repeat(129), 42, null]) {
    const input = catalog();
    input.catalogVersion = value;
    assert.throws(() => parseCatalog(input, "https://publisher.example/catalog.json"), /catalogVersion/i);
  }
});

test("rejects unknown schema-owned fields at every object level", () => {
  for (const mutate of [
    (value) => { value.extra = true; },
    (value) => { value.publisher.extra = true; },
    (value) => { value.apps[0].extra = true; },
    (value) => { value.apps[0].browser.extra = true; },
    (value) => { value.apps[0].browser.files[0].extra = true; },
  ]) {
    const input = catalog();
    mutate(input);
    assert.throws(() => parseCatalog(input, "https://publisher.example/catalog.json"), /unknown field.*extra/i);
  }
});

test("rejects malformed SHA-256 digests and unsupported package media types", () => {
  for (const value of ["", "a".repeat(63), "A".repeat(64), "g".repeat(64), 42, null]) {
    const input = catalog();
    input.apps[0].browser.files[0].sha256 = value;
    assert.throws(() => parseCatalog(input, "https://publisher.example/catalog.json"), /sha256/i);
  }
  for (const value of ["application/javascript", "text/css", "application/wasm; charset=utf-8", "", null]) {
    const input = catalog();
    input.apps[0].browser.files[1].mediaType = value;
    assert.throws(() => parseCatalog(input, "https://publisher.example/catalog.json"), /mediaType/i);
  }
});

test("validates paths before URL resolution and rejects absolute or traversal-like paths", () => {
  for (const path of [
    "/packages/app.js",
    "https://attacker.example/app.js",
    "//attacker.example/app.js",
    "../app.js",
    "packages/../app.js",
    "packages/./app.js",
    "packages/%2e%2e/app.js",
    "packages\\app.js",
    "packages/app.js?query",
    "packages/app.js#fragment",
    "packages//app.js",
  ]) {
    const input = catalog();
    input.apps[0].browser.entry = path;
    input.apps[0].browser.files[0].path = path;
    assert.throws(() => parseCatalog(input, "https://publisher.example/releases/catalog.json"), /path|entry/i);
  }
});

test("requires a nonempty unique file inventory containing the JavaScript entry", () => {
  for (const files of [undefined, [], [
    { path: "packages/miniapp/miniapp-build-1/miniapp.wasm", mediaType: "application/wasm", sha256: digest },
  ]]) {
    const input = catalog();
    input.apps[0].browser.files = files;
    assert.throws(() => parseCatalog(input, "https://publisher.example/catalog.json"), /files|entry/i);
  }

  const duplicate = catalog();
  duplicate.apps[0].browser.files.push(clone(duplicate.apps[0].browser.files[0]));
  assert.throws(() => parseCatalog(duplicate, "https://publisher.example/catalog.json"), /duplicate.*path/i);

  const wrongEntryType = catalog();
  wrongEntryType.apps[0].browser.files[0].mediaType = "application/octet-stream";
  assert.throws(() => parseCatalog(wrongEntryType, "https://publisher.example/catalog.json"), /entry.*text\/javascript/i);
});

test("requires nonempty app inventories and unique local app IDs", () => {
  const empty = catalog();
  empty.apps = [];
  assert.throws(() => parseCatalog(empty, "https://publisher.example/catalog.json"), /apps/i);

  const duplicate = catalog("sheaf", [app("miniapp"), app("miniapp")]);
  assert.throws(() => parseCatalog(duplicate, "https://publisher.example/catalog.json"), /duplicate.*appId/i);
});

test("merges in configured source order, diagnoses duplicates, and sorts by display name then global ID", () => {
  const sheafUrl = "https://sheaf.example/catalog.json";
  const friendUrl = "https://friend.example/catalog.json";
  const mirrorUrl = "https://mirror.example/catalog.json";
  const sheaf = parseCatalog(catalog("sheaf", [
    app("zebra", "Same Name"),
    app("miniapp", "Zulu"),
  ]), sheafUrl);
  const friend = parseCatalog(catalog("friend", [
    app("miniapp", "Alpha"),
    app("zebra", "Same Name"),
  ]), friendUrl);
  const mirror = parseCatalog(catalog("sheaf", [
    app("miniapp", "Replacement Must Lose"),
  ]), mirrorUrl);

  const result = mergeCatalogs([sheaf, friend, mirror]);

  assert.deepEqual(result.apps.map(({ globalId, displayName, catalogUrl }) => ({ globalId, displayName, catalogUrl })), [
    { globalId: "friend/miniapp", displayName: "Alpha", catalogUrl: friendUrl },
    { globalId: "friend/zebra", displayName: "Same Name", catalogUrl: friendUrl },
    { globalId: "sheaf/zebra", displayName: "Same Name", catalogUrl: sheafUrl },
    { globalId: "sheaf/miniapp", displayName: "Zulu", catalogUrl: sheafUrl },
  ]);
  assert.deepEqual(result.diagnostics, [{
    code: "duplicate-app",
    globalId: "sheaf/miniapp",
    acceptedCatalogUrl: sheafUrl,
    rejectedCatalogUrl: mirrorUrl,
  }]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.apps));
  assert.ok(Object.isFrozen(result.diagnostics));
  assert.ok(Object.isFrozen(result.diagnostics[0]));
});

test("mergeCatalogs does not mutate source catalogs or depend on locale collation", () => {
  const input = [
    parseCatalog(catalog("upper", [app("a", "Z")]), "https://upper.example/catalog.json"),
    parseCatalog(catalog("lower", [app("a", "a")]), "https://lower.example/catalog.json"),
  ];
  const before = clone(input);

  const result = mergeCatalogs(input);

  assert.deepEqual(input, before);
  assert.deepEqual(result.apps.map((entry) => entry.displayName), ["Z", "a"]);
});
