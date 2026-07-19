import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { generateBrowserBinding, readAppBuildManifest } from "../src/app-build-manifest.mjs";

const publisher = { id: "sheaf", name: "Sheaf" };

function app(overrides = {}) {
  return {
    appId: "braid-4",
    displayName: "Braid 4",
    author: "Sheaf",
    category: "Instrument",
    header: "Braid4.hpp",
    cppType: "synth_braid4::Braid4",
    includeDirs: ["apps/braid-4"],
    ...overrides,
  };
}

async function fixture() {
  const browserRoot = await mkdtemp(path.join(os.tmpdir(), "sheaf-app-manifest-"));
  const sourceRoot = path.join(browserRoot, "apps");
  await mkdir(path.join(sourceRoot, "braid-4"), { recursive: true });
  await mkdir(path.join(sourceRoot, "alpha"), { recursive: true });
  await writeFile(path.join(sourceRoot, "braid-4", "Braid4.hpp"), "#pragma once\n");
  await writeFile(path.join(sourceRoot, "alpha", "Alpha.hpp"), "#pragma once\n");
  const manifestPath = path.join(browserRoot, "apps.json");
  return { browserRoot, sourceRoot, manifestPath };
}

async function writeManifest(fx, value) {
  await writeFile(fx.manifestPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function parse(value) {
  const fx = await fixture();
  await writeManifest(fx, value);
  return await readAppBuildManifest({
    browserRoot: fx.browserRoot,
    manifestPath: fx.manifestPath,
    allowedSourceRoots: [fx.sourceRoot],
  });
}

test("validates, sorts, hashes, and deeply freezes the declarative manifest", async () => {
  const alpha = app({
    appId: "alpha",
    displayName: "Alpha",
    header: "Alpha.hpp",
    cppType: "example::nested::Alpha_2",
    includeDirs: ["apps/alpha"],
  });
  const parsed = await parse({ schemaVersion: 1, publisher, apps: [app(), alpha] });

  assert.deepEqual(parsed.apps.map(({ appId }) => appId), ["alpha", "braid-4"]);
  assert.match(parsed.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(parsed), ["schemaVersion", "publisher", "apps", "digest"]);
  assert.deepEqual(Object.keys(parsed.apps[0]), [
    "appId", "displayName", "author", "category", "header", "cppType", "includeDirs",
  ]);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.publisher));
  assert.ok(Object.isFrozen(parsed.apps));
  assert.ok(Object.isFrozen(parsed.apps[0]));
  assert.ok(Object.isFrozen(parsed.apps[0].includeDirs));

  const reordered = await parse({ schemaVersion: 1, publisher, apps: [alpha, app()] });
  assert.equal(reordered.digest, parsed.digest);
});

test("generates the complete browser binding without app-specific plumbing", () => {
  assert.equal(generateBrowserBinding(app()), [
    '#include "Braid4.hpp"',
    '#include "synth/browser/BrowserAppEntry.hpp"',
    "",
    "SYNTH_BROWSER_APP(synth_braid4::Braid4)",
    "",
  ].join("\n"));
});

test("requires exact manifest, publisher, and app keys", async () => {
  for (const [label, mutate] of [
    ["manifest extra", (value) => { value.flags = []; }],
    ["manifest missing", (value) => { delete value.schemaVersion; }],
    ["publisher extra", (value) => { value.publisher.url = "https://example.invalid"; }],
    ["publisher missing", (value) => { delete value.publisher.name; }],
    ["app extra", (value) => { value.apps[0].sources = ["custom.cpp"]; }],
    ["app missing", (value) => { delete value.apps[0].author; }],
  ]) {
    const value = { schemaVersion: 1, publisher: { ...publisher }, apps: [app()] };
    mutate(value);
    await assert.rejects(parse(value), /unknown field|required/i, label);
  }
});

test("validates schema and publisher types", async () => {
  for (const [value, pattern] of [
    [{ schemaVersion: "1", publisher, apps: [app()] }, /schemaVersion/i],
    [{ schemaVersion: 2, publisher, apps: [app()] }, /schemaVersion/i],
    [{ schemaVersion: 1, publisher: "sheaf", apps: [app()] }, /publisher/i],
    [{ schemaVersion: 1, publisher: { id: "Sheaf!", name: "Sheaf" }, apps: [app()] }, /publisher\.id/i],
    [{ schemaVersion: 1, publisher: { id: "sheaf", name: "" }, apps: [app()] }, /publisher\.name/i],
    [{ schemaVersion: 1, publisher, apps: [] }, /apps/i],
  ]) {
    await assert.rejects(parse(value), pattern);
  }
});

test("rejects invalid and duplicate app IDs", async () => {
  for (const appId of ["", "Upper", "two words", "../escape", "-leading", "trailing-"]) {
    await assert.rejects(
      parse({ schemaVersion: 1, publisher, apps: [app({ appId })] }),
      /apps\[0\]\.appId/i,
    );
  }
  await assert.rejects(
    parse({ schemaVersion: 1, publisher, apps: [app(), app()] }),
    /duplicate.*appId.*braid-4/i,
  );
});

test("accepts only qualified C++ identifier components", async () => {
  for (const cppType of ["", "Braid4", "::Braid4", "synth::", "synth::Braid-4", "synth::Braid4<int>", "synth::Braid4); evil("]) {
    await assert.rejects(
      parse({ schemaVersion: 1, publisher, apps: [app({ cppType })] }),
      /apps\[0\]\.cppType/i,
    );
  }
});

test("rejects empty metadata, header, and include directory arrays", async () => {
  for (const [field, value] of [
    ["displayName", ""], ["author", " "], ["category", ""], ["header", ""], ["includeDirs", []],
  ]) {
    await assert.rejects(
      parse({ schemaVersion: 1, publisher, apps: [app({ [field]: value })] }),
      new RegExp(`apps\\[0\\]\\.${field}`, "i"),
    );
  }
});

test("rejects absolute, traversing, missing, and out-of-root source paths", async () => {
  const fx = await fixture();
  const outside = path.join(fx.browserRoot, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "Braid4.hpp"), "#pragma once\n");

  for (const [field, value, pattern] of [
    ["header", "../Braid4.hpp", /header/i],
    ["header", path.join(fx.sourceRoot, "braid-4", "Braid4.hpp"), /header/i],
    ["includeDirs", ["../outside"], /includeDirs\[0\]/i],
    ["includeDirs", [outside], /includeDirs\[0\]/i],
    ["includeDirs", ["apps/missing"], /includeDirs\[0\]/i],
  ]) {
    const valueToWrite = { schemaVersion: 1, publisher, apps: [app({ [field]: value })] };
    await writeManifest(fx, valueToWrite);
    await assert.rejects(readAppBuildManifest({
      browserRoot: fx.browserRoot,
      manifestPath: fx.manifestPath,
      allowedSourceRoots: [fx.sourceRoot],
    }), pattern);
  }

  await writeManifest(fx, { schemaVersion: 1, publisher, apps: [app({ header: "Missing.hpp" })] });
  await assert.rejects(readAppBuildManifest({
    browserRoot: fx.browserRoot,
    manifestPath: fx.manifestPath,
    allowedSourceRoots: [fx.sourceRoot],
  }), /header.*Missing\.hpp.*not found/i);
});

test("allows parent-relative include directories that resolve beneath an allowed root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sheaf-parent-relative-manifest-"));
  const browserRoot = path.join(root, "browser");
  const sourceRoot = path.join(root, "apps");
  await mkdir(browserRoot);
  await mkdir(path.join(sourceRoot, "braid-4"), { recursive: true });
  await writeFile(path.join(sourceRoot, "braid-4", "Braid4.hpp"), "#pragma once\n");
  const manifestPath = path.join(browserRoot, "apps.json");
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    publisher,
    apps: [app({ includeDirs: ["../apps/braid-4"] })],
  })}\n`);

  const parsed = await readAppBuildManifest({ browserRoot, manifestPath, allowedSourceRoots: [sourceRoot] });
  assert.deepEqual(parsed.apps[0].includeDirs, ["../apps/braid-4"]);
});
