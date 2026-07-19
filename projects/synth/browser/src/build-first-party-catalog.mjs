import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { readAppBuildManifest } from "./app-build-manifest.mjs";
import { parseCatalog, parseCatalogSources } from "./catalog.js";
import { assemblePackage, REQUIRED_ARTIFACT_ROLES } from "./package-contract.mjs";

const CANONICAL_CATALOG_PATH = "catalogs/sheaf/catalog.json";
const EMISSION_REPORT_PATH = "dist/wasm/apps/emissions.json";
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/;

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

function relativeArtifactPath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || path.posix.isAbsolute(value))
    throw new Error(`${label} must be a normalized relative artifact path`);
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || !PATH_SEGMENT_PATTERN.test(segment)))
    throw new Error(`${label} must be a normalized relative artifact path`);
  if (path.posix.normalize(value) !== value) throw new Error(`${label} must be a normalized relative artifact path`);
  return value;
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

function validateEmissionReport(value, manifest) {
  const report = plainRecord(value, "first-party emission report");
  exactKeys(report, ["schemaVersion", "manifestDigest", "publisher", "apps"], "first-party emission report");
  if (report.schemaVersion !== 1) throw new Error("first-party emission report.schemaVersion must be 1");
  if (report.manifestDigest !== manifest.digest) {
    throw new Error(
      `First-party emission report manifest digest does not match the validated manifest; ` +
      `expected ${manifest.digest}, received ${String(report.manifestDigest)}`,
    );
  }
  const publisher = plainRecord(report.publisher, "first-party emission report.publisher");
  exactKeys(publisher, ["id", "name"], "first-party emission report.publisher");
  if (publisher.id !== manifest.publisher.id || publisher.name !== manifest.publisher.name)
    throw new Error("First-party emission report publisher does not match the validated manifest");
  if (!Array.isArray(report.apps)) throw new Error("first-party emission report.apps must be an array");
  if (report.apps.length !== manifest.apps.length) {
    throw new Error(
      `First-party emission report app count does not match the validated manifest: ` +
      `expected ${manifest.apps.length}, received ${report.apps.length}`,
    );
  }

  return Object.freeze(report.apps.map((value, index) => {
    const label = `first-party emission report.apps[${index}]`;
    const emission = plainRecord(value, label);
    exactKeys(emission, ["appId", "artifacts"], label);
    const app = manifest.apps[index];
    if (emission.appId !== app.appId) {
      throw new Error(`${label}.appId must be ${app.appId}; received ${String(emission.appId)}`);
    }
    const artifactValue = plainRecord(emission.artifacts, `${label}.artifacts`);
    exactKeys(artifactValue, REQUIRED_ARTIFACT_ROLES, `${label}.artifacts`);
    const absoluteRoles = Object.fromEntries(REQUIRED_ARTIFACT_ROLES.map((role) =>
      [role, relativeArtifactPath(artifactValue[role], `${label}.artifacts.${role}`)]));
    const sourcePrefix = path.posix.dirname(absoluteRoles.entry);
    const expectedSourcePrefix = `apps/${app.appId}`;
    if (sourcePrefix !== expectedSourcePrefix) {
      throw new Error(
        `${label} for ${app.appId} must use dedicated emission directory ${expectedSourcePrefix}; received ${sourcePrefix}`,
      );
    }
    const prefix = `${sourcePrefix}/`;
    const artifacts = Object.fromEntries(REQUIRED_ARTIFACT_ROLES.map((role) => {
      const artifactPath = absoluteRoles[role];
      if (!artifactPath.startsWith(prefix)) {
        throw new Error(`${label}.artifacts.${role} must stay within emission directory ${sourcePrefix}`);
      }
      return [role, artifactPath.slice(prefix.length)];
    }));
    return Object.freeze({ app, sourcePrefix, artifacts: Object.freeze(artifacts) });
  }));
}

function catalogVersion(packageRecords) {
  const identities = packageRecords.map(({ appId, buildId }) => ({ appId, buildId }));
  const digest = createHash("sha256").update(JSON.stringify(identities)).digest("hex");
  return `first-party-${digest}`;
}

async function replaceDirectory(stagedDirectory, destination) {
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true });
  const backup = await mkdtemp(path.join(parent, `.${path.basename(destination)}.previous-`));
  await rm(backup, { recursive: true, force: true });
  let movedPrevious = false;
  try {
    try {
      await rename(destination, backup);
      movedPrevious = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(stagedDirectory, destination);
    if (movedPrevious) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (movedPrevious) {
      await rm(destination, { recursive: true, force: true });
      await rename(backup, destination);
    }
    throw error;
  }
}

async function atomicWrite(filename, contents) {
  const temporary = `${filename}.stage-${process.pid}`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function buildFirstPartyCatalog({ browserRoot, outputRoot }) {
  const sourceListPath = path.join(browserRoot, "catalog-sources.json");
  const emissionReportPath = path.join(browserRoot, ...EMISSION_REPORT_PATH.split("/"));
  await requiredNonemptyFile(sourceListPath, "catalog-sources.json");
  await requiredNonemptyFile(emissionReportPath, EMISSION_REPORT_PATH);

  const sourceList = JSON.parse(await readFile(sourceListPath, "utf8"));
  const parsedSources = parseCatalogSources(sourceList, "https://deployment.invalid/catalog-sources.json");
  const canonicalCatalogUrl = new URL(CANONICAL_CATALOG_PATH, "https://deployment.invalid/catalog-sources.json").href;
  if (parsedSources[0]?.catalogUrl !== canonicalCatalogUrl) {
    throw new Error(`First catalog source must resolve to ${CANONICAL_CATALOG_PATH}; received ${String(sourceList[0])}`);
  }
  const manifest = await readAppBuildManifest({ browserRoot });
  const emissions = validateEmissionReport(JSON.parse(await readFile(emissionReportPath, "utf8")), manifest);

  await mkdir(path.dirname(outputRoot), { recursive: true });
  const stagingRoot = await mkdtemp(path.join(path.dirname(outputRoot), ".first-party-catalog.stage-"));
  try {
    const stagedCatalogRoot = path.join(stagingRoot, "catalogs", manifest.publisher.id);
    await mkdir(stagedCatalogRoot, { recursive: true });
    const packageRecords = [];
    for (const emission of emissions) {
      packageRecords.push(await assemblePackage({
        appId: emission.app.appId,
        sourceDirectory: path.join(browserRoot, "dist", "wasm", ...emission.sourcePrefix.split("/")),
        outputDirectory: stagedCatalogRoot,
        artifacts: emission.artifacts,
      }));
    }
    const catalog = {
      schemaVersion: manifest.schemaVersion,
      catalogVersion: catalogVersion(packageRecords),
      publisher: manifest.publisher,
      apps: manifest.apps.map((app, index) => ({
        appId: app.appId,
        displayName: app.displayName,
        author: app.author,
        category: app.category,
        buildId: packageRecords[index].buildId,
        browser: packageRecords[index].browser,
      })),
    };
    parseCatalog(catalog, canonicalCatalogUrl);
    await writeFile(path.join(stagedCatalogRoot, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
    await writeFile(path.join(stagingRoot, "catalog-sources.json"), `${JSON.stringify(sourceList, null, 2)}\n`);

    await mkdir(outputRoot, { recursive: true });
    await replaceDirectory(stagedCatalogRoot, path.join(outputRoot, "catalogs", manifest.publisher.id));
    await atomicWrite(
      path.join(outputRoot, "catalog-sources.json"),
      await readFile(path.join(stagingRoot, "catalog-sources.json")),
    );
    return Object.freeze({ catalog, packageRecords: Object.freeze(packageRecords) });
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

export { CANONICAL_CATALOG_PATH };
