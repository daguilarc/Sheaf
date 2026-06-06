import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  createRepoPaths,
  findServiceByName,
  loadServiceRegistry,
  type ServiceDefinition,
} from "../src/index.js";

test("createRepoPaths resolves repository layout paths", async () =>
{
  const paths = createRepoPaths();

  await access(paths.servicesJsonPath);
  await access(paths.sharedCssPath);

  const conductorLogRoot = paths.serviceLogRoot("conductor");
  assert.equal(conductorLogRoot, join(paths.repoRoot, "logs", "conductor"));
});

test("loadServiceRegistry reads the conductor service entry", async () =>
{
  const paths = createRepoPaths();
  const services = await loadServiceRegistry(paths.servicesJsonPath);

  assert.equal(services.length, 1);

  const conductor = findServiceByName(services, "conductor");
  assert.ok(conductor);

  const expected: ServiceDefinition = {
    name: "conductor",
    host: "0.0.0.0",
    port: 9001,
    home_path: "/",
    command: "npm --prefix projects/conductor start",
  };

  assert.deepEqual(conductor, expected);
});

test("package metadata points to built entry point files", async () =>
{
  const packageJsonUrl = new URL("../../package.json", import.meta.url);
  const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8")) as {
    name: string;
    main: string;
    types: string;
    exports: {
      ".": {
        import: string;
        types: string;
      };
    };
  };

  const entryPaths = [
    packageJson.main,
    packageJson.types,
    packageJson.exports["."].import,
    packageJson.exports["."].types,
  ];

  await Promise.all(
    entryPaths.map((entryPath) =>
      access(new URL(`../../${entryPath}`, import.meta.url)),
    ),
  );

  const packageEntry = await import(`../../${packageJson.main}`);

  assert.equal(typeof packageEntry.createRepoPaths, "function");
  assert.equal(typeof packageEntry.loadServiceRegistry, "function");
});
