import type { CatalogApp, CatalogFile } from "./catalog.js";

/**
 * Serializable mappings passed through RuntimeCommand/postMessage. Despite its
 * callback-like name, locateFile is a normalized requested-path to object-URL
 * record; loadEmscriptenRuntime alone turns it into Emscripten's callback.
 */
export type MaterializedRuntimeModule = Readonly<{
  entryUrl: string;
  locateFile: Readonly<Record<string, string>>;
  mainScriptUrlOrBlob: string;
}>;

export type MaterializedPackage = MaterializedRuntimeModule & Readonly<{
  dispose(): void;
}>;

export type PackageFetcher = (url: string, init: RequestInit) => Promise<Response>;

export type ObjectUrlPrimitives = Readonly<{
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}>;

const defaultObjectUrls: ObjectUrlPrimitives = Object.freeze({
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
});

const MATERIALIZED_PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;

export function normalizeMaterializedPath(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/") || value.includes("\\") || value.includes("?") || value.includes("#"))
    throw new Error(`${label} is not a normalized package-relative path`);
  const normalized = value.startsWith("./") ? value.slice(2) : value;
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || !MATERIALIZED_PATH_SEGMENT.test(segment)))
    throw new Error(`${label} is not a normalized package-relative path`);
  return normalized;
}

function packageRelativePaths(app: CatalogApp): ReadonlyMap<CatalogFile, string> {
  const prefix = `packages/${app.appId}/${app.buildId}/`;
  if (!app.browser.entry.startsWith(prefix))
    throw new Error(`package entry ${app.browser.entry} is outside immutable package root ${prefix}`);
  const paths = new Map<CatalogFile, string>();
  const seen = new Set<string>();
  const basenames = new Map<string, string>();
  for (const file of app.browser.files) {
    if (!file.path.startsWith(prefix)) throw new Error(`package file ${file.path} is outside immutable package root ${prefix}`);
    const relative = normalizeMaterializedPath(file.path.slice(prefix.length), `package file ${file.path}`);
    if (seen.has(relative)) throw new Error(`duplicate package file ${relative}`);
    seen.add(relative);
    const basename = relative.slice(relative.lastIndexOf("/") + 1);
    const previous = basenames.get(basename);
    if (previous !== undefined && previous !== relative)
      throw new Error(`ambiguous package filename ${basename}: ${previous} and ${relative}`);
    basenames.set(basename, relative);
    paths.set(file, relative);
  }
  if (!app.browser.files.some((file) => file.path === app.browser.entry))
    throw new Error(`package entry ${app.browser.entry} is not declared`);
  return paths;
}

function mediaTypeEssence(response: Response): string {
  return (response.headers.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
}

const IMPORT_META_SIDECAR = /new\s+URL\(\s*(["'])([^"']+)\1\s*,\s*import\.meta\.url\s*\)/g;

function rewriteImportMetaSidecars(source: string, mappings: Readonly<Record<string, string>>): string {
  return source.replace(IMPORT_META_SIDECAR, (_expression, _quote, requestedPath: string) => {
    const normalized = normalizeMaterializedPath(requestedPath, `Emscripten import-meta sidecar ${requestedPath}`);
    const url = mappings[normalized];
    if (!url) throw new Error(`Emscripten import-meta sidecar ${requestedPath} was not materialized`);
    return `new URL(${JSON.stringify(url)})`;
  });
}

async function verifiedBytes(file: CatalogFile, fetcher: PackageFetcher): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetcher(file.url, { mode: "cors", credentials: "omit" });
  } catch (error) {
    throw new Error(`package file ${file.path} fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`package file ${file.path} returned HTTP ${response.status}`);
  const actualMediaType = mediaTypeEssence(response);
  if (actualMediaType !== file.mediaType)
    throw new Error(`package file ${file.path} media type ${actualMediaType || "<missing>"}; expected ${file.mediaType}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== file.size)
    throw new Error(`package file ${file.path} size ${bytes.byteLength}; expected ${file.size}`);
  const contentLength = response.headers.get("Content-Length");
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) throw new Error(`package file ${file.path} has invalid Content-Length ${contentLength}`);
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength)) throw new Error(`package file ${file.path} has invalid Content-Length ${contentLength}`);
    // Fetch decodes transfer content encodings before arrayBuffer(); this valid
    // header may describe compressed transfer bytes, so SHA-256 is authoritative.
  }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  if (digest !== file.sha256)
    throw new Error(`package file ${file.path} SHA-256 mismatch: expected ${file.sha256}, received ${digest}`);
  return bytes;
}

export async function materializePackage(
  app: CatalogApp,
  fetcher: PackageFetcher = (url, init) => fetch(url, init),
  objectUrls: ObjectUrlPrimitives = defaultObjectUrls,
): Promise<MaterializedPackage> {
  const relativePaths = packageRelativePaths(app);
  const verified = await Promise.all(app.browser.files.map(async (file) => ({
    file,
    relativePath: relativePaths.get(file)!,
    bytes: await verifiedBytes(file, fetcher),
  })));

  const urls: string[] = [];
  try {
    const materialized = verified.map(({ file, relativePath, bytes }) => {
      const url = objectUrls.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: file.mediaType }));
      urls.push(url);
      return { file, relativePath, url };
    });
    const entry = materialized.find(({ file }) => file.path === app.browser.entry);
    if (!entry) throw new Error(`package entry ${app.browser.entry} was not materialized`);
    const mappings: Record<string, string> = {};
    for (const file of materialized) {
      mappings[file.relativePath] = file.url;
      const basename = file.relativePath.slice(file.relativePath.lastIndexOf("/") + 1);
      mappings[basename] = file.url;
    }
    let entryUrl = entry.url;
    const verifiedEntry = verified.find(({ file }) => file.path === app.browser.entry)!;
    if (entry.file.mediaType !== "text/javascript") throw new Error(`package entry ${app.browser.entry} must be text/javascript`);
    const source = new TextDecoder("utf-8", { fatal: true }).decode(verifiedEntry.bytes);
    const rewrittenSource = rewriteImportMetaSidecars(source, mappings);
    if (rewrittenSource !== source) {
      entryUrl = objectUrls.createObjectURL(new Blob([rewrittenSource], { type: entry.file.mediaType }));
      urls.push(entryUrl);
    }
    let disposed = false;
    return Object.freeze({
      entryUrl,
      locateFile: Object.freeze(mappings),
      // Keep the original verified entry blob here even when entryUrl is rewritten;
      // Emscripten's pthread/worker sidecars resolve through the explicit locateFile map.
      mainScriptUrlOrBlob: entry.url,
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const url of urls) objectUrls.revokeObjectURL(url);
      },
    });
  } catch (error) {
    for (const url of urls) objectUrls.revokeObjectURL(url);
    throw error;
  }
}
