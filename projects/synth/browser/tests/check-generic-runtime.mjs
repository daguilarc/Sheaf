import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const forbidden = /\b(MiniApp|miniapp|synth_miniapp|Vco|FilterModule|LfoBank)\b/;
const roots = ["src", "../include/synth/browser", "cpp"];
// Concrete application identity is permitted only at native entry and
// first-party publication boundaries; launcher/runtime implementation remains
// covered by the scan.
const skipped = new Set([
  path.resolve("cpp/miniapp_entry.cpp"),
  path.resolve("src/build-first-party-catalog.mjs"),
  path.resolve("src/publish-site.mjs"),
]);

async function* filesUnder(root) {
  const absoluteRoot = path.resolve(root);
  const entries = await readdir(absoluteRoot);
  for (const entry of entries) {
    const absolutePath = path.join(absoluteRoot, entry);
    const metadata = await stat(absolutePath);
    if (metadata.isDirectory()) {
      yield* filesUnder(absolutePath);
    } else if (metadata.isFile()) {
      yield absolutePath;
    }
  }
}

const violations = [];
for (const root of roots) {
  for await (const file of filesUnder(root)) {
    if (skipped.has(file)) {
      continue;
    }
    const text = await readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (forbidden.test(lines[index])) {
        violations.push(`${path.relative(process.cwd(), file)}:${index + 1}: ${lines[index].trim()}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Browser runtime contains concrete app-specific references:\n${violations.join("\n")}`);
  process.exit(1);
}
