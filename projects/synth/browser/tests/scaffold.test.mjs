import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
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

test("browser apps and the fixture use the same generic builder with no rollback alias", async () => {
  const makefile = await readBrowserMakefile();
  for (const target of ["browser-apps", "browser-fixture-app", "browser-apps-run", "browser-apps-smoke"]) {
    assert.match(makefile, new RegExp(`^${target}:`, "m"));
  }
  assert.equal((makefile.match(/dist\/src\/build-browser-apps\.mjs/g) ?? []).length, 2);
  assert.doesNotMatch(makefile, /browser-miniapp|browser-fake-app|dist\/wasm\/app\.js|miniapp_entry|fake_app_entry/);
  assert.match(makefile, /browser-fixture-app:[\s\S]*--output-root dist\/wasm\/fixture-apps/);
  assert.match(makefile, /browser-apps-smoke: browser-fixture-app\n\t\$\(MAKE\) browser-apps/);

  const browserRoot = await findBrowserRoot();
  await assert.rejects(access(path.join(browserRoot, "cpp", "miniapp_entry.cpp")));
  await assert.rejects(access(path.join(browserRoot, "cpp", "fake_app_entry.cpp")));
});

test("the full browser suite builds the isolated real-Wasm fixture before Playwright", async () => {
  const browserRoot = await findBrowserRoot();
  const packageJson = JSON.parse(await readFile(path.join(browserRoot, "package.json"), "utf8"));
  assert.match(packageJson.scripts.test, /make browser-fixture-app.*playwright test/);
});

test("emscripten runtime facade exports string and persistence helpers", async () => {
  const builder = await readBuilder();
  assert.match(builder, /"stringToUTF8", "lengthBytesUTF8", "FS", "IDBFS", "HEAPU8", "HEAPF32"/);
  assert.match(builder, /"emscriptenRegisterAudioObject"/);
  assert.match(builder, /"-lidbfs\.js"/);
});

test("emscripten exports pre-creation browser contract version functions", async () => {
  const makefile = await readBuilder();
  for (const name of [
    "_synth_browser_abi_version",
    "_synth_browser_ui_protocol_version",
    "_synth_browser_runtime_config_version",
  ]) {
    assert.match(makefile, new RegExp(`\\"${name}\\"`));
  }
});

test("emscripten exports browser ABI v4 audio input functions", async () => {
  const makefile = await readBuilder();
  for (const name of [
    "_synth_browser_audio_input_channels",
    "_synth_browser_set_audio_input_source",
    "_synth_browser_clear_audio_input_source",
    "_synth_browser_consume_audio_input_retry",
  ]) {
    assert.match(makefile, new RegExp(`\\"${name}\\"`));
  }
});

test("emscripten browser builds enable pthreads for engine midi sender", async () => {
  const builder = await readBuilder();
  for (const flag of [
    "-pthread",
    "-sUSE_PTHREADS=1",
    "-sPTHREAD_POOL_SIZE=1",
    "-sINITIAL_MEMORY=536870912",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sMAXIMUM_MEMORY=2147483648",
    "-sSTACK_SIZE=16777216",
    "-sAUDIO_WORKLET=1",
    "-sWASM_WORKERS=1",
  ]) {
    assert.ok(builder.includes(`"${flag}"`), `missing common compiler flag ${flag}`);
  }
});

test("cloudflare pages build script bootstraps emscripten before publishing", async () => {
  const browserRoot = await findBrowserRoot();
  const packageJson = JSON.parse(await readFile(path.join(browserRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["build:cloudflare-pages"], "bash scripts/cloudflare-pages-build.sh");

  const script = await readFile(path.join(browserRoot, "scripts/cloudflare-pages-build.sh"), "utf8");
  assert.match(script, /emsdk" install latest/);
  assert.match(script, /emsdk" activate latest/);
  assert.match(script, /npm .*run publish:site/);
  assert.match(script, /--catalog-source https:\/\/jvictor0\.github\.io\/Sheaf\/catalogs\/sheaf\/catalog\.json/);

  const makefile = await readBrowserMakefile();
  assert.match(makefile, /browser-apps-smoke:/);
  assert.equal(packageJson.scripts["publish:site"], "npm run build && node dist/src/publish-site.mjs");
  assert.equal(packageJson.scripts["compile:browser-apps"], "node dist/src/build-browser-apps.mjs");
  assert.equal(packageJson.scripts["compile:browser-fixture"],
    "node dist/src/build-browser-apps.mjs --manifest tests/fixtures/fake-browser-apps.json --allowed-source-root tests/fixtures/cpp --output-root dist/wasm/fixture-apps");
});

async function readBuilder() {
  return await readFile(path.join(await findBrowserRoot(), "src", "build-browser-apps.mjs"), "utf8");
}

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
