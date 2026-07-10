import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("browser scaffold test runner is active", () => {
  assert.equal(typeof globalThis, "object");
});

test("emscripten runtime facade exports string and persistence helpers", async () => {
  const makefile = await readBrowserMakefile();
  assert.match(makefile, /EXPORTED_RUNTIME_METHODS := '\["stringToUTF8","lengthBytesUTF8","FS","IDBFS","HEAPU8","HEAPF32"\]'/);
  assert.match(makefile, /FILESYSTEM_FLAGS := -lidbfs\.js/);
  assert.equal((makefile.match(/-sEXPORTED_RUNTIME_METHODS=\$\(EXPORTED_RUNTIME_METHODS\)/g) ?? []).length, 2);
});

test("emscripten browser builds enable pthreads for engine midi sender", async () => {
  const makefile = await readBrowserMakefile();
  assert.match(makefile, /PTHREAD_FLAGS := -pthread -sUSE_PTHREADS=1 -sPTHREAD_POOL_SIZE=1 -sINITIAL_MEMORY=268435456 -sSTACK_SIZE=16777216/);
  assert.equal((makefile.match(/\$\(PTHREAD_FLAGS\)/g) ?? []).length, 2);
});

async function readBrowserMakefile() {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      return await readFile(path.join(directory, "Makefile"), "utf8");
    } catch (error) {
      if (path.dirname(directory) === directory) {
        throw error;
      }
      directory = path.dirname(directory);
    }
  }
}
