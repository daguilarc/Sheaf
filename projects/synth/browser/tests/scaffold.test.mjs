import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("browser scaffold test runner is active", () => {
  assert.equal(typeof globalThis, "object");
});

test("emscripten runtime facade exports string helpers", async () => {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  let makefile = "";
  for (;;) {
    try {
      makefile = await readFile(path.join(directory, "Makefile"), "utf8");
      break;
    } catch (error) {
      if (path.dirname(directory) === directory) {
        throw error;
      }
      directory = path.dirname(directory);
    }
  }
  assert.match(makefile, /EXPORTED_RUNTIME_METHODS := '\["stringToUTF8","lengthBytesUTF8"\]'/);
  assert.equal((makefile.match(/-sEXPORTED_RUNTIME_METHODS=\$\(EXPORTED_RUNTIME_METHODS\)/g) ?? []).length, 2);
});
