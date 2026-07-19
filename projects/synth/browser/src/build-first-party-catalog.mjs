import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseCatalog, parseCatalogSources } from "./catalog.js";
import { assemblePackage } from "./package-contract.mjs";

const CANONICAL_CATALOG_PATH = "catalogs/sheaf/catalog.json";

function plainRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}

function exactKeys(value, keys, label) {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label}.${key} is required`);
  }
}

async function requiredNonemptyFile(filename, relativePath) {
  let metadata;
  try {
    metadata = await stat(filename);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Missing required first-party artifact: ${relativePath}`);
    throw error;
  }
  if (!metadata.isFile()) throw new Error(`Required first-party artifact is not a file: ${relativePath}`);
  if (metadata.size === 0) throw new Error(`Required first-party artifact is empty: ${relativePath}`);
}

async function rejectUnexpectedMiniappEmissions(browserRoot) {
  const expected = new Set(["miniapp.js", "miniapp.wasm"]);
  const entries = await readdir(path.join(browserRoot, "dist", "wasm"));
  const unexpected = entries
    .filter((name) => name.startsWith("miniapp.") && !expected.has(name))
    .sort();
  if (unexpected.length > 0)
    throw new Error(`Unexpected first-party Emscripten emissions: ${unexpected.join(", ")}`);
}

function readTemplate(value) {
  const template = plainRecord(value, "first-party catalog template");
  exactKeys(template, ["schemaVersion", "publisher", "app"], "first-party catalog template");
  const publisher = plainRecord(template.publisher, "first-party catalog template.publisher");
  exactKeys(publisher, ["id", "name"], "first-party catalog template.publisher");
  const app = plainRecord(template.app, "first-party catalog template.app");
  exactKeys(app, ["appId", "displayName", "author", "category"], "first-party catalog template.app");
  if (template.schemaVersion !== 1) throw new Error("first-party catalog template.schemaVersion must be 1");
  if (publisher.id !== "sheaf") throw new Error("first-party catalog publisher id must be sheaf");
  if (app.appId !== "miniapp") throw new Error("first-party catalog app id must be miniapp");
  return { schemaVersion: template.schemaVersion, publisher, app };
}

export async function buildFirstPartyCatalog({ browserRoot, outputRoot }) {
  const sourceListPath = path.join(browserRoot, "catalog-sources.json");
  const templatePath = path.join(browserRoot, "catalogs", "sheaf", "catalog.template.json");
  const entryPath = path.join(browserRoot, "dist", "wasm", "miniapp.js");
  const wasmPath = path.join(browserRoot, "dist", "wasm", "miniapp.wasm");
  await requiredNonemptyFile(sourceListPath, "catalog-sources.json");
  await requiredNonemptyFile(templatePath, "catalogs/sheaf/catalog.template.json");
  await requiredNonemptyFile(entryPath, "dist/wasm/miniapp.js");
  await requiredNonemptyFile(wasmPath, "dist/wasm/miniapp.wasm");
  await rejectUnexpectedMiniappEmissions(browserRoot);

  const sourceList = JSON.parse(await readFile(sourceListPath, "utf8"));
  const parsedSources = parseCatalogSources(sourceList, "https://deployment.invalid/catalog-sources.json");
  const canonicalCatalogUrl = new URL(CANONICAL_CATALOG_PATH, "https://deployment.invalid/catalog-sources.json").href;
  if (parsedSources[0]?.catalogUrl !== canonicalCatalogUrl) {
    throw new Error(`First catalog source must resolve to ${CANONICAL_CATALOG_PATH}; received ${String(sourceList[0])}`);
  }
  const template = readTemplate(JSON.parse(await readFile(templatePath, "utf8")));

  const emissionRoot = await mkdtemp(path.join(os.tmpdir(), "sheaf-first-party-miniapp-"));
  try {
    await copyFile(entryPath, path.join(emissionRoot, "miniapp.js"));
    await copyFile(wasmPath, path.join(emissionRoot, "miniapp.wasm"));
    const catalogRoot = path.join(outputRoot, "catalogs", "sheaf");
    await mkdir(catalogRoot, { recursive: true });
    const packageRecord = await assemblePackage({
      appId: template.app.appId,
      sourceDirectory: emissionRoot,
      outputDirectory: catalogRoot,
      artifacts: {
        entry: "miniapp.js",
        wasm: "miniapp.wasm",
        pthreadWorker: "miniapp.js",
        wasmWorker: "miniapp.js",
        audioWorklet: "miniapp.js",
      },
    });
    const catalog = {
      schemaVersion: template.schemaVersion,
      catalogVersion: `first-party-${packageRecord.buildId}`,
      publisher: template.publisher,
      apps: [{
        ...template.app,
        buildId: packageRecord.buildId,
        browser: packageRecord.browser,
      }],
    };
    parseCatalog(catalog, canonicalCatalogUrl);
    await writeFile(path.join(catalogRoot, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
    await writeFile(path.join(outputRoot, "catalog-sources.json"), `${JSON.stringify(sourceList, null, 2)}\n`);
    return Object.freeze({ catalog, packageRecord });
  } finally {
    await rm(emissionRoot, { recursive: true, force: true });
  }
}

export { CANONICAL_CATALOG_PATH };
