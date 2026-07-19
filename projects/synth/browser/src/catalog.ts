import {
  SUPPORTED_BROWSER_ABI_VERSION,
  SUPPORTED_RUNTIME_CONFIG_VERSION,
  SUPPORTED_UI_PROTOCOL_VERSION,
} from "./protocol.js";

export {
  SUPPORTED_BROWSER_ABI_VERSION,
  SUPPORTED_RUNTIME_CONFIG_VERSION,
  SUPPORTED_UI_PROTOCOL_VERSION,
};
export const SUPPORTED_CATALOG_SCHEMA_VERSION = 1;

export const SUPPORTED_PACKAGE_MEDIA_TYPES = [
  "text/javascript",
  "application/wasm",
  "application/octet-stream",
] as const;

export type CatalogSource = Readonly<{ catalogUrl: string }>;
export type CatalogPublisher = Readonly<{ id: string; name: string }>;
export type CatalogFile = Readonly<{
  path: string;
  url: string;
  mediaType: typeof SUPPORTED_PACKAGE_MEDIA_TYPES[number];
  sha256: string;
}>;
export type CatalogBrowserPackage = Readonly<{
  abiVersion: number;
  uiProtocolVersion: number;
  runtimeConfigVersion: number;
  entry: string;
  entryUrl: string;
  files: readonly CatalogFile[];
}>;
export type BrowserRuntimeIdentity = Readonly<{
  publisherId: string;
  appId: string;
  runtimeConfigVersion: number;
}>;
export type CatalogApp = Readonly<{
  globalId: string;
  catalogUrl: string;
  publisher: CatalogPublisher;
  appId: string;
  displayName: string;
  author: string;
  category: string;
  buildId: string;
  browser: CatalogBrowserPackage;
}>;
export type Catalog = Readonly<{
  schemaVersion: number;
  catalogVersion: string;
  catalogUrl: string;
  publisher: CatalogPublisher;
  apps: readonly CatalogApp[];
}>;
export type DuplicateAppDiagnostic = Readonly<{
  code: "duplicate-app";
  globalId: string;
  acceptedCatalogUrl: string;
  rejectedCatalogUrl: string;
}>;
export type CatalogRegistry = Readonly<{
  apps: readonly CatalogApp[];
  diagnostics: readonly DuplicateAppDiagnostic[];
}>;

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/;

function fail(path: string, detail: string): never {
  throw new Error(`${path}: ${detail}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "expected object");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(path, `unknown field ${key}`);
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "missing field");
  }
}

function exactVersion(value: unknown, supported: number, path: string): number {
  if (value !== supported) fail(path, `unsupported version ${String(value)}; supported version is ${supported}`);
  return supported;
}

function boundedString(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== "string") fail(path, "expected string");
  if (value.length === 0 || value.length > maxLength) fail(path, `must contain 1-${maxLength} characters`);
  if (value.trim() !== value) fail(path, "must be trimmed");
  return value;
}

function identifier(value: unknown, path: string): string {
  const parsed = boundedString(value, path, 200);
  if (!ID_PATTERN.test(parsed)) fail(path, "must contain lowercase ASCII letters, digits, and single hyphens between segments");
  return parsed;
}

export function validateBrowserRuntimeIdentity(value: unknown): BrowserRuntimeIdentity {
  const input = record(value, "runtime identity");
  exactKeys(input, ["publisherId", "appId", "runtimeConfigVersion"], "runtime identity");
  return Object.freeze({
    publisherId: identifier(input.publisherId, "runtime identity.publisherId"),
    appId: identifier(input.appId, "runtime identity.appId"),
    runtimeConfigVersion: exactVersion(
      input.runtimeConfigVersion,
      SUPPORTED_RUNTIME_CONFIG_VERSION,
      "runtime identity.runtimeConfigVersion",
    ),
  });
}

export function runtimeIdentityForCatalogApp(
  app: Pick<CatalogApp, "publisher" | "appId" | "browser">,
): BrowserRuntimeIdentity {
  return validateBrowserRuntimeIdentity({
    publisherId: app.publisher.id,
    appId: app.appId,
    runtimeConfigVersion: app.browser.runtimeConfigVersion,
  });
}

function httpsUrl(value: unknown, path: string): string {
  const text = boundedString(value, path, 2048);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    fail(path, "must be an absolute HTTPS URL");
  }
  if (parsed.protocol !== "https:") fail(path, "must be an HTTPS URL");
  if (parsed.hash !== "") fail(path, "must not contain a fragment");
  if (parsed.username !== "" || parsed.password !== "") fail(path, "must not contain credentials");
  return parsed.href;
}

function relativePath(value: unknown, path: string): string {
  const parsed = boundedString(value, path, 2048);
  if (parsed.includes("\\") || parsed.includes("%") || parsed.includes("?") || parsed.includes("#") || parsed.includes(":"))
    fail(path, "must be a plain relative package path");
  const segments = parsed.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || !PATH_SEGMENT_PATTERN.test(segment)))
    fail(path, "must be a normalized relative package path without traversal");
  return parsed;
}

function resolvePath(path: string, catalogUrl: string): string {
  return new URL(path, catalogUrl).href;
}

export function parseCatalogSources(value: unknown): readonly CatalogSource[] {
  if (!Array.isArray(value) || value.length === 0) fail("catalog sources", "expected a nonempty array");
  const seen = new Set<string>();
  const sources = value.map((source, index) => {
    const catalogUrl = httpsUrl(source, `catalog sources[${index}]`);
    if (seen.has(catalogUrl)) fail(`catalog sources[${index}]`, `duplicate catalog URL ${catalogUrl}`);
    seen.add(catalogUrl);
    return Object.freeze({ catalogUrl });
  });
  return Object.freeze(sources);
}

function parsePublisher(value: unknown): CatalogPublisher {
  const input = record(value, "catalog.publisher");
  exactKeys(input, ["id", "name"], "catalog.publisher");
  return Object.freeze({
    id: identifier(input.id, "catalog.publisher.id"),
    name: boundedString(input.name, "catalog.publisher.name", 200),
  });
}

function parseFile(value: unknown, path: string, catalogUrl: string): CatalogFile {
  const input = record(value, path);
  exactKeys(input, ["path", "mediaType", "sha256"], path);
  const packagePath = relativePath(input.path, `${path}.path`);
  if (typeof input.mediaType !== "string" || !SUPPORTED_PACKAGE_MEDIA_TYPES.includes(input.mediaType as never))
    fail(`${path}.mediaType`, `unsupported media type ${String(input.mediaType)}`);
  if (typeof input.sha256 !== "string" || !SHA256_PATTERN.test(input.sha256))
    fail(`${path}.sha256`, "must be 64 lowercase hexadecimal characters");
  return Object.freeze({
    path: packagePath,
    url: resolvePath(packagePath, catalogUrl),
    mediaType: input.mediaType as CatalogFile["mediaType"],
    sha256: input.sha256,
  });
}

function parseBrowserPackage(value: unknown, path: string, catalogUrl: string): CatalogBrowserPackage {
  const input = record(value, path);
  exactKeys(input, ["abiVersion", "uiProtocolVersion", "runtimeConfigVersion", "entry", "files"], path);
  const entry = relativePath(input.entry, `${path}.entry`);
  if (!Array.isArray(input.files) || input.files.length === 0) fail(`${path}.files`, "expected a nonempty array");
  const files = input.files.map((file, index) => parseFile(file, `${path}.files[${index}]`, catalogUrl));
  const seenPaths = new Set<string>();
  for (const file of files) {
    if (seenPaths.has(file.path)) fail(`${path}.files`, `duplicate file path ${file.path}`);
    seenPaths.add(file.path);
  }
  const entryFile = files.find((file) => file.path === entry);
  if (!entryFile) fail(`${path}.entry`, "entry must name a declared file");
  if (entryFile.mediaType !== "text/javascript") fail(`${path}.entry`, "entry must name a text/javascript file");
  return Object.freeze({
    abiVersion: exactVersion(input.abiVersion, SUPPORTED_BROWSER_ABI_VERSION, `${path}.abiVersion`),
    uiProtocolVersion: exactVersion(input.uiProtocolVersion, SUPPORTED_UI_PROTOCOL_VERSION, `${path}.uiProtocolVersion`),
    runtimeConfigVersion: exactVersion(input.runtimeConfigVersion, SUPPORTED_RUNTIME_CONFIG_VERSION, `${path}.runtimeConfigVersion`),
    entry,
    entryUrl: entryFile.url,
    files: Object.freeze(files),
  });
}

function parseApp(value: unknown, index: number, publisher: CatalogPublisher, catalogUrl: string): CatalogApp {
  const path = `catalog.apps[${index}]`;
  const input = record(value, path);
  exactKeys(input, ["appId", "displayName", "author", "category", "buildId", "browser"], path);
  const appId = identifier(input.appId, `${path}.appId`);
  return Object.freeze({
    globalId: `${publisher.id}/${appId}`,
    catalogUrl,
    publisher,
    appId,
    displayName: boundedString(input.displayName, `${path}.displayName`, 200),
    author: boundedString(input.author, `${path}.author`, 200),
    category: boundedString(input.category, `${path}.category`, 200),
    buildId: identifier(input.buildId, `${path}.buildId`),
    browser: parseBrowserPackage(input.browser, `${path}.browser`, catalogUrl),
  });
}

export function parseCatalog(value: unknown, catalogUrl: string): Catalog {
  const resolvedCatalogUrl = httpsUrl(catalogUrl, "catalogUrl");
  const input = record(value, "catalog");
  exactKeys(input, ["schemaVersion", "catalogVersion", "publisher", "apps"], "catalog");
  const schemaVersion = exactVersion(input.schemaVersion, SUPPORTED_CATALOG_SCHEMA_VERSION, "catalog.schemaVersion");
  const catalogVersion = boundedString(input.catalogVersion, "catalog.catalogVersion", 128);
  const publisher = parsePublisher(input.publisher);
  if (!Array.isArray(input.apps) || input.apps.length === 0) fail("catalog.apps", "expected a nonempty array");
  const apps = input.apps.map((entry, index) => parseApp(entry, index, publisher, resolvedCatalogUrl));
  const seenAppIds = new Set<string>();
  for (const app of apps) {
    if (seenAppIds.has(app.appId)) fail("catalog.apps", `duplicate appId ${app.appId}`);
    seenAppIds.add(app.appId);
  }
  return Object.freeze({
    schemaVersion,
    catalogVersion,
    catalogUrl: resolvedCatalogUrl,
    publisher,
    apps: Object.freeze(apps),
  });
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function mergeCatalogs(catalogs: readonly Catalog[]): CatalogRegistry {
  const accepted = new Map<string, CatalogApp>();
  const diagnostics: DuplicateAppDiagnostic[] = [];
  for (const catalog of catalogs) {
    for (const app of catalog.apps) {
      const previous = accepted.get(app.globalId);
      if (previous) {
        diagnostics.push(Object.freeze({
          code: "duplicate-app",
          globalId: app.globalId,
          acceptedCatalogUrl: previous.catalogUrl,
          rejectedCatalogUrl: app.catalogUrl,
        }));
      } else {
        accepted.set(app.globalId, app);
      }
    }
  }
  const apps = [...accepted.values()].sort((left, right) =>
    codeUnitCompare(left.displayName, right.displayName) || codeUnitCompare(left.globalId, right.globalId));
  return Object.freeze({ apps: Object.freeze(apps), diagnostics: Object.freeze(diagnostics) });
}
