import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const browserRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staticRoots = new Map([
  ["/dist/", path.join(browserRoot, "dist")],
  ["/packages/", path.join(browserRoot, "packages")],
  ["/public/", path.join(browserRoot, "public")],
]);
const publishedRoot = path.join(browserRoot, "dist", "site");

const packageFixtureWasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const packageFixtureEntry = Buffer.from(`export default async function createRemoteFake(options) {
  const wasmUrl = options.locateFile("remote-fake.wasm", import.meta.url);
  await WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer());
  globalThis.__synthTwoOriginFactory = {
    wasmUrl,
    mainScriptUrlOrBlob: options.mainScriptUrlOrBlob,
    entryOrigin: new URL(import.meta.url).origin,
  };
  const heap = new Uint8Array(1024);
  return {
    FS: { filesystems: { IDBFS: {} } },
    IDBFS: {},
    HEAPU8: heap,
    HEAPF32: new Float32Array(heap.buffer),
    _malloc: () => 8,
    _free: () => {},
    lengthBytesUTF8: value => new TextEncoder().encode(value).length,
    stringToUTF8: () => {},
    emscriptenRegisterAudioObject: () => 7,
    _synth_browser_abi_version: () => 4,
    _synth_browser_ui_protocol_version: () => 2,
    _synth_browser_runtime_config_version: () => 1,
    _synth_browser_create: () => 41,
    _synth_browser_set_timestamp_epoch_offset: () => 0,
    _synth_browser_audio_output_channels: () => 2,
    _synth_browser_audio_input_channels: () => 0,
    _synth_browser_start_audio_worklet: () => 0,
    _synth_browser_set_audio_input_source: () => 0,
    _synth_browser_clear_audio_input_source: () => 0,
    _synth_browser_consume_audio_input_retry: () => 0,
    _synth_browser_audio_worklet_block_count: () => 1,
    _synth_browser_audio_worklet_peak_microunits: () => 1,
    _synth_browser_audio_worklet_deadline_microunits: () => 1,
    _synth_browser_destroy: () => {},
  };
}
`);

function fixtureDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function packageFixture(request) {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname === "/package-fixture/remote-fake.js")
    return { bytes: packageFixtureEntry, contentType: "text/javascript" };
  if (pathname === "/package-fixture/remote-fake.wasm")
    return { bytes: packageFixtureWasm, contentType: "application/wasm" };
  if (pathname !== "/package-fixture/catalog.json") return undefined;
  const origin = `http://${request.headers.host ?? "127.0.0.1:4174"}`;
  const packageRoot = "packages/remote-fake/build-1";
  const files = [
    { name: "remote-fake.js", mediaType: "text/javascript", bytes: packageFixtureEntry },
    { name: "remote-fake.wasm", mediaType: "application/wasm", bytes: packageFixtureWasm },
  ].map(({ name, mediaType, bytes }) => ({
    path: `${packageRoot}/${name}`,
    url: `${origin}/package-fixture/${name}`,
    mediaType,
    size: bytes.byteLength,
    sha256: fixtureDigest(bytes),
  }));
  const bytes = Buffer.from(`${JSON.stringify({
    appId: "remote-fake",
    buildId: "build-1",
    browser: {
      abiVersion: 4,
      uiProtocolVersion: 2,
      runtimeConfigVersion: 1,
      entry: `${packageRoot}/remote-fake.js`,
      entryUrl: `${origin}/package-fixture/remote-fake.js`,
      files,
    },
  })}\n`);
  return { bytes, contentType: "application/json" };
}

export function contentTypeForPath(filename) {
  if (filename.endsWith(".wasm")) return "application/wasm";
  if (filename.endsWith(".js") || filename.endsWith(".mjs")) return "text/javascript";
  if (filename.endsWith(".html")) return "text/html; charset=utf-8";
  if (filename.endsWith(".css")) return "text/css; charset=utf-8";
  if (filename.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function staticFileFor(requestUrl, published) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl ?? "/", "http://localhost").pathname);
  } catch {
    return undefined;
  }
  if (published) {
    if (pathname === "/") pathname = "/index.html";
    if (pathname.includes("\0") || pathname.split("/").includes("..")) return undefined;
    const filename = path.resolve(publishedRoot, `.${pathname}`);
    if (filename === publishedRoot || !filename.startsWith(`${publishedRoot}${path.sep}`)) return undefined;
    return filename;
  }
  if (pathname === "/") pathname = "/public/index.html";
  if (pathname.includes("\0") || pathname.split("/").includes("..")) return undefined;
  for (const [prefix, root] of staticRoots) {
    if (!pathname.startsWith(prefix)) continue;
    const filename = path.resolve(root, `.${pathname.slice(prefix.length - 1)}`);
    if (filename === root || !filename.startsWith(`${root}${path.sep}`)) return undefined;
    return filename;
  }
  return undefined;
}

export function createStaticServer({ isolated = true, published = false } = {}) {
  return createServer(async (request, response) => {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
    };
    if (isolated) {
      headers["Cross-Origin-Opener-Policy"] = "same-origin";
      headers["Cross-Origin-Embedder-Policy"] = "require-corp";
      headers["Permissions-Policy"] = "midi=(self), microphone=(self)";
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, headers).end();
      return;
    }
    const fixture = packageFixture(request);
    if (fixture) {
      response.writeHead(200, {
        ...headers,
        "Content-Type": fixture.contentType,
        "Content-Length": fixture.bytes.byteLength,
      }).end(fixture.bytes);
      return;
    }
    const filename = staticFileFor(request.url, published);
    if (!filename) {
      response.writeHead(404, headers).end();
      return;
    }
    try {
      if (!(await stat(filename)).isFile()) throw new Error("not a file");
      response.writeHead(200, { ...headers, "Content-Type": contentTypeForPath(filename) });
      createReadStream(filename).pipe(response);
    } catch {
      response.writeHead(404, headers).end();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createStaticServer().listen(4173, "127.0.0.1");
  createStaticServer().listen(4174, "127.0.0.1");
  createStaticServer({ published: true }).listen(4175, "127.0.0.1");
}
