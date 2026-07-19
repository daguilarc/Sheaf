import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildFirstPartyCatalog, CANONICAL_CATALOG_PATH } from "./build-first-party-catalog.mjs";
import { parseCatalog, parseCatalogSources } from "./catalog.js";

export const browserRuntimeModules = Object.freeze([
  "activation.js",
  "audio-worklet.js",
  "audio.js",
  "catalog-client.js",
  "catalog.js",
  "launcher.js",
  "main.js",
  "midi.js",
  "package-loader.js",
  "persistence.js",
  "protocol.js",
  "ui.js",
  "worker.js",
]);

export const cloudflareHeaders = `/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Permissions-Policy: midi=(self)

/catalogs/sheaf/packages/*.wasm
  Content-Type: application/wasm

/catalogs/sheaf/packages/*.js
  Content-Type: text/javascript

/rollback/direct-miniapp/*.wasm
  Content-Type: application/wasm

/rollback/direct-miniapp/*.js
  Content-Type: text/javascript
`;

const rollbackIndex = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sheaf Synth Direct Rollback</title>
    <link rel="stylesheet" href="../../synth-browser.css">
  </head>
  <body>
    <main id="synth-root"></main>
    <script type="module">
      import { installSynthBrowserApp } from "../../dist/src/main.js";

      const root = document.querySelector("#synth-root");
      const entryUrl = new URL("./app.js", import.meta.url).href;
      const workerUrl = new URL("./miniapp.js", import.meta.url).href;
      const wasmUrl = new URL("./miniapp.wasm", import.meta.url).href;
      installSynthBrowserApp(root, {
        module: {
          entryUrl,
          locateFile: {
            "app.js": entryUrl,
            "miniapp.js": workerUrl,
            "miniapp.wasm": wasmUrl,
          },
          mainScriptUrlOrBlob: entryUrl,
        },
      }).catch((error) => {
        root.dataset.synthStatus = error instanceof Error ? error.message : "direct rollback startup failed";
      });
    </script>
  </body>
</html>
`;

function defaultBrowserRoot() {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  return path.basename(path.dirname(directory)) === "dist"
    ? path.resolve(directory, "..", "..")
    : path.resolve(directory, "..");
}

async function assertExists(filename, relativePath, { nonempty = false } = {}) {
  let metadata;
  try {
    metadata = await stat(filename);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Missing required browser publish artifact: ${relativePath}`);
    throw error;
  }
  if (nonempty && metadata.isFile() && metadata.size === 0)
    throw new Error(`Required browser publish artifact is empty: ${relativePath}`);
  return metadata;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathFromDeploymentUrl(url, deploymentOrigin) {
  const parsed = new URL(url);
  if (parsed.origin !== deploymentOrigin) throw new Error(`Published reference leaves deployment origin: ${url}`);
  return parsed.pathname.replace(/^\/+/, "");
}

export async function validatePublishedSite({ publishRoot }) {
  for (const relativePath of [
    "index.html",
    "synth-browser.css",
    "catalog-sources.json",
    CANONICAL_CATALOG_PATH,
    "dist/src/main.js",
    "dist/src/worker.js",
    "dist/src/package-loader.js",
    "rollback/direct-miniapp/index.html",
    "rollback/direct-miniapp/app.js",
    "rollback/direct-miniapp/miniapp.js",
    "rollback/direct-miniapp/miniapp.wasm",
    "_headers",
  ]) await assertExists(path.join(publishRoot, relativePath), relativePath, { nonempty: true });

  const rootHtml = await readFile(path.join(publishRoot, "index.html"), "utf8");
  if (!/data-synth-launcher="true"/.test(rootHtml)) throw new Error("Published root index.html is not a catalog launcher");
  if (/data-synth-auto|rollback|miniapp/i.test(rootHtml))
    throw new Error("Published root index.html contains a direct application dependency");

  const deploymentBase = "https://deployment.invalid/catalog-sources.json";
  const sources = parseCatalogSources(
    JSON.parse(await readFile(path.join(publishRoot, "catalog-sources.json"), "utf8")),
    deploymentBase,
  );
  const canonicalUrl = new URL(CANONICAL_CATALOG_PATH, deploymentBase).href;
  if (sources[0]?.catalogUrl !== canonicalUrl)
    throw new Error(`First catalog reference must resolve to ${CANONICAL_CATALOG_PATH}; received ${String(sources[0]?.catalogUrl)}`);
  const catalogRelativePath = pathFromDeploymentUrl(sources[0].catalogUrl, new URL(deploymentBase).origin);
  await assertExists(path.join(publishRoot, catalogRelativePath), catalogRelativePath, { nonempty: true });
  const catalog = parseCatalog(
    JSON.parse(await readFile(path.join(publishRoot, catalogRelativePath), "utf8")),
    sources[0].catalogUrl,
  );
  if (catalog.publisher.id !== "sheaf" || catalog.apps.length !== 1 || catalog.apps[0].globalId !== "sheaf/miniapp")
    throw new Error("First-party catalog must contain exactly sheaf/miniapp");
  const app = catalog.apps[0];
  for (const file of app.browser.files) {
    const relativePath = pathFromDeploymentUrl(file.url, new URL(deploymentBase).origin);
    const expectedPrefix = `catalogs/sheaf/packages/${app.appId}/${app.buildId}/`;
    if (!relativePath.startsWith(expectedPrefix))
      throw new Error(`Catalog package reference ${relativePath} is outside immutable first-party package ${expectedPrefix}`);
    const filename = path.join(publishRoot, relativePath);
    const metadata = await assertExists(filename, relativePath, { nonempty: true });
    if (metadata.size !== file.size)
      throw new Error(`Package file ${file.path} size mismatch: expected ${file.size}, received ${metadata.size}`);
    const actualDigest = sha256(await readFile(filename));
    if (actualDigest !== file.sha256)
      throw new Error(`Package file ${file.path} SHA-256 mismatch: expected ${file.sha256}, received ${actualDigest}`);
    if (file.mediaType === "application/wasm" && !relativePath.endsWith(".wasm"))
      throw new Error(`Package file ${file.path} has inconsistent WASM media type`);
    if (file.mediaType === "text/javascript" && !/\.(?:m?js)$/.test(relativePath))
      throw new Error(`Package file ${file.path} has inconsistent JavaScript media type`);
  }

  const packagePaths = new Set(app.browser.files.map(({ path: filePath }) => filePath));
  if (!packagePaths.has(app.browser.entry)) throw new Error(`Catalog entry ${app.browser.entry} is not a package file`);
  const rollbackApp = await readFile(path.join(publishRoot, "rollback/direct-miniapp/app.js"));
  const rollbackEntry = await readFile(path.join(publishRoot, "rollback/direct-miniapp/miniapp.js"));
  if (!rollbackApp.equals(rollbackEntry)) throw new Error("Rollback app.js does not match its complete miniapp.js sidecar");
  const headers = await readFile(path.join(publishRoot, "_headers"), "utf8");
  if (headers !== cloudflareHeaders) throw new Error("Published _headers does not match the Cloudflare runtime policy");
  return Object.freeze({ catalog, app });
}

async function replaceDestination(stagingRoot, publishRoot) {
  const parent = path.dirname(publishRoot);
  const backupRoot = await mkdtemp(path.join(parent, `.${path.basename(publishRoot)}.previous-`));
  await rm(backupRoot, { recursive: true, force: true });
  let movedPrevious = false;
  try {
    try {
      await rename(publishRoot, backupRoot);
      movedPrevious = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(stagingRoot, publishRoot);
    if (movedPrevious) await rm(backupRoot, { recursive: true, force: true });
  } catch (error) {
    if (movedPrevious) {
      await rm(publishRoot, { recursive: true, force: true });
      await rename(backupRoot, publishRoot);
    }
    throw error;
  }
}

export async function publishSite({
  browserRoot = defaultBrowserRoot(),
  publishRoot = path.join(browserRoot, "dist", "site"),
  catalogBuilder = buildFirstPartyCatalog,
} = {}) {
  for (const relativePath of [
    "public/index.html",
    "public/synth-browser.css",
    "catalog-sources.json",
    "catalogs/sheaf/catalog.template.json",
    "dist/wasm/app.js",
    "dist/wasm/miniapp.js",
    "dist/wasm/miniapp.wasm",
  ]) await assertExists(path.join(browserRoot, relativePath), relativePath, { nonempty: true });
  for (const moduleName of browserRuntimeModules)
    await assertExists(path.join(browserRoot, "dist", "src", moduleName), `dist/src/${moduleName}`, { nonempty: true });

  await mkdir(path.dirname(publishRoot), { recursive: true });
  const stagingRoot = await mkdtemp(path.join(path.dirname(publishRoot), `.${path.basename(publishRoot)}.stage-`));
  let staged = true;
  try {
    await cp(path.join(browserRoot, "public"), stagingRoot, { recursive: true });
    await mkdir(path.join(stagingRoot, "dist", "src"), { recursive: true });
    await Promise.all(browserRuntimeModules.map((moduleName) => cp(
      path.join(browserRoot, "dist", "src", moduleName),
      path.join(stagingRoot, "dist", "src", moduleName),
    )));
    await catalogBuilder({ browserRoot, outputRoot: stagingRoot });

    const rollbackRoot = path.join(stagingRoot, "rollback", "direct-miniapp");
    await mkdir(rollbackRoot, { recursive: true });
    await Promise.all([
      ["app.js", "app.js"],
      ["miniapp.js", "miniapp.js"],
      ["miniapp.wasm", "miniapp.wasm"],
    ].map(([source, destination]) => cp(
      path.join(browserRoot, "dist", "wasm", source),
      path.join(rollbackRoot, destination),
    )));
    await writeFile(path.join(rollbackRoot, "index.html"), rollbackIndex);
    await writeFile(path.join(stagingRoot, "_headers"), cloudflareHeaders);
    await validatePublishedSite({ publishRoot: stagingRoot });
    await replaceDestination(stagingRoot, publishRoot);
    staged = false;
    return Object.freeze({ publishRoot });
  } finally {
    if (staged) await rm(stagingRoot, { recursive: true, force: true });
  }
}

export async function publishPublisherArtifact({
  browserRoot = defaultBrowserRoot(),
  publishRoot = path.join(browserRoot, "dist", "site"),
  pagesRoot = path.join(browserRoot, "dist", "pages"),
} = {}) {
  const { catalog } = await validatePublishedSite({ publishRoot });
  await mkdir(path.dirname(pagesRoot), { recursive: true });
  const stagingRoot = await mkdtemp(path.join(path.dirname(pagesRoot), `.${path.basename(pagesRoot)}.stage-`));
  let staged = true;
  try {
    await cp(path.join(publishRoot, "catalogs"), path.join(stagingRoot, "catalogs"), { recursive: true });
    const roots = await readdir(stagingRoot);
    if (roots.length !== 1 || roots[0] !== "catalogs")
      throw new Error(`Pages publisher artifact must contain only catalogs; received ${roots.join(", ")}`);
    for (const app of catalog.apps) {
      const prefix = `catalogs/${catalog.publisher.id}/packages/${app.appId}/${app.buildId}/`;
      for (const file of app.browser.files) {
        const relativePath = `catalogs/${catalog.publisher.id}/${file.path}`;
        if (!relativePath.startsWith(prefix))
          throw new Error(`Pages package reference ${relativePath} is outside immutable package ${prefix}`);
        const metadata = await assertExists(path.join(stagingRoot, relativePath), relativePath, { nonempty: true });
        if (metadata.size !== file.size)
          throw new Error(`Pages package file ${file.path} size mismatch: expected ${file.size}, received ${metadata.size}`);
        const digest = sha256(await readFile(path.join(stagingRoot, relativePath)));
        if (digest !== file.sha256)
          throw new Error(`Pages package file ${file.path} SHA-256 mismatch: expected ${file.sha256}, received ${digest}`);
      }
    }
    await replaceDestination(stagingRoot, pagesRoot);
    staged = false;
    return Object.freeze({ pagesRoot });
  } finally {
    if (staged) await rm(stagingRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--publisher-only") {
    const { pagesRoot } = await publishPublisherArtifact();
    console.log(`Published browser catalogs to ${path.relative(process.cwd(), pagesRoot)}`);
  } else {
    const { publishRoot } = await publishSite();
    console.log(`Published browser site to ${path.relative(process.cwd(), publishRoot)}`);
  }
}
