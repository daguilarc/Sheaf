import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { readAppBuildManifest } from "../src/app-build-manifest.mjs";

const browserRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const synthRoot = path.resolve(browserRoot, "..");
const repositoryRoot = path.resolve(synthRoot, "..", "..");
const manifestPath = path.join(browserRoot, "first-party-apps.json");
const manifest = await readAppBuildManifest({ browserRoot, manifestPath });
const forbiddenAudioFallback = /renderTimer|configure-audio|render-audio|SharedRingBuffer|synth-audio-ring-buffer/;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const concreteTokens = new Set();
for (const app of manifest.apps) {
  const headerName = path.posix.basename(app.header);
  concreteTokens.add(app.appId);
  concreteTokens.add(app.displayName);
  concreteTokens.add(headerName);
  concreteTokens.add(headerName.replace(/\.[^.]+$/, ""));
  concreteTokens.add(app.cppType);
  for (const component of app.cppType.split("::")) concreteTokens.add(component);
}
const forbiddenAppIdentity = new RegExp(
  [...concreteTokens]
    .filter((token) => token.length > 0)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegex)
    .join("|"),
);

const roots = [
  path.join(browserRoot, "src"),
  path.join(synthRoot, "include", "synth", "browser"),
  path.join(browserRoot, "cpp"),
  path.join(browserRoot, "scripts"),
  path.join(repositoryRoot, ".github", "workflows", "synth-browser-pages.yml"),
  path.join(browserRoot, "Makefile"),
  path.join(synthRoot, "Makefile"),
];

async function* filesUnder(root) {
  const metadata = await stat(root);
  if (metadata.isFile()) {
    yield root;
    return;
  }
  for (const entry of await readdir(root)) {
    const absolutePath = path.join(root, entry);
    const childMetadata = await stat(absolutePath);
    if (childMetadata.isDirectory()) {
      yield* filesUnder(absolutePath);
    } else if (childMetadata.isFile()) {
      yield absolutePath;
    }
  }
}

const violations = [];
for (const root of roots) {
  for await (const file of filesUnder(root)) {
    const text = await readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    const synthMakeBrowserStart = file === path.join(synthRoot, "Makefile")
      ? lines.findIndex((line) => line === "browser:")
      : -1;
    const synthMakeBrowserEnd = synthMakeBrowserStart >= 0
      ? lines.findIndex((line, lineIndex) => lineIndex > synthMakeBrowserStart && line === "clean:")
      : -1;
    for (let index = 0; index < lines.length; index += 1) {
      let line = lines[index];
      // The repository synth Makefile also owns native app/test recipes. Scan
      // only its browser target names and dedicated browser-wrapper block.
      if (file === path.join(synthRoot, "Makefile")) {
        if (line.startsWith(".PHONY:")) {
          line = (line.match(/browser(?:-[A-Za-z0-9-]+)?/g) ?? []).join(" ");
        } else if (index < synthMakeBrowserStart || index >= synthMakeBrowserEnd) {
          continue;
        }
      }
      if (forbiddenAppIdentity.test(line)) {
        violations.push(`${path.relative(repositoryRoot, file)}:${index + 1}: concrete app identity: ${line.trim()}`);
      }
      if (forbiddenAudioFallback.test(line)) {
        violations.push(`${path.relative(repositoryRoot, file)}:${index + 1}: forbidden audio fallback: ${line.trim()}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Generic browser sources contain forbidden concrete app references:\n${violations.join("\n")}`);
  process.exit(1);
}
