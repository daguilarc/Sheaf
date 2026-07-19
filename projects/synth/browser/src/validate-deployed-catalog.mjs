import { createHash } from "node:crypto";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/;
const MEDIA_TYPES = new Set(["text/javascript", "application/wasm", "application/octet-stream"]);

function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value))
    throw new Error(`${label} must be a lowercase ASCII identifier`);
  return value;
}

function relativePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("%") ||
      value.includes("?") || value.includes("#") || value.includes(":"))
    throw new Error(`${label} must be a normalized relative package path`);
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || !PATH_SEGMENT_PATTERN.test(segment)))
    throw new Error(`${label} must be a normalized relative package path`);
  return value;
}

function mediaTypeEssence(response) {
  return (response.headers.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
}

function requireCors(response, label) {
  const origin = response.headers.get("Access-Control-Allow-Origin");
  if (origin?.trim() !== "*")
    throw new Error(`${label} is not publicly CORS-readable: expected Access-Control-Allow-Origin: *`);
}

async function fetchReadable(url, label, expectedMediaType, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { mode: "cors", credentials: "omit", cache: "no-store" });
  } catch (error) {
    throw new Error(`${label} fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  requireCors(response, label);
  const actualMediaType = mediaTypeEssence(response);
  if (actualMediaType !== expectedMediaType)
    throw new Error(`${label} media type ${actualMediaType || "<missing>"}; expected ${expectedMediaType}`);
  return new Uint8Array(await response.arrayBuffer());
}

function parseFiles(app, catalogUrl) {
  const browser = record(app.browser, `app ${app.appId}.browser`);
  if (!Array.isArray(browser.files) || browser.files.length === 0)
    throw new Error(`app ${app.appId}.browser.files must be a nonempty array`);
  const prefix = `packages/${app.appId}/${app.buildId}/`;
  const seen = new Set();
  const files = browser.files.map((value, index) => {
    const file = record(value, `app ${app.appId} file ${index}`);
    const filePath = relativePath(file.path, `app ${app.appId} file ${index} path`);
    if (!filePath.startsWith(prefix))
      throw new Error(`package reference ${filePath} is outside immutable package root ${prefix}`);
    if (seen.has(filePath)) throw new Error(`duplicate package reference ${filePath}`);
    seen.add(filePath);
    if (!MEDIA_TYPES.has(file.mediaType)) throw new Error(`package file ${filePath} has unsupported media type ${String(file.mediaType)}`);
    if (!Number.isSafeInteger(file.size) || file.size < 0)
      throw new Error(`package file ${filePath} size must be a nonnegative safe integer`);
    if (typeof file.sha256 !== "string" || !SHA256_PATTERN.test(file.sha256))
      throw new Error(`package file ${filePath} SHA-256 must be 64 lowercase hexadecimal characters`);
    return { path: filePath, url: new URL(filePath, catalogUrl).href, mediaType: file.mediaType, size: file.size, sha256: file.sha256 };
  });
  const entry = relativePath(browser.entry, `app ${app.appId} entry`);
  const entryFile = files.find((file) => file.path === entry);
  if (!entryFile) throw new Error(`package entry ${entry} is not a declared package reference`);
  if (entryFile.mediaType !== "text/javascript") throw new Error(`package entry ${entry} must be text/javascript`);
  return files;
}

export async function validateDeployedCatalog({ catalogUrl, expectedBuildId, fetchImpl = fetch } = {}) {
  if (typeof catalogUrl !== "string" || catalogUrl.length === 0) throw new Error("catalogUrl is required");
  const parsedUrl = new URL(catalogUrl);
  const loopback = parsedUrl.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsedUrl.hostname);
  if (parsedUrl.protocol !== "https:" && !loopback) throw new Error("catalogUrl must use HTTPS (loopback HTTP is allowed for tests)");
  identifier(expectedBuildId, "expected build ID");

  const catalogBytes = await fetchReadable(parsedUrl.href, "catalog", "application/json", fetchImpl);
  let catalog;
  try {
    catalog = record(JSON.parse(new TextDecoder().decode(catalogBytes)), "catalog");
  } catch (error) {
    throw new Error(`catalog JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (catalog.schemaVersion !== 1) throw new Error(`catalog schema version ${String(catalog.schemaVersion)} is unsupported`);
  if (!Array.isArray(catalog.apps) || catalog.apps.length === 0) throw new Error("catalog apps must be a nonempty array");
  const apps = catalog.apps.map((value, index) => {
    const app = record(value, `catalog app ${index}`);
    identifier(app.appId, `catalog app ${index} appId`);
    identifier(app.buildId, `catalog app ${index} build ID`);
    return { ...app, files: parseFiles(app, parsedUrl.href) };
  });
  const deployedBuildIds = apps.map(({ buildId }) => buildId);
  if (!deployedBuildIds.includes(expectedBuildId))
    throw new Error(`expected build ID ${expectedBuildId}; deployed catalog contains ${deployedBuildIds.join(", ")}`);

  let fileCount = 0;
  let wasmCount = 0;
  await Promise.all(apps.flatMap((app) => app.files.map(async (file) => {
    const bytes = await fetchReadable(file.url, `package file ${file.path}`, file.mediaType, fetchImpl);
    if (bytes.byteLength !== file.size)
      throw new Error(`package file ${file.path} size ${bytes.byteLength}; expected ${file.size}`);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== file.sha256)
      throw new Error(`package file ${file.path} SHA-256 mismatch: expected ${file.sha256}, received ${digest}`);
    if (file.mediaType === "application/wasm") {
      if (!file.path.endsWith(".wasm")) throw new Error(`package file ${file.path} declares application/wasm without a .wasm path`);
      wasmCount += 1;
    }
    fileCount += 1;
  })));
  if (wasmCount === 0) throw new Error("deployed catalog contains no application/wasm package response");
  return { catalogUrl: parsedUrl.href, expectedBuildId, appCount: apps.length, fileCount };
}

function commandLineArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!["--catalog-url", "--expected-build-id"].includes(name) || value === undefined)
      throw new Error("usage: validate-deployed-catalog.mjs --catalog-url <url> --expected-build-id <id>");
    if (values.has(name)) throw new Error(`duplicate argument ${name}`);
    values.set(name, value);
  }
  return { catalogUrl: values.get("--catalog-url"), expectedBuildId: values.get("--expected-build-id") };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await validateDeployedCatalog(commandLineArguments(process.argv.slice(2)));
  console.log(`Validated ${result.catalogUrl} at build ${result.expectedBuildId}: ${result.appCount} apps, ${result.fileCount} files`);
}
