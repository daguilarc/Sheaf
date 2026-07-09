import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function serve(port, isolated) {
  return createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const filename = path.resolve(root, `.${pathname === "/" ? "/public/index.html" : pathname}`);
  if (!filename.startsWith(root + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if (!(await stat(filename)).isFile()) throw new Error("not a file");
    const headers = isolated ? {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    } : {};
    if (filename.endsWith(".js")) headers["Content-Type"] = "text/javascript";
    if (filename.endsWith(".html")) headers["Content-Type"] = "text/html; charset=utf-8";
    response.writeHead(200, headers);
    createReadStream(filename).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
  }).listen(port, "127.0.0.1");
}

serve(4173, false);
serve(4174, true);
