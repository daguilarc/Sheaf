import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import {
  SUPPORTED_BROWSER_ABI_VERSION,
  SUPPORTED_RUNTIME_CONFIG_VERSION,
  SUPPORTED_UI_PROTOCOL_VERSION,
} from "./protocol.js";

const REQUIRED_ARTIFACT_ROLES = Object.freeze([
  "entry",
  "wasm",
  "pthreadWorker",
  "wasmWorker",
  "audioWorklet",
]);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/;

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function packagePath(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a nonempty relative package path`);
  if (value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value))
    throw new Error(`${label} must be a normalized relative package path`);
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || !PATH_SEGMENT_PATTERN.test(segment)))
    throw new Error(`${label} must be a normalized relative package path within the package root`);
  if (path.posix.normalize(value) !== value) throw new Error(`${label} must be a normalized relative package path`);
  return value;
}

function mediaTypeFor(relativePath) {
  if (relativePath.endsWith(".wasm")) return "application/wasm";
  if (relativePath.endsWith(".js") || relativePath.endsWith(".mjs")) return "text/javascript";
  return "application/octet-stream";
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function inventoryDirectory(sourceDirectory) {
  const files = [];
  async function visit(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      const relativePath = packagePath(prefix ? `${prefix}/${entry.name}` : entry.name, "emitted artifact path");
      const metadata = await lstat(filename);
      if (metadata.isSymbolicLink()) throw new Error(`emitted artifact ${relativePath} is an unsafe symbolic link`);
      if (metadata.isDirectory()) {
        await visit(filename, relativePath);
        continue;
      }
      if (!metadata.isFile()) throw new Error(`emitted artifact ${relativePath} is not a regular file`);
      const bytes = await readFile(filename);
      files.push(Object.freeze({
        relativePath,
        filename,
        mediaType: mediaTypeFor(relativePath),
        size: bytes.byteLength,
        sha256: sha256(bytes),
      }));
    }
  }
  await visit(sourceDirectory, "");
  if (files.length === 0) throw new Error("emission directory contains no package artifacts");
  return files;
}

function validateArtifactRoles(artifacts, filesByPath) {
  if (artifacts === null || typeof artifacts !== "object" || Array.isArray(artifacts))
    throw new Error("artifacts must declare every required Emscripten role");
  const normalized = {};
  for (const role of REQUIRED_ARTIFACT_ROLES) {
    if (!Object.hasOwn(artifacts, role)) throw new Error(`artifacts.${role} is required`);
    const relativePath = packagePath(artifacts[role], `artifacts.${role}`);
    if (!filesByPath.has(relativePath)) throw new Error(`artifacts.${role} target ${relativePath} is not an inventoried package file`);
    normalized[role] = relativePath;
  }
  for (const role of Object.keys(artifacts)) {
    if (!REQUIRED_ARTIFACT_ROLES.includes(role)) throw new Error(`artifacts contains unknown role ${role}`);
  }
  return Object.freeze(normalized);
}

function contentBuildId(files) {
  const digest = createHash("sha256");
  digest.update("sheaf-browser-package-v1\0");
  for (const file of files) {
    digest.update(file.relativePath);
    digest.update("\0");
    digest.update(file.mediaType);
    digest.update("\0");
    digest.update(String(file.size));
    digest.update("\0");
    digest.update(file.sha256);
    digest.update("\0");
  }
  return digest.digest("hex");
}

/**
 * Inventories a dedicated Emscripten emission directory and copies its entire
 * regular-file tree into an immutable packages/<app-id>/<build-id>/ directory.
 * Required roles may alias one emitted file, as current Emscripten builds reuse
 * the entry module for pthread, Wasm-worker, and AudioWorklet bootstrapping.
 */
export async function assemblePackage({ appId, sourceDirectory, outputDirectory, artifacts }) {
  if (typeof appId !== "string" || !ID_PATTERN.test(appId))
    throw new Error("appId must contain lowercase ASCII letters, digits, and single hyphens between segments");
  if (typeof sourceDirectory !== "string" || sourceDirectory.length === 0) throw new Error("sourceDirectory is required");
  if (typeof outputDirectory !== "string" || outputDirectory.length === 0) throw new Error("outputDirectory is required");

  const sourceRoot = await realpath(sourceDirectory);
  const resolvedOutput = path.resolve(outputDirectory);
  if (resolvedOutput === sourceRoot || resolvedOutput.startsWith(`${sourceRoot}${path.sep}`))
    throw new Error("outputDirectory must be outside the dedicated emission directory");

  const files = await inventoryDirectory(sourceRoot);
  const filesByPath = new Map(files.map((file) => [file.relativePath, file]));
  const names = new Map();
  for (const file of files) {
    const basename = path.posix.basename(file.relativePath);
    const previous = names.get(basename);
    if (previous) throw new Error(`ambiguous emitted filename ${basename}: ${previous} and ${file.relativePath}`);
    names.set(basename, file.relativePath);
  }
  const roles = validateArtifactRoles(artifacts, filesByPath);
  if (filesByPath.get(roles.entry).mediaType !== "text/javascript") throw new Error("artifacts.entry must name a JavaScript module");
  if (filesByPath.get(roles.wasm).mediaType !== "application/wasm") throw new Error("artifacts.wasm must name a WASM binary");

  const buildId = contentBuildId(files);
  const packagePrefix = `packages/${appId}/${buildId}`;
  const packageRoot = path.join(resolvedOutput, "packages", appId, buildId);
  await Promise.all(files.map(async (file) => {
    const destination = path.resolve(packageRoot, ...file.relativePath.split("/"));
    if (!destination.startsWith(`${packageRoot}${path.sep}`)) throw new Error(`artifact path ${file.relativePath} escapes package root`);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(file.filename, destination);
  }));

  return Object.freeze({
    appId,
    buildId,
    browser: Object.freeze({
      abiVersion: SUPPORTED_BROWSER_ABI_VERSION,
      uiProtocolVersion: SUPPORTED_UI_PROTOCOL_VERSION,
      runtimeConfigVersion: SUPPORTED_RUNTIME_CONFIG_VERSION,
      entry: `${packagePrefix}/${roles.entry}`,
      files: Object.freeze(files.map((file) => Object.freeze({
        path: `${packagePrefix}/${file.relativePath}`,
        mediaType: file.mediaType,
        sha256: file.sha256,
      }))),
    }),
  });
}

export { REQUIRED_ARTIFACT_ROLES };
