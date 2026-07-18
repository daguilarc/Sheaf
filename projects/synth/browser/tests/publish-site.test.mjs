import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { publishSite } from "../src/publish-site.mjs";

test("publishes Cloudflare Pages site assets and headers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "synth-browser-publish-"));
  const browserRoot = path.join(root, "browser");
  const publishRoot = path.join(root, "site");
  await writeFixture(browserRoot, {
    "public/index.html": "<main id=\"synth-root\"></main>",
    "public/synth-browser.css": "body { margin: 0; }",
    "dist/src/main.js": "export {};",
    "dist/src/audio-worklet.js": "export {};",
    "dist/wasm/app.js": "export default {};",
    "dist/wasm/miniapp.wasm": "wasm bytes",
    "dist/wasm/miniapp.worker.js": "export {};",
  });

  const result = await publishSite({ browserRoot, publishRoot });

  assert.equal(result.publishRoot, publishRoot);
  await assertFile(path.join(publishRoot, "index.html"));
  await assertFile(path.join(publishRoot, "synth-browser.css"));
  await assertFile(path.join(publishRoot, "dist/src/main.js"));
  await assertFile(path.join(publishRoot, "dist/src/audio-worklet.js"));
  await assertFile(path.join(publishRoot, "dist/wasm/app.js"));
  await assertFile(path.join(publishRoot, "dist/wasm/miniapp.wasm"));
  await assertFile(path.join(publishRoot, "dist/wasm/miniapp.worker.js"));

  const headers = await readFile(path.join(publishRoot, "_headers"), "utf8");
  assert.match(headers, /\/\*\n\s+Cross-Origin-Opener-Policy: same-origin/);
  assert.match(headers, /Cross-Origin-Embedder-Policy: require-corp/);
  assert.match(headers, /Permissions-Policy: midi=\(self\)/);
  assert.match(headers, /\/dist\/wasm\/\*\.wasm\n\s+Content-Type: application\/wasm/);
});

test("publish fails before writing a complete site when app artifact is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "synth-browser-publish-missing-"));
  const browserRoot = path.join(root, "browser");
  const publishRoot = path.join(root, "site");
  await writeFixture(browserRoot, {
    "public/index.html": "<main id=\"synth-root\"></main>",
    "public/synth-browser.css": "body { margin: 0; }",
    "dist/src/main.js": "export {};",
    "dist/wasm/miniapp.wasm": "wasm bytes",
  });

  await assert.rejects(
    () => publishSite({ browserRoot, publishRoot }),
    /Missing required browser publish artifact: .*dist\/wasm\/app\.js/,
  );
});

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
