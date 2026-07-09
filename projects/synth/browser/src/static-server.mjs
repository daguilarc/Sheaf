import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const browserRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staticRoots = new Map([
  ["/dist/", path.join(browserRoot, "dist")],
  ["/public/", path.join(browserRoot, "public")],
]);

export function contentTypeForPath(filename) {
  if (filename.endsWith(".wasm")) return "application/wasm";
  if (filename.endsWith(".js") || filename.endsWith(".mjs")) return "text/javascript";
  if (filename.endsWith(".html")) return "text/html; charset=utf-8";
  if (filename.endsWith(".css")) return "text/css; charset=utf-8";
  if (filename.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function staticFileFor(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl ?? "/", "http://localhost").pathname);
  } catch {
    return undefined;
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

export function createStaticServer({ isolated = true } = {}) {
  return createServer(async (request, response) => {
    const filename = staticFileFor(request.url);
    if (!filename) {
      response.writeHead(404).end();
      return;
    }
    try {
      if (!(await stat(filename)).isFile()) throw new Error("not a file");
      const headers = { "Content-Type": contentTypeForPath(filename) };
      if (isolated) {
        headers["Cross-Origin-Opener-Policy"] = "same-origin";
        headers["Cross-Origin-Embedder-Policy"] = "require-corp";
        headers["Permissions-Policy"] = "midi=(self)";
      }
      response.writeHead(200, headers);
      createReadStream(filename).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createStaticServer().listen(4173, "127.0.0.1");
  createStaticServer().listen(4174, "127.0.0.1");
}
