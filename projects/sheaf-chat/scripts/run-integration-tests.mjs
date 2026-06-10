import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const testRoot = join(packageRoot, "dist", "tests");

async function collectIntegrationTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectIntegrationTestFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".integration.test.js")) {
      files.push(entryPath);
    }
  }

  return files;
}

const testFiles = await collectIntegrationTestFiles(testRoot);

if (testFiles.length === 0) {
  console.error(`No compiled integration test files found under ${testRoot}`);
  process.exit(1);
}

testFiles.sort();

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
