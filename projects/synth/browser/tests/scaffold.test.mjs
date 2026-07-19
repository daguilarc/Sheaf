import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("browser scaffold test runner is active", () => {
  assert.equal(typeof globalThis, "object");
});

test("playwright discovers only browser specs", async () => {
  const browserRoot = await findBrowserRoot();
  const config = await readFile(path.join(browserRoot, "playwright.config.mjs"), "utf8");
  assert.match(config, /testMatch:\s*"\*\*\/\*\.spec\.ts"/);
});

test("fake and miniapp builds cannot race the rollback app alias", async () => {
  const makefile = await readBrowserMakefile();
  const appAliasCopies = makefile.match(/cp \$\(BROWSER_BUILD_DIR\)\/[^\s]+ \$\(BROWSER_BUILD_DIR\)\/app\.js/g) ?? [];
  assert.deepEqual(appAliasCopies, [
    "cp $(BROWSER_BUILD_DIR)/miniapp.js $(BROWSER_BUILD_DIR)/app.js",
  ]);
});

test("emscripten runtime facade exports string and persistence helpers", async () => {
  const makefile = await readBrowserMakefile();
  assert.match(makefile, /EXPORTED_RUNTIME_METHODS := '\["stringToUTF8","lengthBytesUTF8","FS","IDBFS","HEAPU8","HEAPF32"\]'/);
  assert.match(makefile, /FILESYSTEM_FLAGS := -lidbfs\.js/);
  assert.equal((makefile.match(/-sEXPORTED_RUNTIME_METHODS=\$\(EXPORTED_RUNTIME_METHODS\)/g) ?? []).length, 2);
});

test("emscripten exports pre-creation browser contract version functions", async () => {
  const makefile = await readBrowserMakefile();
  for (const name of [
    "_synth_browser_abi_version",
    "_synth_browser_ui_protocol_version",
    "_synth_browser_runtime_config_version",
  ]) {
    assert.match(makefile, new RegExp(`\\"${name}\\"`));
  }
});

test("emscripten browser builds enable pthreads for engine midi sender", async () => {
  const makefile = await readBrowserMakefile();
  assert.match(makefile, /PTHREAD_FLAGS := -pthread -sUSE_PTHREADS=1 -sPTHREAD_POOL_SIZE=1 -sINITIAL_MEMORY=268435456 -sSTACK_SIZE=16777216/);
  assert.equal((makefile.match(/\$\(PTHREAD_FLAGS\)/g) ?? []).length, 2);
});

test("cloudflare pages build script bootstraps emscripten before publishing", async () => {
  const browserRoot = await findBrowserRoot();
  const packageJson = JSON.parse(await readFile(path.join(browserRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["build:cloudflare-pages"], "bash scripts/cloudflare-pages-build.sh");

  const script = await readFile(path.join(browserRoot, "scripts/cloudflare-pages-build.sh"), "utf8");
  assert.match(script, /emsdk" install latest/);
  assert.match(script, /emsdk" activate latest/);
  assert.match(script, /make .*browser-fake-app browser-miniapp/);
  assert.match(script, /npm .*run publish:site/);

  const makefile = await readBrowserMakefile();
  assert.match(makefile, /browser-miniapp-smoke:[\s\S]*npm run publish:site[\s\S]*tests\/miniapp-smoke\.spec\.ts/);
  assert.equal(packageJson.scripts["publish:site"], "npm run build && node dist/src/publish-site.mjs");
});

async function readBrowserMakefile() {
  return await readFile(path.join(await findBrowserRoot(), "Makefile"), "utf8");
}

async function findBrowserRoot() {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      await readFile(path.join(directory, "Makefile"), "utf8");
      return directory;
    } catch (error) {
      if (path.dirname(directory) === directory) {
        throw error;
      }
      directory = path.dirname(directory);
    }
  }
}
