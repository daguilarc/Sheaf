import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  browserRuntimeModules,
  cloudflareHeaders,
  publishPublisherArtifact,
  publishSite,
  validatePublishedSite,
} from "../src/publish-site.mjs";

const miniappEntry = `const sidecar = new URL("miniapp.js", import.meta.url);\nexport default async () => ({ sidecar });\n`;
const miniappWasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);

test("publishes one deterministic first-party catalog deployment with complete package and rollback layouts", async () => {
  const { browserRoot, publishRoot } = await createPublishFixture("complete");

  const result = await publishSite({ browserRoot, publishRoot });

  assert.equal(result.publishRoot, publishRoot);
  for (const relativePath of [
    "index.html",
    "synth-browser.css",
    "catalog-sources.json",
    "catalogs/sheaf/catalog.json",
    "dist/src/main.js",
    "dist/src/worker.js",
    "dist/src/package-loader.js",
    "rollback/direct-miniapp/index.html",
    "rollback/direct-miniapp/app.js",
    "rollback/direct-miniapp/miniapp.js",
    "rollback/direct-miniapp/miniapp.wasm",
    "_headers",
  ]) await assertFile(path.join(publishRoot, relativePath));

  const sourceList = JSON.parse(await readFile(path.join(publishRoot, "catalog-sources.json"), "utf8"));
  assert.deepEqual(sourceList, ["catalogs/sheaf/catalog.json"]);
  const catalogUrl = new URL(sourceList[0], "https://launcher.example/catalog-sources.json");
  assert.equal(catalogUrl.href, "https://launcher.example/catalogs/sheaf/catalog.json");

  const catalog = JSON.parse(await readFile(path.join(publishRoot, "catalogs/sheaf/catalog.json"), "utf8"));
  assert.equal(catalog.schemaVersion, 1);
  assert.deepEqual(catalog.publisher, { id: "sheaf", name: "Sheaf" });
  assert.equal(catalog.apps.length, 1);
  const app = catalog.apps[0];
  assert.equal(app.appId, "miniapp");
  assert.match(app.buildId, /^[0-9a-f]{64}$/);
  assert.equal(app.browser.entry, `packages/miniapp/${app.buildId}/miniapp.js`);
  assert.deepEqual(app.browser.files.map(({ path: filePath, mediaType }) => ({ filePath, mediaType })), [
    { filePath: `packages/miniapp/${app.buildId}/miniapp.js`, mediaType: "text/javascript" },
    { filePath: `packages/miniapp/${app.buildId}/miniapp.wasm`, mediaType: "application/wasm" },
  ]);
  const packageRoot = path.join(publishRoot, "catalogs", "sheaf");
  for (const file of app.browser.files) {
    const filename = path.join(packageRoot, file.path);
    await assertFile(filename);
    assert.equal(file.sha256, sha256(await readFile(filename)), file.path);
    const resolved = new URL(file.path, catalogUrl);
    assert.equal(resolved.pathname, `/catalogs/sheaf/${file.path}`);
  }

  const rootHtml = await readFile(path.join(publishRoot, "index.html"), "utf8");
  assert.match(rootHtml, /data-synth-launcher="true"/);
  assert.doesNotMatch(rootHtml, /data-synth-auto|rollback|app\.js|miniapp/i);
  const productionCode = await readFile(path.join(publishRoot, "dist/src/main.js"), "utf8");
  assert.doesNotMatch(productionCode, /miniapp/i);
  assert.deepEqual((await readdir(path.join(publishRoot, "dist/src"))).sort(), [...browserRuntimeModules].sort());
  for (const moduleName of browserRuntimeModules) {
    const moduleSource = await readFile(path.join(publishRoot, "dist/src", moduleName), "utf8");
    assert.doesNotMatch(moduleSource, /miniapp|rollback\/direct-miniapp/i, moduleName);
  }
  const rollbackHtml = await readFile(path.join(publishRoot, "rollback/direct-miniapp/index.html"), "utf8");
  assert.doesNotMatch(rollbackHtml, /data-synth-auto/);
  assert.match(rollbackHtml, /installSynthBrowserApp/);
  assert.match(rollbackHtml, /entryUrl:\s*entryUrl|entryUrl,/);
  assert.match(rollbackHtml, /"miniapp\.js": workerUrl/);
  assert.match(rollbackHtml, /"miniapp\.wasm": wasmUrl/);
  assert.match(rollbackHtml, /\.\.\/\.\.\/dist\/src\/main\.js/);

  const headers = await readFile(path.join(publishRoot, "_headers"), "utf8");
  assert.equal(headers, cloudflareHeaders);
  assert.match(headers, /\/\*\n\s+Cross-Origin-Opener-Policy: same-origin/);
  assert.match(headers, /Cross-Origin-Embedder-Policy: require-corp/);
  assert.match(headers, /Permissions-Policy: midi=\(self\)/);
  assert.match(headers, /\/catalogs\/sheaf\/packages\/\*\.wasm\n\s+Content-Type: application\/wasm/);
  assert.match(headers, /\/catalogs\/sheaf\/packages\/\*\.js\n\s+Content-Type: text\/javascript/);
  assert.match(headers, /\/rollback\/direct-miniapp\/\*\.wasm\n\s+Content-Type: application\/wasm/);
  assert.match(headers, /\/rollback\/direct-miniapp\/\*\.js\n\s+Content-Type: text\/javascript/);

  await validatePublishedSite({ publishRoot });
});

test("publishing the same inputs twice produces byte-identical trees", async () => {
  const { browserRoot, root } = await createPublishFixture("deterministic");
  const first = path.join(root, "site-one");
  const second = path.join(root, "site-two");

  await publishSite({ browserRoot, publishRoot: first });
  await publishSite({ browserRoot, publishRoot: second });

  assert.deepEqual(await snapshotTree(first), await snapshotTree(second));
});

test("derives a deterministic Pages publisher artifact containing catalogs and immutable packages only", async () => {
  const { browserRoot, publishRoot, root } = await createPublishFixture("pages-publisher");
  const pagesRoot = path.join(root, "pages");
  await publishSite({ browserRoot, publishRoot });

  const result = await publishPublisherArtifact({ publishRoot, pagesRoot });

  assert.equal(result.pagesRoot, pagesRoot);
  const catalog = JSON.parse(await readFile(path.join(pagesRoot, "catalogs/sheaf/catalog.json"), "utf8"));
  const buildId = catalog.apps[0].buildId;
  assert.deepEqual((await snapshotTree(pagesRoot)).map(([relativePath]) => relativePath), [
    "catalogs/sheaf/catalog.json",
    `catalogs/sheaf/packages/miniapp/${buildId}/miniapp.js`,
    `catalogs/sheaf/packages/miniapp/${buildId}/miniapp.wasm`,
  ]);
  for (const forbidden of ["index.html", "catalog-sources.json", "_headers", "rollback", "dist"])
    await assert.rejects(stat(path.join(pagesRoot, forbidden)), { code: "ENOENT" });

  const second = path.join(root, "pages-second");
  await publishPublisherArtifact({ publishRoot, pagesRoot: second });
  assert.deepEqual(await snapshotTree(pagesRoot), await snapshotTree(second));
});

test("validation rejects missing package files and inconsistent package digests", async () => {
  const { browserRoot, publishRoot } = await createPublishFixture("invalid-package");
  await publishSite({ browserRoot, publishRoot });
  const catalog = JSON.parse(await readFile(path.join(publishRoot, "catalogs/sheaf/catalog.json"), "utf8"));
  const wasm = path.join(publishRoot, "catalogs/sheaf", catalog.apps[0].browser.files[1].path);
  await writeFile(wasm, "changed bytes");

  await assert.rejects(
    () => validatePublishedSite({ publishRoot }),
    /miniapp\.wasm.*(?:size|SHA-256)|(?:size|SHA-256).*miniapp\.wasm/i,
  );

  const missing = path.join(publishRoot, "catalogs/sheaf", catalog.apps[0].browser.files[0].path);
  await writeFile(missing, "");
  await assert.rejects(
    () => validatePublishedSite({ publishRoot }),
    /miniapp\.js.*(?:size|SHA-256|empty)|(?:size|SHA-256|empty).*miniapp\.js/i,
  );
});

test("publish failure leaves the previous destination untouched and exposes the invalid reference", async () => {
  const { browserRoot, publishRoot } = await createPublishFixture("atomic");
  await writeFixture(publishRoot, { "existing.txt": "previous deployment\n" });
  await writeFile(path.join(browserRoot, "catalog-sources.json"), `${JSON.stringify(["catalogs/friend/catalog.json"])}\n`);

  await assert.rejects(
    () => publishSite({ browserRoot, publishRoot }),
    /catalogs\/friend\/catalog\.json.*(?:missing|first catalog source)|(?:missing|first catalog source).*catalogs\/friend\/catalog\.json/i,
  );

  assert.equal(await readFile(path.join(publishRoot, "existing.txt"), "utf8"), "previous deployment\n");
  assert.deepEqual(await readdir(publishRoot), ["existing.txt"]);
});

test("publish failure names a missing miniapp emission before replacing the destination", async () => {
  const { browserRoot, publishRoot } = await createPublishFixture("missing");
  await writeFixture(publishRoot, { "existing.txt": "previous deployment\n" });
  const wasm = path.join(browserRoot, "dist/wasm/miniapp.wasm");
  await writeFile(wasm, "");

  await assert.rejects(
    () => publishSite({ browserRoot, publishRoot }),
    /miniapp\.wasm.*empty|empty.*miniapp\.wasm/i,
  );
  assert.equal(await readFile(path.join(publishRoot, "existing.txt"), "utf8"), "previous deployment\n");
});

test("publish rejects unexpected Emscripten emissions before replacing the destination", async () => {
  const { browserRoot, publishRoot } = await createPublishFixture("unexpected-sidecar");
  await writeFixture(publishRoot, { "existing.txt": "previous deployment\n" });
  await writeFile(path.join(browserRoot, "dist/wasm/miniapp.worker.js"), "postMessage('worker');\n");

  await assert.rejects(
    () => publishSite({ browserRoot, publishRoot }),
    /unexpected.*miniapp\.worker\.js/i,
  );
  assert.equal(await readFile(path.join(publishRoot, "existing.txt"), "utf8"), "previous deployment\n");
});

async function createPublishFixture(name) {
  const root = await mkdtemp(path.join(os.tmpdir(), `synth-browser-publish-${name}-`));
  const browserRoot = path.join(root, "browser");
  const publishRoot = path.join(root, "site");
  await writeFixture(browserRoot, {
    "catalog-sources.json": `${JSON.stringify(["catalogs/sheaf/catalog.json"])}\n`,
    "catalogs/sheaf/catalog.template.json": `${JSON.stringify({
      schemaVersion: 1,
      publisher: { id: "sheaf", name: "Sheaf" },
      app: {
        appId: "miniapp",
        displayName: "Mini App",
        author: "Sheaf",
        category: "Instrument",
      },
    }, null, 2)}\n`,
    "public/index.html": "<!doctype html><main id=\"synth-root\" data-synth-launcher=\"true\" data-synth-catalog-sources=\"/catalog-sources.json\"></main><script type=\"module\" src=\"./dist/src/main.js\"></script>\n",
    "public/synth-browser.css": "body { margin: 0; }\n",
    "dist/src/main.js": "export const launcher = true;\n",
    "dist/src/activation.js": "export const activation = true;\n",
    "dist/src/audio-worklet.js": "export const audioWorklet = true;\n",
    "dist/src/audio.js": "export const audio = true;\n",
    "dist/src/catalog-client.js": "export const catalogClient = true;\n",
    "dist/src/catalog.js": "export const catalog = true;\n",
    "dist/src/launcher.js": "export const launcherUi = true;\n",
    "dist/src/midi.js": "export const midi = true;\n",
    "dist/src/worker.js": "export const worker = true;\n",
    "dist/src/package-loader.js": "export const packageLoader = true;\n",
    "dist/src/persistence.js": "export const persistence = true;\n",
    "dist/src/protocol.js": "export const protocol = true;\n",
    "dist/src/ui.js": "export const ui = true;\n",
    "dist/wasm/app.js": miniappEntry,
    "dist/wasm/miniapp.js": miniappEntry,
    "dist/wasm/miniapp.wasm": miniappWasm,
  });
  return { root, browserRoot, publishRoot };
}

async function writeFixture(root, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const filename = path.join(root, relativePath);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, contents);
  }
}

async function assertFile(filename) {
  assert.equal((await stat(filename)).isFile(), true, filename);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function snapshotTree(root) {
  const snapshot = [];
  async function visit(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename, relativePath);
      else snapshot.push([relativePath, sha256(await readFile(filename))]);
    }
  }
  await visit(root, "");
  return snapshot;
}
