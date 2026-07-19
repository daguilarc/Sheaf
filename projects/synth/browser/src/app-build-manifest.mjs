import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const MANIFEST_KEYS = ["schemaVersion", "publisher", "apps"];
const PUBLISHER_KEYS = ["id", "name"];
const APP_KEYS = ["appId", "displayName", "author", "category", "header", "cppType", "includeDirs"];
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CPP_TYPE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)+$/;

function plainRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const expectedSet = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!expectedSet.has(key)) throw new Error(`${label} contains unknown field ${key}`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label}.${key} is required`);
  }
}

function nonemptyString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
  return value;
}

function identifier(value, label) {
  const validated = nonemptyString(value, label);
  if (!ID_PATTERN.test(validated)) throw new Error(`${label} must be a lowercase kebab-case identifier`);
  return validated;
}

function relativeSourcePath(value, label, { allowParent = false } = {}) {
  const validated = nonemptyString(value, label);
  if (path.isAbsolute(validated) || validated.includes("\\") || validated.includes(":")) {
    throw new Error(`${label} must be a relative POSIX source path`);
  }
  const components = validated.split("/");
  if (components.some((component) => component === "" || component === "." || (!allowParent && component === ".."))) {
    throw new Error(`${label} must not contain empty or traversal components`);
  }
  return validated;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function requireAllowedDirectory(browserRoot, sourcePath, allowedRoots, label) {
  const resolved = path.resolve(browserRoot, sourcePath);
  let canonical;
  let metadata;
  try {
    canonical = await realpath(resolved);
    metadata = await stat(canonical);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${label} directory does not exist: ${sourcePath}`);
    throw error;
  }
  if (!metadata.isDirectory()) throw new Error(`${label} is not a directory: ${sourcePath}`);
  if (!allowedRoots.some((root) => isWithin(root, canonical))) {
    throw new Error(`${label} escapes the allowed source roots: ${sourcePath}`);
  }
  return canonical;
}

async function requireHeader(header, includeDirectories, allowedRoots, label) {
  for (const includeDirectory of includeDirectories) {
    const candidate = path.resolve(includeDirectory, header);
    let canonical;
    let metadata;
    try {
      canonical = await realpath(candidate);
      metadata = await stat(canonical);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (metadata.isFile() && allowedRoots.some((root) => isWithin(root, canonical))) return;
  }
  throw new Error(`${label} ${header} was not found beneath a validated include directory`);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function generateBrowserBinding(app) {
  const header = relativeSourcePath(app?.header, "app.header");
  const cppType = nonemptyString(app?.cppType, "app.cppType");
  if (!CPP_TYPE_PATTERN.test(cppType)) {
    throw new Error("app.cppType must be a qualified C++ identifier");
  }
  return `#include "${header}"\n#include "synth/browser/BrowserAppEntry.hpp"\n\nSYNTH_BROWSER_APP(${cppType})\n`;
}

export async function readAppBuildManifest({
  browserRoot,
  manifestPath = path.join(browserRoot, "first-party-apps.json"),
  allowedSourceRoots = [path.resolve(browserRoot, "..", "apps")],
}) {
  if (typeof browserRoot !== "string" || browserRoot.length === 0) {
    throw new Error("browserRoot must be a non-empty path");
  }
  if (!Array.isArray(allowedSourceRoots) || allowedSourceRoots.length === 0) {
    throw new Error("allowedSourceRoots must contain at least one directory");
  }
  const canonicalAllowedRoots = await Promise.all(allowedSourceRoots.map(async (root, index) => {
    try {
      const canonical = await realpath(path.resolve(browserRoot, root));
      const metadata = await stat(canonical);
      if (!metadata.isDirectory()) throw new Error(`allowedSourceRoots[${index}] is not a directory`);
      return canonical;
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`allowedSourceRoots[${index}] does not exist: ${root}`);
      throw error;
    }
  }));

  let source;
  try {
    source = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read app build manifest ${manifestPath}: ${error.message}`, { cause: error });
  }
  const manifest = plainRecord(source, "manifest");
  exactKeys(manifest, MANIFEST_KEYS, "manifest");
  if (manifest.schemaVersion !== 1) throw new Error("manifest.schemaVersion must be 1");

  const publisherValue = plainRecord(manifest.publisher, "manifest.publisher");
  exactKeys(publisherValue, PUBLISHER_KEYS, "manifest.publisher");
  const publisher = {
    id: identifier(publisherValue.id, "manifest.publisher.id"),
    name: nonemptyString(publisherValue.name, "manifest.publisher.name"),
  };
  if (!Array.isArray(manifest.apps) || manifest.apps.length === 0) {
    throw new Error("manifest.apps must be a non-empty array");
  }

  const seenAppIds = new Set();
  const apps = [];
  for (const [index, appValue] of manifest.apps.entries()) {
    const label = `manifest.apps[${index}]`;
    const record = plainRecord(appValue, label);
    exactKeys(record, APP_KEYS, label);
    const appId = identifier(record.appId, `${label}.appId`);
    if (seenAppIds.has(appId)) throw new Error(`Duplicate appId ${appId} at ${label}.appId`);
    seenAppIds.add(appId);

    const cppType = nonemptyString(record.cppType, `${label}.cppType`);
    if (!CPP_TYPE_PATTERN.test(cppType)) {
      throw new Error(`${label}.cppType must be a qualified C++ identifier`);
    }
    const header = relativeSourcePath(record.header, `${label}.header`);
    if (!Array.isArray(record.includeDirs) || record.includeDirs.length === 0) {
      throw new Error(`${label}.includeDirs must be a non-empty array`);
    }
    const includeDirs = record.includeDirs.map((entry, includeIndex) =>
      relativeSourcePath(entry, `${label}.includeDirs[${includeIndex}]`, { allowParent: true }));
    if (new Set(includeDirs).size !== includeDirs.length) {
      throw new Error(`${label}.includeDirs must not contain duplicates`);
    }
    const canonicalIncludeDirectories = await Promise.all(includeDirs.map((entry, includeIndex) =>
      requireAllowedDirectory(browserRoot, entry, canonicalAllowedRoots, `${label}.includeDirs[${includeIndex}]`)));
    await requireHeader(header, canonicalIncludeDirectories, canonicalAllowedRoots, `${label}.header`);

    apps.push({
      appId,
      displayName: nonemptyString(record.displayName, `${label}.displayName`),
      author: nonemptyString(record.author, `${label}.author`),
      category: nonemptyString(record.category, `${label}.category`),
      header,
      cppType,
      includeDirs,
    });
  }
  apps.sort((left, right) => left.appId < right.appId ? -1 : left.appId > right.appId ? 1 : 0);
  const canonical = { schemaVersion: 1, publisher, apps };
  const digest = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return deepFreeze({ ...canonical, digest });
}
